// src/services/efeitos-de-dominio.ts
// ============================================================================
// O QUE CADA EFEITO FAZ DE FATO.
//
// Um efeito é a ÚNICA coisa que uma ação cadastrada consegue disparar. Por isso ele
// é código: revisado, testado, idempotente, e sem parâmetro que permita escapar do
// que ele diz que faz. O administrador escolhe entre estes; não escreve nenhum.
//
// Todo efeito aqui delega às portas canônicas que já existem — não escreve estado de
// passo, de tarefa ou de fase por conta própria. Se ele precisasse fazer isso,
// seria uma segunda máquina, e o sistema já pagou caro por ter tido duas.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { StatusDocumento } from "@prisma/client"
import { reopenPhase } from "@/src/lib/motor/phase-advance"

export interface AlvoDoEfeito {
  stepInstanceId: number
  documentoId: number | null
  processoId: number
  valores: Record<string, unknown>
  usuarioId: number | null
  sync: { origem: "USER"; usuarioId?: number; correlationId: string }
}

function texto(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : ""
  return s === "" ? null : s
}

/** Anota no documento, de forma idempotente pela chave do ato. */
async function observar(a: AlvoDoEfeito, chave: string, corpo: string) {
  if (!a.documentoId) return
  await prisma.documentoObservacao.createMany({
    data: [{
      documentoId: a.documentoId, stepInstanceId: a.stepInstanceId, texto: corpo,
      criadoPorId: a.usuarioId,
      chaveIdempotencia: `efeito|${chave}|si${a.stepInstanceId}|${a.sync.correlationId}`,
    }],
    skipDuplicates: true,
  })
}

/**
 * MUDA O STATUS DO DOCUMENTO — o único lugar deste módulo que escreve nele.
 *
 * Idempotente: se já está no destino, não escreve nem registra de novo.
 */
async function status(a: AlvoDoEfeito, destino: StatusDocumento): Promise<boolean> {
  if (!a.documentoId) return false
  const r = await prisma.documento.updateMany({
    where: { id: a.documentoId, status: { not: destino } },
    data: { status: destino, ultimaMovimentacao: new Date() },
  })
  return r.count > 0
}

export async function marcarDocumentoRecebido(a: AlvoDoEfeito) {
  const mudou = await status(a, "RECEBIDO")
  await observar(a, "recebido", `Documento registrado como recebido.${texto(a.valores.observacao) ? ` ${texto(a.valores.observacao)}` : ""}`)
  return { documentoId: a.documentoId, statusAlterado: mudou, novoStatus: "RECEBIDO" }
}

export async function aprovarParaAnalise(a: AlvoDoEfeito) {
  // A EMISSÃO ENTREGA; NÃO JULGA. O documento sai da conferência operacional pronto
  // para a Análise, e é a Análise que decide se ele serve juridicamente.
  const mudou = await status(a, "EM_ANALISE")
  await observar(a, "aprovado-analise",
    `Conferência operacional aprovada; documento liberado para a Análise Documental.${texto(a.valores.observacao) ? ` ${texto(a.valores.observacao)}` : ""}`)
  return { documentoId: a.documentoId, statusAlterado: mudou, novoStatus: "EM_ANALISE" }
}

export async function concluirDocumento(a: AlvoDoEfeito) {
  const mudou = await status(a, "RECEBIDO")
  await observar(a, "concluido", "Documento dado por concluído para o que o processo precisa dele.")
  return { documentoId: a.documentoId, statusAlterado: mudou }
}

/**
 * INVALIDAR NÃO É CONCLUIR. O documento não serve; a obrigação continua aberta, e é
 * por isso que este efeito não fecha o passo.
 */
export async function invalidarDocumento(a: AlvoDoEfeito) {
  const mudou = await status(a, "INVALIDO")
  await observar(a, "invalidado", `Documento invalidado. Motivo: ${texto(a.valores.motivo) ?? "não informado"}.`)
  return { documentoId: a.documentoId, statusAlterado: mudou, novoStatus: "INVALIDO" }
}

/**
 * NOVA VIA — o documento anterior CONTINUA EXISTINDO.
 *
 * Antes, pedir outra via reaproveitava a mesma linha: o que a primeira via dizia
 * desaparecia. Aqui nasce um documento novo, ligado ao anterior por `derivadoDeId`, e
 * o anterior é marcado como substituído — legível, apenas não mais o vigente.
 *
 * A NECESSIDADE É A MESMA. Ela descreve o que o processo precisa ("a certidão de
 * nascimento do Ademir"), e isso não mudou por a primeira via ter vindo ilegível.
 * Duplicá-la faria o processo passar a exigir duas certidões.
 *
 * IDEMPOTENTE: duas chamadas do mesmo comando não criam duas vias — a segunda
 * encontra a via já derivada desta origem com esta correlação.
 */
export async function novaViaDocumental(a: AlvoDoEfeito) {
  if (!a.documentoId) return { criado: null, motivo: "Etapa sem documento vinculado." }
  const origem = await prisma.documento.findUnique({ where: { id: a.documentoId } })
  if (!origem) return { criado: null, motivo: "Documento de origem não encontrado." }

  const marca = `[nova-via:${a.sync.correlationId}]`
  const jaFeito = await prisma.documento.findFirst({
    where: { derivadoDeId: origem.id, observacoes: { contains: marca } },
    select: { id: true },
  })
  if (jaFeito) return { criado: jaFeito.id, jaExistia: true, origemId: origem.id, necessidadeId: origem.necessidadeId }

  const motivo = texto(a.valores.motivo) ?? "não informado"
  const novo = await prisma.$transaction(async (tx) => {
    const criado = await tx.documento.create({
      data: {
        pessoaId: origem.pessoaId,
        tipo: origem.tipo,
        documentTypeId: origem.documentTypeId,
        // MESMA NECESSIDADE — a nova via atende ao mesmo requisito do processo.
        necessidadeId: origem.necessidadeId,
        descricao: origem.descricao,
        cartorio: origem.cartorio,
        livro: origem.livro, folha: origem.folha, termo: origem.termo,
        numero_registro: origem.numero_registro,
        cidade_registro: origem.cidade_registro, estado_registro: origem.estado_registro,
        pais_registro: origem.pais_registro,
        status: "SOLICITAR",
        derivadoDeId: origem.id,
        derivacaoTipo: "NOVA_VIA",
        observacoes: `Nova via de ${origem.publicCode ?? `documento #${origem.id}`}. Motivo: ${motivo}. ${marca}`,
        origem: "automatica",
      },
      select: { id: true },
    })
    // O ANTERIOR NÃO É APAGADO NEM REBAIXADO DE STATUS: ele fica como está, e apenas
    // deixa de ser o vigente da necessidade. O que ele dizia continua consultável.
    await tx.documento.update({ where: { id: origem.id }, data: { substituidoEm: new Date() } })
    return criado
  })

  await observar(a, "nova-via", `Nova via solicitada (documento #${novo.id}). Motivo: ${motivo}. Esta via continua consultável.`)
  return { criado: novo.id, origemId: origem.id, necessidadeId: origem.necessidadeId, jaExistia: false }
}

/**
 * REGISTRAR DIVERGÊNCIA — anota o que não bate. NÃO decide retificação.
 *
 * A separação é o ponto: constatar que o nome do pai diverge é trabalho de
 * comparação; concluir que o registro precisa ser corrigido é decisão jurídica, e
 * tem efeito próprio (`GO_RETIFICATION`) com competência própria.
 */
export async function registrarDivergencia(a: AlvoDoEfeito) {
  const descricao = texto(a.valores.descricao) ?? "sem descrição"
  const criticidade = texto(a.valores.criticidade) ?? "não classificada"
  await observar(a, "divergencia", `Divergência registrada (${criticidade}): ${descricao}`)
  return { registrada: true, criticidade }
}

/**
 * DECIDIR PELA RETIFICAÇÃO — competência da Análise Documental, e só dela.
 *
 * Ativa a fase de Retificação pelo motor de fases, com justificativa. O executor não
 * mexe em fase: ele pede ao motor, que é quem decide se pode.
 */
export async function decidirRetificacao(a: AlvoDoEfeito) {
  const justificativa = texto(a.valores.justificativa) ?? "Decisão da Análise Documental."
  if (a.documentoId) {
    await status(a, "RETIFICANDO")
    await observar(a, "retificacao", `Análise decidiu pela retificação do registro. ${justificativa}`)
  }
  const r = await reopenPhase(a.processoId, {
    justificativa, motivoCodigo: "DECISAO_ANALISE",
    solicitadoPorId: a.usuarioId ?? undefined,
    origem: "analise_documental",
  } as never)
  return { faseAtualizada: r.success && r.changed, resultado: r.success ? r.resultado : r.code }
}
