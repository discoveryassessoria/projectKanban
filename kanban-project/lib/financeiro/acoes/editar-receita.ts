// lib/financeiro/acoes/editar-receita.ts
// ============================================================================
// EDITAR RECEITA (Financeiro V3). Serviço da tela "Editar receita" — fluxo
// DISTINTO de "Editar distribuição" (aqui muda a PRÓPRIA Receita: título, serviço,
// referência, moeda-base, valor-base, regra de câmbio, origem e observações; a
// distribuição entre participantes é OUTRO fluxo e NÃO é tocada aqui).
//
// Uma Receita consolidada = N registros Receita irmãos (um por participante),
// agrupados por processo|config|regra|fase|ciclo; cada um espelhado numa
// ObrigacaoEconomica. A ref é o obrigacaoId (resolverId converte). O grupo é
// descoberto como em carregarReceitaConsolidada (mesma chave).
//
// Regras invioláveis:
//   - textuais SEMPRE editáveis (o título base propaga a todos os irmãos
//     preservando o sufixo "— Requerente adicional — X" de cada um);
//   - valor-base/câmbio: NUNCA reescreve pagamento confirmado; só ajusta as
//     cobranças ABERTAS conforme a estratégia; BLOQUEIA se algum participante
//     ficaria abaixo do que já recebeu;
//   - Ledger append-only: cada mudança de valor posta um AJUSTE balanceado
//     (lancAjusteContrato) + reprojeta (mesma mecânica do redistribuir-service);
//   - auditoria por EventoFinanceiro (tipo EDICAO) por Receita afetada, com
//     estado anterior → novo + justificativa + usuário.
// Sem migração: usa colunas existentes da Receita; "descrição detalhada" e
// "referência contratual" (sem coluna própria) vivem em contextoAplicado.edicao.
// ============================================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolverId } from '@/lib/financeiro/leitura/receita-detalhe'
import { cotacoesVivas } from '@/lib/financeiro/leitura/cambio-aging'
import { taxaDe } from '@/lib/financeiro/dominio/cambio'
import { registrarLancamento, recomputarProjecao } from '@/lib/financeiro/ledger/ledger-service'
import { lancAjusteContrato } from '@/lib/financeiro/ledger/lancamentos'
import { aReceber, type Natureza } from '@/lib/financeiro/dominio/obrigacao-economica'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100
const numOrNull = (x: unknown): number | null => (x == null || x === '' ? null : Number(x))

// ── suporte a título/sufixo ────────────────────────────────────────────────
const SUFIXO_RE = /\s*[—–-]\s*(Primeiro requerente|Requerente adicional|Requerente principal|Requerente)\b.*$/i
function splitDescricao(desc: string | null | undefined): { base: string; sufixo: string } {
  if (!desc) return { base: '', sufixo: '' }
  const m = desc.match(SUFIXO_RE)
  if (m && m.index != null) return { base: desc.slice(0, m.index).trim(), sufixo: desc.slice(m.index) }
  return { base: desc.trim(), sufixo: '' }
}

// ── câmbio do CONTRATO (mesma precedência do cambio-aging: BRL → valorBrlFixo →
//    fxFixo/fxEstimado → cotação viva). Devolve BRL e cotação efetiva. ─────────
export interface RegraCambio {
  fxRule: 'FIXO' | 'VARIAVEL'
  fxEstimado: number | null
  fxFixo: number | null
  fxData: string | null
  valorBrlFixo: number | null // no NÍVEL consolidado (total do grupo)
}
function brlContrato(moeda: string, valorBase: number, c: RegraCambio, liveRate: number | null): { brl: number; cotacao: number | null } {
  if (moeda === 'BRL') return { brl: cent(valorBase), cotacao: 1 }
  const fixo = c.fxRule === 'FIXO'
  const rate = fixo ? (c.fxFixo ?? c.fxEstimado ?? liveRate) : (c.fxEstimado ?? c.fxFixo ?? liveRate)
  const brlFixo = c.valorBrlFixo
  if (rate == null && !(fixo && brlFixo != null)) return { brl: cent(valorBase), cotacao: null }
  const brl = fixo && brlFixo != null ? cent(brlFixo) : cent(valorBase * (rate ?? 0))
  const cotacao = valorBase > 0 ? cent(brl / valorBase) : rate
  return { brl, cotacao }
}

// ── membro do grupo (uma Receita irmã / obrigação) ──────────────────────────
interface Membro {
  obrigacaoId: number
  receitaId: number | null
  natureza: Natureza
  descricao: string | null
  valorBase: number // ObrigacaoEconomica.valorContratado (moeda-base)
  recebidoBase: number // SaldoProjecao.recebidoBruto (moeda-base)
  recebidoBrl: number
  nome: string
  fx: RegraCambio & { valorBrlFixoSibling: number | null }
  contextoAplicado: Prisma.JsonValue | null
}

interface Grupo {
  obrigacaoIdRef: number
  repObrigacaoId: number
  repReceitaId: number | null
  codigo: string | null
  processoId: number | null
  moeda: string
  membros: Membro[]
  live: { rates: Record<string, number | null>; data: string | null }
}

// Descobre o grupo consolidado (mesma chave de carregarReceitaConsolidada) e
// carrega, por membro, os dados canônicos necessários à edição.
async function descobrirGrupo(ref: string): Promise<Grupo | null> {
  const id = await resolverId(ref)
  if (!id) return null
  const base = await prisma.obrigacaoEconomica.findUnique({
    where: { id },
    select: { id: true, origemTipo: true, origemId: true, processoId: true },
  })
  if (!base) return null

  let groupIds: number[] = [id]
  let repReceitaId: number | null = base.origemTipo === 'Receita' ? base.origemId ?? null : null
  if (base.origemTipo === 'Receita' && base.origemId != null) {
    const rec = await prisma.receita.findUnique({
      where: { id: base.origemId },
      select: { configFinanceiraId: true, regraFinanceiraId: true, phaseKey: true, phaseCycle: true },
    }).catch(() => null)
    if (rec && rec.configFinanceiraId != null) {
      const irmas = await prisma.receita.findMany({
        where: {
          processoId: base.processoId ?? undefined,
          configFinanceiraId: rec.configFinanceiraId,
          regraFinanceiraId: rec.regraFinanceiraId,
          phaseKey: rec.phaseKey,
          phaseCycle: rec.phaseCycle,
        },
        select: { id: true },
      }).catch(() => [] as { id: number }[])
      const receitaIds = irmas.map((r) => r.id)
      if (receitaIds.length) {
        const irmasObr = await prisma.obrigacaoEconomica.findMany({
          where: { origemTipo: 'Receita', origemId: { in: receitaIds }, status: { not: 'CANCELADO' } },
          select: { id: true },
        }).catch(() => [] as { id: number }[])
        const set = new Set<number>(irmasObr.map((o) => o.id)); set.add(id)
        groupIds = [...set]
      }
    }
  }

  const obrs = await prisma.obrigacaoEconomica.findMany({
    where: { id: { in: groupIds } },
    select: { id: true, origemTipo: true, origemId: true, natureza: true, valorContratado: true, moedaContratual: true, processoId: true, codigoOperacional: true },
  })
  const projs = await prisma.saldoProjecao.findMany({ where: { obrigacaoId: { in: groupIds } }, select: { obrigacaoId: true, recebidoBruto: true } })
  const recebMap = new Map(projs.map((p) => [p.obrigacaoId, Number(p.recebidoBruto)]))

  const receitaIds = obrs.filter((o) => o.origemTipo === 'Receita' && o.origemId != null).map((o) => o.origemId as number)
  const receitas = receitaIds.length
    ? await prisma.receita.findMany({
        where: { id: { in: receitaIds } },
        select: {
          id: true, descricao: true, moeda: true, valor: true, fxEstimado: true, fxRule: true, fxFixo: true, fxData: true,
          valorBrlFixo: true, contextoAplicado: true, requerentes: { orderBy: { idx: 'asc' }, select: { nome: true } },
        },
      })
    : []
  const recByReceitaId = new Map(receitas.map((r) => [r.id, r]))

  const rep = obrs.find((o) => o.id === id) ?? obrs[0]
  const moeda = String(rep.moedaContratual)
  const live = await cotacoesVivas()
  const rate = (m: string) => (m === 'BRL' ? 1 : live.rates[m] ?? null)

  const membros: Membro[] = obrs.map((o) => {
    const receitaId = o.origemTipo === 'Receita' ? o.origemId ?? null : null
    const rec = receitaId != null ? recByReceitaId.get(receitaId) : undefined
    const valorBase = Number(o.valorContratado)
    const recebidoBase = recebMap.get(o.id) ?? 0
    const fxRule: 'FIXO' | 'VARIAVEL' = (rec?.fxRule as 'FIXO' | 'VARIAVEL') ?? 'VARIAVEL'
    const c: RegraCambio = {
      fxRule, fxEstimado: numOrNull(rec?.fxEstimado), fxFixo: numOrNull(rec?.fxFixo),
      fxData: rec?.fxData ? new Date(rec.fxData).toISOString() : null, valorBrlFixo: numOrNull(rec?.valorBrlFixo),
    }
    const { cotacao } = brlContrato(String(o.moedaContratual), valorBase, c, rate(String(o.moedaContratual)))
    const recebidoBrl = String(o.moedaContratual) === 'BRL' ? cent(recebidoBase) : cent(recebidoBase * (cotacao ?? 1))
    return {
      obrigacaoId: o.id, receitaId, natureza: (o.natureza as Natureza) ?? 'RECEITA',
      descricao: rec?.descricao ?? null, valorBase: cent(valorBase), recebidoBase: cent(recebidoBase), recebidoBrl,
      nome: rec?.requerentes?.[0]?.nome ?? 'Participante', fx: { ...c, valorBrlFixoSibling: numOrNull(rec?.valorBrlFixo) },
      contextoAplicado: rec?.contextoAplicado ?? null,
    }
  })

  return {
    obrigacaoIdRef: id, repObrigacaoId: rep.id, repReceitaId,
    codigo: rep.codigoOperacional ?? null, processoId: rep.processoId ?? null, moeda, membros, live,
  }
}

// Câmbio consolidado do grupo (soma dos BRL de cada membro / total base).
function cambioConsolidado(g: Grupo): RegraCambio & { cotacaoEfetiva: number | null; valorContratadoBrl: number } {
  const rate = (m: string) => (m === 'BRL' ? 1 : g.live.rates[m] ?? null)
  const rep = g.membros.find((m) => m.obrigacaoId === g.repObrigacaoId) ?? g.membros[0]
  const totalBase = cent(g.membros.reduce((s, m) => s + m.valorBase, 0))
  const totalBrl = cent(g.membros.reduce((s, m) => {
    const { brl } = brlContrato(g.moeda, m.valorBase, { fxRule: m.fx.fxRule, fxEstimado: m.fx.fxEstimado, fxFixo: m.fx.fxFixo, fxData: m.fx.fxData, valorBrlFixo: m.fx.valorBrlFixoSibling }, rate(g.moeda))
    return s + brl
  }, 0))
  const somaBrlFixo = g.membros.some((m) => m.fx.valorBrlFixoSibling != null)
    ? cent(g.membros.reduce((s, m) => s + (m.fx.valorBrlFixoSibling ?? 0), 0))
    : null
  return {
    fxRule: rep?.fx.fxRule ?? 'VARIAVEL', fxEstimado: rep?.fx.fxEstimado ?? null, fxFixo: rep?.fx.fxFixo ?? null,
    fxData: rep?.fx.fxData ?? null, valorBrlFixo: somaBrlFixo,
    cotacaoEfetiva: totalBase > 0 ? taxaDe(totalBrl, totalBase) : rep?.fx.fxEstimado ?? null, valorContratadoBrl: totalBrl,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 1) ESTADO EDITÁVEL
// ════════════════════════════════════════════════════════════════════════════
export interface ReceitaEditavel {
  ref: string
  obrigacaoIdRef: number
  receitaIdRep: number | null
  codigo: string | null
  processoId: number | null
  titulo: string | null
  descricaoDetalhada: string | null
  referenciaContratual: string | null
  tipoServicoId: number | null
  servicoNome: string | null
  itemMestreNome: string | null
  origem: string | null
  observacoes: string | null
  moedaBase: string
  valorBaseTotal: number
  cambio: RegraCambio & { cotacaoEfetiva: number | null }
  temPagamentoConfirmado: boolean
  cobrancasAbertas: number
  recebidoTotalBrl: number
  valorContratadoBrlTotal: number
  participantes: { obrigacaoId: number; receitaId: number | null; nome: string; valorBase: number; recebidoBase: number; recebidoBrl: number }[]
  servicosDisponiveis: { id: number; nome: string }[]
  moedasDisponiveis: string[]
}

export async function carregarReceitaEditavel(ref: string): Promise<ReceitaEditavel | null> {
  const g = await descobrirGrupo(ref)
  if (!g) return null

  const rep = g.membros.find((m) => m.obrigacaoId === g.repObrigacaoId) ?? g.membros[0]
  const { base: titulo } = splitDescricao(rep?.descricao ?? null)

  // textuais de exibição/serviço vêm da Receita representante
  const receitaRep = g.repReceitaId != null
    ? await prisma.receita.findUnique({ where: { id: g.repReceitaId }, select: { descricao: true, observacoes: true, origem: true, tipoServicoId: true, contextoAplicado: true, configFinanceiraId: true } }).catch(() => null)
    : null
  const tipoServico = receitaRep?.tipoServicoId != null
    ? await prisma.tipoServico.findUnique({ where: { id: receitaRep.tipoServicoId }, select: { nome: true } }).catch(() => null)
    : null
  const ctx = (receitaRep?.contextoAplicado && typeof receitaRep.contextoAplicado === 'object' && !Array.isArray(receitaRep.contextoAplicado))
    ? (receitaRep.contextoAplicado as Record<string, unknown>) : {}
  // Item mestre CANÔNICO (nome real): do contexto (manual) OU via Config Financeira → ItemCatalogo.
  let itemMestreNome: string | null = typeof ctx.itemNome === 'string' ? ctx.itemNome : null
  if (!itemMestreNome && receitaRep?.configFinanceiraId != null) {
    const cfg = await prisma.produtoFinanceiro.findUnique({ where: { id: receitaRep.configFinanceiraId }, select: { itemCatalogo: { select: { name: true } } } }).catch(() => null)
    itemMestreNome = cfg?.itemCatalogo?.name ?? null
  }
  const edicao = (ctx.edicao && typeof ctx.edicao === 'object' && !Array.isArray(ctx.edicao)) ? (ctx.edicao as Record<string, unknown>) : {}

  const valorBaseTotal = cent(g.membros.reduce((s, m) => s + m.valorBase, 0))
  const consolidado = cambioConsolidado(g)

  // "Pagamento confirmado" reflete o RECEBIDO LÍQUIDO (já descontados estornos), não a mera
  // existência de uma ocorrência PROCESSADA — um pagamento totalmente estornado NÃO confirma.
  const recebidoTotalBrl = cent(g.membros.reduce((s, m) => s + m.recebidoBrl, 0))
  // cobranças ABERTAS = parcelas PENDENTE, ligadas por COBRANÇA (cobrancaId) OU receitaId (legado).
  const receitaIds = g.membros.map((m) => m.receitaId).filter((v): v is number => v != null)
  const cobs = receitaIds.length ? await prisma.cobranca.findMany({ where: { receitaId: { in: receitaIds } }, select: { id: true } }).catch(() => [] as { id: number }[]) : []
  const cobIds = cobs.map((c) => c.id)
  const [porCobranca, porReceita] = await Promise.all([
    cobIds.length ? prisma.parcelaFinanceira.count({ where: { cobrancaId: { in: cobIds }, status: 'PENDENTE' } }).catch(() => 0) : Promise.resolve(0),
    receitaIds.length ? prisma.parcelaFinanceira.count({ where: { receitaId: { in: receitaIds }, status: 'PENDENTE' } }).catch(() => 0) : Promise.resolve(0),
  ])
  const cobrancasAbertas = porCobranca + porReceita

  // serviços disponíveis (do processo)
  const servicosDisponiveis = g.processoId != null
    ? await prisma.tipoServico.findMany({ where: { processoId: g.processoId }, orderBy: { ordem: 'asc' }, select: { id: true, nome: true } }).catch(() => [])
    : []

  return {
    ref, obrigacaoIdRef: g.obrigacaoIdRef, receitaIdRep: g.repReceitaId, codigo: g.codigo, processoId: g.processoId,
    titulo: titulo || null,
    descricaoDetalhada: typeof edicao.descricao === 'string' ? edicao.descricao : null,
    referenciaContratual: typeof edicao.referenciaContratual === 'string' ? edicao.referenciaContratual : null,
    tipoServicoId: receitaRep?.tipoServicoId ?? null, servicoNome: tipoServico?.nome ?? null, itemMestreNome,
    origem: receitaRep?.origem ?? null, observacoes: receitaRep?.observacoes ?? null,
    moedaBase: g.moeda, valorBaseTotal,
    cambio: { fxRule: consolidado.fxRule, fxEstimado: consolidado.fxEstimado, fxFixo: consolidado.fxFixo, fxData: consolidado.fxData, valorBrlFixo: consolidado.valorBrlFixo, cotacaoEfetiva: consolidado.cotacaoEfetiva },
    temPagamentoConfirmado: recebidoTotalBrl > 0.005,
    cobrancasAbertas,
    recebidoTotalBrl,
    valorContratadoBrlTotal: consolidado.valorContratadoBrl,
    participantes: g.membros.map((m) => ({ obrigacaoId: m.obrigacaoId, receitaId: m.receitaId, nome: m.nome, valorBase: m.valorBase, recebidoBase: m.recebidoBase, recebidoBrl: m.recebidoBrl })),
    servicosDisponiveis, moedasDisponiveis: ['EUR', 'USD', 'BRL'],
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PATCH + rateio do novo total pelos irmãos
// ════════════════════════════════════════════════════════════════════════════
export interface EditarReceitaPatch {
  titulo?: string | null
  descricaoDetalhada?: string | null
  referenciaContratual?: string | null
  tipoServicoId?: number | null
  origem?: string | null
  observacoes?: string | null
  moeda?: string | null
  valorBaseTotal?: number | null
  cambio?: Partial<RegraCambio> | null
}

// Distribui o novo total entre os irmãos na MESMA proporção atual (a divisão é
// competência de "Editar distribuição"; aqui só escala). Resto no maior. Guarda:
// nenhum irmão abaixo do já recebido.
function ratear(g: Grupo, novoTotal: number): { porObrigacao: Map<number, number>; bloqueios: string[] } {
  const totalAtual = cent(g.membros.reduce((s, m) => s + m.valorBase, 0))
  const porObrigacao = new Map<number, number>()
  const bloqueios: string[] = []
  if (totalAtual <= 0) {
    // sem base atual: divide igualmente
    const q = cent(novoTotal / (g.membros.length || 1))
    let resto = cent(novoTotal - q * g.membros.length); let first = true
    for (const m of g.membros) { const v = first ? cent(q + resto) : q; first = false; porObrigacao.set(m.obrigacaoId, v) }
  } else {
    let acumulado = 0
    const ordenados = [...g.membros].sort((a, b) => b.valorBase - a.valorBase)
    ordenados.forEach((m, i) => {
      const v = i === ordenados.length - 1 ? cent(novoTotal - acumulado) : cent(novoTotal * (m.valorBase / totalAtual))
      acumulado = cent(acumulado + v)
      porObrigacao.set(m.obrigacaoId, v)
    })
  }
  for (const m of g.membros) {
    const alvo = porObrigacao.get(m.obrigacaoId) ?? 0
    if (alvo < m.recebidoBase - 0.005) bloqueios.push(`${m.nome}: novo valor (${alvo}) ficaria abaixo do já recebido (${m.recebidoBase}).`)
    if (alvo < 0) bloqueios.push(`${m.nome}: valor negativo.`)
  }
  return { porObrigacao, bloqueios }
}

function mesclarCambio(atual: RegraCambio, patch?: Partial<RegraCambio> | null): RegraCambio {
  if (!patch) return atual
  return {
    fxRule: patch.fxRule ?? atual.fxRule,
    fxEstimado: patch.fxEstimado !== undefined ? numOrNull(patch.fxEstimado) : atual.fxEstimado,
    fxFixo: patch.fxFixo !== undefined ? numOrNull(patch.fxFixo) : atual.fxFixo,
    fxData: patch.fxData !== undefined ? (patch.fxData ?? null) : atual.fxData,
    valorBrlFixo: patch.valorBrlFixo !== undefined ? numOrNull(patch.valorBrlFixo) : atual.valorBrlFixo,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2) PRÉVIA DE IMPACTO (não grava)
// ════════════════════════════════════════════════════════════════════════════
export interface PreviaCobranca { parcelaId: number; receitaId: number | null; numero: number; vencimento: string | null; valorBaseAntigo: number; valorBaseNovo: number; valorBrlNovo: number }
export interface PreviaImpacto {
  ok: boolean
  bloqueios: string[]
  temPagamentoConfirmado: boolean
  moedaBase: string
  mudaValor: boolean
  mudaCambio: boolean
  valorBaseTotalAntigo: number
  valorBaseTotalNovo: number
  cotacaoEfetivaAntiga: number | null
  cotacaoEfetivaNova: number | null
  valorContratadoBrlAntigo: number
  valorContratadoBrlNovo: number
  recebidoTotalBrl: number
  cobrancasAfetadas: PreviaCobranca[]
}

export async function previaImpactoEdicao(ref: string, patch: EditarReceitaPatch): Promise<PreviaImpacto | null> {
  const g = await descobrirGrupo(ref)
  if (!g) return null
  const rate = (m: string) => (m === 'BRL' ? 1 : g.live.rates[m] ?? null)
  const moeda = (patch.moeda ?? g.moeda) || 'BRL'

  const totalAtual = cent(g.membros.reduce((s, m) => s + m.valorBase, 0))
  const cons = cambioConsolidado(g)
  const novoTotal = patch.valorBaseTotal != null ? cent(patch.valorBaseTotal) : totalAtual
  const mudaValor = Math.abs(novoTotal - totalAtual) > 0.005 || moeda !== g.moeda
  const cambioAtual: RegraCambio = { fxRule: cons.fxRule, fxEstimado: cons.fxEstimado, fxFixo: cons.fxFixo, fxData: cons.fxData, valorBrlFixo: cons.valorBrlFixo }
  const cambioNovo = mesclarCambio(cambioAtual, patch.cambio)
  const mudaCambio = JSON.stringify(cambioAtual) !== JSON.stringify(cambioNovo) || moeda !== g.moeda

  const recebidoTotalBrlPrev = cent(g.membros.reduce((s, m) => s + m.recebidoBrl, 0))

  const { porObrigacao, bloqueios } = ratear(g, novoTotal)
  const { brl: brlNovoTotal, cotacao: cotNovo } = brlContrato(moeda, novoTotal, cambioNovo, rate(moeda))

  // cobranças abertas afetadas: reescala das parcelas PENDENTE (estratégia ATUALIZAR_ABERTAS)
  const cobrancasAfetadas: PreviaCobranca[] = []
  if (mudaValor || mudaCambio) {
    for (const m of g.membros) {
      if (m.receitaId == null) continue
      const parcelas = await prisma.parcelaFinanceira.findMany({ where: { receitaId: m.receitaId }, orderBy: { numero: 'asc' }, select: { id: true, numero: true, vencimento: true, valor: true, status: true } }).catch(() => [])
      const pend = parcelas.filter((p) => p.status === 'PENDENTE')
      if (!pend.length) continue
      const alvoBase = porObrigacao.get(m.obrigacaoId) ?? m.valorBase
      const fixadasBase = cent(parcelas.filter((p) => p.status === 'RECEBIDA' || p.status === 'PAGA').reduce((s, p) => s + Number(p.valor), 0))
      const novoPendenteBase = cent(alvoBase - fixadasBase)
      const somaPendAtual = cent(pend.reduce((s, p) => s + Number(p.valor), 0))
      const novos = redistribuirPendentes(pend.map((p) => ({ id: p.id, valor: Number(p.valor) })), novoPendenteBase, somaPendAtual)
      const cotParcela = moeda === 'BRL' ? 1 : (cotNovo ?? 1)
      for (const p of pend) {
        const nv = novos.get(p.id) ?? 0
        cobrancasAfetadas.push({ parcelaId: p.id, receitaId: m.receitaId, numero: p.numero, vencimento: p.vencimento ? new Date(p.vencimento).toISOString() : null, valorBaseAntigo: cent(Number(p.valor)), valorBaseNovo: nv, valorBrlNovo: cent(nv * cotParcela) })
      }
    }
  }

  return {
    ok: bloqueios.length === 0, bloqueios, temPagamentoConfirmado: recebidoTotalBrlPrev > 0.005, moedaBase: moeda,
    mudaValor, mudaCambio,
    valorBaseTotalAntigo: totalAtual, valorBaseTotalNovo: novoTotal,
    cotacaoEfetivaAntiga: cons.cotacaoEfetiva, cotacaoEfetivaNova: novoTotal > 0 ? cent(brlNovoTotal / novoTotal) : cotNovo,
    valorContratadoBrlAntigo: cons.valorContratadoBrl, valorContratadoBrlNovo: brlNovoTotal,
    recebidoTotalBrl: cent(g.membros.reduce((s, m) => s + m.recebidoBrl, 0)),
    cobrancasAfetadas,
  }
}

// reescala parcelas PENDENTE p/ somar `alvo`. Proporcional ao valor atual; se a
// soma atual for 0, divide igualmente. Resto no último.
function redistribuirPendentes(pend: { id: number; valor: number }[], alvo: number, somaAtual: number): Map<number, number> {
  const out = new Map<number, number>()
  if (!pend.length) return out
  const alvoNN = Math.max(0, cent(alvo))
  let acc = 0
  pend.forEach((p, i) => {
    const last = i === pend.length - 1
    let v: number
    if (last) v = cent(alvoNN - acc)
    else if (somaAtual > 0.005) v = cent(alvoNN * (p.valor / somaAtual))
    else v = cent(alvoNN / pend.length)
    acc = cent(acc + v)
    out.set(p.id, Math.max(0, v))
  })
  return out
}

// ════════════════════════════════════════════════════════════════════════════
// 3) APLICAR EDIÇÃO (transacional)
// ════════════════════════════════════════════════════════════════════════════
export type EstrategiaEdicao = 'ATUALIZAR_ABERTAS' | 'AJUSTE_COMPENSATORIO'
export interface EditarReceitaOpts { estrategia?: EstrategiaEdicao; justificativa?: string | null; criadoPorId?: number | null }
export interface EditarReceitaResultado {
  ok: boolean
  erros: string[]
  membrosAfetados: number
  cobrancasAtualizadas: number
  valorBaseTotal: number
  valorContratadoBrl: number
}

export async function editarReceita(ref: string, patch: EditarReceitaPatch, opts: EditarReceitaOpts): Promise<EditarReceitaResultado> {
  const vazio: EditarReceitaResultado = { ok: false, erros: [], membrosAfetados: 0, cobrancasAtualizadas: 0, valorBaseTotal: 0, valorContratadoBrl: 0 }
  const g = await descobrirGrupo(ref)
  if (!g) return { ...vazio, erros: ['Receita não encontrada.'] }

  const estrategia: EstrategiaEdicao = opts.estrategia ?? 'ATUALIZAR_ABERTAS'
  const criadoPorId = opts.criadoPorId ?? null
  const justificativa = (opts.justificativa ?? '').trim()
  const rate = (m: string) => (m === 'BRL' ? 1 : g.live.rates[m] ?? null)

  const totalAtual = cent(g.membros.reduce((s, m) => s + m.valorBase, 0))
  const cons = cambioConsolidado(g)
  const moeda = (patch.moeda ?? g.moeda) || 'BRL'
  const novoTotal = patch.valorBaseTotal != null ? cent(patch.valorBaseTotal) : totalAtual
  const mudaValor = Math.abs(novoTotal - totalAtual) > 0.005
  const mudaMoeda = moeda !== g.moeda
  const cambioAtual: RegraCambio = { fxRule: cons.fxRule, fxEstimado: cons.fxEstimado, fxFixo: cons.fxFixo, fxData: cons.fxData, valorBrlFixo: cons.valorBrlFixo }
  const cambioNovo = mesclarCambio(cambioAtual, patch.cambio)
  const mudaCambio = JSON.stringify(cambioAtual) !== JSON.stringify(cambioNovo) || mudaMoeda

  if (mudaValor && novoTotal < 0) return { ...vazio, erros: ['O valor-base não pode ser negativo.'] }

  const { porObrigacao, bloqueios } = ratear(g, novoTotal)
  if ((mudaValor || mudaMoeda) && bloqueios.length) return { ...vazio, erros: bloqueios }

  // câmbio consolidado novo → rateio do valorBrlFixo por membro (proporcional à base nova)
  const { brl: brlNovoTotal, cotacao: cotNovo } = brlContrato(moeda, novoTotal, cambioNovo, rate(moeda))
  const cotEfetiva = novoTotal > 0 ? cent(brlNovoTotal / novoTotal) : cotNovo

  // patch textual (título com sufixo preservado, serviço, origem, observações, ctx.edicao)
  const tocaTextual = patch.titulo !== undefined || patch.descricaoDetalhada !== undefined || patch.referenciaContratual !== undefined
    || patch.tipoServicoId !== undefined || patch.origem !== undefined || patch.observacoes !== undefined

  let membrosAfetados = 0, cobrancasAtualizadas = 0
  const lote = `edit-receita:${g.obrigacaoIdRef}:${Date.now()}`

  await prisma.$transaction(async (tx) => {
    for (const m of g.membros) {
      if (m.receitaId == null && !mudaValor && !mudaCambio) continue
      const alvoBase = porObrigacao.get(m.obrigacaoId) ?? m.valorBase
      const delta = cent(alvoBase - m.valorBase)

      // ── Receita (textual + valor + câmbio) ──
      if (m.receitaId != null) {
        const recAtual = await tx.receita.findUnique({ where: { id: m.receitaId }, select: { descricao: true, contextoAplicado: true, observacoes: true, origem: true, tipoServicoId: true, valor: true } })
        const data: Prisma.ReceitaUpdateInput = {}
        if (patch.titulo !== undefined) {
          const { sufixo } = splitDescricao(recAtual?.descricao ?? m.descricao)
          data.descricao = `${(patch.titulo ?? '').trim()}${sufixo}`.slice(0, 300)
        }
        if (patch.tipoServicoId !== undefined) data.tipoServico = patch.tipoServicoId != null ? { connect: { id: patch.tipoServicoId } } : { disconnect: true }
        if (patch.origem !== undefined) data.origem = (patch.origem ?? 'manual').slice(0, 20)
        if (patch.observacoes !== undefined) data.observacoes = patch.observacoes ?? null
        if (patch.descricaoDetalhada !== undefined || patch.referenciaContratual !== undefined) {
          const ctxBase = (recAtual?.contextoAplicado && typeof recAtual.contextoAplicado === 'object' && !Array.isArray(recAtual.contextoAplicado)) ? (recAtual.contextoAplicado as Record<string, unknown>) : {}
          const edicaoBase = (ctxBase.edicao && typeof ctxBase.edicao === 'object' && !Array.isArray(ctxBase.edicao)) ? (ctxBase.edicao as Record<string, unknown>) : {}
          const edicao = { ...edicaoBase }
          if (patch.descricaoDetalhada !== undefined) edicao.descricao = patch.descricaoDetalhada ?? null
          if (patch.referenciaContratual !== undefined) edicao.referenciaContratual = patch.referenciaContratual ?? null
          data.contextoAplicado = { ...ctxBase, edicao } as Prisma.InputJsonValue
        }
        if (mudaMoeda) data.moeda = moeda as never
        if (mudaValor || mudaMoeda) { data.valor = alvoBase; data.valorUnitario = alvoBase; data.valorTotalCongelado = alvoBase }
        if (mudaCambio || mudaMoeda) {
          data.fxRule = cambioNovo.fxRule as never
          data.fxEstimado = cambioNovo.fxEstimado ?? cotEfetiva ?? 1
          data.fxFixo = cambioNovo.fxFixo ?? null
          data.fxData = cambioNovo.fxData ? new Date(cambioNovo.fxData) : null
          // valorBrlFixo consolidado → rateio proporcional à base do membro (só quando FIXO com BRL travado)
          if (cambioNovo.fxRule === 'FIXO' && cambioNovo.valorBrlFixo != null && novoTotal > 0) {
            data.valorBrlFixo = cent(cambioNovo.valorBrlFixo * (alvoBase / novoTotal))
          } else {
            data.valorBrlFixo = null
          }
        }
        if (Object.keys(data).length) await tx.receita.update({ where: { id: m.receitaId }, data })
      }

      // ── ObrigacaoEconomica (valor/moeda) + Ledger AJUSTE ──
      if (mudaValor || mudaMoeda) {
        const obrData: Prisma.ObrigacaoEconomicaUpdateInput = { valorContratado: alvoBase, version: { increment: 1 } }
        if (mudaMoeda) { obrData.moedaContratual = moeda as never; obrData.moedaContabil = moeda as never }
        await tx.obrigacaoEconomica.update({ where: { id: m.obrigacaoId }, data: obrData })
      }
      if (Math.abs(delta) > 0.005) {
        const obr = await tx.obrigacaoEconomica.findUnique({ where: { id: m.obrigacaoId }, include: { ledger: true } })
        if (obr?.ledger) {
          const oc = await tx.ocorrenciaFinanceira.create({ data: {
            obrigacaoId: m.obrigacaoId, tipo: 'AJUSTE', valor: Math.abs(delta), moeda: moeda as never, data: new Date(),
            status: 'PROCESSADA', observacao: `Edição da Receita — valor-base ${m.valorBase} → ${alvoBase}${justificativa ? ' — ' + justificativa : ''}`.slice(0, 300),
            idempotencyKey: `${lote}:${m.obrigacaoId}`, correlacaoId: lote.slice(0, 60), criadoPorId,
          } })
          await registrarLancamento(tx, {
            obrigacaoId: m.obrigacaoId, ledgerId: obr.ledger.id, transacaoId: `${lote}:${m.obrigacaoId}`,
            lancamento: lancAjusteContrato(delta, aReceber(m.natureza ?? 'RECEITA')), ocorrenciaId: oc.id, moeda, criadoPorId,
          })
        }
      } else if (mudaMoeda) {
        // moeda mudou sem mudar o valor-base numérico: só reprojeta (ledger valores nominais preservados)
        await recomputarProjecao(tx, m.obrigacaoId)
      }

      // ── Cobranças ABERTAS (parcelas PENDENTE) conforme estratégia ──
      if ((mudaValor || mudaCambio) && m.receitaId != null && estrategia === 'ATUALIZAR_ABERTAS') {
        const parcelas = await tx.parcelaFinanceira.findMany({ where: { receitaId: m.receitaId }, orderBy: { numero: 'asc' }, select: { id: true, valor: true, status: true } })
        const pend = parcelas.filter((p) => p.status === 'PENDENTE')
        if (pend.length) {
          const fixadasBase = cent(parcelas.filter((p) => p.status === 'RECEBIDA' || p.status === 'PAGA').reduce((s, p) => s + Number(p.valor), 0))
          const novoPendenteBase = cent(alvoBase - fixadasBase)
          const somaPendAtual = cent(pend.reduce((s, p) => s + Number(p.valor), 0))
          const novos = redistribuirPendentes(pend.map((p) => ({ id: p.id, valor: Number(p.valor) })), novoPendenteBase, somaPendAtual)
          const cotParcela = moeda === 'BRL' ? null : cotNovo
          for (const p of pend) {
            const nv = novos.get(p.id) ?? 0
            await tx.parcelaFinanceira.update({ where: { id: p.id }, data: {
              valor: nv, cambioAplicado: cotParcela ?? null, valorBrl: cotParcela != null ? cent(nv * cotParcela) : (moeda === 'BRL' ? nv : null),
            } })
            cobrancasAtualizadas++
          }
        }
      }

      // ── Auditoria (por Receita) ──
      if (m.receitaId != null) {
        const partes: string[] = []
        if (tocaTextual) partes.push('dados cadastrais')
        if (mudaMoeda) partes.push(`moeda ${g.moeda}→${moeda}`)
        if (mudaValor) partes.push(`valor-base ${m.valorBase}→${alvoBase}`)
        if (mudaCambio && !mudaMoeda) partes.push('regra de câmbio')
        await tx.eventoFinanceiro.create({ data: {
          receitaId: m.receitaId, tipo: 'EDICAO', usuarioId: criadoPorId,
          descricao: `Edição da Receita: ${partes.join('; ') || 'sem alterações'}${justificativa ? ` — ${justificativa}` : ''}`.slice(0, 500),
          valor: mudaValor ? alvoBase : null, cambio: cotEfetiva ?? undefined,
          dados: {
            estrategia, justificativa: justificativa || null,
            anterior: { valorBase: m.valorBase, moeda: g.moeda, cambio: cambioAtual, descricao: m.descricao },
            novo: { valorBase: alvoBase, moeda, cambio: cambioNovo, titulo: patch.titulo ?? undefined },
          } as unknown as Prisma.InputJsonValue,
        } }).catch(() => {})
      }
      membrosAfetados++
    }
  }, { timeout: 30000 })

  return { ok: true, erros: [], membrosAfetados, cobrancasAtualizadas, valorBaseTotal: novoTotal, valorContratadoBrl: brlNovoTotal }
}
