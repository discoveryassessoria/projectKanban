// lib/financeiro/charge-calculation-service.ts
// ============================================================================
// ChargeCalculationService — AUTORIDADE ÚNICA do cálculo de uma Cobrança.
//
// Compõe os motores puros existentes numa única passagem determinística:
//   payment-method-rules (valida a Forma) → resolução de UMA taxa por prioridade
//   → matriz de Política de Taxas (IGNORAR/REPASSAR/ABSORVER/ESCOLHER) →
//   gerarCronograma (parcelas/entrada/vencimentos) → câmbio → memória de cálculo.
//
// Usado por SIMULAÇÃO (não persiste) e por CONFIRMAÇÃO (persiste). O backend é a
// autoridade final: a confirmação recalcula, nunca confia no número do cliente.
// Módulo PURO: sem Prisma, sem fetch, sem React.
// ============================================================================
import { gerarCronograma, calcularValorEntrada, type CondicaoPagamentoView } from './condicao-pagamento'
import { calcularTaxas, type TaxaView } from './taxas-pagamento'
import { validarCompatibilidadeCobranca, type FormaView } from './payment-method-rules'
import { formaPermitidaNaCondicao } from './condicao-formas'
import { linhaParaParcelas, rotuloLinha, type LinhaParcelamento } from './taxa-parcelamento'

export type Direcao = 'RECEBER' | 'PAGAR'
export type PoliticaTaxas = 'IGNORAR' | 'REPASSAR' | 'ABSORVER' | 'ESCOLHER_NA_COBRANCA'
const POLITICAS_EFETIVAS: PoliticaTaxas[] = ['IGNORAR', 'REPASSAR', 'ABSORVER']

/** Taxa candidata: TaxaView + campos de seleção (prioridade/forma/moeda). */
export interface TaxaCandidata extends TaxaView {
  prioridade?: number | null
  formasAplicaveis?: number[] | null
  moedasAplicaveis?: string[] | null
  /** Bandeira à qual a taxa é específica. null = vale p/ qualquer bandeira. */
  bandeiraId?: number | null
  /** Tabela comercial da adquirente (1x 2,99% / 3–6x 4,19%…). Vazia = usa os
   *  valores do próprio registro da taxa. */
  tabelaParcelamento?: LinhaParcelamento[] | null
}

export interface CobrancaInput {
  aplicaComo: Direcao
  valorBase: number
  moeda: string
  dataBase: Date
  forma?: FormaView | null
  condicao?: (CondicaoPagamentoView & {
    politicaTaxas?: string | null; aplicaA?: string | null; carteiraId?: number | null
    /** Ids das Formas permitidas pela condição. Vazio/ausente = sem restrição. */
    formasPermitidasIds?: number[] | null
    /** Forma PADRÃO (sugestão inicial). Nunca restringe: só pré-seleciona. */
    formaPadraoId?: number | null
  }) | null
  /** Escolha explícita quando a política da condição é ESCOLHER_NA_COBRANCA. */
  politicaTaxasEscolhida?: PoliticaTaxas | null
  nParcelas?: number | null
  carteiraId?: number | null
  contaBancariaId?: number | null
  /** Bandeira escolhida (cartão). Desempata taxas específicas por bandeira. */
  bandeiraId?: number | null
  /**
   * Entrada informada NA COBRANÇA (PIX/Transferência, à parte). Quando > 0 e a
   * condição permite entrada, separa esse valor da base tributável da taxa.
   * Ausente = usa a entrada padrão da condição (se houver).
   */
  entradaValor?: number | null
  /** Taxas vinculadas à condição (pool de candidatas). */
  taxaCandidatas?: TaxaCandidata[]
  /** Câmbio quando há conversão (estimado no rascunho; congelado na confirmação). */
  cambio?: {
    moedaOrigem?: string | null; moedaDestino?: string | null; cotacao?: number | null
    data?: Date | null; fonte?: string | null; congelado?: boolean
    tipo?: string | null; estado?: string | null; direcao?: string | null
  } | null
}

export interface CobrancaErro { codigo: string; mensagem: string }

export interface ParcelaCalculada {
  numero: number
  vencimento: Date
  valor: number
  entrada: boolean
  valorTaxa: number
  valorLiquido: number
}

export interface ResultadoCobranca {
  ok: boolean
  erros: CobrancaErro[]
  aplicaComo: Direcao
  moeda: string
  cambio: { moedaOrigem: string; moedaDestino: string; cotacao: number; data: Date | null; fonte: string | null; estimado: boolean; tipo: string | null; estado: string | null; direcao: string | null } | null
  politicaTaxas: PoliticaTaxas | null
  taxaAplicada: { id: number | null; nome: string; tipo: string; adquirente: string | null; prioridade: number | null; formula: string } | null
  valorBase: number
  valorTaxa: number
  valorRepassado: number
  valorAbsorvido: number
  totalCobrado: number
  valorLiquido: number
  nParcelas: number
  parcelas: ParcelaCalculada[]
  memoria: string[]
  snapshot: Record<string, unknown>
}

/**
 * Uma Cobrança pode ser recalculada (rascunho) ou está congelada (confirmada/
 * com pagamento)? Rascunho = status ABERTA e sem nenhum pagamento registrado.
 * Nunca reescreve histórico financeiro de cobrança paga.
 */
export function podeRecalcular(c: { status?: string | null; temPagamento?: boolean | null; congeladaEm?: Date | string | null }): boolean {
  if (c.temPagamento) return false
  if (c.congeladaEm) return false
  const st = String(c.status ?? 'ABERTA').toUpperCase()
  return st === 'ABERTA'
}

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100
const asData = (v: string | Date | null | undefined): Date | null => {
  if (!v) return null
  const d = v instanceof Date ? new Date(v) : new Date(String(v))
  return isNaN(d.getTime()) ? null : d
}

/** TaxaPagamento (registro) → TaxaCandidata que os motores consomem. */
export function taxaParaCandidata(t: any): TaxaCandidata {
  const feeType = String(t.feeType ?? 'percentage')
  const tipo = feeType === 'fixed' ? 'FIXA' : feeType === 'percentage_plus_fixed' ? 'PERCENTUAL_MAIS_FIXA' : 'PERCENTUAL'
  const faixa = String(t.aplicaParcela ?? 'TODAS') === 'FAIXA'
  return {
    id: t.id, nome: t.name ?? t.code ?? null, codigo: t.code ?? null,
    tipo: tipo as any, percentual: t.feePercent ?? null, valorFixo: t.fixedFee ?? null,
    // o motor base entende TOTAL|PARCELA; bases novas (SALDO/ENTRADA/LIQUIDO/BRUTO) → TOTAL (aprox.)
    baseIncidencia: String(t.baseIncidencia ?? 'TOTAL') === 'PARCELA' ? 'PARCELA' : 'TOTAL',
    quemAbsorve: 'EMPRESA', // a política da Condição decide a direção; aqui só o valor
    adquirente: t.adquirente ?? null,
    parcelasDe: faixa ? t.installmentsFrom ?? null : null,
    parcelasAte: faixa ? t.installmentsTo ?? null : null,
    antecipacaoAtiva: t.anticipationType && t.anticipationType !== 'NAO_POSSUI',
    antecipacaoPercent: t.anticipationPercent ?? null,
    ativo: t.ativo ?? true, vigenciaInicio: t.vigenciaInicio ?? null, vigenciaFim: t.vigenciaFim ?? null,
    prioridade: t.prioridade ?? 0,
    bandeiraId: t.bandeiraId ?? null,
    formasAplicaveis: t.formasAplicaveis ?? [],
    moedasAplicaveis: t.moedasAplicaveis ?? [],
    tabelaParcelamento: Array.isArray(t.parcelamento)
      ? t.parcelamento.map((l: any) => ({
          parcelasDe: Number(l.parcelasDe), parcelasAte: Number(l.parcelasAte),
          feePercent: l.feePercent == null ? null : Number(l.feePercent),
          fixedFee: l.fixedFee == null ? null : Number(l.fixedFee),
          antecipacao: !!l.antecipacao,
        }))
      : [],
  }
}

/**
 * Aplica a linha da TABELA DE PARCELAMENTO correspondente à quantidade de
 * parcelas: o percentual e o valor fixo da linha SUBSTITUEM os do registro.
 * Sem tabela, a taxa segue exatamente como era.
 */
function taxaComLinha(t: TaxaCandidata, linha: LinhaParcelamento | null): TaxaCandidata {
  if (!linha) return t
  const temPercent = linha.feePercent != null && linha.feePercent !== 0
  const temFixo = linha.fixedFee != null && linha.fixedFee !== 0
  const tipo = temPercent && temFixo ? 'PERCENTUAL_MAIS_FIXA' : temFixo ? 'FIXA' : 'PERCENTUAL'
  return {
    ...t,
    tipo: tipo as TaxaCandidata['tipo'],
    percentual: linha.feePercent ?? 0,
    valorFixo: linha.fixedFee ?? 0,
    antecipacaoAtiva: linha.antecipacao,
    antecipacaoPercent: linha.antecipacao ? t.antecipacaoPercent ?? null : null,
  }
}

/** A taxa candidata é elegível para esta cobrança? (vigência/parcela/forma/moeda) */
function candidataElegivel(t: TaxaCandidata, ctx: { nParcelas: number; moeda: string; formaId?: number | null; bandeiraId?: number | null; data: Date }): boolean {
  if (t.ativo === false) return false
  const ini = asData(t.vigenciaInicio), fim = asData(t.vigenciaFim)
  if (ini && ctx.data.getTime() < ini.getTime()) return false
  if (fim && ctx.data.getTime() > fim.getTime()) return false
  if (t.parcelasDe != null && ctx.nParcelas < t.parcelasDe) return false
  if (t.parcelasAte != null && ctx.nParcelas > t.parcelasAte) return false
  // taxa específica de bandeira só vale quando a bandeira da cobrança bate
  if (t.bandeiraId != null && t.bandeiraId !== ctx.bandeiraId) return false
  // Com tabela de parcelamento, a taxa só vale para as quantidades que a tabela
  // cobre — se nenhuma linha atende, ela simplesmente não é candidata.
  if (t.tabelaParcelamento && t.tabelaParcelamento.length && !linhaParaParcelas(t.tabelaParcelamento, ctx.nParcelas)) return false
  if (t.formasAplicaveis && t.formasAplicaveis.length && ctx.formaId != null && !t.formasAplicaveis.includes(ctx.formaId)) return false
  if (t.moedasAplicaveis && t.moedasAplicaveis.length && !t.moedasAplicaveis.map((m) => m.toUpperCase()).includes(ctx.moeda.toUpperCase())) return false
  return true
}

/** Cálculo completo, determinístico, de uma Cobrança. */
export function calcularCobranca(input: CobrancaInput): ResultadoCobranca {
  const erros: CobrancaErro[] = []
  const memoria: string[] = []
  const valorBase = cent(input.valorBase)
  const moeda = String(input.moeda || 'BRL').toUpperCase()
  const cond = input.condicao ?? null
  const forma = input.forma ?? null
  memoria.push(`Base: ${valorBase.toFixed(2)} ${moeda} · ${input.aplicaComo === 'RECEBER' ? 'Contas a Receber' : 'Contas a Pagar'}`)

  // ── quantidade de parcelas pedida (validada depois pela condição/forma) ──
  const nPedido = input.nParcelas ?? cond?.parcelasPadrao ?? 1
  const nParcelas = Math.max(1, Math.trunc(nPedido))

  // ── entrada (resolvida ANTES da taxa) ──
  // A entrada é um componente financeiro à parte (pago por PIX/Transferência) e
  // NUNCA entra na base de cálculo da taxa de cartão/boleto. Base tributável da
  // taxa = total − entrada (o "saldo" que vai para o cartão/boleto).
  const entradaInformada = Number(input.entradaValor) || 0
  if (entradaInformada > 0 && !cond?.temEntrada) {
    erros.push({ codigo: 'ENTRADA_NAO_PERMITIDA', mensagem: 'Esta condição não permite entrada.' })
  }
  if (entradaInformada > 0 && entradaInformada >= valorBase) {
    erros.push({ codigo: 'ENTRADA_MAIOR_TOTAL', mensagem: 'A entrada deve ser menor que o valor total.' })
  }
  const valorEntrada = cent(
    cond?.temEntrada && entradaInformada > 0 && entradaInformada < valorBase
      ? entradaInformada
      : calcularValorEntrada(cond ?? {}, valorBase),
  )
  const baseTaxavel = cent(valorBase - valorEntrada)
  if (valorEntrada > 0) memoria.push(`Entrada de ${valorEntrada.toFixed(2)} (à parte, sem taxa) · base da taxa: ${baseTaxavel.toFixed(2)}`)

  // ── 1. Condição × direção (Contas a Receber / a Pagar) ──
  if (cond?.aplicaA) {
    const a = String(cond.aplicaA).toUpperCase()
    if (input.aplicaComo === 'RECEBER' && a === 'CUSTO') erros.push({ codigo: 'CONDICAO_DIRECAO', mensagem: 'Condição é de Contas a Pagar; não se aplica a um recebimento.' })
    if (input.aplicaComo === 'PAGAR' && a === 'RECEITA') erros.push({ codigo: 'CONDICAO_DIRECAO', mensagem: 'Condição é de Contas a Receber; não se aplica a um pagamento.' })
  }

  // ── 2. Forma de Pagamento ──
  //
  // A Condição RESTRINGE (formas permitidas) mas nunca torna válida uma forma
  // incompatível: as regras técnicas da Forma (moeda, direção, parcelamento,
  // adquirente, entrada) continuam valendo integralmente logo abaixo.
  if (forma) {
    if (!formaPermitidaNaCondicao(cond?.formasPermitidasIds, forma.id)) {
      erros.push({ codigo: 'FORMA_NAO_PERMITIDA', mensagem: `Forma "${forma.name}" não está entre as formas permitidas por esta condição.` })
    }
    if (!forma.ativo) erros.push({ codigo: 'FORMA_INATIVA', mensagem: `Forma "${forma.name}" está inativa.` })
    if (input.aplicaComo === 'RECEBER' && forma.usoRecebimento === false) erros.push({ codigo: 'FORMA_SEM_RECEBIMENTO', mensagem: `Forma "${forma.name}" não pode ser usada em recebimento.` })
    if (input.aplicaComo === 'PAGAR' && forma.usoPagamento === false) erros.push({ codigo: 'FORMA_SEM_PAGAMENTO', mensagem: `Forma "${forma.name}" não pode ser usada em pagamento.` })
    const internacional = !!(input.cambio?.moedaOrigem && String(input.cambio.moedaOrigem).toUpperCase() !== moeda)
    const compat = validarCompatibilidadeCobranca(forma, { moeda, carteiraId: input.carteiraId, contaBancariaId: input.contaBancariaId, internacional })
    for (const m of compat.motivos) erros.push({ codigo: 'FORMA_INCOMPATIVEL', mensagem: m })
    // limites técnicos de parcelamento
    if (nParcelas > 1 && !forma.permiteParcelas) erros.push({ codigo: 'FORMA_SEM_PARCELAMENTO', mensagem: `Forma "${forma.name}" não permite parcelamento (pedido ${nParcelas}x).` })
    if (forma.permiteParcelas && forma.maxParcelas != null && nParcelas > forma.maxParcelas) erros.push({ codigo: 'FORMA_MAX_PARCELAS', mensagem: `Forma "${forma.name}" permite no máximo ${forma.maxParcelas}x (pedido ${nParcelas}x).` })
    if (forma.permiteParcelas && forma.minParcelas != null && nParcelas < forma.minParcelas) erros.push({ codigo: 'FORMA_MIN_PARCELAS', mensagem: `Forma "${forma.name}" exige no mínimo ${forma.minParcelas}x.` })
    if (cond?.temEntrada && !forma.aceitaEntrada) erros.push({ codigo: 'FORMA_SEM_ENTRADA', mensagem: `Forma "${forma.name}" não aceita entrada.` })
  }

  // ── 3. Política de Taxas efetiva ──
  const politicaCond = (String(cond?.politicaTaxas ?? 'IGNORAR').toUpperCase()) as PoliticaTaxas
  let politica: PoliticaTaxas | null = politicaCond
  if (politicaCond === 'ESCOLHER_NA_COBRANCA') {
    const esc = input.politicaTaxasEscolhida ? (String(input.politicaTaxasEscolhida).toUpperCase() as PoliticaTaxas) : null
    if (!esc || !POLITICAS_EFETIVAS.includes(esc)) {
      erros.push({ codigo: 'ESCOLHA_TAXA_OBRIGATORIA', mensagem: 'A condição exige escolher explicitamente ignorar, repassar ou absorver a taxa antes de confirmar.' })
      politica = null
    } else politica = esc
  }
  if (politica) memoria.push(`Política de taxas: ${politica}`)

  // ── 4. Resolver UMA taxa por prioridade ──
  let valorTaxa = 0
  // Percentual/valor-fixo EFETIVOS da taxa (para o gross-up no repasse).
  let pFrac = 0, fixoTaxa = 0
  let taxaAplicada: ResultadoCobranca['taxaAplicada'] = null
  if (politica && politica !== 'IGNORAR') {
    const candidatas = (input.taxaCandidatas ?? []).filter((t) => candidataElegivel(t, { nParcelas, moeda, formaId: forma?.id, bandeiraId: input.bandeiraId ?? null, data: input.dataBase }))
    if (candidatas.length > 0) {
      const maxPri = Math.max(...candidatas.map((t) => t.prioridade ?? 0))
      const topo = candidatas.filter((t) => (t.prioridade ?? 0) === maxPri)
      if (topo.length > 1) {
        erros.push({ codigo: 'TAXA_AMBIGUA', mensagem: `Há ${topo.length} taxas compatíveis com a mesma prioridade (${maxPri}): ${topo.map((t) => t.nome ?? t.id).join(', ')}. Defina prioridade para desempatar.` })
      } else {
        const escolhida = topo[0]
        if (forma?.exigeAdquirente && !escolhida.adquirente) {
          erros.push({ codigo: 'ADQUIRENTE_OBRIGATORIO', mensagem: `Forma "${forma.name}" exige adquirente, mas a taxa "${escolhida.nome ?? escolhida.id}" não define um.` })
        }
        // Tabela de parcelamento: a linha da quantidade escolhida define o
        // percentual/valor fixo aplicados. Sem tabela, nada muda.
        const linha = linhaParaParcelas(escolhida.tabelaParcelamento, nParcelas)
        if (linha) memoria.push(`Tabela de parcelamento: ${rotuloLinha(linha)} → ${linha.feePercent ?? 0}%${linha.fixedFee ? ` + ${linha.fixedFee}` : ''}${linha.antecipacao ? ' (com antecipação)' : ''}`)
        const efetiva = taxaComLinha(escolhida, linha)
        // Taxa incide sobre o SALDO (total − entrada), nunca sobre a entrada.
        const r = calcularTaxas([efetiva], { valorBruto: baseTaxavel, nParcelas, moeda })
        valorTaxa = cent(r.valorTaxas + r.valorTaxasRepassadas)
        pFrac = Math.max(0, Number(efetiva.percentual ?? 0)) / 100
        fixoTaxa = Math.max(0, Number(efetiva.valorFixo ?? 0))
        const linhaCalc = r.linhas[0]
        taxaAplicada = { id: escolhida.id ?? null, nome: String(escolhida.nome ?? escolhida.id ?? 'taxa') + (linha ? ` · ${rotuloLinha(linha)}` : ''), tipo: String(efetiva.tipo ?? 'PERCENTUAL'), adquirente: escolhida.adquirente ?? null, prioridade: escolhida.prioridade ?? 0, formula: linhaCalc?.formula ?? '' }
        memoria.push(`Taxa "${taxaAplicada.nome}": ${taxaAplicada.formula} = ${valorTaxa.toFixed(2)} (prioridade ${taxaAplicada.prioridade})`)
      }
    } else {
      memoria.push('Nenhuma taxa compatível — nada a aplicar.')
    }
  }

  // ── 5. Matriz de política → totais ──
  // REPASSAR usa GROSS-UP real sobre o SALDO (nunca sobre a entrada): o cliente
  // paga o valor que, após o desconto da adquirente (p% + fixo), deixa o líquido
  // do saldo intacto → totalSaldo = (saldo + fixo) / (1 − p). A entrada é somada
  // por fora, sem taxa. ABSORVER cobra o valor base e reduz o líquido pela taxa.
  let valorRepassado = 0, valorAbsorvido = 0, totalCobrado = valorBase, valorLiquido = valorBase
  if (politica === 'REPASSAR') {
    if (pFrac >= 1) {
      erros.push({ codigo: 'TAXA_INVIAVEL', mensagem: 'Taxa de 100% ou mais impossibilita o repasse (gross-up).' })
    } else {
      const totalSaldo = cent((baseTaxavel + fixoTaxa) / (1 - pFrac))
      valorTaxa = cent(totalSaldo - baseTaxavel)
      valorRepassado = valorTaxa
      totalCobrado = cent(valorEntrada + totalSaldo)
      valorLiquido = valorBase // a empresa recebe o base cheio (entrada + saldo)
      memoria.push(`Gross-up (repasse): saldo ${baseTaxavel.toFixed(2)} / (1 − ${(pFrac * 100).toFixed(4)}%)${fixoTaxa ? ` + fixo ${fixoTaxa.toFixed(2)}` : ''} → cobra saldo ${totalSaldo.toFixed(2)} · taxa ${valorTaxa.toFixed(2)}`)
    }
  } else if (politica === 'ABSORVER') {
    valorAbsorvido = valorTaxa; totalCobrado = valorBase; valorLiquido = cent(valorBase - valorTaxa)
  } else {
    valorTaxa = politica === 'IGNORAR' ? 0 : valorTaxa; totalCobrado = valorBase; valorLiquido = valorBase // IGNORAR ou bloqueado
  }
  if (politica === 'IGNORAR') { valorTaxa = 0; taxaAplicada = null }
  memoria.push(`Total cobrado: ${totalCobrado.toFixed(2)} · líquido previsto: ${valorLiquido.toFixed(2)}`)

  // ── 6. Câmbio (conversão ORIGEM→DESTINO; valorDestino = valorOrigem × cotação) ──
  const moedaOrigem = String(input.cambio?.moedaOrigem ?? moeda).toUpperCase()
  const moedaDestino = String(input.cambio?.moedaDestino ?? moedaOrigem).toUpperCase()
  const cotacao = input.cambio?.cotacao != null ? Number(input.cambio.cotacao) : 1
  const cambio = {
    moedaOrigem, moedaDestino, cotacao, data: asData(input.cambio?.data ?? null), fonte: input.cambio?.fonte ?? null,
    estimado: !input.cambio?.congelado, tipo: input.cambio?.tipo ?? null, estado: input.cambio?.estado ?? null, direcao: input.cambio?.direcao ?? null,
  }
  if (moedaDestino !== moedaOrigem) memoria.push(`Câmbio ${moedaOrigem}→${moedaDestino}: ${cotacao} (${cambio.tipo ?? (cambio.estimado ? 'estimado' : 'congelado')})`)

  // ── 7. Cronograma (só quando não há erro bloqueante) ──
  let parcelas: ParcelaCalculada[] = []
  let nEfetivo = nParcelas
  if (erros.length === 0) {
    // A entrada resolvida é passada ao cronograma (componente à parte). O saldo
    // (total − entrada) é o que se parcela no cartão/boleto.
    const cron = gerarCronograma(cond, { total: totalCobrado, dataBase: input.dataBase, nParcelas, entradaValor: valorEntrada })
    nEfetivo = cron.nParcelas
    // A taxa é distribuída SOMENTE entre as parcelas de saldo — a entrada nunca
    // recebe taxa (regra de negócio: taxa de cartão/boleto só sobre o saldo).
    const parcelasSaldo = cron.parcelas.filter((p) => !p.entrada)
    const somaSaldo = parcelasSaldo.reduce((s, p) => s + p.valor, 0) || 1
    let taxaAcum = 0
    let idxSaldo = 0
    parcelas = cron.parcelas.map((p) => {
      if (p.entrada) {
        return { numero: p.numero, vencimento: p.vencimento, valor: cent(p.valor), entrada: true, valorTaxa: 0, valorLiquido: cent(p.valor) }
      }
      idxSaldo++
      const ultima = idxSaldo === parcelasSaldo.length
      const taxaShare = ultima ? cent(valorTaxa - taxaAcum) : cent((valorTaxa * p.valor) / somaSaldo)
      taxaAcum = cent(taxaAcum + taxaShare)
      return { numero: p.numero, vencimento: p.vencimento, valor: cent(p.valor), entrada: false, valorTaxa: taxaShare, valorLiquido: cent(p.valor - (politica === 'ABSORVER' ? taxaShare : 0)) }
    })
    for (const o of cron.observacoes) memoria.push(o)
    // invariante: soma das parcelas = total
    const soma = cent(parcelas.reduce((s, p) => s + p.valor, 0))
    if (soma !== totalCobrado) erros.push({ codigo: 'SOMA_INVARIANTE', mensagem: `Soma das parcelas (${soma}) ≠ total (${totalCobrado}).` })
  }

  // Snapshot IMUTÁVEL: congela a REGRA da condição usada (não só id/versão), a
  // entrada e a taxa. Alterações futuras na condição/tabela nunca tocam isto.
  const c = cond as any
  const condicaoSnapshot = cond ? {
    id: c.id ?? null, codigo: c.codigo ?? null, nome: c.nome ?? c.name ?? null, versao: c.versao ?? null,
    ativo: c.ativo ?? null, tipoPagamento: c.tipoPagamento ?? null,
    parcelasMin: c.parcelasMin ?? null, parcelasMax: c.parcelasMax ?? null, parcelasEscolhidas: nEfetivo,
    periodicidade: c.periodicidade ?? 'MENSAL', inicioCronograma: c.inicioCronograma ?? 'IMEDIATA',
    temEntrada: !!c.temEntrada, formasPermitidasIds: c.formasPermitidasIds ?? null,
    aplicaA: c.aplicaA ?? null, vigenciaInicio: c.vigenciaInicio ?? null, vigenciaFim: c.vigenciaFim ?? null,
    geradoEm: input.dataBase,
  } : null
  const snapshot = {
    versao: 1, aplicaComo: input.aplicaComo, moeda, politicaTaxas: politica,
    condicao: condicaoSnapshot,
    entrada: valorEntrada > 0 ? { valor: valorEntrada, base: 'PIX/Transferência (à parte, sem taxa)', baseTaxavel } : null,
    forma: forma ? { id: forma.id, nome: forma.name } : null,
    bandeiraId: input.bandeiraId ?? null,
    taxa: taxaAplicada, cambio, valorBase, valorTaxa, valorRepassado, valorAbsorvido, totalCobrado, valorLiquido, nParcelas: nEfetivo,
  }

  return {
    ok: erros.length === 0, erros, aplicaComo: input.aplicaComo, moeda, cambio, politicaTaxas: politica,
    taxaAplicada, valorBase, valorTaxa, valorRepassado, valorAbsorvido, totalCobrado, valorLiquido,
    nParcelas: nEfetivo, parcelas, memoria, snapshot,
  }
}
