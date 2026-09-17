// ============================================================================
// CAMADA DE I/O DA ENGINE DE SLA DE FASEMACRO/PROCESSO
// ----------------------------------------------------------------------------
// Carrega o snapshot do banco e delega TODO o cálculo ao núcleo puro
// (src/lib/motor/sla-core.ts). Duas entradas:
//
//   • resolveSlaProjection(processId)        — 1 processo.
//   • resolveSlaProjectionBatch(processIds)  — N processos, POUCAS queries
//     agregadas (custo CONSTANTE em nº de queries, sem N+1).
//
// ⚠ NÃO É MAIS APRESENTADO COMO "PRAZO DO PROCESSO" EM NENHUMA TELA
// OPERACIONAL (17/09/2026) — Home, Kanban, Lista e detalhe do processo
// pararam de consumir isto: era um terceiro relógio de prazo concorrente com
// os dois oficiais (Tarefa macro / Subtarefa operacional, ver
// [[prazo-tarefa-subtarefa-dois-relogios]]). O ÚNICO consumidor legítimo
// restante é o painel de inteligência da Árvore Genealógica
// (`src/components/arvore/inteligencia/barra-linhagem.tsx`, via GET
// .../genealogia/operacional) — mantido porque a Árvore está sob
// congelamento de UI (ver [[arvore-layout-definitivo]]) e não foi tocada.
// Não adicionar um NOVO consumidor operacional a isto sem reabrir a decisão
// que removeu o conceito.
//
// SOMENTE LEITURA: não escreve, não persiste, não cria campo derivado no banco.
// A configuração de SLA (FaseMacro.slaDays) continua sendo a única fonte de
// verdade, e a projeção é recalculada a cada leitura.
// ============================================================================

import { prisma } from "@/lib/prisma"
import { buildSlaProjection, slaVazio, type SlaFaseConfig, type SlaInstanciaFase } from "@/src/lib/motor/sla-core"
import type { SlaProcesso, ResumoSla } from "@/src/types/sla"

export type { SlaProcesso } from "@/src/types/sla"

/** Projeção de SLA de UM processo. Processo inexistente ⇒ projeção vazia. */
export async function resolveSlaProjection(processId: number): Promise<SlaProcesso> {
  const [sla] = await resolveSlaProjectionBatch([processId])
  return sla ?? slaVazio(processId)
}

/**
 * Projeção de SLA de N processos em 3 queries agregadas.
 * Preserva a ordem de `processIds`. Processos inexistentes recebem projeção
 * vazia (sem prazo) — nunca lançam.
 */
export async function resolveSlaProjectionBatch(
  processIds: number[],
  agora: Date = new Date(),
): Promise<SlaProcesso[]> {
  const ids = [...new Set(processIds.filter((n) => Number.isFinite(n)))]
  if (ids.length === 0) return []

  // (1) Processos — identidade, início, conclusão e fase atual.
  const processos = await prisma.processo.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      dataInicio: true,
      createdAt: true,
      dataConclusao: true,
      faseAtualKey: true,
      tipoProcessoMotorId: true,
    },
  })
  const procById = new Map(processos.map((p) => [p.id, p]))
  const tipoIds = [...new Set(processos.map((p) => p.tipoProcessoMotorId).filter((x): x is number => x != null))]

  // (2) CONFIGURAÇÃO de SLA — fases do Workflow Macro de cada Tipo de Processo.
  //     Leitura pura do cadastro: nada aqui altera ou reinterpreta a definição.
  const macros = tipoIds.length
    ? await prisma.macroWorkflow.findMany({
        where: { tipoProcessoId: { in: tipoIds } },
        select: {
          tipoProcessoId: true,
          fases: {
            orderBy: { ordem: "asc" },
            select: { phaseKey: true, label: true, ordem: true, required: true, slaDays: true },
          },
        },
      })
    : []
  const fasesPorTipo = new Map<number, SlaFaseConfig[]>(
    macros.map((m) => [
      m.tipoProcessoId,
      m.fases.map((f) => ({
        phaseKey: f.phaseKey,
        label: f.label,
        ordem: f.ordem,
        required: f.required,
        slaDays: f.slaDays,
      })),
    ]),
  )

  // (3) EXECUÇÃO real — instâncias de fase de todos os processos (todos os ciclos).
  const instancias = await prisma.phaseWorkflowInstance.findMany({
    where: { processoId: { in: ids } },
    select: {
      processoId: true,
      faseMacroKey: true,
      ciclo: true,
      status: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
    },
  })
  const instPorProc = new Map<number, SlaInstanciaFase[]>()
  for (const i of instancias) {
    const arr = instPorProc.get(i.processoId) ?? []
    arr.push({
      faseMacroKey: i.faseMacroKey,
      ciclo: i.ciclo,
      status: String(i.status),
      startedAt: i.startedAt,
      completedAt: i.completedAt,
      createdAt: i.createdAt,
    })
    instPorProc.set(i.processoId, arr)
  }

  return processIds.map((pid) => {
    const proc = procById.get(pid)
    if (!proc) return slaVazio(pid)
    return buildSlaProjection({
      processoId: pid,
      inicio: proc.dataInicio ?? proc.createdAt,
      dataConclusao: proc.dataConclusao,
      faseAtualKey: proc.faseAtualKey,
      fases: proc.tipoProcessoMotorId != null ? fasesPorTipo.get(proc.tipoProcessoMotorId) ?? [] : [],
      instancias: instPorProc.get(pid) ?? [],
      hoje: agora,
    })
  })
}

/** Contagem por faixa a partir de projeções já resolvidas — sem recálculo. */
export function resumirSla(projecoes: SlaProcesso[]): ResumoSla {
  const resumo: ResumoSla = { atrasados: 0, vencemHoje: 0, proximos7: 0, noPrazo: 0, semPrazo: 0, avaliados: 0 }
  for (const s of projecoes) {
    if (s.concluido) continue
    resumo.avaliados++
    if (!s.configurado) { resumo.semPrazo++; continue }
    if (s.faixa === "atrasados") resumo.atrasados++
    else if (s.faixa === "vencem-hoje") resumo.vencemHoje++
    else if (s.faixa === "proximos-7") resumo.proximos7++
    else if (s.faixa === "no-prazo") resumo.noPrazo++
  }
  return resumo
}
