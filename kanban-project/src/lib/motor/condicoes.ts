// src/lib/motor/condicoes.ts
// ============================================================================
// CONDIÇÕES DECLARATIVAS — o mínimo que resolve, e nada além.
//
// ─── POR QUE NÃO É UMA LINGUAGEM ────────────────────────────────────────────
// O administrador precisa dizer "o campo destinatário só aparece quando o canal for
// e-mail". Isso é uma condição, não um programa. A tentação é resolver com `eval` ou
// com um expressador genérico — e aí o cadastro passa a aceitar código, o servidor
// passa a executar o que o usuário escreveu, e a pergunta "o que este passo faz?"
// deixa de ter resposta estática.
//
// Aqui o vocabulário é FECHADO: um punhado de operadores sobre referências
// autorizadas. O que não estiver descrito abaixo não é expressável — e é de propósito.
//
// ─── O QUE UMA CONDIÇÃO ALCANÇA ─────────────────────────────────────────────
// Só o que a própria etapa tem: os valores preenchidos nela e o canal escolhido.
// Nada de consultar processo, pessoa ou banco: uma condição que faz I/O deixa de ser
// avaliável em lote e vira um risco de latência dentro de uma tela.
//
// ─── AUSÊNCIA DE CONDIÇÃO É VERDADEIRO ──────────────────────────────────────
// `null` significa "sempre". É o caso mais comum, e escrevê-lo como `{ op: "sempre" }`
// só criaria ruído no cadastro.
// ============================================================================

/** Operadores aceitos. Fora desta lista, a condição é INVÁLIDA — nunca "verdadeira". */
export const OPERADORES = [
  "igual", "diferente", "em", "naoEm", "preenchido", "vazio", "e", "ou", "nao",
] as const
export type Operador = (typeof OPERADORES)[number]

export interface Condicao {
  /** Referência ao valor: a `key` de um campo da própria etapa. */
  campo?: string
  op: Operador
  valor?: unknown
  /** Para `e` / `ou` / `nao`. */
  condicoes?: Condicao[]
}

/** O que uma condição pode enxergar. Fechado de propósito. */
export interface ContextoDeCondicao {
  /** Valores preenchidos na execução corrente, por `key` de campo. */
  valores: Record<string, unknown>
}

function vazio(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "") ||
    (Array.isArray(v) && v.length === 0)
}

/**
 * AVALIA. Total e sem exceção: qualquer forma inesperada devolve `false`.
 *
 * `false` e não `true` porque a condição decide se algo APARECE ou é EXIGIDO. Diante
 * de uma condição que não dá para entender, mostrar o campo é menos grave do que
 * exigir silenciosamente algo que ninguém consegue satisfazer — e a publicação já
 * recusa condição inválida antes de chegar aqui.
 */
export function avaliarCondicao(c: Condicao | null | undefined, ctx: ContextoDeCondicao): boolean {
  if (c == null) return true
  if (typeof c !== "object" || typeof c.op !== "string") return false

  switch (c.op) {
    case "e":
      return Array.isArray(c.condicoes) && c.condicoes.length > 0 &&
        c.condicoes.every((x) => avaliarCondicao(x, ctx))
    case "ou":
      return Array.isArray(c.condicoes) && c.condicoes.length > 0 &&
        c.condicoes.some((x) => avaliarCondicao(x, ctx))
    case "nao":
      return Array.isArray(c.condicoes) && c.condicoes.length === 1 &&
        !avaliarCondicao(c.condicoes[0], ctx)
  }

  if (typeof c.campo !== "string" || c.campo === "") return false
  const atual = ctx.valores[c.campo]

  switch (c.op) {
    case "igual": return atual === c.valor
    case "diferente": return atual !== c.valor
    case "em": return Array.isArray(c.valor) && (c.valor as unknown[]).includes(atual)
    case "naoEm": return Array.isArray(c.valor) && !(c.valor as unknown[]).includes(atual)
    case "preenchido": return !vazio(atual)
    case "vazio": return vazio(atual)
    default: return false
  }
}

export interface ProblemaDeCondicao { caminho: string; mensagem: string }

/**
 * VALIDA A FORMA — para a publicação recusar antes de virar runtime.
 *
 * `chavesConhecidas` é o conjunto de campos que a etapa declara. Uma condição que
 * aponta para um campo inexistente nunca seria verdadeira, e o operador ficaria
 * olhando um campo que não aparece sem nenhuma explicação.
 */
export function validarCondicao(
  c: unknown,
  chavesConhecidas: Set<string>,
  caminho = "condicao",
): ProblemaDeCondicao[] {
  if (c == null) return []
  if (typeof c !== "object" || Array.isArray(c)) {
    return [{ caminho, mensagem: "a condição precisa ser um objeto" }]
  }
  const cond = c as Partial<Condicao>
  if (typeof cond.op !== "string" || !(OPERADORES as readonly string[]).includes(cond.op)) {
    return [{ caminho, mensagem: `operador "${String(cond.op)}" não existe. Use: ${OPERADORES.join(", ")}` }]
  }

  if (cond.op === "e" || cond.op === "ou" || cond.op === "nao") {
    const filhos = cond.condicoes
    if (!Array.isArray(filhos) || filhos.length === 0) {
      return [{ caminho, mensagem: `"${cond.op}" precisa de pelo menos uma condição` }]
    }
    if (cond.op === "nao" && filhos.length !== 1) {
      return [{ caminho, mensagem: '"nao" aceita exatamente uma condição' }]
    }
    return filhos.flatMap((f, i) => validarCondicao(f, chavesConhecidas, `${caminho}.condicoes[${i}]`))
  }

  if (typeof cond.campo !== "string" || cond.campo === "") {
    return [{ caminho, mensagem: `"${cond.op}" precisa dizer sobre qual campo` }]
  }
  if (!chavesConhecidas.has(cond.campo)) {
    return [{ caminho, mensagem: `a condição aponta para o campo "${cond.campo}", que não existe neste passo` }]
  }
  if ((cond.op === "em" || cond.op === "naoEm") && !Array.isArray(cond.valor)) {
    return [{ caminho, mensagem: `"${cond.op}" espera uma lista de valores` }]
  }
  return []
}

/** Descreve a condição em português, para a tela explicar em vez de esconder. */
export function descreverCondicao(c: Condicao | null | undefined, rotulos: Record<string, string> = {}): string {
  if (c == null) return "sempre"
  const nome = (k?: string) => (k ? rotulos[k] ?? k : "?")
  switch (c.op) {
    case "e": return (c.condicoes ?? []).map((x) => descreverCondicao(x, rotulos)).join(" e ")
    case "ou": return (c.condicoes ?? []).map((x) => descreverCondicao(x, rotulos)).join(" ou ")
    case "nao": return `não (${descreverCondicao(c.condicoes?.[0], rotulos)})`
    case "igual": return `${nome(c.campo)} é "${String(c.valor)}"`
    case "diferente": return `${nome(c.campo)} não é "${String(c.valor)}"`
    case "em": return `${nome(c.campo)} está entre ${(c.valor as unknown[] ?? []).map(String).join(", ")}`
    case "naoEm": return `${nome(c.campo)} não está entre ${(c.valor as unknown[] ?? []).map(String).join(", ")}`
    case "preenchido": return `${nome(c.campo)} está preenchido`
    case "vazio": return `${nome(c.campo)} está vazio`
    default: return "condição inválida"
  }
}
