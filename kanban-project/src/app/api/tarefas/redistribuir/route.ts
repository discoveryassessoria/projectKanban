// src/app/api/tarefas/redistribuir/route.ts
// ============================================================================
// REDISTRIBUIÇÃO EM LOTE — férias, afastamento, desligamento.
//
// A resposta é ITEM A ITEM. Um lote que devolvesse só "ok" esconderia as
// tarefas que não puderam mudar de dono (encerradas, ou transferidas por outra
// pessoa no mesmo instante), e o gestor sairia de férias achando que entregou
// tudo. HTTP 207 quando houve mistura — a operação aconteceu, mas não inteira.
// ============================================================================
import { respostaAtribuicaoSoNaPagina, veioDaPaginaDoProcesso, veioDaSucessaoEmMassa } from '@/lib/operacional/atribuicao-origem'
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { redistribuirTarefas } from '@/lib/operacional/tarefa-comandos'

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'tarefas.editar')
  if (erro) return erro
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const b = await request.json().catch(() => ({}))
  // ATRIBUIÇÃO SÓ NA PÁGINA DO PROCESSO: a Torre redistribui por equipe (/api/torre/equipe/*) e em lote (/api/torre/tarefas/lote), não por aqui.
  if (!veioDaPaginaDoProcesso(b) && !veioDaSucessaoEmMassa(b)) return NextResponse.json(respostaAtribuicaoSoNaPagina(), { status: 422 })
  const tarefaIds = Array.isArray(b?.tarefaIds) ? b.tarefaIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : []
  if (tarefaIds.length === 0) return NextResponse.json({ error: 'tarefaIds é obrigatório' }, { status: 400 })
  if (tarefaIds.length > 500) return NextResponse.json({ error: 'lote acima de 500 tarefas' }, { status: 400 })

  // `null` explícito devolve à fila da equipe; ausente é erro, para ninguém
  // esvaziar a carteira de alguém por engano de payload.
  if (!('novoResponsavelId' in b)) {
    return NextResponse.json({ error: 'novoResponsavelId é obrigatório (use null para devolver à fila)' }, { status: 400 })
  }
  const novoResponsavelId = b.novoResponsavelId == null ? null : Number(b.novoResponsavelId)

  const r = await redistribuirTarefas({
    tarefaIds,
    novoResponsavelId,
    autorId: usuario.userId,
    motivo: typeof b?.motivo === 'string' ? b.motivo.slice(0, 300) : null,
    confirmarTarefaEmAndamento: b?.confirmarTarefaEmAndamento === true,
  })
  return NextResponse.json(r, { status: r.falha > 0 ? 207 : 200 })
}
