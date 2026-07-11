// src/services/identity.ts
// CP-1 — canonicalização de identidade humana (Regra 13).
// Pessoa é a identidade única; Contratante/Requerente/Ascendente são papéis
// que apontam para Pessoa via personId.
//
// Este módulo expõe funções PURAS de deduplicação (testáveis sem banco) e um
// helper de leitura. O backfill usa a chave de dedup para linkar papéis
// existentes a uma Pessoa canônica sem dual-write.

export interface DadosIdentidade {
  cpf?: string | null
  nome?: string | null
  dataNascimento?: Date | string | null
}

/** Normaliza texto: minúsculas, sem acentos, colapsa espaços. */
export function normalizarTexto(v: string | null | undefined): string {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** Só dígitos (para CPF). */
export function apenasDigitos(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "")
}

/** Data em ISO yyyy-mm-dd (ou "" se ausente/ inválida). */
export function dataISO(v: Date | string | null | undefined): string {
  if (!v) return ""
  const d = typeof v === "string" ? new Date(v) : v
  if (isNaN(d.getTime())) return ""
  return d.toISOString().slice(0, 10)
}

/**
 * Chave de deduplicação de identidade.
 *  - Se houver CPF (>= 11 dígitos), a chave é `cpf:<digitos>` (forte).
 *  - Senão, `nome:<nome-normalizado>|nasc:<iso>` (fraca, conservadora).
 *  - Se não há CPF nem nome, retorna "" (não deduplica — trata como único).
 * Chaves iguais ⇒ mesma pessoa humana.
 */
export function chaveDedupPessoa(d: DadosIdentidade): string {
  const cpf = apenasDigitos(d.cpf)
  if (cpf.length >= 11) return `cpf:${cpf}`
  const nome = normalizarTexto(d.nome)
  if (!nome) return ""
  return `nome:${nome}|nasc:${dataISO(d.dataNascimento)}`
}
