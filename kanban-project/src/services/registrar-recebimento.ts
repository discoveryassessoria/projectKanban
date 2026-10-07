// src/services/registrar-recebimento.ts
// ============================================================================
// REGISTRAR RECEBIMENTO (Operação, 07/10/2026) — UMA ação, a qualquer momento depois que o requerimento foi enviado ao cartório
// (antes ou depois do prazo de cobrança). Conclui "Receber confirmação do pedido" e "Receber certidão" de uma vez, deixa
// "Conferir e validar certidão" liberada (com quem registrou como responsável) e a certidão sai de Aguardando e vai para A fazer.
//
// Nada aqui exige anexo, comprovante, protocolo ou campo preenchido: a equipe lança pedidos de meses atrás que não têm comprovante
// guardado. O que conclui as subtarefas é a AÇÃO da pessoa, pelo mesmo motor de sempre (`concluirSubtarefaCorrentePeloPasso`) — nunca
// gravando status direto. As subtarefas continuam obrigatórias; só não há mais dois cliques (nem um comprovante) para passar por elas.
//
// Quem pode: quem fez o pedido (executou o "Enviar requerimento"), o responsável da tarefa e o administrador (o Marco vê e faz tudo).
// ============================================================================
import { prisma } from '@/lib/prisma'
import { subtarefasDaEtapa, concluirSubtarefaCorrentePeloPasso, resumirTarefaSeEsperaSubtarefaEncerrada } from '@/src/services/subtarefas-da-etapa'
import {
  SUBTAREFA_PEDIDO_ENVIADO, SUBTAREFA_CONFIRMACAO, SUBTAREFA_CERTIDAO_RECEBIDA, SUBTAREFA_CONFERENCIA,
  podeRegistrarRecebimento, dataDeRecebimento, textoDoRecebimento,
} from '@/lib/operacional/emissao-recebimento'

export type ResultadoDoRecebimento =
  | { ok: true; tarefaId: number; recebidaEm: string; texto: string; responsavelDaConferenciaId: number }
  | { ok: false; codigo: 'NAO_ENCONTRADA' | 'SEM_PERMISSAO' | 'DATA_INVALIDA' | 'PEDIDO_NAO_ENVIADO' | 'JA_REGISTRADO' | 'ENCERRADA' | 'ESTADO_MUDOU'; mensagem: string }

const TERMINAIS = ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI', 'CANCELADA', 'SUPERSEDIDA']

export async function registrarRecebimentoDaCertidao(args: {
  tarefaId: number
  usuario: { userId: number; tipo: string; nome?: string | null }
  /** AAAA-MM-DD; ausente = hoje. Pode ser de meses atrás; futura é recusada. */
  recebidaEm?: string | null
  agora?: Date
}): Promise<ResultadoDoRecebimento> {
  const agora = args.agora ?? new Date()
  const t = await prisma.tarefa.findUnique({
    where: { id: args.tarefaId },
    select: {
      id: true, statusTarefa: true, responsavelId: true, workflowStepInstanceId: true, orgaoId: true,
      workflowStepInstance: { select: { documentoId: true, documento: { select: { orgaoId: true } } } },
    },
  })
  if (!t || !t.workflowStepInstanceId) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Tarefa não encontrada.' }
  if (TERMINAIS.includes(t.statusTarefa)) return { ok: false, codigo: 'ENCERRADA', mensagem: 'Esta certidão já está encerrada.' }
  const stepInstanceId = t.workflowStepInstanceId

  const execs = await prisma.subtaskExecution.findMany({
    where: { stepInstanceId, supersededAt: null },
    select: { subtaskKey: true, status: true, executadoPorId: true },
  })
  const porChave = new Map(execs.map((e) => [e.subtaskKey, e]))
  if (porChave.get(SUBTAREFA_PEDIDO_ENVIADO)?.status !== 'CONCLUIDO') {
    return { ok: false, codigo: 'PEDIDO_NAO_ENVIADO', mensagem: 'O requerimento ainda não foi enviado ao cartório — envie primeiro.' }
  }
  if (porChave.get(SUBTAREFA_CERTIDAO_RECEBIDA)?.status === 'CONCLUIDO') {
    return { ok: false, codigo: 'JA_REGISTRADO', mensagem: 'O recebimento desta certidão já foi registrado.' }
  }
  const pedidoPorId = porChave.get(SUBTAREFA_PEDIDO_ENVIADO)?.executadoPorId ?? null
  if (!podeRegistrarRecebimento({ tipo: args.usuario.tipo, userId: args.usuario.userId, responsavelId: t.responsavelId, pedidoPorId })) {
    return { ok: false, codigo: 'SEM_PERMISSAO', mensagem: 'Só quem fez o pedido (ou o Marco) pode registrar o recebimento.' }
  }
  const dia = args.recebidaEm?.trim() ? args.recebidaEm : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora)
  const recebida = dataDeRecebimento(dia, agora)
  if (!recebida) return { ok: false, codigo: 'DATA_INVALIDA', mensagem: 'A data de recebimento é inválida ou está no futuro.' }

  const fornecedorId = t.workflowStepInstance?.documento?.orgaoId ?? t.orgaoId ?? null
  const payload = { origem: 'registrar_recebimento', recebidaEm: recebida.toISOString(), semAnexo: true }

  // As subtarefas 2 e 3, nesta ordem, pelo motor: cada uma só conclui se for a CORRENTE (o motor recusa a errada).
  for (const key of [SUBTAREFA_CONFIRMACAO, SUBTAREFA_CERTIDAO_RECEBIDA]) {
    if (porChave.get(key)?.status === 'CONCLUIDO') continue
    const r = await concluirSubtarefaCorrentePeloPasso({
      stepInstanceId, executadoPorId: args.usuario.userId, payload, resultado: 'recebimento_registrado',
      fornecedorId, subtarefaKeyEsperada: key,
      // Pedido antigo, sem protocolo guardado: registrar o recebimento nunca exige o número do cartório.
      confirmadoSemProtocolo: true,
    })
    if (!r.aplicavel) return { ok: false, codigo: 'ESTADO_MUDOU', mensagem: r.motivo === 'PASSO_BLOQUEADO' && r.mensagem ? r.mensagem : 'O estado da certidão mudou enquanto você registrava — recarregue e tente de novo.' }
  }
  // A espera automática do cartório termina (a tarefa deixa de estar "aguardando terceiros").
  await resumirTarefaSeEsperaSubtarefaEncerrada({ stepInstanceId, fornecedorId })

  // O responsável por "Conferir e validar" é quem registrou o recebimento (padrão).
  if (t.responsavelId !== args.usuario.userId) {
    const { atribuirTarefa } = await import('@/lib/operacional/tarefa-comandos')
    await atribuirTarefa({ tarefaId: t.id, responsavelId: args.usuario.userId, autorId: args.usuario.userId, motivo: 'quem registrou o recebimento conferirá a certidão' })
  }

  const nome = args.usuario.nome ?? (await prisma.usuario.findUnique({ where: { id: args.usuario.userId }, select: { nome: true } }))?.nome ?? 'a equipe'
  const texto = textoDoRecebimento(recebida, nome, agora)
  await prisma.logAuditoria.create({
    data: {
      acao: 'CERTIDAO_RECEBIMENTO_REGISTRADO', entidade: 'Tarefa', entidadeId: t.id, usuarioId: args.usuario.userId,
      descricao: texto,
      detalhes: { recebidaEm: recebida.toISOString(), registradoPor: nome, proximaEtapa: SUBTAREFA_CONFERENCIA, stepKey: SUBTAREFA_CERTIDAO_RECEBIDA } as never,
    },
  })
  // Confere o que a lista vai mostrar: a tarefa tem de ter a subtarefa 4 como corrente.
  await subtarefasDaEtapa({ stepInstanceId, fornecedorId })
  return { ok: true, tarefaId: t.id, recebidaEm: recebida.toISOString(), texto, responsavelDaConferenciaId: args.usuario.userId }
}
