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
} from "@/src/services/documento-arquivos"

const EXECUTAR = process.argv.includes("--execute")

interface Achado {
  documentoId: number
  stepInstanceId: number
  canal: string | null
  protocolo: string | null
  requerimentoUrl: string | null
  destinatario: string | null
  motivoPulo?: string
}

/** URL de arquivo enviado? O campo `link_acompanhamento` recebia as duas coisas. */
function pareceArquivoEnviado(url: string | null): boolean {
  if (!url) return false
  // O editor antigo subia para o R2 sob `documentos/{id}/solicitacao/...`; qualquer
  // outra coisa (portal do cartório, consulta pública) é link de acompanhamento mesmo.
  return /\/documentos\/\d+\/solicitacao\//.test(url)
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
  let jaExistiam = 0

  for (const p of passos) {
    const documentoId = p.documentoId as number
    const op = ((p.metadata ?? {}) as { operacao?: Record<string, unknown> }).operacao ?? {}

    const doc = await prisma.documento.findUnique({
      where: { id: documentoId },
      select: {
        id: true, pessoaId: true, cartorio: true, protocolo: true,
        canal_solicitacao: true, link_acompanhamento: true, observacoes: true,
      },
    })
    if (!doc) {
      pulados.push({ documentoId, stepInstanceId: p.id, canal: null, protocolo: null, requerimentoUrl: null, destinatario: null, motivoPulo: "documento inexistente" })
      continue
    }

    const chave = `solicitacao:doc${documentoId}:step${p.id}:ciclo${p.ciclo}`
    const existente = await prisma.solicitacaoDocumento.findUnique({ where: { chaveIdempotencia: chave }, select: { id: true } })
    if (existente) { jaExistiam++; continue }

    const canalTexto = (op.requestChannel as string | undefined) ?? doc.canal_solicitacao
    const canal = canalDoTexto(canalTexto)
    const protocolo = ((op.externalProtocol as string | undefined) ?? doc.protocolo ?? "").trim() || null
    const linkBruto = doc.link_acompanhamento
    const requerimentoUrl = pareceArquivoEnviado(linkBruto) ? linkBruto : null
    const destinatario = doc.cartorio?.trim() || null
    const observacao = ((op.notes as string | undefined) ?? doc.observacoes ?? "").trim() || null

    const achado: Achado = {
      documentoId, stepInstanceId: p.id,
      canal: canal ?? canalTexto ?? null,
      protocolo, requerimentoUrl, destinatario,
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

      if (protocolo) {
        await registrarProtocoloDaSolicitacaoTx(tx, {
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

      if (requerimentoUrl) {
        await vincularArquivoDocumentoTx(tx, {
          documentoId,
          solicitacaoId: solicitacao.id,
          stepInstanceId: p.id,
          url: requerimentoUrl,
          nome: decodeURIComponent(requerimentoUrl.split("/").pop() ?? "requerimento"),
          tipo: "REQUERIMENTO_ENVIADO",
          criadoPorId: typeof op.completedById === "number" ? op.completedById : null,
        })
      }

      if (observacao) {
        await registrarObservacaoDocumentoTx(tx, {
          documentoId,
          solicitacaoId: solicitacao.id,
          stepInstanceId: p.id,
          texto: observacao,
          criadoPorId: typeof op.completedById === "number" ? op.completedById : null,
        })
      }

      // O link volta a significar o que o nome diz.
      if (requerimentoUrl) {
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
            requerimentoUrl, origem: "backfill-solicitacao-documental",
          } as Prisma.InputJsonValue,
          usuarioId: null,
        },
      })
    })

    feitos.push(achado)
  }

  console.log(`\n  Já tinham solicitação: ${jaExistiam}`)
  console.log(`  ${EXECUTAR ? "Reconstruídas" : "Reconstruiria"}: ${feitos.length}`)
  for (const f of feitos) {
    console.log(
      `    · doc ${f.documentoId} / passo ${f.stepInstanceId} — canal=${f.canal} protocolo=${f.protocolo ?? "—"} ` +
        `requerimento=${f.requerimentoUrl ? "sim" : "NÃO ENCONTRADO"} destinatário=${f.destinatario ?? "—"}`,
    )
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
