// src/services/torre-canceladas.ts
// ============================================================================
// AS TAREFAS CANCELADAS DA TORRE — UMA consulta para TODOS (consolidação, 06/10/2026, L3).
// A aba Tarefas ("+ N canceladas / não exigidas"), a página do processo (card "Cancelada / não exigida") e o Foco leem ESTA função: o número que
// qualquer tela mostra é o tamanho desta lista, nunca outra consulta. Cada linha traz quem cancelou, quando e por quê (LogAuditoria TAREFA_CANCELADA).
// ============================================================================
import { apresentarCodigos } from '@/lib/operacional/motivos-legiveis'
import { prisma } from '@/lib/prisma'
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


export async function listarCanceladasDaTorre(args: { pais?: string | null; processoId?: number | null } = {}, agora: Date = new Date()) {
  const filtros: Parameters<typeof listarTarefasDaTorre>[0] = { status: ['CANCELADA'], incluirEncerradas: true }
  if (args.pais) filtros.pais = args.pais
  if (args.processoId != null && Number.isInteger(args.processoId) && args.processoId > 0) filtros.processoId = args.processoId
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
      motivo: motivo ? apresentarCodigos(motivo.replace(/^necessidade removida pela árvore:\s*/i, 'Documento não necessário — ')) : null,
    }
    return { ...l, encerramento }
  })
  return saida
}
