// GET /api/financeiro/cobrancas — VISÃO GERAL de Cobranças (todos os processos).
// MESMA entidade Cobranca do Financeiro do Processo — sem tabela paralela, sem
// duplicação, sem sync. O Processo é a MESMA consulta filtrada por processoId.
// Filtros: status, moeda, processoId, q (busca por código/descrição/processo).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver')
  if (erro) return erro
  const sp = new URL(req.url).searchParams
  const status = sp.get('status') || undefined
  const moeda = sp.get('moeda') || undefined
  const processoId = sp.get('processoId') ? Number(sp.get('processoId')) : undefined
  const q = (sp.get('q') || '').trim()
  const take = Math.min(200, Math.max(1, Number(sp.get('limit')) || 100))
  const skip = Math.max(0, (Number(sp.get('page') || 1) - 1) * take)

  const where: Prisma.CobrancaWhereInput = {
    ...(status ? { status } : {}),
    ...(moeda ? { moeda: moeda as any } : {}),
    ...(processoId ? { processoId } : {}),
    ...(q ? { OR: [
      { receita: { is: { codigo: { contains: q, mode: 'insensitive' } } } },
      { receita: { is: { descricao: { contains: q, mode: 'insensitive' } } } },
      { receita: { is: { processo: { is: { nome: { contains: q, mode: 'insensitive' } } } } } },
    ] } : {}),
  }

  const [rows, total, resumoRaw] = await Promise.all([
    prisma.cobranca.findMany({
      where, orderBy: { criadoEm: 'desc' }, take, skip,
      include: {
        receita: { select: { id: true, codigo: true, descricao: true, pessoa: { select: { nome: true } }, processo: { select: { id: true, nome: true } } } },
        parcelas: { select: { vencimento: true, valor: true, status: true } },
        eventos: { select: { tipo: true, valor: true } },
      },
    }),
    prisma.cobranca.count({ where }),
    prisma.cobranca.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { valorTotal: true } }),
  ])

  const cobrancas = rows.map((c) => {
    const recebido = c.eventos.filter((e) => e.tipo === 'RECEBIMENTO').reduce((s, e) => s + Number(e.valor || 0), 0)
    const pendentes = c.parcelas.filter((p) => p.status === 'PENDENTE')
    const proximoVencimento = pendentes.map((p) => p.vencimento).sort((a, b) => +new Date(a) - +new Date(b))[0] ?? null
    return {
      id: c.id, receitaId: c.receitaId, processoId: c.processoId, moeda: String(c.moeda),
      valorTotal: Number(c.valorTotal), status: c.status, criadoEm: c.criadoEm,
      nParcelas: c.parcelas.length, recebido, saldo: Number(c.valorTotal) - recebido, proximoVencimento,
      receitaCodigo: c.receita?.codigo ?? null, descricao: c.receita?.descricao ?? null,
      requerente: c.receita?.pessoa?.nome ?? null, processoNome: c.receita?.processo?.nome ?? null,
    }
  })

  const resumo = {
    total,
    valorTotal: cobrancas.reduce((s, c) => s + c.valorTotal, 0),
    recebidoTotal: cobrancas.reduce((s, c) => s + c.recebido, 0),
    porStatus: resumoRaw.map((r) => ({ status: r.status, quantidade: r._count._all, valor: Number(r._sum.valorTotal || 0) })),
  }
  return NextResponse.json({ cobrancas, total, resumo })
}
