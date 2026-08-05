// src/services/modelos/gerar-documento.ts
//
// MOTOR ÚNICO DE GERAÇÃO DOCUMENTAL.
//
// Existe UM caminho para produzir documento a partir de modelo. A prévia usa
// este motor; a geração oficial usa este motor; a ação dentro do processo usa
// este motor. Não há gerador dentro do cliente e outro dentro do processo — há
// um serviço e duas entradas.
//
// ORDEM DOS ATOS, E POR QUE ELA É ESSA
// ------------------------------------
// Tudo que pode falhar falha ANTES de existir registro: resolver a versão
// publicada, conferir o cadastro, montar o DOCX, renderizar o PDF, provar que
// nenhum placeholder sobrou. Só então os binários sobem, e só então a transação
// grava. Se a transação falhar, os binários recém-subidos são removidos — o que
// impede o único órfão possível neste desenho.
//
// O QUE ESTE MOTOR NÃO FAZ
// ------------------------
// Não cria Documento Operacional, não materializa passo, não move fase, não
// toca obrigação. O documento gerado é um artefato do cadastro do cliente que
// PODE ser vinculado a um documento operacional existente (ato explícito, em
// `vincular-documento.ts`) — nunca um documento que nasce sozinho dentro do
// runtime documental.

import { createHash } from "crypto"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/src/lib/prisma"
import {
  substituirPlaceholdersDocx,
} from "@/src/lib/documentos/modelos/docx"
import { nenhumPlaceholderRestante } from "@/src/lib/documentos/modelos/validador"
import { pdfDoDocx } from "@/src/lib/documentos/modelos/pdf"
import {
  checksumDoBuffer,
  gravarObjetoPrivado,
  lerObjetoPrivado,
  removerObjetoPrivado,
  MIME_DOCX,
  MIME_PDF,
} from "@/src/lib/documentos/modelos/storage-privado"
import {
  carregarCadastroOutorgante,
  resolverOutorgante,
  type AtoDeEmissao,
  type ItemChecklist,
  type ReferenciaOutorgante,
} from "./outorgante"

export class ErroGeracao extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
    readonly detalhe?: unknown,
  ) {
    super(mensagem)
    this.name = "ErroGeracao"
  }
}

export interface PedidoDeGeracao {
  modeloId: number
  outorgante: ReferenciaOutorgante
  processoId?: number | null
  servicoId?: number | null
  ato: AtoDeEmissao
  usuarioId: number
  /** Chave de idempotência do cliente. Ausente = derivada do conteúdo. */
  chaveIdempotencia?: string | null
}

// ════════════════════════════════════════════════════════════════════════════
// PREPARO — a parte comum entre prévia e geração oficial
// ════════════════════════════════════════════════════════════════════════════

interface Preparo {
  modelo: { id: number; nome: string; codigo: string; documentTypeId: number; ativo: boolean }
  versao: { id: number; numero: number; arquivoChave: string; placeholders: string[] }
  checklist: ItemChecklist[]
  pendencias: ItemChecklist[]
  valores: Record<string, string>
  cadastroNome: string
  pessoaId: number | null
}

async function prepararGeracao(
  pedido: Omit<PedidoDeGeracao, "usuarioId" | "chaveIdempotencia">,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Preparo> {
  const modelo = await db.modeloDocumental.findUnique({
    where: { id: pedido.modeloId },
    select: { id: true, nome: true, codigo: true, documentTypeId: true, ativo: true },
  })
  if (!modelo) throw new ErroGeracao("MODELO_INEXISTENTE", "Modelo não encontrado.")
  if (!modelo.ativo) {
    throw new ErroGeracao("MODELO_INATIVO", "Este modelo está inativo e não gera documento.")
  }

  const versao = await db.modeloDocumentalVersao.findFirst({
    where: { modeloId: modelo.id, status: "PUBLICADA" },
    select: { id: true, numero: true, arquivoChave: true, placeholders: true },
  })
  if (!versao) {
    throw new ErroGeracao(
      "SEM_VERSAO_PUBLICADA",
      "O modelo não tem versão publicada. Publique uma versão antes de gerar.",
    )
  }

  const cadastro = await carregarCadastroOutorgante(pedido.outorgante, db)
  if (!cadastro) {
    throw new ErroGeracao("OUTORGANTE_INEXISTENTE", "O outorgante informado não existe no cadastro.")
  }

  if (pedido.processoId != null) {
    const processo = await db.processo.findUnique({
      where: { id: pedido.processoId },
      select: { id: true },
    })
    if (!processo) throw new ErroGeracao("PROCESSO_INEXISTENTE", "Processo não encontrado.")
  }

  if (pedido.servicoId != null) {
    const servico = await db.servicoProduto.findUnique({
      where: { id: pedido.servicoId },
      select: { id: true },
    })
    if (!servico) throw new ErroGeracao("SERVICO_INEXISTENTE", "Serviço não encontrado.")
  }

  const placeholders = (versao.placeholders as string[] | null) ?? []
  const resolucao = resolverOutorgante({
    cadastro,
    ato: pedido.ato,
    variaveisDoTemplate: placeholders,
  })

  return {
    modelo,
    versao: { ...versao, placeholders },
    checklist: resolucao.checklist,
    pendencias: resolucao.pendencias,
    valores: resolucao.valores,
    cadastroNome: cadastro.nome,
    pessoaId: cadastro.pessoaId,
  }
}

/** Checklist sem gerar nada — o que a tela mostra antes do botão. */
export async function validarAntesDeGerar(
  pedido: Omit<PedidoDeGeracao, "usuarioId" | "chaveIdempotencia">,
) {
  const preparo = await prepararGeracao(pedido)
  return {
    modelo: preparo.modelo,
    versao: { id: preparo.versao.id, numero: preparo.versao.numero },
    checklist: preparo.checklist,
    pendencias: preparo.pendencias,
    podeGerar: preparo.pendencias.length === 0,
  }
}

interface Artefatos {
  docx: Buffer
  pdf: Buffer
  docxChecksum: string
  pdfChecksum: string
  preparo: Preparo
}

/** Produz os dois binários. NÃO persiste nada e NÃO sobe nada. */
async function produzirArtefatos(
  pedido: Omit<PedidoDeGeracao, "usuarioId" | "chaveIdempotencia">,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Artefatos> {
  const preparo = await prepararGeracao(pedido, db)

  if (preparo.pendencias.length > 0) {
    throw new ErroGeracao(
      "DADOS_INSUFICIENTES",
      "O cadastro do outorgante não tem todos os dados exigidos por este modelo.",
      preparo.pendencias,
    )
  }

  const template = await lerObjetoPrivado(preparo.versao.arquivoChave)
  const resultado = await substituirPlaceholdersDocx(template, preparo.valores)

  if (resultado.naoResolvidas.length > 0) {
    throw new ErroGeracao(
      "VARIAVEL_SEM_VALOR",
      "O template usa variáveis que não foram resolvidas.",
      resultado.naoResolvidas,
    )
  }

  const restantes = await nenhumPlaceholderRestante(resultado.buffer)
  if (restantes.length > 0) {
    throw new ErroGeracao(
      "PLACEHOLDER_REMANESCENTE",
      "O documento final ainda contém variáveis não substituídas.",
      restantes,
    )
  }

  const pdf = await pdfDoDocx(resultado.buffer)

  // Provas mínimas de que os dois arquivos são o que dizem ser.
  if (resultado.buffer.length === 0 || resultado.buffer.subarray(0, 2).toString() !== "PK") {
    throw new ErroGeracao("DOCX_INVALIDO", "O DOCX gerado não é um pacote válido.")
  }
  if (pdf.length === 0 || pdf.subarray(0, 5).toString() !== "%PDF-") {
    throw new ErroGeracao("PDF_INVALIDO", "O PDF gerado não é um arquivo válido.")
  }

  return {
    docx: resultado.buffer,
    pdf,
    docxChecksum: checksumDoBuffer(resultado.buffer),
    pdfChecksum: checksumDoBuffer(pdf),
    preparo,
  }
}

/**
 * PRÉVIA — mesmo motor, sem persistência.
 *
 * Devolve os bytes do PDF para exibição imediata. Nada é gravado: nem versão,
 * nem arquivo no storage, nem registro. É por isso que a prévia não pode
 * divergir do documento final: ela É o documento final, apenas não guardado.
 */
export async function gerarPrevia(
  pedido: Omit<PedidoDeGeracao, "usuarioId" | "chaveIdempotencia">,
): Promise<{
  pdf: Buffer
  docxChecksum: string
  pdfChecksum: string
  modelo: Preparo["modelo"]
  versaoNumero: number
  checklist: ItemChecklist[]
}> {
  const art = await produzirArtefatos(pedido)
  return {
    pdf: art.pdf,
    docxChecksum: art.docxChecksum,
    pdfChecksum: art.pdfChecksum,
    modelo: art.preparo.modelo,
    versaoNumero: art.preparo.versao.numero,
    checklist: art.preparo.checklist,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// GERAÇÃO OFICIAL
// ════════════════════════════════════════════════════════════════════════════

/**
 * Identidade do agregado: tipo documental + outorgante + processo.
 *
 * É esta chave que faz "uma versão vigente por pessoa + tipo + processo" ser
 * verdade — gerar de novo cai no MESMO agregado e cria versão, em vez de criar
 * um segundo documento rival.
 */
export function chaveDeIdentidade(args: {
  documentTypeId: number
  outorgante: ReferenciaOutorgante
  processoId?: number | null
}): string {
  return [
    `tipo:${args.documentTypeId}`,
    `out:${args.outorgante.papel}:${args.outorgante.id}`,
    `proc:${args.processoId ?? "-"}`,
  ].join("|")
}

function chaveDeIdempotencia(args: {
  modeloVersaoId: number
  identidade: string
  docxChecksum: string
}): string {
  return createHash("sha256")
    .update(`${args.identidade}|versao:${args.modeloVersaoId}|${args.docxChecksum}`)
    .digest("hex")
}

export interface ResultadoGeracao {
  documentoGeradoId: number
  versaoId: number
  versaoNumero: number
  /** false = a mesma geração já existia (duplo clique/retry). */
  criado: boolean
}

export async function gerarDocumento(pedido: PedidoDeGeracao): Promise<ResultadoGeracao> {
  const art = await produzirArtefatos(pedido)
  const { preparo } = art

  const identidade = chaveDeIdentidade({
    documentTypeId: preparo.modelo.documentTypeId,
    outorgante: pedido.outorgante,
    processoId: pedido.processoId ?? null,
  })

  const chaveIdem =
    pedido.chaveIdempotencia?.trim() ||
    chaveDeIdempotencia({
      modeloVersaoId: preparo.versao.id,
      identidade,
      docxChecksum: art.docxChecksum,
    })

  // Retry que chega depois do commit não sobe binário de novo.
  const jaExiste = await prisma.documentoGeradoVersao.findUnique({
    where: { chaveIdempotencia: chaveIdem },
    select: { id: true, numero: true, documentoGeradoId: true },
  })
  if (jaExiste) {
    return {
      documentoGeradoId: jaExiste.documentoGeradoId,
      versaoId: jaExiste.id,
      versaoNumero: jaExiste.numero,
      criado: false,
    }
  }

  const baseNome = `${preparo.modelo.codigo}-${preparo.cadastroNome}`
  const objetoDocx = await gravarObjetoPrivado({
    buffer: art.docx,
    nomeVisivel: `${baseNome}.docx`,
    mime: MIME_DOCX,
    pasta: "gerados",
  })
  let objetoPdf: Awaited<ReturnType<typeof gravarObjetoPrivado>> | null = null

  try {
    objetoPdf = await gravarObjetoPrivado({
      buffer: art.pdf,
      nomeVisivel: `${baseNome}.pdf`,
      mime: MIME_PDF,
      pasta: "gerados",
    })

    return await prisma.$transaction(async (tx) => {
      const agregado = await tx.documentoGerado.upsert({
        where: { chaveIdentidade: identidade },
        create: {
          modeloId: preparo.modelo.id,
          documentTypeId: preparo.modelo.documentTypeId,
          contratanteId: pedido.outorgante.papel === "contratante" ? pedido.outorgante.id : null,
          requerenteId: pedido.outorgante.papel === "requerente" ? pedido.outorgante.id : null,
          pessoaId: preparo.pessoaId,
          processoId: pedido.processoId ?? null,
          servicoId: pedido.servicoId ?? null,
          chaveIdentidade: identidade,
          criadoPorId: pedido.usuarioId,
        },
        update: {
          // O agregado acompanha o modelo vigente e o serviço informado; o que
          // ele NUNCA muda é o outorgante e o processo — isso é a identidade.
          modeloId: preparo.modelo.id,
          pessoaId: preparo.pessoaId,
          servicoId: pedido.servicoId ?? undefined,
          status: "VIGENTE",
        },
        select: { id: true },
      })

      // Serializa gerações concorrentes do MESMO agregado: sem isto, dois
      // cliques simultâneos calculariam o mesmo número de versão.
      await tx.$queryRaw`SELECT id FROM "DocumentoGerado" WHERE id = ${agregado.id} FOR UPDATE`

      const ultima = await tx.documentoGeradoVersao.findFirst({
        where: { documentoGeradoId: agregado.id },
        orderBy: { numero: "desc" },
        select: { numero: true },
      })
      const vigenteAnterior = await tx.documentoGeradoVersao.findFirst({
        where: { documentoGeradoId: agregado.id, status: "VIGENTE" },
        select: { id: true },
      })

      // A anterior sai de VIGENTE ANTES de a nova entrar — o índice único
      // parcial não admite as duas ao mesmo tempo, e é essa a intenção.
      if (vigenteAnterior) {
        await tx.documentoGeradoVersao.update({
          where: { id: vigenteAnterior.id },
          data: { status: "SUBSTITUIDA", substituidaEm: new Date() },
        })
      }

      const versao = await tx.documentoGeradoVersao.create({
        data: {
          documentoGeradoId: agregado.id,
          numero: (ultima?.numero ?? 0) + 1,
          modeloVersaoId: preparo.versao.id,
          docxChave: objetoDocx.chave,
          docxNome: objetoDocx.nome,
          docxChecksum: art.docxChecksum,
          docxTamanho: objetoDocx.tamanho,
          pdfChave: objetoPdf!.chave,
          pdfNome: objetoPdf!.nome,
          pdfChecksum: art.pdfChecksum,
          pdfTamanho: objetoPdf!.tamanho,
          dadosSnapshot: montarSnapshot(pedido, preparo, art),
          status: "VIGENTE",
          geradoPorId: pedido.usuarioId,
          chaveIdempotencia: chaveIdem,
        },
        select: { id: true, numero: true },
      })

      if (vigenteAnterior) {
        await tx.documentoGeradoVersao.update({
          where: { id: vigenteAnterior.id },
          data: { substituidaPorId: versao.id },
        })
      }

      if (pedido.processoId != null) {
        await tx.evento.create({
          data: {
            processoId: pedido.processoId,
            titulo: `${preparo.modelo.nome} gerada`,
            descricao: `Versão ${versao.numero} para ${preparo.cadastroNome}.`,
            tipo: "ENTREGA_DOCUMENTO",
            dataInicio: new Date(),
            diaInteiro: true,
            status: "CONFIRMADO",
            responsavelId: pedido.usuarioId,
          },
        })
      }

      await tx.logAuditoria.create({
        data: {
          acao: "DOCUMENTO_GERADO",
          entidade: "DocumentoGeradoVersao",
          entidadeId: versao.id,
          // Sem CPF/RG na descrição nem nos detalhes: auditoria registra o ATO,
          // não os dados pessoais que o documento carrega.
          descricao: `${preparo.modelo.nome} — versão ${versao.numero} gerada a partir do modelo ${preparo.modelo.codigo} v${preparo.versao.numero}.`,
          detalhes: {
            documentoGeradoId: agregado.id,
            modeloId: preparo.modelo.id,
            modeloVersaoId: preparo.versao.id,
            documentTypeId: preparo.modelo.documentTypeId,
            outorgante: { papel: pedido.outorgante.papel, id: pedido.outorgante.id },
            processoId: pedido.processoId ?? null,
            docxChecksum: art.docxChecksum,
            pdfChecksum: art.pdfChecksum,
          },
          usuarioId: pedido.usuarioId,
        },
      })

      return {
        documentoGeradoId: agregado.id,
        versaoId: versao.id,
        versaoNumero: versao.numero,
        criado: true,
      }
    })
  } catch (erro) {
    // Compensação: a transação não gravou nada, então os binários que subiram
    // não pertencem a ninguém. Some com eles — é o que evita órfão no storage.
    await removerObjetoPrivado(objetoDocx.chave).catch(() => {})
    if (objetoPdf) await removerObjetoPrivado(objetoPdf.chave).catch(() => {})
    throw erro
  }
}

/**
 * Snapshot imutável dos dados de origem.
 *
 * Guarda os IDS, não só os textos: sem eles o snapshot seria um retrato sem
 * procedência, impossível de conferir contra o cadastro anos depois.
 */
function montarSnapshot(
  pedido: PedidoDeGeracao,
  preparo: Preparo,
  art: Artefatos,
): Prisma.InputJsonValue {
  return {
    origem: {
      modeloId: preparo.modelo.id,
      modeloCodigo: preparo.modelo.codigo,
      modeloVersaoId: preparo.versao.id,
      documentTypeId: preparo.modelo.documentTypeId,
      outorgantePapel: pedido.outorgante.papel,
      outorganteId: pedido.outorgante.id,
      pessoaId: preparo.pessoaId,
      processoId: pedido.processoId ?? null,
      servicoId: pedido.servicoId ?? null,
      usuarioId: pedido.usuarioId,
    },
    ato: {
      localEmissao: pedido.ato.localEmissao,
      dataEmissao:
        pedido.ato.dataEmissao instanceof Date
          ? pedido.ato.dataEmissao.toISOString()
          : pedido.ato.dataEmissao,
    },
    variaveis: preparo.valores,
    arquivos: { docxChecksum: art.docxChecksum, pdfChecksum: art.pdfChecksum },
  }
}
