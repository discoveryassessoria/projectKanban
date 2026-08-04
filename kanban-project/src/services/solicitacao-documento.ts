// src/services/solicitacao-documento.ts
//
// SOLICITAÇÃO DE CERTIDÃO — o ato, e tudo que nasce dele, num COMMIT só.
//
// O QUE ESTAVA ERRADO
// -------------------
// "Solicitar certidão" gravava em três lugares e nenhum era canônico:
//   • `Documento.protocolo` / `canal_solicitacao` / `cartorio`  (campos soltos);
//   • `Documento.link_acompanhamento`  ← a URL do REQUERIMENTO enviado acabava
//     aqui, num campo que significa "link de acompanhamento", e por isso o arquivo
//     não aparecia em aba nenhuma;
//   • `metadata.operacao` do passo (requestChannel, externalProtocol, …).
// Nenhum registro `Protocolo` era criado, nenhum vínculo documento↔protocolo, e a
// aba Protocolo do documento não tinha o que ler — daí o texto de pendência.
//
// FONTE ÚNICA AGORA
// -----------------
//   SolicitacaoDocumento  → o ato (canal, destinatário, envio, prazo, autoria).
//   Protocolo (+ ProtocoloDocumento) → o número devolvido pelo órgão. É o MESMO
//   cadastro que já existia; não nasce um segundo. Cada número informado é uma
//   LINHA NOVA ligada à solicitação — histórico, nunca sobrescrita.
//   DocumentoArquivo      → o requerimento e os comprovantes, com origem e autor.
//   DocumentoObservacao   → a observação do envio, append-only.
//
// Os campos antigos do Documento continuam sendo ESPELHADOS (não lidos) enquanto
// telas legadas os consomem: espelho de compatibilidade, não fonte.

import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import type { CanalSolicitacaoDocumento, TipoArquivoDocumento } from "@prisma/client"
import {
  carregarPassoAutorizado,
  aplicarTransicaoDoPassoTx,
  avancarFaseSeCouber,
  montarWorkflowV2,
  type ContextoLeituraWorkflow,
  type WorkflowV2Shape,
} from "@/src/services/documento-operacao"
import { canalDoTexto, faltamCamposDoCanal, configDoCanal } from "@/src/lib/process-stage/canais-solicitacao"
import {
  vincularArquivoDocumentoTx,
  registrarObservacaoDocumentoTx,
} from "@/src/services/documento-arquivos"

export { vincularArquivoDocumentoTx, registrarObservacaoDocumentoTx }

export type ResultadoSolicitacao =
  | { ok: true; solicitacaoId: number; protocoloId: number | null; arquivoId: number | null; workflow: WorkflowV2Shape | null }
  | { ok: false; error: string; status: number }

export interface EntradaSolicitacao {
  canal: string
  destinatarioNome?: string | null
  atendente?: string | null
  numeroProtocolo?: string | null
  observacao?: string | null
  prazoEsperadoDias?: number | null
  codigoRastreio?: string | null
  linkAcompanhamento?: string | null
  custoPago?: number | null
  formaPagamento?: string | null
  /** Requerimento enviado ao cartório — já subiu para o R2; aqui vira registro. */
  requerimento?: { url: string; nome?: string | null; mimeType?: string | null; tamanho?: number | null } | null
  /** Comprovantes adicionais do envio. */
  anexos?: Array<{ url: string; nome?: string | null; mimeType?: string | null; tamanho?: number | null; tipo?: TipoArquivoDocumento }> | null
  /** Concluir a etapa junto (o botão "Confirmar envio · concluir etapa"). */
  concluirEtapa?: boolean
}

function texto(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

function inteiro(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    if (Number.isFinite(n)) return Math.trunc(n)
  }
  return null
}

/** Nome de arquivo a partir da URL, quando o cliente não mandou. */
function nomeDaUrl(url: string): string {
  try {
    const p = new URL(url).pathname.split("/").pop()
    return decodeURIComponent(p || "arquivo")
  } catch {
    return url.split("/").pop() || "arquivo"
  }
}

/**
 * REGISTRA a solicitação de certidão e conclui a etapa — TUDO numa transação.
 *
 * Ordem, dentro do mesmo COMMIT: validar → solicitação → protocolo → arquivos →
 * observação → transição do passo (que arrasta tarefa, libera o próximo, emite
 * WorkflowEvento e trava a coerência passo↔tarefa). Qualquer falha derruba tudo:
 * não sobra arquivo órfão, protocolo sem solicitação nem etapa concluída pela metade.
 */
export async function registrarSolicitacaoDocumento(
  documentoId: number,
  stepInstanceId: number,
  entrada: EntradaSolicitacao,
  ctx: ContextoLeituraWorkflow,
): Promise<ResultadoSolicitacao> {
  // 1) canal — dimensão fechada; nada de string livre entrando no banco
  const canal = canalDoTexto(entrada.canal)
  if (!canal) return { ok: false, error: "VALIDATION_ERROR:CANAL_INVALIDO", status: 422 }

  // 2) passo + permissão da ação pretendida (o mesmo gate do resto do motor)
  const patchPasso: Record<string, unknown> = entrada.concluirEtapa ? { status: "concluida" } : {}
  const carregado = await carregarPassoAutorizado(documentoId, stepInstanceId, patchPasso, ctx)
  if (!carregado.ok) return carregado
  const passo = carregado.passo

  // 3) documento + processo + pessoa (e o vínculo entre eles — sem IDOR)
  const doc = await prisma.documento.findUnique({
    where: { id: documentoId },
    select: { id: true, pessoaId: true, cartorio: true },
  })
  if (!doc) return { ok: false, error: "STEP_NOT_FOUND", status: 404 }

  const destinatarioNome = texto(entrada.destinatarioNome) ?? texto(doc.cartorio)
  const numeroProtocolo = texto(entrada.numeroProtocolo)
  const requerimentoUrl = texto(entrada.requerimento?.url)
  const codigoRastreio = texto(entrada.codigoRastreio)
  const observacao = texto(entrada.observacao)

  // 4) campos obrigatórios POR CANAL — a mesma configuração que a tela recebeu
  const faltando = faltamCamposDoCanal({
    canal,
    numeroProtocolo,
    anexoUrl: requerimentoUrl,
    codigoRastreio,
    observacao,
    destinatarioNome,
  })
  if (faltando.length > 0) {
    return { ok: false, error: `VALIDATION_ERROR:${faltando.join(",")}`, status: 422 }
  }

  const agora = new Date()
  // IDEMPOTÊNCIA do ato: a mesma solicitação, no mesmo passo/ciclo, é UMA. Duplo
  // clique e retry caem na mesma chave e atualizam em vez de criar a segunda.
  const chave = `solicitacao:doc${documentoId}:step${stepInstanceId}:ciclo${passo.ciclo}`

  let solicitacaoId = 0
  let protocoloId: number | null = null
  let arquivoId: number | null = null
  let liberouProximo = false

  await prisma.$transaction(async (tx) => {
    // ── 4.1 SOLICITAÇÃO (cria ou atualiza — nunca duplica) ───────────────────
    const dadosSolicitacao = {
      documentoId,
      processoId: passo.processoId,
      pessoaId: doc.pessoaId,
      faseMacroKey: passo.faseMacroKey,
      workflowInstanceId: passo.workflowInstanceId,
      stepInstanceId: passo.id,
      canal,
      destinatarioNome,
      atendente: texto(entrada.atendente),
      dataEnvio: agora,
      prazoEsperadoDias: inteiro(entrada.prazoEsperadoDias),
      observacao,
      custoPago: entrada.custoPago != null ? new Prisma.Decimal(entrada.custoPago) : null,
      formaPagamento: texto(entrada.formaPagamento),
      linkAcompanhamento: texto(entrada.linkAcompanhamento),
      codigoRastreio,
      // O status é DERIVADO do que existe: com número, protocolada; sem número, a
      // solicitação fica explicitamente aguardando protocolo — estado legítimo, não erro.
      status: numeroProtocolo ? ("PROTOCOLADA" as const) : ("AGUARDANDO_PROTOCOLO" as const),
      criadoPorId: ctx.usuarioId,
    }

    const solicitacao = await tx.solicitacaoDocumento.upsert({
      where: { chaveIdempotencia: chave },
      create: { ...dadosSolicitacao, chaveIdempotencia: chave },
      update: {
        // Reenvio ATUALIZA o ato (o operador corrigiu algo antes de concluir);
        // o que NÃO se atualiza é a data de envio original nem a autoria.
        canal: dadosSolicitacao.canal,
        destinatarioNome: dadosSolicitacao.destinatarioNome,
        atendente: dadosSolicitacao.atendente,
        prazoEsperadoDias: dadosSolicitacao.prazoEsperadoDias,
        observacao: dadosSolicitacao.observacao,
        custoPago: dadosSolicitacao.custoPago,
        formaPagamento: dadosSolicitacao.formaPagamento,
        linkAcompanhamento: dadosSolicitacao.linkAcompanhamento,
        codigoRastreio: dadosSolicitacao.codigoRastreio,
        status: dadosSolicitacao.status,
      },
      select: { id: true },
    })
    solicitacaoId = solicitacao.id

    // A tarefa projetada do passo entra como referência (o passo pode ainda não
    // ter tarefa; nesse caso fica null e não se inventa vínculo).
    const tarefa = await tx.tarefa.findFirst({
      where: { workflowStepInstanceId: passo.id },
      select: { id: true },
      orderBy: { id: "asc" },
    })
    if (tarefa) {
      await tx.solicitacaoDocumento.update({ where: { id: solicitacaoId }, data: { tarefaId: tarefa.id } })
    }

    // ── 4.2 PROTOCOLO — MESMO cadastro, ligado à solicitação e ao documento ──
    if (numeroProtocolo) {
      protocoloId = await registrarProtocoloDaSolicitacaoTx(tx, {
        solicitacaoId,
        documentoId,
        processoId: passo.processoId,
        numeroProtocolo,
        canal,
        dataProtocolo: agora,
        responsavelId: ctx.usuarioId,
        observacoes: observacao,
      })
    }

    // ── 4.3 ARQUIVOS — o requerimento vira registro, com origem e autor ──────
    const arquivos: Array<{ url: string; nome: string; mimeType: string | null; tamanho: number | null; tipo: TipoArquivoDocumento }> = []
    if (requerimentoUrl) {
      arquivos.push({
        url: requerimentoUrl,
        nome: texto(entrada.requerimento?.nome) ?? nomeDaUrl(requerimentoUrl),
        mimeType: texto(entrada.requerimento?.mimeType),
        tamanho: inteiro(entrada.requerimento?.tamanho),
        tipo: "REQUERIMENTO_ENVIADO",
      })
    }
    for (const a of entrada.anexos ?? []) {
      const url = texto(a?.url)
      if (!url) continue
      arquivos.push({
        url,
        nome: texto(a?.nome) ?? nomeDaUrl(url),
        mimeType: texto(a?.mimeType),
        tamanho: inteiro(a?.tamanho),
        tipo: a?.tipo ?? "COMPROVANTE_PROTOCOLO",
      })
    }
    for (const a of arquivos) {
      const criado = await vincularArquivoDocumentoTx(tx, {
        documentoId,
        solicitacaoId,
        stepInstanceId: passo.id,
        criadoPorId: ctx.usuarioId,
        ...a,
      })
      if (a.tipo === "REQUERIMENTO_ENVIADO") arquivoId = criado
    }

    // ── 4.4 OBSERVAÇÃO — append-only, com autor e carimbo ────────────────────
    if (observacao) {
      await registrarObservacaoDocumentoTx(tx, {
        documentoId,
        solicitacaoId,
        stepInstanceId: passo.id,
        texto: observacao,
        criadoPorId: ctx.usuarioId,
      })
    }

    // ── 4.5 ESPELHO de compatibilidade nos campos antigos do Documento ───────
    // Escrita de ESPELHO, não de fonte: telas legadas ainda leem estes campos.
    // `link_acompanhamento` volta a significar o que o nome diz — o link de
    // acompanhamento — e deixa de ser o esconderijo da URL do requerimento.
    await tx.documento.update({
      where: { id: documentoId },
      data: {
        canal_solicitacao: canal.toLowerCase(),
        protocolo: numeroProtocolo,
        cartorio: destinatarioNome ?? undefined,
        link_acompanhamento: texto(entrada.linkAcompanhamento),
        status: "SOLICITADO",
        ultimaMovimentacao: agora,
      },
    })

    // ── 4.6 TRANSIÇÃO DO PASSO — motor único, na MESMA transação ─────────────
    if (entrada.concluirEtapa) {
      liberouProximo = await aplicarTransicaoDoPassoTx(
        tx,
        passo,
        {
          status: "concluida",
          requestChannel: canal.toLowerCase(),
          externalProtocol: numeroProtocolo,
          externalEntityName: texto(entrada.atendente),
          trackingCode: codigoRastreio,
          costPaid: entrada.custoPago ?? null,
          paymentMethod: texto(entrada.formaPagamento),
          // A partir daqui o passo aponta para a solicitação: o payload deixa de
          // ser fonte e passa a ser referência.
          solicitacaoId,
        },
        ctx,
        agora,
      )
    }

    // ── 4.7 AUDITORIA do ato, no mesmo COMMIT do estado ─────────────────────
    await tx.logAuditoria.create({
      data: {
        acao: "SOLICITACAO_DOCUMENTO_REGISTRADA",
        entidade: "SolicitacaoDocumento",
        entidadeId: solicitacaoId,
        descricao: `Solicitação de certidão registrada para o documento ${documentoId}${numeroProtocolo ? ` — protocolo ${numeroProtocolo}` : " (sem protocolo no envio)"}.`,
        detalhes: {
          documentoId, processoId: passo.processoId, stepInstanceId: passo.id,
          canal, destinatarioNome, numeroProtocolo, protocoloId, arquivoId,
          concluiuEtapa: entrada.concluirEtapa === true,
        } as Prisma.InputJsonValue,
        usuarioId: ctx.usuarioId,
      },
    })
  })

  // Fora da transação de propósito: o avanço de fase abre a sua própria.
  if (liberouProximo) await avancarFaseSeCouber(documentoId)

  return {
    ok: true,
    solicitacaoId,
    protocoloId,
    arquivoId,
    workflow: await montarWorkflowV2(documentoId, ctx),
  }
}

// ── Blocos reutilizáveis (também usados pelo backfill e pelo andamento) ──────

/** Canal → natureza do ato de protocolo, para o cadastro único de Protocolo. */
function tipoProtocoloDoCanal(canal: CanalSolicitacaoDocumento): "CARTORIO" | "COMUNE" | "CONSULAR" {
  if (canal === "COMUNE") return "COMUNE"
  if (canal === "CONSULADO") return "CONSULAR"
  return "CARTORIO"
}

function formaEnvioDoCanal(canal: CanalSolicitacaoDocumento): "PRESENCIAL" | "CORREIO" | "EMAIL" | "PORTAL_ONLINE" {
  switch (canal) {
    case "BALCAO": return "PRESENCIAL"
    case "CORREIOS": return "CORREIO"
    case "EMAIL":
    case "WHATSAPP":
    case "COMUNE": return "EMAIL"
    default: return "PORTAL_ONLINE"
  }
}

/**
 * Registra UM protocolo da solicitação. Cada número informado é uma LINHA NOVA:
 * informar um protocolo depois não apaga o anterior — a aba mostra o histórico e
 * marca o vigente pelo mais recente.
 */
export async function registrarProtocoloDaSolicitacaoTx(
  tx: Prisma.TransactionClient,
  args: {
    solicitacaoId: number
    documentoId: number
    processoId: number
    numeroProtocolo: string
    canal: CanalSolicitacaoDocumento
    dataProtocolo: Date
    responsavelId: number | null
    observacoes?: string | null
    orgaoId?: number | null
  },
): Promise<number> {
  // Mesmo número, mesma solicitação = mesmo protocolo. Reenviar não duplica.
  const existente = await tx.protocolo.findFirst({
    where: { solicitacaoId: args.solicitacaoId, numeroProtocolo: args.numeroProtocolo },
    select: { id: true },
  })
  if (existente) return existente.id

  const protocolo = await tx.protocolo.create({
    data: {
      processoId: args.processoId,
      solicitacaoId: args.solicitacaoId,
      origem: "SOLICITACAO_DOCUMENTO",
      orgaoId: args.orgaoId ?? null,
      numeroProtocolo: args.numeroProtocolo,
      tipoProtocolo: tipoProtocoloDoCanal(args.canal),
      formaEnvio: formaEnvioDoCanal(args.canal),
      dataProtocolo: args.dataProtocolo,
      responsavelId: args.responsavelId,
      observacoes: args.observacoes ?? null,
    },
    select: { id: true },
  })

  // Vínculo canônico protocolo↔documento — a junção que já existia e nunca era usada.
  await tx.protocoloDocumento.upsert({
    where: { protocoloId_documentoId: { protocoloId: protocolo.id, documentoId: args.documentoId } },
    create: { protocoloId: protocolo.id, documentoId: args.documentoId },
    update: {},
  })

  return protocolo.id
}

// ════════════════════════════════════════════════════════════════════════════
// CONSULTA — DTOs de leitura, separados do DTO de execução
// ════════════════════════════════════════════════════════════════════════════

export interface ProtocoloResumoDTO {
  id: number
  numero: string | null
  tipo: string | null
  formaEnvio: string | null
  dataProtocolo: string | null
  informadoEm: string
  informadoPor: { id: number; nome: string } | null
  observacoes: string | null
  origem: string
  vigente: boolean
}

export interface ArquivoDTO {
  id: number
  url: string
  nome: string
  mimeType: string | null
  tamanho: number | null
  tipo: TipoArquivoDocumento
  origem: "SOLICITACAO" | "ETAPA" | "DOCUMENTO"
  stepInstanceId: number | null
  solicitacaoId: number | null
  criadoPor: { id: number; nome: string } | null
  createdAt: string
}

export interface SolicitacaoDTO {
  id: number
  documentoId: number
  canal: CanalSolicitacaoDocumento
  canalLabel: string | null
  destinatarioNome: string | null
  atendente: string | null
  dataEnvio: string
  prazoEsperadoDias: number | null
  previsaoRetorno: string | null
  observacao: string | null
  codigoRastreio: string | null
  linkAcompanhamento: string | null
  custoPago: number | null
  formaPagamento: string | null
  status: string
  criadoPor: { id: number; nome: string } | null
  stepInstanceId: number | null
  tarefaId: number | null
  createdAt: string
  protocolos: ProtocoloResumoDTO[]
  arquivos: ArquivoDTO[]
  /** Configuração do canal — a mesma que a tela usa para validar. */
  protocoloObrigatorio: boolean
}

export interface ResumoProtocoloDocumentoDTO {
  documentoId: number
  solicitacoes: SolicitacaoDTO[]
  /** Solicitação vigente = a mais recente. As anteriores ficam no histórico. */
  vigenteId: number | null
}

const USUARIO_RESUMO = { select: { id: true, nome: true } } as const

/**
 * Consulta ÚNICA da aba Protocolo do documento: solicitações do DOCUMENTO (nunca
 * do processo inteiro), com protocolos e arquivos. Escopo por documentoId =
 * protocolo de outro documento do mesmo processo não aparece aqui.
 */
export async function carregarResumoProtocoloDocumento(
  documentoId: number,
): Promise<ResumoProtocoloDocumentoDTO> {
  const solicitacoes = await prisma.solicitacaoDocumento.findMany({
    where: { documentoId },
    orderBy: { createdAt: "desc" },
    include: {
      criadoPor: USUARIO_RESUMO,
      protocolos: {
        orderBy: { createdAt: "desc" },
        include: { responsavel: USUARIO_RESUMO },
      },
      arquivos: {
        orderBy: { createdAt: "asc" },
        include: { criadoPor: USUARIO_RESUMO },
      },
    },
  })

  return {
    documentoId,
    vigenteId: solicitacoes[0]?.id ?? null,
    solicitacoes: solicitacoes.map((s) => ({
      id: s.id,
      documentoId: s.documentoId,
      canal: s.canal,
      canalLabel: configDoCanal(s.canal)?.label ?? null,
      destinatarioNome: s.destinatarioNome,
      atendente: s.atendente,
      dataEnvio: s.dataEnvio.toISOString(),
      prazoEsperadoDias: s.prazoEsperadoDias,
      previsaoRetorno: s.previsaoRetorno ? s.previsaoRetorno.toISOString() : null,
      observacao: s.observacao,
      codigoRastreio: s.codigoRastreio,
      linkAcompanhamento: s.linkAcompanhamento,
      custoPago: s.custoPago ? Number(s.custoPago) : null,
      formaPagamento: s.formaPagamento,
      status: s.status,
      criadoPor: s.criadoPor,
      stepInstanceId: s.stepInstanceId,
      tarefaId: s.tarefaId,
      createdAt: s.createdAt.toISOString(),
      protocoloObrigatorio: configDoCanal(s.canal)?.protocoloObrigatorio ?? false,
      protocolos: s.protocolos.map((p, i) => ({
        id: p.id,
        numero: p.numeroProtocolo,
        tipo: p.tipoProtocolo,
        formaEnvio: p.formaEnvio,
        dataProtocolo: p.dataProtocolo ? p.dataProtocolo.toISOString() : null,
        informadoEm: p.createdAt.toISOString(),
        informadoPor: p.responsavel,
        observacoes: p.observacoes,
        origem: p.origem,
        // O mais recente é o vigente; os demais são histórico e continuam visíveis.
        vigente: i === 0,
      })),
      arquivos: s.arquivos.map((a) => mapArquivo(a)),
    })),
  }
}

type ArquivoComAutor = Prisma.DocumentoArquivoGetPayload<{ include: { criadoPor: { select: { id: true; nome: true } } } }>

function mapArquivo(a: ArquivoComAutor): ArquivoDTO {
  return {
    id: a.id,
    url: a.url,
    nome: a.nome,
    mimeType: a.mimeType,
    tamanho: a.tamanho,
    tipo: a.tipo,
    origem: a.solicitacaoId ? "SOLICITACAO" : a.stepInstanceId ? "ETAPA" : "DOCUMENTO",
    stepInstanceId: a.stepInstanceId,
    solicitacaoId: a.solicitacaoId,
    criadoPor: a.criadoPor,
    createdAt: a.createdAt.toISOString(),
  }
}

/**
 * Arquivos do documento — consulta consolidada. `stepInstanceId` filtra para a aba
 * Anexos da ETAPA; sem filtro, é a aba do DOCUMENTO. Um arquivo aparece UMA vez:
 * a unicidade (documentoId, url) garante isso na origem, não na tela.
 */
export async function listarArquivosDocumento(
  documentoId: number,
  filtro?: { stepInstanceId?: number },
): Promise<ArquivoDTO[]> {
  const arquivos = await prisma.documentoArquivo.findMany({
    where: { documentoId, ...(filtro?.stepInstanceId ? { stepInstanceId: filtro.stepInstanceId } : {}) },
    orderBy: { createdAt: "asc" },
    include: { criadoPor: USUARIO_RESUMO },
  })
  return arquivos.map(mapArquivo)
}

export interface ObservacaoDTO {
  id: number
  texto: string
  criadoPor: { id: number; nome: string } | null
  createdAt: string
  stepInstanceId: number | null
  solicitacaoId: number | null
}

/** Observações do documento (ou de uma etapa). Append-only, mais antiga primeiro. */
export async function listarObservacoesDocumento(
  documentoId: number,
  filtro?: { stepInstanceId?: number },
): Promise<ObservacaoDTO[]> {
  const obs = await prisma.documentoObservacao.findMany({
    where: { documentoId, ...(filtro?.stepInstanceId ? { stepInstanceId: filtro.stepInstanceId } : {}) },
    orderBy: { createdAt: "asc" },
    include: { criadoPor: USUARIO_RESUMO },
  })
  return obs.map((o) => ({
    id: o.id,
    texto: o.texto,
    criadoPor: o.criadoPor,
    createdAt: o.createdAt.toISOString(),
    stepInstanceId: o.stepInstanceId,
    solicitacaoId: o.solicitacaoId,
  }))
}

/**
 * INFORMAR PROTOCOLO DEPOIS — o canal não devolveu número no envio e ele chegou
 * agora. Acrescenta ao histórico da solicitação; NUNCA sobrescreve o anterior.
 */
export async function informarProtocoloPosterior(
  documentoId: number,
  solicitacaoId: number,
  numeroProtocolo: string,
  ctx: ContextoLeituraWorkflow,
  extras?: { observacoes?: string | null; comprovante?: { url: string; nome?: string | null; mimeType?: string | null; tamanho?: number | null } | null },
): Promise<{ ok: true; protocoloId: number } | { ok: false; error: string; status: number }> {
  const numero = texto(numeroProtocolo)
  if (!numero) return { ok: false, error: "VALIDATION_ERROR:NUMERO_PROTOCOLO", status: 422 }

  const s = await prisma.solicitacaoDocumento.findUnique({
    where: { id: solicitacaoId },
    select: { id: true, documentoId: true, processoId: true, canal: true, stepInstanceId: true },
  })
  // Escopo verificado na linha: a solicitação TEM de ser do documento pedido.
  if (!s || s.documentoId !== documentoId) return { ok: false, error: "PROTOCOL_NOT_FOUND", status: 404 }

  if (ctx.permissoes?.["processos.editar_paginas"] !== true) {
    return { ok: false, error: "PERMISSION_REQUIRED", status: 403 }
  }

  const agora = new Date()
  let protocoloId = 0
  await prisma.$transaction(async (tx) => {
    protocoloId = await registrarProtocoloDaSolicitacaoTx(tx, {
      solicitacaoId: s.id,
      documentoId,
      processoId: s.processoId,
      numeroProtocolo: numero,
      canal: s.canal,
      dataProtocolo: agora,
      responsavelId: ctx.usuarioId,
      observacoes: texto(extras?.observacoes),
    })
    if (extras?.comprovante?.url) {
      await vincularArquivoDocumentoTx(tx, {
        documentoId,
        solicitacaoId: s.id,
        stepInstanceId: s.stepInstanceId,
        url: extras.comprovante.url,
        nome: texto(extras.comprovante.nome) ?? nomeDaUrl(extras.comprovante.url),
        mimeType: extras.comprovante.mimeType ?? null,
        tamanho: extras.comprovante.tamanho ?? null,
        tipo: "COMPROVANTE_PROTOCOLO",
        criadoPorId: ctx.usuarioId,
      })
    }
    await tx.solicitacaoDocumento.update({ where: { id: s.id }, data: { status: "PROTOCOLADA" } })
    await tx.documento.update({ where: { id: documentoId }, data: { protocolo: numero, ultimaMovimentacao: agora } })
    await tx.logAuditoria.create({
      data: {
        acao: "PROTOCOLO_INFORMADO_POSTERIORMENTE",
        entidade: "SolicitacaoDocumento",
        entidadeId: s.id,
        descricao: `Protocolo ${numero} informado para o documento ${documentoId} após o envio.`,
        detalhes: { documentoId, solicitacaoId: s.id, protocoloId, numero } as Prisma.InputJsonValue,
        usuarioId: ctx.usuarioId,
      },
    })
  })

  return { ok: true, protocoloId }
}

/**
 * Solicitação VIGENTE do documento — a que "Aguardar retorno do cartório" e a
 * Central consomem. É leitura do registro canônico, não remontagem de metadata.
 */
export async function carregarSolicitacaoVigente(documentoId: number): Promise<SolicitacaoDTO | null> {
  const resumo = await carregarResumoProtocoloDocumento(documentoId)
  return resumo.solicitacoes[0] ?? null
}
