// src/app/api/processos/[processoId]/logs/route.ts
// Diário Operacional do Processo — AGREGA os eventos reais do processo de várias
// fontes num único feed (shape LogItem): WorkflowEvento (avanços de fase, passos,
// tarefas do motor), Evento (agenda), e LogAuditoria (ações manuais/admin).
// Somente leitura.
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// tipo do WorkflowEvento → (descrição amigável, entidade p/ categorização)
const WF: Record<string, { d: string; e: string }> = {
  WORKFLOW_INSTANCIADO: { d: "Workflow instanciado", e: "WORKFLOW" },
  WORKFLOW_INICIADO: { d: "Workflow iniciado", e: "WORKFLOW" },
  WORKFLOW_BLOQUEADO: { d: "Workflow bloqueado", e: "WORKFLOW" },
  WORKFLOW_CONCLUIDO: { d: "Workflow concluído", e: "WORKFLOW" },
  WORKFLOW_REABERTO: { d: "Workflow reaberto", e: "WORKFLOW" },
  WORKFLOW_SUPERSEDIDO: { d: "Workflow substituído", e: "WORKFLOW" },
  PASSO_INSTANCIADO: { d: "Passo criado", e: "WORKFLOW" },
  PASSO_DISPONIBILIZADO: { d: "Passo disponibilizado", e: "WORKFLOW" },
  PASSO_INICIADO: { d: "Passo iniciado", e: "WORKFLOW" },
  PASSO_BLOQUEADO: { d: "Passo bloqueado", e: "WORKFLOW" },
  PASSO_DESBLOQUEADO: { d: "Passo desbloqueado", e: "WORKFLOW" },
  PASSO_EXECUTADO: { d: "Passo executado", e: "WORKFLOW" },
  PASSO_APROVADO: { d: "Passo aprovado", e: "WORKFLOW" },
  PASSO_CONCLUIDO: { d: "Passo concluído", e: "WORKFLOW" },
  PASSO_FALHOU: { d: "Passo falhou", e: "WORKFLOW" },
  PASSO_REABERTO: { d: "Passo reaberto", e: "WORKFLOW" },
  PASSO_DISPENSADO: { d: "Passo dispensado", e: "WORKFLOW" },
  PASSO_CANCELADO: { d: "Passo cancelado", e: "WORKFLOW" },
  PASSO_SUPERSEDIDO: { d: "Passo substituído", e: "WORKFLOW" },
  TAREFA_GERADA: { d: "Tarefa gerada", e: "TAREFA" },
  TAREFA_ATRIBUIDA: { d: "Tarefa atribuída", e: "TAREFA" },
  TAREFA_CONCLUIDA: { d: "Tarefa concluída", e: "TAREFA" },
  TAREFA_CANCELADA: { d: "Tarefa cancelada", e: "TAREFA" },
  TAREFA_REABERTA: { d: "Tarefa reaberta", e: "TAREFA" },
  TAREFA_SINCRONIZADA: { d: "Tarefa sincronizada", e: "TAREFA" },
  FASE_SIMULADA: { d: "Fase simulada", e: "WORKFLOW" },
  FASE_AVANCADA: { d: "Processo avançou de fase", e: "WORKFLOW" },
  FASE_AVANCADA_FORCADO: { d: "Fase avançada (forçado)", e: "WORKFLOW" },
  FASE_REABERTA: { d: "Fase reaberta", e: "WORKFLOW" },
  FASE_RETORNADA: { d: "Processo retornou de fase", e: "WORKFLOW" },
}

interface LogOut { id: string; acao: string; entidade: string; entidadeId: number | null; descricao: string; detalhes: any; criadoEm: string; usuario: { id: number; nome: string } | null }

export async function GET(request: Request, { params }: { params: Promise<{ processoId: string }> }) {
  try {
    const id = parseInt((await params).processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    const limite = parseInt(new URL(request.url).searchParams.get("limite") || "200")

    const processo = await prisma.processo.findUnique({
      where: { id },
      include: { tarefas: { select: { id: true } }, arvore: { include: { pessoas: { select: { id: true } } } } },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    const tarefaIds = processo.tarefas.map((t) => t.id)
    const pessoaIds = processo.arvore?.pessoas.map((p) => p.id) ?? []

    const out: LogOut[] = []

    // 1) Eventos operacionais do motor (WorkflowEvento) — fase/passo/tarefa
    try {
      const wev = await prisma.workflowEvento.findMany({ where: { processoId: id }, orderBy: { criadoEm: "desc" }, take: limite })
      for (const w of wev) {
        const map = WF[String(w.tipo)] ?? { d: String(w.tipo), e: "WORKFLOW" }
        out.push({ id: `wf-${w.id}`, acao: String(w.tipo), entidade: map.e, entidadeId: w.tarefaId ?? w.entityId ?? null, descricao: map.d, detalhes: w.dados ?? null, criadoEm: w.criadoEm.toISOString(), usuario: null })
      }
    } catch { /* fonte opcional */ }

    // 2) Agenda do processo (Evento)
    try {
      const evs = await prisma.evento.findMany({ where: { processoId: id }, orderBy: { createdAt: "desc" }, take: limite })
      for (const e of evs) out.push({ id: `ev-${e.id}`, acao: "EVENTO", entidade: "EVENTO", entidadeId: e.id, descricao: e.titulo, detalhes: e.descricao ? { descricao: e.descricao, tipo: e.tipo } : { tipo: e.tipo }, criadoEm: (e.createdAt ?? e.dataInicio).toISOString(), usuario: null })
    } catch { /* opcional */ }

    // 3) Auditoria manual/admin (LogAuditoria)
    try {
      const logs = await prisma.logAuditoria.findMany({
        where: {
          OR: [
            { entidade: "PROCESSO", entidadeId: id },
            ...(tarefaIds.length ? [{ entidade: "TAREFA", entidadeId: { in: tarefaIds } }] : []),
            ...(pessoaIds.length ? [{ entidade: "PESSOA", entidadeId: { in: pessoaIds } }] : []),
            ...(pessoaIds.length ? [{ entidade: "DOCUMENTO", entidadeId: { in: pessoaIds } }] : []),
          ],
        },
        include: { usuario: { select: { id: true, nome: true } } },
        orderBy: { criadoEm: "desc" }, take: limite,
      })
      for (const l of logs) out.push({ id: `au-${l.id}`, acao: l.acao, entidade: l.entidade, entidadeId: l.entidadeId, descricao: l.descricao, detalhes: l.detalhes ?? null, criadoEm: l.criadoEm.toISOString(), usuario: l.usuario })
    } catch { /* opcional */ }

    out.sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime())
    return NextResponse.json({ logs: out.slice(0, limite) })
  } catch (error) {
    console.error("Erro ao buscar logs do processo:", error)
    return NextResponse.json({ error: "Erro ao buscar logs" }, { status: 500 })
  }
}
