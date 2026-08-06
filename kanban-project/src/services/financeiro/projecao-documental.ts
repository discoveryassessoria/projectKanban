// src/services/financeiro/projecao-documental.ts
// ============================================================================
// PROJEÇÃO FINANCEIRA DOCUMENTAL — o custo nasce quando o registro é localizado.
//
// O QUE ESTE ARQUIVO É
// --------------------
// A ponte entre UM fato operacional (o passo registral de um Documento
// Operacional foi concluído com o registro efetivamente localizado) e o motor
// econômico que já existe (`matriz-economica`). Ele NÃO calcula preço, NÃO
// decide quais serviços um documento exige e NÃO cria lançamento por conta
// própria: tudo isso continua sendo do motor, que resolve pela cadeia
//
//     Matriz Documental  → O QUE aquele processo/fase exige
//     PhaseEconomicRule  → QUAIS serviços/configurações aquele documento produz
//     Tabela de Preços   → QUANTO custa, na vigência, na moeda
//
// Este serviço só responde uma pergunta: "este evento autoriza projetar, e sobre
// qual documento?" — e delega.
//
// POR QUE O GATILHO É ESTE
// ------------------------
// O passo é identificado pela sua identidade ESTRUTURAL (o editor `registral` do
// registry oficial de editores), nunca pelo título da tarefa nem pelo nome do
// passo na tela: renomear "Localizar registro da certidão" não pode desligar o
// financeiro. E "localizado" é lido pela MESMA régua do gate de conclusão
// (cartório + livro/folha/termo), nunca por uma segunda regra escrita aqui.
//
// POR QUE A FASE É A DO PASSO
// ---------------------------
// A projeção usa a fase do passo que disparou (`faseMacroKey`). Qual fase produz
// quais componentes econômicos é CADASTRO (MatrizDocumental + PhaseEconomicRule),
// não código: se a operação quer que a emissão nasça já na localização do
// registro, isso se declara registrando as regras naquela fase. Inventar aqui um
// "de qual outra fase eu puxo" seria decidir por engenharia o que é decisão de
// negócio — e criaria uma segunda verdade sobre a mesma configuração.
// ============================================================================

import { prisma } from "@/lib/prisma"
import { resolveWorkflowStepEditor } from "@/src/lib/process-stage/step-editor-registry"
import { documentoEstaLocalizado } from "@/src/services/processEngine/stepCompletionResolver"
import { gerarEconomicoDaMatriz, type ResultadoMatriz } from "@/src/lib/motor/matriz-economica"
import { ORIGEM_AUTOMATICA } from "@/lib/financeiro/dominio/origem-lancamento"

/** Tipo do evento de origem gravado na obrigação (rastreabilidade por ID). */
export const EVENTO_ORIGEM_PASSO = "PhaseWorkflowStepInstance"

/**
 * Por que a projeção não aconteceu. É um valor ESTRUTURAL: entra no log, no
 * relatório de reconciliação e nos testes. "não projetou" nunca é silêncio.
 */
export type MotivoNaoProjetou =
  | "PASSO_INEXISTENTE"
  | "PASSO_NAO_CONCLUIDO"
  | "PASSO_NAO_REGISTRAL"
  | "PASSO_SEM_DOCUMENTO"
  | "REGISTRO_NAO_LOCALIZADO"
  | "PROCESSO_SEM_TIPO_MOTOR"

export interface ResultadoProjecaoDocumental {
  projetou: boolean
  motivo: MotivoNaoProjetou | null
  stepInstanceId: number
  processoId: number | null
  documentoId: number | null
  phaseKey: string | null
  phaseCycle: number | null
  /** resultado bruto do motor (criados/pulados/erros) quando houve projeção */
  resultado: ResultadoMatriz | null
}

function vazio(
  stepInstanceId: number,
  motivo: MotivoNaoProjetou,
  extra: Partial<ResultadoProjecaoDocumental> = {},
): ResultadoProjecaoDocumental {
  return {
    projetou: false, motivo, stepInstanceId,
    processoId: null, documentoId: null, phaseKey: null, phaseCycle: null, resultado: null,
    ...extra,
  }
}

function log(nivel: "info" | "warn" | "error", evento: string, dados: Record<string, unknown>): void {
  // Log ESTRUTURADO (JSON), com correlationId e só IDs — nunca nome de pessoa,
  // valor de documento ou segredo. Quem depura precisa da cadeia, não do dado.
  const payload = JSON.stringify({ motor: "financeiro.documental", evento, ...dados })
  if (nivel === "error") console.error(payload)
  else if (nivel === "warn") console.warn(payload)
  else console.info(payload)
}

/**
 * Projeta os custos documentais previstos de UM Documento Operacional, a partir
 * da conclusão do seu passo registral. Idempotente por construção: a chave de
 * idempotência é a mesma do MotorArtefato e agora também é @unique na obrigação,
 * então reprocessar o evento, reabrir e concluir de novo, ou repetir a chamada
 * devolve o mesmo lançamento em vez de criar o segundo.
 */
export async function projetarCustosDocumentaisDoPasso(
  stepInstanceId: number,
  opts: { correlationId?: string | null } = {},
): Promise<ResultadoProjecaoDocumental> {
  const correlationId = opts.correlationId ?? null

  const step = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: stepInstanceId },
    select: { id: true, stepKey: true, status: true, processoId: true, documentoId: true, faseMacroKey: true, ciclo: true },
  })
  if (!step) {
    log("warn", "passo_inexistente", { stepInstanceId, correlationId })
    return vazio(stepInstanceId, "PASSO_INEXISTENTE")
  }

  const base = {
    stepInstanceId, processoId: step.processoId, documentoId: step.documentoId,
    phaseKey: step.faseMacroKey, phaseCycle: step.ciclo,
  }

  if (step.status !== "CONCLUIDO") return vazio(stepInstanceId, "PASSO_NAO_CONCLUIDO", base)

  // IDENTIDADE ESTRUTURAL do passo — registry oficial, nunca o título.
  const editor = resolveWorkflowStepEditor({ stepKey: step.stepKey, phaseKey: step.faseMacroKey })
  if (editor.kind !== "registral") return vazio(stepInstanceId, "PASSO_NAO_REGISTRAL", base)

  if (step.documentoId == null) {
    log("warn", "passo_registral_sem_documento", { ...base, correlationId })
    return vazio(stepInstanceId, "PASSO_SEM_DOCUMENTO", base)
  }

  // MESMA régua do gate de conclusão. Um passo pode ter sido concluído por via
  // administrativa (Forçar) sem o registro estar localizado — nesse caso não há
  // fato econômico a projetar.
  if (!(await documentoEstaLocalizado(step.documentoId))) {
    log("info", "registro_nao_localizado", { ...base, correlationId })
    return vazio(stepInstanceId, "REGISTRO_NAO_LOCALIZADO", base)
  }

  const proc = await prisma.processo.findUnique({
    where: { id: step.processoId },
    select: { tipoProcessoMotorId: true },
  })
  if (!proc?.tipoProcessoMotorId) {
    log("warn", "processo_sem_tipo_motor", { ...base, correlationId })
    return vazio(stepInstanceId, "PROCESSO_SEM_TIPO_MOTOR", base)
  }

  log("info", "registro_localizado", { ...base, stepKey: editor.stepKeyCanonico, correlationId })

  const resultado = await gerarEconomicoDaMatriz(
    step.processoId, proc.tipoProcessoMotorId, step.faseMacroKey, step.ciclo,
    {
      documentoId: step.documentoId,
      origemLancamento: ORIGEM_AUTOMATICA,
      eventoOrigemTipo: EVENTO_ORIGEM_PASSO,
      eventoOrigemId: stepInstanceId,
    },
  )

  log(resultado.erros.length ? "error" : "info", "projecao_concluida", {
    ...base, correlationId,
    criados: resultado.criados.length,
    custosCriados: resultado.criados.filter((i) => i.custoId != null).length,
    pulados: resultado.pulados.map((p) => p.motivo),
    erros: resultado.erros,
  })

  // Erro do motor PROPAGA: o dispatcher devolve o evento a PENDENTE e reprocessa
  // (idempotente). Engolir marcaria ENVIADO e perderia o custo em silêncio.
  if (resultado.erros.length) {
    throw new Error(`projeção documental do passo ${stepInstanceId} falhou: ${resultado.erros.join(" ; ")}`)
  }

  return { projetou: true, motivo: null, ...base, resultado }
}
