// lib/financeiro/extras/lancamento-manual.ts
// ============================================================================
// LANÇAMENTO MANUAL de Receita/Custo (dentro do processo). Nasce SEMPRE de um
// item do Cadastro Mestre (itemCatalogoId) — nunca texto livre como fonte. Reusa
// o motor V3 (criarLancamentoExtra → ObrigacaoEconomica + Ledger + distribuição
// + pagamento opcional). O total é calculado no SERVIDOR (autoritativo). Marca a
// origem como manual (observação + origemTipo 'nativo') para auditoria/timeline.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { criarLancamentoExtra } from './lancamento-extra-service'
import { resolverDistribuicao, type ModoDistribuicao } from '../dominio/obrigacao-economica'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface ParticipanteRateio { pessoaId: number; percentual?: number | null; valor?: number | null; incluido?: boolean }

export interface EntradaLancamentoManual {
  natureza: 'RECEITA' | 'CUSTO'
  processoId: number
  itemCatalogoId: number
  descricao?: string | null // descrição complementar (texto livre PERMITIDO só aqui)
  quantidade?: number
  valorUnitario: number
  moeda?: string
  desconto?: number
  acrescimo?: number // custo
  vencimento?: Date | null
  formaCobranca?: string | null
  fornecedorId?: number | null // custo
  centroCustoId?: number | null // custo
  faseLabel?: string | null
  rateio?: { modo: ModoDistribuicao; participantes: ParticipanteRateio[] } | null
  pagamento?: { observacao?: string | null; comprovanteUrl?: string | null } | null
  criadoPorId?: number | null
}

export interface ResultadoLancamentoManual { obrigacaoId: number; total: number; moeda: string }

/** Valida e cria o lançamento manual. Lança Error com mensagem clara em falha. */
export async function criarLancamentoManual(e: EntradaLancamentoManual): Promise<ResultadoLancamentoManual> {
  const qtd = e.quantidade && e.quantidade > 0 ? e.quantidade : 1
  const unit = Number(e.valorUnitario)
  if (!isFinite(unit) || unit <= 0) throw new Error('Informe um valor unitário maior que zero.')
  const desconto = Math.max(0, Number(e.desconto) || 0)
  const acrescimo = Math.max(0, Number(e.acrescimo) || 0)
  const subtotal = cent(qtd * unit)
  const total = cent(subtotal - desconto + (e.natureza === 'CUSTO' ? acrescimo : 0))
  if (total <= 0) throw new Error('O total precisa ser maior que zero (revise valor/desconto).')

  const moeda = e.moeda ?? 'BRL'

  // Item é a FONTE do lançamento — obrigatório e válido.
  const item = await prisma.itemCatalogo.findUnique({ where: { id: e.itemCatalogoId }, select: { name: true, ativo: true } })
  if (!item || !item.ativo) throw new Error('Item do Catálogo Mestre inválido ou inativo.')

  // Rateio: valida ANTES (o service não checa .ok). Participantes só incluídos.
  let distribuicao: { modo: ModoDistribuicao; participantes: { pessoaId: number; percentual?: number; valor?: number; incluido?: boolean }[] } | null = null
  if (e.rateio && e.rateio.modo !== 'SEM_DIVISAO' && (e.rateio.participantes?.length ?? 0) > 0) {
    const incluidos = e.rateio.participantes
      .filter((p) => p.incluido !== false && p.pessoaId != null)
      .map((p) => ({ pessoaId: p.pessoaId, percentual: p.percentual ?? undefined, valor: p.valor ?? undefined, incluido: true }))
    if (incluidos.length) {
      const check = resolverDistribuicao(total, e.rateio.modo, incluidos)
      if (!check.ok) throw new Error(`Rateio inválido: ${check.erros.join(' ')}`)
      distribuicao = { modo: e.rateio.modo, participantes: incluidos }
    }
  }

  // Fornecedor (custo): valida se informado.
  let fornecedorNome: string | null = null
  if (e.natureza === 'CUSTO' && e.fornecedorId) {
    const f = await prisma.fornecedor.findUnique({ where: { id: e.fornecedorId }, select: { nome: true } })
    if (!f) throw new Error('Fornecedor inexistente.')
    fornecedorNome = f.nome
  }

  // Observação = descrição (item por padrão) + rastro de auditoria do lançamento manual.
  const descricaoBase = (e.descricao && e.descricao.trim()) ? e.descricao.trim() : item.name
  const rastro: string[] = ['lançamento manual', `item: ${item.name}`]
  if (qtd !== 1) rastro.push(`qtd ${qtd} × ${unit}`)
  if (desconto > 0) rastro.push(`desconto ${desconto}`)
  if (acrescimo > 0 && e.natureza === 'CUSTO') rastro.push(`acréscimo ${acrescimo}`)
  if (fornecedorNome) rastro.push(`fornecedor: ${fornecedorNome}`)
  if (e.formaCobranca) rastro.push(`forma: ${e.formaCobranca}`)
  if (e.faseLabel) rastro.push(`fase: ${e.faseLabel}`)
  const observacoes = `${descricaoBase} · [${rastro.join(' · ')}]`

  const r = await criarLancamentoExtra({
    natureza: e.natureza,
    descricao: observacoes,
    valor: total,
    moeda,
    processoId: e.processoId,
    itemCatalogoId: e.itemCatalogoId, // FONTE do lançamento (Cadastro Mestre) — estrutural
    fornecedorId: e.natureza === 'CUSTO' ? (e.fornecedorId ?? null) : null,
    centroCustoId: e.natureza === 'CUSTO' ? (e.centroCustoId ?? null) : null,
    vencimento: e.vencimento ?? null,
    distribuicao,
    pagamento: e.pagamento ? { observacao: e.pagamento.observacao ?? 'Pagamento no lançamento manual', comprovanteUrl: e.pagamento.comprovanteUrl ?? null } : null,
    criadoPorId: e.criadoPorId ?? null,
  })

  return { obrigacaoId: r.obrigacaoId, total, moeda }
}
