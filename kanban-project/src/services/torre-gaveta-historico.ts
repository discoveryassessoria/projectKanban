// src/services/torre-gaveta-historico.ts
// ============================================================================
// HISTÓRICO DA GAVETA DA TAREFA, LEGÍVEL (Torre nova, 01/10/2026).
//
// A linha do tempo vem do dossiê da tarefa (`dossieDaTarefa`, a mesma do drawer documental). O texto gravado na auditoria
// fala "usuário 7", "equipe_documental" e "SLA 5d"; aqui ele é TRADUZIDO NA EXIBIÇÃO (nada é regravado):
// `apresentarTextoDoHistorico` + `humanizarEstadosNoTexto`. Os nomes são resolvidos em LOTE: uma consulta de LogAuditoria
// (autor) e UMA de Usuario para os autores E para os ids citados nos textos — não cresce com o número de linhas.
// ============================================================================
import { prisma } from '@/lib/prisma'
import type { dossieDaTarefa } from '@/lib/operacional/tarefa-projecoes'
import { rotuloDoMomento } from '@/lib/operacional/historico-filtros'
import { apresentarTextoDoHistorico, idsDeUsuarioNoTexto } from '@/lib/operacional/historico-apresentacao'
import { humanizarEstadosNoTexto } from '@/src/lib/home/rotulo-status-tarefa'

export const LIMITE_DO_HISTORICO_DA_GAVETA = 12

type Dossie = NonNullable<Awaited<ReturnType<typeof dossieDaTarefa>>>
export interface FatoDaGaveta { em: string; quando: string; texto: string; autor: string | null }

export async function historicoDaGaveta(d: Pick<Dossie, 'historico' | 'timeline'>, agora: Date, db: Pick<typeof prisma, 'logAuditoria' | 'usuario'> = prisma): Promise<FatoDaGaveta[]> {
  const recorte = d.timeline.slice(0, LIMITE_DO_HISTORICO_DA_GAVETA)

  // Quem fez cada fato da auditoria da tarefa (o `montarTimeline` não carrega o autor desse tipo): uma consulta em lote.
  const ids = d.historico.map((h) => h.id)
  const logs = ids.length ? await db.logAuditoria.findMany({ where: { id: { in: ids } }, select: { id: true, usuarioId: true } }) : []
  const idsCitados = new Set<number>(recorte.flatMap((f) => idsDeUsuarioNoTexto(f.texto)))
  for (const l of logs) if (l.usuarioId != null) idsCitados.add(l.usuarioId)
  const nomes = new Map<number, string>(
    (idsCitados.size ? await db.usuario.findMany({ where: { id: { in: [...idsCitados] } }, select: { id: true, nome: true } }) : []).map((u) => [u.id, u.nome]),
  )
  const autores = new Map<number, string | null>(logs.map((l) => [l.id, l.usuarioId != null ? nomes.get(l.usuarioId) ?? null : null]))
  const autorPorEmETexto = new Map<string, string | null>()
  for (const h of d.historico) autorPorEmETexto.set(`${h.criadoEm.toISOString()}|${h.descricao ?? h.acao}`, autores.get(h.id) ?? null)

  return recorte.map((f) => ({
    em: f.em,
    quando: rotuloDoMomento(f.em, agora).replace(', ', ' '),
    texto: apresentarTextoDoHistorico(humanizarEstadosNoTexto(f.texto), nomes),
    autor: f.autor ?? autorPorEmETexto.get(`${f.em}|${f.texto}`) ?? null,
  }))
}
