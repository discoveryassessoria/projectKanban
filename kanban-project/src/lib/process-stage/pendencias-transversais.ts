// src/lib/process-stage/pendencias-transversais.ts
//
// Camada de LEITURA do resumo de pendências transversais. Carrega o estado real das
// obrigações do processo (todas as fases, todos os ciclos) e delega o cálculo ao
// núcleo puro. Não escreve nada e não é fonte de verdade: é uma derivação.

import { prisma } from "@/lib/prisma"
import { FASES, phaseKeyToFaseCode } from "./fases-catalog"
import {
  montarPendenciasTransversais,
  type ResumoPendenciasTransversais,
  type PassoParaPendencia,
  type FaseOrdenadaSimples,
} from "./pendencias-transversais-core"
import type { FaseCode } from "@prisma/client"
import { resolverMacroWorkflowDoProcesso } from "@/src/lib/motor/resolver-macro-workflow"

export type { ResumoPendenciasTransversais } from "./pendencias-transversais-core"

export async function resolvePendenciasTransversais(processoId: number): Promise<ResumoPendenciasTransversais> {
  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, faseAtualKey: true, tipoProcessoMotorId: true, modalidadeId: true },
  })
  if (!processo) {
    return montarPendenciasTransversais([], [], null)
  }

  const [macro, passos] = await Promise.all([
    resolverMacroWorkflowDoProcesso(processo.tipoProcessoMotorId, processo.modalidadeId),
    // TODOS os passos do processo — sem filtro por fase, por ciclo ou por status da
    // instância. Filtrar aqui é exatamente como uma pendência real vira histórico morto.
    prisma.phaseWorkflowStepInstance.findMany({
      where: { processoId },
      select: {
        faseMacroKey: true, ciclo: true, status: true, obrigatorio: true,
        workflowInstance: { select: { status: true } },
      },
    }),
  ])

  const fases: FaseOrdenadaSimples[] = (macro?.fases ?? []).map((f) => {
    const code = phaseKeyToFaseCode(f.phaseKey)
    return {
      phaseKey: f.phaseKey,
      ordem: f.ordem,
      label: code ? FASES[code as FaseCode].label : (f.label || f.phaseKey),
    }
  })

  const entrada: PassoParaPendencia[] = passos.map((p) => ({
    faseMacroKey: p.faseMacroKey,
    ciclo: p.ciclo,
    status: String(p.status),
    obrigatorio: p.obrigatorio,
    statusDaInstancia: String(p.workflowInstance?.status ?? ""),
  }))

  return montarPendenciasTransversais(entrada, fases, processo.faseAtualKey ?? null)
}
