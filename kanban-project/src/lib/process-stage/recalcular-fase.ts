// src/lib/process-stage/recalcular-fase.ts
//
// CUTOVER V2 — o avanço de fase é derivado EXCLUSIVAMENTE do runtime V2 e escrito
// SOMENTE pelo serviço canônico PhaseAdvanceService (`advance`). Esta função é o
// gancho chamado pela conclusão de passo por-documento: ela apenas delega ao
// serviço, que checa pendências BLOCKING (zero = avança) e instancia a próxima
// fase V2. Nenhuma leitura/escrita de Workflow/WorkflowStep legado. Idempotente.

import { prisma } from "@/lib/prisma"
import { phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"
import type { FaseCode } from "@prisma/client"
import { advance } from "@/src/lib/motor/phase-advance"

interface ResultadoRecalculo {
  mudou: boolean
  faseAnterior: FaseCode | null
  faseNova: FaseCode | null
  motivo: string
}

/**
 * Recalcula e (se possível) avança a fase do processo de um documento, via V2.
 * Idempotente: o serviço canônico só avança com zero pendências blocking.
 *
 * `faseMacroKeyOrigem`, quando informado, é a fase do PASSO que acabou de ser
 * concluído — se ela não for a fase ATUAL do processo (ex.: regularização manual de
 * uma fase histórica, com o processo já reposicionado adiante), o avanço nem é
 * tentado: a conclusão não tem relação com a fase corrente.
 */
export async function recalcularFaseDoProcesso(
  documentoId: number,
  faseMacroKeyOrigem?: string | null,
): Promise<ResultadoRecalculo> {
  const doc = await prisma.documento.findUnique({
    where: { id: documentoId },
    select: { pessoa: { select: { arvore: { select: { processos: { select: { id: true, faseAtualKey: true } } } } } } },
  })
  const processo = doc?.pessoa?.arvore?.processos?.[0]
  if (!processo) {
    return { mudou: false, faseAnterior: null, faseNova: null, motivo: "Documento sem processo" }
  }
  const faseAntes = phaseKeyToFaseCode(processo.faseAtualKey) ?? null

  if (faseMacroKeyOrigem != null && faseMacroKeyOrigem !== processo.faseAtualKey) {
    return { mudou: false, faseAnterior: faseAntes, faseNova: faseAntes, motivo: "Passo concluído é de fase histórica — avanço não se aplica" }
  }

  // Avanço derivado do V2 (único escritor de faseAtualKey). Best-effort e gated.
  const r = await advance(processo.id) as { success?: boolean; faseAtual?: string; message?: string; resultado?: string }
  const mudou = r.success === true
  const faseNova = mudou ? phaseKeyToFaseCode(r.faseAtual) ?? faseAntes : faseAntes
  return {
    mudou,
    faseAnterior: faseAntes,
    faseNova,
    motivo: r.message ?? r.resultado ?? (mudou ? "Avançou de fase (V2)" : "Sem avanço"),
  }
}
