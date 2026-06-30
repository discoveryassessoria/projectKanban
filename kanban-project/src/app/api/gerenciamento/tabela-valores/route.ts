import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

function toAmount(v: any): number {
  if (v === undefined || v === null || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function toIntOrNull(v: any): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}
function toStrOrNull(v: any): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

// GET - Listar regras de valor + fornecedores (para o select)
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const [tabelaValores, fornecedores] = await Promise.all([
      prisma.tabelaValor.findMany({
        orderBy: { criadoEm: 'desc' },
        include: { fornecedor: { select: { id: true, nome: true } } },
      }),
      prisma.fornecedor.findMany({
        orderBy: { nome: 'asc' },
        select: { id: true, nome: true },
      }),
    ])

    return NextResponse.json({ tabelaValores, fornecedores })
  } catch (error) {
    console.error('Erro ao listar tabela de valores:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar regra de valor
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()
    if (!b.name || !String(b.name).trim()) {
      return NextResponse.json({ error: 'Dê um nome à regra.' }, { status: 400 })
    }

    const regra = await prisma.tabelaValor.create({
      data: {
        name: String(b.name).trim(),
        processoTipoId: toStrOrNull(b.processoTipoId),
        faseKey: toStrOrNull(b.faseKey),
        produtoServicoId: toStrOrNull(b.produtoServicoId),
        fornecedorId: toIntOrNull(b.fornecedorId),
        moeda: b.moeda || 'EUR',
        valor: toAmount(b.valor),
        modoCalculo: b.modoCalculo || 'fixed',
        condicao: toStrOrNull(b.condicao),
        vigenciaInicio: toStrOrNull(b.vigenciaInicio),
        vigenciaFim: toStrOrNull(b.vigenciaFim),
        arquivado: !!b.arquivado,
      },
      include: { fornecedor: { select: { id: true, nome: true } } },
    })

    return NextResponse.json({ regra })
  } catch (error) {
    console.error('Erro ao criar regra de valor:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}