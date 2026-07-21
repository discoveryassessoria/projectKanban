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

// GET - Listar formas de pagamento + moedas cadastradas (p/ o seletor de moeda)
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const [formasPagamento, moedas] = await Promise.all([
      prisma.formaPagamentoCadastro.findMany({ orderBy: [{ ordem: 'asc' }, { name: 'asc' }] }),
      prisma.moedaCadastro.findMany({ orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } }),
    ])

    return NextResponse.json({ formasPagamento, moedas })
  } catch (error) {
    console.error('Erro ao listar formas de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar forma de pagamento
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()
    if (!b.name || !String(b.name).trim()) {
      return NextResponse.json({ error: 'Informe o nome.' }, { status: 400 })
    }

    const forma = await prisma.formaPagamentoCadastro.create({
      data: {
        code: toStrOrNull(b.code),
        name: String(b.name).trim(),
        type: toStrOrNull(b.type),
        moeda: toStrOrNull(b.moeda),
        permiteParcelas: !!b.permiteParcelas,
        // capacidades do MEIO (sem regra de parcelamento — isso é da Condição)
        ativo: b.ativo === undefined ? true : !!b.ativo,
        ordem: Number.isFinite(Number(b.ordem)) ? Math.trunc(Number(b.ordem)) : 0,
        icone: b.icone ? String(b.icone).slice(0, 60) : null,
        aceitaEntrada: !!b.aceitaEntrada,
        aceitaRecorrencia: !!b.aceitaRecorrencia,
        aceitaMoedaEstrangeira: !!b.aceitaMoedaEstrangeira,
        observacoes: b.observacoes ? String(b.observacoes) : null,
        maxParcelas: b.permiteParcelas ? toIntOrNull(b.maxParcelas) : null,
      },
    })

    return NextResponse.json({ forma })
  } catch (error) {
    console.error('Erro ao criar forma de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}