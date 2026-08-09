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
import { resolverCotacao, type CotacaoResolvida } from './cotacao-resolver'

export interface EntradaRuntime {
  receitaId: number
  formaPagamentoId?: number | null
  condicaoPagamentoId?: number | null
  carteiraId?: number | null
  contaBancariaId?: number | null
  nParcelas?: number | null
  politicaTaxasEscolhida?: string | null
  bandeiraId?: number | null // cartão: desempata a taxa por bandeira
  entradaValor?: number | null // entrada informada na cobrança (PIX/Transferência)
  // ── câmbio ──
  moedaRecebimento?: string | null // destino; ausente = mesma da receita
  cotacaoManual?: number | null // cotação informada (exige permissão)
  autorizadoManual?: boolean // usuário pode informar cotação manual?
  fonteCotacao?: string | null
  dataCotacao?: string | Date | null
  justificativaCotacaoManual?: string | null
  usuarioId?: number | null
  congelar?: boolean // confirmação congela o câmbio
}

export interface SaidaRuntime {
  resultado: ResultadoCobranca
  receita: { id: number; processoId: number; valor: number; moeda: string }
  condicao: { id: number; versao: number | null; codigo: string | null } | null
  /** Cotação resolvida (para persistir o snapshot cambial na confirmação). */
  cambio: CotacaoResolvida
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
  // Pool de candidatas = TABELA DE TAXAS (fonte única): taxas da FORMA escolhida
  // (por formasAplicaveis) + as explicitamente vinculadas à condição. Deduplicado
  // por id; a grade de parcelamento vem junta. A elegibilidade final (forma/
  // bandeira/parcela/moeda/vigência) e a política são resolvidas no serviço puro.
  const taxasPorId = new Map<number, any>()
  if (e.condicaoPagamentoId) {
    const cond = await prisma.condicaoPagamento.findUnique({
      where: { id: Number(e.condicaoPagamentoId) },
      include: { taxasVinculadas: { include: { taxa: { include: { parcelamento: true } } } }, formasPermitidas: { select: { formaId: true } } },
    })
    if (!cond) return { erro: 'Condição de pagamento inválida', status: 400 }
    // Guard de aplicabilidade (backend = autoridade): condição inativa ou fora
    // da vigência nunca gera cobrança.
    if (cond.ativo === false) return { erro: 'Condição de pagamento inativa.', status: 400 }
    const agora = new Date()
  // VALIDADE É ESTADO, NÃO DATA (09/08/2026): cadastro ativo vale sempre.
    condicaoView = JSON.parse(JSON.stringify(cond))
    condicaoView.formasPermitidasIds = cond.formasPermitidas.map((x) => x.formaId)
    condicaoView.formaPadraoId = cond.formaSugeridaId ?? null
    condMeta = { id: cond.id, versao: cond.versao, codigo: cond.codigo }
    for (const v of cond.taxasVinculadas) taxasPorId.set(v.taxa.id, v.taxa)
  }
  if (forma) {
    const daForma = await prisma.taxaPagamento.findMany({
      where: { ativo: true, formasAplicaveis: { has: forma.id ?? -1 } },
      include: { parcelamento: true },
    })
    for (const t of daForma) taxasPorId.set(t.id, t)
  }
  const taxaCandidatas = [...taxasPorId.values()].map((t) => taxaParaCandidata(JSON.parse(JSON.stringify(t))))

  // ── Cotação (autoridade do backend): automática (CotacaoCambio vigente),
  //    manual (com permissão) ou estimada (fallback rotulado). Indisponível
  //    bloqueia a geração — nunca cotação 1 silenciosa entre moedas diferentes.
  const cambio = await resolverCotacao(prisma, {
    origem: String(receita.moeda),
    destino: String(e.moedaRecebimento ?? receita.moeda),
    cotacaoManual: e.cotacaoManual ?? null,
    autorizadoManual: !!e.autorizadoManual,
    fonteManual: e.fonteCotacao ?? null,
    dataManual: e.dataCotacao ? new Date(e.dataCotacao) : null,
    justificativa: e.justificativaCotacaoManual ?? null,
    usuarioId: e.usuarioId ?? null,
    fxEstimadoFallback: receita.fxEstimado != null ? Number(receita.fxEstimado) : null,
  })
  if (cambio.bloqueio) return { erro: cambio.bloqueio, status: 400 }

  const input: CobrancaInput = {
    aplicaComo: 'RECEBER', // Receita ⇒ Contas a Receber
    valorBase: Number(receita.valor),
    moeda: String(receita.moeda),
    dataBase: new Date(),
    forma,
    condicao: condicaoView,
    politicaTaxasEscolhida: (e.politicaTaxasEscolhida as any) ?? null,
    nParcelas: e.nParcelas ?? null,
    bandeiraId: e.bandeiraId ?? null,
    entradaValor: e.entradaValor ?? null,
    carteiraId: e.carteiraId ?? condicaoView?.carteiraId ?? null,
    contaBancariaId: e.contaBancariaId ?? null,
    taxaCandidatas,
    cambio: {
      moedaOrigem: cambio.moedaOrigem, moedaDestino: cambio.moedaDestino, cotacao: cambio.cotacao,
      data: cambio.data, fonte: cambio.fonte, congelado: !!e.congelar,
      tipo: cambio.tipo, estado: cambio.estado, direcao: cambio.direcao,
    },
  }

  return {
    resultado: calcularCobranca(input),
    receita: { id: receita.id, processoId: receita.processoId, valor: Number(receita.valor), moeda: String(receita.moeda) },
    condicao: condMeta,
    cambio,
  }
}
