// src/lib/document-type-resolver.ts
// ============================================================================
// LOTE C · FASE 7 — COMPATIBILITY LAYER do tipo de documento.
// ----------------------------------------------------------------------------
// Fonte ÚNICA de "qual é o tipo deste documento" durante a migração enum→config.
// Todos os 9 arquivos que hoje lêem Documento.tipo devem passar a usar ISTO
// (Fases 8/16), em vez de comparar com o enum direto.
//
// Ordem de resolução (o Marco definiu):
//   1. documentTypeId (NOVA fonte — TipoDocumentoCadastro)  → preferida
//   2. tipo legado (enum) resolvido via legacyEnumKey        → fallback
//   3. nenhum dos dois                                       → NEEDS_REVIEW
//
// NÃO decide regra de negócio por code fixo — expõe category/nature p/ isso.
// ============================================================================

import { prisma } from '@/lib/prisma'

export interface TipoResolvido {
  fonte: 'documentType' | 'legacy' | 'none'
  tipoDocumentoCadastroId: number | null
  code: string | null          // ex.: "IT - NAS"  (NÃO usar p/ regra de negócio)
  name: string | null
  category: string | null      // civil_registry | identity | ... (use ISTO p/ regra)
  nature: string | null        // certidao | identidade | ...     (use ISTO p/ regra)
  legacyEnumKey: string | null // ex.: "CERTIDAO_NASCIMENTO_INTEIRO_TEOR"
}

const VAZIO: TipoResolvido = { fonte: 'none', tipoDocumentoCadastroId: null, code: null, name: null, category: null, nature: null, legacyEnumKey: null }

function daEntidade(t: { id: number; code: string | null; name: string; category: string | null; nature: string | null; legacyEnumKey: string | null }, fonte: 'documentType' | 'legacy'): TipoResolvido {
  return { fonte, tipoDocumentoCadastroId: t.id, code: t.code, name: t.name, category: t.category, nature: t.nature, legacyEnumKey: t.legacyEnumKey }
}

/**
 * Resolve o tipo de UM documento já carregado (evita query se documentType veio no include).
 * Passe { documentTypeId, tipo, documentType? }.
 */
export async function resolveDocumentType(doc: {
  documentTypeId?: number | null
  tipo?: string | null
  documentType?: { id: number; code: string | null; name: string; category: string | null; nature: string | null; legacyEnumKey: string | null } | null
}): Promise<TipoResolvido> {
  // 1) NOVA fonte — se já veio no include, usa direto (sem query)
  if (doc.documentType) return daEntidade(doc.documentType, 'documentType')
  if (doc.documentTypeId != null) {
    const t = await prisma.tipoDocumentoCadastro.findUnique({ where: { id: doc.documentTypeId } })
    if (t) return daEntidade(t, 'documentType')
  }
  // 2) fallback legado — resolve o enum via legacyEnumKey
  if (doc.tipo) {
    const t = await prisma.tipoDocumentoCadastro.findFirst({ where: { legacyEnumKey: String(doc.tipo) } })
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
  const tipos = await prisma.tipoDocumentoCadastro.findMany({ where: { ativo: true } })
  const porId = new Map<number, TipoResolvido>()
  const porLegacy = new Map<string, TipoResolvido>()
  for (const t of tipos) {
    const r = daEntidade(t, 'documentType')
    porId.set(t.id, r)
    if (t.legacyEnumKey) porLegacy.set(t.legacyEnumKey, { ...r, fonte: 'legacy' })
  }
  return { porId, porLegacy }
}