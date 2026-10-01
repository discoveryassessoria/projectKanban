// src/app/api/torre/tarefas/canceladas/route.ts
// ============================================================================
// TORRE — AS CERTIDÕES CANCELADAS (Torre nova, aba Tarefas, 01/10/2026).
//
//   GET /api/torre/tarefas/canceladas[?pais=&processoId=]
//
// "Cancelar nunca esconde, só marca": a certidão CANCELADA continua visível na aba Tarefas — riscada, no fim do grupo da família,
// com o botão "Ver motivo". Ela NÃO é trabalho: não entra em contador, em visão de trabalho, em seleção nem em lote (a rota
// principal `GET /api/torre/tarefas` segue sem ela). Esta rota é a MESMA fonte das linhas (`listarTarefasDaTorre`, só que com o
// status CANCELADA), mais — por linha — quem cancelou, quando e por quê, lidos do LogAuditoria `TAREFA_CANCELADA` da própria
// tarefa (a auditoria da porta canônica de cancelamento e do reconciliador da árvore). Em lote: 2 consultas, sem N+1.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { listarTarefasDaTorre } from '@/src/services/torre-tarefas'
import { lerMotivoComposto } from '@/lib/operacional/historico-processo'
import { rotuloDoMomento } from '@/lib/operacional/historico-filtros'

type J = Record<string, unknown> | null
const asJ = (v: unknown): J => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export interface EncerramentoDaTarefa {
  /** ISO do cancelamento; `null` = nenhuma fonte guardou o instante. */
  quando: string | null
  /** "hoje 12:15" / "ontem 18:00" / "29/09 18:00" — montado no servidor. */
  quandoRotulo: string | null
  /** Quem decidiu; `null` = o Sistema (reconciliador da árvore) ou ninguém registrado. */
  porNome: string | null
  motivo: string | null
}

export async function GET(request: NextRequest) {
  const { erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const sp = request.nextUrl.searchParams
  const filtros: Parameters<typeof listarTarefasDaTorre>[0] = { status: ['CANCELADA'], incluirEncerradas: true }
  if (sp.get('pais')) filtros.pais = sp.get('pais')
  const processoId = Number(sp.get('processoId') ?? sp.get('processo'))
  if (Number.isInteger(processoId) && processoId > 0) filtros.processoId = processoId

  const agora = new Date()
  const { linhas } = await listarTarefasDaTorre(filtros, agora)
  const canceladas = linhas.filter((l) => l.statusTarefa === 'CANCELADA')
  const ids = canceladas.map((l) => l.taskId)

  const logs = ids.length
    ? await prisma.logAuditoria.findMany({
        where: { entidade: { in: ['Tarefa', 'TAREFA'] }, entidadeId: { in: ids }, acao: 'TAREFA_CANCELADA' },
        orderBy: { id: 'desc' }, select: { entidadeId: true, detalhes: true, usuarioId: true, criadoEm: true, descricao: true },
      })
    : []
  const autorIds = [...new Set(logs.map((l) => l.usuarioId).filter((x): x is number => x != null))]
  const nomes = new Map((autorIds.length ? await prisma.usuario.findMany({ where: { id: { in: autorIds } }, select: { id: true, nome: true } }) : []).map((u) => [u.id, u.nome]))
  const porTarefa = new Map<number, (typeof logs)[number]>()
  for (const l of logs) if (l.entidadeId != null && !porTarefa.has(l.entidadeId)) porTarefa.set(l.entidadeId, l) // desc: a mais recente

  const saida = canceladas.map((l) => {
    const log = porTarefa.get(l.taskId)
    const det = asJ(log?.detalhes)
    // O motivo: o detalhado do reconciliador ("necessidade removida pela árvore: …"), senão o composto da porta humana
    // ("Motivo: … · Justificativa: …"), senão a descrição legível da própria auditoria.
    const bruto = txt(det?.motivoDetalhado) ?? txt(det?.motivo)
    const composto = lerMotivoComposto(bruto)
    const motivo = bruto === 'CAUSA_REMOVIDA' || !bruto ? txt(log?.descricao) : [composto.motivo, composto.justificativa].filter(Boolean).join(' · ') || bruto
    const encerramento: EncerramentoDaTarefa = {
      quando: log?.criadoEm.toISOString() ?? null,
      quandoRotulo: log ? rotuloDoMomento(log.criadoEm.toISOString(), agora).replace(', ', ' ') : null,
      porNome: log?.usuarioId != null ? nomes.get(log.usuarioId) ?? null : null,
      motivo: motivo ? motivo.replace(/^necessidade removida pela árvore:\s*/i, 'Documento não necessário — ') : null,
    }
    return { ...l, encerramento }
  })
  return NextResponse.json({ linhas: saida, total: saida.length })
}
