// src/app/api/tarefas/[tarefaId]/atribuir/route.ts
// ============================================================================
// A PORTA HTTP DA RESPONSABILIDADE — atribuir, transferir, iniciar.
//
// A rota não decide nada: valida permissão, lê o corpo e chama a porta canônica
// (`lib/operacional/tarefa-comandos.ts`). Regra de negócio em rota é o padrão
// que este sistema já pagou caro — o dia em que existir uma segunda porta, uma
// delas vai esquecer a auditoria ou a notificação.
//
//   POST   { responsavelId, motivo?, lockVersion? }   atribui ou transfere
//   PATCH  { acao: "iniciar" }                        inicia a tarefa
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { atribuirTarefa, iniciarTarefa } from '@/lib/operacional/tarefa-comandos'

const HTTP: Record<string, number> = {
  NAO_ENCONTRADA: 404, TERMINAL: 409, CONFLITO: 409, SEM_RESPONSAVEL: 422, MESMO_RESPONSAVEL: 422,
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  // Distribuir trabalho é ato de gestão — o executor trabalha a sua fila, não
  // escolhe quem faz o quê.
  const erro = await verificarPermissao(request, 'tarefas.editar')
  if (erro) return erro

  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) {
    return NextResponse.json({ error: 'tarefa inválida' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const responsavelId = Number(body?.responsavelId)
  if (!Number.isInteger(responsavelId) || responsavelId <= 0) {
    return NextResponse.json({ error: 'responsavelId é obrigatório' }, { status: 400 })
  }

  const autorId = (await extrairUsuarioComPermissoes(request))?.userId ?? null
  const r = await atribuirTarefa({
    tarefaId,
    responsavelId,
    autorId,
    motivo: typeof body?.motivo === 'string' ? body.motivo.slice(0, 300) : null,
    lockVersion: Number.isInteger(body?.lockVersion) ? body.lockVersion : undefined,
  })

  if (!r.ok) return NextResponse.json({ error: r.mensagem, codigo: r.codigo }, { status: HTTP[r.codigo] ?? 422 })
  return NextResponse.json({ tarefaId: r.tarefaId, notificacaoId: r.notificacaoId })
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  // Iniciar é ato do EXECUTOR: a permissão é a de trabalhar tarefa, não a de
  // distribuir. Quem não é o responsável é barrado no serviço, não aqui.
  const erro = await verificarPermissao(request, 'tarefas.iniciar_concluir')
  if (erro) return erro

  const tarefaId = Number((await ctx.params).tarefaId)
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  if (body?.acao !== 'iniciar') return NextResponse.json({ error: 'ação desconhecida' }, { status: 400 })

  const r = await iniciarTarefa({
    tarefaId,
    autorId: usuario.userId,
    // Gestor pode destravar a fila iniciando por outro; o executor, só a sua.
    permiteDeTerceiro: usuario.tipo === 'admin',
  })
  if (!r.ok) return NextResponse.json({ error: r.mensagem, codigo: r.codigo }, { status: HTTP[r.codigo] ?? 422 })
  return NextResponse.json({ tarefaId: r.tarefaId })
}
