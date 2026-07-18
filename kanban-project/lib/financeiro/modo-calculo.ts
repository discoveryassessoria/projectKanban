// lib/financeiro/modo-calculo.ts
// FONTE ÚNICA do mapeamento "Modo de cálculo" → "Unidade de cobrança".
// A UNIDADE é derivada semanticamente do MODO — nunca é uma decisão independente do
// usuário. Usado pela UI (rótulo somente-leitura) e pela API (normalização/validação),
// para que interface e backend NUNCA divirjam.
//
// modoCalculo é String livre no schema (TabelaValor.modoCalculo VarChar(20)); os valores
// canônicos são os abaixo. `unidade` (TabelaValor.unidade) é só rótulo/dedup — não entra
// em cálculo. VALOR_FIXO ("fixed") não tem unidade (null) e não multiplica no motor.

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
