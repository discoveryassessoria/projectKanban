/**
 * REGRA DE APRESENTAÇÃO DA PESSOA — fonte única.
 *
 * Dentro de QUALQUER tela de processo (Geral, cards, Central Operacional,
 * Árvore, Financeiro, Documentos, Eventos, Histórico), a pessoa é apresentada
 * SOMENTE pelo nome completo. O código público (CLI-n, USR-n) continua
 * existindo no domínio, no banco e na API — e continua visível apenas no
 * cadastro de origem e em contextos administrativos/técnicos (listagem de
 * clientes, ficha do cliente, busca administrativa, relatórios, exportações,
 * auditoria), onde o código é renderizado em CAMPO PRÓPRIO, nunca concatenado
 * ao nome.
 *
 * Guarda: scripts/pessoa-nome-operacional.test.ts
 */

/** Qualquer pessoa apresentável: cliente/contratante, requerente ou usuário. */
export type PessoaExibivel = {
  nome?: string | null
  name?: string | null
  publicCode?: string | null
}

/** Nome operacional da pessoa — o que a tela de processo exibe. Nunca o código. */
export function nomePessoa(pessoa: PessoaExibivel | null | undefined): string {
  const nome = (pessoa?.nome ?? pessoa?.name ?? '').trim()
  return nome
}

/**
 * Nome operacional de uma lista de pessoas, já unida para exibição em linha.
 * Mesma regra: só nomes.
 */
export function nomesPessoas(
  pessoas: ReadonlyArray<PessoaExibivel> | null | undefined,
  separador = ', ',
): string {
  return (pessoas ?? []).map(nomePessoa).filter(Boolean).join(separador)
}

/**
 * Rótulo ADMINISTRATIVO da pessoa — código público + nome, para os contextos
 * onde o código é parte da identificação (cadastro, busca administrativa,
 * relatórios). Existe para que o contexto administrativo tenha um caminho
 * explícito e nomeado, em vez de recriar a concatenação à mão.
 */
export function rotuloAdministrativoPessoa(pessoa: PessoaExibivel | null | undefined): string {
  const nome = nomePessoa(pessoa)
  const codigo = (pessoa?.publicCode ?? '').trim()
  if (!codigo) return nome
  return nome ? `${codigo} — ${nome}` : codigo
}
