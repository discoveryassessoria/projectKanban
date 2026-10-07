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
import { confirmacaoDoCorpo, pedirConfirmacao } from '@/src/lib/torre-confirmacao'
import {
  validarIds, atribuirEmLote, removerResponsavelEmLote, previaDeRemoverResponsavel, previaDeAtribuir, prioridadeAltaEmLote, prioridadeEmLote, repactuarEmLote, cobrarCartorioEmLote,
} from '@/src/services/torre-acoes-lote'

const PERMISSAO: Record<string, PermissaoChave> = {
  ATRIBUIR: 'tarefas.editar', REMOVER_RESPONSAVEL: 'tarefas.editar', PRIORIDADE_ALTA: 'tarefas.editar', PRIORIDADE: 'tarefas.editar', REPACTUAR: 'tarefas.editar', COBRAR: 'tarefas.ver',
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
        // CONFIRMAÇÃO EXPLÍCITA (L4): a lista de quem recebe o quê — 428 sem nada gravado; depois `confirmado` + a assinatura da prévia.
        const previa = await previaDeAtribuir(ids.ids, responsavelId)
        if (!previa) return NextResponse.json({ error: 'Nenhuma tarefa válida para atribuir (ou pessoa não encontrada).' }, { status: 422 })
        const { confirmado, assinatura } = confirmacaoDoCorpo(b)
        if (!confirmado || assinatura == null) return pedirConfirmacao(previa)
        if (assinatura !== previa.assinatura) return NextResponse.json({ error: 'As tarefas mudaram desde que você confirmou. Revise e confirme de novo.', code: 'SUGESTAO_MUDOU', confirmacao: previa }, { status: 409 })
        r = await atribuirEmLote({ tarefaIds: ids.ids, responsavelId, autorId: usuario.userId })
        break
      }
      case 'REMOVER_RESPONSAVEL': {
        // CONFIRMAÇÃO EXPLÍCITA com a lista (quem sai de quê): 1ª chamada devolve a prévia (428, nada gravado); a 2ª exige `confirmado` + a
        // assinatura da prévia. Tarefa já iniciada pede a 2ª confirmação (`confirmarAndamento`); o andamento é preservado.
        const previa = await previaDeRemoverResponsavel(ids.ids)
        if (!previa) return NextResponse.json({ error: 'Nenhuma das tarefas selecionadas tem responsável para remover.' }, { status: 422 })
        const { confirmado, assinatura } = confirmacaoDoCorpo(b)
        if (!confirmado || assinatura == null) return pedirConfirmacao(previa)
        if (assinatura !== previa.assinatura) return NextResponse.json({ error: 'As tarefas mudaram desde que você confirmou. Revise e confirme de novo.', code: 'SUGESTAO_MUDOU', confirmacao: previa }, { status: 409 })
        if (previa.exigeConfirmacaoDeAndamento && b?.confirmarAndamento !== true) return NextResponse.json({ error: 'Há tarefa já iniciada: confirme também que o andamento será preservado.', code: 'CONFIRMACAO_DE_ANDAMENTO', confirmacao: previa }, { status: 428 })
        const motivo = typeof b?.motivo === 'string' && b.motivo.trim() ? b.motivo.trim().slice(0, 300) : null
        r = await removerResponsavelEmLote({ tarefaIds: ids.ids, autorId: usuario.userId, motivo, confirmarAndamento: b?.confirmarAndamento === true })
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
