// lib/financeiro/modo-calculo.ts
// FONTE ÚNICA do mapeamento "Modo de cálculo" → "Unidade de cobrança".
// A UNIDADE é derivada semanticamente do MODO — nunca é uma decisão independente do
// usuário. Usado pela UI (rótulo somente-leitura) e pela API (normalização/validação),
// para que interface e backend NUNCA divirjam.
//
// modoCalculo é String livre no schema (TabelaValor.modoCalculo VarChar(20)); os valores
// canônicos são os abaixo. `unidade` (TabelaValor.unidade) é só rótulo/dedup — não entra
// em cálculo. VALOR_FIXO ("fixed") não tem unidade (null) e não multiplica no motor.

/**
 * ENUM OFICIAL ÚNICO de modo de cálculo. Fonte única para UI, API, resolver e
 * motor. Qualquer ponto que decida "modo de cálculo" importa daqui.
 */
export const MODO = {
  FIXO: 'fixed',
  POR_PESSOA: 'per_person',
  POR_DOCUMENTO: 'per_document',
  POR_REQUERENTE: 'per_applicant',
  POR_GERACAO: 'per_generation',
  POR_PACOTE: 'per_package',
  POR_FORNECEDOR: 'per_vendor',
} as const
export type ModoCalculo = (typeof MODO)[keyof typeof MODO]

/** Modo canônico dos honorários base+adicional por requerente. */
export const MODO_HONORARIO_REQUERENTE = MODO.POR_REQUERENTE

/**
 * ALIASES legados → modo oficial. Registros/rotas antigas continuam válidos:
 * o sistema normaliza para o canônico ao ler. NÃO removidos (compatibilidade).
 */
export const MODO_ALIASES: Record<string, ModoCalculo> = {
  honorario_por_requerente: MODO.POR_REQUERENTE,
  per_unit: MODO.POR_REQUERENTE,
  unit: MODO.POR_REQUERENTE,
  por_unidade: MODO.POR_REQUERENTE,
  quantidade: MODO.POR_REQUERENTE,
}

/** Normaliza qualquer modo (canônico ou alias legado) para o valor OFICIAL. */
export function normalizarModo(modo: string | null | undefined): ModoCalculo {
  if (!modo) return MODO.FIXO
  if (Object.prototype.hasOwnProperty.call(UNIDADE_POR_MODO, modo)) return modo as ModoCalculo
  return MODO_ALIASES[modo] ?? MODO.FIXO
}

/** Modo multiplica valor × quantidade? (toda estratégia, exceto fixo). */
export function modoMultiplicaQuantidade(modo: string | null | undefined): boolean {
  return estrategiaDoModo(modo) !== 'fixo'
}

/** Modos válidos, na ordem de exibição. [valor canônico, rótulo do modo]. */
export const MODOS_CALCULO: [string, string][] = [
  ['fixed', 'Valor fixo'],
  ['per_person', 'Por pessoa'],
  ['per_document', 'Por documento'],
  ['per_applicant', 'Por requerente'],
  ['per_generation', 'Por geração'],
  ['per_package', 'Por pacote'],
  ['per_vendor', 'Por fornecedor'],
]

/** Modo → unidade canônica. `fixed` = sem unidade (null). */
const UNIDADE_POR_MODO: Record<string, string | null> = {
  fixed: null,
  per_person: 'pessoa',
  per_document: 'documento',
  per_applicant: 'requerente',
  per_generation: 'geração',
  per_package: 'pacote',
  per_vendor: 'fornecedor',
}

/** Verdadeiro para uma estratégia canônica OU um modo/alias legado reconhecido. */
export function modoCalculoValido(modo: string | null | undefined): boolean {
  if (typeof modo !== 'string') return false
  if (Object.values(ESTRATEGIA).includes(modo as EstrategiaCodigo)) return true // 4 estratégias canônicas
  if (Object.prototype.hasOwnProperty.call(UNIDADE_POR_MODO, modo)) return true // modos legados
  if (Object.prototype.hasOwnProperty.call(MODO_ALIASES, modo)) return true // aliases legados
  return false
}

/** Rótulo legível do MODO (ex.: 'Por documento'). */
export function rotuloModo(modo: string | null | undefined): string {
  return MODOS_CALCULO.find(([k]) => k === modo)?.[1] ?? modo ?? '—'
}

/**
 * Unidade CANÔNICA derivada do modo. `fixed` → null. Modo desconhecido → null
 * (defensivo). É a ÚNICA regra de normalização: o backend a aplica ignorando
 * qualquer `unidade` enviada pelo cliente (não confia na UI).
 */
export function unidadeDoModo(modo: string | null | undefined): string | null {
  if (!modo) return null
  return UNIDADE_POR_MODO[modo] ?? null
}

/** Rótulo "Unidade de cobrança" para a UI (somente leitura). `fixed` → 'Não se aplica'. */
export function rotuloUnidadeCobranca(modo: string | null | undefined): string {
  const u = unidadeDoModo(modo)
  if (!u) return 'Não se aplica'
  return u.charAt(0).toUpperCase() + u.slice(1)
}

// ============================================================================
// ESTRATÉGIA DE CÁLCULO × UNIDADE DE COBRANÇA (modelo genérico e configurável)
// ----------------------------------------------------------------------------
// Dois conceitos ORTOGONAIS, separados de propósito:
//   • ESTRATÉGIA = COMO o preço é calculado. Vive em TabelaValor.modoCalculo.
//   • UNIDADE    = O QUE está sendo contado (requerente, documento, página, hora,
//                  processo…). Vive em TabelaValor.unidade (enum UnidadeItem;
//                  ver lib/financeiro/unidade-cobranca.ts). É livre e cadastrável.
//
// NÃO existe uma estratégia por unidade: "Por unidade" + "Documento", "Por unidade"
// + "Página" e "Primeiro + adicionais" + "Requerente" são combinações da MESMA
// dupla de eixos. Nenhuma regra olha o NOME do serviço.
//
// As 4 estratégias canônicas são gravadas em modoCalculo (VarChar 40). Os modos
// legados unit-bundled (per_document, per_person, per_applicant, …) continuam
// reconhecidos e decompostos em (estratégia, unidade) na leitura — sem migration.
// ============================================================================
export const ESTRATEGIA = {
  FIXO: 'fixed',
  PRIMEIRO_ADICIONAL: 'first_additional',
  POR_UNIDADE: 'per_unit',
  FAIXA: 'quantity_range',
} as const
export type EstrategiaCodigo = (typeof ESTRATEGIA)[keyof typeof ESTRATEGIA]
export type EstrategiaPreco = 'fixo' | 'primeiro_adicional' | 'unitario' | 'faixa'

/** Estratégias oficiais para a UI: [código canônico (vai em modoCalculo), rótulo]. */
export const ESTRATEGIAS_CALCULO: [string, string][] = [
  [ESTRATEGIA.FIXO, 'Preço fixo'],
  [ESTRATEGIA.PRIMEIRO_ADICIONAL, 'Primeiro + adicionais'],
  [ESTRATEGIA.POR_UNIDADE, 'Por unidade'],
  [ESTRATEGIA.FAIXA, 'Por faixa de quantidade'],
]

/** Todos os códigos (canônicos + legados) que representam PRIMEIRO + ADICIONAIS. */
export const MODOS_PRIMEIRO_ADICIONAL = [
  ESTRATEGIA.PRIMEIRO_ADICIONAL, 'per_applicant', 'honorario_por_requerente',
]

/** Estratégia a partir de qualquer modo (código canônico OU legado unit-bundled). */
export function estrategiaDoModo(modo: string | null | undefined): EstrategiaPreco {
  const m = (modo ?? '').trim()
  // 1) códigos canônicos do novo modelo têm precedência (resolvem colisão de alias)
  if (m === ESTRATEGIA.PRIMEIRO_ADICIONAL) return 'primeiro_adicional'
  if (m === ESTRATEGIA.POR_UNIDADE) return 'unitario'
  if (m === ESTRATEGIA.FAIXA) return 'faixa'
  if (m === ESTRATEGIA.FIXO) return 'fixo'
  // 2) modos legados (unit-bundled) → estratégia
  const canon = normalizarModo(m)
  if (canon === MODO.FIXO) return 'fixo'
  if (canon === MODO.POR_REQUERENTE) return 'primeiro_adicional'
  return 'unitario'
}

/** Código canônico de modoCalculo a GRAVAR para uma estratégia escolhida na UI. */
export function modoDaEstrategia(est: EstrategiaPreco): string {
  switch (est) {
    case 'primeiro_adicional': return ESTRATEGIA.PRIMEIRO_ADICIONAL
    case 'unitario': return ESTRATEGIA.POR_UNIDADE
    case 'faixa': return ESTRATEGIA.FAIXA
    default: return ESTRATEGIA.FIXO
  }
}

/** Rótulo legível da estratégia (ex.: 'Por unidade'). */
export function rotuloEstrategia(modo: string | null | undefined): string {
  const est = estrategiaDoModo(modo)
  return ESTRATEGIAS_CALCULO.find(([k]) => estrategiaDoModo(k) === est)?.[1] ?? '—'
}

/** Estratégia "Primeiro + adicionais" (usa valorBase/valorAdicional). */
export function estrategiaUsaPrimeiroAdicional(modo: string | null | undefined): boolean {
  return estrategiaDoModo(modo) === 'primeiro_adicional'
}

/** Estratégia "Por faixa de quantidade" (usa quantidadeMinima/Maxima). */
export function estrategiaUsaFaixaQuantidade(modo: string | null | undefined): boolean {
  return estrategiaDoModo(modo) === 'faixa'
}

/** Estratégia multiplica por quantidade em runtime? (tudo menos fixo.) */
export function estrategiaMultiplica(modo: string | null | undefined): boolean {
  return estrategiaDoModo(modo) !== 'fixo'
}

/** `fixed` não usa faixa de quantidade (min/max) — normalizada para null na persistência. */
export function modoUsaQuantidade(modo: string | null | undefined): boolean {
  return estrategiaDoModo(modo) !== 'fixo'
}
