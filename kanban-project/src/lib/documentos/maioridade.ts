// src/lib/documentos/maioridade.ts
//
// POLÍTICA CANÔNICA DE MAIORIDADE — um lugar só.
//
// "Requerente adulto" aparece em regra documental, em bloqueio de fase e em
// relatório. Se cada um calculasse a própria idade, bastaria um deles usar
// `> 18` em vez de `>= 18`, ou contar por ano em vez de por data, para o sistema
// discordar de si mesmo sobre a mesma pessoa no mesmo dia.
//
// A data de referência é EXPLÍCITA e obrigatória: idade sem data de referência é
// uma pergunta mal feita — muda de resposta a cada meia-noite, e um teste que
// dependa de "hoje" quebra sozinho no aniversário de alguém.

/** Idade civil da maioridade no Brasil. Muda aqui, muda em todo lugar. */
export const IDADE_MAIORIDADE = 18

/**
 * Idade em anos COMPLETOS na data de referência.
 * Null quando não há data de nascimento — ausência de dado não é idade zero.
 */
export function idadeEmAnos(nascimento: Date | string | null | undefined, referencia: Date): number | null {
  if (!nascimento) return null
  const n = nascimento instanceof Date ? nascimento : new Date(nascimento)
  if (Number.isNaN(n.getTime())) return null
  let anos = referencia.getUTCFullYear() - n.getUTCFullYear()
  const mes = referencia.getUTCMonth() - n.getUTCMonth()
  // ainda não fez aniversário no ano de referência
  if (mes < 0 || (mes === 0 && referencia.getUTCDate() < n.getUTCDate())) anos--
  return anos < 0 ? null : anos
}

/**
 * Atingiu a maioridade na data de referência?
 *
 * Sem data de nascimento devolve `null` — e null NÃO é "menor". Quem consome
 * decide o que fazer com o desconhecido; tratar ausência como menoridade faria o
 * sistema deixar de exigir documentos de um adulto por falta de cadastro.
 */
export function ehMaiorDeIdade(nascimento: Date | string | null | undefined, referencia: Date): boolean | null {
  const anos = idadeEmAnos(nascimento, referencia)
  return anos == null ? null : anos >= IDADE_MAIORIDADE
}

// ── DOMÍNIO CANÔNICO DE `Pessoa.requerente` ─────────────────────────────────
// O campo é string com quatro valores: "sim" | "maior" | "menor" | "nao".
// `linhagem.ts` e `operational-projection.ts` já tratam "maior" e "menor" como
// requerente — só o contexto documental exigia "sim", e por isso um requerente
// marcado "maior" não era reconhecido por regra documental nenhuma.
//
// O marcador também carrega MAIORIDADE, e essa é a informação que de fato existe
// no cadastro: `data_nasc` é nulo na maior parte da base. Por isso a maioridade
// é resolvida pela data quando ela existe e pelo marcador quando não existe —
// nesta ordem, porque a data é o fato e o marcador é a declaração.

export type MarcadorRequerente = "sim" | "maior" | "menor" | "nao"

export function ehRequerente(marcador: string | null | undefined): boolean {
  const m = String(marcador ?? "nao").trim().toLowerCase()
  return m === "sim" || m === "maior" || m === "menor"
}

/**
 * Maioridade a partir do marcador. "sim" não informa idade — devolve null, e
 * null é desconhecido, nunca "menor".
 */
export function maioridadePeloMarcador(marcador: string | null | undefined): boolean | null {
  const m = String(marcador ?? "").trim().toLowerCase()
  if (m === "maior") return true
  if (m === "menor") return false
  return null
}

/** Maioridade efetiva: a DATA manda; sem data, vale o marcador do cadastro. */
export function maioridadeEfetiva(
  nascimento: Date | string | null | undefined,
  marcador: string | null | undefined,
  referencia: Date,
): boolean | null {
  return ehMaiorDeIdade(nascimento, referencia) ?? maioridadePeloMarcador(marcador)
}
