// src/services/prazo-sla/tarefa-prazo-sla.ts
// ============================================================================
// AÇÕES SOBRE A TAREFA — vincular política, calcular prazo geral, iniciar/
// encerrar espera de terceiro, registrar/reprogramar acompanhamento,
// reprogramar prazo geral (restrito). Cada ação grava `EventoPrazoSla`
// (idempotente por chave) e nunca cria uma segunda Tarefa, nunca duplica
// obrigação — sempre a MESMA linha.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { calcularPrazoGeral, calcularAcompanhamento, type ParametrosContagemDias } from "@/lib/operacional/motor-prazo-sla"

type Falha = { success: false; code: string; message: string }
type Ok<T> = { success: true } & T

function contagemDe(v: { prazoUnidade: string; tratamentoFimDeSemana: string; tratamentoFeriado: string }): ParametrosContagemDias {
  return {
    unidade: v.prazoUnidade as "DIAS_CORRIDOS" | "DIAS_UTEIS",
    tratamentoFimDeSemana: v.tratamentoFimDeSemana as "PULA" | "CONTA",
    tratamentoFeriado: v.tratamentoFeriado as "PULA" | "CONTA",
  }
}

/**
 * VINCULA uma Tarefa a uma Política PUBLICADA e calcula o prazoDaTarefa
 * (`Tarefa.dataPrazo`) + o primeiro acompanhamento, a partir do evento
 * informado (`baseCalculoEm`). Recusa política RASCUNHO/INATIVA — nunca
 * aplica configuração que não está em vigor.
 */
export async function vincularPoliticaATarefa(input: {
  tarefaId: number
  politicaChave: string
  baseCalculoEm: Date
}): Promise<Ok<{ dataPrazo: Date | null; proximoAcompanhamentoEm: Date | null }> | Falha> {
  const politica = await prisma.politicaPrazoSla.findUnique({ where: { chave: input.politicaChave } })
  if (!politica || !politica.ativo) return { success: false, code: "POLITICA_INEXISTENTE", message: "Política de Prazo/SLA não encontrada." }
  if (politica.status !== "PUBLICADA") return { success: false, code: "POLITICA_NAO_PUBLICADA", message: "Esta política não tem versão publicada — não pode ser aplicada a uma tarefa nova." }

  const versao = await prisma.politicaPrazoSlaVersao.findUnique({ where: { politicaId_versao: { politicaId: politica.id, versao: politica.versaoAtual } } })
  if (!versao) return { success: false, code: "POLITICA_SEM_VERSAO", message: "Política sem versão publicada." }

  const tarefa = await prisma.tarefa.findUnique({ where: { id: input.tarefaId } })
  if (!tarefa) return { success: false, code: "TAREFA_INEXISTENTE", message: "Tarefa não encontrada." }

  const dataPrazo = calcularPrazoGeral(input.baseCalculoEm, {
    ...contagemDe(versao), quantidade: versao.prazoQuantidade, politicaDataNaoUtil: versao.politicaDataNaoUtil as "PROXIMO_DIA_UTIL" | "DIA_UTIL_ANTERIOR", horarioLimite: versao.horarioLimite,
  })
  const proximoAcompanhamentoEm = calcularAcompanhamento(input.baseCalculoEm, versao.acompanhamentoPrimeiroDias, {
    unidade: versao.acompanhamentoUnidade as "DIAS_CORRIDOS" | "DIAS_UTEIS", tratamentoFimDeSemana: versao.tratamentoFimDeSemana as "PULA" | "CONTA", tratamentoFeriado: versao.tratamentoFeriado as "PULA" | "CONTA",
  })

  await prisma.tarefa.update({
    where: { id: tarefa.id },
    data: {
      politicaPrazoSlaId: politica.id, politicaPrazoSlaVersaoId: versao.id,
      prazoBaseCalculoEm: input.baseCalculoEm, dataPrazo, proximoAcompanhamentoEm,
    },
  })
  await prisma.eventoPrazoSla.create({
    data: {
      tipo: "PRAZO_CALCULADO", tarefaId: tarefa.id, processoId: tarefa.processoId,
      politicaId: politica.id, politicaVersaoId: versao.id,
      valorNovo: { dataPrazo, proximoAcompanhamentoEm, baseCalculoEm: input.baseCalculoEm },
      chaveIdempotencia: `PRAZO_CALCULADO::${tarefa.id}::${input.baseCalculoEm.toISOString()}`,
    },
  }).catch(() => null)

  return { success: true, dataPrazo, proximoAcompanhamentoEm }
}

/**
 * ENTRAR EM AGUARDANDO_TERCEIRO — registra início da espera, terceiro,
 * motivo, calcula o próximo acompanhamento. NUNCA conclui a tarefa, nunca
 * avança processo, nunca cria outra tarefa (mandato, seção 7).
 */
export async function iniciarEsperaTerceiro(input: {
  tarefaId: number
  terceiroResponsavelId: number | null
  motivo: string
  agora: Date
  usuarioId: number | null
}): Promise<Ok<{ proximoAcompanhamentoEm: Date | null }> | Falha> {
  const tarefa = await prisma.tarefa.findUnique({ where: { id: input.tarefaId } })
  if (!tarefa) return { success: false, code: "TAREFA_INEXISTENTE", message: "Tarefa não encontrada." }
  if (tarefa.concluida) return { success: false, code: "TAREFA_CONCLUIDA", message: "Tarefa concluída não pode entrar em espera." }
  if (!input.motivo || !input.motivo.trim()) return { success: false, code: "MOTIVO_OBRIGATORIO", message: "Informe o motivo da espera." }

  let proximoAcompanhamentoEm: Date | null = null
  if (tarefa.politicaPrazoSlaVersaoId) {
    const versao = await prisma.politicaPrazoSlaVersao.findUnique({ where: { id: tarefa.politicaPrazoSlaVersaoId } })
    if (versao) {
      proximoAcompanhamentoEm = calcularAcompanhamento(input.agora, versao.acompanhamentoPrimeiroDias, {
        unidade: versao.acompanhamentoUnidade as "DIAS_CORRIDOS" | "DIAS_UTEIS", tratamentoFimDeSemana: versao.tratamentoFimDeSemana as "PULA" | "CONTA", tratamentoFeriado: versao.tratamentoFeriado as "PULA" | "CONTA",
      })
    }
  }

  // NUNCA escreve `statusTarefa` — dono único é `task-step-sync.ts`
  // (`scripts/guard-maquina-passo-unica.test.ts`, zero exceções). A espera
  // DESTE módulo é representada só pelos campos próprios (`aguardandoDesde`/
  // `origemDaEspera`/`terceiroResponsavelId`), uma camada paralela — nunca
  // um segundo dono da mesma máquina de estado operacional.
  await prisma.tarefa.update({
    where: { id: tarefa.id },
    data: {
      aguardandoDesde: input.agora, origemDaEspera: "TERCEIRO", terceiroResponsavelId: input.terceiroResponsavelId,
      proximoAcompanhamentoEm,
      // prazoDaTarefa (dataPrazo) PERMANECE — espera nunca altera o prazo geral.
    },
  })
  await prisma.eventoPrazoSla.create({
    data: {
      tipo: "ESPERA_TERCEIRO_INICIADA", tarefaId: tarefa.id, processoId: tarefa.processoId, usuarioId: input.usuarioId,
      valorNovo: { terceiroResponsavelId: input.terceiroResponsavelId, proximoAcompanhamentoEm },
      motivo: input.motivo,
      chaveIdempotencia: `ESPERA_TERCEIRO_INICIADA::${tarefa.id}::${input.agora.toISOString()}`,
    },
  }).catch(() => null)

  return { success: true, proximoAcompanhamentoEm }
}

/** ENCERRAR a espera — o prazo geral continua exatamente o que já era. */
export async function encerrarEsperaTerceiro(input: { tarefaId: number; agora: Date; usuarioId: number | null }): Promise<Ok<{}> | Falha> {
  const tarefa = await prisma.tarefa.findUnique({ where: { id: input.tarefaId } })
  if (!tarefa) return { success: false, code: "TAREFA_INEXISTENTE", message: "Tarefa não encontrada." }

  // Mesma régua acima: nunca escreve `statusTarefa` — só os campos próprios
  // deste módulo voltam a `null`.
  await prisma.tarefa.update({
    where: { id: tarefa.id },
    data: { aguardandoDesde: null, origemDaEspera: null, terceiroResponsavelId: null },
  })
  await prisma.eventoPrazoSla.create({
    data: {
      tipo: "ESPERA_ENCERRADA", tarefaId: tarefa.id, processoId: tarefa.processoId, usuarioId: input.usuarioId,
      valorAnterior: { dataPrazo: tarefa.dataPrazo }, valorNovo: { dataPrazo: tarefa.dataPrazo },
      chaveIdempotencia: `ESPERA_ENCERRADA::${tarefa.id}::${input.agora.toISOString()}`,
    },
  }).catch(() => null)
  return { success: true }
}

/** REPROGRAMAR o próximo acompanhamento — exige motivo quando a política exigir. */
export async function reprogramarAcompanhamento(input: {
  tarefaId: number; novaData: Date; motivo: string; usuarioId: number | null; agora: Date
}): Promise<Ok<{}> | Falha> {
  const tarefa = await prisma.tarefa.findUnique({ where: { id: input.tarefaId } })
  if (!tarefa) return { success: false, code: "TAREFA_INEXISTENTE", message: "Tarefa não encontrada." }

  let exigeMotivo = true
  if (tarefa.politicaPrazoSlaVersaoId) {
    const versao = await prisma.politicaPrazoSlaVersao.findUnique({ where: { id: tarefa.politicaPrazoSlaVersaoId }, select: { acompanhamentoExigeMotivo: true, acompanhamentoPermiteManual: true } })
    if (versao && versao.acompanhamentoPermiteManual === false) return { success: false, code: "REPROGRAMACAO_MANUAL_NAO_PERMITIDA", message: "A política não permite definir manualmente a próxima data." }
    if (versao) exigeMotivo = versao.acompanhamentoExigeMotivo
  }
  if (exigeMotivo && (!input.motivo || !input.motivo.trim())) return { success: false, code: "MOTIVO_OBRIGATORIO", message: "Informe o motivo da reprogramação." }

  const estadoAnterior = tarefa.proximoAcompanhamentoEm
  await prisma.tarefa.update({ where: { id: tarefa.id }, data: { proximoAcompanhamentoEm: input.novaData } })
  await prisma.eventoPrazoSla.create({
    data: {
      tipo: "ACOMPANHAMENTO_REPROGRAMADO", tarefaId: tarefa.id, processoId: tarefa.processoId, usuarioId: input.usuarioId,
      valorAnterior: { proximoAcompanhamentoEm: estadoAnterior }, valorNovo: { proximoAcompanhamentoEm: input.novaData },
      motivo: input.motivo || null,
      chaveIdempotencia: `ACOMPANHAMENTO_REPROGRAMADO::${tarefa.id}::${input.agora.toISOString()}`,
    },
  }).catch(() => null)
  return { success: true }
}

/**
 * REPROGRAMAR O PRAZO GERAL — restrito (permissão administrativa verificada
 * pelo CHAMADOR/rota; aqui só exige a justificativa e grava a auditoria).
 */
export async function reprogramarPrazoGeral(input: {
  tarefaId: number; novoPrazo: Date; justificativa: string; usuarioId: number | null; agora: Date
}): Promise<Ok<{}> | Falha> {
  const tarefa = await prisma.tarefa.findUnique({ where: { id: input.tarefaId } })
  if (!tarefa) return { success: false, code: "TAREFA_INEXISTENTE", message: "Tarefa não encontrada." }
  if (!input.justificativa || !input.justificativa.trim()) return { success: false, code: "JUSTIFICATIVA_OBRIGATORIA", message: "A reprogramação do prazo geral exige justificativa." }

  const anterior = tarefa.dataPrazo
  await prisma.tarefa.update({ where: { id: tarefa.id }, data: { dataPrazo: input.novoPrazo } })
  await prisma.eventoPrazoSla.create({
    data: {
      tipo: "PRAZO_REPROGRAMADO", tarefaId: tarefa.id, processoId: tarefa.processoId, usuarioId: input.usuarioId,
      valorAnterior: { dataPrazo: anterior }, valorNovo: { dataPrazo: input.novoPrazo },
      motivo: input.justificativa,
      chaveIdempotencia: `PRAZO_REPROGRAMADO::${tarefa.id}::${input.agora.toISOString()}`,
    },
  }).catch(() => null)
  return { success: true }
}
