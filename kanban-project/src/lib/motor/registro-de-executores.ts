// src/lib/motor/registro-de-executores.ts
// ============================================================================
// O QUE CADA EXECUTOR SABE FAZER — capacidades declaradas, não presumidas.
//
// ─── O PROBLEMA QUE ISSO RESOLVE ────────────────────────────────────────────
// Executor especializado continua sendo a resposta certa quando a interface é
// complexa: a tela de recebimento precisa de dropzone, a registral precisa dos 23
// campos da certidão. O que estava errado era o executor ser DONO do negócio —
// decidir sozinho quais canais existem, quais resultados são possíveis e para onde
// o processo vai depois.
//
// Aqui o executor declara CAPACIDADE TÉCNICA: que tipos de campo ele sabe
// desenhar e que efeitos ele sabe disparar. O negócio vem do cadastro. E a
// publicação passa a poder recusar uma configuração que o executor não executa —
// em vez de publicar e o operador descobrir na tela que o campo não aparece.
//
// ─── ISTO NÃO É CADASTRO ────────────────────────────────────────────────────
// Um executor existe porque alguém escreveu um componente. Acrescentar executor é
// mudança de código. O que não pode exigir código é configurar os que existem.
// ============================================================================

import type { StepEditorKind } from "@/src/lib/process-stage/step-editor-registry"

/** Tipos de campo que o cadastro pode declarar. É o vocabulário do `StepField.tipo`. */
export const TIPOS_DE_CAMPO = [
  "texto", "textarea", "numero", "moeda", "data",
  "select", "multiselect", "checkbox", "radio", "upload", "booleano",
] as const
export type TipoDeCampo = (typeof TIPOS_DE_CAMPO)[number]

export interface CapacidadesDoExecutor {
  key: StepEditorKind
  label: string
  /** Tipos de campo que este executor sabe desenhar. */
  campos: readonly TipoDeCampo[]
  /** Efeitos que este executor sabe disparar. `"*"` = todos os do catálogo. */
  efeitos: readonly string[] | "*"
  /** O executor sabe consumir ações cadastradas (em vez de opções fixas)? */
  acoesCadastradas: boolean
  /** O executor sabe consumir checklist cadastrado? */
  checklistCadastrado: boolean
  /** Sabe oferecer os canais cadastrados no passo? */
  suportaCanais: boolean
  /** Sabe receber evidência (arquivo) como parte da execução? */
  suportaEvidencia: boolean
  /** Sabe representar espera externa (aguardando terceiro)? */
  suportaEsperaExterna: boolean
  /** Sabe esconder/exigir campo por condição declarativa? */
  suportaCondicoes: boolean
}

/**
 * O EXECUTOR PADRÃO É O DECLARATIVO.
 *
 * Ele desenha qualquer campo do vocabulário, dispara qualquer efeito do catálogo e
 * consome ações e checklist do cadastro. É por causa dele que um passo criado pelo
 * administrador — com campos, ações e checklist novos — executa sem uma linha de
 * código: não existe passo "sem editor", existe passo cuja configuração É a tela.
 */
export const REGISTRO_DE_EXECUTORES: Record<StepEditorKind, CapacidadesDoExecutor> = {
  padrao: {
    key: "padrao",
    label: "Painel declarativo",
    campos: TIPOS_DE_CAMPO,
    efeitos: "*",
    acoesCadastradas: true,
    checklistCadastrado: true,
    suportaCanais: true,
    suportaEvidencia: true,
    suportaEsperaExterna: true,
    suportaCondicoes: true,
  },
  solicitacao_cartorio: {
    key: "solicitacao_cartorio",
    label: "Solicitação ao cartório",
    campos: ["texto", "textarea", "data", "select", "upload", "booleano"],
    efeitos: ["COMPLETE_STEP", "PAUSE_FOR_EXTERNAL_WAIT", "REGISTER_ONLY"],
    acoesCadastradas: true,
    checklistCadastrado: false,
    suportaCanais: true,
    suportaEvidencia: true,
    suportaEsperaExterna: true,
    suportaCondicoes: true,
  },
  acompanhamento_retorno: {
    key: "acompanhamento_retorno",
    label: "Acompanhamento do retorno",
    campos: ["texto", "textarea", "data", "select", "upload"],
    efeitos: ["COMPLETE_STEP", "PAUSE_FOR_EXTERNAL_WAIT", "RESUME", "REGISTER_ONLY"],
    acoesCadastradas: true,
    checklistCadastrado: false,
    suportaCanais: false,
    suportaEvidencia: true,
    suportaEsperaExterna: true,
    suportaCondicoes: true,
  },
  recebimento_documento: {
    key: "recebimento_documento",
    label: "Recebimento do documento",
    campos: ["texto", "textarea", "data", "select", "radio", "upload"],
    efeitos: ["MARK_DOCUMENT_RECEIVED", "COMPLETE_STEP", "REGISTER_ONLY"],
    acoesCadastradas: true,
    checklistCadastrado: false,
    suportaCanais: false,
    suportaEvidencia: true,
    suportaEsperaExterna: false,
    suportaCondicoes: true,
  },
  conferencia_documento: {
    key: "conferencia_documento",
    label: "Conferência operacional",
    campos: ["texto", "textarea", "checkbox", "select", "radio", "upload"],
    // A CONFERÊNCIA NÃO DECIDE RETIFICAÇÃO. Ela aprova para a análise ou pede outra
    // via — as duas coisas são operacionais. `GO_RETIFICATION` não está aqui, e a
    // competência da fase de Emissão também não o permite: são duas travas, e é de
    // propósito, porque foi por esse caminho que a decisão jurídica vazou.
    efeitos: ["APPROVE_FOR_ANALYSIS", "REQUEST_NEW_COPY", "COMPLETE_STEP", "REGISTER_ONLY"],
    acoesCadastradas: true,
    checklistCadastrado: true,
    suportaCanais: false,
    suportaEvidencia: true,
    suportaEsperaExterna: false,
    suportaCondicoes: true,
  },
  validacao_juridica: {
    key: "validacao_juridica",
    label: "Validação jurídica",
    campos: ["texto", "textarea", "select", "radio", "checkbox", "upload"],
    // APPROVE_FOR_ANALYSIS está aqui porque esta MESMA tela é usada em duas fases com
    // competências diferentes: na Emissão ela valida para ENTREGAR à Análise; na
    // Análise ela decide. Quem separa as duas não é o executor — é a competência da
    // fase, que só na Análise inclui GO_RETIFICATION. O executor declara o que sabe
    // desenhar e disparar; o que ele PODE, ali, quem diz é o cadastro.
    efeitos: [
      "APPROVE_FOR_ANALYSIS", "COMPLETE_DOCUMENT", "REGISTER_DIVERGENCE", "GO_RETIFICATION",
      "INVALIDATE_DOCUMENT", "REQUEST_NEW_COPY", "COMPLETE_STEP", "REGISTER_ONLY",
    ],
    acoesCadastradas: true,
    checklistCadastrado: true,
    suportaCanais: false,
    suportaEvidencia: true,
    suportaEsperaExterna: false,
    suportaCondicoes: true,
  },
  registral: {
    key: "registral",
    label: "Editor registral",
    campos: ["texto", "textarea", "data", "select", "booleano"],
    efeitos: ["COMPLETE_STEP", "REGISTER_ONLY"],
    acoesCadastradas: false,
    checklistCadastrado: false,
    suportaCanais: false,
    suportaEvidencia: false,
    suportaEsperaExterna: false,
    suportaCondicoes: false,
  },
}

/** Alias legível — a publicação pergunta "o que este executor sabe fazer?". */
export const capacidadeDoExecutor = capacidades

export function capacidades(key: string): CapacidadesDoExecutor | null {
  return (REGISTRO_DE_EXECUTORES as Record<string, CapacidadesDoExecutor>)[key] ?? null
}

export function executorSuportaEfeito(executorKey: string, effectKey: string): boolean {
  const c = capacidades(executorKey)
  if (!c) return false
  return c.efeitos === "*" || c.efeitos.includes(effectKey)
}

export function executorSuportaCampo(executorKey: string, tipo: string): boolean {
  const c = capacidades(executorKey)
  if (!c) return false
  return (c.campos as readonly string[]).includes(tipo)
}
