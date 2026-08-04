// src/lib/process-stage/instancia-vigente-da-fase.ts
//
// QUAL INSTÂNCIA/CICLO a leitura de uma fase deve enxergar — resolvedor ÚNICO.
//
// Uma fase pode ter vários ciclos (retorno, reabertura, movimentação manual). A
// leitura que filtra só por `faseMacroKey` enxerga TODOS eles ao mesmo tempo: os
// passos do ciclo 1 aparecem misturados com os do ciclo 2, o progresso soma duas
// vezes o mesmo trabalho e a Central passa a mostrar um estado que não existe em
// ciclo nenhum. Escopar por instância é o que impede isso.
//
// VIGENTE ≠ "a mais nova de qualquer jeito": é a instância ATIVA da fase e, quando
// não há ativa (fase já concluída ou inteiramente supersedida), a de maior ciclo que
// ainda representa trabalho — CONCLUIDO antes de SUPERSEDIDO/CANCELADO, que saíram
// do fluxo. Ciclos antigos continuam existindo e continuam auditáveis; eles só não
// são o que a tela da fase mostra por padrão.

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

type DB = typeof prisma | Prisma.TransactionClient

/** Status que representam a instância em operação. */
export const STATUS_EM_OPERACAO = ["ATIVO", "BLOQUEADO", "AGUARDANDO"] as const

export interface InstanciaVigente {
  id: number
  ciclo: number
  status: string
  faseMacroKey: string
}

/**
 * Instância vigente da fase. `null` quando a fase nunca foi materializada — e nesse
 * caso a leitura NÃO deve cair no modo "todos os ciclos": deve mostrar vazio e dizer
 * que não há materialização.
 */
export async function resolverInstanciaVigente(
  processoId: number,
  faseMacroKey: string,
  db: DB = prisma,
): Promise<InstanciaVigente | null> {
  const emOperacao = await db.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey, status: { in: [...STATUS_EM_OPERACAO] } },
    orderBy: { ciclo: "desc" },
    select: { id: true, ciclo: true, status: true, faseMacroKey: true },
  })
  if (emOperacao) return emOperacao

  const concluida = await db.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey, status: "CONCLUIDO" },
    orderBy: { ciclo: "desc" },
    select: { id: true, ciclo: true, status: true, faseMacroKey: true },
  })
  if (concluida) return concluida

  // Só sobraram ciclos supersedidos/cancelados: a fase foi abandonada e retomada em
  // outro lugar. Mostrar o último ciclo é mais honesto do que somar todos.
  return db.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey },
    orderBy: { ciclo: "desc" },
    select: { id: true, ciclo: true, status: true, faseMacroKey: true },
  })
}
