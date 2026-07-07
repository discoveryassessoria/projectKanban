// src/services/processEngine/stepCompletionResolver.ts
//
// ETAPA 2 — FONTE ÚNICA DE VERDADE (parte 1: conclusão de PASSO)
//
// Este é o único lugar que decide "esse passo pode ser concluído?".
// Antes essa decisão vivia num switch fixo dentro da rota
// (checarConclusaoDoPasso). Agora ela é guiada por uma POLÍTICA
// (completionPolicy), que no futuro o Gerenciamento vai configurar.
//
// Origem da política, em ordem:
//   1. a que estiver gravada no próprio passo (WorkflowStep.completionPolicy);
//   2. senão, o padrão por stepKey (mapa abaixo — a "semente");
//   3. senão, MANUAL_CONFIRMATION (sem trava automática).
//
// ⚠ Este arquivo PRESERVA o comportamento atual: as mesmas travas e as
//    mesmas mensagens de hoje. Ele ainda não muda nada no sistema — só
//    passará a ser usado quando ligarmos a rota a ele (passo seguinte).

import { prisma } from "@/lib/prisma"

// Políticas suportadas nesta etapa. Outras (da apostila) entram conforme
// as fases forem ficando prontas.
export type CompletionPolicy =
  | "MANUAL_CONFIRMATION"   // sem trava — conclui manualmente
  | "DOCUMENT_LOCATED"      // o ato foi localizado (dados registrais preenchidos)
  | "DOCUMENT_RECEIVED"     // a certidão foi anexada (arquivo)
  | "DOCUMENT_VALIDATED"    // validada — hoje = arquivo anexado (placeholder, ver TODO)

// SEMENTE: política padrão por passo, enquanto o Gerenciamento não grava
// isso no banco. Baseado nas travas atuais (E1/E2) + normalização da apostila.
const POLITICA_PADRAO: Record<string, CompletionPolicy> = {
  buscar_documento: "DOCUMENT_LOCATED",
  receber_certidao: "DOCUMENT_RECEIVED",
  conferir_certidao: "DOCUMENT_RECEIVED",
  validar_certidao: "DOCUMENT_VALIDATED",
  // qualquer passo não listado → MANUAL_CONFIRMATION (sem trava)
}

/** Retorna a política padrão de um passo (usado também para carimbar passos novos). */
export function politicaPadraoParaStep(stepKey: string): CompletionPolicy {
  return POLITICA_PADRAO[stepKey] ?? "MANUAL_CONFIRMATION"
}

export interface ResultadoConclusaoPasso {
  /** true = pode concluir; false = travado. */
  podeConcluir: boolean
  /** null quando pode; mensagem amigável (vira erro 422) quando travado. */
  motivo: string | null
  /** política que foi de fato avaliada (útil pra log/auditoria). */
  policy: CompletionPolicy
}

/**
 * Decide se um passo pode ser concluído agora.
 *
 * @param stepKey       chave do passo (ex.: "buscar_documento")
 * @param documentoId   documento ao qual o passo pertence
 * @param policyDoStep  política gravada no passo (WorkflowStep.completionPolicy);
 *                      pode ser null/undefined — cai no padrão por stepKey
 */
export async function resolveStepCompletionState(
  stepKey: string,
  documentoId: number,
  policyDoStep?: string | null,
): Promise<ResultadoConclusaoPasso> {
  // 1. Qual política vale?
  const policy: CompletionPolicy =
    (policyDoStep as CompletionPolicy) ||
    politicaPadraoParaStep(stepKey)

  // 2. Avalia a política contra o documento.
  switch (policy) {
    case "MANUAL_CONFIRMATION":
      return { podeConcluir: true, motivo: null, policy }

    case "DOCUMENT_LOCATED": {
      // O ato foi localizado quando há QUALQUER dado registral preenchido.
      const doc = await prisma.documento.findUnique({
        where: { id: documentoId },
        select: {
          cartorio: true,
          numero_registro: true,
          livro: true,
          folha: true,
          termo: true,
          data_registro: true,
        },
      })
      const localizado = !!(
        doc &&
        (doc.cartorio ||
          doc.numero_registro ||
          doc.livro ||
          doc.folha ||
          doc.termo ||
          doc.data_registro)
      )
      if (!localizado) {
        return {
          podeConcluir: false,
          policy,
          motivo:
            'Não dá para concluir "Buscar documento": o ato ainda não foi localizado. Preencha os dados registrais (cartório, livro/folha/termo ou nº de registro) na aba Dados Registrais antes de concluir.',
        }
      }
      return { podeConcluir: true, motivo: null, policy }
    }

    case "DOCUMENT_RECEIVED":
    case "DOCUMENT_VALIDATED": {
      // Hoje as duas exigem o arquivo da certidão anexado — igual ao E2 atual.
      // TODO (etapa futura): DOCUMENT_VALIDATED deve exigir um sinal REAL de
      // validação jurídica, não só a presença do arquivo.
      const doc = await prisma.documento.findUnique({
        where: { id: documentoId },
        select: { arquivo_url: true },
      })
      if (!doc?.arquivo_url) {
        return {
          podeConcluir: false,
          policy,
          motivo: "Não dá para concluir esta etapa: anexe o arquivo da certidão recebida antes.",
        }
      }
      return { podeConcluir: true, motivo: null, policy }
    }

    default:
      // Política desconhecida → não trava (conservador; não quebra o fluxo).
      return { podeConcluir: true, motivo: null, policy }
  }
}