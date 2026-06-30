// src/app/api/gerenciamento/honorarios/[id]/route.ts
// PUT    - Atualizar honorario
// DELETE - Excluir honorario
// Next 15: params e Promise -> await params. Delete livre (nada referencia).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const MOEDAS = ['BRL', 'EUR', 'USD']
const TIPOS = ['main', 'rectification', 'judicial', 'administrative', 'extra_requirement', 'success_fee', 'protocol', 'consulting', 'urgent', 'addendum', 'other']
const MOMENTOS = ['contract_signed', 'phase_entered', 'protocol_created', 'process_finalized', 'manual']

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

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

    const atual = await prisma.honorario.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Honorário não encontrado' }, { status: 404 })
    }

    const b = await request.json()

    if (b.code !== undefined && !String(b.code).trim()) {
      return NextResponse.json({ error: 'Código não pode ficar vazio' }, { status: 400 })
    }
    if (b.name !== undefined && !String(b.name).trim()) {
      return NextResponse.json({ error: 'Nome não pode ficar vazio' }, { status: 400 })
    }
    if (b.tipo !== undefined && b.tipo && !TIPOS.includes(b.tipo)) {
      return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 })
    }
    if (b.momentoCobranca !== undefined && b.momentoCobranca && !MOMENTOS.includes(b.momentoCobranca)) {
      return NextResponse.json({ error: 'Momento de cobrança inválido' }, { status: 400 })
    }
    if (b.moeda !== undefined && b.moeda && !MOEDAS.includes(b.moeda)) {
      return NextResponse.json({ error: 'Moeda inválida' }, { status: 400 })
    }

    const honorario = await prisma.honorario.update({
      where: { id },
      data: {
        code: b.code !== undefined ? String(b.code).trim() : atual.code,
        name: b.name !== undefined ? String(b.name).trim() : atual.name,
        tipo: b.tipo !== undefined ? (b.tipo || 'main') : atual.tipo,
        servico: b.servico !== undefined ? (b.servico?.trim() || null) : atual.servico,
        moeda: b.moeda !== undefined ? (b.moeda || 'EUR') : atual.moeda,
        valorPadrao: b.valorPadrao !== undefined ? parseNum(b.valorPadrao) : atual.valorPadrao,
        momentoCobranca: b.momentoCobranca !== undefined ? (b.momentoCobranca || 'contract_signed') : atual.momentoCobranca,
        ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
      },
    })

    return NextResponse.json({ honorario })
  } catch (error) {
    console.error('Erro ao atualizar honorário:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

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

    const atual = await prisma.honorario.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Honorário não encontrado' }, { status: 404 })
    }

    await prisma.honorario.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir honorário:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}