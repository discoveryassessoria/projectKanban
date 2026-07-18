// lib/financeiro/financeiro-geral-projecao.ts
// ============================================================================
// §6/§8 — PROJEÇÃO do Financeiro Geral (Preferência 1: LEITURA/VIEW sobre o
// lançamento de origem). NÃO cria segundo lançamento; NÃO há segunda fonte de
// verdade. Cada lançamento do processo tem UMA representação corporativa,
// identificada por (lancamentoOrigemTipo, lancamentoOrigemId, tipoProjecao).
//
// Idempotência (§8): por CONSTRUÇÃO — cada lançamento é lido UMA vez e mapeado a
// UMA linha de projeção; reprocessar/reconstruir relê os mesmos dados sem duplicar
// (não há INSERT). A chaveProjecao é a identidade lógica única da projeção.
//
// Mapeamento (§1 usa o serviço de natureza; aqui a natureza do LANÇAMENTO já é a
// identidade do model):
//   RECEITA  → Contas a Receber   |   CUSTO → Contas a Pagar.
// ============================================================================
import { prisma } from '@/lib/prisma'

export type TipoProjecao = 'RECEBER' | 'PAGAR'
export type OrigemProjecao = 'PROCESSO' | 'CORPORATIVA'
export type FonteOrigem = 'receita' | 'custo' | 'contaPagar'

export interface ItemProjecao {
  tipoProjecao: TipoProjecao
  origem: OrigemProjecao
  lancamentoOrigemTipo: FonteOrigem
  lancamentoOrigemId: number
  chaveProjecao: string // identidade lógica única (lancamentoOrigemTipo:id:tipoProjecao)
  descricao: string
  valor: number
  moeda: string
  natureza: 'CUSTO' | 'RECEITA'
  status: string
  processoId: number | null
  fornecedor: string | null
  cliente: string | null
  estorno: boolean // linha de movimento inverso (§11)
  dataCompetencia: Date | null
  editavelEstrutural: boolean // §7/§14 — projeção de PROCESSO não é editável no Geral
}

export function chaveProjecao(tipo: FonteOrigem, id: number, proj: TipoProjecao): string {
  return `${tipo}:${id}:${proj}`
}

// ── Mapeadores PUROS (testáveis sem banco) ───────────────────────────────────
export interface ReceitaProjRow { id: number; descricao: string; valor: number; moeda: string; status: string; processoId: number | null; estornoDeId: number | null; dataCompetencia: Date | null; clienteNome?: string | null }
export interface CustoProjRow { id: number; descricao: string; valor: number; moeda: string; status: string; processoId: number | null; fornecedor: string | null; estornoDeId: number | null; dataCompetencia: Date | null }
export interface ContaPagarProjRow { id: number; descricao: string; valor: number; status: string; processoId: number | null; dataCompetencia: Date | null; fornecedorNome: string | null }

/** RECEITA → uma linha de Contas a Receber por lançamento (idempotente por construção). */
export function mapReceberPuro(receitas: ReceitaProjRow[]): ItemProjecao[] {
  return receitas.map((r): ItemProjecao => ({
    tipoProjecao: 'RECEBER', origem: 'PROCESSO', lancamentoOrigemTipo: 'receita', lancamentoOrigemId: r.id,
    chaveProjecao: chaveProjecao('receita', r.id, 'RECEBER'), descricao: r.descricao, valor: Number(r.valor), moeda: r.moeda,
    natureza: 'RECEITA', status: r.status, processoId: r.processoId, fornecedor: null, cliente: r.clienteNome ?? null,
    estorno: r.estornoDeId != null, dataCompetencia: r.dataCompetencia, editavelEstrutural: false,
  }))
}

/** CUSTO de processo ∪ ContaPagar corporativa → Contas a Pagar (cada um UMA vez). */
export function mapPagarPuro(custos: CustoProjRow[], corporativas: ContaPagarProjRow[]): ItemProjecao[] {
  const doProcesso = custos.map((c): ItemProjecao => ({
    tipoProjecao: 'PAGAR', origem: 'PROCESSO', lancamentoOrigemTipo: 'custo', lancamentoOrigemId: c.id,
    chaveProjecao: chaveProjecao('custo', c.id, 'PAGAR'), descricao: c.descricao, valor: Number(c.valor), moeda: c.moeda,
    natureza: 'CUSTO', status: c.status, processoId: c.processoId, fornecedor: c.fornecedor ?? null, cliente: null,
    estorno: c.estornoDeId != null, dataCompetencia: c.dataCompetencia, editavelEstrutural: false,
  }))
  const doCorporativo = corporativas.map((c): ItemProjecao => ({
    tipoProjecao: 'PAGAR', origem: 'CORPORATIVA', lancamentoOrigemTipo: 'contaPagar', lancamentoOrigemId: c.id,
    chaveProjecao: chaveProjecao('contaPagar', c.id, 'PAGAR'), descricao: c.descricao, valor: Number(c.valor), moeda: 'BRL',
    natureza: 'CUSTO', status: c.status, processoId: c.processoId, fornecedor: c.fornecedorNome ?? null, cliente: null,
    estorno: false, dataCompetencia: c.dataCompetencia, editavelEstrutural: true, // corporativa é editável no Geral
  }))
  return [...doProcesso, ...doCorporativo]
}

/** Contas a Receber = lançamentos de RECEITA (não cancelados). Inclui estornos (negativos). */
export async function projetarContasAReceber(): Promise<ItemProjecao[]> {
  const receitas = await prisma.receita.findMany({
    where: { canceladoEm: null, status: { not: 'CANCELADA' }, cancelada: false },
    select: { id: true, descricao: true, valor: true, moeda: true, status: true, processoId: true, estornoDeId: true, dataCompetencia: true, processo: { select: { nome: true } } },
  })
  return mapReceberPuro(receitas.map((r) => ({ ...r, valor: Number(r.valor), clienteNome: r.processo?.nome ?? null })))
}

/** Contas a Pagar = CUSTO de processo (não cancelado) ∪ ContaPagar corporativa. */
export async function projetarContasAPagar(): Promise<ItemProjecao[]> {
  const [custos, corporativas] = await Promise.all([
    prisma.custo.findMany({
      where: { canceladoEm: null, status: { not: 'CANCELADA' }, cancelado: false },
      select: { id: true, descricao: true, valor: true, moeda: true, status: true, processoId: true, fornecedor: true, estornoDeId: true, dataCompetencia: true },
    }),
    prisma.contaPagar.findMany({
      // §7 — corporativas nascem no Geral; as de processo (custoOrigemId) são refletidas via Custo (evita duplicar)
      where: { custoOrigemId: null, status: { not: 'CANCELADO' } },
      select: { id: true, descricao: true, valor: true, status: true, processoId: true, dataCompetencia: true, fornecedor: { select: { nome: true } } },
    }),
  ])
  return mapPagarPuro(
    custos.map((c) => ({ ...c, valor: Number(c.valor) })),
    corporativas.map((c) => ({ id: c.id, descricao: c.descricao, valor: Number(c.valor), status: c.status, processoId: c.processoId, dataCompetencia: c.dataCompetencia, fornecedorNome: c.fornecedor?.nome ?? null })),
  )
}

export interface ResumoProjecao {
  receber: ItemProjecao[]
  pagar: ItemProjecao[]
  totais: { aReceber: number; aPagar: number; saldoProjetado: number; estornosReceber: number; estornosPagar: number }
}

/** Visão consolidada (Fluxo de Caixa projetado / DRE leem estes MESMOS lançamentos). */
export async function projetarFinanceiroGeral(): Promise<ResumoProjecao> {
  const [receber, pagar] = await Promise.all([projetarContasAReceber(), projetarContasAPagar()])
  const soma = (xs: ItemProjecao[]) => xs.reduce((s, i) => s + i.valor, 0)
  return {
    receber, pagar,
    totais: {
      aReceber: soma(receber), aPagar: soma(pagar), saldoProjetado: soma(receber) - soma(pagar),
      estornosReceber: soma(receber.filter((i) => i.estorno)), estornosPagar: soma(pagar.filter((i) => i.estorno)),
    },
  }
}
