// src/app/api/tarefas/repriorizar/route.ts
// ============================================================================
// REPRIORIZAÇÃO EM LOTE — a Central Operacional agindo sobre uma família,
// sem virar "concluir tudo".
//
// Mesma forma de /api/tarefas/redistribuir: resposta item a item, HTTP 207
// quando o lote não passou inteiro.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { redistribuirPrioridade } from '@/lib/operacional/tarefa-comandos'

const PRIORIDADES = ['BAIXA', 'MEDIA', 'ALTA', 'URGENTE'] as const

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'tarefas.editar')
  if (erro) return erro
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const b = await request.json().catch(() => ({}))
  const tarefaIds = Array.isArray(b?.tarefaIds) ? b.tarefaIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : []
  if (tarefaIds.length === 0) return NextResponse.json({ error: 'tarefaIds é obrigatório' }, { status: 400 })
  if (tarefaIds.length > 500) return NextResponse.json({ error: 'lote acima de 500 tarefas' }, { status: 400 })

  const novaPrioridade = b?.novaPrioridade
  if (!PRIORIDADES.includes(novaPrioridade)) {
    return NextResponse.json({ error: `novaPrioridade deve ser uma de: ${PRIORIDADES.join(', ')}` }, { status: 400 })
  }

  const r = await redistribuirPrioridade({
    tarefaIds,
    novaPrioridade,
    autorId: usuario.userId,
    motivo: typeof b?.motivo === 'string' ? b.motivo.slice(0, 300) : null,
  })
  return NextResponse.json(r, { status: r.falha > 0 ? 207 : 200 })
}
