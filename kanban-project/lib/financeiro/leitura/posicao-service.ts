// lib/financeiro/leitura/posicao-service.ts
// ============================================================================
// LEITURA da POSIÇÃO FINANCEIRA (Motor Financeiro V3 · Fase 2). Projeta o estado
// de uma obrigação a partir do Ledger (fonte da verdade): saldo, recebido,
// timeline de ocorrências, posição por requerente (informativa) e DIVERGÊNCIA
// entre replay e a projeção em cache. Usa o código operacional REC-xxx (sem CTR).
// ============================================================================
import { prisma } from '@/lib/prisma'
import { projetar, type EntryProjecao } from '../ledger/projecao'
import { posicaoPorRequerente, type PosicaoRequerente } from '../dominio/posicao-requerente'

export interface TimelineItem {
  ocorrenciaId: number
  tipo: string
  valor: number
  moeda: string
  data: string
  status: string
  pagador?: { tipo: string; pessoaId: number | null; externoNome: string | null } | null
  aplicado: number
  comprovanteUrl?: string | null
  observacao?: string | null
}

export interface PosicaoFinanceira {
  obrigacaoId: number
  codigoOperacional: string | null
  natureza: string
  direcao: string
  status: string
  moedaContratual: string
  valorContratado: number
  saldo: number
  recebidoBruto: number
  recebidoLiquido: number
  timeline: TimelineItem[]
  posicaoRequerentes: PosicaoRequerente[]
  pagadoresExternos: { nome: string; valor: number }[]
  creditos: { id: number; valor: number; destino: string; status: string }[]
  divergencia: { saldoProjecao: number | null; saldoReplay: number; consistente: boolean }
}

/** Resolve a obrigação por id, por REC-xxx (código operacional) ou por receitaId. */
async function resolverObrigacaoId(ref: { obrigacaoId?: number; codigo?: string; receitaId?: number }): Promise<number | null> {
  if (ref.obrigacaoId) return ref.obrigacaoId
  if (ref.codigo) {
    const o = await prisma.obrigacaoEconomica.findFirst({ where: { codigoOperacional: ref.codigo }, select: { id: true } })
    if (o) return o.id
  }
  if (ref.receitaId) {
    const o = await prisma.obrigacaoEconomica.findFirst({ where: { origemTipo: 'Receita', origemId: ref.receitaId }, select: { id: true } })
    if (o) return o.id
  }
  return null
}

/** Monta a Posição Financeira completa da obrigação (ou null se não espelhada). */
export async function carregarPosicao(ref: { obrigacaoId?: number; codigo?: string; receitaId?: number }): Promise<PosicaoFinanceira | null> {
  const obrigacaoId = await resolverObrigacaoId(ref)
  if (!obrigacaoId) return null

  const obr = await prisma.obrigacaoEconomica.findUnique({
    where: { id: obrigacaoId },
    include: {
      ledger: { include: { entries: { orderBy: { sequencia: 'asc' } } } },
      ocorrencias: { orderBy: { data: 'asc' }, include: { aplicacoes: true } },
      distribuicoes: { orderBy: { versao: 'desc' }, include: { participacoes: true } },
    },
  })
  if (!obr) return null

  // replay do Ledger (fonte da verdade) × projeção em cache (detecção de divergência)
  const entries: EntryProjecao[] = (obr.ledger?.entries ?? []).map((e) => ({ conta: e.contaContabil, direcao: e.direcao as 'DEBITO' | 'CREDITO', valor: Number(e.valorContabil), sequencia: e.sequencia }))
  const replay = projetar(entries)
  const proj = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId } })
  const saldoProjecao = proj ? Number(proj.saldo) : null
  const consistente = saldoProjecao == null ? true : Math.abs(saldoProjecao - replay.saldo) < 0.005

  // pagadores (interno x externo) das ocorrências
  const pagadorIds = obr.ocorrencias.map((o) => o.pagadorId).filter((v): v is number => v != null)
  const pagadores = pagadorIds.length ? await prisma.pagador.findMany({ where: { id: { in: pagadorIds } } }) : []
  const parteIds = pagadores.map((p) => p.parteExternaId).filter((v): v is number => v != null)
  const partes = parteIds.length ? await prisma.parteExterna.findMany({ where: { id: { in: parteIds } } }) : []
  const pagadorPorId = new Map(pagadores.map((p) => [p.id, p]))
  const partePorId = new Map(partes.map((p) => [p.id, p]))

  const pagamentosInternos: { pessoaId: number; valor: number }[] = []
  const externosMap = new Map<string, number>()
  const timeline: TimelineItem[] = obr.ocorrencias.map((o) => {
    const aplicado = o.aplicacoes.reduce((s, a) => s + Number(a.valorAplicado), 0)
    const pg = o.pagadorId != null ? pagadorPorId.get(o.pagadorId) : undefined
    const externoNome = pg?.parteExternaId != null ? partePorId.get(pg.parteExternaId)?.nome ?? null : null
    const ehPagamento = o.tipo === 'PAGAMENTO' || o.tipo === 'PAGAMENTO_PARCIAL'
    if (ehPagamento && pg) {
      if (pg.pessoaId != null) pagamentosInternos.push({ pessoaId: pg.pessoaId, valor: Number(o.valor) })
      else if (externoNome) externosMap.set(externoNome, (externosMap.get(externoNome) ?? 0) + Number(o.valor))
    }
    return { ocorrenciaId: o.id, tipo: o.tipo, valor: Number(o.valor), moeda: String(o.moeda), data: o.data.toISOString(), status: o.status, pagador: pg ? { tipo: pg.tipo, pessoaId: pg.pessoaId, externoNome } : null, aplicado, comprovanteUrl: o.comprovanteUrl, observacao: o.observacao }
  })

  const dist = obr.distribuicoes[0]
  const cotas = (dist?.participacoes ?? []).filter((p) => p.incluido).map((p) => ({ pessoaId: p.pessoaId, valor: Number(p.valor ?? 0) }))
  const posicaoRequerentes = posicaoPorRequerente(cotas, pagamentosInternos)

  const creditosRaw = await prisma.creditoFinanceiro.findMany({ where: { obrigacaoId }, orderBy: { criadoEm: 'asc' } })

  return {
    obrigacaoId,
    codigoOperacional: obr.codigoOperacional,
    natureza: obr.natureza,
    direcao: obr.direcao,
    status: obr.status,
    moedaContratual: String(obr.moedaContratual),
    valorContratado: Number(obr.valorContratado),
    saldo: replay.saldo,
    recebidoBruto: replay.recebidoBruto,
    recebidoLiquido: replay.recebidoLiquido,
    timeline,
    posicaoRequerentes,
    pagadoresExternos: [...externosMap.entries()].map(([nome, valor]) => ({ nome, valor })),
    creditos: creditosRaw.map((c) => ({ id: c.id, valor: Number(c.valor), destino: c.destino, status: c.status })),
    divergencia: { saldoProjecao, saldoReplay: replay.saldo, consistente },
  }
}
