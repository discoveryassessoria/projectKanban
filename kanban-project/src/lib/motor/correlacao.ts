// src/lib/motor/correlacao.ts
// ============================================================================
// CORRELAÇÃO DE COMANDO — tamanho fixo, independente do cadastro.
//
// `WorkflowEvento.correlationId` e `StepExecution.correlationId` são
// VarChar(60). Subtarefa e ação são CHAVES DE CADASTRO (editáveis na
// Biblioteca, sem limite de tamanho) — concatená-las cru na correlação faz o
// fechamento do passo depender do tamanho do nome cadastrado. Produção: a
// subtarefa "conferir_validar_certidao_retificada" (37 chars) empurrou a
// correlação de #3907 para 62+ chars, e o INSERT em WorkflowEvento/
// StepExecution falhou com P2000 DENTRO da transação de fechamento — passo
// nunca fechava, tarefa regredia.
//
// A correlação continua determinística (o mesmo clique reenviado produz a
// mesma string, para servir de idempotência de comando), mas a parte de
// tamanho livre é resumida a um hash curto ANTES de entrar na string — nunca
// depois, por corte cru, que perderia justamente os IDs que dão contexto.
// ============================================================================

/** Hash não-criptográfico (djb2), só para caber texto de tamanho livre num
 * campo de tamanho fixo — não é usado para nada que exija resistência a
 * colisão adversarial. */
export function hashCurto(texto: string): string {
  let h = 5381
  for (let i = 0; i < texto.length; i++) h = (h * 33 + texto.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * MONTA UMA CORRELAÇÃO DE COMANDO, sempre abaixo de `max` caracteres.
 *
 * `partesFixas` são valores já de tamanho conhecido e pequeno (ids). `partesLivres`
 * são texto de cadastro (chave de subtarefa, de ação…) — vão para o hash, nunca
 * concatenadas cruas.
 */
export function correlacaoLimitada(
  prefixo: string,
  partesFixas: Array<string | number>,
  partesLivres: Array<string | null | undefined>,
): string {
  const h = hashCurto(partesLivres.map((p) => p ?? "-").join("|"))
  return [prefixo, ...partesFixas.map(String), h].join("|")
}

/**
 * REDE DE SEGURANÇA no limite real do banco (60 chars). Fica no ponto em que
 * a correlação É ESCRITA — para que nenhum chamador, hoje ou futuro, direto ou
 * indireto, possa derrubar a transação de fechamento por causa do tamanho de
 * uma string que ele não controlou. `correlacaoLimitada` evita precisar dela;
 * ela existe para o caso em que alguém não passou por lá.
 */
export function limitarCorrelationId(s: string, max = 60): string {
  if (s.length <= max) return s
  const h = hashCurto(s)
  const prefixo = Math.max(0, max - h.length - 1)
  return `${s.slice(0, prefixo)}~${h}`
}
