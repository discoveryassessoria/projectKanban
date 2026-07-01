import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const PHASE_LABELS: Record<string, string> = {
  genealogia: 'Genealogia', emissao_documental: 'Emissão Documental', analise_documental: 'Análise Documental',
  retificacao: 'Retificação', emissao_documental_retificada: 'Emissão Documental Retificada', traducao: 'Tradução',
  apostilamento: 'Apostilamento', aguardando_protocolo: 'Aguardando Protocolo', protocolado: 'Protocolado', finalizado: 'Finalizado',
}

// GET — regras de disparo + catálogo financeiro (dropdown)
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const [triggers, produtos] = await Promise.all([
      prisma.phaseTriggerRule.findMany({ where: { arquivado: false }, orderBy: { criadoEm: 'asc' } }),
      prisma.produtoFinanceiro.findMany({
        where: { ativo: true },
        select: { id: true, codigo: true, nome: true, naturezaFinanceira: true },
        orderBy: { nome: 'asc' },
      }),
    ])
    return NextResponse.json({ triggers, produtos })
  } catch (e) {
    console.error('GET disparo-fase', e)
    return NextResponse.json({ error: 'Erro ao carregar regras de disparo.' }, { status: 500 })
  }
}

// POST — cria regra de disparo
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const body = await request.json()
    const itemCode = String(body.itemCode || '')
    const phaseKey = String(body.phaseKey || '')
    if (!itemCode) return NextResponse.json({ error: 'Escolha o item financeiro.' }, { status: 400 })
    if (!phaseKey) return NextResponse.json({ error: 'Escolha a fase.' }, { status: 400 })

    const produto = await prisma.produtoFinanceiro.findFirst({ where: { codigo: itemCode } })
    const name = `${produto?.nome || itemCode} · ${PHASE_LABELS[phaseKey] || phaseKey}`

    const trigger = await prisma.phaseTriggerRule.create({
      data: {
        itemCode, financialItemId: produto?.id ?? null, name, phaseKey,
        phaseEvent: body.phaseEvent || 'entered',
        entryType: body.entryType || 'revenue',
        automatic: body.automatic !== false,
        requiresContractSigned: !!body.requiresContractSigned,
        requiresProposalApproved: !!body.requiresProposalApproved,
        allowRepeat: !!body.allowRepeat,
      },
    })
    return NextResponse.json({ trigger }, { status: 201 })
  } catch (e) {
    console.error('POST disparo-fase', e)
    return NextResponse.json({ error: 'Erro ao criar a regra de disparo.' }, { status: 500 })
  }
}