// lib/financeiro/leitura/receitas-lista.ts
// ============================================================================
// LISTA DE RECEITAS (Motor Financeiro V3 · Fase 3) — dados da aba "Receitas" do
// hub (KPIs + tabela). Fonte: obrigações de natureza RECEITA + projeções (Ledger).
// ============================================================================
import { prisma } from '@/lib/prisma'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface ReceitaLinha {
  obrigacaoId: number
  codigo: string | null
  descricao: string | null
  requerente: { nome: string; papel: string } | null
  servico: string | null
  formaCobranca: string
  valorContratado: number
  recebido: number
  saldo: number
  vencimento: string | null
  statusLabel: string
  moeda: string
}

export interface ReceitasLista {
  kpis: { totalContratado: number; recebido: number; saldoAReceber: number; aVencer: number; aVencerParcelas: number; receitas: number }
  receitas: ReceitaLinha[]
}

export async function listarReceitas(processoId?: number): Promise<ReceitasLista> {
  const obrs = await prisma.obrigacaoEconomica.findMany({
    where: { natureza: 'RECEITA', direcao: 'A_RECEBER', ...(processoId ? { processoId } : {}) },
    include: { distribuicoes: { orderBy: { versao: 'desc' }, include: { participacoes: true } } },
    orderBy: { id: 'desc' }, take: 500,
  })
  const ids = obrs.map((o) => o.id)
  const projs = ids.length ? await prisma.saldoProjecao.findMany({ where: { obrigacaoId: { in: ids } } }) : []
  const projPor = new Map(projs.map((p) => [p.obrigacaoId, p]))
  const recIds = obrs.filter((o) => o.origemTipo === 'Receita' && o.origemId).map((o) => o.origemId!) as number[]
  const receitas = recIds.length ? await prisma.receita.findMany({ where: { id: { in: recIds } }, select: { id: true, descricao: true, categoria: true, data1: true, tipoServicoId: true } }) : []
  const recPor = new Map(receitas.map((r) => [r.id, r]))
  const tipoIds = receitas.map((r) => r.tipoServicoId).filter((v): v is number => v != null)
  const tipos = tipoIds.length ? await prisma.tipoServico.findMany({ where: { id: { in: tipoIds } }, select: { id: true, nome: true } }).catch(() => []) : []
  const tipoPor = new Map(tipos.map((t) => [t.id, t.nome]))

  const pessoaIds = new Set<number>()
  for (const o of obrs) (o.distribuicoes[0]?.participacoes ?? []).forEach((p) => { if (p.incluido) pessoaIds.add(p.pessoaId) })
  const pessoas = pessoaIds.size ? await prisma.pessoa.findMany({ where: { id: { in: [...pessoaIds] } }, select: { id: true, nome: true, sobrenome: true } }) : []
  const nome = (pid: number) => { const p = pessoas.find((x) => x.id === pid); return p ? [p.nome, p.sobrenome].filter(Boolean).join(' ') : `Pessoa #${pid}` }

  const agora = Date.now()
  const linhas: ReceitaLinha[] = obrs.map((o) => {
    const proj = projPor.get(o.id)
    const rec = o.origemId ? recPor.get(o.origemId) : undefined
    const saldo = proj ? Number(proj.saldo) : Number(o.valorContratado)
    const recebido = proj ? Number(proj.recebidoBruto) : 0
    const venc = o.vencimento ?? rec?.data1 ?? null
    const primeiro = (o.distribuicoes[0]?.participacoes ?? []).filter((p) => p.incluido)[0]
    const statusLabel = saldo <= 0.005 ? 'QUITADO' : (venc && new Date(venc).getTime() < agora ? 'VENCIDO' : 'A VENCER')
    return {
      obrigacaoId: o.id, codigo: o.codigoOperacional, descricao: rec?.descricao ?? o.observacoes ?? null,
      requerente: primeiro ? { nome: nome(primeiro.pessoaId), papel: 'Principal' } : null,
      servico: (rec?.tipoServicoId ? tipoPor.get(rec.tipoServicoId) : null) ?? (rec?.categoria ? String(rec.categoria) : null),
      formaCobranca: 'À vista',
      valorContratado: Number(o.valorContratado), recebido, saldo,
      vencimento: venc ? new Date(venc).toISOString() : null, statusLabel, moeda: String(o.moedaContratual),
    }
  })

  const aReceber = linhas
  const kpis = {
    totalContratado: cent(aReceber.reduce((s, l) => s + l.valorContratado, 0)),
    recebido: cent(aReceber.reduce((s, l) => s + l.recebido, 0)),
    saldoAReceber: cent(aReceber.reduce((s, l) => s + l.saldo, 0)),
    aVencer: cent(aReceber.filter((l) => l.statusLabel !== 'QUITADO').reduce((s, l) => s + l.saldo, 0)),
    aVencerParcelas: aReceber.filter((l) => l.statusLabel !== 'QUITADO' && l.saldo > 0.005).length,
    receitas: aReceber.length,
  }
  return { kpis, receitas: linhas }
}
