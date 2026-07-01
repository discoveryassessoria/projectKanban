import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const b = await request.json()
    const atual = await prisma.matrizDocumental.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Regra não encontrada.' }, { status: 404 })
    const regra = await prisma.matrizDocumental.update({
      where: { id },
      data: {
        tipoProcessoId: b.tipoProcessoId !== undefined ? Number(b.tipoProcessoId) : atual.tipoProcessoId,
        phaseKey: b.phaseKey !== undefined ? (b.phaseKey ? String(b.phaseKey) : null) : atual.phaseKey,
        documentTypeCode: b.documentTypeCode !== undefined ? String(b.documentTypeCode) : atual.documentTypeCode,
        target: b.target ?? atual.target,
        generationRule: b.generationRule ?? atual.generationRule,
        required: b.required !== undefined ? !!b.required : atual.required,
        conditional: b.conditional !== undefined ? !!b.conditional : atual.conditional,
        condition: b.condition !== undefined ? (b.condition ? String(b.condition) : null) : atual.condition,
        createsTask: b.createsTask !== undefined ? !!b.createsTask : atual.createsTask,
        createsCost: b.createsCost !== undefined ? !!b.createsCost : atual.createsCost,
        createsRevenue: b.createsRevenue !== undefined ? !!b.createsRevenue : atual.createsRevenue,
        blocksPhaseCompletion: b.blocksPhaseCompletion !== undefined ? !!b.blocksPhaseCompletion : atual.blocksPhaseCompletion,
        arquivado: b.arquivado !== undefined ? !!b.arquivado : atual.arquivado,
      },
    })
    return NextResponse.json({ regra })
  } catch (e) {
    console.error('PUT matriz-documental/[id]', e)
    return NextResponse.json({ error: 'Erro ao salvar a regra.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.matrizDocumental.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Regra não encontrada.' }, { status: 404 })
    if ((atual.usedByCount || 0) > 0) return NextResponse.json({ error: 'Regra em uso; arquive em vez de excluir.' }, { status: 409 })
    await prisma.matrizDocumental.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE matriz-documental/[id]', e)
    return NextResponse.json({ error: 'Erro ao excluir a regra.' }, { status: 500 })
  }
}