// src/services/iniciar-envio.ts
// ============================================================================
// INICIAR (enviar ao cartório) — o gesto do ponto de entrada do passo, numa
// porta só (Torre de Controle, Bloco G2, 30/09/2026).
//
// O corpo era o laço da rota `iniciar-lote` (Etapa 3 da Operação). Virou serviço
// para a AÇÃO RÁPIDA POR LINHA da Torre usar exatamente a mesma execução — pelo
// motor de subtarefas (`concluirSubtarefaCorrentePeloPasso`), nunca gravando
// status direto.
//
// `podeIniciarPelaTorre` é o predicado do botão "Iniciar": ele só aparece — e a
// API só aceita — para a tarefa que REALMENTE pode iniciar: não iniciada, na
// FASE ATUAL do processo (uma tarefa de fase deixada ou futura não é decisão de
// hoje), sem bloqueio nem dependência aberta, com o órgão vinculado e sendo o
// ponto de entrada ainda não tocado. A lista e a API usam ESTA função.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { podeExecutar } from '@/lib/operacional/tarefa-ciclo'
import { subtarefasDaEtapa, concluirSubtarefaCorrentePeloPasso } from '@/src/services/subtarefas-da-etapa'

export interface EntradaDoPredicadoIniciar {
  statusTarefa: string
  aIniciar: boolean
  faseMacroKey: string | null
  /** `Processo.faseAtualKey` — a fase em que o processo ESTÁ. */
  faseAtualKey: string | null
  aguardandoDependencia: boolean
  temOrgao: boolean
}

/** `null` = pode iniciar; texto = por que não (o botão não aparece). */
export function motivoDeNaoPoderIniciar(e: EntradaDoPredicadoIniciar): string | null {
  if (e.statusTarefa !== 'NAO_INICIADA') return e.statusTarefa === 'BLOQUEADA' ? 'tarefa bloqueada' : 'a tarefa já foi iniciada ou está encerrada'
  if (e.aguardandoDependencia) return 'depende de outra tarefa ainda aberta'
  if (!e.aIniciar) return 'não está no ponto de entrada do passo'
  if (e.faseMacroKey == null || e.faseAtualKey == null || e.faseMacroKey !== e.faseAtualKey) return 'a tarefa não é da fase atual do processo'
  if (!e.temOrgao) return 'sem órgão vinculado — vincule antes de iniciar'
  return null
}
export const podeIniciarPelaTorre = (e: EntradaDoPredicadoIniciar): boolean => motivoDeNaoPoderIniciar(e) === null

export type ResultadoInicio = { ok: true } | { ok: false; motivo: string }

/**
 * EXECUTA o início de UMA tarefa pelo motor. Confere a posse (não-admin só a
 * própria) e o estado da subtarefa corrente; `elegibilidade` (opcional) é o
 * predicado da Torre — a Operação (`iniciar-lote`) não o passa e mantém o
 * comportamento de sempre.
 */
export async function iniciarEnvioDaTarefa(args: {
  tarefaId: number
  usuario: { userId: number; tipo: string }
  canalKey?: string
  protocolo?: string
  exigirElegibilidadeDaTorre?: boolean
}): Promise<ResultadoInicio> {
  const t = await prisma.tarefa.findUnique({
    where: { id: args.tarefaId },
    select: {
      id: true, responsavelId: true, statusTarefa: true, faseMacroKey: true, workflowStepInstanceId: true, orgaoId: true,
      processo: { select: { faseAtualKey: true } },
      workflowStepInstance: { select: { documentoId: true, documento: { select: { orgaoId: true } } } },
    },
  })
  if (!t) return { ok: false, motivo: 'tarefa não encontrada' }
  if (args.usuario.tipo !== 'admin' && t.responsavelId !== args.usuario.userId) return { ok: false, motivo: 'não é o responsável' }
  if (!t.workflowStepInstanceId) return { ok: false, motivo: 'sem etapa de workflow' }
  // O órgão do documento é o que o motor usa; `Tarefa.orgaoId` o espelha (Bloco C) — a MESMA resolução da lista da Torre.
  const fornecedorId = t.workflowStepInstance?.documento?.orgaoId ?? t.orgaoId ?? null
  if (!fornecedorId) return { ok: false, motivo: 'sem órgão vinculado — vincule antes de iniciar' }

  const subs = await subtarefasDaEtapa({ stepInstanceId: t.workflowStepInstanceId, fornecedorId })
  const corrente = subs.find((s) => !s.concluida)
  if (!corrente) return { ok: false, motivo: 'sem subtarefa em aberto' }
  const pontoDeEntrada = (corrente.dependeDe ?? []).length === 0
  const jaTocada = corrente.execucao?.startedAt != null
  if (!pontoDeEntrada || jaTocada || !corrente.disponivel) {
    return { ok: false, motivo: "não está 'a iniciar' — já foi enviada ou não é o ponto de entrada" }
  }

  if (args.exigirElegibilidadeDaTorre) {
    // A MESMA conta de dependência que o resto do motor usa (`podeExecutar`).
    const abertas = !(await podeExecutar(t.id)).pode
    const motivo = motivoDeNaoPoderIniciar({
      statusTarefa: t.statusTarefa, aIniciar: true, faseMacroKey: t.faseMacroKey,
      faseAtualKey: t.processo?.faseAtualKey ?? null, aguardandoDependencia: abertas, temOrgao: true,
    })
    if (motivo) return { ok: false, motivo }
  }

  const r = await concluirSubtarefaCorrentePeloPasso({
    stepInstanceId: t.workflowStepInstanceId,
    executadoPorId: args.usuario.userId,
    payload: { canalKey: args.canalKey, protocolo: args.protocolo, enviadoEmLote: true },
    resultado: 'enviado_lote',
    canalKey: args.canalKey,
    protocolo: args.protocolo,
    fornecedorId,
    subtarefaKeyEsperada: corrente.key,
  })
  return r.aplicavel ? { ok: true } : { ok: false, motivo: (r.motivo === 'PASSO_BLOQUEADO' || r.motivo === 'DEPENDENCIA_PENDENTE') && r.mensagem ? r.mensagem : 'estado mudou entre a leitura e a execução — tente de novo' }
}
