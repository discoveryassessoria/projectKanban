// src/app/api/gerenciamento/fornecedores/[id]/route.ts
// PUT    - Atualizar fornecedor
// DELETE - Excluir fornecedor (bloqueia se houver contas a pagar)
//
// ✅ Next 15: params é Promise → await params.
// O form envia o objeto completo → atualização substitui todos os campos.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

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

    const atual = await prisma.fornecedor.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Fornecedor não encontrado' }, { status: 404 })
    }

    const b = await request.json()

    if (b.nome !== undefined && !String(b.nome).trim()) {
      return NextResponse.json({ error: 'Nome não pode ficar vazio' }, { status: 400 })
    }
    if (b.tipo !== undefined && !String(b.tipo).trim()) {
      return NextResponse.json({ error: 'Tipo (categoria) é obrigatório' }, { status: 400 })
    }

    const fornecedor = await prisma.fornecedor.update({
      where: { id },
      data: {
        nome: b.nome !== undefined ? String(b.nome).trim() : atual.nome,
        tipo: b.tipo !== undefined ? String(b.tipo).trim() : atual.tipo,
        nomeFantasia: s(b.nomeFantasia),
        cpfCnpj: s(b.cpfCnpj),
        inscricaoEstadual: s(b.inscricaoEstadual),
        inscricaoMunicipal: s(b.inscricaoMunicipal),
        telefone: s(b.telefone),
        celular: s(b.celular),
        email: s(b.email),
        website: s(b.website),
        cep: s(b.cep),
        endereco: s(b.endereco),
        numero: s(b.numero),
        complemento: s(b.complemento),
        bairro: s(b.bairro),
        cidade: s(b.cidade),
        estado: s(b.estado),
        pais: s(b.pais),
        banco: s(b.banco),
        agencia: s(b.agencia),
        conta: s(b.conta),
        tipoConta: s(b.tipoConta),
        chavePix: s(b.chavePix),
        tipoChavePix: s(b.tipoChavePix),
        moedaPadrao: b.moedaPadrao || atual.moedaPadrao,
        observacoes: s(b.observacoes),
        ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
      },
    })

    return NextResponse.json({ fornecedor })
  } catch (error) {
    console.error('Erro ao atualizar fornecedor:', error)
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

    const atual = await prisma.fornecedor.findUnique({
      where: { id },
      include: { _count: { select: { contasPagar: true } } },
    })
    if (!atual) {
      return NextResponse.json({ error: 'Fornecedor não encontrado' }, { status: 404 })
    }

    if (atual._count.contasPagar > 0) {
      return NextResponse.json(
        { error: `Fornecedor em uso por ${atual._count.contasPagar} conta(s) a pagar. Desative-o no lugar.` },
        { status: 409 }
      )
    }

    await prisma.fornecedor.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir fornecedor:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}