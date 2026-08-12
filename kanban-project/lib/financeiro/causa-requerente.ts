// lib/financeiro/causa-requerente.ts
// ============================================================================
// "QUEM ME CAUSOU?" — fonte ÚNICA da PROVENIÊNCIA de um efeito econômico que
// nasceu da presença de uma pessoa na Árvore Genealógica.
//
// ─── POR QUE ESTE MÓDULO EXISTE ─────────────────────────────────────────────
// O efeito econômico por requerente nasce em `processarRequerenteAdicionado`
// (src/lib/motor/executor.ts) e grava a causa em QUATRO lugares:
//
//   MotorArtefato.automaticKey   `{proc}::cfg:{c}::rule:{r}::req:{pessoaId}::VENDA`
//   MotorArtefato.detalhes       { pessoaId, classificacao, posicao, … }
//   Receita.chaveIdempotencia    a MESMA chave
//   Receita.contextoAplicado     { fonte: "automacao_requerente", pessoaId, … }
//
// e em UM quinto, `Receita.personId`, que é uma FK com `onDelete: SetNull`.
//
// A reconciliação lia SÓ o quinto. É o único que o próprio ato de remover
// DESTRÓI: apagar a Pessoa zera `personId` antes de qualquer reconciliação
// olhar para ele. A causa some junto com a prova de que houve causa, e o
// lançamento fica permanentemente inalcançável — órfão vivo, ATIVO, somando
// no Financeiro. (Medido em produção: Receita 180 do processo 513,
// `chaveIdempotencia = "513::cfg:59::rule:35::req:2646::VENDA"`, R$ 2.800,
// `personId = null` porque a pessoa 2646 foi apagada.)
//
// Os outros quatro são COLUNAS DE DADOS: nenhuma FK os apaga. A proveniência
// necessária JÁ EXISTE no modelo — o que faltava era lê-la. Por isso este
// módulo não pede coluna nova: ele declara, num lugar só, como a causa é lida.
//
// Módulo PURO: sem Prisma, sem I/O. Testável isolado.
// ============================================================================

/** Marca da automação por requerente em `Receita.contextoAplicado.fonte`. */
export const FONTE_AUTOMACAO_REQUERENTE = "automacao_requerente"

/**
 * `ruleSource` dos artefatos do motor cujo efeito é atribuível a UM requerente.
 * `honorario` é o lançamento AGREGADO (um para N requerentes) e NÃO entra aqui:
 * ele não tem causa única, é recalculado in-place por
 * `aplicarHonorariosPorRequerente`, e removê-lo por causa de um requerente
 * apagaria o contrato dos outros.
 */
export const RULE_SOURCE_POR_REQUERENTE = ["automation"] as const

/**
 * Extrai a pessoa causadora de uma `automaticKey`/`chaveIdempotencia`.
 * Formato reconhecido: `…::req:<pessoaId>::…`. Devolve `null` quando a chave
 * não fala de requerente — o que é resposta legítima, não erro.
 */
export function pessoaDaChaveIdempotencia(chave: string | null | undefined): number | null {
  if (!chave) return null
  const m = /::req:(\d+)::/.exec(chave)
  if (!m) return null
  const n = Number(m[1])
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Lê `pessoaId` de um JSON de contexto/detalhes, sem confiar no formato. */
export function pessoaDoJson(valor: unknown): number | null {
  if (valor == null || typeof valor !== "object" || Array.isArray(valor)) return null
  const raw = (valor as Record<string, unknown>).pessoaId
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN
  return Number.isInteger(n) && n > 0 ? n : null
}

/** É contexto da automação POR REQUERENTE (e não do honorário agregado)? */
export function contextoEhPorRequerente(contexto: unknown): boolean {
  if (contexto == null || typeof contexto !== "object" || Array.isArray(contexto)) return false
  return (contexto as Record<string, unknown>).fonte === FONTE_AUTOMACAO_REQUERENTE
}

export interface ArtefatoComProvenienciaMinima {
  automaticKey: string
  ruleSource: string
  detalhes?: unknown
}

/**
 * A pessoa que causou este artefato — a resposta a "WHO CAUSED ME?".
 *
 * Só responde para os `ruleSource` cuja causa é UM requerente. Para qualquer
 * outro devolve `null`, e `null` significa "não sei atribuir": quem consome
 * PRESERVA. Nunca se remove por ausência de proveniência — remoção exige causa
 * conhecida e comprovadamente perdida.
 *
 * A chave tem precedência sobre `detalhes` porque é `@unique` no banco: é o
 * identificador da causa, não um espelho dela.
 */
export function pessoaCausadoraDoArtefato(a: ArtefatoComProvenienciaMinima): number | null {
  if (!(RULE_SOURCE_POR_REQUERENTE as readonly string[]).includes(a.ruleSource)) return null
  return pessoaDaChaveIdempotencia(a.automaticKey) ?? pessoaDoJson(a.detalhes)
}

export interface ReceitaComProvenienciaMinima {
  chaveIdempotencia?: string | null
  contextoAplicado?: unknown
  personId?: number | null
}

/**
 * A pessoa que causou esta Receita. Lê a chave, depois o contexto, e só então
 * `personId` — nesta ordem, porque `personId` é o campo que a remoção apaga.
 */
export function pessoaCausadoraDaReceita(r: ReceitaComProvenienciaMinima): number | null {
  const daChave = pessoaDaChaveIdempotencia(r.chaveIdempotencia)
  if (daChave != null) return daChave
  if (contextoEhPorRequerente(r.contextoAplicado)) {
    const doCtx = pessoaDoJson(r.contextoAplicado)
    if (doCtx != null) return doCtx
  }
  return r.personId ?? null
}
