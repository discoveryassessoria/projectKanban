// src/services/categoria-servico-ref.ts
// ============================================================================
// CATEGORIA DO CATÁLOGO — resolução da REFERÊNCIA ESTRUTURAL.
//
// A categoria de um item do catálogo é uma entidade oficial (`CategoriaServico`,
// mantida em Gerenciamento › Serviços › Categorias). Este módulo é o único ponto
// que traduz o que chega numa requisição para o vínculo gravável, e ele aceita
// EXCLUSIVAMENTE o id oficial.
//
// O que este módulo NUNCA faz — e por quê:
//   • aceitar nome/label/slug de categoria: texto não identifica entidade; dois
//     cadastros com o mesmo nome tornariam a resolução ambígua e silenciosa;
//   • criar categoria a partir do que veio no payload: cadastro nasce no seu
//     próprio cadastro, com curadoria, nunca como efeito colateral de um POST;
//   • cair em fallback textual quando o id não existe: id inválido é erro 400.
// ============================================================================

import type { Prisma, PrismaClient } from '@prisma/client'

type DB = Prisma.TransactionClient | PrismaClient

async function clientePadrao(): Promise<DB> {
  const { prisma } = await import('@/lib/prisma')
  return prisma
}

/** Nomes de campo aceitos no body. Todos carregam ID — nenhum carrega texto. */
const CAMPOS_ID = ['categoriaId', 'categoriaServicoId'] as const

/**
 * Campos TEXTUAIS que representavam categoria antes da migração estrutural.
 * Continuam listados de propósito: se um cliente antigo mandar um deles, a API
 * responde um erro explícito em vez de ignorar em silêncio — o operador precisa
 * saber que aquela edição NÃO foi gravada.
 */
const CAMPOS_TEXTO_RECUSADOS = ['category', 'categoria', 'categoryName', 'categoriaNome'] as const

export interface ErroCategoria {
  campo: 'categoriaId'
  mensagem: string
}

export interface ResolucaoCategoria {
  /** id oficial, ou null quando o body declarou "sem categoria". */
  categoriaId: number | null
  /** O body declarou categoria? Se não, um PUT parcial não deve alterá-la. */
  declarado: boolean
  erros: ErroCategoria[]
}

/** Id válido (inteiro positivo) ou null. Texto nunca vira id. */
function idOuNulo(v: unknown): number | null | undefined {
  if (v === null || v === '') return null
  if (v === undefined) return undefined
  if (typeof v === 'boolean') return undefined
  const bruto = typeof v === 'object' ? (v as { id?: unknown }).id : v
  const n = Number(bruto)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return undefined
  return n
}

/**
 * Resolve a categoria declarada no body contra o cadastro oficial.
 * Uma query, e só quando há id para conferir.
 */
export async function resolverCategoriaServico(
  b: Record<string, unknown>,
  opcoes: { cliente?: DB } = {},
): Promise<ResolucaoCategoria> {
  const textoProibido = CAMPOS_TEXTO_RECUSADOS.find((c) => c in b)
  if (textoProibido) {
    return {
      categoriaId: null,
      declarado: true,
      erros: [{
        campo: 'categoriaId',
        mensagem: `Categoria deve ser enviada como \`categoriaId\` (id do cadastro oficial). O campo textual \`${textoProibido}\` não existe mais.`,
      }],
    }
  }

  const campo = CAMPOS_ID.find((c) => c in b)
  if (!campo) return { categoriaId: null, declarado: false, erros: [] }

  const id = idOuNulo(b[campo])
  if (id === undefined) {
    return {
      categoriaId: null,
      declarado: true,
      erros: [{ campo: 'categoriaId', mensagem: 'Categoria inválida: informe o id de uma categoria do cadastro oficial.' }],
    }
  }
  if (id === null) return { categoriaId: null, declarado: true, erros: [] }

  const db = opcoes.cliente ?? (await clientePadrao())
  const cat = await db.categoriaServico.findUnique({ where: { id }, select: { id: true, ativo: true } })
  if (!cat) {
    return { categoriaId: null, declarado: true, erros: [{ campo: 'categoriaId', mensagem: `Categoria inexistente no cadastro (#${id}).` }] }
  }
  if (!cat.ativo) {
    return { categoriaId: null, declarado: true, erros: [{ campo: 'categoriaId', mensagem: `Categoria inativa não pode ser selecionada (#${id}).` }] }
  }
  return { categoriaId: cat.id, declarado: true, erros: [] }
}
