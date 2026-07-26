// src/app/api/gerenciamento/financeiro-gestao/route.ts
//
// READ-MODEL de GESTÃO financeira do Gerenciamento. SOMENTE LEITURA.
// Duas visões que não existiam e não duplicam a operação (o Financeiro Geral
// continua sendo onde se opera — aqui é consulta consolidada de gestão):
//   ?visao=credito   → Financeiro › Crédito              (saldos e movimento)
//   ?visao=documentos→ Financeiro › Documentos Financeiros (recibos e faturas)

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const cent = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  const visao = new URL(request.url).searchParams.get('visao') ?? 'credito'
  try {
    if (visao === 'documentos') {
      const [recibos, faturas, porStatus, contadores, totalRecibos, totalFaturas] = await Promise.all([
        prisma.recibo.findMany({
          orderBy: { data: 'desc' }, take: 200,
          select: { id: true, numero: true, data: true, valorTotal: true, descricao: true, pagadorNome: true, processoId: true, pdfUrl: true },
        }),
        prisma.fatura.findMany({
          orderBy: { dataEmissao: 'desc' }, take: 200,
          select: { id: true, descricao: true, valor: true, moeda: true, status: true, dataEmissao: true, dataVencimento: true, processoId: true, parcelas: true },
        }),
        prisma.fatura.groupBy({ by: ['status'], _count: { _all: true }, _sum: { valor: true } }),
        prisma.counterRecibo.findMany({ orderBy: { atualizadoEm: 'desc' }, take: 50 }),
        prisma.recibo.count(),
        prisma.fatura.count(),
      ])
      return NextResponse.json({
        visao,
        totais: { recibos: totalRecibos, faturas: totalFaturas },
        porStatus: porStatus.map((s) => ({ status: String(s.status), quantidade: s._count._all, valor: cent(s._sum.valor) })),
        recibos: recibos.map((r) => ({ ...r, valorTotal: cent(r.valorTotal) })),
        faturas: faturas.map((f) => ({ ...f, valor: cent(f.valor), moeda: String(f.moeda), status: String(f.status) })),
        contadores: contadores.map((c) => ({ processoId: c.processoId, proximoNumero: c.proximoNumero, atualizadoEm: c.atualizadoEm })),
      })
    }

    // ── crédito ──────────────────────────────────────────────────────────────
    const creditos = await prisma.creditoFinanceiro.findMany({ orderBy: { criadoEm: 'desc' }, take: 300 })
    const ids = creditos.map((c) => c.id)
    const movs = ids.length
      ? await prisma.creditoMovimento.groupBy({
          by: ['creditoId', 'tipo'], where: { creditoId: { in: ids } }, _sum: { valor: true },
        }).catch(() => [])
      : []
    const porMov = new Map<string, number>()
    for (const m of movs as { creditoId: number; tipo: string; _sum: { valor: unknown } }[]) {
      porMov.set(`${m.creditoId}:${m.tipo}`, cent(m._sum.valor))
    }
    const pids = [...new Set(creditos.map((c) => c.pessoaId).filter((v): v is number => v != null))]
    const pessoas = pids.length
      ? await prisma.pessoa.findMany({ where: { id: { in: pids } }, select: { id: true, nome: true, sobrenome: true } }).catch(() => [])
      : []
    const nomePor = new Map(pessoas.map((p) => [p.id, [p.nome, p.sobrenome].filter(Boolean).join(' ')]))

    const linhas = creditos.map((c) => {
      const original = porMov.get(`${c.id}:GERACAO`) ?? cent(c.valor)
      return {
        id: c.id,
        pessoa: c.pessoaId != null ? nomePor.get(c.pessoaId) ?? `#${c.pessoaId}` : null,
        obrigacaoId: c.obrigacaoId,
        moeda: String(c.moeda),
        destino: c.destino,
        status: c.status,
        original,
        disponivel: cent(c.valor),
        utilizado: porMov.get(`${c.id}:UTILIZACAO`) ?? 0,
        revogado: porMov.get(`${c.id}:ESTORNO`) ?? 0,
        devolvido: porMov.get(`${c.id}:DEVOLUCAO`) ?? 0,
        criadoEm: c.criadoEm,
      }
    })
    const soma = (f: (l: typeof linhas[number]) => number) => cent(linhas.reduce((s, l) => s + f(l), 0))
    return NextResponse.json({
      visao: 'credito',
      totais: {
        registros: linhas.length,
        original: soma((l) => l.original),
        disponivel: soma((l) => l.disponivel),
        utilizado: soma((l) => l.utilizado),
        revogado: soma((l) => l.revogado),
        devolvido: soma((l) => l.devolvido),
        abertos: linhas.filter((l) => l.status === 'ABERTO').length,
      },
      creditos: linhas,
    })
  } catch (e) {
    console.error('GET financeiro-gestao', e)
    return NextResponse.json({ error: 'Erro ao carregar a consulta financeira.' }, { status: 500 })
  }
}
