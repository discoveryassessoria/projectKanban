// lib/financeiro/leitura/receita-detalhe.ts
// ============================================================================
// DETALHE DA RECEITA (Motor Financeiro V3 · Fase 3) — dados para a tela oficial
// de Receita do Financeiro V3. Fonte EXCLUSIVA: Ledger/projeções + a Receita/
// Processo de origem (metadados). Espelha 1:1 o que a tela renderiza.
// ============================================================================
import { prisma } from '@/lib/prisma'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface ReceitaDetalhe {
  obrigacaoId: number
  codigo: string | null
  descricao: string | null
  statusLabel: string // A VENCER | QUITADO | ...
  processo: { id: number | null; codigo: string | null; nome: string | null }
  responsavel: { nome: string; papel: string } | null
  servico: string | null
  formaCobranca: string | null
  moeda: string
  valorContratado: number
  recebido: number
  saldo: number
  vencimento: string | null
  criadoEm: string | null
  criadoPor: string | null
  pagamentos: { id: number; data: string; valor: number; formaLabel: string | null; banco: string | null; agencia: string | null; conta: string | null; referencia: string | null; status: string }[]
  historico: { id: number; data: string; tipo: string; titulo: string; descricao: string; ator: string }[]
  resumo: { contratado: number; recebido: number; saldo: number; descontos: number; ajustes: number; liquido: number }
  distribuicao: { nome: string; percentual: number; valor: number }[]
  distribuicaoTotal: { percentual: number; valor: number }
  responsaveis: { id: number; nome: string }[]
  pagadores: { nome: string; valor: number }[]
  observacao: string | null
}

const TITULO: Record<string, string> = {
  OBRIGACAO_CRIADA: 'Receita criada', PAGAMENTO: 'Pagamento recebido', PAGAMENTO_PARCIAL: 'Pagamento recebido',
  DESCONTO: 'Desconto aplicado', JUROS: 'Juros aplicados', MULTA: 'Multa aplicada', ESTORNO: 'Estorno',
  ABERTURA: 'Abertura (data de corte)', AJUSTE: 'Ajuste',
}

async function resolverId(ref: string): Promise<number | null> {
  if (/^\d+$/.test(ref)) {
    const porId = await prisma.obrigacaoEconomica.findUnique({ where: { id: Number(ref) }, select: { id: true } })
    if (porId) return porId.id
    const porReceita = await prisma.obrigacaoEconomica.findFirst({ where: { origemTipo: 'Receita', origemId: Number(ref) }, select: { id: true } })
    if (porReceita) return porReceita.id
  }
  const porCodigo = await prisma.obrigacaoEconomica.findFirst({ where: { codigoOperacional: decodeURIComponent(ref) }, select: { id: true } })
  return porCodigo?.id ?? null
}

export async function carregarReceitaDetalhe(ref: string): Promise<ReceitaDetalhe | null> {
  const id = await resolverId(ref)
  if (!id) return null
  const obr = await prisma.obrigacaoEconomica.findUnique({
    where: { id },
    include: {
      ocorrencias: { orderBy: { data: 'asc' }, include: { aplicacoes: true } },
      distribuicoes: { orderBy: { versao: 'desc' }, include: { participacoes: true } },
    },
  })
  if (!obr) return null
  const proj = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: id } })

  // Receita/Processo de origem (metadados) + criador
  const receita = obr.origemTipo === 'Receita' && obr.origemId
    ? await prisma.receita.findUnique({ where: { id: obr.origemId }, select: { codigo: true, descricao: true, categoria: true, data1: true, createdAt: true, processoId: true } }).catch(() => null)
    : null
  const processo = obr.processoId ? await prisma.processo.findUnique({ where: { id: obr.processoId }, select: { id: true, codigo: true, nome: true } }) : null
  const criador = obr.criadoPorId ? await prisma.usuario.findUnique({ where: { id: obr.criadoPorId }, select: { nome: true } }).catch(() => null) : null

  // nomes de pessoas (distribuição + pagadores)
  const dist = obr.distribuicoes[0]
  const parts = (dist?.participacoes ?? []).filter((p) => p.incluido)
  const pessoaIds = new Set<number>(parts.map((p) => p.pessoaId))
  const pagadorIds = obr.ocorrencias.map((o) => o.pagadorId).filter((v): v is number => v != null)
  const pagadores = pagadorIds.length ? await prisma.pagador.findMany({ where: { id: { in: pagadorIds } } }) : []
  pagadores.forEach((p) => { if (p.pessoaId != null) pessoaIds.add(p.pessoaId) })
  const parteIds = pagadores.map((p) => p.parteExternaId).filter((v): v is number => v != null)
  const partes = parteIds.length ? await prisma.parteExterna.findMany({ where: { id: { in: parteIds } } }) : []
  const pessoas = pessoaIds.size ? await prisma.pessoa.findMany({ where: { id: { in: [...pessoaIds] } }, select: { id: true, nome: true, sobrenome: true } }) : []
  const nome = (pid: number | null) => { const p = pessoas.find((x) => x.id === pid); return p ? [p.nome, p.sobrenome].filter(Boolean).join(' ') : (pid != null ? `Pessoa #${pid}` : '—') }

  const contratado = Number(obr.valorContratado)
  const recebido = proj ? Number(proj.recebidoBruto) : 0
  const saldo = proj ? Number(proj.saldo) : contratado
  const descontos = cent(obr.ocorrencias.filter((o) => o.tipo === 'DESCONTO').reduce((s, o) => s + Number(o.valor), 0))
  const ajustes = cent(obr.ocorrencias.filter((o) => o.tipo === 'AJUSTE').reduce((s, o) => s + Number(o.valor), 0))

  const pagamentos = obr.ocorrencias.filter((o) => o.tipo === 'PAGAMENTO' || o.tipo === 'PAGAMENTO_PARCIAL').map((o) => ({
    id: o.id, data: o.data.toISOString(), valor: Number(o.valor), formaLabel: o.formaLabel, banco: o.contaBanco, agencia: o.contaAgencia, conta: o.contaNumero,
    referencia: o.referencia, status: o.status === 'PROCESSADA' ? 'Confirmado' : o.status,
  }))

  const historico = obr.ocorrencias.map((o) => {
    const pg = o.pagadorId != null ? pagadores.find((p) => p.id === o.pagadorId) : undefined
    const quem = pg?.parteExternaId != null ? (partes.find((x) => x.id === pg.parteExternaId)?.nome ?? 'Externo') : (pg?.pessoaId != null ? nome(pg.pessoaId) : (criador?.nome ?? 'Usuário'))
    let descricao = ''
    if (o.tipo === 'OBRIGACAO_CRIADA') descricao = `Receita criada no valor de ${fmtBRL(Number(o.valor))}.`
    else if (o.tipo === 'PAGAMENTO' || o.tipo === 'PAGAMENTO_PARCIAL') descricao = `Pagamento via ${o.formaLabel ?? 'recurso'} no valor de ${fmtBRL(Number(o.valor))}.`
    else descricao = `${TITULO[o.tipo] ?? o.tipo} — ${fmtBRL(Number(o.valor))}.`
    return { id: o.id, data: o.data.toISOString(), tipo: o.tipo, titulo: TITULO[o.tipo] ?? o.tipo, descricao, ator: quem }
  })

  const totalCota = cent(parts.reduce((s, p) => s + Number(p.valor ?? 0), 0)) || contratado
  const distribuicao = parts.map((p) => ({ nome: nome(p.pessoaId), percentual: totalCota ? cent((Number(p.valor ?? 0) / totalCota) * 100) : 0, valor: Number(p.valor ?? 0) }))

  const responsaveisSet = distribuicao.map((d, i) => ({ id: parts[i]?.pessoaId ?? i, nome: d.nome }))
  const pagadoresAgg = new Map<string, number>()
  for (const o of obr.ocorrencias) {
    if (o.tipo !== 'PAGAMENTO' && o.tipo !== 'PAGAMENTO_PARCIAL') continue
    const pg = o.pagadorId != null ? pagadores.find((p) => p.id === o.pagadorId) : undefined
    const quem = pg?.parteExternaId != null ? (partes.find((x) => x.id === pg.parteExternaId)?.nome ?? 'Externo') : (pg?.pessoaId != null ? nome(pg.pessoaId) : 'Empresa')
    pagadoresAgg.set(quem, cent((pagadoresAgg.get(quem) ?? 0) + Number(o.valor)))
  }

  const statusLabel = saldo <= 0.005 ? 'QUITADO' : 'A VENCER'
  const primeiro = parts[0]

  return {
    obrigacaoId: id, codigo: obr.codigoOperacional, descricao: receita?.descricao ?? obr.observacoes ?? null, statusLabel,
    processo: { id: processo?.id ?? null, codigo: processo?.codigo ?? null, nome: processo?.nome ?? null },
    responsavel: primeiro ? { nome: nome(primeiro.pessoaId), papel: 'Principal' } : null,
    servico: receita?.categoria ? String(receita.categoria) : null,
    formaCobranca: 'À vista',
    moeda: String(obr.moedaContratual),
    valorContratado: contratado, recebido, saldo,
    vencimento: (obr.vencimento ?? receita?.data1)?.toISOString() ?? null,
    criadoEm: obr.criadoEm.toISOString(), criadoPor: criador?.nome ?? 'Usuário',
    pagamentos, historico,
    resumo: { contratado, recebido, saldo, descontos, ajustes, liquido: cent(contratado - descontos + ajustes) },
    distribuicao, distribuicaoTotal: { percentual: cent(distribuicao.reduce((s, d) => s + d.percentual, 0)), valor: cent(distribuicao.reduce((s, d) => s + d.valor, 0)) },
    responsaveis: responsaveisSet, pagadores: [...pagadoresAgg.entries()].map(([nome, valor]) => ({ nome, valor })),
    observacao: obr.observacoes ?? null,
  }
}

function fmtBRL(v: number) { return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
