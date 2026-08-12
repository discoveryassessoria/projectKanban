// src/lib/documentos/politica-natureza-fase.ts
//
// POLÍTICA DOCUMENTAL DA FASE — o que a fase materializa, decidido por CADASTRO.
//
// O QUE ISTO SUBSTITUI
// --------------------
// `natureza-certidao.ts` respondia "é certidão?" e o materializador da Genealogia
// usava essa resposta como porteiro: o que não fosse certidão não entrava. A
// premissa vivia no código, então incluir RG, comprovante ou procuração na fase
// exigia mexer no motor — e cada inclusão viraria um `if` por documento.
//
// Aqui a decisão é relacional e por ID:
//
//   CatalogoFase --< FaseNaturezaPermitida >-- NaturezaOperacionalDocumento
//                                                        ^
//                                       TipoDocumentoCadastro.naturezaOperacionalId
//
// A fase declara as naturezas que aceita; o tipo documental declara a sua; o
// motor compara. Nunca por código DOC, nome ou substring.
//
// O QUE ESTE ARQUIVO NÃO DECIDE
// -----------------------------
// Quem ganha workflow. Isso é do PerfilOperacionalDocumento, que aponta o
// PhaseInternalWorkflow — e é o que permite RG e procuração entrarem na fase sem
// herdar os cinco passos da emissão de certidão. Ver `perfilDoTipoDocumental`.

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

type DB = typeof prisma | Prisma.TransactionClient

/** Como um tipo documental se apresenta ao motor: tudo por ID, nada por texto. */
export interface TipoDocumentalResolvido {
  id: number
  code: string | null
  name: string
  naturezaOperacionalId: number | null
  familiaDocumentalId: number | null
  perfilOperacionalId: number | null
  itemCatalogoId: number | null
  /** workflow que o PERFIL declara; null = documento sem workflow operacional */
  workflowId: number | null
  ativo: boolean
}

export interface PoliticaDaFase {
  catalogoFaseId: number
  phaseKey: string
  /** ids de NaturezaOperacionalDocumento que a fase aceita */
  naturezasPermitidas: Set<number>
}

/**
 * Política vigente da fase. Fase sem política declarada devolve conjunto VAZIO —
 * e vazio significa "não materializa nada", nunca "materializa tudo". Um default
 * permissivo transformaria esquecimento de cadastro em materialização indevida.
 */
export async function politicaDaFase(phaseKey: string, db: DB = prisma): Promise<PoliticaDaFase | null> {
  const fase = await db.catalogoFase.findUnique({
    where: { phaseKey },
    select: { id: true, phaseKey: true, naturezasPermitidas: { where: { ativo: true }, select: { naturezaOperacionalId: true } } },
  })
  if (!fase) return null
  return {
    catalogoFaseId: fase.id,
    phaseKey: fase.phaseKey,
    naturezasPermitidas: new Set(fase.naturezasPermitidas.map((n) => n.naturezaOperacionalId)),
  }
}

/** Tipos documentais resolvidos por ID, com o workflow que o perfil declara. */
export async function resolverTiposDocumentais(db: DB = prisma): Promise<Map<number, TipoDocumentalResolvido>> {
  const tipos = await db.tipoDocumentoCadastro.findMany({
    select: {
      id: true, code: true, name: true, ativo: true,
      naturezaOperacionalId: true, familiaDocumentalId: true, perfilOperacionalId: true, itemCatalogoId: true,
      perfilOperacional: { select: { workflowId: true, ativo: true } },
    },
  })
  return new Map(tipos.map((t) => [t.id, {
    id: t.id, code: t.code, name: t.name, ativo: t.ativo,
    naturezaOperacionalId: t.naturezaOperacionalId,
    familiaDocumentalId: t.familiaDocumentalId,
    perfilOperacionalId: t.perfilOperacionalId,
    itemCatalogoId: t.itemCatalogoId,
    workflowId: t.perfilOperacional?.ativo ? t.perfilOperacional.workflowId : null,
  }]))
}

export type MotivoInaplicavel =
  | "TIPO_DOCUMENTAL_INEXISTENTE"
  | "TIPO_DOCUMENTAL_INATIVO"
  | "TIPO_SEM_NATUREZA"
  | "FASE_SEM_POLITICA"
  | "NATUREZA_NAO_PERMITIDA_NA_FASE"

export interface Aplicabilidade {
  permitido: boolean
  motivo: MotivoInaplicavel | null
  /** frase para o relatório de materialização — nomeia o que falta cadastrar */
  detalhe: string | null
  tipo: TipoDocumentalResolvido | null
}

/**
 * A fase materializa este tipo documental?
 *
 * Estrutural e por ID. Cada recusa tem motivo NOMEADO: "não materializou" nunca
 * pode ser silêncio — quem cadastrou precisa saber se faltou natureza no tipo ou
 * política na fase.
 */
export function naturezaPermitidaNaFase(
  politica: PoliticaDaFase | null,
  tipo: TipoDocumentalResolvido | undefined,
): Aplicabilidade {
  if (!tipo) return { permitido: false, motivo: "TIPO_DOCUMENTAL_INEXISTENTE", detalhe: "tipo documental não existe no Cadastro Mestre", tipo: null }
  if (!tipo.ativo) return { permitido: false, motivo: "TIPO_DOCUMENTAL_INATIVO", detalhe: `"${tipo.name}" está inativo no Cadastro Mestre`, tipo }
  if (tipo.naturezaOperacionalId == null) {
    return { permitido: false, motivo: "TIPO_SEM_NATUREZA", detalhe: `"${tipo.name}" não declara Natureza Operacional — cadastre-a no Tipo de Documento`, tipo }
  }
  if (!politica) return { permitido: false, motivo: "FASE_SEM_POLITICA", detalhe: "a fase não existe no Catálogo de Fases", tipo }
  if (!politica.naturezasPermitidas.has(tipo.naturezaOperacionalId)) {
    return {
      permitido: false, motivo: "NATUREZA_NAO_PERMITIDA_NA_FASE",
      detalhe: `a fase "${politica.phaseKey}" não aceita a natureza deste documento — habilite-a na política da fase`,
      tipo,
    }
  }
  return { permitido: true, motivo: null, detalhe: null, tipo }
}

/**
 * O documento recebe workflow operacional nesta fase?
 *
 * Vem do PERFIL, não da natureza nem do código. Certidão tem perfil "Emissão de
 * Certidão" (com workflow publicado) e ganha os passos; RG, comprovante e
 * procuração não têm perfil e entram na fase como necessidade sem passo. É esta
 * distinção — e não uma lista de exceções — que impede um RG de herdar os cinco
 * passos do cartório.
 */
export function recebeWorkflowOperacional(tipo: TipoDocumentalResolvido | null | undefined): boolean {
  return !!tipo && tipo.perfilOperacionalId != null && tipo.workflowId != null
}
