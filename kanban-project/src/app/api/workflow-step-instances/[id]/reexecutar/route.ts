// src/app/api/workflow-step-instances/[id]/reexecutar/route.ts
//
// REEXECUTAR É UM ATO EXPLÍCITO — e mostra o que vai acontecer antes de acontecer.
//
// GET  devolve o PREVIEW: o que será reexecutado, o que é herdado, e o que fica
//      intacto. Reabrir uma etapa no meio de um roteiro mexe em coisas que o
//      operador não está olhando; dizer quais, antes, é o mínimo.
// POST executa pela porta canônica (`reabrirPassoTx`), que abre tentativa nova e
//      preserva a anterior.
//
// O QUE ESTA ROTA NÃO FAZ: reabrir tudo. Voltar de fase não é reexecutar, e
// reexecutar não é voltar de fase — são dois atos, e este é só o segundo.
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioComPermissoes, verificarPermissao } from "@/src/lib/verificar-permissao"
import { negarSeNaoForDonoDaTarefa } from "@/src/lib/tarefa-acesso"
import { impactoDaReabertura, ESTADOS_CUMPRIDOS, type PassoComDependencia } from "@/src/services/dependencias-do-passo"
import { reabrirPassoTx } from "@/src/services/task-step-sync"
import { tentativasDoPasso, MOTIVOS_DE_TENTATIVA } from "@/src/services/execucao-do-passo"
import { escopoDaUnidade } from "@/lib/operacional/tarefa-canonica"

async function unidadeDoPasso(id: number) {
  const passo = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id },
    select: {
      id: true, stepKey: true, ordem: true, status: true, ciclo: true, processoId: true,
      faseMacroKey: true, workflowInstanceId: true, necessidadeId: true, documentoId: true,
      dependeDeStepKeys: true,
    },
  })
  if (!passo) return null
  const irmaos = await prisma.phaseWorkflowStepInstance.findMany({
    where: escopoDaUnidade({
      workflowInstanceId: passo.workflowInstanceId,
      necessidadeId: passo.necessidadeId,
      documentoId: passo.documentoId,
    }),
    select: { id: true, stepKey: true, ordem: true, status: true, dependeDeStepKeys: true, completedAt: true },
    orderBy: { ordem: "asc" },
  })
  const grafo: PassoComDependencia[] = irmaos.map((p) => ({
    id: p.id, stepKey: p.stepKey, ordem: p.ordem, status: p.status,
    dependeDeStepKeys: Array.isArray(p.dependeDeStepKeys)
      ? (p.dependeDeStepKeys as unknown[]).filter((x): x is string => typeof x === "string")
      : null,
  }))
  return { passo, irmaos, grafo }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "workflow.iniciarPasso")
  if (erro) return erro
  const id = Number((await params).id)
  const u = await unidadeDoPasso(id)
  if (!u) return NextResponse.json({ error: "Etapa não encontrada." }, { status: 404 })

  const declaram = u.grafo.some((p) => (p.dependeDeStepKeys ?? []).length > 0)
  const { alcancados, preservados } = declaram
    ? impactoDaReabertura(u.grafo, u.passo.stepKey)
    // SEM DEPENDÊNCIA DECLARADA o roteiro é uma fila, e é isso que ele significa.
    : {
        alcancados: u.grafo.filter((p) => p.ordem > u.passo.ordem),
        preservados: u.grafo.filter((p) => p.ordem < u.passo.ordem),
      }

  const rotulo = (p: PassoComDependencia) => ({ id: p.id, stepKey: p.stepKey, ordem: p.ordem, status: p.status })
  const herdados = preservados.filter((p) => ESTADOS_CUMPRIDOS.has(p.status))

  return NextResponse.json({
    passo: { id: u.passo.id, stepKey: u.passo.stepKey, status: u.passo.status, fase: u.passo.faseMacroKey, ciclo: u.passo.ciclo },
    // O QUE VAI ACONTECER, em três listas que não se sobrepõem.
    seraReexecutado: [rotulo({ ...u.grafo.find((p) => p.id === id)! })],
    seraoReavaliados: alcancados.filter((p) => ESTADOS_CUMPRIDOS.has(p.status) || p.status === "EM_ANDAMENTO").map(rotulo),
    herdados: herdados.map(rotulo),
    intactos: preservados.filter((p) => !ESTADOS_CUMPRIDOS.has(p.status)).map(rotulo),
    execucoesAnteriores: (await tentativasDoPasso(id)).length,
    // A execução anterior não é tocada: ela é substituída, não apagada.
    aviso: "A execução atual será arquivada como execução anterior, com o que foi decidido nela. Nada do histórico é apagado.",
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "workflow.iniciarPasso")
  if (erro) return erro
  const id = Number((await params).id)
  const body = await request.json().catch(() => ({}))
  const justificativa = String(body?.justificativa ?? "").trim()
  if (justificativa.length < 5) {
    return NextResponse.json({ error: "Explique por que esta etapa está sendo reexecutada." }, { status: 400 })
  }

  const u = await unidadeDoPasso(id)
  if (!u) return NextResponse.json({ error: "Etapa não encontrada." }, { status: 404 })
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "não autenticado" }, { status: 401 })

  // 🔒 REEXECUTAR NÃO É MENOS SENSÍVEL QUE EXECUTAR — é recomeçar trabalho já
  // feito, de outra pessoa. Mesma régua do E4 (`negarSeNaoForDonoDaTarefa`).
  const passo = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id }, select: { tarefas: { take: 1, select: { responsavelId: true } } },
  })
  if (passo && passo.tarefas.length > 0) {
    const negado = await negarSeNaoForDonoDaTarefa(request, passo.tarefas[0].responsavelId)
    if (negado) return negado
  }

  const motivo = String(body?.motivo ?? MOTIVOS_DE_TENTATIVA.REABERTURA_MANUAL)
  const correlationId = String(body?.correlationId ?? `reexec|si${id}|${usuario?.userId ?? 0}|${u.passo.status}`)

  const r = await prisma.$transaction(async (tx) => {
    return reabrirPassoTx(tx, id, "EM_ANDAMENTO", {
      correlationId,
      operacao: "reexecutar",
      ciclo: u.passo.ciclo,
      processoId: u.passo.processoId,
      workflowInstanceId: u.passo.workflowInstanceId,
      usuarioId: usuario?.userId ?? null,
      motivoTentativa: motivo,
      extra: { motivo: justificativa.slice(0, 200) },
    })
  })

  if (!r.changed) {
    const explicacao = r.code === "DEPENDENCIA_PENDENTE"
      ? "Esta etapa depende de outra que ainda não foi cumprida. Reexecute a etapa anterior — começar por esta deixaria o roteiro em contradição."
      : r.code === "TRANSICAO_INVALIDA"
        ? `Uma etapa em "${r.atual.toLowerCase()}" não é reexecutável.`
        : "A etapa não mudou de estado."
    return NextResponse.json({ ok: false, code: r.code ?? null, mensagem: explicacao }, { status: 422 })
  }

  await prisma.logAuditoria.create({
    data: {
      acao: "STEP_REEXECUTADO", entidade: "PhaseWorkflowStepInstance", entidadeId: id,
      descricao: `Etapa "${u.passo.stepKey}" reexecutada (${motivo}). A execução anterior foi arquivada com o que foi decidido nela.`,
      detalhes: { motivo, justificativa, anterior: r.anterior, atual: r.atual, correlationId } as never,
      usuarioId: usuario?.userId ?? null,
    },
  }).catch(() => null)

  return NextResponse.json({ ok: true, anterior: r.anterior, atual: r.atual, execucoes: (await tentativasDoPasso(id)).length })
}
