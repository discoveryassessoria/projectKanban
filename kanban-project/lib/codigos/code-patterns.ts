// lib/codigos/code-patterns.ts
// CONFIGURAÇÃO ÚNICA dos padrões de código público. Adicionar uma entidade nova = 1 linha
// aqui (nenhuma lógica duplicada). O código público é só identificação humana — o
// identificador técnico oficial continua sendo o id/UUID do banco.

// Entidades com PREFIXO FIXO + sequência GLOBAL por entidade (independente entre si).
// Adicionar uma entidade nova = 1 linha aqui (nenhuma lógica duplicada em módulo).
export const CODE_PREFIX = {
  CLIENT: 'CLI',
  SERVICE: 'SRV',
  DOCUMENT: 'DOC',
  DOCUMENT_TYPE: 'TDOC', // escopo da SEQUÊNCIA do Tipo de Documento — o código escrito é DOC1, DOC2… (ver CODE_FORMATO)

  PERSON: 'PES',
  SUPPLIER: 'FOR',
  TASK: 'TAR',
  EVENT: 'EVT',
  PROTOCOL: 'PRO',
  CONTRACT: 'CTR',
  COST: 'CUS',
  REVENUE: 'REC',
  FINANCIAL_ENTRY: 'LAN',
  // Rollout definitivo — demais entidades operacionais do Discovery:
  OPERATION: 'OPE',
  ANTICIPATED_OPERATION: 'OPA',
  FINANCIAL_CONFIG: 'CFG',
  PRICE: 'PRE',
  FINANCIAL_RULE: 'RGF',
  TRANSLATION: 'TRA',
  RECTIFICATION: 'RET',
  APOSTILLE: 'APO',
  ORGANIZATION: 'ORG',
  USER: 'USR',
  PAYMENT_METHOD: 'FPG', // Forma de Pagamento (cadastro do meio)
  PAYMENT_TERM: 'CPG', // Condição de Pagamento (regra reutilizável)
  PAYMENT_FEE: 'TXP', // Taxa de Pagamento (tabela comercial)
  ACQUIRER: 'ADQ', // Adquirente / Gateway
  CARD_BRAND: 'BND', // Bandeira de cartão
} as const

export type EntidadeCodigo = keyof typeof CODE_PREFIX | 'PROCESS'

// ── FORMATO ESCRITO × ESCOPO DA SEQUÊNCIA ───────────────────────────────────
// São coisas diferentes e quase sempre coincidem:
//   • ESCOPO  = chave da linha em `CodeSequence` (quem conta).
//   • FORMATO = como o código é ESCRITO para o operador (prefixo + separador).
// Declarar aqui só a exceção; o resto segue `PREFIXO-numero`.
//
// TIPO DE DOCUMENTO: o código lido pelo operador é DOC1, DOC2, DOC3… (sem
// separador). O escopo continua sendo TDOC para NÃO compartilhar contador com o
// DOC-n do documento concreto — são entidades distintas, cada uma com a sua
// sequência. Como a unicidade de `publicCode` é por TABELA, não há colisão.
const CODE_FORMATO: Partial<Record<EntidadeCodigo, { prefixo: string; separador: string }>> = {
  DOCUMENT_TYPE: { prefixo: 'DOC', separador: '' },
  // Órgãos e Organizações: ORG1, ORG2, ORG3…
  ORGANIZATION: { prefixo: 'ORG', separador: '' },
}

// PROCESSO: prefixo = ISO do país; sequência INDEPENDENTE por nacionalidade (IT-1, ES-1...).
const PAIS_ISO: Record<string, string> = {
  italia: 'IT', 'itália': 'IT', italy: 'IT', it: 'IT',
  espanha: 'ES', spain: 'ES', es: 'ES', 'españa': 'ES',
  portugal: 'PT', pt: 'PT',
  franca: 'FR', 'frança': 'FR', france: 'FR', fr: 'FR',
  alemanha: 'DE', germany: 'DE', de: 'DE', 'alemão': 'DE', 'alemã': 'DE',
  polonia: 'PL', 'polônia': 'PL', poland: 'PL', pl: 'PL',
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** ISO do país (IT/ES/PT/FR/DE/PL) a partir do nome/valor de nacionalidade. */
export function isoDoPais(pais: string | null | undefined): string {
  if (!pais) return 'XX'
  const k = semAcento(String(pais).trim().toLowerCase())
  return PAIS_ISO[k] ?? PAIS_ISO[k.slice(0, 2)] ?? (k.length >= 2 ? k.slice(0, 2).toUpperCase() : 'XX')
}

/** Escopo da sequência (chave em CodeSequence). PROCESS usa o ISO do país; demais, o prefixo fixo. */
export function escopoDe(entidade: EntidadeCodigo, pais?: string | null): string {
  return entidade === 'PROCESS' ? isoDoPais(pais) : CODE_PREFIX[entidade]
}

/** Como o código é escrito: prefixo visível + separador. Default: `ESCOPO-`. */
export function formatoDe(entidade: EntidadeCodigo, pais?: string | null): { prefixo: string; separador: string } {
  return CODE_FORMATO[entidade] ?? { prefixo: escopoDe(entidade, pais), separador: '-' }
}

/** Monta o código público a partir do número da sequência (ex.: "CLI-48", "DOC7"). */
export function formatarCodigo(entidade: EntidadeCodigo, numero: number, pais?: string | null): string {
  const { prefixo, separador } = formatoDe(entidade, pais)
  return `${prefixo}${separador}${numero}`
}

/** Padrão SQL LIKE que casa com os códigos da entidade (usado na reconciliação). */
export function padraoLikeDe(entidade: EntidadeCodigo, pais?: string | null): string {
  const { prefixo, separador } = formatoDe(entidade, pais)
  return `${prefixo}${separador}%`
}
