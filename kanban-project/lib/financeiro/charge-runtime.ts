// lib/financeiro/charge-runtime.ts
// ============================================================================
// Carregador server-side do ChargeCalculationService. Traduz IDs de Cobrança
// (receita/forma/condição/taxas/carteira/conta) em CobrancaInput e delega o
// cálculo ao serviço PURO. É o único ponto que toca o banco para o runtime da
// Cobrança — simulação e confirmação passam por aqui (backend = autoridade).
// ============================================================================
import { prisma } from '@/lib/prisma'
import { paraFormaView } from './payment-method-rules'
import { calcularCobranca, taxaParaCandidata, type CobrancaInput, type ResultadoCobranca } from './charge-calculation-service'

export interface EntradaRuntime {
  receitaId: number
  formaPagamentoId?: number | null
  condicaoPagamentoId?: number | null
  carteiraId?: number | null
  contaBancariaId?: number | null
  nParcelas?: number | null
  politicaTaxasEscolhida?: string | null
  congelar?: boolean // confirmação congela o câmbio
}

export interface SaidaRuntime {
  resultado: ResultadoCobranca
  receita: { id: number; processoId: number; valor: number; moeda: string }
  condicao: { id: number; versao: number | null; codigo: string | null } | null
}

/** Carrega tudo por ID e calcula. Não persiste. */
export async function montarECalcular(e: EntradaRuntime): Promise<SaidaRuntime | { erro: string; status: number }> {
  const receita = await prisma.receita.findUnique({
    where: { id: e.receitaId },
    select: { id: true, processoId: true, valor: true, moeda: true, fxEstimado: true, fxData: true },
  })
  if (!receita) return { erro: 'Receita não encontrada', status: 404 }

  let forma = null
  if (e.formaPagamentoId) {
    const f = await prisma.formaPagamentoCadastro.findUnique({ where: { id: Number(e.formaPagamentoId) } })
    if (!f) return { erro: 'Forma de pagamento inválida', status: 400 }
    forma = paraFormaView(f)
  }

  let condicaoView: any = null
  let condMeta: SaidaRuntime['condicao'] = null
  let taxaCandidatas: ReturnType<typeof taxaParaCandidata>[] = []
  if (e.condicaoPagamentoId) {
    const cond = await prisma.condicaoPagamento.findUnique({
      where: { id: Number(e.condicaoPagamentoId) },
      include: { taxasVinculadas: { include: { taxa: true } }, formasPermitidas: { select: { formaId: true } } },
    })
    if (!cond) return { erro: 'Condição de pagamento inválida', status: 400 }
    condicaoView = JSON.parse(JSON.stringify(cond)) // Decimals→string, Dates→ISO
    // Formas permitidas (vazio = sem restrição) e Forma PADRÃO (só sugestão —
    // a coluna legada formaSugeridaId é a FK da forma padrão).
    condicaoView.formasPermitidasIds = cond.formasPermitidas.map((x) => x.formaId)
    condicaoView.formaPadraoId = cond.formaSugeridaId ?? null
    condMeta = { id: cond.id, versao: cond.versao, codigo: cond.codigo }
    taxaCandidatas = cond.taxasVinculadas.map((v) => taxaParaCandidata(JSON.parse(JSON.stringify(v.taxa))))
  }

  const input: CobrancaInput = {
    aplicaComo: 'RECEBER', // Receita ⇒ Contas a Receber
    valorBase: Number(receita.valor),
    moeda: String(receita.moeda),
    dataBase: new Date(),
    forma,
    condicao: condicaoView,
    politicaTaxasEscolhida: (e.politicaTaxasEscolhida as any) ?? null,
    nParcelas: e.nParcelas ?? null,
    carteiraId: e.carteiraId ?? condicaoView?.carteiraId ?? null,
    contaBancariaId: e.contaBancariaId ?? null,
    taxaCandidatas,
    cambio: { moedaOrigem: String(receita.moeda), cotacao: Number(receita.fxEstimado ?? 1), data: receita.fxData ?? null, fonte: 'receita', congelado: !!e.congelar },
  }

  return {
    resultado: calcularCobranca(input),
    receita: { id: receita.id, processoId: receita.processoId, valor: Number(receita.valor), moeda: String(receita.moeda) },
    condicao: condMeta,
  }
}
