// lib/financeiro/extras/lancamento-extra-service.ts
// ============================================================================
// LANÇAMENTOS FINANCEIROS EXTRAS (Motor Financeiro V3 · Fase 2). Cria uma nova
// ObrigacaoEconomica de natureza extra (RECEITA_EXTRA/DESCONTO/JUROS/MULTA/
// REEMBOLSO/CREDITO/AJUSTE) com Ledger próprio, distribuição econômica flexível
// (independente do pagador) e — opcionalmente — pagamento imediato. Sem
// pagamento imediato, a obrigação fica em aberto como cobrança futura (vencimento).
// ============================================================================
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '../ledger/ledger-service'
import { resolverDistribuicao, type Natureza, type ModoDistribuicao } from '../dominio/obrigacao-economica'
import { registrarOcorrencia } from '../ocorrencias/ocorrencia-service'

export interface EntradaLancamentoExtra {
  natureza: Natureza
  descricao?: string | null
  valor: number
  moeda?: string
  processoId?: number | null
  faseId?: number | null
  clienteId?: number | null
  vencimento?: Date | null // cobrança futura
  distribuicao?: { modo: ModoDistribuicao; participantes: { pessoaId: number; percentual?: number; valor?: number; incluido?: boolean }[] } | null
  // Presente ⇒ pagamento IMEDIATO; ausente ⇒ cobrança futura (fica em aberto).
  pagamento?: {
    pagador?: { tipo: string; pessoaId?: number | null; parteExterna?: { nome: string; documento?: string | null } | null } | null
    comprovanteUrl?: string | null
    observacao?: string | null
  } | null
  criadoPorId?: number | null
}

/** Cria a obrigação extra + distribuição + (opcional) pagamento imediato. */
export async function criarLancamentoExtra(e: EntradaLancamentoExtra) {
  const moeda = e.moeda ?? 'BRL'
  const { obrigacaoId, reaproveitada } = await criarObrigacaoEconomicaComLedger({
    natureza: e.natureza,
    valorContratado: e.valor,
    moedaContratual: moeda,
    processoId: e.processoId ?? null,
    faseId: e.faseId ?? null,
    clienteId: e.clienteId ?? null,
    vencimento: e.vencimento ?? null,
    observacoes: e.descricao ?? null,
    origemTipo: 'nativo',
    origemId: null,
    criadoPorId: e.criadoPorId ?? null,
  })

  // distribuição econômica flexível (independente de quem paga)
  if (e.distribuicao && e.distribuicao.participantes.length) {
    const incluidos = e.distribuicao.participantes.filter((p) => p.incluido !== false)
    const cotas = resolverDistribuicao(e.valor, e.distribuicao.modo, incluidos.map((p) => ({ pessoaId: p.pessoaId, percentual: p.percentual, valor: p.valor })))
    const dist = await prisma.distribuicaoEconomica.create({ data: { obrigacaoId, modo: e.distribuicao.modo, versao: 1 } })
    const mapa = new Map(cotas.cotas.map((c) => [c.pessoaId, c.valor]))
    await prisma.participacaoEconomica.createMany({ data: e.distribuicao.participantes.map((p, i) => ({
      distribuicaoId: dist.id, pessoaId: p.pessoaId, incluido: p.incluido !== false,
      percentual: p.percentual ?? null, valor: p.incluido !== false ? (mapa.get(p.pessoaId) ?? null) : null, moeda: moeda as any, ordem: i,
    })) })
  }

  // pagamento imediato (opcional): quita contra o saldo da obrigação
  let ocorrenciaId: number | null = null
  if (e.pagamento) {
    const r = await registrarOcorrencia({
      obrigacaoId, tipo: 'PAGAMENTO', valor: e.valor, moeda,
      pagador: e.pagamento.pagador ?? null,
      comprovanteUrl: e.pagamento.comprovanteUrl ?? null,
      observacao: e.pagamento.observacao ?? null,
      criadoPorId: e.criadoPorId ?? null,
    })
    ocorrenciaId = r.ocorrenciaId
  }

  return { obrigacaoId, reaproveitada, ocorrenciaId }
}
