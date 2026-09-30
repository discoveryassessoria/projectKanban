// lib/operacional/torre-auditoria.ts
// ============================================================================
// ABA AUDITORIA DA TORRE — Bloco I2 (30/09/2026).
//
// FONTE ÚNICA: `LogAuditoria` (o que o sistema grava DE VERDADE), recortado em
// entidades de PROCESSO e TAREFA. Nenhuma tabela nova, nenhuma linha inventada.
//
// Paginação no servidor (nunca carrega tudo); a exportação CSV usa o MESMO filtro.
// O "alvo" é resolvido em lote para a página (uma consulta por tipo, nunca N+1).
// ============================================================================
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export interface FiltroDeAuditoria {
  /** ISO ou yyyy-mm-dd, inclusive. */
  de?: string | null
  ate?: string | null
  autorId?: number | null
  processoId?: number | null
  /** Só ações cujo código contém este texto (ex.: "PRAZO"). */
  acao?: string | null
}

export interface LinhaDeAuditoria {
  id: number
  quando: string
  autor: string
  acao: string
  alvo: string
  /** A justificativa GRAVADA (`motivo`/`justificativa` do detalhe) — `null` quando a ação não a tinha. */
  justificativa: string | null
  descricao: string
}

/** Os filtros da query string — a MESMA leitura para a tela e para o CSV. */
export function filtroDaQuery(sp: URLSearchParams): FiltroDeAuditoria {
  const n = (k: string) => { const v = sp.get(k); return v && Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null }
  return { de: sp.get('de'), ate: sp.get('ate'), autorId: n('autorId'), processoId: n('processoId'), acao: sp.get('acao') }
}

export const ENTIDADES_DA_AUDITORIA = ['Tarefa', 'Processo'] as const
export const LIMITE_DO_CSV = 20_000

function inicioDoDia(s: string): Date | null {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00-03:00`) : new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}
function fimDoDia(s: string): Date | null {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T23:59:59.999-03:00`) : new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function whereDaAuditoria(f: FiltroDeAuditoria): Promise<Prisma.LogAuditoriaWhereInput> {
  const e: Prisma.LogAuditoriaWhereInput[] = []
  if (f.processoId != null) {
    const tarefaIds = (await prisma.tarefa.findMany({ where: { processoId: f.processoId }, select: { id: true } })).map((t) => t.id)
    e.push({ OR: [{ entidade: 'Tarefa', entidadeId: { in: tarefaIds } }, { entidade: 'Processo', entidadeId: f.processoId }] })
  } else {
    e.push({ entidade: { in: [...ENTIDADES_DA_AUDITORIA] } })
  }
  const de = f.de ? inicioDoDia(f.de) : null
  const ate = f.ate ? fimDoDia(f.ate) : null
  if (de || ate) e.push({ criadoEm: { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) } })
  if (f.autorId != null) e.push({ usuarioId: f.autorId })
  if (f.acao?.trim()) e.push({ acao: { contains: f.acao.trim().toUpperCase() } })
  return { AND: e }
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

async function montar(linhas: Array<{ id: number; acao: string; entidade: string; entidadeId: number | null; descricao: string; detalhes: unknown; criadoEm: Date; usuario: { nome: string } | null }>): Promise<LinhaDeAuditoria[]> {
  const tarefaIds = [...new Set(linhas.filter((l) => l.entidade === 'Tarefa' && (l.entidadeId ?? 0) > 0).map((l) => l.entidadeId as number))]
  const processoIds = [...new Set(linhas.filter((l) => l.entidade === 'Processo' && (l.entidadeId ?? 0) > 0).map((l) => l.entidadeId as number))]
  const [tarefas, procs] = await Promise.all([
    tarefaIds.length ? prisma.tarefa.findMany({ where: { id: { in: tarefaIds } }, select: { id: true, titulo: true, processo: { select: { nome: true } } } }) : Promise.resolve([]),
    processoIds.length ? prisma.processo.findMany({ where: { id: { in: processoIds } }, select: { id: true, nome: true } }) : Promise.resolve([]),
  ])
  const tarefaPorId = new Map(tarefas.map((t) => [t.id, t]))
  const procPorId = new Map(procs.map((p) => [p.id, p]))
  return linhas.map((l) => {
    const d = (l.detalhes ?? {}) as Record<string, unknown>
    let alvo: string
    if (l.entidade === 'Tarefa') {
      const t = l.entidadeId ? tarefaPorId.get(l.entidadeId) : null
      alvo = !l.entidadeId ? 'Tarefas (lote)' : t ? `Tarefa #${t.id} · ${t.titulo}${t.processo ? ` · ${t.processo.nome}` : ''}` : `Tarefa #${l.entidadeId} (removida)`
    } else {
      const p = l.entidadeId ? procPorId.get(l.entidadeId) : null
      alvo = p ? `Processo #${p.id} · ${p.nome}` : `Processo #${l.entidadeId ?? '—'}`
    }
    return {
      id: l.id, quando: l.criadoEm.toISOString(), autor: l.usuario?.nome ?? 'Sistema', acao: l.acao, alvo,
      justificativa: texto(d.motivo) ?? texto(d.justificativa), descricao: l.descricao,
    }
  })
}

const SELECT = { id: true, acao: true, entidade: true, entidadeId: true, descricao: true, detalhes: true, criadoEm: true, usuario: { select: { nome: true } } } as const

export async function consultarAuditoria(f: FiltroDeAuditoria, pagina = 1, porPagina = 50): Promise<{ itens: LinhaDeAuditoria[]; total: number; pagina: number; porPagina: number }> {
  const where = await whereDaAuditoria(f)
  const tamanho = Math.min(Math.max(Math.trunc(porPagina) || 50, 1), 200)
  const p = Math.max(Math.trunc(pagina) || 1, 1)
  const [total, linhas] = await Promise.all([
    prisma.logAuditoria.count({ where }),
    prisma.logAuditoria.findMany({ where, orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }], skip: (p - 1) * tamanho, take: tamanho, select: SELECT }),
  ])
  return { itens: await montar(linhas), total, pagina: p, porPagina: tamanho }
}

/** Proteção de planilha: célula que começa com = + - @ vira fórmula no Excel. */
function celula(v: string | null | undefined): string {
  let s = (v ?? '').replace(/\r?\n/g, ' ').trim()
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

/** O CSV do que está filtrado — separador `;` e BOM (Excel em pt-BR). Trunca em `LIMITE_DO_CSV` e diz. */
export async function csvDaAuditoria(f: FiltroDeAuditoria): Promise<{ csv: string; linhas: number; total: number; truncado: boolean }> {
  const where = await whereDaAuditoria(f)
  const [total, brutas] = await Promise.all([
    prisma.logAuditoria.count({ where }),
    prisma.logAuditoria.findMany({ where, orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }], take: LIMITE_DO_CSV, select: SELECT }),
  ])
  const linhas = await montar(brutas)
  const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const corpo = [
    ['Quando', 'Autor', 'Ação', 'Alvo', 'Justificativa', 'Descrição'].map(celula).join(';'),
    ...linhas.map((l) => [fmt(l.quando), l.autor, l.acao, l.alvo, l.justificativa, l.descricao].map(celula).join(';')),
  ].join('\r\n')
  return { csv: `﻿${corpo}\r\n`, linhas: linhas.length, total, truncado: total > linhas.length }
}
