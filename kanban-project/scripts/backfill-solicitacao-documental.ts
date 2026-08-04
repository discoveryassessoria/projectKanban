/**
 * BACKFILL — solicitações de certidão já executadas, antes de existir registro.
 *
 * Rodar:
 *   npx tsx scripts/backfill-solicitacao-documental.ts            # diagnóstico (não escreve)
 *   npx tsx scripts/backfill-solicitacao-documental.ts --execute  # aplica
 *
 * O QUE ELE RECONSTRÓI
 * --------------------
 * Para cada passo `solicitar_certidao` já CONCLUÍDO que ainda não tem
 * SolicitacaoDocumento, monta o ato a partir do que REALMENTE está gravado:
 *   • canal        ← metadata.operacao.requestChannel  ou Documento.canal_solicitacao
 *   • protocolo    ← metadata.operacao.externalProtocol ou Documento.protocolo
 *   • destinatário ← Documento.cartorio
 *   • atendente    ← metadata.operacao.externalEntityName
 *   • custo/forma  ← metadata.operacao.costPaid / paymentMethod
 *   • rastreio     ← metadata.operacao.trackingCode
 *   • observação   ← metadata.operacao.notes ou Documento.observacoes
 *   • data/autoria ← completedAt / metadata.operacao.completedById do passo
 *   • REQUERIMENTO ← Documento.link_acompanhamento, QUANDO a URL for de arquivo
 *                    enviado (é onde o editor antigo guardava o upload).
 *
 * IDEMPOTENTE: a solicitação usa a mesma chave do fluxo normal; protocolo e
 * arquivo são upsert. Reexecutar não duplica nada.
 *
 * NÃO INVENTA DADO: passo sem canal identificável é REPORTADO e pulado. Arquivo
 * que não existir de verdade não vira registro — o relatório diz o que faltou.
 *
 * NÃO APAGA o metadata antigo: ele continua onde está, como histórico. O que muda
 * é quem é a FONTE — daqui em diante, as telas leem o registro.
 */
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { canalDoTexto } from "@/src/lib/process-stage/canais-solicitacao"
import {
  registrarProtocoloDaSolicitacaoTx,
} from "@/src/services/solicitacao-documento"
import {
  vincularArquivoDocumentoTx,
  registrarObservacaoDocumentoTx,
  ligarArquivosAoProtocoloTx,
} from "@/src/services/documento-arquivos"
import { resolverExigenciasDaEtapa, exigenciaPrincipal } from "@/src/services/exigencia-evidencia"

const EXECUTAR = process.argv.includes("--execute")

interface Achado {
  documentoId: number
  stepInstanceId: number
  canal: string | null
  protocolo: string | null
  requerimentoUrl: string | null
  destinatario: string | null
  /** Resultado da conferência do binário no storage. */
  storage?: ConferenciaStorage
  /** IDs realmente criados/reparados (só preenchidos com --execute). */
  solicitacaoId?: number
  protocoloId?: number | null
  arquivoId?: number | null
  documentTypeId?: number | null
  motivoPulo?: string
}

/** URL de arquivo enviado? O campo `link_acompanhamento` recebia as duas coisas. */
function pareceArquivoEnviado(url: string | null): boolean {
  if (!url) return false
  // O editor antigo subia para o R2 sob `documentos/{id}/solicitacao/...`; qualquer
  // outra coisa (portal do cartório, consulta pública) é link de acompanhamento mesmo.
  return /\/documentos\/\d+\/solicitacao\//.test(url)
}

interface ConferenciaStorage {
  existe: boolean
  status: number | null
  mimeType: string | null
  tamanho: number | null
  erro?: string
}

/**
 * O binário está MESMO no storage? Sem esta conferência o backfill criaria uma
 * referência para um arquivo que talvez nunca tenha subido — exatamente o tipo
 * de "reparo" que mente. Arquivo ausente é REPORTADO para reenvio manual; nenhum
 * registro de arquivo é criado para ele.
 */
async function conferirNoStorage(url: string): Promise<ConferenciaStorage> {
  try {
    const r = await fetch(url, { method: "HEAD", redirect: "follow" })
    const tamanho = Number(r.headers.get("content-length"))
    return {
      existe: r.ok,
      status: r.status,
      mimeType: r.headers.get("content-type"),
      tamanho: Number.isFinite(tamanho) && tamanho > 0 ? tamanho : null,
    }
  } catch (e) {
    return { existe: false, status: null, mimeType: null, tamanho: null, erro: String(e).slice(0, 120) }
  }
}

/**
 * REPARO de solicitação que JÁ existe: o arquivo do requerimento está lá, mas sem
 * classificação mestre e/ou sem o vínculo direto com o protocolo (foi criado antes
 * dessas colunas existirem).
 *
 * Só COMPLETA o que está vazio: classificação já atribuída e protocolo já ligado
 * não são remanejados. Reexecutar não muda nada — a segunda passada não acha o que
 * reparar.
 */
async function repararVinculosDaSolicitacao(
  solicitacaoId: number,
  documentTypeId: number | null,
): Promise<{ mudou: boolean; arquivoId: number | null; documentTypeId: number | null; protocoloId: number | null }> {
  const protocolo = await prisma.protocolo.findFirst({
    where: { solicitacaoId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  })
  const requerimento = await prisma.documentoArquivo.findFirst({
    where: { solicitacaoId, tipo: "REQUERIMENTO_ENVIADO", vigente: true },
    orderBy: { id: "desc" },
    select: { id: true, documentTypeId: true, protocoloId: true },
  })

  const classificar = documentTypeId != null && requerimento != null && requerimento.documentTypeId == null
  const ligarProtocolo = protocolo != null && requerimento != null && requerimento.protocoloId == null
  if (!classificar && !ligarProtocolo) {
    return { mudou: false, arquivoId: requerimento?.id ?? null, documentTypeId: requerimento?.documentTypeId ?? null, protocoloId: requerimento?.protocoloId ?? null }
  }
  if (!EXECUTAR) {
    return { mudou: true, arquivoId: requerimento?.id ?? null, documentTypeId, protocoloId: protocolo?.id ?? null }
  }

  await prisma.$transaction(async (tx) => {
    if (classificar) {
      await tx.documentoArquivo.update({
        where: { id: requerimento!.id },
        data: { documentTypeId },
      })
    }
    if (ligarProtocolo) {
      await ligarArquivosAoProtocoloTx(tx, { solicitacaoId, protocoloId: protocolo!.id })
    }
    await tx.logAuditoria.create({
      data: {
        acao: "BACKFILL_VINCULO_REQUERIMENTO",
        entidade: "DocumentoArquivo",
        entidadeId: requerimento!.id,
        descricao: `Vínculos do requerimento completados na solicitação ${solicitacaoId}${classificar ? " — classificação mestre" : ""}${ligarProtocolo ? " — protocolo" : ""}.`,
        detalhes: {
          solicitacaoId, arquivoId: requerimento!.id,
          documentTypeId: classificar ? documentTypeId : requerimento!.documentTypeId,
          protocoloId: ligarProtocolo ? protocolo!.id : requerimento!.protocoloId,
          origem: "backfill-solicitacao-documental",
        } as Prisma.InputJsonValue,
        usuarioId: null,
      },
    })
  })

  return { mudou: true, arquivoId: requerimento?.id ?? null, documentTypeId, protocoloId: protocolo?.id ?? null }
}

async function main() {
  console.log(`BACKFILL solicitação documental — ${EXECUTAR ? "EXECUTANDO" : "DIAGNÓSTICO (sem escrita)"}\n`)

  const passos = await prisma.phaseWorkflowStepInstance.findMany({
    where: {
      stepKey: "solicitar_certidao",
      documentoId: { not: null },
      status: { in: ["CONCLUIDO", "EXECUTADO"] },
    },
    orderBy: { id: "asc" },
    select: {
      id: true, documentoId: true, processoId: true, workflowInstanceId: true,
      faseMacroKey: true, ciclo: true, metadata: true, completedAt: true, startedAt: true,
    },
  })

  console.log(`  ${passos.length} passo(s) "solicitar_certidao" concluído(s) encontrados.`)

  const feitos: Achado[] = []
  const pulados: Achado[] = []
  const reparados: Achado[] = []
  const semBinario: Achado[] = []
  let jaExistiam = 0

  for (const p of passos) {
    const documentoId = p.documentoId as number
    const op = ((p.metadata ?? {}) as { operacao?: Record<string, unknown> }).operacao ?? {}

    const doc = await prisma.documento.findUnique({
      where: { id: documentoId },
      select: {
        id: true, pessoaId: true, cartorio: true, protocolo: true, documentTypeId: true,
        canal_solicitacao: true, link_acompanhamento: true, observacoes: true,
      },
    })
    if (!doc) {
      pulados.push({ documentoId, stepInstanceId: p.id, canal: null, protocolo: null, requerimentoUrl: null, destinatario: null, motivoPulo: "documento inexistente" })
      continue
    }

    // CLASSIFICAÇÃO MESTRE do requerimento — a mesma configuração que o fluxo
    // normal usa. Se a etapa não exige documento mestre, o arquivo é vinculado
    // sem classificação: nenhum tipo é inventado para preencher a coluna.
    const exigido = exigenciaPrincipal(
      await resolverExigenciasDaEtapa({ stepKey: "solicitar_certidao", documentoTipoId: doc.documentTypeId }),
    )

    const chave = `solicitacao:doc${documentoId}:step${p.id}:ciclo${p.ciclo}`
    const existente = await prisma.solicitacaoDocumento.findUnique({ where: { chaveIdempotencia: chave }, select: { id: true } })
    if (existente) {
      jaExistiam++
      // REPARO IDEMPOTENTE das solicitações que já foram reconstruídas antes de
      // existirem classificação mestre e vínculo com o protocolo. Roda quantas
      // vezes for preciso e não muda nada que já esteja certo.
      const reparo = await repararVinculosDaSolicitacao(existente.id, exigido?.documentoMestre.id ?? null)
      if (reparo.mudou) {
        reparados.push({
          documentoId, stepInstanceId: p.id, canal: null, protocolo: null,
          requerimentoUrl: null, destinatario: null,
          solicitacaoId: existente.id, arquivoId: reparo.arquivoId,
          documentTypeId: reparo.documentTypeId, protocoloId: reparo.protocoloId,
        })
      }
      continue
    }

    const canalTexto = (op.requestChannel as string | undefined) ?? doc.canal_solicitacao
    const canal = canalDoTexto(canalTexto)
    const protocolo = ((op.externalProtocol as string | undefined) ?? doc.protocolo ?? "").trim() || null
    const linkBruto = doc.link_acompanhamento
    const requerimentoUrl = pareceArquivoEnviado(linkBruto) ? linkBruto : null
    const destinatario = doc.cartorio?.trim() || null
    const observacao = ((op.notes as string | undefined) ?? doc.observacoes ?? "").trim() || null

    // O arquivo existe MESMO no storage? Verificar antes de prometer reparo.
    const storage = requerimentoUrl ? await conferirNoStorage(requerimentoUrl) : undefined

    const achado: Achado = {
      documentoId, stepInstanceId: p.id,
      canal: canal ?? canalTexto ?? null,
      protocolo, requerimentoUrl, destinatario, storage,
      documentTypeId: exigido?.documentoMestre.id ?? null,
    }

    if (!canal) {
      // Sem canal identificável não se INVENTA um: o ato fica reportado.
      achado.motivoPulo = `canal não identificável (valor gravado: ${JSON.stringify(canalTexto)})`
      pulados.push(achado)
      continue
    }

    if (!EXECUTAR) { feitos.push(achado); continue }

    await prisma.$transaction(async (tx) => {
      const solicitacao = await tx.solicitacaoDocumento.create({
        data: {
          documentoId,
          processoId: p.processoId,
          pessoaId: doc.pessoaId,
          faseMacroKey: p.faseMacroKey,
          workflowInstanceId: p.workflowInstanceId,
          stepInstanceId: p.id,
          canal,
          destinatarioNome: destinatario,
          atendente: ((op.externalEntityName as string | undefined) ?? "").trim() || null,
          // Data REAL do ato: quando o passo foi concluído. Não se carimba "agora"
          // num fato que aconteceu antes — isso faria o histórico mentir.
          dataEnvio: p.completedAt ?? p.startedAt ?? new Date(),
          observacao,
          custoPago: typeof op.costPaid === "number" ? new Prisma.Decimal(op.costPaid) : null,
          formaPagamento: ((op.paymentMethod as string | undefined) ?? "").trim() || null,
          codigoRastreio: ((op.trackingCode as string | undefined) ?? "").trim() || null,
          // O link só é "de acompanhamento" quando NÃO era o arquivo enviado.
          linkAcompanhamento: requerimentoUrl ? null : linkBruto,
          status: protocolo ? "PROTOCOLADA" : "AGUARDANDO_PROTOCOLO",
          criadoPorId: typeof op.completedById === "number" ? op.completedById : null,
          chaveIdempotencia: chave,
        },
        select: { id: true },
      })

      const tarefa = await tx.tarefa.findFirst({
        where: { workflowStepInstanceId: p.id }, select: { id: true }, orderBy: { id: "asc" },
      })
      if (tarefa) await tx.solicitacaoDocumento.update({ where: { id: solicitacao.id }, data: { tarefaId: tarefa.id } })

      let protocoloId: number | null = null
      if (protocolo) {
        protocoloId = await registrarProtocoloDaSolicitacaoTx(tx, {
          solicitacaoId: solicitacao.id,
          documentoId,
          processoId: p.processoId,
          numeroProtocolo: protocolo,
          canal,
          dataProtocolo: p.completedAt ?? new Date(),
          responsavelId: typeof op.completedById === "number" ? op.completedById : null,
          observacoes: observacao,
        })
      }
      achado.protocoloId = protocoloId

      // Arquivo só vira registro se o binário FOI mesmo persistido. Sem isso o
      // reparo criaria uma referência para o nada e a tela mostraria um link
      // quebrado se dizendo consertada.
      if (requerimentoUrl && storage?.existe) {
        const r = await vincularArquivoDocumentoTx(tx, {
          documentoId,
          solicitacaoId: solicitacao.id,
          stepInstanceId: p.id,
          protocoloId,
          documentTypeId: exigido?.documentoMestre.id ?? null,
          url: requerimentoUrl,
          nome: decodeURIComponent(requerimentoUrl.split("/").pop() ?? "requerimento"),
          mimeType: storage.mimeType,
          tamanho: storage.tamanho,
          tipo: exigido?.finalidade ?? "REQUERIMENTO_ENVIADO",
          criadoPorId: typeof op.completedById === "number" ? op.completedById : null,
        })
        achado.arquivoId = r.id
      }
      achado.solicitacaoId = solicitacao.id

      if (observacao) {
        await registrarObservacaoDocumentoTx(tx, {
          documentoId,
          solicitacaoId: solicitacao.id,
          stepInstanceId: p.id,
          texto: observacao,
          criadoPorId: typeof op.completedById === "number" ? op.completedById : null,
        })
      }

      // O link volta a significar o que o nome diz — só depois que o arquivo tem
      // registro próprio. Limpar antes seria PERDER a única pista do upload.
      if (achado.arquivoId) {
        await tx.documento.update({ where: { id: documentoId }, data: { link_acompanhamento: null } })
      }

      await tx.logAuditoria.create({
        data: {
          acao: "BACKFILL_SOLICITACAO_DOCUMENTO",
          entidade: "SolicitacaoDocumento",
          entidadeId: solicitacao.id,
          descricao: `Solicitação reconstruída a partir do registro operacional do passo ${p.id} (documento ${documentoId}).`,
          detalhes: {
            documentoId, stepInstanceId: p.id, canal, protocolo,
            requerimentoUrl, protocoloId, arquivoId: achado.arquivoId ?? null,
            documentTypeId: exigido?.documentoMestre.id ?? null,
            storage: storage ? { existe: storage.existe, status: storage.status, tamanho: storage.tamanho } : null,
            origem: "backfill-solicitacao-documental",
          } as Prisma.InputJsonValue,
          usuarioId: null,
        },
      })
    })

    feitos.push(achado)
    if (requerimentoUrl && storage && !storage.existe) semBinario.push(achado)
  }

  console.log(`\n  Já tinham solicitação: ${jaExistiam}`)
  console.log(`  ${EXECUTAR ? "Reconstruídas" : "Reconstruiria"}: ${feitos.length}`)
  for (const f of feitos) {
    console.log(
      `    · doc ${f.documentoId} / passo ${f.stepInstanceId} — canal=${f.canal} protocolo=${f.protocolo ?? "—"} ` +
        `destinatário=${f.destinatario ?? "—"}`,
    )
    console.log(
      `        solicitacaoId=${f.solicitacaoId ?? "—"} protocoloId=${f.protocoloId ?? "—"} ` +
        `arquivoId=${f.arquivoId ?? "—"} documentTypeId=${f.documentTypeId ?? "—"}`,
    )
    if (f.requerimentoUrl) {
      console.log(
        `        requerimento: ${f.storage?.existe ? "binário CONFIRMADO no storage" : "BINÁRIO AUSENTE"} ` +
          `(HTTP ${f.storage?.status ?? "?"}${f.storage?.tamanho ? `, ${f.storage.tamanho} B` : ""}) — ${f.requerimentoUrl}`,
      )
    } else {
      console.log("        requerimento: NENHUMA URL de upload encontrada no registro antigo.")
    }
  }

  if (reparados.length) {
    console.log(`\n  VÍNCULOS ${EXECUTAR ? "COMPLETADOS" : "A COMPLETAR"} em solicitações já existentes: ${reparados.length}`)
    for (const f of reparados) {
      console.log(
        `    · doc ${f.documentoId} / passo ${f.stepInstanceId} — solicitacaoId=${f.solicitacaoId} ` +
          `arquivoId=${f.arquivoId ?? "—"} documentTypeId=${f.documentTypeId ?? "—"} protocoloId=${f.protocoloId ?? "—"}`,
      )
    }
  }

  if (semBinario.length) {
    console.log(`\n  UPLOAD NÃO PERSISTIDO — precisa de reenvio manual: ${semBinario.length}`)
    console.log("  (a solicitação foi registrada; o ARQUIVO não, porque o binário não existe no storage.)")
    for (const f of semBinario) {
      console.log(`    ! doc ${f.documentoId} / passo ${f.stepInstanceId} — HTTP ${f.storage?.status ?? "?"} · ${f.requerimentoUrl}`)
    }
  }

  if (pulados.length) {
    console.log(`\n  PULADOS (reportados, nada inventado): ${pulados.length}`)
    for (const f of pulados) console.log(`    ! doc ${f.documentoId} / passo ${f.stepInstanceId} — ${f.motivoPulo}`)
  }
  if (!EXECUTAR) console.log("\n  (diagnóstico — nada foi escrito. Use --execute para aplicar.)")
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
