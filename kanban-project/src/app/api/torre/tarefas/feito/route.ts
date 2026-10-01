// src/app/api/torre/tarefas/feito/route.ts
// ============================================================================
// TORRE — A VISÃO "FEITO" (Torre nova, aba Tarefas, 01/10/2026).
//
//   GET /api/torre/tarefas/feito[?pais=]
//
// Concluídas dos últimos 14 dias, de TODA a equipe: a MESMA leitura da aba Feito da Operação (`concluidasRecentesDoUsuario`,
// escopo de equipe) + o que o protótipo mostra e a linha não traz — QUEM concluiu (o autor do LogAuditoria da conclusão; sem
// registro, `null` → "—": nunca o responsável por suposição). Uma consulta em lote, sem N+1.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { concluidasRecentesDoUsuario } from '@/lib/operacional/tarefa-projecoes'

const ACOES_DE_CONCLUSAO = ['TAREFA_CONCLUIDA', 'TAREFA_ETAPA_CONCLUIDA_E_TAREFA_CONCLUIDA']

export async function GET(request: NextRequest) {
  const { erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const pais = request.nextUrl.searchParams.get('pais')
  const agora = new Date()
  const linhas = await concluidasRecentesDoUsuario(null, agora, 14, undefined, pais ? { pais } : {})
  const ids = linhas.map((l) => l.taskId)
  const logs = ids.length
    ? await prisma.logAuditoria.findMany({
        where: { entidade: { in: ['Tarefa', 'TAREFA'] }, entidadeId: { in: ids }, acao: { in: ACOES_DE_CONCLUSAO } },
        orderBy: { id: 'desc' }, select: { entidadeId: true, usuarioId: true },
      })
    : []
  const autorPorTarefa = new Map<number, number | null>()
  for (const l of logs) if (l.entidadeId != null && !autorPorTarefa.has(l.entidadeId)) autorPorTarefa.set(l.entidadeId, l.usuarioId)
  const autorIds = [...new Set([...autorPorTarefa.values()].filter((x): x is number => x != null))]
  const nomes = new Map((autorIds.length ? await prisma.usuario.findMany({ where: { id: { in: autorIds } }, select: { id: true, nome: true } }) : []).map((u) => [u.id, u.nome]))
  return NextResponse.json({
    total: linhas.length,
    linhas: linhas.map((l) => {
      const autor = autorPorTarefa.get(l.taskId) ?? null
      return { ...l, concluidaPorNome: autor != null ? nomes.get(autor) ?? null : null }
    }),
  })
}
