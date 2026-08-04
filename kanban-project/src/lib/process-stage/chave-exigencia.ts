// src/lib/process-stage/chave-exigencia.ts
//
// CHAVE DE IDENTIDADE de uma exigência de evidência.
//
// Existe porque UNIQUE com coluna nula não deduplica no Postgres: sem esta chave,
// duas linhas "solicitar_certidao · qualquer canal · DOC21" conviveriam e a etapa
// pediria o mesmo arquivo duas vezes.
//
// A chave é DERIVADA DOS IDS — mesmo padrão de `chaveIdempotencia` já usado no
// motor. Não é referência estrutural por texto: nada é resolvido a partir dela; o
// domínio continua sendo lido por `stepKey`, `documentoTipoId`, `canal` e
// `evidenciaTipoId`. Ela só serve de trava de unicidade.
//
// Módulo próprio (e não dentro do serviço) porque o seed e o serviço precisam da
// MESMA função: se cada um derivasse a sua, a trava deixaria de travar.

/** Identidade determinística da exigência. `*` = dimensão aberta (coluna nula). */
export function chaveDaExigencia(e: {
  stepKey: string
  documentoTipoId: number | null
  canal: string | null
  evidenciaTipoId: number
}): string {
  return [
    `step:${e.stepKey}`,
    `tipo:${e.documentoTipoId ?? "*"}`,
    `canal:${e.canal ?? "*"}`,
    `evid:${e.evidenciaTipoId}`,
  ].join("|")
}
