// src/lib/ui/atribuicao.ts
// ============================================================================
// SELETOR DE ATRIBUIÇÃO — REGRA PERMANENTE DO MARCO: em NENHUM seletor de atribuição de responsável vem pessoa pré-selecionada.
// Todo «Atribuir a» começa em «— escolha a pessoa —» (valor vazio), e o botão que grava só se habilita depois de a pessoa ser escolhida
// (e, no lote, de haver tarefas selecionadas). Quem cria um seletor novo usa ESTE rótulo e este valor inicial — o teste
// `scripts/seletores-sem-pessoa-preselecionada.test.ts` varre o código e quebra o build se um seletor nascer com pessoa.
// ============================================================================

/** O texto da primeira opção (valor vazio) de todo seletor de atribuição. */
export const ROTULO_ESCOLHA_DA_PESSOA = "— escolha a pessoa —"

/** O valor inicial de todo seletor de atribuição: ninguém. */
export const PESSOA_ESCOLHIDA_INICIAL = ""
