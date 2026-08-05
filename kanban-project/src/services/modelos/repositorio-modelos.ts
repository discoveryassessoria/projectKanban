// src/services/modelos/repositorio-modelos.ts
//
// REPOSITÓRIO OFICIAL DE MODELOS DOCUMENTAIS — escrita canônica.
//
// Aqui nascem os modelos, suas versões e os atos administrativos que mudam o
// estado de uma versão (publicar, revogar). É a ÚNICA implementação que grava
// `ModeloDocumental` e `ModeloDocumentalVersao`.
//
// TRÊS REGRAS QUE O CÓDIGO NÃO PODE AFROUXAR
// ------------------------------------------
// 1. Versão PUBLICADA é imutável. Não há caminho que altere o DOCX, o checksum
//    ou os placeholders de uma versão publicada — alteração cria versão nova.
// 2. Uma publicada por modelo, garantida por índice único parcial no banco.
// 3. Publicar exige passar pelo validador. Não existe "publicar mesmo assim".

import type { ModeloDocumentalCategoria, Prisma } from "@prisma/client"
import { prisma } from "@/src/lib/prisma"
import {
  gravarObjetoPrivado,
  lerObjetoPrivado,
  MIME_DOCX,
} from "@/src/lib/documentos/modelos/storage-privado"
import { validarTemplate, type ResultadoValidacaoTemplate } from "@/src/lib/documentos/modelos/validador"

export class ErroRepositorioModelos extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
    readonly detalhe?: unknown,
  ) {
    super(mensagem)
    this.name = "ErroRepositorioModelos"
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MODELO
// ════════════════════════════════════════════════════════════════════════════

export interface EntradaModelo {
  codigo: string
  nome: string
  descricao?: string | null
  categoria: ModeloDocumentalCategoria
  documentTypeId: number
  ativo?: boolean
}

export async function criarModelo(args: EntradaModelo & { usuarioId: number }) {
  const tipo = await prisma.tipoDocumentoCadastro.findUnique({
    where: { id: args.documentTypeId },
    select: { id: true },
  })
  if (!tipo) {
    throw new ErroRepositorioModelos(
      "TIPO_DOCUMENTAL_INEXISTENTE",
      "O tipo documental informado não existe no Cadastro Mestre de Documentos.",
    )
  }

  return prisma.modeloDocumental.create({
    data: {
      codigo: args.codigo.trim().toUpperCase(),
      nome: args.nome.trim(),
      descricao: args.descricao?.trim() || null,
      categoria: args.categoria,
      documentTypeId: args.documentTypeId,
      ativo: args.ativo ?? true,
      criadoPorId: args.usuarioId,
    },
  })
}

export async function atualizarModelo(
  id: number,
  args: Partial<Omit<EntradaModelo, "codigo">> & { codigo?: string },
) {
  return prisma.modeloDocumental.update({
    where: { id },
    data: {
      ...(args.codigo != null ? { codigo: args.codigo.trim().toUpperCase() } : {}),
      ...(args.nome != null ? { nome: args.nome.trim() } : {}),
      ...(args.descricao !== undefined ? { descricao: args.descricao?.trim() || null } : {}),
      ...(args.categoria != null ? { categoria: args.categoria } : {}),
      ...(args.documentTypeId != null ? { documentTypeId: args.documentTypeId } : {}),
      ...(args.ativo != null ? { ativo: args.ativo } : {}),
    },
  })
}

/** Modelos com a versão publicada resolvida — o que a tela de repositório lista. */
export async function listarModelos() {
  const modelos = await prisma.modeloDocumental.findMany({
    orderBy: [{ categoria: "asc" }, { nome: "asc" }],
    include: {
      documentType: { select: { id: true, name: true, publicCode: true } },
      versoes: {
        orderBy: { numero: "desc" },
        select: {
          id: true,
          numero: true,
          status: true,
          publicadoEm: true,
          criadoEm: true,
          checksum: true,
          publicadoPor: { select: { id: true, nome: true } },
        },
      },
    },
  })

  return modelos.map((m) => {
    const publicada = m.versoes.find((v) => v.status === "PUBLICADA") ?? null
    return {
      ...m,
      versaoPublicada: publicada,
      totalVersoes: m.versoes.length,
      ultimaPublicacao: publicada?.publicadoEm ?? null,
    }
  })
}

export async function obterModelo(id: number) {
  return prisma.modeloDocumental.findUnique({
    where: { id },
    include: {
      documentType: { select: { id: true, name: true, publicCode: true } },
      versoes: {
        orderBy: { numero: "desc" },
        include: {
          criadoPor: { select: { id: true, nome: true } },
          publicadoPor: { select: { id: true, nome: true } },
          revogadoPor: { select: { id: true, nome: true } },
          _count: { select: { geracoes: true } },
        },
      },
    },
  })
}

/** A versão que o motor de geração pode usar. Só existe uma; ou nenhuma. */
export async function versaoPublicadaDoModelo(
  modeloId: number,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return db.modeloDocumentalVersao.findFirst({
    where: { modeloId, status: "PUBLICADA" },
  })
}

// ════════════════════════════════════════════════════════════════════════════
// VERSÕES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Cria uma versão em RASCUNHO a partir de um DOCX.
 *
 * O arquivo é validado ANTES de existir versão: um pacote ilegível ou com
 * variável desconhecida não vira rascunho — vira erro com o motivo.
 */
export async function criarVersao(args: {
  modeloId: number
  docx: Buffer
  nomeArquivo: string
  observacao?: string | null
  usuarioId: number
}) {
  const modelo = await prisma.modeloDocumental.findUnique({
    where: { id: args.modeloId },
    select: { id: true, codigo: true },
  })
  if (!modelo) {
    throw new ErroRepositorioModelos("MODELO_INEXISTENTE", "Modelo não encontrado.")
  }

  const validacao = await validarTemplate(args.docx)
  const bloqueiaRascunho = validacao.achados.filter(
    (a) => a.severidade === "erro" && a.codigo !== "DADO_IDENTIFICACAO_NAO_DECLARADO",
  )
  if (bloqueiaRascunho.length > 0) {
    throw new ErroRepositorioModelos(
      "TEMPLATE_INVALIDO",
      "O DOCX enviado não pode virar versão.",
      bloqueiaRascunho,
    )
  }

  const objeto = await gravarObjetoPrivado({
    buffer: args.docx,
    nomeVisivel: args.nomeArquivo,
    mime: MIME_DOCX,
    pasta: "templates",
  })

  const ultima = await prisma.modeloDocumentalVersao.findFirst({
    where: { modeloId: args.modeloId },
    orderBy: { numero: "desc" },
    select: { numero: true },
  })

  return prisma.modeloDocumentalVersao.create({
    data: {
      modeloId: args.modeloId,
      numero: (ultima?.numero ?? 0) + 1,
      arquivoChave: objeto.chave,
      arquivoNome: objeto.nome,
      arquivoMime: objeto.mime,
      arquivoTamanho: objeto.tamanho,
      checksum: objeto.checksum,
      status: "RASCUNHO",
      placeholders: validacao.placeholders,
      obrigatorios: validacao.obrigatorios,
      opcionais: validacao.opcionais,
      observacao: args.observacao?.trim() || null,
      criadoPorId: args.usuarioId,
    },
  })
}

/** Dígitos de identificação que pertencem a clientes reais do cadastro. */
export async function digitosDeClientesReais(
  digitos: string[],
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string[]> {
  if (digitos.length === 0) return []

  // Comparação por DÍGITOS, não pela grafia: no cadastro o CPF aparece com e sem
  // pontuação, e é o número que identifica a pessoa.
  const encontrados = await db.$queryRaw<Array<{ d: string }>>`
    SELECT DISTINCT d FROM (
      SELECT regexp_replace(COALESCE(cpf,''), '\\D', '', 'g') AS d FROM "Contratante"
      UNION ALL
      SELECT regexp_replace(COALESCE(rg,''),  '\\D', '', 'g') FROM "Contratante"
      UNION ALL
      SELECT regexp_replace(COALESCE(cpf,''), '\\D', '', 'g') FROM "Requerente"
      UNION ALL
      SELECT regexp_replace(COALESCE(rg,''),  '\\D', '', 'g') FROM "Requerente"
    ) x
    WHERE d <> '' AND d = ANY(${digitos}::text[])
  `
  return encontrados.map((e) => e.d)
}

/** Validação completa de uma versão, já cruzada com o cadastro real. */
export async function validarVersao(args: {
  versaoId: number
  dadosFixosDeclarados?: string[]
}): Promise<{ validacao: ResultadoValidacaoTemplate; docx: Buffer }> {
  const versao = await prisma.modeloDocumentalVersao.findUnique({
    where: { id: args.versaoId },
    select: { arquivoChave: true, dadosFixosDeclarados: true },
  })
  if (!versao) throw new ErroRepositorioModelos("VERSAO_INEXISTENTE", "Versão não encontrada.")

  const docx = await lerObjetoPrivado(versao.arquivoChave)

  const declarados =
    args.dadosFixosDeclarados ?? (versao.dadosFixosDeclarados as string[] | null) ?? []

  const primeira = await validarTemplate(docx, { dadosFixosDeclarados: declarados })
  const reais = await digitosDeClientesReais(primeira.literais.map((l) => l.digitos))

  const validacao = await validarTemplate(docx, {
    dadosFixosDeclarados: declarados,
    digitosDeClientesReais: reais,
  })

  return { validacao, docx }
}

/**
 * PUBLICA a versão. Passa pelo validador, marca a publicada anterior como
 * REVOGADA e assume o lugar — tudo na mesma transação, para não existir instante
 * com duas publicadas nem instante com nenhuma.
 */
export async function publicarVersao(args: {
  versaoId: number
  dadosFixosDeclarados?: string[]
  usuarioId: number
}) {
  const { validacao } = await validarVersao({
    versaoId: args.versaoId,
    dadosFixosDeclarados: args.dadosFixosDeclarados,
  })
  if (!validacao.ok) {
    throw new ErroRepositorioModelos(
      "VALIDACAO_REPROVADA",
      "A versão não passou na validação e não pode ser publicada.",
      validacao.achados,
    )
  }

  return prisma.$transaction(async (tx) => {
    const versao = await tx.modeloDocumentalVersao.findUnique({
      where: { id: args.versaoId },
      select: { id: true, modeloId: true, status: true },
    })
    if (!versao) throw new ErroRepositorioModelos("VERSAO_INEXISTENTE", "Versão não encontrada.")
    if (versao.status === "REVOGADA") {
      throw new ErroRepositorioModelos(
        "VERSAO_REVOGADA",
        "Uma versão revogada não volta a ser publicada. Envie uma nova versão.",
      )
    }
    if (versao.status === "PUBLICADA") return versao

    const agora = new Date()

    const anterior = await tx.modeloDocumentalVersao.findFirst({
      where: { modeloId: versao.modeloId, status: "PUBLICADA" },
      select: { id: true },
    })
    if (anterior) {
      await tx.modeloDocumentalVersao.update({
        where: { id: anterior.id },
        data: {
          status: "REVOGADA",
          revogadoEm: agora,
          revogadoPorId: args.usuarioId,
          vigenteAte: agora,
        },
      })
    }

    const publicada = await tx.modeloDocumentalVersao.update({
      where: { id: versao.id },
      data: {
        status: "PUBLICADA",
        publicadoEm: agora,
        publicadoPorId: args.usuarioId,
        vigenteDe: agora,
        placeholders: validacao.placeholders,
        obrigatorios: validacao.obrigatorios,
        opcionais: validacao.opcionais,
        dadosFixosDeclarados: args.dadosFixosDeclarados ?? [],
      },
    })

    await tx.logAuditoria.create({
      data: {
        acao: "MODELO_VERSAO_PUBLICADA",
        entidade: "ModeloDocumentalVersao",
        entidadeId: publicada.id,
        descricao: `Versão ${publicada.numero} publicada (checksum ${publicada.checksum}).`,
        detalhes: {
          modeloId: publicada.modeloId,
          versaoAnteriorRevogadaId: anterior?.id ?? null,
          placeholders: validacao.placeholders,
        },
        usuarioId: args.usuarioId,
      },
    })

    return publicada
  })
}

export async function revogarVersao(args: {
  versaoId: number
  motivo?: string | null
  usuarioId: number
}) {
  return prisma.$transaction(async (tx) => {
    const versao = await tx.modeloDocumentalVersao.findUnique({
      where: { id: args.versaoId },
      select: { id: true, numero: true, modeloId: true, status: true },
    })
    if (!versao) throw new ErroRepositorioModelos("VERSAO_INEXISTENTE", "Versão não encontrada.")
    if (versao.status === "REVOGADA") return versao

    const agora = new Date()
    const revogada = await tx.modeloDocumentalVersao.update({
      where: { id: versao.id },
      data: {
        status: "REVOGADA",
        revogadoEm: agora,
        revogadoPorId: args.usuarioId,
        vigenteAte: agora,
        observacao: args.motivo?.trim() || undefined,
      },
    })

    await tx.logAuditoria.create({
      data: {
        acao: "MODELO_VERSAO_REVOGADA",
        entidade: "ModeloDocumentalVersao",
        entidadeId: revogada.id,
        descricao: `Versão ${revogada.numero} revogada.`,
        detalhes: { modeloId: revogada.modeloId, motivo: args.motivo ?? null },
        usuarioId: args.usuarioId,
      },
    })

    return revogada
  })
}
