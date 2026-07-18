import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { validarConfigGeraLancamento } from '@/lib/financeiro/regra-financeira-validacao'

const PHASE_LABELS: Record<string, string> = {
  genealogia: 'Genealogia', emissao_documental: 'Emissão Documental', analise_documental: 'Análise Documental',
  retificacao: 'Retificação', emissao_documental_retificada: 'Emissão Documental Retificada', traducao: 'Tradução',
  apostilamento: 'Apostilamento', aguardando_protocolo: 'Aguardando Protocolo', protocolado: 'Protocolado', finalizado: 'Finalizado',
}

// PUT — edita a regra (recalcula o nome a partir do item + fase)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const body = await request.json()

    const atual = await prisma.phaseTriggerRule.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Regra não encontrada.' }, { status: 404 })

    const itemCode = body.itemCode !== undefined ? String(body.itemCode) : atual.itemCode
    const phaseKey = body.phaseKey !== undefined ? String(body.phaseKey) : atual.phaseKey
    const produto = await prisma.produtoFinanceiro.findFirst({ where: { codigo: itemCode } })
    const name = `${produto?.nome || itemCode} · ${PHASE_LABELS[phaseKey] || phaseKey}`

    // §3 — natureza vs config (backend)
    const entryType = body.entryType ?? atual.entryType
    const valNat = await validarConfigGeraLancamento(produto?.id ?? null, entryType === 'cost' ? 'CUSTO' : 'RECEITA')
    if (!valNat.ok) return NextResponse.json({ error: valNat.motivo }, { status: 400 })

    const trigger = await prisma.phaseTriggerRule.update({
      where: { id },
      data: {
        itemCode, financialItemId: produto?.id ?? null, name, phaseKey,
        phaseEvent: body.phaseEvent ?? atual.phaseEvent,
        entryType: body.entryType ?? atual.entryType,
        automatic: body.automatic !== undefined ? !!body.automatic : atual.automatic,
        requiresContractSigned: body.requiresContractSigned !== undefined ? !!body.requiresContractSigned : atual.requiresContractSigned,
        requiresProposalApproved: body.requiresProposalApproved !== undefined ? !!body.requiresProposalApproved : atual.requiresProposalApproved,
        allowRepeat: body.allowRepeat !== undefined ? !!body.allowRepeat : atual.allowRepeat,
      },
    })
    return NextResponse.json({ trigger })
  } catch (e) {
    console.error('PUT disparo-fase/[id]', e)
    return NextResponse.json({ error: 'Erro ao salvar a regra.' }, { status: 500 })
  }
}

// DELETE — remove a regra
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.phaseTriggerRule.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Regra não encontrada.' }, { status: 404 })
    await prisma.phaseTriggerRule.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE disparo-fase/[id]', e)
    return NextResponse.json({ error: 'Erro ao excluir a regra.' }, { status: 500 })
  }
}