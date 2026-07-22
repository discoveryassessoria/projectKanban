// lib/financeiro/payment-method-rules.ts
// ============================================================================
// Regras PURAS de compatibilidade da Forma de Pagamento (sem Prisma/fetch).
// Dono ÚNICO das validações Forma × Condição e Forma × Cobrança — nunca
// reescritas em componente/endpoint. Testáveis isoladamente.
// ============================================================================

export interface FormaView {
  id: number
  name: string
  ativo: boolean
  moedasAceitas: string[]
  permiteParcelas: boolean
  minParcelas: number | null
  maxParcelas: number | null
  exigeAdquirente: boolean
  usoRecebimento: boolean
  usoPagamento: boolean
  aceitaEntrada: boolean
  aceitaRecorrencia: boolean
  aceitaMoedaEstrangeira: boolean
  permiteInternacional: boolean
  carteirasCompativeis: number[]
  contasCompativeis: number[]
}

export interface CondicaoCompat {
  moeda?: string | null
  moedasPermitidas?: string[]
  parcelas?: number | null
  parcelasMax?: number | null
  temEntrada?: boolean
  entradaObrigatoria?: boolean
}

export interface ResultadoCompat {
  compativel: boolean
  motivos: string[]
}

export interface ContextoCobranca {
  moeda?: string | null
  carteiraId?: number | null
  contaBancariaId?: number | null
  internacional?: boolean
}

/** Moedas que a Condição exige (permitidas + a moeda-base legada, se houver). */
function moedasDaCondicao(c: CondicaoCompat): string[] {
  const set = new Set<string>((c.moedasPermitidas ?? []).map((m) => String(m).toUpperCase()))
  if (c.moeda) set.add(String(c.moeda).toUpperCase())
  return [...set]
}

/** Forma × Condição — a Forma pode ser aceita por esta Condição? */
export function validarCompatibilidadeCondicao(forma: FormaView, condicao: CondicaoCompat): ResultadoCompat {
  const motivos: string[] = []

  const exigidas = moedasDaCondicao(condicao)
  const aceitas = (forma.moedasAceitas ?? []).map((m) => m.toUpperCase())
  if (exigidas.length && aceitas.length && !exigidas.some((m) => aceitas.includes(m))) {
    motivos.push(`Forma não aceita as moedas da condição (${exigidas.join(', ')})`)
  }

  const maxCond = Math.max(condicao.parcelasMax ?? 1, condicao.parcelas ?? 1)
  if (maxCond > 1) {
    if (!forma.permiteParcelas) motivos.push('Condição parcela, mas a forma não suporta parcelamento')
    else if (forma.maxParcelas != null && maxCond > forma.maxParcelas) {
      motivos.push(`Condição pede ${maxCond}x, acima do limite técnico da forma (${forma.maxParcelas}x)`)
    }
  }

  if (condicao.temEntrada && !forma.aceitaEntrada) {
    motivos.push('Condição possui entrada, mas a forma não aceita entrada')
  }

  return { compativel: motivos.length === 0, motivos }
}

/** Forma × Cobrança — a Forma pode ser usada nesta Cobrança concreta? */
export function validarCompatibilidadeCobranca(forma: FormaView, ctx: ContextoCobranca): ResultadoCompat {
  const motivos: string[] = []
  if (!forma.ativo) motivos.push('Forma inativa')

  if (ctx.moeda) {
    const aceitas = (forma.moedasAceitas ?? []).map((m) => m.toUpperCase())
    if (aceitas.length && !aceitas.includes(String(ctx.moeda).toUpperCase())) {
      motivos.push(`Forma não aceita a moeda ${ctx.moeda}`)
    }
  }
  if (ctx.internacional && !forma.permiteInternacional) {
    motivos.push('Cobrança internacional, mas a forma não permite')
  }
  if (ctx.carteiraId != null && forma.carteirasCompativeis?.length && !forma.carteirasCompativeis.includes(ctx.carteiraId)) {
    motivos.push('Carteira escolhida não é compatível com a forma')
  }
  if (ctx.contaBancariaId != null && forma.contasCompativeis?.length && !forma.contasCompativeis.includes(ctx.contaBancariaId)) {
    motivos.push('Conta escolhida não é compatível com a forma')
  }
  return { compativel: motivos.length === 0, motivos }
}

export function paraFormaView(f: {
  id: number; name: string; ativo: boolean; moeda: string | null; moedasAceitas: string[]
  permiteParcelas: boolean; minParcelas: number | null; maxParcelas: number | null
  exigeAdquirente: boolean; usoRecebimento: boolean; usoPagamento: boolean; aceitaEntrada: boolean
  aceitaRecorrencia: boolean; aceitaMoedaEstrangeira: boolean; permiteInternacional: boolean
  carteirasCompativeis: number[]; contasCompativeis: number[]
}): FormaView {
  const moedas = f.moedasAceitas?.length ? f.moedasAceitas : (f.moeda ? [f.moeda] : [])
  return {
    id: f.id, name: f.name, ativo: f.ativo, moedasAceitas: moedas,
    permiteParcelas: f.permiteParcelas, minParcelas: f.minParcelas ?? 1, maxParcelas: f.maxParcelas,
    exigeAdquirente: f.exigeAdquirente, usoRecebimento: f.usoRecebimento, usoPagamento: f.usoPagamento,
    aceitaEntrada: f.aceitaEntrada, aceitaRecorrencia: f.aceitaRecorrencia,
    aceitaMoedaEstrangeira: f.aceitaMoedaEstrangeira, permiteInternacional: f.permiteInternacional,
    carteirasCompativeis: f.carteirasCompativeis ?? [], contasCompativeis: f.contasCompativeis ?? [],
  }
}
