// lib/operacional/navegacao.ts
// ============================================================================
// PARA ONDE UMA TAREFA LEVA — uma função, quatro telas.
//
// Minha Fila, Kanban global, Tarefas e Projetos e as notificações precisam
// abrir o MESMO lugar quando falam da mesma tarefa. Se cada uma montar a URL
// do seu jeito, três delas envelhecem em silêncio: a quarta muda de rota e as
// outras continuam apontando para onde não existe mais nada.
//
// ─── O QUE A URL CARREGA ────────────────────────────────────────────────────
// IDs canônicos, nunca nomes. Título de tarefa muda quando o cadastro muda,
// nome de pessoa muda quando alguém corrige a grafia, e uma navegação por nome
// quebra sem avisar. `processoId` diz onde abrir; `taskId` diz o que procurar
// lá dentro.
//
// A posição visual também não serve: navegar por "sétima linha" quebra no dia
// em que alguém ordena a lista de outro jeito — e ninguém liga uma coisa à
// outra quando o defeito aparece.
// ============================================================================

/** O que a navegação precisa saber sobre a tarefa — só isto. */
export interface AlvoDaNavegacao {
  taskId: number
  processoId: number | null
}

/**
 * A URL OPERACIONAL DE UMA TAREFA.
 *
 * Leva ao processo, na aba Central Operacional, com a tarefa a ser localizada
 * lá dentro. É deep-link de verdade: sobrevive a refresh, pode ser copiada e
 * colada, e o botão "voltar" do navegador funciona.
 *
 * Sem `processoId` não há onde abrir a Central — sobra a superfície da própria
 * operação, que ao menos mostra a tarefa em vez de mandar o usuário para uma
 * home genérica.
 */
export function urlOperacionalDaTarefa(alvo: AlvoDaNavegacao): string {
  if (alvo.processoId == null) return `/operacao?taskId=${alvo.taskId}`
  const p = new URLSearchParams({
    processoId: String(alvo.processoId),
    tab: 'central',
    taskId: String(alvo.taskId),
  })
  return `/kanban?${p.toString()}`
}

/**
 * O QUE A CENTRAL PRECISA PARA SE POSICIONAR.
 *
 * Resolvido no servidor a partir do `taskId`, com permissão conferida lá — a
 * URL é do usuário, e trocar um número nela não pode virar chave de outro
 * processo.
 */
export interface AlvoResolvido {
  taskId: number
  processoId: number
  pessoaId: number | null
  documentoId: number | null
  necessidadeId: number | null
  workflowInstanceId: number | null
  stepInstanceId: number | null
  /** Estado terminal ou "causa removida" mudam o que a tela deve oferecer. */
  statusTarefa: string
  requerDecisao: boolean
  /** O que aconteceu com a obrigação — o contexto da decisão pedida. */
  causaRemovidaMotivo: string | null
  titulo: string
}
