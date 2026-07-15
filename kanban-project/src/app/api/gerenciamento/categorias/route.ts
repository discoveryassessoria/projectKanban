// src/app/api/gerenciamento/categorias/route.ts
// GET  - Listar categorias financeiras + mestres (para o select pesquisável por origem)
// POST - Criar categoria financeira REFERENCIANDO um cadastro mestre por FK.
//
// MDM — a Categoria Financeira NÃO é um cadastro independente de texto livre: ela
// APONTA para uma entidade mestre existente (Documento/Serviço/Honorário/Processo)
// por FK real. O `nome` é DERIVADO do mestre no servidor (nunca redigitado/confiável
// do cliente). Exatamente UMA origem é aceita (espelha o CHECK do banco).
// tipo = ENTRADA | SAIDA. Suporta categoria pai (subcategorias).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { Prisma } from '@prisma/client'

const TIPOS = ['ENTRADA', 'SAIDA']

const CAT_INCLUDE = {
  categoriaPai: { select: { id: true, nome: true } },
  tipoDocumento: { select: { id: true, name: true, code: true } },
  honorario: { select: { id: true, name: true, code: true } },
  tipoProcesso: { select: { id: true, name: true } },
  itemCatalogo: { select: { id: true, name: true, code: true } },
  _count: { select: { subcategorias: true, contasPagar: true, transacoes: true } },
} satisfies Prisma.CategoriaFinanceiraInclude

// GET - Listar
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    // Além das categorias, devolve os MESTRES para o select pesquisável por origem
    // (mesmo padrão de Configurações Financeiras / ProdutosTab).
    const [categorias, tiposDocumento, servicos, honorarios, tiposProcesso] = await Promise.all([
      prisma.categoriaFinanceira.findMany({
        orderBy: [{ tipo: 'asc' }, { nome: 'asc' }],
        include: CAT_INCLUDE,
      }),
      prisma.tipoDocumentoCadastro.findMany({ where: { ativo: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.itemCatalogo.findMany({ where: { natureza: 'SERVICO', ativo: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.honorario.findMany({ where: { ativo: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.tipoProcessoNacionalidade.findMany({ where: { ativo: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ])

    return NextResponse.json({ categorias, mestres: { tiposDocumento, servicos, honorarios, tiposProcesso } })
  } catch (error) {
    console.error('Erro ao listar categorias:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// Resolve a origem a partir do MESTRE escolhido: valida o ID, devolve o nome
// canônico (derivado) e o campo FK a gravar. Exatamente uma origem é aceita.
type OrigemResolvida = {
  origem: 'DOCUMENTO' | 'SERVICO' | 'HONORARIO' | 'PROCESSO'
  nome: string
  data: { tipoDocumentoId?: number; itemCatalogoId?: number; honorarioId?: number; tipoProcessoId?: number }
}
async function resolverMestre(b: any): Promise<OrigemResolvida | { error: string }> {
  const ids = {
    tipoDocumentoId: b.tipoDocumentoId ? Number(b.tipoDocumentoId) : null,
    itemCatalogoId: b.itemCatalogoId ? Number(b.itemCatalogoId) : null,
    honorarioId: b.honorarioId ? Number(b.honorarioId) : null,
    tipoProcessoId: b.tipoProcessoId ? Number(b.tipoProcessoId) : null,
  }
  const preenchidos = Object.entries(ids).filter(([, v]) => v != null)
  if (preenchidos.length === 0) return { error: 'Selecione a entidade mestre (origem). O nome vem dela.' }
  if (preenchidos.length > 1) return { error: 'Informe apenas UMA origem (documento, serviço, honorário ou processo).' }

  if (ids.tipoDocumentoId != null) {
    const m = await prisma.tipoDocumentoCadastro.findUnique({ where: { id: ids.tipoDocumentoId }, select: { name: true } })
    if (!m) return { error: 'Tipo de documento (mestre) não encontrado.' }
    return { origem: 'DOCUMENTO', nome: m.name, data: { tipoDocumentoId: ids.tipoDocumentoId } }
  }
  if (ids.itemCatalogoId != null) {
    const m = await prisma.itemCatalogo.findUnique({ where: { id: ids.itemCatalogoId }, select: { name: true, natureza: true } })
    if (!m) return { error: 'Serviço (mestre) não encontrado.' }
    if (m.natureza !== 'SERVICO') return { error: 'O item do catálogo selecionado não é um Serviço.' }
    return { origem: 'SERVICO', nome: m.name, data: { itemCatalogoId: ids.itemCatalogoId } }
  }
  if (ids.honorarioId != null) {
    const m = await prisma.honorario.findUnique({ where: { id: ids.honorarioId }, select: { name: true } })
    if (!m) return { error: 'Honorário (mestre) não encontrado.' }
    return { origem: 'HONORARIO', nome: m.name, data: { honorarioId: ids.honorarioId } }
  }
  const m = await prisma.tipoProcessoNacionalidade.findUnique({ where: { id: ids.tipoProcessoId! }, select: { name: true } })
  if (!m) return { error: 'Processo / Modalidade (mestre) não encontrado.' }
  return { origem: 'PROCESSO', nome: m.name, data: { tipoProcessoId: ids.tipoProcessoId! } }
}

// POST - Criar (sempre referenciando um mestre)
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const body = await request.json()
    const { tipo, cor, icone, descricao, categoriaPaiId, ativo } = body

    if (!TIPOS.includes(tipo)) {
      return NextResponse.json({ error: 'Tipo deve ser ENTRADA ou SAIDA' }, { status: 400 })
    }

    const resolvido = await resolverMestre(body)
    if ('error' in resolvido) {
      return NextResponse.json({ error: resolvido.error }, { status: 400 })
    }

    try {
      const categoria = await prisma.categoriaFinanceira.create({
        data: {
          nome: resolvido.nome, // DERIVADO do mestre — nunca do cliente
          tipo,
          origem: resolvido.origem,
          ...resolvido.data,
          cor: cor || null,
          icone: icone || null,
          descricao: descricao?.trim() || null,
          categoriaPaiId: categoriaPaiId ? Number(categoriaPaiId) : null,
          ativo: ativo === undefined ? true : !!ativo,
        },
        include: CAT_INCLUDE,
      })
      return NextResponse.json({ categoria }, { status: 201 })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return NextResponse.json({ error: 'Já existe uma categoria para este cadastro mestre e tipo.' }, { status: 409 })
      }
      throw e
    }
  } catch (error) {
    console.error('Erro ao criar categoria:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
