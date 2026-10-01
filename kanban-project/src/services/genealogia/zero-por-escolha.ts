// src/services/genealogia/zero-por-escolha.ts
// ============================================================================
// "ZERO POR ESCOLHA MANUAL" — quando a Genealogia fica SEM nenhuma exigência documental por causa de uma decisão humana
// (`Pessoa.documentosExigidos`), e não porque a árvore naturalmente não pede nada.
//
// Por quê: o gate canônico trata "0 exigido = 100%" (a fase fica satisfeita). Para zero NATURAL (árvore sem exigência) isso é
// o comportamento de sempre. Para zero POR ESCOLHA, o processo não pode sair sozinho da Genealogia só porque alguém desmarcou
// tudo: precisa de uma decisão humana consciente ("sem documentos, siga") — o avanço MANUAL continua permitido.
//
// DEFINIÇÃO (única, usada por `advance()`, cron `reconciliar-fases` (ensaio) e Saúde CRON-005):
//   1. a regra automática da árvore exigiria ≥ 1 documento que a escolha manual tirou (`removidasPorEscolha`); E
//   2. depois do filtro não sobrou nenhuma exigência (`exigencias` vazia); E
//   3. não há NecessidadeDocumental EM ABERTO (PENDENTE/EM_ATENDIMENTO) — trabalho em andamento é exigência real. Certidão já
//      ATENDIDA/NAO_LOCALIZADA NÃO desliga a trava: o fato fica registrado, mas a decisão "sem mais documentos, siga" continua
//      sendo humana (processo 688, 01/10/2026: havia certidão concluída, a pessoa desmarcou tudo e o processo avançou sozinho).
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { calcularExigenciasDaGenealogia, FASE_GENEALOGIA } from "@/src/services/genealogia/materializar-genealogia"

type DB = typeof prisma | Prisma.TransactionClient

export interface ZeroPorEscolha {
  zerada: boolean
  /** Quantas exigências a escolha manual tirou (0 quando não há zero por escolha ou nenhuma foi removida). */
  removidasPorEscolha: number
}

export async function genealogiaZeradaPorEscolhaManual(processoId: number, db: DB = prisma): Promise<ZeroPorEscolha> {
  const calculo = await calcularExigenciasDaGenealogia(processoId, db)
  if (!calculo) return { zerada: false, removidasPorEscolha: 0 }
  const removidas = calculo.removidasPorEscolha.length
  if (removidas === 0 || calculo.exigencias.length > 0) return { zerada: false, removidasPorEscolha: removidas }
  const vivas = await db.necessidadeDocumental.count({
    where: { processoId, supersedePorId: null, status: { in: ["PENDENTE", "EM_ATENDIMENTO"] } },
  })
  return { zerada: vivas === 0, removidasPorEscolha: removidas }
}

/** O processo está na Genealogia E a exigência dela é zero por escolha manual? */
export async function processoParadoPorEscolhaManual(processoId: number, faseAtualKey: string | null | undefined, db: DB = prisma): Promise<boolean> {
  if (faseAtualKey !== FASE_GENEALOGIA) return false
  return (await genealogiaZeradaPorEscolhaManual(processoId, db)).zerada
}
