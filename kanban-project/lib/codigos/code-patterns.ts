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
} as const

export type EntidadeCodigo = keyof typeof CODE_PREFIX | 'PROCESS'

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

/** Escopo da sequência (prefixo). PROCESS usa o ISO do país; demais, o prefixo fixo. */
export function escopoDe(entidade: EntidadeCodigo, pais?: string | null): string {
  return entidade === 'PROCESS' ? isoDoPais(pais) : CODE_PREFIX[entidade]
}
