// lib/financeiro/unidade-cobranca.ts
// ============================================================================
// FONTE ÚNICA das UNIDADES DE COBRANÇA (o que está sendo contado).
//
// Espelha o enum oficial `UnidadeItem` do schema Prisma. É deliberadamente
// desacoplada do @prisma/client para ser importável no client (tela) sem puxar
// o runtime do Prisma. Um teste de guarda (scripts/unidade-cobranca-guard.test)
// garante que esta lista === Object.values(UnidadeItem), sem divergência.
//
// A UNIDADE é ORTOGONAL à estratégia de cálculo (ver modo-calculo.ts): a mesma
// unidade (ex.: Documento) vale para "Por unidade" e "Por faixa de quantidade".
// Nenhuma regra deriva unidade do NOME do serviço.
// ============================================================================

/** Unidades oficiais (na ordem de exibição). Iguais ao enum UnidadeItem. */
export const UNIDADES_COBRANCA = [
  'REQUERENTE', 'DOCUMENTO', 'PAGINA', 'PROCESSO', 'HORA', 'PESSOA',
  'PACOTE', 'FASE', 'DIA', 'MES', 'PERCENTUAL', 'UNIDADE', 'CUSTOM',
] as const
export type UnidadeCobranca = (typeof UNIDADES_COBRANCA)[number]

const ROTULOS: Record<UnidadeCobranca, string> = {
  REQUERENTE: 'Requerente', DOCUMENTO: 'Documento', PAGINA: 'Página', PROCESSO: 'Processo',
  HORA: 'Hora', PESSOA: 'Pessoa', PACOTE: 'Pacote', FASE: 'Fase', DIA: 'Dia', MES: 'Mês',
  PERCENTUAL: 'Percentual', UNIDADE: 'Unidade', CUSTOM: 'Personalizada',
}

/** [código, rótulo] para preencher o select da tela. */
export const UNIDADES_COBRANCA_OPCOES: [string, string][] = UNIDADES_COBRANCA.map((u) => [u, ROTULOS[u]])

/** Normaliza qualquer entrada (case-insensitive, rótulos legados lowercase) para o código oficial, ou null. */
export function normalizarUnidade(u: string | null | undefined): UnidadeCobranca | null {
  if (!u) return null
  const up = String(u).trim().toUpperCase()
  return (UNIDADES_COBRANCA as readonly string[]).includes(up) ? (up as UnidadeCobranca) : null
}

/** Verdadeiro para uma unidade oficial (aceita case/rotulo legado). */
export function unidadeValida(u: string | null | undefined): boolean {
  return normalizarUnidade(u) != null
}

/** Rótulo legível (ex.: 'Documento'). Desconhecido → a própria string ou '—'. */
export function rotuloUnidade(u: string | null | undefined): string {
  const k = normalizarUnidade(u)
  return k ? ROTULOS[k] : (u ? String(u) : '—')
}

/** Rótulo minúsculo p/ frases "por documento", "por requerente" (ex.: em "Valor por documento"). */
export function rotuloUnidadeMinuscula(u: string | null | undefined): string {
  const k = normalizarUnidade(u)
  return k ? ROTULOS[k].toLowerCase() : (u ? String(u).toLowerCase() : 'unidade')
}
