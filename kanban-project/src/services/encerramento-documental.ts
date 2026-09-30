// src/services/encerramento-documental.ts
// ============================================================================
// POR QUE A CERTIDÃO SAIU DO TRABALHO — quem, quando, motivo. (Cancelar NUNCA esconde, só marca.)
//
// Um Documento fora do jogo tem dois estados que NÃO se misturam (CLAUDE.md §37, `status-inativos.ts`):
//   CANCELADO    decisão HUMANA sobre o papel → quem/quando/motivo vêm do LogAuditoria `TAREFA_CANCELADA`
//                (detalhes.motivo: "Motivo: … · Justificativa: …") e, na falta, de Documento.motivoBloqueio /
//                ultimaMovimentacao;
//   NAO_EXIGIDO  a ÁRVORE deixou de exigir → quem/quando/motivo vêm de `NECESSIDADE_REMOVIDA_PELA_ARVORE`
//                (detalhes.motivo: "necessidade removida pela árvore: <o que mudou>") ou `DOCUMENTO_ORFAO_NAO_EXIGIDO`;
//                a árvore é quem decide — por isso não há "Reabrir" (a linha diz por quê).
// Nenhuma fonte nova: é leitura, em lote (sem N+1), das que já existem. A MESMA função alimenta a Central
// Operacional do processo e a aba Documentos.
// ============================================================================
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { lerMotivoComposto } from '@/lib/operacional/historico-processo'
import { rotuloDoMomento } from '@/lib/operacional/historico-filtros'
import { documentoAtivo } from '@/src/lib/documentos/status-inativos'
import type { EncerramentoDoDocumento } from '@/src/lib/process-stage/estrutura-operacional-core'

const PREFIXO_ARVORE = /^necessidade removida pela árvore:\s*/i

/** Por que a árvore não exige — sem o prefixo técnico do motivo gravado. */
export const motivoDaArvore = (bruto: string | null | undefined): string | null => {
  const t = (bruto ?? '').replace(PREFIXO_ARVORE, '').trim()
  return t || null
}

type J = Record<string, unknown> | null
const asJ = (v: unknown): J => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export const OBSERVACAO_NAO_EXIGIDA = 'A árvore genealógica decide se a certidão é exigida: se a exigência voltar, este mesmo registro é reativado. Não há "Reabrir" — corrija a árvore.'

export async function encerramentosDosDocumentos(documentoIds: number[], db: PrismaClient | Prisma.TransactionClient | typeof prisma = prisma, agora: Date = new Date()): Promise<Map<number, EncerramentoDoDocumento>> {
  const rotuloQuando = (d: Date | null | undefined) => (d ? rotuloDoMomento(d.toISOString(), agora).replace(', ', ' ') : null)
  const saida = new Map<number, EncerramentoDoDocumento>()
  const ids = [...new Set(documentoIds)]
  if (ids.length === 0) return saida

  const documentos = await db.documento.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, necessidadeId: true, motivoBloqueio: true, ultimaMovimentacao: true } })
  const inativos = documentos.filter((d) => !documentoAtivo(d.status))
  if (inativos.length === 0) return saida
  const docIds = inativos.map((d) => d.id)
  const necIds = [...new Set(inativos.map((d) => d.necessidadeId).filter((x): x is number => x != null))]

  const [tarefas, logsArvore, logsOrfao, eventosNec] = await Promise.all([
    db.tarefa.findMany({ where: { documentoId: { in: docIds } }, select: { id: true, documentoId: true, statusTarefa: true }, orderBy: { id: 'desc' } }),
    necIds.length
      ? db.logAuditoria.findMany({ where: { entidade: 'NecessidadeDocumental', entidadeId: { in: necIds }, acao: 'NECESSIDADE_REMOVIDA_PELA_ARVORE' }, orderBy: { id: 'desc' }, select: { entidadeId: true, detalhes: true, usuarioId: true, criadoEm: true } })
      : Promise.resolve([]),
    db.logAuditoria.findMany({ where: { entidade: 'Documento', entidadeId: { in: docIds }, acao: 'DOCUMENTO_ORFAO_NAO_EXIGIDO' }, orderBy: { id: 'desc' }, select: { entidadeId: true, descricao: true, usuarioId: true, criadoEm: true } }),
    necIds.length
      ? db.necessidadeDocumentalEvento.findMany({ where: { necessidadeId: { in: necIds }, tipo: 'DISPENSADA' }, orderBy: { id: 'desc' }, select: { necessidadeId: true, dados: true, criadoEm: true } })
      : Promise.resolve([]),
  ])
  const tarefaIds = tarefas.map((t) => t.id)
  const logsCancel = tarefaIds.length
    ? await db.logAuditoria.findMany({ where: { entidade: { in: ['Tarefa', 'TAREFA'] }, entidadeId: { in: tarefaIds }, acao: 'TAREFA_CANCELADA' }, orderBy: { id: 'desc' }, select: { entidadeId: true, detalhes: true, usuarioId: true, criadoEm: true } })
    : []
  const autorIds = [...new Set([...logsCancel.map((l) => l.usuarioId), ...logsArvore.map((l) => l.usuarioId), ...logsOrfao.map((l) => l.usuarioId)].filter((x): x is number => x != null))]
  const nomes = new Map((autorIds.length ? await db.usuario.findMany({ where: { id: { in: autorIds } }, select: { id: true, nome: true } }) : []).map((u) => [u.id, u.nome]))

  const tarefaDoDoc = new Map<number, (typeof tarefas)[number]>()     // a mais recente (lista já vem desc)
  for (const t of tarefas) if (t.documentoId != null && !tarefaDoDoc.has(t.documentoId)) tarefaDoDoc.set(t.documentoId, t)

  for (const d of inativos) {
    if (String(d.status) === 'NAO_EXIGIDO') {
      const la = logsArvore.find((l) => l.entidadeId === d.necessidadeId && (asJ(l.detalhes)?.documentoIds as unknown[] | undefined)?.includes(d.id) !== false)
      const lo = logsOrfao.find((l) => l.entidadeId === d.id)
      const ev = eventosNec.find((e) => e.necessidadeId === d.necessidadeId)
      const fonte = la ?? lo
      const motivo = la ? motivoDaArvore(txt(asJ(la.detalhes)?.motivo)) : lo ? 'o documento não tem necessidade ativa na árvore' : motivoDaArvore(txt(asJ(ev?.dados)?.motivo)) ?? motivoDaArvore(d.motivoBloqueio)
      const autor = fonte?.usuarioId ?? null
      saida.set(d.id, {
        tipo: 'NAO_EXIGIDA', quando: (fonte?.criadoEm ?? ev?.criadoEm ?? d.ultimaMovimentacao)?.toISOString() ?? null, quandoRotulo: rotuloQuando(fonte?.criadoEm ?? ev?.criadoEm ?? d.ultimaMovimentacao),
        porId: autor, porNome: autor != null ? nomes.get(autor) ?? null : null, motivo, justificativa: null,
        tarefaReabrivelId: null, observacao: OBSERVACAO_NAO_EXIGIDA,
      })
      continue
    }
    // CANCELADO — decisão humana sobre o papel.
    const tarefa = tarefaDoDoc.get(d.id)
    const tarefasDoDoc = tarefas.filter((t) => t.documentoId === d.id).map((t) => t.id)
    const log = logsCancel.find((l) => l.entidadeId != null && tarefasDoDoc.includes(l.entidadeId))
    const det = asJ(log?.detalhes)
    const composto = lerMotivoComposto(txt(det?.motivo) ?? txt(d.motivoBloqueio))
    const autor = log?.usuarioId ?? null
    saida.set(d.id, {
      tipo: 'CANCELADA', quando: (log?.criadoEm ?? d.ultimaMovimentacao)?.toISOString() ?? null, quandoRotulo: rotuloQuando(log?.criadoEm ?? d.ultimaMovimentacao),
      porId: autor, porNome: autor != null ? nomes.get(autor) ?? null : null,
      motivo: composto.motivo, justificativa: composto.justificativa,
      // Só cancelamento HUMANO de uma tarefa que continua CANCELADA pode ser reaberto pela porta canônica (`reabrir`).
      tarefaReabrivelId: autor != null && tarefa?.statusTarefa === 'CANCELADA' ? tarefa.id : null,
      observacao: null,
    })
  }
  return saida
}
