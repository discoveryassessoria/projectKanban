// src/services/registral/lote.ts
//
// MRG — LOTE DOCUMENTAL (requisitos 1 e 17).
//
// Recebe a Pasta Documental de um processo (1, 20, 100 ou mais certidões) e a
// processa como um CONJUNTO coerente:
//   · cada documento passa pelo pipeline (idempotente, com retry/backoff);
//   · terminado o pipeline de todos, roda a RECONSTRUÇÃO CRUZADA, que é o que
//     transforma documentos isolados numa árvore (mesma pessoa em documentos
//     diferentes, filiação cruzada, hipóteses confrontadas);
//   · o que é inequívoco é aplicado; o resto vira proposta/conflito.
//
// Resiliência: claim atômico por execução (dois workers não processam o mesmo
// documento), tentativas controladas, backoff exponencial, retomada, cancelamento
// e progresso consultável. Nada disso é opcional numa função serverless que pode
// morrer no meio.

import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { chaveExecucao, chaveLote, correlationId as montarCorrelation } from "@/src/lib/genealogia/registral/chaves"
import { metricasDoLote } from "@/src/lib/genealogia/registral/metricas"
import { itemCatalogosDeCertidao } from "@/src/lib/documentos/natureza-certidao"
import { auditar, logRegistral, publicarEvento, registrarMetricas } from "./auditoria"
import {
  ACOES_AUDITORIA,
  CLAIM_STALE_MS,
  EVENTOS,
  LOTE_PADRAO_POR_CICLO,
  MAX_TENTATIVAS_EXECUCAO,
  VERSAO_MOTOR,
} from "./constantes"
import { processarExecucao } from "./pipeline"
import { reconstruirDoLote } from "./reconstrucao"
import { reconciliarDocumentalDoProcesso } from "./reconciliacao-documental"
import { aplicarProposta } from "./aplicar"

export interface ResumoLote {
  loteId: number
  criado: boolean
  status: string
  totalDocumentos: number
  processados: number
  falhos: number
  aguardando: number
  propostasCriadas: number
  conflitosAbertos: number
  evidenciasCriadas: number
  correlationId: string
}

/**
 * Cria (ou recupera) o lote de uma pasta documental.
 *
 * IDEMPOTENTE: a chave é (processo, conjunto de documentos, versão do motor).
 * Clicar duas vezes em "processar pasta" devolve o MESMO lote — não dispara dois.
 */
export async function criarLote(p: {
  processoId: number
  /** Quando omitido, usa todas as CERTIDÕES da pasta do processo. */
  documentoIds?: number[]
  usuarioId?: number | null
  instante?: number
}): Promise<ResumoLote> {
  const instante = p.instante ?? Date.now()

  const processo = await prisma.processo.findUnique({
    where: { id: p.processoId },
    select: { id: true, arvoreId: true },
  })
  if (!processo) throw new Error(`Processo ${p.processoId} não encontrado`)

  const documentoIds = p.documentoIds?.length
    ? await filtrarDocumentosDoProcesso(p.processoId, processo.arvoreId, p.documentoIds)
    : await documentosDaPasta(p.processoId, processo.arvoreId)

  if (!documentoIds.length) {
    throw new Error(
      "Nenhuma certidão elegível encontrada na Pasta Documental deste processo. O motor registral trabalha com certidões (natureza estruturada do Sistema Documental).",
    )
  }

  const chave = chaveLote({ processoId: p.processoId, documentoIds, versaoMotor: VERSAO_MOTOR })
  const existente = await prisma.loteRegistral.findUnique({
    where: { chaveIdempotencia: chave },
    select: {
      id: true,
      status: true,
      totalDocumentos: true,
      processados: true,
      falhos: true,
      aguardando: true,
      propostasCriadas: true,
      conflitosAbertos: true,
      evidenciasCriadas: true,
      correlationId: true,
    },
  })
  if (existente) {
    return { ...existente, loteId: existente.id, criado: false }
  }

  const correlationId = montarCorrelation({
    prefixo: "mrg-lote",
    processoId: p.processoId,
    referencia: documentoIds.length,
    instante,
  })

  const lote = await prisma.$transaction(async (tx) => {
    const criado = await tx.loteRegistral.create({
      data: {
        processoId: p.processoId,
        arvoreId: processo.arvoreId,
        status: "RECEBIDO",
        correlationId,
        versaoMotor: VERSAO_MOTOR,
        totalDocumentos: documentoIds.length,
        aguardando: documentoIds.length,
        criadoPorId: p.usuarioId ?? null,
        chaveIdempotencia: chave,
      },
      select: { id: true },
    })

    for (const documentoId of documentoIds) {
      const doc = await tx.documento.findUnique({
        where: { id: documentoId },
        select: { necessidadeId: true },
      })
      await tx.execucaoRegistral.create({
        data: {
          loteId: criado.id,
          documentoId,
          necessidadeId: doc?.necessidadeId ?? null,
          etapa: "RECEBIDO",
          versaoExtrator: VERSAO_MOTOR,
          correlationId,
          chaveIdempotencia: chaveExecucao({ loteId: criado.id, documentoId }),
        },
      })
    }

    await publicarEvento(tx, {
      tipo: EVENTOS.LOTE_CRIADO,
      aggregateType: "LoteRegistral",
      aggregateId: criado.id,
      payload: { loteId: criado.id, processoId: p.processoId, documentos: documentoIds.length },
      correlationId,
      chaveIdempotencia: `mrg:evt:lote:${criado.id}`,
    })

    return criado
  })

  await auditar(prisma, {
    acao: ACOES_AUDITORIA.LOTE_CRIADO,
    entidade: "LoteRegistral",
    entidadeId: lote.id,
    descricao: `Lote registral criado com ${documentoIds.length} certidão(ões) da Pasta Documental do processo ${p.processoId}.`,
    detalhes: { documentos: documentoIds.length, versaoMotor: VERSAO_MOTOR },
    usuarioId: p.usuarioId ?? null,
    correlationId,
  })

  return {
    loteId: lote.id,
    criado: true,
    status: "RECEBIDO",
    totalDocumentos: documentoIds.length,
    processados: 0,
    falhos: 0,
    aguardando: documentoIds.length,
    propostasCriadas: 0,
    conflitosAbertos: 0,
    evidenciasCriadas: 0,
    correlationId,
  }
}

/** Certidões da Pasta Documental do processo (natureza estruturada = certidão). */
async function documentosDaPasta(processoId: number, arvoreId: number | null): Promise<number[]> {
  const certidoes = await itemCatalogosDeCertidao(prisma)

  const docs = await prisma.documento.findMany({
    where: {
      OR: [
        { necessidade: { processoId } },
        ...(arvoreId != null ? [{ pessoa: { arvoreId } }] : []),
      ],
    },
    select: {
      id: true,
      documentType: { select: { itemCatalogoId: true, nature: true } },
      tipo: true,
    },
    orderBy: { id: "asc" },
  })

  return docs
    .filter((d) => {
      const itemId = d.documentType?.itemCatalogoId
      if (itemId != null && certidoes.has(itemId)) return true
      // Retrocompatibilidade: documento legado sem TipoDocumentoCadastro ligado.
      // O critério continua estruturado (enum TipoDocumento), nunca texto livre.
      return d.documentType == null && typeof d.tipo === "string" && d.tipo.startsWith("CERTIDAO")
    })
    .map((d) => d.id)
}

/** Garante que os documentos pedidos pertencem à pasta do processo. */
async function filtrarDocumentosDoProcesso(
  processoId: number,
  arvoreId: number | null,
  ids: number[],
): Promise<number[]> {
  const validos = await prisma.documento.findMany({
    where: {
      id: { in: ids },
      OR: [{ necessidade: { processoId } }, ...(arvoreId != null ? [{ pessoa: { arvoreId } }] : [])],
    },
    select: { id: true },
    orderBy: { id: "asc" },
  })
  return validos.map((d) => d.id)
}

export interface ResultadoProcessamento {
  loteId: number
  status: string
  processadosNesteCiclo: number
  restantes: number
  falhos: number
  conflitosAbertos: number
  propostasCriadas: number
  propostasAplicadasAutomaticamente: number
  concluido: boolean
}

/**
 * Drena o lote. Chamável repetidamente (worker/cron/rota) — cada chamada
 * processa até `limite` documentos e devolve quanto falta.
 */
export async function processarLote(p: {
  loteId: number
  limite?: number
  /** Ator que aplica as propostas automáticas (o motor). */
  usuarioId?: number | null
}): Promise<ResultadoProcessamento> {
  const limite = p.limite ?? LOTE_PADRAO_POR_CICLO
  const inicio = Date.now()

  const lote = await prisma.loteRegistral.findUnique({
    where: { id: p.loteId },
    select: { id: true, processoId: true, arvoreId: true, status: true, correlationId: true, totalDocumentos: true },
  })
  if (!lote) throw new Error(`Lote registral ${p.loteId} não encontrado`)
  if (lote.status === "CANCELADO") {
    return {
      loteId: lote.id,
      status: lote.status,
      processadosNesteCiclo: 0,
      restantes: 0,
      falhos: 0,
      conflitosAbertos: 0,
      propostasCriadas: 0,
      propostasAplicadasAutomaticamente: 0,
      concluido: true,
    }
  }

  await prisma.loteRegistral.update({
    where: { id: lote.id },
    data: { status: "EM_PROCESSAMENTO", iniciadoEm: { set: new Date() } },
  })

  // ---- seleção + CLAIM ATÔMICO
  const agora = new Date()
  const staleAntes = new Date(Date.now() - CLAIM_STALE_MS)
  const pendentes = await prisma.execucaoRegistral.findMany({
    where: {
      loteId: lote.id,
      etapa: { in: ["RECEBIDO", "REPROCESSAMENTO"] },
      tentativas: { lt: MAX_TENTATIVAS_EXECUCAO },
      OR: [{ proximaEm: null }, { proximaEm: { lte: agora } }],
    },
    orderBy: { id: "asc" },
    take: limite,
    select: { id: true },
  })

  let processadosNesteCiclo = 0
  let camposExtraidos = 0
  let camposDivergentes = 0
  let evidencias = 0
  let conflitos = 0
  let propostas = 0
  let propostasAutomaticas = 0
  let falhosNesteCiclo = 0

  for (const e of pendentes) {
    // O CLAIM tem de olhar a ETAPA, não só a reserva. Sem isso, um worker que
    // selecionou a lista antes de outro terminar reivindica uma execução JÁ
    // CONCLUÍDA (que liberou `reservadoEm` no fim) e processa o mesmo documento
    // duas vezes — foi o defeito que o teste de concorrência flagrou.
    const claim = await prisma.execucaoRegistral.updateMany({
      where: {
        id: e.id,
        etapa: { in: ["RECEBIDO", "REPROCESSAMENTO"] },
        OR: [{ reservadoEm: null }, { reservadoEm: { lt: staleAntes } }],
      },
      data: { reservadoEm: new Date() },
    })
    // Outro worker pegou este documento: seguir em frente, sem processar duas vezes.
    if (claim.count !== 1) continue

    const r = await processarExecucao(e.id)
    processadosNesteCiclo++
    camposExtraidos += r.camposExtraidos
    camposDivergentes += r.camposDivergentes
    evidencias += r.evidencias
    conflitos += r.conflitos
    propostas += r.propostas
    propostasAutomaticas += r.propostasAutomaticas
    if (r.erro) falhosNesteCiclo++
  }

  // ---- contadores reais (recontados do banco, não acumulados na memória)
  const contagens = await recontar(lote.id)

  const restantes = await prisma.execucaoRegistral.count({
    where: {
      loteId: lote.id,
      etapa: { in: ["RECEBIDO", "REPROCESSAMENTO"] },
      tentativas: { lt: MAX_TENTATIVAS_EXECUCAO },
    },
  })

  let propostasAplicadas = 0
  let concluido = false

  if (restantes === 0) {
    // ---- RECONSTRUÇÃO CRUZADA: o lote como conjunto, não documento por documento.
    const recon = await reconstruirDoLote({ loteId: lote.id, usuarioId: p.usuarioId ?? null })
    propostas += recon.propostasCriadas

    // ---- aplicação do que é INEQUÍVOCO (matriz de automação decide, não este código)
    propostasAplicadas = await aplicarAutomaticas(lote.id)

    // ---- reconciliação documental (Sistema Documental é quem decide status)
    const docs = await reconciliarDocumentalDoProcesso({
      processoId: lote.processoId,
      loteId: lote.id,
      usuarioId: p.usuarioId ?? null,
    })

    const finais = await recontar(lote.id)
    const status = finais.falhos > 0 ? "CONCLUIDO_COM_FALHAS" : finais.aguardandoRevisao > 0 ? "AGUARDANDO_REVISAO" : "CONCLUIDO"

    await prisma.loteRegistral.update({
      where: { id: lote.id },
      data: {
        status,
        finalizadoEm: new Date(),
        processados: finais.processados,
        falhos: finais.falhos,
        aguardando: finais.aguardandoRevisao,
        evidenciasCriadas: finais.evidencias,
        propostasCriadas: finais.propostas,
        conflitosAbertos: finais.conflitos,
        pessoasCriadas: recon.pessoasCriadas,
        vinculosCriados: recon.vinculosCriados,
        resumo: [
          `${finais.processados}/${lote.totalDocumentos} documento(s) processado(s)`,
          `${finais.evidencias} evidência(s)`,
          `${finais.propostas} proposta(s)`,
          `${propostasAplicadas} aplicada(s) automaticamente`,
          `${finais.conflitos} conflito(s) aberto(s)`,
          `${docs.necessidadesAtendidas} necessidade(s) reconciliada(s)`,
        ].join(" · "),
        metricas: {
          camposExtraidos,
          camposDivergentes,
          duracaoUltimoCicloMs: Date.now() - inicio,
          reconstrucao: recon.resumo,
          documental: docs,
        } as unknown as Prisma.InputJsonValue,
      },
    })

    await publicarEvento(prisma, {
      tipo: EVENTOS.LOTE_CONCLUIDO,
      aggregateType: "LoteRegistral",
      aggregateId: lote.id,
      payload: { loteId: lote.id, processoId: lote.processoId, status },
      correlationId: lote.correlationId,
      chaveIdempotencia: `mrg:evt:lote-fim:${lote.id}`,
    })

    concluido = true

    await registrarMetricas(
      prisma,
      metricasDoLote({
        processoId: lote.processoId,
        totalDocumentos: lote.totalDocumentos,
        processados: finais.processados,
        falhos: finais.falhos,
        camposExtraidos,
        camposDivergentes,
        conflitosAbertos: finais.conflitos,
        propostasCriadas: finais.propostas,
        propostasAutomaticas: propostasAplicadas,
        evidenciasCriadas: finais.evidencias,
        pessoasCriadas: recon.pessoasCriadas,
        vinculosCriados: recon.vinculosCriados,
        duplicidadesEvitadas: recon.duplicidadesEvitadas,
        duracaoMs: Date.now() - inicio,
      }),
      new Date(),
    )
  } else {
    await prisma.loteRegistral.update({
      where: { id: lote.id },
      data: {
        processados: contagens.processados,
        falhos: contagens.falhos,
        aguardando: contagens.aguardandoRevisao,
        evidenciasCriadas: contagens.evidencias,
        propostasCriadas: contagens.propostas,
        conflitosAbertos: contagens.conflitos,
      },
    })
  }

  logRegistral("info", "lote_ciclo", {
    loteId: lote.id,
    processadosNesteCiclo,
    restantes,
    falhosNesteCiclo,
    concluido,
    duracaoMs: Date.now() - inicio,
  })

  const atual = await prisma.loteRegistral.findUnique({ where: { id: lote.id }, select: { status: true } })

  return {
    loteId: lote.id,
    status: atual?.status ?? "EM_PROCESSAMENTO",
    processadosNesteCiclo,
    restantes,
    falhos: contagens.falhos,
    conflitosAbertos: contagens.conflitos,
    propostasCriadas: contagens.propostas,
    propostasAplicadasAutomaticamente: propostasAplicadas,
    concluido,
  }
}

interface Contagens {
  processados: number
  falhos: number
  aguardandoRevisao: number
  evidencias: number
  propostas: number
  conflitos: number
}

async function recontar(loteId: number): Promise<Contagens> {
  const [porEtapa, evidencias, propostas, conflitos] = await Promise.all([
    prisma.execucaoRegistral.groupBy({ by: ["etapa"], where: { loteId }, _count: { _all: true } }),
    prisma.evidenciaRegistral.count({ where: { execucao: { loteId } } }),
    prisma.propostaReconciliacao.count({ where: { loteId } }),
    prisma.conflitoRegistral.count({ where: { loteId, status: { in: ["ABERTO", "EM_REVISAO"] } } }),
  ])
  const conta = (etapas: string[]) =>
    porEtapa.filter((x) => etapas.includes(x.etapa)).reduce((s, x) => s + x._count._all, 0)

  return {
    processados: conta(["APLICADO", "AUDITADO", "AGUARDANDO_REVISAO"]),
    falhos: conta(["FALHA_LEITURA", "DOCUMENTO_INSUFICIENTE", "DOCUMENTO_CONFLITANTE"]),
    aguardandoRevisao: conta(["AGUARDANDO_REVISAO"]),
    evidencias,
    propostas,
    conflitos,
  }
}

/**
 * Aplica as propostas que a matriz classificou como AUTOMATICA. O ator é o
 * MOTOR: ele nunca aplica bloqueio nem aprovação humana — `aplicarProposta`
 * recusa, e a recusa é registrada.
 */
async function aplicarAutomaticas(loteId: number): Promise<number> {
  const candidatas = await prisma.propostaReconciliacao.findMany({
    where: { loteId, status: "PENDENTE", aplicavelAutomaticamente: true, criticidade: "AUTOMATICA" },
    select: { id: true },
    orderBy: { id: "asc" },
  })
  let aplicadas = 0
  for (const c of candidatas) {
    const r = await aplicarProposta({
      propostaId: c.id,
      ator: { usuarioId: null, permissoes: {}, ehMotor: true },
      motivo: "Aplicação automática: operação classificada como inequívoca pela matriz de automação.",
    })
    if (r.ok) aplicadas++
  }
  return aplicadas
}

/** Cancela o lote (execuções pendentes vão para CANCELADO; nada é apagado). */
export async function cancelarLote(p: {
  loteId: number
  usuarioId?: number | null
  motivo: string
}): Promise<{ canceladas: number }> {
  const pendentes = await prisma.execucaoRegistral.findMany({
    where: { loteId: p.loteId, etapa: { in: ["RECEBIDO", "REPROCESSAMENTO"] } },
    select: { id: true },
  })
  for (const e of pendentes) {
    await prisma.etapaExecucaoRegistral.create({
      data: { execucaoId: e.id, etapa: "CANCELADO", ok: false, mensagem: p.motivo.slice(0, 500) },
    })
  }
  await prisma.execucaoRegistral.updateMany({
    where: { loteId: p.loteId, etapa: { in: ["RECEBIDO", "REPROCESSAMENTO"] } },
    data: { etapa: "CANCELADO", reservadoEm: null, finalizadoEm: new Date() },
  })
  await prisma.loteRegistral.update({
    where: { id: p.loteId },
    data: { status: "CANCELADO", finalizadoEm: new Date() },
  })
  await auditar(prisma, {
    acao: ACOES_AUDITORIA.LOTE_CRIADO,
    entidade: "LoteRegistral",
    entidadeId: p.loteId,
    descricao: `Lote cancelado: ${p.motivo}`,
    detalhes: { canceladas: pendentes.length },
    usuarioId: p.usuarioId ?? null,
  })
  return { canceladas: pendentes.length }
}

/**
 * REPROCESSAMENTO de um documento. Cria um lote NOVO só com ele — o lote antigo
 * e seu histórico permanecem intactos. As evidências antigas continuam válidas;
 * as novas são idempotentes por (documento, campo, valor, método), então
 * reprocessar não duplica.
 */
export async function reprocessarDocumento(p: {
  documentoId: number
  processoId: number
  usuarioId?: number | null
  instante?: number
}): Promise<ResumoLote> {
  const lote = await criarLote({
    processoId: p.processoId,
    documentoIds: [p.documentoId],
    usuarioId: p.usuarioId,
    instante: p.instante,
  })
  // Lote já existente (mesma chave): destrava as execuções para nova passagem.
  if (!lote.criado) {
    await prisma.execucaoRegistral.updateMany({
      where: { loteId: lote.loteId, documentoId: p.documentoId },
      data: { etapa: "REPROCESSAMENTO", reservadoEm: null, proximaEm: null, erro: null },
    })
    await prisma.loteRegistral.update({
      where: { id: lote.loteId },
      data: { status: "EM_PROCESSAMENTO", finalizadoEm: null },
    })
  }
  return lote
}

/** Progresso consultável do lote (para a rota de status). */
export async function progressoLote(loteId: number) {
  const lote = await prisma.loteRegistral.findUnique({
    where: { id: loteId },
    select: {
      id: true,
      processoId: true,
      arvoreId: true,
      status: true,
      correlationId: true,
      versaoMotor: true,
      totalDocumentos: true,
      processados: true,
      falhos: true,
      aguardando: true,
      pessoasCriadas: true,
      vinculosCriados: true,
      evidenciasCriadas: true,
      propostasCriadas: true,
      conflitosAbertos: true,
      resumo: true,
      metricas: true,
      criadoEm: true,
      iniciadoEm: true,
      finalizadoEm: true,
      execucoes: {
        select: {
          id: true,
          documentoId: true,
          etapa: true,
          tipoDetectado: true,
          confiancaTipo: true,
          tentativas: true,
          erro: true,
          ocorrenciasDetectadas: true,
          camposExtraidos: true,
          camposDivergentes: true,
          evidenciasCriadas: true,
          finalizadoEm: true,
        },
        orderBy: { id: "asc" },
      },
    },
  })
  if (!lote) return null

  const porEtapa = await prisma.execucaoRegistral.groupBy({
    by: ["etapa"],
    where: { loteId },
    _count: { _all: true },
  })

  return {
    ...lote,
    distribuicaoEtapas: porEtapa.map((x) => ({ etapa: x.etapa, quantidade: x._count._all })),
    percentual:
      lote.totalDocumentos > 0
        ? Math.round(((lote.processados + lote.falhos) / lote.totalDocumentos) * 100)
        : 0,
  }
}
