// src/services/prazo-sla/politica-prazo-sla.ts
// ============================================================================
// CICLO DE VIDA DA POLÍTICA DE PRAZO/SLA — Gerenciamento como fonte única.
// Cadastro (RASCUNHO) → publicação (congela PoliticaPrazoSlaVersao, mesmo
// padrão de CatalogoFaseRevisao/MacroWorkflowVersao) → reconciliação
// retroativa das tarefas em andamento atingidas, pela estratégia escolhida
// EXPLICITAMENTE na publicação (REGRA MASTER: nunca escolhida em silêncio).
//
// A reconciliação em si (o EFEITO) é assíncrona via DomainOutbox — publicar
// só ENFILEIRA, o outbox-dispatcher processa um por vez, idempotente.
// ============================================================================
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

export const TIPO_OUTBOX_RECONCILIACAO_PRAZO_SLA = "prazo.sla.reconciliar"

export interface ParametrosVersaoInput {
  prazoQuantidade: number
  prazoUnidade: "DIAS_CORRIDOS" | "DIAS_UTEIS"
  prazoEventoInicialChave: string
  calendarioChave?: string | null
  tratamentoFimDeSemana: "PULA" | "CONTA"
  tratamentoFeriado: "PULA" | "CONTA"
  horarioLimite?: string | null
  politicaDataNaoUtil: "PROXIMO_DIA_UTIL" | "DIA_UTIL_ANTERIOR"
  riscoAntecedenciaDias: number
  escalonamentoAtivo?: boolean
  escalonamentoPapel?: string | null
  escalonamentoDestinatarioId?: number | null
  lembreteAtrasoRecorrenciaDias?: number | null
  acompanhamentoPrimeiroDias: number
  acompanhamentoPadraoDias: number
  acompanhamentoUnidade: "DIAS_CORRIDOS" | "DIAS_UTEIS"
  acompanhamentoPermiteManual?: boolean
  acompanhamentoExigeMotivo?: boolean
  acompanhamentoLimiteSemResposta?: number | null
  acompanhamentoEscalonamentoPapel?: string | null
  esperaTerceiroPadraoAtivo?: boolean
}

export type ValidacaoErro = { campo: string; codigo: string; mensagem: string }

/** Validação da publicação — nunca publica configuração incompleta/inválida. */
export function validarParametrosVersao(p: ParametrosVersaoInput): ValidacaoErro[] {
  const erros: ValidacaoErro[] = []
  if (!Number.isFinite(p.prazoQuantidade) || p.prazoQuantidade <= 0) {
    erros.push({ campo: "prazoQuantidade", codigo: "PRAZO_INVALIDO", mensagem: "O prazo geral deve ser maior que zero." })
  }
  if (!p.prazoUnidade) erros.push({ campo: "prazoUnidade", codigo: "UNIDADE_INEXISTENTE", mensagem: "Informe a unidade do prazo (dias corridos ou úteis)." })
  if (!p.prazoEventoInicialChave || !p.prazoEventoInicialChave.trim()) {
    erros.push({ campo: "prazoEventoInicialChave", codigo: "EVENTO_INICIAL_AUSENTE", mensagem: "Informe o evento inicial que dispara a contagem do prazo." })
  }
  if (!Number.isFinite(p.acompanhamentoPrimeiroDias) || p.acompanhamentoPrimeiroDias <= 0) {
    erros.push({ campo: "acompanhamentoPrimeiroDias", codigo: "ACOMPANHAMENTO_INVALIDO", mensagem: "O primeiro acompanhamento deve ser maior que zero." })
  }
  if (!Number.isFinite(p.acompanhamentoPadraoDias) || p.acompanhamentoPadraoDias <= 0) {
    erros.push({ campo: "acompanhamentoPadraoDias", codigo: "ACOMPANHAMENTO_INVALIDO", mensagem: "O acompanhamento padrão deve ser maior que zero." })
  }
  if (!p.acompanhamentoUnidade) erros.push({ campo: "acompanhamentoUnidade", codigo: "UNIDADE_INEXISTENTE", mensagem: "Informe a unidade do acompanhamento." })
  if (!Number.isFinite(p.riscoAntecedenciaDias) || p.riscoAntecedenciaDias < 0) {
    erros.push({ campo: "riscoAntecedenciaDias", codigo: "ANTECEDENCIA_INVALIDA", mensagem: "A antecedência de risco não pode ser negativa." })
  }
  return erros
}

/** PRÉVIA DE IMPACTO — chamada ANTES de publicar; a UI mostra isto e exige confirmação explícita para retroagir. */
export async function preverImpactoPublicacao(politicaId: number, estrategia: string) {
  const tarefas = await prisma.tarefa.findMany({
    where: {
      politicaPrazoSlaId: politicaId,
      concluida: false,
      statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA"] },
    },
    select: { id: true, titulo: true, processoId: true, dataPrazo: true, proximoAcompanhamentoEm: true },
    take: 200,
  })
  const totalAtingido = estrategia === "SOMENTE_NOVAS" ? 0 : tarefas.length
  return {
    estrategia,
    tarefasEmAndamentoVinculadas: tarefas.length,
    tarefasQueSeraoRetroagidas: totalAtingido,
    amostra: tarefas.slice(0, 10),
  }
}

/**
 * PUBLICAÇÃO — congela `PoliticaPrazoSlaVersao` (nunca sobrescreve versão
 * anterior), avança `versaoAtual`/`status`, e ENFILEIRA a reconciliação das
 * tarefas em andamento vinculadas (o efeito roda depois, pelo
 * outbox-dispatcher — publicar não pode depender de reconciliar milhares de
 * tarefas na mesma requisição).
 */
export async function publicarPoliticaPrazoSla(input: {
  politicaId: number
  parametros: ParametrosVersaoInput
  estrategiaRetroacao: "SOMENTE_NOVAS" | "RECALCULAR_DA_ORIGEM" | "APLICAR_DA_PUBLICACAO" | "MANTER_PRAZO_ATUALIZAR_ACOMPANHAMENTO"
  motivoAlteracao?: string | null
  publicadoPorId: number | null
}) {
  const erros = validarParametrosVersao(input.parametros)
  if (erros.length > 0) return { ok: false as const, erros }

  const politica = await prisma.politicaPrazoSla.findUnique({ where: { id: input.politicaId } })
  if (!politica) return { ok: false as const, erros: [{ campo: "politicaId", codigo: "POLITICA_INEXISTENTE", mensagem: "Política não encontrada." }] }

  const versaoNova = politica.versaoAtual + 1
  const p = input.parametros

  const resultado = await prisma.$transaction(async (tx) => {
    const versao = await tx.politicaPrazoSlaVersao.create({
      data: {
        politicaId: politica.id, versao: versaoNova,
        prazoQuantidade: p.prazoQuantidade, prazoUnidade: p.prazoUnidade,
        prazoEventoInicialChave: p.prazoEventoInicialChave, calendarioChave: p.calendarioChave ?? null,
        tratamentoFimDeSemana: p.tratamentoFimDeSemana, tratamentoFeriado: p.tratamentoFeriado,
        horarioLimite: p.horarioLimite ?? null, politicaDataNaoUtil: p.politicaDataNaoUtil,
        riscoAntecedenciaDias: p.riscoAntecedenciaDias,
        escalonamentoAtivo: p.escalonamentoAtivo ?? false, escalonamentoPapel: p.escalonamentoPapel ?? null,
        escalonamentoDestinatarioId: p.escalonamentoDestinatarioId ?? null,
        lembreteAtrasoRecorrenciaDias: p.lembreteAtrasoRecorrenciaDias ?? null,
        acompanhamentoPrimeiroDias: p.acompanhamentoPrimeiroDias, acompanhamentoPadraoDias: p.acompanhamentoPadraoDias,
        acompanhamentoUnidade: p.acompanhamentoUnidade,
        acompanhamentoPermiteManual: p.acompanhamentoPermiteManual ?? true,
        acompanhamentoExigeMotivo: p.acompanhamentoExigeMotivo ?? true,
        acompanhamentoLimiteSemResposta: p.acompanhamentoLimiteSemResposta ?? null,
        acompanhamentoEscalonamentoPapel: p.acompanhamentoEscalonamentoPapel ?? null,
        esperaTerceiroPadraoAtivo: p.esperaTerceiroPadraoAtivo ?? false,
        estrategiaRetroacao: input.estrategiaRetroacao, motivoAlteracao: input.motivoAlteracao ?? null,
        publicadoPorId: input.publicadoPorId,
      },
    })
    await tx.politicaPrazoSla.update({ where: { id: politica.id }, data: { status: "PUBLICADA", versaoAtual: versaoNova } })
    await tx.eventoPrazoSla.create({
      data: {
        tipo: "VERSAO_PUBLICADA", politicaId: politica.id, politicaVersaoId: versao.id, usuarioId: input.publicadoPorId,
        valorAnterior: { versao: politica.versaoAtual }, valorNovo: { versao: versaoNova, estrategiaRetroacao: input.estrategiaRetroacao },
        motivo: input.motivoAlteracao ?? null,
        chaveIdempotencia: `VERSAO_PUBLICADA::${politica.id}::v${versaoNova}`,
      },
    }).catch(() => null)
    return versao
  })

  const reconciliacao = await enqueueReconciliacaoPoliticaPrazoSla({
    politicaId: politica.id, versaoId: resultado.id, versaoAnterior: politica.versaoAtual, versaoNova,
    estrategiaRetroacao: input.estrategiaRetroacao, publicadoPorId: input.publicadoPorId,
  })

  return { ok: true as const, versao: resultado, reconciliacao }
}

export interface EnqueueReconciliacaoInput {
  politicaId: number
  versaoId: number
  versaoAnterior: number
  versaoNova: number
  estrategiaRetroacao: string
  publicadoPorId: number | null
  correlationId?: string
}

/**
 * ENFILEIRA a reconciliação — nunca a executa aqui. "Aplicar somente a novas
 * tarefas" não enfileira NADA: é a REGRA MASTER em ação (a política nova só
 * vale para o que nasce depois, tarefas existentes ficam como estavam).
 */
export async function enqueueReconciliacaoPoliticaPrazoSla(input: EnqueueReconciliacaoInput) {
  if (input.estrategiaRetroacao === "SOMENTE_NOVAS") {
    return { tarefasAlcancadas: 0, outboxRegistrados: 0 }
  }
  const tarefas = await prisma.tarefa.findMany({
    where: {
      politicaPrazoSlaId: input.politicaId,
      concluida: false,
      statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA"] },
    },
    select: { id: true },
  })
  if (tarefas.length === 0) return { tarefasAlcancadas: 0, outboxRegistrados: 0 }

  const linhas: Prisma.DomainOutboxCreateManyInput[] = tarefas.map((t) => ({
    tipo: TIPO_OUTBOX_RECONCILIACAO_PRAZO_SLA,
    aggregateType: "Tarefa",
    aggregateId: t.id,
    payload: {
      tarefaId: t.id, politicaId: input.politicaId, versaoId: input.versaoId,
      versaoAnterior: input.versaoAnterior, versaoNova: input.versaoNova,
      estrategiaRetroacao: input.estrategiaRetroacao, publicadoPorId: input.publicadoPorId,
    },
    correlationId: input.correlationId ?? null,
    chaveIdempotencia: `${TIPO_OUTBOX_RECONCILIACAO_PRAZO_SLA}::${t.id}::v${input.versaoNova}`,
    status: "PENDENTE",
  }))
  const resultado = await prisma.domainOutbox.createMany({ data: linhas, skipDuplicates: true })
  return { tarefasAlcancadas: tarefas.length, outboxRegistrados: resultado.count }
}
