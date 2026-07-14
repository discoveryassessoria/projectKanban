// src/lib/document-type-resolver.ts
// ============================================================================
// COMPATIBILITY LAYER do tipo de documento — fonte ÚNICA de "qual é o tipo deste
// documento" durante a migração enum→config.
//
// Ordem de resolução do TIPO:
//   1. documentTypeId (TipoDocumentoCadastro)      → preferida
//   2. tipo legado (enum) via legacyEnumKey         → fallback
//   3. nenhum                                       → NEEDS_REVIEW
//
// CLASSIFICAÇÃO DOCUMENTAL (LOTE A) — DOIS EIXOS DISTINTOS, sem sobreposição:
//   • categoriaDocumental*  = FONTE CANÔNICA. Agrupamento administrativo/estrutural
//       do documento (ex.: "Registro Civil", "Identidade"). Consumida por ID/code.
//       Regras de negócio devem usar categoriaDocumentalId (vínculo) ou
//       categoriaDocumentalCode (lógica técnica com code estável). NUNCA por nome.
//   • naturezaDocumental (`nature`) = SUBTIPO técnico do documento dentro da
//       categoria (ex.: CERTIDAO_NASCIMENTO, CERTIDAO_CASAMENTO). Eixo diferente:
//       "Registro Civil" (categoria) contém várias naturezas. Não duplica a categoria.
//   • category (string legada) = APENAS fallback transitório de classificação,
//       usado quando categoriaDocumentalId ainda estiver nulo (linha não migrada).
//       Não usar como fonte de regra nova. Ver src/lib/document-category-map.ts.
// ============================================================================

import { prisma } from '@/lib/prisma'
import { codeFromLegacy } from '@/src/lib/document-category-map'

/** Shape mínimo do TipoDocumentoCadastro com a relação canônica carregada. */
export interface TipoComCategoria {
  id: number
  code: string | null
  name: string
  category: string | null // legado (fallback)
  nature: string | null
  legacyEnumKey: string | null
  categoriaDocumental?: { id: number; code: string; name: string; ativo: boolean } | null
}

export interface TipoResolvido {
  fonte: 'documentType' | 'legacy' | 'none'
  tipoDocumentoCadastroId: number | null
  code: string | null          // ex.: "IT - NAS" (rótulo do tipo; NÃO usar p/ regra)
  name: string | null
  // --- Classificação CANÔNICA (consumir por ID/code) ---
  categoriaDocumentalId: number | null
  categoriaDocumentalCode: string | null   // estável; pode ser usado em lógica técnica
  categoriaDocumentalNome: string | null
  // --- Eixo distinto: subtipo técnico ---
  naturezaDocumental: string | null        // = nature
  // --- Fallback transitório (não usar p/ regra nova) ---
  category: string | null      // legado
  nature: string | null        // nome de campo legado de naturezaDocumental
  legacyEnumKey: string | null
}

const VAZIO: TipoResolvido = {
  fonte: 'none', tipoDocumentoCadastroId: null, code: null, name: null,
  categoriaDocumentalId: null, categoriaDocumentalCode: null, categoriaDocumentalNome: null,
  naturezaDocumental: null, category: null, nature: null, legacyEnumKey: null,
}

function daEntidade(t: TipoComCategoria, fonte: 'documentType' | 'legacy'): TipoResolvido {
  const rel = t.categoriaDocumental ?? null
  // DUAL-READ: prefere a FK; só cai no legado (deriva o code via ponte) quando a
  // relação não veio. O ID/nome só existem quando há relação real (fonte canônica).
  const categoriaDocumentalCode = rel?.code ?? codeFromLegacy(t.category)
  return {
    fonte,
    tipoDocumentoCadastroId: t.id,
    code: t.code,
    name: t.name,
    categoriaDocumentalId: rel?.id ?? null,
    categoriaDocumentalCode: categoriaDocumentalCode ?? null,
    categoriaDocumentalNome: rel?.name ?? null,
    naturezaDocumental: t.nature,
    category: t.category,
    nature: t.nature,
    legacyEnumKey: t.legacyEnumKey,
  }
}

const INCLUDE_CATEGORIA = {
  categoriaDocumental: { select: { id: true, code: true, name: true, ativo: true } },
} as const

/**
 * Resolve o tipo de UM documento já carregado (evita query se documentType veio no include).
 * Passe { documentTypeId, tipo, documentType? }. Para dual-read da categoria, inclua
 * `categoriaDocumental` no `documentType`.
 */
export async function resolveDocumentType(doc: {
  documentTypeId?: number | null
  tipo?: string | null
  documentType?: TipoComCategoria | null
}): Promise<TipoResolvido> {
  // 1) NOVA fonte — se já veio no include, usa direto (sem query)
  if (doc.documentType) return daEntidade(doc.documentType, 'documentType')
  if (doc.documentTypeId != null) {
    const t = await prisma.tipoDocumentoCadastro.findUnique({ where: { id: doc.documentTypeId }, include: INCLUDE_CATEGORIA })
    if (t) return daEntidade(t, 'documentType')
  }
  // 2) fallback legado — resolve o enum via legacyEnumKey
  if (doc.tipo) {
    const t = await prisma.tipoDocumentoCadastro.findFirst({ where: { legacyEnumKey: String(doc.tipo) }, include: INCLUDE_CATEGORIA })
    if (t) return daEntidade(t, 'legacy')
  }
  // 3) nada
  return VAZIO
}

/**
 * Versão SÍNCRONA para quando a lista de tipos já foi pré-carregada em memória
 * (evita N queries em loops). Passe o mapa legacyEnumKey→entidade e id→entidade.
 */
export function resolveDocumentTypeSync(
  doc: { documentTypeId?: number | null; tipo?: string | null },
  porId: Map<number, TipoResolvido>,
  porLegacy: Map<string, TipoResolvido>,
): TipoResolvido {
  if (doc.documentTypeId != null && porId.has(doc.documentTypeId)) return porId.get(doc.documentTypeId)!
  if (doc.tipo && porLegacy.has(String(doc.tipo))) return porLegacy.get(String(doc.tipo))!
  return VAZIO
}

/** Carrega TODOS os tipos ativos como mapas (p/ o resolver síncrono em loops/listagens). */
export async function carregarMapasDeTipos(): Promise<{ porId: Map<number, TipoResolvido>; porLegacy: Map<string, TipoResolvido> }> {
  const tipos = await prisma.tipoDocumentoCadastro.findMany({ where: { ativo: true }, include: INCLUDE_CATEGORIA })
  const porId = new Map<number, TipoResolvido>()
  const porLegacy = new Map<string, TipoResolvido>()
  for (const t of tipos) {
    const r = daEntidade(t, 'documentType')
    porId.set(t.id, r)
    if (t.legacyEnumKey) porLegacy.set(t.legacyEnumKey, { ...r, fonte: 'legacy' })
  }
  return { porId, porLegacy }
}
