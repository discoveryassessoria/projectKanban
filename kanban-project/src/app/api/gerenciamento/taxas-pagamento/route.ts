import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

function toStrOrNull(v: any): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
function toIntOrNull(v: any): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}
function toNumOrNull(v: any): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// GET - Listar taxas + formas de pagamento + moedas (p/ os 2 seletores)
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const [taxas, formasPagamento, moedas] = await Promise.all([
      prisma.taxaPagamento.findMany({ orderBy: { name: 'asc' } }),
      prisma.formaPagamentoCadastro.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.moedaCadastro.findMany({ orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } }),
    ])

    return NextResponse.json({ taxas, formasPagamento, moedas })
  } catch (error) {
    console.error('Erro ao listar taxas de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar taxa
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()
    if (!b.name || !String(b.name).trim()) {
      return NextResponse.json({ error: 'Informe o nome.' }, { status: 400 })
    }

    const taxa = await prisma.taxaPagamento.create({
      data: {
        code: toStrOrNull(b.code),
        name: String(b.name).trim(),
        formaPagamentoId: toIntOrNull(b.formaPagamentoId),
        moeda: toStrOrNull(b.moeda),
        feeType: toStrOrNull(b.feeType),
        feePercent: toNumOrNull(b.feePercent),
        fixedFee: toNumOrNull(b.fixedFee),
        anticipationEnabled: !!b.anticipationEnabled,
        anticipationPercent: b.anticipationEnabled ? toNumOrNull(b.anticipationPercent) : null,
        installmentsFrom: toIntOrNull(b.installmentsFrom),
        installmentsTo: toIntOrNull(b.installmentsTo),
      },
    })

    return NextResponse.json({ taxa })
  } catch (error) {
    console.error('Erro ao criar taxa de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}