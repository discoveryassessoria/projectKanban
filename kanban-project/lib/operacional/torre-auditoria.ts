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
  /** SISTEMA (padrão) · PROCESSO_TAREFA · TODOS — ver `NATUREZA_DA_ACAO`. */
  natureza?: FiltroDeNatureza | null
}

// ─── SISTEMA × PROCESSO/TAREFA — UM mapa único, por `acao` (01/10/2026) ─────────────────────────────────────────────
// A Auditoria mora em Gerenciamento › Saúde do sistema e mostra, por padrão, fatos de SISTEMA. Fatos de processo/tarefa
// vão ao Histórico do processo. Uma `acao` é de SISTEMA se estiver em `ACOES_DE_SISTEMA`; é de PROCESSO/TAREFA se a
// entidade for Tarefa/Processo e a `acao` NÃO estiver nessa lista (a lista vence: `processo_excluido_definitivo` é de
// entidade Processo mas é fato de sistema). Toda `acao` gravada pelo código da Torre tem que estar aqui (o teste confere).
export type NaturezaDaAuditoria = 'SISTEMA' | 'PROCESSO_TAREFA'
export type FiltroDeNatureza = 'SISTEMA' | 'PROCESSO_TAREFA' | 'TODOS'
export const ACOES_DE_SISTEMA: readonly string[] = [
  // regras da Torre · visões · exportação · saúde/diagnóstico
  'REGRA_TORRE_ATIVADA', 'REGRA_TORRE_DESATIVADA', 'REGRA_TORRE_EXECUTADA', 'REGRA_TORRE_SIMULADA',
  'VISAO_TORRE_SALVA', 'VISAO_TORRE_REMOVIDA', 'VISAO_COMPARTILHADA', 'VISAO_DESCOMPARTILHADA',
  'AUDITORIA_EXPORTADA', 'SAUDE_ACHADO_IGNORADO', 'SAUDE_INCIDENTE', 'CORRECAO_AUTOMATICA', 'CORRECAO_AUTOMATICA_FALHOU',
  // exclusão de processo e manutenção de dados em lote
  'processo_excluido_definitivo',
  'BACKFILL_PASSOS_PUBLICADOS', 'BACKFILL_REMOVE_PASSO_SEM_VINCULO', 'BACKFILL_SOLICITACAO_DOCUMENTO', 'BACKFILL_PHASEKEY_CATALOGO',
  'ACOMPANHAMENTO_A_INICIAR_BACKFILL', 'REPARO_MANUAL', 'PROC005_REMEDIACAO_MANUAL',
]
export const NATUREZA_DA_ACAO = (acao: string, entidade: string): NaturezaDaAuditoria | null =>
  ACOES_DE_SISTEMA.includes(acao) ? 'SISTEMA' : (ENTIDADES_DA_AUDITORIA as readonly string[]).includes(entidade) ? 'PROCESSO_TAREFA' : null

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
  const nat = (sp.get('natureza') ?? '').toUpperCase()
  const natureza: FiltroDeNatureza = nat === 'PROCESSO_TAREFA' || nat === 'TODOS' ? nat : 'SISTEMA'
  return { de: sp.get('de'), ate: sp.get('ate'), autorId: n('autorId'), processoId: n('processoId'), acao: sp.get('acao'), natureza }
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
  const natureza = f.natureza ?? 'SISTEMA'
  const sistema: Prisma.LogAuditoriaWhereInput = { acao: { in: [...ACOES_DE_SISTEMA] } }
  const deProcessoTarefa: Prisma.LogAuditoriaWhereInput = { entidade: { in: [...ENTIDADES_DA_AUDITORIA] }, acao: { notIn: [...ACOES_DE_SISTEMA] } }
  e.push(natureza === 'SISTEMA' ? sistema : natureza === 'PROCESSO_TAREFA' ? deProcessoTarefa : { OR: [sistema, deProcessoTarefa] })
  if (f.processoId != null) {
    const tarefaIds = (await prisma.tarefa.findMany({ where: { processoId: f.processoId }, select: { id: true } })).map((t) => t.id)
    e.push({ OR: [{ entidade: 'Tarefa', entidadeId: { in: tarefaIds } }, { entidade: 'Processo', entidadeId: f.processoId }] })
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
    } else if (l.entidade === 'Processo') {
      const p = l.entidadeId ? procPorId.get(l.entidadeId) : null
      alvo = p ? `Processo #${p.id} · ${p.nome}` : `Processo #${l.entidadeId ?? '—'}${l.acao === 'processo_excluido_definitivo' ? ' (excluído)' : ''}`
    } else {
      alvo = `${l.entidade}${l.entidadeId ? ` #${l.entidadeId}` : ''}`
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
