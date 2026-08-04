// src/lib/process-stage/step-editor-registry.ts
//
// REGISTRY OFICIAL DE EDITORES DE ETAPA — fonte ÚNICA da resolução
// "passo publicado → interface executável".
//
// POR QUE ELE EXISTE
// -----------------
// A resolução do editor vivia num `switch (stepKey)` dentro do componente
// `StepEditorRouter`, com `default` caindo num modal de erro que
// mandava o usuário usar o botão Forçar. Isso quebrava por dois motivos ao mesmo
// tempo:
//
//   1) o `case` usava a chave LEGADA do passo ("aguardar_retorno"), enquanto o
//      Workflow Interno PUBLICADO usa a chave canônica renomeada
//      ("aguardar_retorno_do_cartorio") — o editor existia e nunca era alcançado;
//   2) mesmo que a chave batesse, "sem editor específico" era tratado como ERRO,
//      quando é apenas o caso de uso do EDITOR PADRÃO.
//
// REGRA
// -----
// Toda etapa publicada e executável TEM interface. A ausência de editor
// específico resolve para `padrao` — nunca para "não disponível". Erro
// administrativo é outra coisa (configuração inválida, passo inexistente,
// vínculo inconsistente) e é reportado por código estruturado pelo backend, não
// por este resolvedor.
//
// IDENTIDADE ESTRUTURAL, NUNCA TEXTO
// ----------------------------------
// A chave do registry é o `stepKey` CANÔNICO — o mesmo identificador estrutural
// que o motor usa em `PhaseInternalWorkflowStep.key` e
// `PhaseWorkflowStepInstance.stepKey`. NÃO é o título, o label nem a descrição
// do passo: renomear "Aguardar retorno do cartório" para qualquer outra coisa na
// tela não muda editor nenhum. Chave legada → chave publicada passa pela ponte
// única do catálogo (`resolveStepKeyCompat`), então um passo renomeado continua
// resolvendo para o mesmo editor sem duplicar entrada aqui.

import { resolveStepKeyCompat } from "./fases-catalog"

/**
 * Identidade do editor. É um valor ESTRUTURAL do domínio (o tipo de interface
 * executável), não um nome de arquivo nem um rótulo de tela.
 */
// Os valores NÃO repetem os stepKeys de propósito: o kind é a identidade do
// EDITOR, não a do passo. Assim um `case "solicitar_certidao"` em qualquer lugar
// do código é inequivocamente um switch por passo — e a guarda de arquitetura
// consegue reprovar.
export type StepEditorKind =
  | "registral"
  | "solicitacao_cartorio"
  | "acompanhamento_retorno"
  | "recebimento_documento"
  | "conferencia_documento"
  | "validacao_juridica"
  | "padrao"

/** Editores ESPECÍFICOS registrados, por stepKey canônico do passo publicado. */
const EDITOR_POR_STEP_KEY: Record<string, Exclude<StepEditorKind, "padrao">> = {
  localizar_registro: "registral",
  solicitar_certidao: "solicitacao_cartorio",
  // Chave PUBLICADA do passo (PhaseInternalWorkflowStep.key = "aguardar_retorno_do_cartorio").
  // A chave legada "aguardar_retorno" chega aqui já canonizada por resolveStepKeyCompat.
  aguardar_retorno_do_cartorio: "acompanhamento_retorno",
  receber_certidao: "recebimento_documento",
  conferir_certidao: "conferencia_documento",
  validar_certidao: "validacao_juridica",
}

export interface ResolucaoEditor {
  /** Editor a montar. NUNCA ausente. */
  kind: StepEditorKind
  /** stepKey canônico usado na resolução (legado já convertido). */
  stepKeyCanonico: string
  /** true = existe editor específico registrado; false = editor padrão. */
  especifico: boolean
}

/**
 * Resolve o editor de uma etapa. Determinístico, puro e total: para QUALQUER
 * stepKey devolve um editor montável.
 */
export function resolveWorkflowStepEditor(entrada: {
  stepKey: string
  phaseKey?: string | null
}): ResolucaoEditor {
  const stepKeyCanonico = resolveStepKeyCompat(entrada.phaseKey ?? null, entrada.stepKey)
  const especifico = EDITOR_POR_STEP_KEY[stepKeyCanonico]
  return {
    kind: especifico ?? "padrao",
    stepKeyCanonico,
    especifico: especifico !== undefined,
  }
}

/** Chaves com editor específico — usado por testes e por auditoria de cobertura. */
export function stepKeysComEditorEspecifico(): string[] {
  return Object.keys(EDITOR_POR_STEP_KEY)
}

/**
 * Texto de apresentação do editor na aba "Campos" da Central da Etapa.
 * Indexado pelo KIND (estrutural), nunca pelo nome do passo. O editor padrão tem
 * texto próprio — e ele descreve o que o painel faz, não uma pendência técnica.
 */
export const APRESENTACAO_EDITOR: Record<StepEditorKind, { titulo: string; descricao: string }> = {
  registral: {
    titulo: "Editor registral completo",
    descricao:
      "Preencha os 23 campos canônicos da certidão (identificação, evento, localidade, referência, rastreamento). Ao salvar, a etapa é concluída automaticamente e as divergências são recalculadas.",
  },
  solicitacao_cartorio: {
    titulo: "Solicitação ao cartório",
    descricao:
      "Escolha o canal de solicitação (CRC Nacional, E-cartório, E-mail, WhatsApp, presencial). Cada canal exige evidências diferentes.",
  },
  acompanhamento_retorno: {
    titulo: "Acompanhamento do retorno do cartório",
    descricao:
      "Acompanhe o protocolo já aberto, registre contatos com o cartório, ajuste a previsão de retorno, anexe comprovantes e conclua quando o retorno chegar.",
  },
  recebimento_documento: {
    titulo: "Recebimento da certidão",
    descricao: "Anexe o link do PDF da certidão recebida + observações do recebimento.",
  },
  conferencia_documento: {
    titulo: "Conferência operacional",
    descricao:
      "Checklist: legibilidade, integridade, dados mínimos, apostila, tradução. Resultado: aprovar / pedir retificação / reprovar.",
  },
  validacao_juridica: {
    titulo: "Validação jurídica",
    descricao:
      "Decisão jurídica final: validar, marcar como divergente ou inválido. Parecer obrigatório.",
  },
  padrao: {
    titulo: "Painel operacional da etapa",
    descricao:
      "Registre o andamento, os contatos, as observações e os comprovantes desta etapa, ajuste prazo e responsável, e conclua quando o trabalho estiver feito.",
  },
}
