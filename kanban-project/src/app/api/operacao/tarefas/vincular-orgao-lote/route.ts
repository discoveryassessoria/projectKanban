// src/app/api/operacao/tarefas/vincular-orgao-lote/route.ts
// ============================================================================
// VINCULAR ÓRGÃO EM LOTE — Etapa 3 (tela Operação v3, 26/09/2026).
//
//   POST /api/operacao/tarefas/vincular-orgao-lote
//   body: { tarefaIds: number[], orgaoId: number }
//
// Vincula o órgão emissor ao `Documento` de cada tarefa selecionada — o
// mesmo dado que já bloqueia "Iniciar" quando ausente
// (`resolverWorkflowAplicavel`/`subtarefasDaEtapa` já leem `documento.orgaoId`
// como `fornecedorId`). Tarefas sem `documentoId` (fase sem escopo
// documental) são ignoradas e reportadas — nunca um 500 silencioso.
// ============================================================================
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, "tarefas.editar")
  if (erro) return erro
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "não autenticado" }, { status: 401 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const tarefaIds = Array.isArray(body.tarefaIds) ? body.tarefaIds.map(Number).filter(Number.isInteger) : []
  const orgaoId = Number(body.orgaoId)
  if (tarefaIds.length === 0) return NextResponse.json({ ok: false, code: "SEM_TAREFAS", mensagem: "Nenhuma tarefa selecionada." }, { status: 400 })
  if (!Number.isInteger(orgaoId) || orgaoId <= 0) return NextResponse.json({ ok: false, code: "ORGAO_INVALIDO" }, { status: 400 })

  const orgao = await prisma.orgaoProtocolo.findUnique({ where: { id: orgaoId }, select: { id: true } })
  if (!orgao) return NextResponse.json({ ok: false, code: "ORGAO_INEXISTENTE" }, { status: 404 })

  const tarefas = await prisma.tarefa.findMany({
    where: { id: { in: tarefaIds } },
    select: { id: true, responsavelId: true, workflowStepInstance: { select: { documentoId: true } } },
  })

  const vinculadas: number[] = []
  const ignoradas: Array<{ tarefaId: number; motivo: string }> = []
  const documentoIds: number[] = []
  for (const t of tarefas) {
    if (usuario.tipo !== "admin" && t.responsavelId !== usuario.userId) {
      ignoradas.push({ tarefaId: t.id, motivo: "não é o responsável" }); continue
    }
    const documentoId = t.workflowStepInstance?.documentoId
    if (!documentoId) { ignoradas.push({ tarefaId: t.id, motivo: "sem documento nesta etapa" }); continue }
    documentoIds.push(documentoId)
    vinculadas.push(t.id)
  }
  const encontrados = new Set(tarefas.map((t) => t.id))
  for (const id of tarefaIds) if (!encontrados.has(id)) ignoradas.push({ tarefaId: id, motivo: "tarefa não encontrada" })

  if (documentoIds.length > 0) {
    await prisma.documento.updateMany({ where: { id: { in: [...new Set(documentoIds)] } }, data: { orgaoId } })
  }

  return NextResponse.json({ ok: true, vinculadas: vinculadas.length, ignoradas })
}
