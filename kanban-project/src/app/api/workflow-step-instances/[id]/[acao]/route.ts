// src/app/api/workflow-step-instances/[id]/[acao]/route.ts
// CP-4D — ações canônicas de Passo (runtime v2), via TaskStepSyncService.
// acao ∈ start | complete | approve | dispense | cancel | supersede.
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import type { PermissaoChave } from "@/src/lib/permissoes"
import {
  iniciarPasso, concluirPasso, aprovarPasso, dispensarPasso, cancelarPasso, supersederPasso,
  type SyncContexto,
} from "@/src/services/task-step-sync"

const ACOES: Record<string, { perm: PermissaoChave; fn: (id: number, ctx: SyncContexto) => Promise<unknown> }> = {
  start: { perm: "workflow.iniciarPasso", fn: iniciarPasso },
  complete: { perm: "workflow.concluirPasso", fn: concluirPasso },
  approve: { perm: "workflow.aprovarPasso", fn: aprovarPasso },
  dispense: { perm: "workflow.dispensarPasso", fn: dispensarPasso },
  cancel: { perm: "workflow.cancelarPasso", fn: cancelarPasso },
  supersede: { perm: "workflow.supersederPasso", fn: supersederPasso },
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; acao: string }> }
) {
  const { id: idParam, acao } = await params
  const def = ACOES[acao]
  if (!def) return NextResponse.json({ error: "Ação inválida" }, { status: 400 })

  const erro = await verificarPermissao(request, def.perm)
  if (erro) return erro

  const id = parseInt(idParam)
  if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  try {
    const body = await request.json().catch(() => ({}))
    const ctx: SyncContexto = {
      origem: body.origem ?? "USER",
      usuarioId: body.usuarioId,
      aprovadorId: body.aprovadorId,
      correlationId: body.correlationId,
      causationId: body.causationId,
      motivoCodigo: body.motivoCodigo,
      justificativa: body.justificativa,
    }
    const resultado = (await def.fn(id, ctx)) as { success: boolean; changed?: boolean }
    if (!resultado.success) return NextResponse.json(resultado, { status: 409 })
    return NextResponse.json(resultado, { status: 200 })
  } catch (error) {
    console.error(`Erro na ação ${acao} do passo:`, error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
