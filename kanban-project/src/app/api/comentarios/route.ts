// src/app/api/comentarios/route.ts
// ============================================================================
// COMENTÁRIOS POR TAREFA OU POR FAMÍLIA — Torre de Controle, Bloco E4.
//
//   GET  /api/comentarios?tarefaId=123     lista os comentários da tarefa
//   GET  /api/comentarios?familiaId=45     lista os comentários da família
//   POST /api/comentarios                  cria (tarefaId XOR familiaId, texto, processoId? p/ o link da menção)
//   Comentário de família sem familiaId (processo sem família) → 422; nunca cria família.
//
// Mesma régua de permissão de `tarefas.editar`/`tarefas.ver` que o resto da
// operação: comentar é uma forma de trabalhar a tarefa, não uma ação
// separada com permissão própria.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { criarComentario, listarComentarios } from '@/src/services/comentario-tarefa'

function lerAncora(sp: URLSearchParams | Record<string, unknown>, get: (k: string) => unknown) {
  const tarefaIdBruto = get('tarefaId')
  const familiaIdBruto = get('familiaId')
  const tarefaId = tarefaIdBruto != null && tarefaIdBruto !== '' ? Number(tarefaIdBruto) : null
  const familiaId = familiaIdBruto != null && familiaIdBruto !== '' ? Number(familiaIdBruto) : null
  return { tarefaId, familiaId }
}

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'tarefas.ver')
  if (erro) return erro

  const sp = new URL(request.url).searchParams
  const { tarefaId, familiaId } = lerAncora(sp, (k) => sp.get(k))
  if ((tarefaId == null) === (familiaId == null)) {
    return NextResponse.json({ error: 'informe EXATAMENTE um de: tarefaId, familiaId' }, { status: 400 })
  }
  if ((tarefaId != null && !Number.isInteger(tarefaId)) || (familiaId != null && !Number.isInteger(familiaId))) {
    return NextResponse.json({ error: 'id inválido' }, { status: 400 })
  }

  const comentarios = await listarComentarios({ tarefaId, familiaId })
  return NextResponse.json({ comentarios })
}

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'tarefas.editar')
  if (erro) return erro
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const b = await request.json().catch(() => ({}))
  const { tarefaId, familiaId } = lerAncora(b, (k) => b?.[k])

  const processoId = b?.processoId != null && b.processoId !== '' && Number.isInteger(Number(b.processoId)) ? Number(b.processoId) : null
  const r = await criarComentario({
    tarefaId, familiaId, processoId, autorId: usuario.userId, texto: String(b?.texto ?? ''),
  })
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 422 })
  return NextResponse.json({ comentario: r.comentario }, { status: 201 })
}
