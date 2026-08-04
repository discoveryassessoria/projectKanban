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
  ligarArquivosAoProtocoloTx,
} from "@/src/services/documento-arquivos"
import {
  resolverExigenciasDaEtapa,
  exigenciaPrincipal,
  exigenciasNaoAtendidas,
  type ExigenciaEvidenciaDTO,
} from "@/src/services/exigencia-evidencia"

export { vincularArquivoDocumentoTx, registrarObservacaoDocumentoTx, ligarArquivosAoProtocoloTx }

export type ResultadoSolicitacao =
  | {
      ok: true
      solicitacaoId: number
      protocoloId: number | null
      /** Registro do requerimento — o MESMO id que as três abas exibem. */
      arquivoId: number | null
      /** Documento mestre com que o requerimento foi classificado (null = etapa sem exigência configurada). */
      evidenciaTipoId: number | null
      /** Versão anterior que saiu de vigência nesta gravação (null = não houve troca). */
      substituiuArquivoId: number | null
      workflow: WorkflowV2Shape | null
    }
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
  /**
   * Requerimento enviado ao cartório — já subiu para o R2; aqui vira registro.
   * `hash` é a impressão digital calculada na origem do upload (opcional: o
   * registro não depende dela, mas com ela o reenvio idêntico fica provado).
   */
  requerimento?: {
    url: string
    nome?: string | null
    mimeType?: string | null
    tamanho?: number | null
    hash?: string | null
  } | null
  /** Motivo da troca, quando o requerimento substitui uma versão anterior. */
  motivoSubstituicao?: string | null
  /** Comprovantes adicionais do envio. */
  anexos?: Array<{ url: string; nome?: string | null; mimeType?: string | null; tamanho?: number | null; hash?: string | null; tipo?: TipoArquivoDocumento }> | null
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
    select: { id: true, pessoaId: true, cartorio: true, documentTypeId: true },
  })
  if (!doc) return { ok: false, error: "STEP_NOT_FOUND", status: 404 }

  // 3.1) EXIGÊNCIA DE EVIDÊNCIA — que documento MESTRE esta etapa exige anexar.
  // Vem da configuração oficial (ExigenciaEvidenciaEtapa), por ID. É ela que diz
  // que o arquivo do requerimento é o "Requerimento inteiro teor" do cadastro —
  // não o rótulo do campo, não o nome do arquivo, não a extensão.
  const exigencias = await resolverExigenciasDaEtapa({
    stepKey: passo.stepKey,
    documentoTipoId: doc.documentTypeId,
    canal,
  })
  const exigidoNoAnexo = exigenciaPrincipal(exigencias)

  const destinatarioNome = texto(entrada.destinatarioNome) ?? texto(doc.cartorio)
  const numeroProtocolo = texto(entrada.numeroProtocolo)
  const requerimentoUrl = texto(entrada.requerimento?.url)
  const codigoRastreio = texto(entrada.codigoRastreio)
  const observacao = texto(entrada.observacao)

  // 3.2) O requerimento JÁ REGISTRADO nesta etapa (reabertura, retry, segunda
  // gravação). Sem isto, concluir de novo exigiria reenviar um arquivo que já
  // está no registro — foi exatamente esse pedido de reenvio que a correção veio
  // eliminar. Só conta o VIGENTE: versão substituída não satisfaz exigência.
  const requerimentoJaRegistrado = await prisma.documentoArquivo.findFirst({
    where: {
      documentoId,
      stepInstanceId: passo.id,
      vigente: true,
      ...(exigidoNoAnexo
        ? { OR: [{ documentTypeId: exigidoNoAnexo.documentoMestre.id }, { tipo: "REQUERIMENTO_ENVIADO" }] }
        : { tipo: "REQUERIMENTO_ENVIADO" }),
    },
    select: { id: true, url: true, documentTypeId: true },
    orderBy: { id: "desc" },
  })

  // 4) campos obrigatórios POR CANAL — a mesma configuração que a tela recebeu
  const faltando = faltamCamposDoCanal({
    canal,
    numeroProtocolo,
    anexoUrl: requerimentoUrl ?? requerimentoJaRegistrado?.url ?? null,
    codigoRastreio,
    observacao,
    destinatarioNome,
  })
  if (faltando.length > 0) {
    return { ok: false, error: `VALIDATION_ERROR:${faltando.join(",")}`, status: 422 }
  }

  // 4.1) EVIDÊNCIA OBRIGATÓRIA — a etapa não conclui sem o documento mestre que a
  // configuração exige. O arquivo que chega no campo de requerimento É essa
  // evidência (a etapa tem um campo só); sem arquivo, a exigência não é atendida.
  if (entrada.concluirEtapa) {
    const anexadosAgora: Array<{ documentTypeId: number | null }> = []
    if (requerimentoUrl && exigidoNoAnexo) anexadosAgora.push({ documentTypeId: exigidoNoAnexo.documentoMestre.id })
    // O que já está no registro conta: a evidência não some porque a etapa foi
    // reaberta. Se a linha antiga ainda não tem classificação (registro anterior
    // à configuração), a exigência do arquivo que ocupa aquele lugar é a que vale.
    if (!requerimentoUrl && requerimentoJaRegistrado && exigidoNoAnexo) {
      anexadosAgora.push({ documentTypeId: exigidoNoAnexo.documentoMestre.id })
    }
    const naoAtendidas = exigenciasNaoAtendidas(exigencias, anexadosAgora)
    if (naoAtendidas.length > 0) {
      const codigos = naoAtendidas.map((e) => e.documentoMestre.publicCode ?? e.documentoMestre.code ?? String(e.documentoMestre.id))
      return { ok: false, error: `VALIDATION_ERROR:EVIDENCIA_OBRIGATORIA:${codigos.join(",")}`, status: 422 }
    }
  }

  const agora = new Date()
  // IDEMPOTÊNCIA do ato: a mesma solicitação, no mesmo passo/ciclo, é UMA. Duplo
  // clique e retry caem na mesma chave e atualizam em vez de criar a segunda.
  const chave = `solicitacao:doc${documentoId}:step${stepInstanceId}:ciclo${passo.ciclo}`

  let solicitacaoId = 0
  let protocoloId: number | null = null
  let arquivoId: number | null = null
  let substituiuArquivoId: number | null = null
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

    // ── 4.3 ARQUIVOS — o requerimento vira registro, com origem, autor, tipo
    //        mestre e protocolo. UM upload, UMA linha, TODOS os vínculos. ──────
    const arquivos: Array<{
      url: string
      nome: string
      mimeType: string | null
      tamanho: number | null
      hashConteudo: string | null
      tipo: TipoArquivoDocumento
      documentTypeId: number | null
    }> = []
    if (requerimentoUrl) {
      arquivos.push({
        url: requerimentoUrl,
        nome: texto(entrada.requerimento?.nome) ?? nomeDaUrl(requerimentoUrl),
        mimeType: texto(entrada.requerimento?.mimeType),
        tamanho: inteiro(entrada.requerimento?.tamanho),
        hashConteudo: texto(entrada.requerimento?.hash),
        // A finalidade vem da exigência configurada; sem exigência, o arquivo
        // continua sendo o requerimento do envio, apenas sem classificação
        // mestre — nenhum tipo é inventado para preencher a coluna.
        tipo: exigidoNoAnexo?.finalidade ?? "REQUERIMENTO_ENVIADO",
        documentTypeId: exigidoNoAnexo?.documentoMestre.id ?? null,
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
        hashConteudo: texto(a?.hash),
        tipo: a?.tipo ?? "COMPROVANTE_PROTOCOLO",
        documentTypeId: null,
      })
    }
    for (const a of arquivos) {
      const r = await vincularArquivoDocumentoTx(tx, {
        documentoId,
        solicitacaoId,
        stepInstanceId: passo.id,
        // O protocolo pode não existir neste envio (canal que devolve depois):
        // o arquivo NÃO espera por ele — nasce vinculado ao que já existe e é
        // ligado ao protocolo assim que houver um.
        protocoloId,
        criadoPorId: ctx.usuarioId,
        motivoSubstituicao: texto(entrada.motivoSubstituicao),
        ...a,
      })
      if (a.documentTypeId != null || a.tipo === "REQUERIMENTO_ENVIADO") {
        arquivoId = r.id
        substituiuArquivoId = r.substituiuId
      }
    }

    // ── 4.3.1 O requerimento que JÁ existia entra na solicitação ─────────────
    // Etapa reaberta sem novo upload: o arquivo continua sendo o mesmo registro,
    // e é aqui que ele ganha os vínculos que ainda faltavam. Nenhuma cópia, nenhum
    // reenvio, nenhum id novo.
    if (!requerimentoUrl && requerimentoJaRegistrado) {
      await tx.documentoArquivo.update({
        where: { id: requerimentoJaRegistrado.id },
        data: {
          solicitacaoId,
          ...(requerimentoJaRegistrado.documentTypeId == null && exigidoNoAnexo
            ? { documentTypeId: exigidoNoAnexo.documentoMestre.id }
            : {}),
        },
      })
      arquivoId = requerimentoJaRegistrado.id
    }

    // ── 4.3.2 PROTOCOLO ↔ ARQUIVOS — o elo direto que a aba Protocolo lê ─────
    if (protocoloId) {
      await ligarArquivosAoProtocoloTx(tx, { solicitacaoId, protocoloId })
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
          // Rastro da CLASSIFICAÇÃO: qual documento mestre a etapa exigiu e qual
          // versão anterior saiu de vigência. Sem isto a auditoria não distingue
          // "anexou" de "trocou".
          evidenciaExigidaId: exigidoNoAnexo?.documentoMestre.id ?? null,
          evidenciaExigidaCodigo: exigidoNoAnexo?.documentoMestre.publicCode ?? null,
          substituiuArquivoId,
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
    evidenciaTipoId: exigidoNoAnexo?.documentoMestre.id ?? null,
    substituiuArquivoId,
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
  hashConteudo: string | null
  /** Finalidade na operação (dimensão fechada). */
  tipo: TipoArquivoDocumento
  /**
   * CLASSIFICAÇÃO MESTRE — o que este arquivo É no Cadastro de Documentos.
   * null = arquivo sem exigência configurada; a tela mostra só a finalidade,
   * nunca um código inventado.
   */
  documentoMestre: { id: number; publicCode: string | null; code: string | null; name: string } | null
  origem: "SOLICITACAO" | "ETAPA" | "DOCUMENTO"
  stepInstanceId: number | null
  solicitacaoId: number | null
  protocoloId: number | null
  /** Versão vigente do vínculo. false = substituída; permanece para auditoria. */
  vigente: boolean
  /** Versão que ESTE arquivo substituiu. */
  substituiId: number | null
  substituidoEm: string | null
  motivoSubstituicao: string | null
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
        include: INCLUDE_ARQUIVO,
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

const INCLUDE_ARQUIVO = {
  criadoPor: USUARIO_RESUMO,
  documentType: { select: { id: true, publicCode: true, code: true, name: true } },
} as const

type ArquivoComAutor = Prisma.DocumentoArquivoGetPayload<{ include: typeof INCLUDE_ARQUIVO }>

function mapArquivo(a: ArquivoComAutor): ArquivoDTO {
  return {
    id: a.id,
    url: a.url,
    nome: a.nome,
    mimeType: a.mimeType,
    tamanho: a.tamanho,
    hashConteudo: a.hashConteudo,
    tipo: a.tipo,
    documentoMestre: a.documentType ?? null,
    origem: a.solicitacaoId ? "SOLICITACAO" : a.stepInstanceId ? "ETAPA" : "DOCUMENTO",
    stepInstanceId: a.stepInstanceId,
    solicitacaoId: a.solicitacaoId,
    protocoloId: a.protocoloId,
    vigente: a.vigente,
    substituiId: a.substituiId,
    substituidoEm: a.substituidoEm ? a.substituidoEm.toISOString() : null,
    motivoSubstituicao: a.motivoSubstituicao,
    criadoPor: a.criadoPor,
    createdAt: a.createdAt.toISOString(),
  }
}

/**
 * Arquivos do documento — consulta consolidada. `stepInstanceId` filtra para a aba
 * Anexos da ETAPA; `protocoloId` para a aba Protocolo; sem filtro, é a aba do
 * DOCUMENTO. Um arquivo aparece UMA vez: a unicidade (documentoId, url) garante
 * isso na origem, não na tela.
 *
 * Por padrão devolve só o VIGENTE — a versão trocada continua no banco e é lida
 * com `incluirHistorico`, nunca some. O que a operação vê é o que vale hoje.
 */
export async function listarArquivosDocumento(
  documentoId: number,
  filtro?: { stepInstanceId?: number; protocoloId?: number; incluirHistorico?: boolean },
): Promise<ArquivoDTO[]> {
  const arquivos = await prisma.documentoArquivo.findMany({
    where: {
      documentoId,
      ...(filtro?.stepInstanceId ? { stepInstanceId: filtro.stepInstanceId } : {}),
      ...(filtro?.protocoloId ? { protocoloId: filtro.protocoloId } : {}),
      ...(filtro?.incluirHistorico ? {} : { vigente: true }),
    },
    orderBy: { createdAt: "asc" },
    include: INCLUDE_ARQUIVO,
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
        protocoloId,
        url: extras.comprovante.url,
        nome: texto(extras.comprovante.nome) ?? nomeDaUrl(extras.comprovante.url),
        mimeType: extras.comprovante.mimeType ?? null,
        tamanho: extras.comprovante.tamanho ?? null,
        tipo: "COMPROVANTE_PROTOCOLO",
        criadoPorId: ctx.usuarioId,
      })
    }
    // O REQUERIMENTO já enviado passa a apontar para o protocolo que acabou de
    // chegar. Nada é reenviado nem duplicado: é o mesmo registro, agora completo.
    // Sem isto, protocolo informado depois nasceria sem o requerimento que o gerou.
    await ligarArquivosAoProtocoloTx(tx, { solicitacaoId: s.id, protocoloId })
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

// ════════════════════════════════════════════════════════════════════════════
// EXIGÊNCIA DE EVIDÊNCIA — o que a etapa exige anexar, servido para a tela
// ════════════════════════════════════════════════════════════════════════════

export interface ExigenciasDaEtapaDTO {
  stepInstanceId: number
  stepKey: string
  documentoTipoId: number | null
  canal: CanalSolicitacaoDocumento | null
  exigencias: ExigenciaEvidenciaDTO[]
  /** A exigência que o campo de anexo do editor atende (null = etapa sem exigência). */
  principal: ExigenciaEvidenciaDTO | null
  /** O requerimento VIGENTE já anexado nesta etapa, se houver. */
  anexoAtual: ArquivoDTO | null
}

/**
 * O contrato que o editor de "Solicitar certidão" consome para saber QUAL
 * documento mestre precisa anexar. A tela não decide isso por canal nem por
 * rótulo: ela pergunta ao servidor, que responde com o ID do cadastro.
 *
 * Escopo verificado na linha: o passo TEM de ser do documento pedido — sem isso a
 * rota seria um IDOR entre documentos do mesmo processo.
 */
export async function carregarExigenciasDaEtapa(
  documentoId: number,
  stepInstanceId: number,
  canal?: CanalSolicitacaoDocumento | null,
): Promise<ExigenciasDaEtapaDTO | null> {
  const passo = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: stepInstanceId },
    select: { id: true, stepKey: true, documentoId: true },
  })
  if (!passo || passo.documentoId !== documentoId) return null

  const doc = await prisma.documento.findUnique({
    where: { id: documentoId },
    select: { documentTypeId: true },
  })
  if (!doc) return null

  const exigencias = await resolverExigenciasDaEtapa({
    stepKey: passo.stepKey,
    documentoTipoId: doc.documentTypeId,
    canal: canal ?? null,
  })
  const principal = exigenciaPrincipal(exigencias)

  const anexos = await listarArquivosDocumento(documentoId, { stepInstanceId })
  const anexoAtual =
    (principal ? anexos.find((a) => a.documentoMestre?.id === principal.documentoMestre.id) : undefined) ??
    anexos.find((a) => a.tipo === "REQUERIMENTO_ENVIADO") ??
    null

  return {
    stepInstanceId: passo.id,
    stepKey: passo.stepKey,
    documentoTipoId: doc.documentTypeId,
    canal: canal ?? null,
    exigencias,
    principal,
    anexoAtual,
  }
}
