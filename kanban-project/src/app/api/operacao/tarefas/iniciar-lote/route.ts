// src/app/api/operacao/tarefas/iniciar-lote/route.ts
// ============================================================================
// INICIAR EM LOTE — Etapa 3 (tela Operação v3, 26/09/2026): "Iniciar (enviar
// ao cartório) as N" — só as tarefas realmente "a iniciar" (ponto de entrada
// do passo, ainda não tocada, com órgão já vinculado). As demais são
// ignoradas e reportadas — nunca um erro silencioso nem meio-caminho.
//
//   POST /api/operacao/tarefas/iniciar-lote
//   body: { tarefaIds: number[], canalKey?: string, protocolo?: string }
//
// Usa `concluirSubtarefaCorrentePeloPasso` — a MESMA porta genérica que já
// religa editores antigos ao motor de subtarefas — para concluir a subtarefa
// de entrada sem precisar resolver `acaoKey` do cadastro por tarefa (o lote é
// sempre "mesmo requerimento, mesmo canal").
// ============================================================================
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { iniciarEnvioDaTarefa } from "@/src/services/iniciar-envio"

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, "tarefas.ver")
  if (erro) return erro
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "não autenticado" }, { status: 401 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const tarefaIds = Array.isArray(body.tarefaIds) ? body.tarefaIds.map(Number).filter(Number.isInteger) : []
  if (tarefaIds.length === 0) return NextResponse.json({ ok: false, code: "SEM_TAREFAS", mensagem: "Nenhuma tarefa selecionada." }, { status: 400 })
  const canalKey = typeof body.canalKey === "string" ? body.canalKey : undefined
  const protocolo = typeof body.protocolo === "string" ? body.protocolo : undefined

  // A execução vive em `iniciar-envio.ts` — a MESMA que a ação rápida "Iniciar"
  // da Torre usa (Bloco G2). Aqui só o laço do lote.
  const iniciadas: number[] = []
  const ignoradas: Array<{ tarefaId: number; motivo: string }> = []
  for (const tarefaId of [...new Set<number>(tarefaIds)]) {
    const r = await iniciarEnvioDaTarefa({ tarefaId, usuario: { userId: usuario.userId, tipo: usuario.tipo }, canalKey, protocolo })
    if (r.ok) iniciadas.push(tarefaId)
    else ignoradas.push({ tarefaId, motivo: r.motivo })
  }
  return NextResponse.json({ ok: true, iniciadas: iniciadas.length, ignoradas })
}
