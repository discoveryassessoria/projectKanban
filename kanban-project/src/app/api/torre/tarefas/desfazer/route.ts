// src/app/api/torre/tarefas/desfazer/route.ts
// ============================================================================
// TORRE — DESFAZER uma ação em lote (Bloco G1). POST { tipo, tarefaIds }.
// A permissão é a da ação que se desfaz. Restaura o estado ANTERIOR REAL de cada
// tarefa (lido da auditoria da própria ação) e audita a reversão; recusa a tarefa
// que já foi mexida por outra decisão depois. `AUSENCIA` (Equipe › Marcar ausência) cancela a ausência recém-marcada pela porta
// de capacidade (`ausenciaId`, sem tarefaIds). A janela é UMA só: `lib/operacional/torre-desfazer.ts`.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { validarIds, desfazerLote, desfazerAusenciaMarcada, type TipoDesfazer } from '@/src/services/torre-acoes-lote'

const TIPOS: TipoDesfazer[] = ['ATRIBUICAO', 'PRIORIDADE', 'PRAZO', 'AUSENCIA']

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => ({}))
  // A permissão é a da ação que se desfaz: "Marcar ausência" vive na porta de capacidade (`usuarios.gerenciar`); o resto, `tarefas.editar`.
  const { usuario, erro } = String(b?.tipo ?? '') === 'AUSENCIA' ? await exigirTorre(request, 'usuarios.gerenciar') : await exigirTorre(request, 'tarefas.editar')
  if (erro) return erro
  const tipo = String(b?.tipo ?? '') as TipoDesfazer
  if (!TIPOS.includes(tipo)) return NextResponse.json({ error: `tipo inválido; use um de ${TIPOS.join(', ')}` }, { status: 400 })
  if (tipo === 'AUSENCIA') {
    const ausenciaId = Number(b?.ausenciaId)
    if (!Number.isInteger(ausenciaId) || ausenciaId <= 0) return NextResponse.json({ error: 'ausenciaId é obrigatório' }, { status: 400 })
    const r = await desfazerAusenciaMarcada({ ausenciaId, autorId: usuario.userId })
    return NextResponse.json({ total: 1, desfeitas: r.ok ? 1 : 0, mensagem: r.mensagem, itens: [{ tarefaId: 0, ok: r.ok, mensagem: r.mensagem }] }, { status: r.ok ? 200 : 207 })
  }
  const ids = validarIds(b?.tarefaIds)
  if (!ids.ok) return NextResponse.json({ error: ids.erro }, { status: 400 })
  const ausenciaId = Number.isInteger(b?.ausenciaId) && b.ausenciaId > 0 ? (b.ausenciaId as number) : null
  const r = await desfazerLote({ tipo, tarefaIds: ids.ids, autorId: usuario.userId, ausenciaId })
  return NextResponse.json(r, { status: r.desfeitas < r.total ? 207 : 200 })
}
