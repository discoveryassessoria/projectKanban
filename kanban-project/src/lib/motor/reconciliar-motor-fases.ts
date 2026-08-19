// src/lib/motor/reconciliar-fase.ts
// ============================================================================
// RECONCILIADOR DO MOTOR DE FASES — a autoridade convergente.
//
// O motor de fases sempre soube DECIDIR (`advance` + `computeGate`). O que ele não
// sabia era CONVERGIR: o gate só era consultado como efeito colateral de algumas
// mutações. Quando a última pendência caía por qualquer outro caminho legítimo — um
// passo duplicado supersedido, uma necessidade que deixou de existir com a pessoa,
// uma tarefa encerrada por comando que não é `concluir_etapa` — o processo ficava
// estacionado para sempre, com a fase 100% na tela e a posição macro parada.
//
// Foi exatamente isso no processo 523: às 22:31 a conclusão do passo chamou o gate e
// ele barrou (havia um passo duplicado DISPONÍVEL e a tarefa ainda EM_ANDAMENTO);
// quando essas duas pendências caíram, ninguém perguntou de novo. O gate ficou
// ABERTO, `canAdvance = true`, e o processo permaneceu em Genealogia.
//
// ─── O QUE ESTE MÓDULO É ────────────────────────────────────────────────────
// Uma única porta: "processo, reconcilie-se". Ela é
//
//   IDEMPOTENTE — roda `advance`, que é gateado; sem gate aberto não escreve nada;
//   CONVERGENTE — pode ser chamada quantas vezes for, de qualquer lugar, sem dano;
//   EXPLICATIVA — quando NÃO avança, devolve o motivo com as pendências reais.
//
// O terceiro ponto é o que faltava para diagnóstico: "não avançou" era indistinguível
// de "ninguém tentou". Agora as duas coisas têm nome.
//
// ─── O QUE ELE NÃO É ────────────────────────────────────────────────────────
// Não é um caminho paralelo de avanço: quem move a fase continua sendo o
// PhaseAdvanceService, com o mesmo gate canônico (`computeGate`) e a mesma
// idempotência. Este módulo não força, não pula, não decide fase, não materializa e
// não toca em tarefa. Ele só faz a pergunta — e registra a resposta.
// ============================================================================

import { randomUUID } from "crypto"
import { advance, type AdvanceResult } from "@/src/lib/motor/phase-advance"
import type { BlockingIssue } from "@/src/lib/motor/blocking-helpers"

/**
 * TETO DE ENCADEAMENTO. Uma reconciliação pode atravessar mais de uma fase quando as
 * seguintes já nascem satisfeitas (fase sem passo aplicável, por exemplo). O teto não
 * é uma regra de negócio — é a trava contra um encadeamento que não termina. Cada
 * salto é uma transição real, auditada, com seu próprio log.
 */
const MAX_SALTOS = 5

export interface TransicaoReconciliada {
  de: string
  para: string
  ciclo: number
  correlationId: string
  logId: number | null
}

/**
 * O VEREDITO. Existe para responder, sem ambiguidade, a única pergunta que importa
 * quando um processo parece travado: "por que ele está aqui?".
 */
export interface DiagnosticoDeReconciliacao {
  processoId: number
  /** Fase em que o processo estava quando a reconciliação começou. */
  faseInicial: string | null
  /** Fase em que ficou. Igual à inicial quando nada avançou. */
  faseFinal: string | null
  /** Transições REAIS efetivadas nesta chamada. Vazio = nada mudou. */
  transicoes: TransicaoReconciliada[]
  /** `true` quando a fase final está satisfeita e o motor só parou por não haver para onde ir. */
  satisfeita: boolean
  /** Código do motivo da parada — o vocabulário do `advance`, sem tradução. */
  code: string
  /** Frase técnica do motivo. Diagnóstico, não texto de tela. */
  motivo: string
  /** As pendências que seguram a fase final, quando é isso que a segura. */
  pendencias: BlockingIssue[]
  correlationId: string
}

function ehOk(r: AdvanceResult): r is Extract<AdvanceResult, { success: true }> {
  return r.success === true
}

/**
 * RECONCILIA O MOTOR DE FASES DE UM PROCESSO.
 *
 * Pergunta ao gate canônico se a fase atual está satisfeita e, se estiver, efetiva a
 * transição pelo serviço canônico. Repete enquanto houver avanço (fases que já nascem
 * satisfeitas encadeiam), até o teto de segurança.
 *
 * NUNCA LANÇA. É chamada depois de mutações já commitadas — derrubar a requisição que
 * a chamou seria transformar um diagnóstico em incidente. A falha vira `code` no
 * diagnóstico e log técnico.
 */
export async function reconciliarMotorDeFases(
  processoId: number | null | undefined,
  ctx: { origem?: string; solicitadoPorId?: number | null; correlationId?: string } = {},
): Promise<DiagnosticoDeReconciliacao> {
  const correlationId = ctx.correlationId ?? randomUUID()
  const base: DiagnosticoDeReconciliacao = {
    processoId: Number(processoId ?? 0),
    faseInicial: null, faseFinal: null, transicoes: [],
    satisfeita: false, code: "SEM_PROCESSO", motivo: "Processo não informado",
    pendencias: [], correlationId,
  }
  if (!processoId) return base

  const transicoes: TransicaoReconciliada[] = []
  let faseInicial: string | null = null
  let ultimo: AdvanceResult | null = null

  try {
    for (let i = 0; i < MAX_SALTOS; i++) {
      const r = await advance(processoId, {
        correlationId,
        origem: ctx.origem ?? "reconciliacao",
        solicitadoPorId: ctx.solicitadoPorId ?? undefined,
      })
      ultimo = r
      if (ehOk(r)) {
        if (faseInicial == null) faseInicial = r.faseAnterior
        transicoes.push({ de: r.faseAnterior, para: r.faseAtual, ciclo: r.ciclo, correlationId: r.correlationId, logId: r.logId ?? null })
        continue
      }
      if (faseInicial == null) faseInicial = r.faseAtual ?? null
      break
    }
  } catch (e) {
    // O `advance` já trata conflito de CAS internamente; chegar aqui é falha técnica.
    const diag: DiagnosticoDeReconciliacao = {
      ...base,
      faseInicial, faseFinal: transicoes.at(-1)?.para ?? faseInicial, transicoes,
      code: "FALHA_TECNICA", motivo: `Reconciliação falhou: ${String(e).slice(0, 200)}`,
    }
    registrar(diag)
    return diag
  }

  const parada = ultimo && !ehOk(ultimo) ? ultimo : null
  const faseFinal = transicoes.at(-1)?.para ?? faseInicial

  const diag: DiagnosticoDeReconciliacao = {
    processoId,
    faseInicial,
    faseFinal,
    transicoes,
    // SATISFEITA = o gate deixaria passar; parou por não haver destino, não por pendência.
    satisfeita: parada?.code === "SEM_PROXIMA_FASE" || (parada == null && transicoes.length > 0),
    code: parada?.code ?? (transicoes.length ? "TETO_DE_SALTOS" : "SEM_MUDANCA"),
    motivo: parada?.message ?? (transicoes.length ? `Teto de ${MAX_SALTOS} transições encadeadas atingido` : "Nada a reconciliar"),
    pendencias: parada?.blockingIssues ?? [],
    correlationId,
  }
  registrar(diag)
  return diag
}

/**
 * OBSERVABILIDADE TÉCNICA — não é Timeline do usuário.
 *
 * Uma linha por reconciliação, com o que um diagnóstico futuro precisa: quem, onde,
 * satisfeito ou não, para onde foi, e por que parou. Silencioso quando não houve nada
 * a fazer e nada a explicar (o caso esmagadoramente mais comum), para que o log
 * continue legível.
 */
function registrar(d: DiagnosticoDeReconciliacao): void {
  if (d.transicoes.length === 0 && d.code === "SEM_MUDANCA") return
  const rota = d.transicoes.map((t) => `${t.de}→${t.para}`).join(" ⇒ ") || "—"
  console.info(
    `[motor:reconciliar] proc=${d.processoId} faseInicial=${d.faseInicial ?? "—"} faseFinal=${d.faseFinal ?? "—"} ` +
    `transicoes=${d.transicoes.length} (${rota}) satisfeita=${d.satisfeita} code=${d.code} ` +
    `pendencias=${d.pendencias.length}${d.pendencias.length ? ` [${d.pendencias.map((p) => p.code).join(",")}]` : ""} ` +
    `corr=${d.correlationId} — ${d.motivo}`,
  )
}
