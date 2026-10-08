// lib/operacional/janela-do-passo.ts
// ============================================================================
// QUAL JANELA CADA PASSO DA EMISSÃO ABRE — num lugar só (08/10/2026). PURO.
//   passo 1  Enviar requerimento ao cartório   → a Central da etapa (envio)
//   passo 2  Receber confirmação do pedido     → a Central da etapa: a tela de CONFIRMAÇÃO DO PEDIDO (protocolo, valor, anexo do protocolo, observações)
//   passo 3  Receber certidão                  → «Registrar recebimento» (data do recebimento + anexo opcional)
//   passo 4  Conferir e validar certidão       → a Central da etapa (conferência)
// Defeito corrigido: o passo 2 passou a abrir a janela do passo 3 («Registrar recebimento»), que o concluía junto com o 3 sem protocolo, valor nem anexo.
// Todo ponto de entrada (gaveta da certidão na Operação, aba Documentos, árvore, Torre…) chega ao mesmo componente (`WorkflowTab`), que só pergunta aqui.
// ============================================================================
import { SUBTAREFA_PEDIDO_ENVIADO, SUBTAREFA_CONFIRMACAO, SUBTAREFA_CERTIDAO_RECEBIDA, type StatusPorSubtarefa } from './emissao-recebimento'

export type JanelaDoPasso = 'CENTRAL_DA_ETAPA' | 'REGISTRAR_RECEBIMENTO'

/** A janela que o botão de cada subtarefa abre. SÓ o passo 3 abre «Registrar recebimento»; o 2 abre a Central (confirmação do pedido). */
export function janelaDaSubtarefa(subtaskKey: string): JanelaDoPasso {
  return subtaskKey === SUBTAREFA_CERTIDAO_RECEBIDA ? 'REGISTRAR_RECEBIMENTO' : 'CENTRAL_DA_ETAPA'
}

/** «Registrar recebimento» só existe depois do passo 2 concluído (o passo 3 fica bloqueado até lá) e enquanto o 3 não foi concluído. */
export function podeAbrirRegistrarRecebimento(status: StatusPorSubtarefa | null | undefined): boolean {
  if (!status) return false
  return status[SUBTAREFA_PEDIDO_ENVIADO] === 'CONCLUIDO' && status[SUBTAREFA_CONFIRMACAO] === 'CONCLUIDO'
    && status[SUBTAREFA_CERTIDAO_RECEBIDA] != null && status[SUBTAREFA_CERTIDAO_RECEBIDA] !== 'CONCLUIDO'
}
