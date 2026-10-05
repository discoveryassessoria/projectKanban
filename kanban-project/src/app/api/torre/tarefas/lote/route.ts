// src/app/api/torre/tarefas/lote/route.ts
// ============================================================================
// TORRE — AÇÕES EM LOTE (Bloco G1, 30/09/2026).
//
//   POST /api/torre/tarefas/lote
//   body: { acao: "ATRIBUIR" | "PRIORIDADE_ALTA" | "PRIORIDADE" (+ prioridade: BAIXA|MEDIA|ALTA|URGENTE) | "REPACTUAR" | "COBRAR", tarefaIds: number[],
//           responsavelId?  (ATRIBUIR)
//           novoPrazo?, justificativa?  (REPACTUAR — uma justificativa para todas) }
//
// PERMISSÃO = a da porta individual de cada ação (G7):
//   ATRIBUIR / PRIORIDADE_ALTA / REPACTUAR → tarefas.editar
//   COBRAR                                  → tarefas.ver (não-admin só as próprias)
// Fora isso, gestor da Torre. Resposta item a item (207 quando houve mistura).
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { prioridadeValida } from '@/lib/operacional/torre-prioridade-lote'
import { exigirTorre } from '@/src/lib/torre-acesso'
import type { PermissaoChave } from '@/src/lib/permissoes'
import {
  validarIds, atribuirEmLote, prioridadeAltaEmLote, prioridadeEmLote, repactuarEmLote, cobrarCartorioEmLote,
} from '@/src/services/torre-acoes-lote'

const PERMISSAO: Record<string, PermissaoChave> = {
  ATRIBUIR: 'tarefas.editar', PRIORIDADE_ALTA: 'tarefas.editar', PRIORIDADE: 'tarefas.editar', REPACTUAR: 'tarefas.editar', COBRAR: 'tarefas.ver',
}

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => ({}))
  const acao = String(b?.acao ?? '')
  const permissao = PERMISSAO[acao]
  if (!permissao) return NextResponse.json({ error: `acao inválida; use uma de ${Object.keys(PERMISSAO).join(', ')}` }, { status: 400 })

  const { usuario, erro } = await exigirTorre(request, permissao)
  if (erro) return erro

  const ids = validarIds(b?.tarefaIds)
  if (!ids.ok) return NextResponse.json({ error: ids.erro }, { status: 400 })

  try {
    let r
    switch (acao) {
      case 'ATRIBUIR': {
        const responsavelId = Number(b?.responsavelId)
        if (!Number.isInteger(responsavelId) || responsavelId <= 0) return NextResponse.json({ error: 'responsavelId é obrigatório' }, { status: 400 })
        r = await atribuirEmLote({ tarefaIds: ids.ids, responsavelId, autorId: usuario.userId })
        break
      }
      case 'PRIORIDADE': {
        const prioridade = prioridadeValida(b?.prioridade)
        if (!prioridade) return NextResponse.json({ error: 'prioridade inválida; use BAIXA, MEDIA, ALTA ou URGENTE' }, { status: 400 })
        r = await prioridadeEmLote({ tarefaIds: ids.ids, prioridade, autorId: usuario.userId })
        break
      }
      case 'PRIORIDADE_ALTA':
        r = await prioridadeAltaEmLote({ tarefaIds: ids.ids, autorId: usuario.userId })
        break
      case 'REPACTUAR': {
        const justificativa = typeof b?.justificativa === 'string' ? b.justificativa.trim() : ''
        if (!justificativa) return NextResponse.json({ error: 'A justificativa é obrigatória (uma para todas as tarefas).' }, { status: 400 })
        const novoPrazo = b?.novoPrazo ? new Date(String(b.novoPrazo)) : null
        if (!novoPrazo || Number.isNaN(novoPrazo.getTime())) return NextResponse.json({ error: 'novoPrazo é obrigatório e deve ser uma data válida' }, { status: 400 })
        r = await repactuarEmLote({ tarefaIds: ids.ids, novoPrazo, justificativa, autorId: usuario.userId })
        break
      }
      default:
        r = await cobrarCartorioEmLote({ tarefaIds: ids.ids, autor: { userId: usuario.userId, tipo: usuario.tipo } })
    }
    return NextResponse.json(r, { status: r.falha > 0 && r.sucesso > 0 ? 207 : 200 })
  } catch (e) {
    console.error('[torre/tarefas/lote]', e)
    return NextResponse.json({ error: 'erro ao executar a ação em lote' }, { status: 500 })
  }
}
