// src/app/api/torre/tarefas/desfazer/route.ts
// ============================================================================
// TORRE — DESFAZER uma ação em lote (Bloco G1). POST { tipo, tarefaIds }.
// A permissão é a da ação que se desfaz. Restaura o estado ANTERIOR REAL de cada
// tarefa (lido da auditoria da própria ação) e audita a reversão; recusa a tarefa
// que já foi mexida por outra decisão depois.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { validarIds, desfazerLote, type TipoDesfazer } from '@/src/services/torre-acoes-lote'

const TIPOS: TipoDesfazer[] = ['ATRIBUICAO', 'PRIORIDADE', 'PRAZO']

export async function POST(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.editar')
  if (erro) return erro
  const b = await request.json().catch(() => ({}))
  const tipo = String(b?.tipo ?? '') as TipoDesfazer
  if (!TIPOS.includes(tipo)) return NextResponse.json({ error: `tipo inválido; use um de ${TIPOS.join(', ')}` }, { status: 400 })
  const ids = validarIds(b?.tarefaIds)
  if (!ids.ok) return NextResponse.json({ error: ids.erro }, { status: 400 })
  const ausenciaId = Number.isInteger(b?.ausenciaId) && b.ausenciaId > 0 ? (b.ausenciaId as number) : null
  const r = await desfazerLote({ tipo, tarefaIds: ids.ids, autorId: usuario.userId, ausenciaId })
  return NextResponse.json(r, { status: r.desfeitas < r.total ? 207 : 200 })
}
