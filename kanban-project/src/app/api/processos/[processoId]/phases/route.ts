// src/app/api/processos/[processoId]/phases/route.ts
//
// Lista as fases do processo com o estado (ACTIVE|COMPLETED|OPEN|FUTURE), o progresso
// REAL de cada uma e os metadados das instâncias MATERIALIZADAS (por ciclo). Alimenta
// o Workflow Macro para decidir clicabilidade (só fases materializadas) e navegar por
// workflowInstanceId (multi-ciclo). Somente leitura — não materializa nada.
// Gate: processos.ver.
//
// `state`/`progress` eram calculados só pela ORDEM da fase ("ordem menor que a atual
// = concluída, 100%"). Isso mentia sempre que o processo passava por uma fase sem
// concluir o trabalho dela de verdade (ex.: Movimentação Manual de Fase preservando
// histórico — a fase de origem fica ATIVA, não CONCLUIDO). Agora os dois vêm do MESMO
// motor canônico que já decide progresso/gate em qualquer outro lugar do sistema
// (`resolveOperationalProjection` — nenhum recálculo próprio):
//   COMPLETED → a instância mais recente da fase tem status CONCLUIDO (trabalho real).
//   OPEN      → a fase foi materializada mas não terminou (aberta, mesmo não sendo a
//               atual) — progresso é o que a projeção realmente mede, nunca 100.
//   FUTURE    → nunca foi materializada. Progresso 0 (verdade, não suposição).
//
// ESCOPO deliberadamente restrito a `ordem <= ordemAtual` — fase JÁ ALCANÇADA pelo
// processo, exatamente o que foi pedido ("a fase anterior mostra a % real"). Uma
// fase POSTERIOR à atual com instância (ex.: SUPERSEDIDA por um retrocesso/reabertura
// anterior) fica FUTURE/0% do mesmo jeito de sempre — mexer nisso é território do
// módulo de Retrocesso e Reabertura (🔒 CONGELADO), fora do pedido.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { FASES, phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"
import { resolveOperationalProjection } from "@/src/lib/process-stage/operational-projection"
import { resolverRotuloDaFase } from "@/src/lib/process-stage/escopo-operacional-da-fase"
import { resolverMacroWorkflowDoProcesso } from "@/src/lib/motor/resolver-macro-workflow"
import type { FaseCode } from "@prisma/client"

type PhaseState = "ACTIVE" | "COMPLETED" | "OPEN" | "FUTURE"

interface CycleMeta {
  workflowInstanceId: number
  ciclo: number
  status: string
  startedAt: string | null
  completedAt: string | null
  supersededAt: string | null
}

interface PhaseListItem {
  phaseKey: string
  faseCode: FaseCode | null
  label: string
  ordem: number
  /** Entra no caminho ativo condicionalmente (ex.: Retificação — só se decidida). */
  conditional: boolean
  state: PhaseState
  /** Progresso REAL da fase (0-100) — mesma projeção usada pelo Kanban/Header/consulta. */
  progress: number
  materialized: boolean
  /** Instância mais recente (maior ciclo) — alvo default da consulta. */
  workflowInstanceId: number | null
  ciclo: number | null
  status: string | null
  /** Todos os ciclos materializados desta fase (para consulta multi-ciclo). */
  cycles: CycleMeta[]
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro

  const { processoId } = await params
  const id = parseInt(processoId)
  if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  try {
    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { id: true, faseAtualKey: true, tipoProcessoMotorId: true, modalidadeId: true },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    const faseAtualKey = processo.faseAtualKey ?? null

    // FONTE CANÔNICA — o Workflow Macro REAL deste processo (tipo+modalidade,
    // `resolverMacroWorkflowDoProcesso`), não o catálogo hardcoded. Uma fase publicada
    // pelo Catálogo de Fases (mandato 20/09/2026) só aparece aqui se a fonte for esta:
    // o catálogo em código nunca vai saber que ela existe. `faseCode` continua
    // preenchido para as 10 fases canônicas (compat com quem ainda lê por FaseCode) e
    // nasce `null` para fase nova — identidade real é `phaseKey`, nunca o code nem o label.
    const macroWorkflow = processo.tipoProcessoMotorId != null && processo.modalidadeId != null
      ? await resolverMacroWorkflowDoProcesso(processo.tipoProcessoMotorId, processo.modalidadeId)
      : null

    // FALLBACK — processo sem tipo do motor (legado) ou sem Workflow Macro
    // cadastrado: mantém o comportamento anterior (catálogo em código) em vez de
    // devolver uma lista vazia. `conditional` aqui usa a mesma dupla canônica que
    // já era hardcoded na trilha (Retificação/Emissão Retificada) — o catálogo em
    // código não declara isso, e este é só o caminho de compatibilidade legado.
    const CONDICIONAIS_CANONICAS = new Set(["retificacao_registros", "emissao_documental_retificada"])
    let fasesOrdenadas = macroWorkflow
      ? macroWorkflow.fases.map((f) => ({ phaseKey: f.phaseKey, label: f.label, ordem: f.ordem, code: phaseKeyToFaseCode(f.phaseKey), conditional: f.conditional }))
      : Object.values(FASES).sort((a, b) => a.ordem - b.ordem).map((f) => ({ ...f, conditional: CONDICIONAIS_CANONICAS.has(f.phaseKey) }))

    // A FASE ATUAL DO PROCESSO SEMPRE APARECE NA TRILHA — mesmo quando não está em
    // nenhum Workflow Macro composto (processo sem tipoProcessoMotorId, ex.: cenário
    // sintético/legado) nem no catálogo em código (mandato "Catálogo de Fases",
    // correção 20/09/2026, bug 1: sem isto, a trilha ficava sem NENHUMA fase ACTIVE
    // e o rótulo caía para a chave técnica crua em quem consumisse esta lista).
    // Rótulo pelo MESMO resolvedor canônico usado no resto do sistema — nunca
    // inventado aqui, nunca por casamento de texto.
    if (faseAtualKey && !fasesOrdenadas.some((f) => f.phaseKey === faseAtualKey)) {
      const rotulo = await resolverRotuloDaFase(faseAtualKey)
      // Erro CONTROLADO de configuração — nunca a chave crua apresentada como se
      // fosse um nome válido: nem o código nem o cadastro conhecem esta fase.
      const label = rotulo ?? `⚠ Fase não cadastrada (${faseAtualKey})`
      fasesOrdenadas = [
        ...fasesOrdenadas,
        { phaseKey: faseAtualKey, label, ordem: fasesOrdenadas.length, code: phaseKeyToFaseCode(faseAtualKey), conditional: false },
      ]
    }

    const ordemAtual = fasesOrdenadas.find((f) => f.phaseKey === faseAtualKey)?.ordem ?? -1

    const instancias = await prisma.phaseWorkflowInstance.findMany({
      where: { processoId: id },
      orderBy: [{ faseMacroKey: "asc" }, { ciclo: "desc" }],
      select: {
        id: true, faseMacroKey: true, ciclo: true, status: true,
        startedAt: true, completedAt: true, supersededAt: true,
      },
    })

    const porFase = new Map<string, CycleMeta[]>()
    for (const inst of instancias) {
      const arr = porFase.get(inst.faseMacroKey) ?? []
      arr.push({
        workflowInstanceId: inst.id,
        ciclo: inst.ciclo,
        status: String(inst.status),
        startedAt: inst.startedAt?.toISOString() ?? null,
        completedAt: inst.completedAt?.toISOString() ?? null,
        supersededAt: inst.supersededAt?.toISOString() ?? null,
      })
      porFase.set(inst.faseMacroKey, arr)
    }

    // Progresso REAL só é consultado para fase JÁ ALCANÇADA (ordem <= atual) que tem
    // instância — o escopo explicado no cabeçalho. Fora disso, 0% sem perguntar nada.
    const progressos = await Promise.all(
      fasesOrdenadas.map(async (f) => {
        if (f.ordem > ordemAtual) return 0
        const latest = (porFase.get(f.phaseKey) ?? [])[0] ?? null
        if (!latest) return 0
        const proj = await resolveOperationalProjection(id, {
          faseMacroKey: f.phaseKey,
          workflowInstanceId: latest.workflowInstanceId,
        })
        return proj.progress.percentage
      }),
    )

    const phases: PhaseListItem[] = fasesOrdenadas.map((f, i) => {
      const cycles = porFase.get(f.phaseKey) ?? [] // já ordenado por ciclo desc
      const latest = cycles[0] ?? null
      const alcancada = f.ordem <= ordemAtual
      const concluida = alcancada && latest?.status === "CONCLUIDO"
      const state: PhaseState =
        f.phaseKey === faseAtualKey ? "ACTIVE"
        : concluida ? "COMPLETED"
        : alcancada && latest ? "OPEN"
        : "FUTURE"
      return {
        phaseKey: f.phaseKey,
        faseCode: f.code,
        conditional: f.conditional,
        label: f.label,
        ordem: f.ordem,
        state,
        progress: state === "COMPLETED" ? 100 : progressos[i],
        materialized: cycles.length > 0,
        workflowInstanceId: latest?.workflowInstanceId ?? null,
        ciclo: latest?.ciclo ?? null,
        status: latest?.status ?? null,
        cycles,
      }
    })

    return NextResponse.json({ processoId: id, faseAtualKey, ordemAtual, phases })
  } catch (error) {
    console.error("[GET .../phases]", error)
    return NextResponse.json({ error: "Erro ao listar fases" }, { status: 500 })
  }
}
