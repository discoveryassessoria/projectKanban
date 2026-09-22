// src/services/prazo-sla/reconciliar-prazo-sla.ts
// ============================================================================
// O EFEITO da reconciliação de Política de Prazo/SLA — chamado pelo
// outbox-dispatcher, uma Tarefa por vez (tipo "prazo.sla.reconciliar").
// REGRA MASTER: nunca exclui/recria/duplica Tarefa, nunca reabre concluída,
// nunca mexe em responsável/histórico/documentos — só recalcula os campos
// temporais da MESMA linha, pela estratégia escolhida na publicação.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { calcularPrazoGeral, calcularAcompanhamento, type ParametrosContagemDias } from "@/lib/operacional/motor-prazo-sla"

export interface ReconciliacaoPrazoSlaPayload {
  tarefaId: number
  politicaId: number
  versaoId: number
  versaoAnterior: number
  versaoNova: number
  estrategiaRetroacao: string
  publicadoPorId: number | null
}

export async function processarReconciliacaoPrazoSla(payload: ReconciliacaoPrazoSlaPayload): Promise<void> {
  if (!payload.tarefaId) return

  const tarefa = await prisma.tarefa.findUnique({ where: { id: payload.tarefaId } })
  // FATO HISTÓRICO — concluída/cancelada nunca é tocada, mesmo que a tarefa
  // ainda exista (proteção redundante ao filtro do enqueue: o tempo entre
  // enfileirar e processar pode ter concluído a tarefa).
  if (!tarefa || tarefa.concluida || ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA"].includes(tarefa.statusTarefa)) {
    return
  }

  const versao = await prisma.politicaPrazoSlaVersao.findUnique({ where: { id: payload.versaoId } })
  if (!versao) return

  const contagem: ParametrosContagemDias = {
    unidade: versao.prazoUnidade as "DIAS_CORRIDOS" | "DIAS_UTEIS",
    tratamentoFimDeSemana: versao.tratamentoFimDeSemana as "PULA" | "CONTA",
    tratamentoFeriado: versao.tratamentoFeriado as "PULA" | "CONTA",
  }

  const dataPrazoAntes = tarefa.dataPrazo
  const acompanhamentoAntes = tarefa.proximoAcompanhamentoEm
  let novoDataPrazo = tarefa.dataPrazo
  let novoProximoAcompanhamento = tarefa.proximoAcompanhamentoEm

  if (payload.estrategiaRetroacao === "RECALCULAR_DA_ORIGEM") {
    const base = tarefa.prazoBaseCalculoEm ?? tarefa.createdAt
    novoDataPrazo = calcularPrazoGeral(base, {
      ...contagem, quantidade: versao.prazoQuantidade, politicaDataNaoUtil: versao.politicaDataNaoUtil as "PROXIMO_DIA_UTIL" | "DIA_UTIL_ANTERIOR",
      horarioLimite: versao.horarioLimite,
    })
    novoProximoAcompanhamento = calcularAcompanhamento(base, versao.acompanhamentoPrimeiroDias, {
      unidade: versao.acompanhamentoUnidade as "DIAS_CORRIDOS" | "DIAS_UTEIS", tratamentoFimDeSemana: versao.tratamentoFimDeSemana as "PULA" | "CONTA", tratamentoFeriado: versao.tratamentoFeriado as "PULA" | "CONTA",
    })
  } else if (payload.estrategiaRetroacao === "APLICAR_DA_PUBLICACAO") {
    const base = versao.publicadoEm
    novoDataPrazo = calcularPrazoGeral(base, {
      ...contagem, quantidade: versao.prazoQuantidade, politicaDataNaoUtil: versao.politicaDataNaoUtil as "PROXIMO_DIA_UTIL" | "DIA_UTIL_ANTERIOR",
      horarioLimite: versao.horarioLimite,
    })
    novoProximoAcompanhamento = calcularAcompanhamento(base, versao.acompanhamentoPrimeiroDias, {
      unidade: versao.acompanhamentoUnidade as "DIAS_CORRIDOS" | "DIAS_UTEIS", tratamentoFimDeSemana: versao.tratamentoFimDeSemana as "PULA" | "CONTA", tratamentoFeriado: versao.tratamentoFeriado as "PULA" | "CONTA",
    })
  } else if (payload.estrategiaRetroacao === "MANTER_PRAZO_ATUALIZAR_ACOMPANHAMENTO") {
    // dataPrazo NÃO muda — só o acompanhamento futuro, a partir de agora.
    novoProximoAcompanhamento = calcularAcompanhamento(versao.publicadoEm, versao.acompanhamentoPadraoDias, {
      unidade: versao.acompanhamentoUnidade as "DIAS_CORRIDOS" | "DIAS_UTEIS", tratamentoFimDeSemana: versao.tratamentoFimDeSemana as "PULA" | "CONTA", tratamentoFeriado: versao.tratamentoFeriado as "PULA" | "CONTA",
    })
  }
  // SOMENTE_NOVAS nunca chega aqui — enqueue não gera outbox pra essa estratégia.

  await prisma.tarefa.update({
    where: { id: tarefa.id },
    data: {
      dataPrazo: novoDataPrazo, proximoAcompanhamentoEm: novoProximoAcompanhamento,
      politicaPrazoSlaVersaoId: versao.id,
    },
  })

  const chave = `PRAZO_RECONCILIADO::${tarefa.id}::v${payload.versaoNova}`
  await prisma.eventoPrazoSla.upsert({
    where: { chaveIdempotencia: chave },
    create: {
      tipo: "PRAZO_RECONCILIADO", tarefaId: tarefa.id, processoId: tarefa.processoId,
      politicaId: payload.politicaId, politicaVersaoId: versao.id, usuarioId: payload.publicadoPorId,
      valorAnterior: { dataPrazo: dataPrazoAntes, proximoAcompanhamentoEm: acompanhamentoAntes },
      valorNovo: { dataPrazo: novoDataPrazo, proximoAcompanhamentoEm: novoProximoAcompanhamento, estrategia: payload.estrategiaRetroacao },
      motivo: `Reconciliação da política — versão ${payload.versaoAnterior} → ${payload.versaoNova} (${payload.estrategiaRetroacao}).`,
      chaveIdempotencia: chave,
    },
    update: {},
  })
}
