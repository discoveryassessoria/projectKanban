// src/lib/genealogia/pessoa-repetida.ts
// ============================================================================
// PESSOA PARECIDA EM OUTRO PROCESSO — a comparação, em módulo PURO.
//
// O aviso de "essa pessoa já existe em outro processo" compara NOME + DATA DE
// NASCIMENTO. Não é identidade (identidade é Pessoa.id / vínculo de requerente) e
// por isso não funde, não vincula e não bloqueia nada: é só um sinal para o
// operador conferir. Tolerância deliberadamente simples:
//
//   • nome: acentos, caixa, espaços e pontuação não contam; partículas
//     ("de", "da", "do", "dos", "das", "e") não contam; a ORDEM das partes não
//     conta ("Silva Maria" = "Maria Silva"); uma letra trocada/faltando/sobrando
//     é aceita em nomes de tamanho razoável (distância de edição pequena);
//   • data de nascimento: EXATAMENTE igual (dia, mês e ano). Sem data completa
//     não há comparação — nome sozinho é sinal fraco demais.
// ============================================================================

const PARTICULAS = new Set(["de", "da", "do", "dos", "das", "e", "di", "del", "della", "y"])

/** Minúsculas, sem acento, sem pontuação, espaços colapsados. */
export function normalizarNome(valor: string | null | undefined): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Partes significativas do nome, sem partículas e em ordem alfabética (a ordem não conta). */
export function partesDoNome(nome: string | null | undefined, sobrenome?: string | null): string[] {
  const todas = normalizarNome(`${nome ?? ""} ${sobrenome ?? ""}`).split(" ").filter(Boolean)
  const uteis = todas.filter((p) => !PARTICULAS.has(p))
  return (uteis.length > 0 ? uteis : todas).sort()
}

/** Distância de Levenshtein (inserção, remoção, troca). */
export function distanciaDeEdicao(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const atual = [i]
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1
      atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + custo)
    }
    anterior = atual
  }
  return anterior[b.length]
}

/** Quantas letras de diferença cabem num nome do tamanho dado. */
export function toleranciaDoNome(tamanho: number): number {
  if (tamanho < 6) return 0
  if (tamanho < 14) return 1
  return 2
}

/** Os dois nomes (nome + sobrenome) são o mesmo, dentro da tolerância simples? */
export function nomesParecidos(
  a: { nome: string | null | undefined; sobrenome?: string | null },
  b: { nome: string | null | undefined; sobrenome?: string | null },
): boolean {
  const pa = partesDoNome(a.nome, a.sobrenome)
  const pb = partesDoNome(b.nome, b.sobrenome)
  if (pa.length === 0 || pb.length === 0) return false
  const ja = pa.join(" ")
  const jb = pb.join(" ")
  if (ja === jb) return true
  // Mesmo número de partes: cada parte tem de bater individualmente (com a tolerância
  // da própria parte) — "Mario Rossi" não vira "Maria Rosso" por soma de erros.
  if (pa.length === pb.length) {
    const porParte = pa.every((p, i) => distanciaDeEdicao(p, pb[i]) <= toleranciaDoNome(Math.max(p.length, pb[i].length)))
    if (porParte) return true
  }
  return distanciaDeEdicao(ja, jb) <= toleranciaDoNome(Math.max(ja.length, jb.length)) && pa.length === pb.length
}

const DATA_COMPLETA = /^(\d{4})-(\d{2})-(\d{2})$/

/** "YYYY-MM-DD" real (existe no calendário) ou null. */
export function dataCompleta(valor: string | null | undefined): string | null {
  const m = DATA_COMPLETA.exec(String(valor ?? "").trim())
  if (!m) return null
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (ano < 1000) return null
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

/** Dia (UTC) de uma data gravada, no formato "YYYY-MM-DD". */
export function diaDaData(valor: Date | string | null | undefined): string | null {
  if (valor == null) return null
  const d = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/** Mesmo dia de nascimento, exato. Qualquer lado sem data completa → false. */
export function mesmaDataDeNascimento(a: Date | string | null | undefined, b: Date | string | null | undefined): boolean {
  const da = typeof a === "string" ? dataCompleta(a) ?? diaDaData(a) : diaDaData(a)
  const db = typeof b === "string" ? dataCompleta(b) ?? diaDaData(b) : diaDaData(b)
  return da != null && db != null && da === db
}

/** Mínimo de letras (já normalizado, sem espaços) para valer a consulta. */
export const MIN_LETRAS_CONSULTA = 3

/**
 * A consulta só vale com nome de pelo menos 3 letras e data de nascimento COMPLETA.
 * Devolve os parâmetros já limpos, ou null quando não é para consultar.
 */
export function parametrosDaConsulta(entrada: {
  nome: string | null | undefined
  sobrenome?: string | null
  dataNascimento: string | null | undefined
}): { nome: string; sobrenome: string; dataNascimento: string } | null {
  const nome = String(entrada.nome ?? "").trim()
  if (normalizarNome(nome).replace(/\s/g, "").length < MIN_LETRAS_CONSULTA) return null
  const data = dataCompleta(entrada.dataNascimento)
  if (!data) return null
  return { nome, sobrenome: String(entrada.sobrenome ?? "").trim(), dataNascimento: data }
}

/** Limite de candidatos devolvidos: o aviso é um sinal, não uma busca. */
export const MAX_CANDIDATOS = 5

export interface PessoaRepetidaCandidata {
  pessoaId: number
  nome: string
  dataNascimento: string
  processo: { id: number; codigo: string | null; nome: string }
  link: string
}

/** Deep-link existente do sistema: abre o processo já focado na pessoa. */
export function linkDaPessoaNoProcesso(processoId: number, pessoaId: number): string {
  return `/kanban?processoId=${processoId}&pessoaId=${pessoaId}`
}
