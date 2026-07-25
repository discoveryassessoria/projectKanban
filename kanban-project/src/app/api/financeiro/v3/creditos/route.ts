// GET /api/financeiro/v3/creditos — LISTA de créditos financeiros (todos os status).
// Somente leitura: read-model sobre CreditoFinanceiro + CreditoMovimento (original =
// GERACAO, utilizado = UTILIZACAO, revogado = ESTORNO, disponível = saldo atual).
// NÃO escreve, NÃO aplica regra. Alimenta a página canônica de Créditos. Flag posicaoRead.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { flagAtiva } from '@/lib/financeiro/flags'
import { usuarioFlag } from '@/src/app/api/financeiro/v3/_flags'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export async function GET(req: NextRequest) {
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) return NextResponse.json({ disponivel: false, fallbackLegado: true }, { status: 409 })
  try {
    const creds = await prisma.creditoFinanceiro.findMany({ orderBy: { criadoEm: 'desc' }, take: 500 })
    const ids = creds.map((c) => c.id)
    const movs = ids.length ? await prisma.creditoMovimento.groupBy({ by: ['creditoId', 'tipo'], where: { creditoId: { in: ids } }, _sum: { valor: true } }).catch(() => []) : []
    const por = new Map<string, number>()
    for (const m of movs as { creditoId: number; tipo: string; _sum: { valor: unknown } }[]) por.set(`${m.creditoId}:${m.tipo}`, cent(Number(m._sum.valor ?? 0)))
    // nomes de pessoa (batch)
    const pids = [...new Set(creds.map((c) => c.pessoaId).filter((v): v is number => v != null))]
    const pessoas = pids.length ? await prisma.pessoa.findMany({ where: { id: { in: pids } }, select: { id: true, nome: true, sobrenome: true } }).catch(() => []) : []
    const nomePor = new Map(pessoas.map((p) => [p.id, [p.nome, p.sobrenome].filter(Boolean).join(' ')]))

    const creditos = creds.map((c) => {
      const original = por.get(`${c.id}:GERACAO`) ?? cent(Number(c.valor))
      const utilizado = por.get(`${c.id}:UTILIZACAO`) ?? 0
      const revogado = por.get(`${c.id}:ESTORNO`) ?? 0
      const devolvido = por.get(`${c.id}:DEVOLUCAO`) ?? 0
      return {
        id: c.id, pessoa: c.pessoaId != null ? (nomePor.get(c.pessoaId) ?? null) : null, obrigacaoId: c.obrigacaoId,
        origemOcorrenciaId: c.origemOcorrenciaId, moeda: String(c.moeda), destino: c.destino, status: c.status,
        original, disponivel: cent(Number(c.valor)), utilizado, revogado, devolvido, criadoEm: c.criadoEm.toISOString(),
      }
    })
    return NextResponse.json({ disponivel: true, creditos })
  } catch (e) {
    return NextResponse.json({ disponivel: false, erro: e instanceof Error ? e.message : 'Falha ao listar créditos.' }, { status: 500 })
  }
}
