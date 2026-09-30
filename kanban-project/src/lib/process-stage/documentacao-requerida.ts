// src/lib/process-stage/documentacao-requerida.ts
// ============================================================================
// DOCUMENTOS REQUERIDOS / RECEBIDOS / PENDENTES — FONTE ÚNICA DOS TRÊS NÚMEROS.
//
// Achado real (processo 675, Antão, 30/09/2026): a MESMA documentação aparecia
// com três números em cinco telas porque cada uma contava um GRAIN diferente:
//
//   Geral       "0 de 14 recebidos"   DENOMINADOR = Documento (18 na árvore − 4
//                                     CANCELADO = 14, inclui o Documento órfão
//                                     2303, sem necessidade); NUMERADOR =
//                                     NecessidadeDocumental "RECEBIDA" pelo
//                                     filtro de SolicitacaoDocumento (0).
//                                     Grains misturados na mesma fração.
//   Documentos  "14 / 12 / 2"         grain DOCUMENTO (linhas da árvore, com o
//                                     órfão 2303 e o placeholder da 673).
//   Central,    "12 de 13 (92%)"      grain NECESSIDADE de certidão OBRIGATÓRIA
//   Home,                             e não dispensada, concluída pelo predicado
//   Torre                             canônico `obrigacaoConcluidaNaFase`
//                                     (operational-projection-core.ts).
//
// O CORRETO é o da Central: o requisito é a NECESSIDADE (o que a regra exige);
// "recebida" é a necessidade cumprida pelo MESMO predicado da projeção
// operacional (CLAUDE.md §5 grain, §17 contadores). Documento é o artefato que
// atende a necessidade — pode existir sem ela (órfão) e não é requisito.
//
// Esta função NÃO recalcula nada: reembala `resolverCompletudeDocumental`
// (que já é a fonte da Central e da Torre) no vocabulário "requeridos /
// recebidos / pendentes". Geral, Documentos, Central, Torre e Home leem daqui.
// ============================================================================
import {
  resolverCompletudeDocumental,
  type CompletudeDocumental,
  type EscopoPessoa,
} from "./completude-documental"

export interface DocumentacaoRequerida {
  /** false = a fase ativa não trabalha certidões (escopo PROCESSO): não há "N de M" a mostrar. */
  aplicavel: boolean
  requeridos: number
  recebidos: number
  pendentes: number
  percentual: number
  /** Declaração explícita do grain (CLAUDE.md §5): a unidade contada é a NECESSIDADE de certidão obrigatória. */
  grain: "NECESSIDADE_CERTIDAO_OBRIGATORIA"
}

/** Pura: reembala a completude. Existe separada para o teste provar a regra sem banco. */
export function resumirDocumentacao(c: Pick<CompletudeDocumental, "aplicavel" | "required" | "completed" | "percentage">): DocumentacaoRequerida {
  return {
    aplicavel: c.aplicavel,
    requeridos: c.required,
    recebidos: c.completed,
    pendentes: Math.max(0, c.required - c.completed),
    percentual: c.percentage,
    grain: "NECESSIDADE_CERTIDAO_OBRIGATORIA",
  }
}

export async function documentacaoRequeridaDoProcesso(
  processoId: number,
  escopoPessoa: EscopoPessoa = "TODAS",
): Promise<DocumentacaoRequerida> {
  return resumirDocumentacao(await resolverCompletudeDocumental(processoId, { escopoPessoa }))
}
