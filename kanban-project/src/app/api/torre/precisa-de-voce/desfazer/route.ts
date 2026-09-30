// src/app/api/torre/precisa-de-voce/desfazer/route.ts
// ============================================================================
// DESFAZER — Torre de Controle, Bloco F (29/09/2026).
//
//   POST /api/torre/precisa-de-voce/desfazer
//   body: { tarefaIds: number[] }  (1 = individual, N = lote)
//
// O toast/janela de "alguns segundos" é do front (Decisão 6: 6 s). Aqui só
// existe "desfazer esta atribuição", chamado a qualquer momento — a leitura
// (`de` == responsável atual?) é o que garante que não desfaz por engano uma
// decisão já sobreposta por outra.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { desfazerAtribuicao } from '@/src/services/precisa-de-voce-acoes'

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const b = await request.json().catch(() => ({}))
  const tarefaIds = Array.isArray(b?.tarefaIds) ? b.tarefaIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : []
  if (tarefaIds.length === 0) return NextResponse.json({ error: 'tarefaIds é obrigatório' }, { status: 400 })
  if (tarefaIds.length > 500) return NextResponse.json({ error: 'lote acima de 500 tarefas' }, { status: 400 })

  const r = await desfazerAtribuicao(tarefaIds, usuario.userId)
  return NextResponse.json(r, { status: r.desfeitas < r.total ? 207 : 200 })
}
