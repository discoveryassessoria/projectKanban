// src/app/api/documentos/[id]/workflow/historico/route.ts
// ============================================================================
// AS VISITAS ANTERIORES DO DOCUMENTO — histórico, não trabalho a fazer.
//
//   GET /api/documentos/{id}/workflow/historico
//
// ─── POR QUE ESTA ROTA EXISTE ───────────────────────────────────────────────
// `GET /api/documentos/{id}/workflow` devolvia TUDO o que o documento tinha na fase
// atual, de todos os ciclos: depois de uma reentrada, o Abellan aparecia com sete
// etapas — "1. Solicitar certidão" duas vezes — e 61%, enquanto a Central, escopada
// por instância, mostrava cinco e 44%. Duas contas para a mesma pergunta.
//
// A correção foi escopar o roteiro executável à VISITA ATUAL. Só que os ciclos
// anteriores continuam existindo, e devem: são a prova de que o trabalho aconteceu.
// Eles não sumiram do banco — mudaram de lugar. É esta rota.
//
// ─── A SEPARAÇÃO ────────────────────────────────────────────────────────────
//   /workflow            → o que HÁ PARA FAZER agora (uma visita, executável)
//   /workflow/historico  → o que JÁ ACONTECEU (todas as visitas, só leitura)
//
// Aqui não há editor, não há ação permitida e não há progresso agregado: nada nesta
// resposta pode ser executado. Misturar as duas coisas num array só foi o defeito.
//
// SOMENTE LEITURA.
// ============================================================================
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { visitaAtualDoDocumento } from "@/src/services/documento-operacao"
import { phaseKeyToFaseCode, getStepDef } from "@/src/lib/process-stage/fases-catalog"
import { stepInstanceStatusToLegacy } from "@/src/lib/process-stage/legacy-status-map"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const documentoId = parseInt(id)
    if (isNaN(documentoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: "PERMISSION_REQUIRED" }, { status: 401 })

    const visita = await visitaAtualDoDocumento(documentoId)

    // TODOS os passos do documento, de todas as fases e ciclos — inclusive os
    // cancelados e supersedidos. Histórico que esconde o que deu errado não é
    // histórico.
    const passos = await prisma.phaseWorkflowStepInstance.findMany({
      where: { documentoId },
      orderBy: [{ faseMacroKey: "asc" }, { ciclo: "asc" }, { ordem: "asc" }],
      select: {
        id: true, workflowInstanceId: true, faseMacroKey: true, ciclo: true, ordem: true,
        stepKey: true, status: true, startedAt: true, completedAt: true, metadata: true,
      },
    })

    const instanciaIds = [...new Set(passos.map((p) => p.workflowInstanceId))]
    const instancias = instanciaIds.length
      ? await prisma.phaseWorkflowInstance.findMany({
          where: { id: { in: instanciaIds } },
          select: { id: true, status: true, createdAt: true, completedAt: true, supersededAt: true },
        })
      : []
    const porInstancia = new Map(instancias.map((i) => [i.id, i]))

    // AGRUPADO POR VISITA. Uma lista plana de passos de ciclos diferentes é
    // exatamente o formato que produziu o defeito; aqui cada ciclo é um bloco.
    const grupos = new Map<number, {
      workflowInstanceId: number
      faseMacroKey: string
      faseCode: string | null
      ciclo: number
      atual: boolean
      statusInstancia: string | null
      iniciadaEm: Date | null
      encerradaEm: Date | null
      steps: Array<Record<string, unknown>>
    }>()

    for (const p of passos) {
      const faseCode = phaseKeyToFaseCode(p.faseMacroKey)
      const g = grupos.get(p.workflowInstanceId) ?? {
        workflowInstanceId: p.workflowInstanceId,
        faseMacroKey: p.faseMacroKey,
        faseCode,
        ciclo: p.ciclo,
        atual: visita?.workflowInstanceId === p.workflowInstanceId,
        statusInstancia: porInstancia.get(p.workflowInstanceId)?.status ?? null,
        iniciadaEm: porInstancia.get(p.workflowInstanceId)?.createdAt ?? null,
        encerradaEm:
          porInstancia.get(p.workflowInstanceId)?.completedAt ??
          porInstancia.get(p.workflowInstanceId)?.supersededAt ?? null,
        steps: [],
      }
      const meta = (p.metadata ?? null) as { reentrada?: { herdadoDoPassoId?: number; cicloAnterior?: number } } | null
      g.steps.push({
        id: p.id, ordem: p.ordem, stepKey: p.stepKey,
        title: getStepDef(faseCode, p.stepKey)?.title ?? p.stepKey,
        status: stepInstanceStatusToLegacy(p.status),
        startedAt: p.startedAt, completedAt: p.completedAt,
        // LINHAGEM: de qual passo da visita anterior este herdou o estado. Serve para
        // explicar "já veio concluído" — nunca para expandir o pai junto com o filho.
        herdadoDoPassoId: meta?.reentrada?.herdadoDoPassoId ?? null,
        herdadoDoCiclo: meta?.reentrada?.cicloAnterior ?? null,
      })
      grupos.set(p.workflowInstanceId, g)
    }

    const visitas = [...grupos.values()].sort((a, b) =>
      a.faseMacroKey === b.faseMacroKey ? a.ciclo - b.ciclo : a.faseMacroKey.localeCompare(b.faseMacroKey),
    )

    return NextResponse.json({
      documentoId,
      visitaAtual: visita,
      visitas,
      totalVisitas: visitas.length,
      totalPassos: passos.length,
    })
  } catch (error) {
    console.error("[GET /api/documentos/[id]/workflow/historico]", error)
    return NextResponse.json({ error: "Erro ao buscar o histórico do workflow" }, { status: 500 })
  }
}
