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

/** Modo multiplica valor × quantidade? (todos os "por X", exceto fixed). */
export function modoMultiplicaQuantidade(modo: string | null | undefined): boolean {
  return normalizarModo(modo) !== MODO.FIXO
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

/** Verdadeiro só para um modo de cálculo reconhecido. */
export function modoCalculoValido(modo: string | null | undefined): boolean {
  return typeof modo === 'string' && Object.prototype.hasOwnProperty.call(UNIDADE_POR_MODO, modo)
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

/** `fixed` não usa faixa de quantidade (min/max) — normalizada para null na persistência. */
export function modoUsaQuantidade(modo: string | null | undefined): boolean {
  return modoCalculoValido(modo) && modo !== 'fixed'
}

// ── ESTRATÉGIA COMERCIAL derivada do modo ────────────────────────────────────
// A estratégia é como o PREÇO é cobrado — decide os CAMPOS que a Tabela de Preços
// mostra. Fonte única para UI e API:
//   • 'fixo'                → um único Valor (não multiplica).
//   • 'primeiro_adicional'  → valorBase (1º) + valorAdicional (cada adicional). Só POR_REQUERENTE.
//   • 'unitario'            → um único Valor × quantidade (por pessoa/documento/geração/…).
//   • 'faixa'               → RESERVADO: preço por faixa de quantidade (min/max). Nenhum modo
//                             atual mapeia para 'faixa' — os campos min/max ficam ocultos até
//                             existir uma estratégia de faixa (schema preservado por compat).
export type EstrategiaPreco = 'fixo' | 'primeiro_adicional' | 'unitario' | 'faixa'

export function estrategiaDoModo(modo: string | null | undefined): EstrategiaPreco {
  const m = normalizarModo(modo)
  if (m === MODO.FIXO) return 'fixo'
  if (m === MODO.POR_REQUERENTE) return 'primeiro_adicional'
  return 'unitario'
}

/** Estratégia "Primeiro requerente + Requerente adicional" (usa valorBase/valorAdicional). */
export function estrategiaUsaPrimeiroAdicional(modo: string | null | undefined): boolean {
  return estrategiaDoModo(modo) === 'primeiro_adicional'
}

/** Faixa de quantidade (min/max) — só em estratégia de FAIXA (nenhuma no conjunto atual). */
export function estrategiaUsaFaixaQuantidade(modo: string | null | undefined): boolean {
  return estrategiaDoModo(modo) === 'faixa'
}
