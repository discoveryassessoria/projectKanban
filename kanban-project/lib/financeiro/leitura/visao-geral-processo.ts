// lib/financeiro/leitura/visao-geral-processo.ts
// ============================================================================
// VISÃO GERAL FINANCEIRA DO PROCESSO — fonte ÚNICA V3 (leitura para a tela
// src/components/financeiro/subabas/VisaoGeral.tsx). Substitui os fetches V1
// (/api/financeiro/receitas + /custos) e os nativos (/v3/obrigacoes
// ?origemTipo=nativo): TUDO vem de ObrigacaoEconomica agora.
//
// Entrega o MESMO shape que a tela já consumia (ItemVG/ParcelaVG ≡ ItemAPI/
// ParcelaAPI) — mesmo shape → mesma matemática (parcToBrl/eventos/porMoeda/
// porRequerente/fluxoCaixa na tela não mudam). Parcelas são REAIS (da
// Cobrança/ParcelaFinanceira vinculada à obrigação); só na ausência total de
// cobrança a obrigação vira UMA parcela sintética (igual ao obrToItem que
// existia na tela para os lançamentos nativos).
// ============================================================================
import { prisma } from '@/lib/prisma'
import { receitasExcluidasIds, obrigacaoExcluida } from './exclusao-filtro'

export type MoedaVG = 'BRL' | 'EUR' | 'USD'
export type FxRuleVG = 'FIXO' | 'VARIAVEL'

export interface ParcelaVG {
  id: number
  numero: number
  vencimento: string
  valor: number
  status: string
  dataPagamento?: string | null
  cambioAplicado?: number | null
  valorBrl?: number | null
}

export interface ItemVG {
  id: number
  codigo: string
  categoria?: string
  descricao: string
  moeda: MoedaVG
  valor: number
  fxEstimado: number
  fxRule: FxRuleVG
  fxFixo?: number | null
  parcelas: ParcelaVG[]
  status?: string
  faseLabel?: string | null
  pessoa?: { id: number; nome: string; sobrenome?: string | null } | null
}

const iso = (d: Date | null | undefined): string => (d ? d.toISOString() : '')

export async function carregarVisaoGeralProcesso(processoId: number): Promise<{ receitas: ItemVG[]; custos: ItemVG[] }> {
  let obrs = await prisma.obrigacaoEconomica.findMany({
    where: { processoId, status: { not: 'CANCELADO' } },
    orderBy: { id: 'desc' },
    include: { distribuicoes: { orderBy: { versao: 'desc' }, take: 1, include: { participacoes: true } } },
  })
  if (obrs.length === 0) return { receitas: [], custos: [] }
  // Receita com exclusão lógica sai das consultas padrão (mesma regra da lista).
  const excluidas = await receitasExcluidasIds(obrs.filter((o) => o.origemTipo === 'Receita').map((o) => o.origemId))
  if (excluidas.size) { obrs = obrs.filter((o) => !obrigacaoExcluida(o, excluidas)); if (obrs.length === 0) return { receitas: [], custos: [] } }

  const ids = obrs.map((o) => o.id)

  // Rótulo (nome/categoria) vem do Cadastro Mestre — nunca da observação livre.
  const itemIds = [...new Set(obrs.map((o) => o.itemCatalogoId).filter((v): v is number => v != null))]
  const itens = itemIds.length
    ? await prisma.itemCatalogo.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, categoria: true } }).catch(() => [])
    : []
  const itemPor = new Map(itens.map((i) => [i.id, i]))

  // Saldo/recebido por projeção — decide quitação da parcela sintética.
  const projs = await prisma.saldoProjecao.findMany({ where: { obrigacaoId: { in: ids } } })
  const projPor = new Map(projs.map((p) => [p.obrigacaoId, p]))

  // fx congelado — só existe quando a obrigação nasceu de uma Receita legada.
  const recIds = [...new Set(obrs.filter((o) => o.origemTipo === 'Receita' && o.origemId != null).map((o) => o.origemId as number))]
  const recsFx = recIds.length
    ? await prisma.receita.findMany({ where: { id: { in: recIds } }, select: { id: true, fxRule: true, fxEstimado: true, fxFixo: true } }).catch(() => [])
    : []
  const fxPor = new Map(recsFx.map((r) => [r.id, r]))

  // Requerente principal (1ª participação incluída da distribuição vigente) —
  // mesma regra de lib/financeiro/leitura/consultas.ts (listarObrigacoes), sem duplicar.
  const primPart = new Map<number, number>()
  const pessoaIdSet = new Set<number>()
  for (const o of obrs) {
    const dist = o.distribuicoes[0]
    const part = dist?.participacoes.find((p) => p.incluido) ?? dist?.participacoes[0]
    if (part?.pessoaId != null) { primPart.set(o.id, part.pessoaId); pessoaIdSet.add(part.pessoaId) }
  }
  const pessoas = pessoaIdSet.size
    ? await prisma.pessoa.findMany({ where: { id: { in: [...pessoaIdSet] } }, select: { id: true, nome: true, sobrenome: true } }).catch(() => [])
    : []
  const pessoaPor = new Map(pessoas.map((p) => [p.id, p]))

  // Parcelas REAIS: cobranças (+parcelas) vinculadas à obrigação, em lote.
  const cobrancas = await prisma.cobranca.findMany({
    where: { obrigacaoId: { in: ids } },
    select: {
      obrigacaoId: true,
      parcelas: { select: { id: true, numero: true, vencimento: true, valor: true, status: true, dataPagamento: true, cambioAplicado: true, valorBrl: true } },
    },
  }).catch(() => [])
  const parcelasPorObrigacao = new Map<number, ParcelaVG[]>()
  for (const c of cobrancas) {
    if (c.obrigacaoId == null) continue
    const atual = parcelasPorObrigacao.get(c.obrigacaoId) ?? []
    for (const p of c.parcelas) {
      atual.push({
        id: p.id, numero: p.numero, vencimento: iso(p.vencimento), valor: Number(p.valor), status: p.status,
        dataPagamento: p.dataPagamento ? iso(p.dataPagamento) : null,
        cambioAplicado: p.cambioAplicado != null ? Number(p.cambioAplicado) : null,
        valorBrl: p.valorBrl != null ? Number(p.valorBrl) : null,
      })
    }
    parcelasPorObrigacao.set(c.obrigacaoId, atual)
  }
  for (const arr of parcelasPorObrigacao.values()) arr.sort((a, b) => a.numero - b.numero)

  const receitas: ItemVG[] = []
  const custos: ItemVG[] = []

  for (const o of obrs) {
    const valorContratado = Number(o.valorContratado)
    const item = o.itemCatalogoId ? itemPor.get(o.itemCatalogoId) : undefined
    const fx = o.origemTipo === 'Receita' && o.origemId != null ? fxPor.get(o.origemId) : undefined
    const pid = primPart.get(o.id)
    const pessoa = pid != null ? pessoaPor.get(pid) : undefined

    let parcelas = parcelasPorObrigacao.get(o.id)
    if (!parcelas || parcelas.length === 0) {
      // Sem cobrança vinculada — UMA parcela sintética = valor contratado (mesma
      // regra do antigo obrToItem para os lançamentos nativos).
      const proj = projPor.get(o.id)
      const recebido = proj ? Number(proj.recebidoBruto) : 0
      const quitado = recebido >= valorContratado - 0.005
      const statusParc = quitado ? (o.natureza === 'RECEITA' ? 'RECEBIDA' : 'PAGA') : 'PENDENTE'
      parcelas = [{
        id: o.id, numero: 1, vencimento: iso(o.vencimento), valor: valorContratado, status: statusParc,
        dataPagamento: null, cambioAplicado: null,
        valorBrl: o.moedaContratual === 'BRL' ? valorContratado : null,
      }]
    }

    const vg: ItemVG = {
      id: o.id,
      codigo: o.codigoOperacional ?? `#${o.id}`,
      categoria: item?.categoria ?? undefined,
      descricao: item?.name ?? o.observacoes ?? '',
      moeda: o.moedaContratual as MoedaVG,
      valor: valorContratado,
      fxEstimado: fx ? Number(fx.fxEstimado) : 0,
      fxRule: (fx?.fxRule as FxRuleVG) ?? 'VARIAVEL',
      fxFixo: fx?.fxFixo != null ? Number(fx.fxFixo) : null,
      status: 'ATIVA',
      faseLabel: null,
      pessoa: pessoa ? { id: pessoa.id, nome: pessoa.nome, sobrenome: pessoa.sobrenome } : null,
      parcelas,
    }

    if (o.natureza === 'RECEITA') receitas.push(vg)
    else if (o.natureza === 'CUSTO') custos.push(vg)
  }

  return { receitas, custos }
}
