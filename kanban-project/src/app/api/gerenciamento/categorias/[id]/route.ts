// src/app/api/gerenciamento/categorias/[id]/route.ts
// PUT    - Atualizar categoria
// DELETE - Excluir categoria (bloqueia se estiver em uso)
//
// ✅ Next 15: params é Promise → await params.
// MDM — o nome é DERIVADO do mestre; não há texto livre. Ao editar:
//   • categoria JÁ vinculada a um mestre → origem/mestre TRAVADOS; nome é
//     re-sincronizado do mestre (tipo/cor/descrição/pai/status editáveis);
//   • categoria LEGADA (sem FK) → é possível ATRIBUIR um mestre (migra a linha).
// ⚠ CategoriaFinanceira TEM relações (subcategorias, contasPagar, transacoes),
//    então só excluímos se não estiver em uso.

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

type Resolvido = {
  origem: 'DOCUMENTO' | 'SERVICO' | 'HONORARIO' | 'PROCESSO'
  nome: string
  data: { tipoDocumentoId?: number; itemCatalogoId?: number; honorarioId?: number; tipoProcessoId?: number }
}
async function resolverMestre(b: any): Promise<Resolvido | { error: string } | null> {
  const ids = {
    tipoDocumentoId: b.tipoDocumentoId ? Number(b.tipoDocumentoId) : null,
    itemCatalogoId: b.itemCatalogoId ? Number(b.itemCatalogoId) : null,
    honorarioId: b.honorarioId ? Number(b.honorarioId) : null,
    tipoProcessoId: b.tipoProcessoId ? Number(b.tipoProcessoId) : null,
  }
  const preenchidos = Object.entries(ids).filter(([, v]) => v != null)
  if (preenchidos.length === 0) return null
  if (preenchidos.length > 1) return { error: 'Informe apenas UMA origem.' }
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

// nome canônico atual, derivado do mestre já vinculado (mantém sincronia)
function nomeDoMestre(atual: Prisma.CategoriaFinanceiraGetPayload<{ include: typeof CAT_INCLUDE }>): string | null {
  return atual.tipoDocumento?.name ?? atual.itemCatalogo?.name ?? atual.honorario?.name ?? atual.tipoProcesso?.name ?? null
}

// PUT - Atualizar
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idParam } = await params
    const id = Number(idParam)
    if (!id || Number.isNaN(id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const atual = await prisma.categoriaFinanceira.findUnique({ where: { id }, include: CAT_INCLUDE })
    if (!atual) {
      return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 404 })
    }

    const body = await request.json()
    const { tipo, cor, icone, descricao, categoriaPaiId, ativo } = body

    if (tipo !== undefined && !TIPOS.includes(tipo)) {
      return NextResponse.json({ error: 'Tipo deve ser ENTRADA ou SAIDA' }, { status: 400 })
    }
    const novoPaiId = categoriaPaiId ? Number(categoriaPaiId) : null
    if (novoPaiId === id) {
      return NextResponse.json({ error: 'Uma categoria não pode ser pai de si mesma' }, { status: 400 })
    }

    const temMestre = atual.origem !== 'LEGADO'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dataMestre: any = {}
    let nome = atual.nome

    if (temMestre) {
      // origem/mestre TRAVADOS — apenas re-sincroniza o nome com o mestre
      nome = nomeDoMestre(atual) ?? atual.nome
    } else {
      // legado: pode ATRIBUIR um mestre (migra a linha). Sem mestre, mantém o nome atual.
      const r = await resolverMestre(body)
      if (r && 'error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
      if (r) {
        nome = r.nome
        dataMestre.origem = r.origem
        dataMestre.tipoDocumentoId = r.data.tipoDocumentoId ?? null
        dataMestre.itemCatalogoId = r.data.itemCatalogoId ?? null
        dataMestre.honorarioId = r.data.honorarioId ?? null
        dataMestre.tipoProcessoId = r.data.tipoProcessoId ?? null
      }
    }

    try {
      const categoria = await prisma.categoriaFinanceira.update({
        where: { id },
        data: {
          nome,
          ...dataMestre,
          tipo: tipo ?? atual.tipo,
          cor: cor !== undefined ? (cor || null) : atual.cor,
          icone: icone !== undefined ? (icone || null) : atual.icone,
          descricao: descricao !== undefined ? (descricao?.trim() || null) : atual.descricao,
          categoriaPaiId: categoriaPaiId !== undefined ? novoPaiId : atual.categoriaPaiId,
          ativo: ativo !== undefined ? !!ativo : atual.ativo,
        },
        include: CAT_INCLUDE,
      })
      return NextResponse.json({ categoria })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return NextResponse.json({ error: 'Já existe uma categoria para este cadastro mestre e tipo.' }, { status: 409 })
      }
      throw e
    }
  } catch (error) {
    console.error('Erro ao atualizar categoria:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - Excluir
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idParam } = await params
    const id = Number(idParam)
    if (!id || Number.isNaN(id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const atual = await prisma.categoriaFinanceira.findUnique({
      where: { id },
      include: { _count: { select: { subcategorias: true, contasPagar: true, transacoes: true } } },
    })
    if (!atual) {
      return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 404 })
    }

    const { subcategorias, contasPagar, transacoes } = atual._count
    if (subcategorias > 0 || contasPagar > 0 || transacoes > 0) {
      const partes: string[] = []
      if (subcategorias > 0) partes.push(`${subcategorias} subcategoria(s)`)
      if (contasPagar > 0) partes.push(`${contasPagar} conta(s) a pagar`)
      if (transacoes > 0) partes.push(`${transacoes} transação(ões)`)
      return NextResponse.json(
        { error: `Categoria em uso (${partes.join(', ')}). Remova ou reatribua antes de excluir.` },
        { status: 409 }
      )
    }

    await prisma.categoriaFinanceira.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir categoria:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
