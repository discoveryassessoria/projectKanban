// src/lib/process-stage/fase-pre-contrato.ts
// ============================================================================
// FASE "AGUARDANDO FECHAMENTO" (phaseKey `a_iniciar`) — a primeira do Workflow Macro, PRÉ-TRABALHO.
//
// O QUE É: o processo nasce aqui e fica PARADO até um humano MOVÊ-LO para Genealogia. Nela não há certidão, tarefa nem passo:
// é a antessala do trabalho (o contrato ainda não fechou). Por isso:
//   • não é fase do enum `FaseCode` (nenhuma coluna do schema usa esse enum; NÃO há migration) — é uma EXTENSÃO do catálogo em código,
//     reconhecida por `ehFaseAguardandoFechamento`. `phaseKeyToFaseCode('a_iniciar')` continua `null` (não é fase do enum);
//   • a materialização trata a fase como SEM tarefas por desenho (exceção explícita em `instanciarWorkflowDaFase` /
//     `materializarExecucaoDaFase`: 0 passos, com sucesso, nenhum Tarefa/Documento/StepInstance);
//   • avanço AUTOMÁTICO nunca a deixa (cron, reconciliador, auto-avanço): ver `ORIGENS_DE_AVANCO_HUMANO` e `advance()`;
//   • o processo nela fica FORA da Torre (totais, listas, Radar, Processos, Equipe, Terceiros, "Precisa de você", foto diária): ver
//     `src/services/processo-pre-contrato.ts`.
//
// Módulo PURO e sem imports (cliente e servidor): nenhuma regra depende de label; o rótulo oficial mora AQUI (e só aqui).
// ============================================================================

/** A chave estável gravada em `Processo.faseAtualKey` / `FaseMacro.phaseKey` / `CatalogoFase.phaseKey`. */
export const PHASEKEY_A_INICIAR = 'a_iniciar'

/** Rótulo oficial. NÃO é "A iniciar": colide com o status de tarefa `NAO_INICIADA` ("A iniciar"). */
export const ROTULO_AGUARDANDO_FECHAMENTO = 'Aguardando fechamento'

/** Ordem no catálogo EM CÓDIGO: Genealogia é a 0 (`FASES`), esta é anterior. */
export const ORDEM_AGUARDANDO_FECHAMENTO = -1

/** `CatalogoFase.ordemPadrao` sugerido (o seed usa 1..10; Genealogia = 1): anterior a Genealogia, sem renumerar ninguém. */
export const ORDEM_PADRAO_AGUARDANDO_FECHAMENTO = 0

/** A fase para onde o humano move o processo ao fechar o contrato. */
export const PHASEKEY_DESTINO_DO_FECHAMENTO = 'genealogia'

/** A chave é a da fase "Aguardando fechamento"? (comparação EXATA, como o motor: sem alias, sem caixa.) */
export function ehFaseAguardandoFechamento(phaseKey: string | null | undefined): boolean {
  return phaseKey === PHASEKEY_A_INICIAR
}

/** O rótulo da extensão, ou `null` se a chave não é dela. */
export function rotuloDaFasePreContrato(phaseKey: string | null | undefined): string | null {
  return ehFaseAguardandoFechamento(phaseKey) ? ROTULO_AGUARDANDO_FECHAMENTO : null
}

/**
 * As ORIGENS de `advance()` que são um CLIQUE HUMANO explícito (botão "Avançar fase", arrastar o card, "Avançar" do Precisa de você).
 * Só estas podem tirar o processo de `a_iniciar` por `advance()`; QUALQUER outra origem (cron-reconciliacao, reconciliacao,
 * auto-avanço, recalcular, ausente) é automática e recebe `AVANCO_MANUAL_OBRIGATORIO`. Lista FECHADA de propósito: um chamador
 * automático novo nasce bloqueado, nunca liberado.
 */
export const ORIGENS_DE_AVANCO_HUMANO: ReadonlySet<string> = new Set(['advance-route', 'avancar-fase', 'kanban-drag', 'torre:precisa'])

export const avancoHumano = (origem: string | null | undefined): boolean => origem != null && ORIGENS_DE_AVANCO_HUMANO.has(origem)

/**
 * O rótulo OFICIAL de uma fase quando quem chama já tem o rótulo do CADASTRO (`CatalogoFase.label`/`FaseMacro.label`): para
 * "Aguardando fechamento" vale SEMPRE o oficial daqui (a linha do banco pode ter nascido pela UI como "A iniciar" — que colide com o
 * status de tarefa `NAO_INICIADA`); para as demais fases, o do cadastro. Nunca devolve a chave crua.
 */
export function rotuloOficialDaFase(phaseKey: string, rotuloDoCadastro: string | null | undefined): string {
  return rotuloDaFasePreContrato(phaseKey) ?? (rotuloDoCadastro && rotuloDoCadastro.trim() ? rotuloDoCadastro : phaseKey)
}
