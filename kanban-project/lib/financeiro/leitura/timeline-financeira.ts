// lib/financeiro/leitura/timeline-financeira.ts
// ============================================================================
// TIMELINE FINANCEIRA SEPARADA (Motor Financeiro V3 · leitura).
// Duas fontes com escopos ESTRITAMENTE disjuntos — NUNCA se misturam:
//
//   • timelineGeralReceita(ref)  → eventos de NEGÓCIO no nível da Receita
//     CONSOLIDADA (criação, edição, redistribuição, cancelamento, arquivamento).
//     Origem: OcorrenciaFinanceira (tipos globais) + LogAuditoria + DomainOutbox
//     do GRUPO. SEM eventos individuais de pagamento por participante.
//
//   • timelineIndividualParticipante(obrigacaoId) → eventos SÓ daquela obrigação-
//     participante (pagamentos, estornos, cobranças enviadas, vencimentos). NUNCA
//     eventos globais.
//
// A classificação por escopo (global × individual) é a garantia estrutural da
// separação: cada função filtra a sua fatia; um tipo nunca cai nas duas.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { descobrirGrupoObrigacoes } from './receita-detalhe'

// Ocorrências de NEGÓCIO (nível Receita/grupo). O restante (PAGAMENTO, ESTORNO,
// DESCONTO, JUROS, MULTA, CREDITO, REEMBOLSO, BAIXA, DIFERENCA_CAMBIAL,
// RENEGOCIACAO...) é INDIVIDUAL por definição.
const TIPOS_GLOBAIS = ['OBRIGACAO_CRIADA', 'AJUSTE', 'CANCELAMENTO', 'ARQUIVAMENTO'] as const

// Palavras que caracterizam evento INDIVIDUAL — usadas para NUNCA deixar um
// evento de pagamento/cobrança vazar para a timeline geral (LogAuditoria/Outbox).
const INDIVIDUAL_RE = /pagament|estorn|cobranc|cobrança|venciment|parcela|recebiment|baixa/i

const TITULO_OC: Record<string, string> = {
  OBRIGACAO_CRIADA: 'Receita criada', AJUSTE: 'Redistribuição/ajuste', CANCELAMENTO: 'Cancelamento', ARQUIVAMENTO: 'Arquivamento',
  PAGAMENTO: 'Pagamento recebido', PAGAMENTO_PARCIAL: 'Pagamento recebido', ESTORNO: 'Estorno',
  DESCONTO: 'Desconto', JUROS: 'Juros', MULTA: 'Multa', CREDITO: 'Crédito', REEMBOLSO: 'Reembolso',
  BAIXA: 'Baixa', RENEGOCIACAO: 'Renegociação', DIFERENCA_CAMBIAL: 'Diferença cambial',
}

export interface EventoTimeline {
  id: string
  escopo: 'GERAL' | 'INDIVIDUAL'
  data: string
  tipo: string
  titulo: string
  descricao: string
  fonte: 'OcorrenciaFinanceira' | 'LogAuditoria' | 'DomainOutbox' | 'Cobranca' | 'Parcela'
  obrigacaoId: number | null
  ator: string | null
}

async function nomesUsuarios(ids: (number | null | undefined)[]): Promise<Map<number, string>> {
  const uniq = [...new Set(ids.filter((v): v is number => v != null))]
  if (!uniq.length) return new Map()
  const us = await prisma.usuario.findMany({ where: { id: { in: uniq } }, select: { id: true, nome: true } }).catch(() => [])
  return new Map(us.map((u) => [u.id, u.nome]))
}

// ── TIMELINE GERAL (Receita consolidada) — só eventos de NEGÓCIO do grupo ──
export async function timelineGeralReceita(refConsolidada: string): Promise<EventoTimeline[]> {
  const grupo = await descobrirGrupoObrigacoes(refConsolidada)
  if (!grupo) return []

  // Obrigações do grupo — inclui canceladas (via receitaIds) p/ mostrar cancelamento/arquivamento.
  const obrByReceita = grupo.receitaIds.length
    ? await prisma.obrigacaoEconomica.findMany({ where: { origemTipo: 'Receita', origemId: { in: grupo.receitaIds } }, select: { id: true } }).catch(() => [])
    : []
  const obrIds = [...new Set([grupo.repId, ...grupo.groupIds, ...obrByReceita.map((o) => o.id)])]

  const [ocs, logs, outbox] = await Promise.all([
    prisma.ocorrenciaFinanceira.findMany({
      where: { obrigacaoId: { in: obrIds }, tipo: { in: [...TIPOS_GLOBAIS] } },
      orderBy: { data: 'asc' },
      select: { id: true, obrigacaoId: true, tipo: true, valor: true, data: true, observacao: true, criadoPorId: true },
    }).catch(() => []),
    prisma.logAuditoria.findMany({
      where: { OR: [
        { entidade: 'ObrigacaoEconomica', entidadeId: { in: obrIds } },
        ...(grupo.receitaIds.length ? [{ entidade: 'Receita', entidadeId: { in: grupo.receitaIds } }] : []),
      ] },
      orderBy: { criadoEm: 'asc' },
      select: { id: true, acao: true, entidade: true, entidadeId: true, descricao: true, usuarioId: true, criadoEm: true },
    }).catch(() => []),
    prisma.domainOutbox.findMany({
      where: { OR: [
        { aggregateType: 'ObrigacaoEconomica', aggregateId: { in: obrIds } },
        ...(grupo.receitaIds.length ? [{ aggregateType: 'Receita', aggregateId: { in: grupo.receitaIds } }] : []),
      ] },
      orderBy: { criadoEm: 'asc' },
      select: { id: true, tipo: true, aggregateId: true, correlationId: true, criadoEm: true },
    }).catch(() => []),
  ])

  const atores = await nomesUsuarios([...ocs.map((o) => o.criadoPorId), ...logs.map((l) => l.usuarioId)])

  const eventos: EventoTimeline[] = []
  for (const o of ocs) {
    eventos.push({
      id: `oc-${o.id}`, escopo: 'GERAL', data: o.data.toISOString(), tipo: o.tipo,
      titulo: TITULO_OC[o.tipo] ?? o.tipo, descricao: o.observacao ?? TITULO_OC[o.tipo] ?? o.tipo,
      fonte: 'OcorrenciaFinanceira', obrigacaoId: o.obrigacaoId, ator: o.criadoPorId != null ? (atores.get(o.criadoPorId) ?? null) : null,
    })
  }
  // LogAuditoria/Outbox são de NÍVEL AGREGADO — mas descartamos qualquer linha que
  // caracterize evento individual (pagamento/cobrança) para blindar o escopo geral.
  for (const l of logs) {
    if (INDIVIDUAL_RE.test(`${l.acao} ${l.descricao}`)) continue
    eventos.push({
      id: `log-${l.id}`, escopo: 'GERAL', data: l.criadoEm.toISOString(), tipo: l.acao,
      titulo: l.acao, descricao: l.descricao, fonte: 'LogAuditoria',
      obrigacaoId: l.entidade === 'ObrigacaoEconomica' ? (l.entidadeId ?? null) : null,
      ator: l.usuarioId != null ? (atores.get(l.usuarioId) ?? null) : null,
    })
  }
  for (const e of outbox) {
    if (INDIVIDUAL_RE.test(e.tipo)) continue
    eventos.push({
      id: `outbox-${e.id}`, escopo: 'GERAL', data: e.criadoEm.toISOString(), tipo: e.tipo,
      titulo: e.tipo, descricao: e.tipo, fonte: 'DomainOutbox', obrigacaoId: e.aggregateId ?? null, ator: null,
    })
  }
  return eventos.sort((a, b) => b.data.localeCompare(a.data))
}

// ── TIMELINE INDIVIDUAL — só eventos daquela obrigação-participante ──
export async function timelineIndividualParticipante(obrigacaoIdParticipante: number): Promise<EventoTimeline[]> {
  const obrigacaoId = obrigacaoIdParticipante
  const obr = await prisma.obrigacaoEconomica.findUnique({
    where: { id: obrigacaoId }, select: { id: true, origemTipo: true, origemId: true },
  })
  if (!obr) return []

  const [ocs, cobs] = await Promise.all([
    // ocorrências INDIVIDUAIS (tudo que NÃO é evento global de negócio)
    prisma.ocorrenciaFinanceira.findMany({
      where: { obrigacaoId, tipo: { notIn: [...TIPOS_GLOBAIS] } },
      orderBy: { data: 'asc' },
      select: { id: true, tipo: true, valor: true, moeda: true, data: true, observacao: true, formaLabel: true, criadoPorId: true },
    }).catch(() => []),
    // cobranças do participante (por obrigação; cobre legado por receitaId) + parcelas p/ vencimentos
    prisma.cobranca.findMany({
      where: { OR: [
        { obrigacaoId },
        ...(obr.origemTipo === 'Receita' && obr.origemId != null ? [{ receitaId: obr.origemId }] : []),
      ] },
      orderBy: { criadoEm: 'asc' },
      select: { id: true, enviadaEm: true, valorTotal: true, moeda: true, status: true, parcelas: { select: { id: true, numero: true, vencimento: true, valor: true, status: true } } },
    }).catch(() => []),
  ])

  const atores = await nomesUsuarios(ocs.map((o) => o.criadoPorId))
  const eventos: EventoTimeline[] = []

  for (const o of ocs) {
    eventos.push({
      id: `oc-${o.id}`, escopo: 'INDIVIDUAL', data: o.data.toISOString(), tipo: o.tipo,
      titulo: TITULO_OC[o.tipo] ?? o.tipo,
      descricao: o.observacao ?? (o.formaLabel ? `${TITULO_OC[o.tipo] ?? o.tipo} · ${o.formaLabel}` : (TITULO_OC[o.tipo] ?? o.tipo)),
      fonte: 'OcorrenciaFinanceira', obrigacaoId, ator: o.criadoPorId != null ? (atores.get(o.criadoPorId) ?? null) : null,
    })
  }
  for (const c of cobs) {
    if (c.enviadaEm) {
      eventos.push({
        id: `cob-${c.id}`, escopo: 'INDIVIDUAL', data: c.enviadaEm.toISOString(), tipo: 'COBRANCA_ENVIADA',
        titulo: 'Cobrança enviada', descricao: `Cobrança de ${Number(c.valorTotal)} ${String(c.moeda)} enviada ao cliente.`,
        fonte: 'Cobranca', obrigacaoId, ator: null,
      })
    }
    for (const p of c.parcelas) {
      eventos.push({
        id: `venc-${p.id}`, escopo: 'INDIVIDUAL', data: p.vencimento.toISOString(), tipo: 'VENCIMENTO',
        titulo: 'Vencimento de parcela', descricao: `Parcela ${p.numero} — vencimento (${String(p.status)}).`,
        fonte: 'Parcela', obrigacaoId, ator: null,
      })
    }
  }
  return eventos.sort((a, b) => b.data.localeCompare(a.data))
}
