// src/services/reabertura-de-certidao-cancelada.ts
// ============================================================================
// REABRIR CERTIDÃO CANCELADA — a porta de "Reabrir certidão" (Histórico do processo e Central Operacional).
//
// POR QUE ESTA PORTA EXISTE: `reabrirTarefa` (tarefa-ciclo.ts) reabre a TAREFA e as etapas CONCLUÍDAS — mas o
// cancelamento feito por "Cancelar operação" (documento-operacao.ts) mexeu em MAIS coisas: o Documento virou
// CANCELADO, a Necessidade foi DISPENSADA e as etapas viraram CANCELADO. Reabrir só a tarefa deixava tudo isso para
// trás (achado no teste: tarefa EM_ANDAMENTO, documento CANCELADO, etapas CANCELADO — estado impossível, e o reconciliador
// voltaria a cancelá-la). Aqui o cancelamento é desfeito INTEIRO e na MESMA transação, pelas portas que já existem:
//   • Documento CANCELADO → PENDENTE (a decisão humana é desfeita por outra decisão humana);
//   • Necessidade DISPENSADA → PENDENTE + etapas canceladas reabertas + tarefa projetada — `reativarNecessidade`
//     (o espelho que já existe de `dispensarNecessidade`), autorizada a reabrir ESTE documento;
//   • etapas do documento sem necessidade (Emissão) → `reabrirPassoTx` (a única descida permitida da máquina de estados);
//   • a MESMA tarefa volta (taskId preservado), com tentativa nova e histórico anterior intacto;
//   • uma linha de auditoria `TAREFA_REABERTA` com o motivo — é ela que o Histórico mostra como "reabriu a certidão".
// Quando o cancelamento foi só da TAREFA (documento ativo), delega à porta canônica `reabrirTarefa`, sem tocar em mais nada.
// NÃO reabre: certidão NÃO EXIGIDA (a árvore decide, não há botão), nem tarefa cancelada pelo Sistema.
// ============================================================================
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { reabrirTarefa } from '@/lib/operacional/tarefa-ciclo'
import { reativarNecessidade } from '@/src/services/necessidade-documental'
import { reabrirPassoTx } from '@/src/services/task-step-sync'
import { assegurarCoerenciaPassoTarefa } from '@/src/services/passo-tarefa-projecao'
import { MOTIVOS_DE_TENTATIVA } from '@/src/services/execucao-do-passo'

export type ResultadoReaberturaDeCertidao =
  | { ok: true; tarefaId: number; modo: 'OPERACAO' | 'TAREFA' }
  | { ok: false; codigo: 'SEM_MOTIVO' | 'NAO_ENCONTRADA' | 'NAO_CANCELADA' | 'NAO_EXIGIDA_PELA_ARVORE' | 'CANCELADA_PELO_SISTEMA' | string; mensagem: string }

export const MOTIVO_MINIMO = 5

export async function reabrirCertidaoCancelada(args: { processoId: number; tarefaId: number; autorId: number; motivo: string }): Promise<ResultadoReaberturaDeCertidao> {
  const motivo = (args.motivo ?? '').trim()
  if (motivo.length < MOTIVO_MINIMO) return { ok: false, codigo: 'SEM_MOTIVO', mensagem: `Explique por que reabrir (mínimo ${MOTIVO_MINIMO} caracteres) — fica no histórico.` }

  // ESCOPO POR PROCESSO: a tarefa da URL tem de ser deste processo.
  const t = await prisma.tarefa.findFirst({
    where: { id: args.tarefaId, processoId: args.processoId },
    select: { id: true, titulo: true, statusTarefa: true, documentoId: true, necessidadeId: true, workflowInstanceId: true, causaRemovidaEm: true },
  })
  if (!t) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Certidão não encontrada neste processo.' }
  if (t.statusTarefa !== 'CANCELADA') return { ok: false, codigo: 'NAO_CANCELADA', mensagem: 'Esta certidão não está cancelada — não há o que reabrir.' }

  const doc = t.documentoId != null ? await prisma.documento.findUnique({ where: { id: t.documentoId }, select: { id: true, status: true, necessidadeId: true } }) : null
  if (doc?.status === 'NAO_EXIGIDO') {
    return { ok: false, codigo: 'NAO_EXIGIDA_PELA_ARVORE', mensagem: 'A árvore deixou de exigir esta certidão. Quem decide é a árvore: se a exigência voltar, este mesmo registro é reativado.' }
  }

  // Cancelamento só da TAREFA (o documento segue ativo): a porta canônica basta.
  if (!doc || doc.status !== 'CANCELADO') {
    const r = await reabrirTarefa({ tarefaId: t.id, autorId: args.autorId, motivo })
    return r.ok ? { ok: true, tarefaId: t.id, modo: 'TAREFA' } : { ok: false, codigo: r.codigo, mensagem: r.mensagem }
  }

  // Cancelamento da OPERAÇÃO: desfaz tudo, junto.
  const necessidadeId = doc.necessidadeId ?? t.necessidadeId
  const agora = new Date()
  await prisma.$transaction(async (tx) => {
    const antes = await tx.tarefa.findUniqueOrThrow({ where: { id: t.id }, select: { statusTarefa: true } })
    await tx.documento.update({ where: { id: doc.id }, data: { status: 'PENDENTE', motivoBloqueio: null, ultimaMovimentacao: agora } })
    if (necessidadeId != null) await reativarNecessidade(necessidadeId, tx, { reabrirDocumentoIds: [doc.id] })

    // Etapas do DOCUMENTO (Emissão: passo por documento, sem necessidadeId) que o cancelamento encerrou e a reativação não alcançou.
    const restantes = await tx.phaseWorkflowStepInstance.findMany({
      where: { documentoId: doc.id, status: 'CANCELADO', ...(t.workflowInstanceId != null ? { workflowInstanceId: t.workflowInstanceId } : {}) },
      select: { id: true, ciclo: true, processoId: true, workflowInstanceId: true }, orderBy: { ordem: 'asc' },
    })
    const correlationId = randomUUID()
    for (const p of restantes) {
      await reabrirPassoTx(tx, p.id, 'DISPONIVEL', {
        correlationId, operacao: 'certidao-cancelada-reaberta', ciclo: p.ciclo, processoId: p.processoId, workflowInstanceId: p.workflowInstanceId,
        motivoTentativa: MOTIVOS_DE_TENTATIVA.REABERTURA_MANUAL, ignorarDependencias: true, extra: { motivo },
      })
    }
    if (restantes.length) await assegurarCoerenciaPassoTarefa(tx, restantes.map((p) => p.id))

    const depois = await tx.tarefa.findUniqueOrThrow({ where: { id: t.id }, select: { statusTarefa: true } })
    await tx.logAuditoria.create({
      data: {
        acao: 'TAREFA_REABERTA', entidade: 'Tarefa', entidadeId: t.id, usuarioId: args.autorId,
        descricao: `Tarefa "${t.titulo}" reaberta (estava ${antes.statusTarefa}; a operação cancelada voltou: documento, exigência e etapas). Motivo: ${motivo}`,
        detalhes: { tarefaId: t.id, de: antes.statusTarefa, para: depois.statusTarefa, motivo, documentoId: doc.id, necessidadeId, origem: 'CERTIDAO_CANCELADA' },
      },
    })
  }, { maxWait: 20_000, timeout: 60_000 })

  // Pós-commit e best-effort (como as demais portas): o motor de fases reavalia o processo.
  try {
    const { reconciliarMotorDeFases } = await import('@/src/lib/motor/reconciliar-motor-fases')
    await reconciliarMotorDeFases(args.processoId, { origem: 'comando:reabrir-certidao' })
  } catch (e) { console.error(`[reabertura-de-certidao] reconciliação do motor falhou (tarefa ${t.id}):`, e) }
  return { ok: true, tarefaId: t.id, modo: 'OPERACAO' }
}
