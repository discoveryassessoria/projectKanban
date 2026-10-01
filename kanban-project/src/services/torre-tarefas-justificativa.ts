// src/services/torre-tarefas-justificativa.ts
// ============================================================================
// A JUSTIFICATIVA QUE VAI PARA O HISTÓRICO (Torre nova, aba Tarefas, 01/10/2026).
//
// Todo modal da aba Tarefas pede uma justificativa de no mínimo 5 letras (trim) e promete que ela "vai para o histórico com seu
// nome e a hora". Quase toda porta canônica já grava o motivo na PRÓPRIA linha de auditoria (repactuar, bloquear, desbloquear,
// reabrir, adiar, cobrar, ligação) — nesses casos nada se acrescenta. Quando a porta NÃO tem campo para o motivo (trocar o
// canal, cobrar o cliente pelo chat), esta função acrescenta UMA linha sob a tarefa (`TORRE_JUSTIFICATIVA`), que o dossiê e a
// gaveta leem junto do fato — quem, o quê, quando e por quê.
// ============================================================================
import { prisma } from '@/lib/prisma'

export const MINIMO_DA_JUSTIFICATIVA = 5

/** Justificativa válida: ≥ 5 letras depois do trim (a mesma regra do modal). Devolve o texto limpo ou `null`. */
export function justificativaValida(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().slice(0, 300)
  return t.length >= MINIMO_DA_JUSTIFICATIVA ? t : null
}

export async function registrarJustificativa(args: { tarefaId: number; usuarioId: number; acao: string; justificativa: string }): Promise<void> {
  await prisma.logAuditoria.create({
    data: {
      acao: 'TORRE_JUSTIFICATIVA', entidade: 'Tarefa', entidadeId: args.tarefaId, usuarioId: args.usuarioId,
      descricao: `Justificativa (${args.acao}): ${args.justificativa}`,
      detalhes: { tarefaId: args.tarefaId, acao: args.acao, justificativa: args.justificativa },
    },
  })
}
