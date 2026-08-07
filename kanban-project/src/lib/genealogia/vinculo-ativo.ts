// src/lib/genealogia/vinculo-ativo.ts
// ============================================================================
// O QUE É "ATIVO" — fonte ÚNICA do recorte.
//
// Quando alguém é removido da árvore mas tem fato histórico protegido (pagamento
// recebido, protocolo entregue, arquivo oficial), a linha NÃO é apagada: é
// marcada como removida (`Pessoa.removidaEm`, `ProcessoRequerente.removidoEm`).
// O fato precisa continuar existindo e apontando para alguém.
//
// A partir daí passam a existir dois recortes — o histórico (tudo) e o ativo
// (quem ainda participa). Se cada consulta escrevesse o seu, a definição de
// "ativo" viraria opinião de arquivo, e uma consulta esquecida traria de volta,
// na operação, alguém que foi removido — inclusive REMATERIALIZANDO documentos e
// tarefas para essa pessoa.
//
// Por isso o recorte vive aqui, uma vez só. Quem lê operação usa estes
// fragmentos; quem lê histórico não filtra — e diz explicitamente que não filtra.
// ============================================================================

import type { Prisma } from "@prisma/client"

/** Nó da árvore que ainda participa da operação. */
export const PESSOA_ATIVA = { removidaEm: null } satisfies Prisma.PessoaWhereInput

/** Vínculo pessoa↔processo que ainda participa da operação. */
export const VINCULO_PROCESSO_ATIVO = { removidoEm: null } satisfies Prisma.ProcessoRequerenteWhereInput

/** Pessoas ATIVAS de uma árvore. Recorte usado pela materialização e pelo roster. */
export function pessoasAtivasDaArvore(arvoreId: number): Prisma.PessoaWhereInput {
  return { arvoreId, ...PESSOA_ATIVA }
}

/**
 * Requerentes ATIVOS de um processo, para uso dentro de `include`/`select`.
 * Ex.: `include: { requerentes: requerentesAtivosDoProcesso({ include: { requerente: true } }) }`
 */
export function requerentesAtivosDoProcesso<T extends object>(extra: T): T & { where: Prisma.ProcessoRequerenteWhereInput } {
  return { ...extra, where: VINCULO_PROCESSO_ATIVO }
}
