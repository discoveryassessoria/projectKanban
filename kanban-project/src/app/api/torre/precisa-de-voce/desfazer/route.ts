// src/app/api/torre/precisa-de-voce/desfazer/route.ts
// ============================================================================
// DESFAZER — Torre de Controle, "Precisa de você" (Bloco F, 29/09/2026; ampliado na Torre nova, 01/10/2026).
//
//   POST /api/torre/precisa-de-voce/desfazer
//   body: { tipo?: "ATRIBUICAO" | "DESBLOQUEIO" | "CANAL", tarefaIds?: number[], tarefaId?: number }
//
// A janela do Desfazer é UMA SÓ para a Torre (`lib/operacional/torre-desfazer.ts`, 24 h): só o AUTOR desfaz, só ação recente. Aqui só existe
// "desfazer ESTE fato" — e cada reversão lê o PRÓPRIO
// LogAuditoria do fato (nunca uma tabela paralela de "pendências de desfazer") e recusa se algo mudou depois: desfazer uma decisão já
// sobreposta por outra apagaria a mais recente.
//   ATRIBUICAO   (1 ou N tarefas) volta o responsável anterior (ou a fila);
//   DESBLOQUEIO  bloqueia de novo, com o motivo que a tarefa tinha;
//   CANAL        devolve à solicitação o canal anterior.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { desfazerAtribuicao, desfazerDesbloqueio, desfazerTrocaDeCanal } from '@/src/services/precisa-de-voce-acoes'
import { dentroDaJanelaDoDesfazer, JANELA_DO_DESFAZER_TEXTO } from '@/lib/operacional/torre-desfazer'
import { prisma } from '@/lib/prisma'

const FORA_DA_JANELA = `só se desfaz a ação recente, feita por você (até ${JANELA_DO_DESFAZER_TEXTO}) — passou o tempo do "Desfazer"`

/** A última ação do tipo sobre a tarefa foi feita por este autor DENTRO da janela única do Desfazer? */
async function recenteDoAutor(tarefaId: number, acoes: string[], autorId: number): Promise<boolean> {
  const log = await prisma.logAuditoria.findFirst({ where: { entidade: 'Tarefa', entidadeId: tarefaId, acao: { in: acoes } }, orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }], select: { usuarioId: true, criadoEm: true } })
  return !!log && log.usuarioId === autorId && dentroDaJanelaDoDesfazer(log.criadoEm)
}

export async function POST(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.editar')
  if (erro) return erro

  const b = await request.json().catch(() => ({}))
  const tipo = String(b?.tipo ?? 'ATRIBUICAO')

  if (tipo === 'DESBLOQUEIO' || tipo === 'CANAL') {
    const tarefaId = Number(b?.tarefaId)
    if (!Number.isInteger(tarefaId) || tarefaId <= 0) return NextResponse.json({ error: 'tarefaId é obrigatório' }, { status: 400 })
    if (!(await recenteDoAutor(tarefaId, tipo === 'DESBLOQUEIO' ? ['TAREFA_DESBLOQUEADA'] : ['SOLICITACAO_CANAL_ALTERADO'], usuario.userId))) {
      return NextResponse.json({ ok: false, erro: FORA_DA_JANELA }, { status: 422 })
    }
    const r = tipo === 'DESBLOQUEIO' ? await desfazerDesbloqueio(tarefaId, usuario.userId) : await desfazerTrocaDeCanal(tarefaId, usuario.userId)
    return NextResponse.json(r, { status: r.ok ? 200 : 422 })
  }
  if (tipo !== 'ATRIBUICAO') return NextResponse.json({ error: 'tipo inválido; use ATRIBUICAO, DESBLOQUEIO ou CANAL' }, { status: 400 })

  const tarefaIds = Array.isArray(b?.tarefaIds) ? b.tarefaIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : []
  if (tarefaIds.length === 0) return NextResponse.json({ error: 'tarefaIds é obrigatório' }, { status: 400 })
  if (tarefaIds.length > 500) return NextResponse.json({ error: 'lote acima de 500 tarefas' }, { status: 400 })

  const recentes: number[] = []
  const recusadas: Array<{ tarefaId: number; ok: false; mensagem: string }> = []
  for (const id of [...new Set<number>(tarefaIds)]) {
    if (await recenteDoAutor(id, ['TAREFA_ATRIBUIDA', 'TAREFA_TRANSFERIDA'], usuario.userId)) recentes.push(id)
    else recusadas.push({ tarefaId: id, ok: false, mensagem: FORA_DA_JANELA })
  }
  const feito = recentes.length ? await desfazerAtribuicao(recentes, usuario.userId) : { total: 0, desfeitas: 0, itens: [] }
  const r = { total: feito.total + recusadas.length, desfeitas: feito.desfeitas, itens: [...feito.itens, ...recusadas] }
  return NextResponse.json(r, { status: r.desfeitas < r.total ? 207 : 200 })
}
