// lib/financeiro/leitura/receitas-lista.ts
// ============================================================================
// LISTA DE RECEITAS (Motor Financeiro V3 · Fase 3) — dados da aba "Receitas".
// Fonte: obrigações de natureza RECEITA + projeções (Ledger) + parcelas legadas
// (aging real) + câmbio Confidence (BRL como moeda operacional; EUR = base do
// contrato). Aditivo: mantém os campos antigos (base do contrato) que o modal de
// pagamento consome, e ADICIONA os campos em BRL + câmbio + aging por parcela.
//
// Identidades garantidas por construção (por linha e no total):
//   valorContratadoBrl = recebidoBrl + saldoBrl
//   saldoBrl           = aVencerBrl + vencidoBrl
// ============================================================================
import { prisma } from '@/lib/prisma'
import { snapshotCotacoes } from '@/src/lib/cambio/servico-cambio'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100
const num = (x: unknown): number | null => (x == null ? null : Number(x))

// Enum de categoria/serviço → label amigável (nunca vazar "HONORARIOS" cru p/ o usuário).
const CAT_LABEL: Record<string, string> = {
  HONORARIOS: 'Honorários',
  HONORARIOS_PRINCIPAIS: 'Honorários principais',
  REEMBOLSO: 'Reembolso',
  PASTA_DOCUMENTAL: 'Pasta documental',
  TRADUCOES_JURAMENTACOES: 'Traduções e juramentações',
  APOSTILAMENTOS: 'Apostilamentos',
  EMOLUMENTOS: 'Emolumentos',
  TAXAS: 'Taxas',
  OUTROS: 'Outros',
}
const labelServico = (raw?: string | null): string | null => {
  if (!raw) return null
  if (CAT_LABEL[raw]) return CAT_LABEL[raw]
  // se ainda parecer um enum cru (MAIÚSCULAS/underscores), humaniza
  if (/^[A-Z0-9_]+$/.test(raw)) return raw.charAt(0) + raw.slice(1).toLowerCase().replace(/_/g, ' ')
  return raw
}

export type TipoCambio = 'FIXO' | 'VARIAVEL' | 'HOJE' | 'BRL' | 'NAO_DEFINIDO'

export interface ReceitaLinha {
  obrigacaoId: number
  receitaId: number | null
  codigo: string | null
  descricao: string | null
  requerente: { nome: string; papel: string } | null
  servico: string | null
  formaCobranca: string
  // --- base do contrato (moeda estrangeira) — compat c/ o que já existia ---
  moeda: string
  moedaBase: string
  valorBase: number
  valorContratado: number
  recebido: number
  saldo: number
  // --- câmbio aplicado ---
  cotacaoAplicada: number | null
  tipoCambio: TipoCambio
  dataCotacao: string | null
  // --- valores operacionais em BRL ---
  valorContratadoBrl: number
  recebidoBrl: number
  saldoBrl: number
  aVencerBrl: number
  vencidoBrl: number
  // --- parcelas (aging) ---
  parcelas: number
  parcelasRecebidas: number
  parcelasAVencer: number
  parcelasVencidas: number
  proximoVencimento: string | null
  vencimento: string | null
  statusLabel: string
}

export interface ReceitasKpis {
  // primárias (BRL)
  totalContratadoBrl: number
  recebidoBrl: number
  saldoBrl: number
  aVencerBrl: number
  vencidoBrl: number
  baseContratual: { valor: number; moeda: string } | null
  parcelas: number
  parcelasRecebidas: number
  parcelasAVencer: number
  parcelasVencidas: number
  proximoVencimento: string | null
  receitas: number            // número de GRUPOS (Receitas consolidadas)
  participantesFinanceiros: number // número de obrigações (participantes)
  // compat (na moeda-base) — mantidas p/ não quebrar consumidores antigos
  totalContratado: number
  recebido: number
  saldoAReceber: number
  aVencer: number
  aVencerParcelas: number
  moeda: string
}

// Participante financeiro: uma obrigação (por requerente) dentro de uma Receita consolidada.
// Reaproveita toda a computação por-obrigação que já existia (câmbio + aging + parcelas).
export interface ReceitaParticipante {
  obrigacaoId: number
  receitaId: number | null
  nome: string
  papel: string
  valorBase: number
  moedaBase: string
  cotacao: number | null
  tipoCambio: TipoCambio
  valorContratadoBrl: number
  recebidoBrl: number
  saldoBrl: number
  aVencerBrl: number
  vencidoBrl: number
  proximoVencimento: string | null
  status: string
  parcelas: number
  parcelasRecebidas: number
}

// Receita consolidada: um grupo de obrigações (participantes) somadas.
export interface ReceitaGrupo {
  id: number                    // min(obrigacaoId) do grupo (estável)
  codigo: string | null         // código representativo
  descricao: string | null      // rótulo base (sem sufixo por requerente)
  servico: string | null
  moedaBase: string
  valorBaseTotal: number | null // Σ valorBase (null se moedas-base divergirem)
  valorContratadoBrlTotal: number
  recebidoBrlTotal: number
  saldoBrlTotal: number
  aVencerBrlTotal: number
  vencidoBrlTotal: number
  proximoVencimento: string | null
  statusConsolidado: string
  participantesCount: number
  participantes: ReceitaParticipante[]
}

export interface ReceitasLista {
  kpis: ReceitasKpis
  receitas: ReceitaGrupo[]
  processo: { id: number; nome: string | null; codigo: string | null } | null
}

// papel do participante: contextoAplicado.classificacao → sufixo da descrição → 'Principal'.
const derivePapel = (classificacao: unknown, desc?: string | null): string => {
  if (typeof classificacao === 'string' && classificacao.trim()) {
    const c = classificacao.trim()
    if (/prim/i.test(c)) return 'Primeiro'
    if (/adic/i.test(c)) return 'Adicional'
    return c.charAt(0).toUpperCase() + c.slice(1)
  }
  if (desc) {
    if (/Primeiro requerente/i.test(desc)) return 'Primeiro'
    if (/Requerente adicional/i.test(desc)) return 'Adicional'
  }
  return 'Principal'
}

// remove o sufixo "— Primeiro requerente — {nome}" / "— Requerente adicional — {nome}" → rótulo base.
const baseLabel = (desc: string | null): string | null => {
  if (!desc) return null
  const cut = desc.replace(/\s*[—–-]\s*(Primeiro requerente|Requerente adicional|Requerente principal)\b.*$/i, '').trim()
  return cut || null
}

export async function listarReceitas(processoId?: number): Promise<ReceitasLista> {
  const obrs = await prisma.obrigacaoEconomica.findMany({
    where: { natureza: 'RECEITA', direcao: 'A_RECEBER', status: { not: 'CANCELADO' }, ...(processoId ? { processoId } : {}) },
    include: { distribuicoes: { orderBy: { versao: 'desc' }, include: { participacoes: true } } },
    orderBy: { id: 'desc' }, take: 500,
  })
  const ids = obrs.map((o) => o.id)
  const projs = ids.length ? await prisma.saldoProjecao.findMany({ where: { obrigacaoId: { in: ids } } }) : []
  const projPor = new Map(projs.map((p) => [p.obrigacaoId, p]))

  // Receita legada (origem) — traz os campos de câmbio (fx*) além dos metadados.
  const recIds = obrs.filter((o) => o.origemTipo === 'Receita' && o.origemId).map((o) => o.origemId!) as number[]
  const receitas = recIds.length
    ? await prisma.receita.findMany({
        where: { id: { in: recIds } },
        select: { id: true, descricao: true, categoria: true, data1: true, tipoServicoId: true, moeda: true, valor: true, fxEstimado: true, fxRule: true, fxFixo: true, fxData: true, valorBrlFixo: true, configFinanceiraId: true, regraFinanceiraId: true, phaseKey: true, phaseCycle: true, personId: true, contextoAplicado: true },
      })
    : []
  const recPor = new Map(receitas.map((r) => [r.id, r]))
  // Requerente REAL da receita legada (nome em texto) — fonte confiável do vínculo,
  // preferida sobre a participação da distribuição (que pode não resolver a Pessoa).
  const reqLegado = recIds.length
    ? await prisma.receitaRequerente.findMany({ where: { receitaId: { in: recIds } }, orderBy: { idx: 'asc' }, select: { receitaId: true, nome: true } }).catch(() => [])
    : []
  const reqNomePor = new Map<number, string>()
  for (const r of reqLegado) { if (r.receitaId != null && !reqNomePor.has(r.receitaId) && r.nome?.trim()) reqNomePor.set(r.receitaId, r.nome.trim()) }

  // Parcelas legadas (fonte REAL do aging a-vencer/vencido) — por receita.
  const parcelas = recIds.length
    ? await prisma.parcelaFinanceira.findMany({
        where: { receitaId: { in: recIds }, status: { not: 'CANCELADA' } },
        select: { receitaId: true, numero: true, vencimento: true, valor: true, status: true, cambioAplicado: true, valorBrl: true },
      })
    : []
  const parcelasPor = new Map<number, typeof parcelas>()
  for (const pc of parcelas) { if (pc.receitaId == null) continue; const arr = parcelasPor.get(pc.receitaId) ?? []; arr.push(pc); parcelasPor.set(pc.receitaId, arr) }

  const tipoIds = receitas.map((r) => r.tipoServicoId).filter((v): v is number => v != null)
  const tipos = tipoIds.length ? await prisma.tipoServico.findMany({ where: { id: { in: tipoIds } }, select: { id: true, nome: true } }).catch(() => []) : []
  const tipoPor = new Map(tipos.map((t) => [t.id, t.nome]))

  const itemIds = obrs.map((o) => o.itemCatalogoId).filter((v): v is number => v != null)
  const itensMestre = itemIds.length ? await prisma.itemCatalogo.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, categoria: true } }).catch(() => []) : []
  const itemPor = new Map(itensMestre.map((i) => [i.id, i]))

  const pessoaIds = new Set<number>()
  for (const o of obrs) (o.distribuicoes[0]?.participacoes ?? []).forEach((p) => { if (p.incluido) pessoaIds.add(p.pessoaId) })
  const pessoas = pessoaIds.size ? await prisma.pessoa.findMany({ where: { id: { in: [...pessoaIds] } }, select: { id: true, nome: true, sobrenome: true } }) : []
  const nomePessoa = (pid: number): string => {
    const p = pessoas.find((x) => x.id === pid)
    const n = p ? [p.nome, p.sobrenome].filter(Boolean).join(' ').trim() : ''
    return n || 'Requerente não identificado'
  }

  // Cotações vigentes (LÊ SÓ O BANCO — fonte Confidence). EUR/USD → BRL.
  const live: Record<string, number | null> = {}
  let liveData: string | null = null
  try {
    const snap = await snapshotCotacoes()
    for (const m of snap.moedas) { live[String(m.moeda)] = m.valor; if (m.dataReferencia && !liveData) liveData = m.dataReferencia }
  } catch { /* sem cotação viva: cai p/ fx da receita ou "não definido" */ }

  const agora = Date.now()

  // Resolve o câmbio de uma receita (precedência: BRL → valorBrlFixo → fxFixo/fxEstimado → cotação viva).
  const resolverCambio = (moedaBase: string, valorBase: number, rec: (typeof receitas)[number] | undefined) => {
    if (moedaBase === 'BRL') return { cotacao: 1, tipo: 'BRL' as TipoCambio, data: null, contratadoBrl: cent(valorBase) }
    const liveRate = live[moedaBase] ?? null
    if (rec) {
      const fixo = rec.fxRule === 'FIXO'
      const cot = fixo ? (num(rec.fxFixo) ?? num(rec.fxEstimado) ?? liveRate) : (num(rec.fxEstimado) ?? num(rec.fxFixo) ?? liveRate)
      if (cot == null) return { cotacao: null, tipo: 'NAO_DEFINIDO' as TipoCambio, data: null, contratadoBrl: cent(valorBase) }
      const brlFixo = num(rec.valorBrlFixo)
      const contratadoBrl = fixo && brlFixo ? cent(brlFixo) : cent(valorBase * cot)
      return { cotacao: cot, tipo: (fixo ? 'FIXO' : 'VARIAVEL') as TipoCambio, data: fixo && rec.fxData ? new Date(rec.fxData).toISOString() : liveData, contratadoBrl }
    }
    if (liveRate == null) return { cotacao: null, tipo: 'NAO_DEFINIDO' as TipoCambio, data: null, contratadoBrl: cent(valorBase) }
    return { cotacao: liveRate, tipo: 'HOJE' as TipoCambio, data: liveData, contratadoBrl: cent(valorBase * liveRate) }
  }

  const rows = obrs.map((o) => {
    const proj = projPor.get(o.id)
    const rec = o.origemId ? recPor.get(o.origemId) : undefined

    // ── chave de agrupamento (Receita consolidada) ──────────────────────────
    // Agrupa por processo|config|regra|fase|ciclo QUANDO origem é Receita com config.
    // Caso contrário (manual/nativo, ou sem config) → grupo-de-um por obrigação (nunca funde).
    const cfgId = rec?.configFinanceiraId ?? null
    const groupable = o.origemTipo === 'Receita' && cfgId != null
    const groupKey = groupable
      ? `grp:${o.processoId}|${cfgId}|${rec?.regraFinanceiraId ?? ''}|${rec?.phaseKey ?? ''}|${rec?.phaseCycle ?? ''}`
      : `obr:${o.id}`
    const classificacao = (rec?.contextoAplicado && typeof rec.contextoAplicado === 'object' && !Array.isArray(rec.contextoAplicado))
      ? (rec.contextoAplicado as Record<string, unknown>).classificacao
      : null
    const papel = derivePapel(classificacao, rec?.descricao)
    const isPrimary = papel === 'Primeiro' || papel === 'Principal'
    const itemMestre = o.itemCatalogoId ? itemPor.get(o.itemCatalogoId) : undefined
    const moedaBase = String(o.moedaContratual)
    const valorBase = Number(o.valorContratado)
    const saldo = proj ? Number(proj.saldo) : valorBase
    const recebido = proj ? Number(proj.recebidoBruto) : 0
    const venc = o.vencimento ?? rec?.data1 ?? null

    const cambio = resolverCambio(moedaBase, valorBase, rec)
    const cot = cambio.cotacao
    const contratadoBrl = cambio.contratadoBrl

    // parcelas legadas desta receita (aging real)
    const pcs = rec ? (parcelasPor.get(rec.id) ?? []) : []
    const parcelaBrl = (pc: (typeof parcelas)[number]): number => {
      const vb = num(pc.valorBrl); if (vb != null) return vb
      const ca = num(pc.cambioAplicado); if (ca) return Number(pc.valor) * ca
      return cot ? Number(pc.valor) * cot : Number(pc.valor)
    }

    // recebido em BRL — FONTE ÚNICA = Ledger (recebido do razão); quando o razão tem
    // movimento ele manda (o motor V3 não vira ParcelaFinanceira.status). Parcelas quitadas
    // só cobrem legado sem lançamento no razão. Idêntico ao detalhe (computeCambioAging).
    const taxaEfetiva = valorBase > 0 ? contratadoBrl / valorBase : (cot ?? 1)
    const recebidoLedgerBrl = moedaBase === 'BRL' ? cent(recebido) : cent(recebido * taxaEfetiva)
    const recebidoParcelaBrl = cent(pcs.filter((pc) => pc.status === 'RECEBIDA' || pc.status === 'PAGA').reduce((s, pc) => s + parcelaBrl(pc), 0))
    const recebidoBrl = recebido > 0.005 ? recebidoLedgerBrl : recebidoParcelaBrl
    // saldo em BRL DERIVADO (garante contratado = recebido + saldo)
    const saldoBrl = cent(contratadoBrl - recebidoBrl)

    // aging: divide o saldoBrl em vencido/a-vencer pela data das parcelas em aberto
    const open = pcs.filter((pc) => pc.status === 'PENDENTE')
    let rawVenc = 0, rawAV = 0, nVenc = 0, nAV = 0
    for (const pc of open) {
      const brl = parcelaBrl(pc)
      if (new Date(pc.vencimento).getTime() < agora) { rawVenc += brl; nVenc++ } else { rawAV += brl; nAV++ }
    }
    let vencidoBrl = 0, aVencerBrl = 0
    const rawTot = rawVenc + rawAV
    if (rawTot > 0.005) {
      vencidoBrl = cent((saldoBrl * rawVenc) / rawTot)
      aVencerBrl = cent(saldoBrl - vencidoBrl)
    } else if (saldoBrl > 0.005) {
      const overdue = venc ? new Date(venc).getTime() < agora : false
      if (overdue) { vencidoBrl = saldoBrl; nVenc = nVenc || 1 } else { aVencerBrl = saldoBrl; nAV = nAV || 1 }
    }

    const overdueUnico = venc ? new Date(venc).getTime() < agora : false
    const parcelasTot = pcs.length > 0 ? pcs.length : 1
    let parcelasRecebidas: number
    if (pcs.length > 0) {
      const porStatus = pcs.filter((pc) => pc.status === 'RECEBIDA' || pc.status === 'PAGA').length
      if (porStatus > 0) parcelasRecebidas = porStatus
      else {
        let resto = recebidoBrl, n = 0
        for (const pc of [...pcs].sort((a, b) => new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime())) {
          const b = parcelaBrl(pc); if (b > 0 && resto >= b - 0.005) { resto = cent(resto - b); n++ } else break
        }
        parcelasRecebidas = n
      }
    } else {
      parcelasRecebidas = recebido >= valorBase - 0.005 && valorBase > 0 ? 1 : 0
    }
    const parcelasAVencer = pcs.length > 0 ? nAV : (saldoBrl > 0.005 && !overdueUnico ? 1 : 0)
    const parcelasVencidas = pcs.length > 0 ? nVenc : (saldoBrl > 0.005 && overdueUnico ? 1 : 0)
    const proximoVenc = open.length > 0
      ? new Date(Math.min(...open.map((pc) => new Date(pc.vencimento).getTime()))).toISOString()
      : (saldoBrl > 0.005 && venc ? new Date(venc).toISOString() : null)

    const statusLabel = saldoBrl <= 0.005
      ? 'QUITADO'
      : vencidoBrl > 0.005
        ? 'VENCIDO'
        : recebidoBrl > 0.005
          ? 'PARCIAL'
          : 'A VENCER'

    const servico = itemMestre?.name
      ?? (rec?.tipoServicoId ? tipoPor.get(rec.tipoServicoId) : null)
      ?? labelServico(rec?.categoria ? String(rec.categoria) : null)
      ?? (itemMestre?.categoria ? labelServico(String(itemMestre.categoria)) : null)

    const primeiro = (o.distribuicoes[0]?.participacoes ?? []).filter((p) => p.incluido)[0]

    const linha: ReceitaLinha = {
      obrigacaoId: o.id,
      receitaId: o.origemTipo === 'Receita' ? (o.origemId ?? null) : null,
      codigo: o.codigoOperacional,
      descricao: itemMestre?.name ?? rec?.descricao ?? o.observacoes ?? null,
      requerente: (rec && reqNomePor.get(rec.id))
        ? { nome: reqNomePor.get(rec.id)!, papel: 'Principal' }
        : (primeiro ? { nome: nomePessoa(primeiro.pessoaId), papel: 'Principal' } : null),
      servico,
      formaCobranca: 'À vista',
      moeda: moedaBase, moedaBase, valorBase: cent(valorBase), valorContratado: cent(valorBase), recebido: cent(recebido), saldo: cent(saldo),
      cotacaoAplicada: cot, tipoCambio: cambio.tipo, dataCotacao: cambio.data,
      valorContratadoBrl: contratadoBrl, recebidoBrl, saldoBrl, aVencerBrl, vencidoBrl,
      parcelas: parcelasTot, parcelasRecebidas, parcelasAVencer, parcelasVencidas, proximoVencimento: proximoVenc,
      vencimento: venc ? new Date(venc).toISOString() : null,
      statusLabel,
    }

    return { linha, groupKey, papel, isPrimary }
  })

  const linhas: ReceitaLinha[] = rows.map((r) => r.linha)

  // ── AGRUPAMENTO em Receitas consolidadas ────────────────────────────────────
  const gruposMap = new Map<string, typeof rows>()
  const ordem: string[] = []
  for (const row of rows) {
    const arr = gruposMap.get(row.groupKey)
    if (arr) { arr.push(row) } else { gruposMap.set(row.groupKey, [row]); ordem.push(row.groupKey) }
  }
  const receitasGrupos: ReceitaGrupo[] = ordem.map((key) => {
    const membros = gruposMap.get(key)!
    const rep = membros.find((m) => m.isPrimary) ?? membros[0]
    const participantes: ReceitaParticipante[] = membros.map((m) => ({
      obrigacaoId: m.linha.obrigacaoId,
      receitaId: m.linha.receitaId,
      nome: m.linha.requerente?.nome ?? 'Requerente não identificado',
      papel: m.papel,
      valorBase: m.linha.valorBase,
      moedaBase: m.linha.moedaBase,
      cotacao: m.linha.cotacaoAplicada,
      tipoCambio: m.linha.tipoCambio,
      valorContratadoBrl: m.linha.valorContratadoBrl,
      recebidoBrl: m.linha.recebidoBrl,
      saldoBrl: m.linha.saldoBrl,
      aVencerBrl: m.linha.aVencerBrl,
      vencidoBrl: m.linha.vencidoBrl,
      proximoVencimento: m.linha.proximoVencimento,
      status: m.linha.statusLabel,
      parcelas: m.linha.parcelas,
      parcelasRecebidas: m.linha.parcelasRecebidas,
    }))
    const moedasGrp = [...new Set(membros.map((m) => m.linha.moedaBase))]
    const valorBaseTotal = moedasGrp.length === 1 ? cent(membros.reduce((s, m) => s + m.linha.valorBase, 0)) : null
    const valorContratadoBrlTotal = cent(membros.reduce((s, m) => s + m.linha.valorContratadoBrl, 0))
    const recebidoBrlTotal = cent(membros.reduce((s, m) => s + m.linha.recebidoBrl, 0))
    const saldoBrlTotal = cent(membros.reduce((s, m) => s + m.linha.saldoBrl, 0))
    const aVencerBrlTotal = cent(membros.reduce((s, m) => s + m.linha.aVencerBrl, 0))
    const vencidoBrlTotal = cent(membros.reduce((s, m) => s + m.linha.vencidoBrl, 0))
    const proximos = membros.map((m) => m.linha.proximoVencimento).filter((v): v is string => !!v).sort()
    const statusConsolidado = vencidoBrlTotal > 0.005
      ? 'VENCIDO'
      : saldoBrlTotal <= 0.005
        ? 'QUITADO'
        : recebidoBrlTotal > 0.005
          ? 'PARCIAL'
          : 'A VENCER'
    return {
      id: Math.min(...membros.map((m) => m.linha.obrigacaoId)),
      codigo: rep.linha.codigo,
      descricao: baseLabel(rep.linha.descricao) ?? rep.linha.servico ?? null,
      servico: rep.linha.servico,
      moedaBase: rep.linha.moedaBase,
      valorBaseTotal,
      valorContratadoBrlTotal,
      recebidoBrlTotal,
      saldoBrlTotal,
      aVencerBrlTotal,
      vencidoBrlTotal,
      proximoVencimento: proximos[0] ?? null,
      statusConsolidado,
      participantesCount: membros.length,
      participantes,
    }
  })

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const soma = (f: (l: ReceitaLinha) => number) => cent(linhas.reduce((s, l) => s + f(l), 0))
  const basesNaoBrl = linhas.filter((l) => l.moedaBase !== 'BRL')
  const moedasBase = [...new Set(basesNaoBrl.map((l) => l.moedaBase))]
  const baseContratual = basesNaoBrl.length && moedasBase.length === 1
    ? { valor: cent(basesNaoBrl.reduce((s, l) => s + l.valorBase, 0)), moeda: moedasBase[0] }
    : null
  const proximos = linhas.map((l) => l.proximoVencimento).filter((v): v is string => !!v).sort()

  const moedasDistintas = [...new Set(linhas.map((l) => l.moeda))]
  const kpis: ReceitasKpis = {
    totalContratadoBrl: soma((l) => l.valorContratadoBrl),
    recebidoBrl: soma((l) => l.recebidoBrl),
    saldoBrl: soma((l) => l.saldoBrl),
    aVencerBrl: soma((l) => l.aVencerBrl),
    vencidoBrl: soma((l) => l.vencidoBrl),
    baseContratual,
    parcelas: linhas.reduce((s, l) => s + l.parcelas, 0),
    parcelasRecebidas: linhas.reduce((s, l) => s + l.parcelasRecebidas, 0),
    parcelasAVencer: linhas.reduce((s, l) => s + l.parcelasAVencer, 0),
    parcelasVencidas: linhas.reduce((s, l) => s + l.parcelasVencidas, 0),
    proximoVencimento: proximos[0] ?? null,
    receitas: receitasGrupos.length,
    participantesFinanceiros: linhas.length,
    // compat (moeda-base)
    totalContratado: soma((l) => l.valorContratado),
    recebido: soma((l) => l.recebido),
    saldoAReceber: soma((l) => l.saldo),
    aVencer: soma((l) => l.aVencerBrl),
    aVencerParcelas: linhas.reduce((s, l) => s + l.parcelasAVencer, 0),
    moeda: moedasDistintas.length === 1 ? moedasDistintas[0] : 'BRL',
  }
  const processo = processoId
    ? await prisma.processo.findUnique({ where: { id: processoId }, select: { id: true, nome: true, codigo: true } }).catch(() => null)
    : null
  return { kpis, receitas: receitasGrupos, processo }
}
