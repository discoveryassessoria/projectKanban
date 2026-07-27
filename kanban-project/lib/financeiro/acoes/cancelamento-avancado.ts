// lib/financeiro/acoes/cancelamento-avancado.ts
// ============================================================================
// CANCELAMENTO PROFISSIONAL da Receita (Motor Financeiro V3). Reusa o motor
// existente (Ledger append-only + projeção por replay) — NÃO inventa regra nova.
//
//   previsaoCancelamento(input)  → PURA (só lê/calcula, NÃO grava) — o que cancela,
//                                  o que permanece, recálculo, impacto contábil/financeiro.
//   executarCancelamento(input)  → grava, transacional, auditável, idempotente.
//
// Modos (campo `modo`):
//   TOTAL              cancela a obrigação inteira (reusa cancelarObrigacao).
//   PARCIAL_VALOR      cancela um valor do SALDO EM ABERTO (não pago).
//   PARCIAL_PERCENTUAL cancela um % do saldo em aberto.
//   POR_PARTICIPANTE   cancela o saldo aberto de UM participante (obrigação-filha).
//   POR_PARCELA        cancela parcelas específicas (PENDENTE) por id.
//
// Regras INVIOLÁVEIS (padrão existente — editar-receita/redistribuir/cancelar):
//   - NUNCA toca pagamento CONFIRMADO (só saldo/cobrança ABERTA — ATUALIZAR_ABERTAS);
//     TOTAL sobre obrigação com recebido>0 é BLOQUEADO (estorne o pagamento antes).
//   - estorna a parte proporcional no Ledger via lançamento balanceado (append-only);
//   - preserva auditoria (ocorrência ESTORNO + EventoFinanceiro com motivo);
//   - idempotente (idempotencyKey → não duplica em retry);
//   - se valor/percentual > saldo aberto → erro claro.
// ============================================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolverId } from '@/lib/financeiro/leitura/receita-detalhe'
import { registrarLancamento } from '@/lib/financeiro/ledger/ledger-service'
import { lancAjusteContrato } from '@/lib/financeiro/ledger/lancamentos'
import { cancelarObrigacao } from '@/lib/financeiro/extras/cancelar-lancamento'
import { aReceber, type Natureza } from '@/lib/financeiro/dominio/obrigacao-economica'
import { registrarEventoReceita } from './receita-contexto'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export type ModoCancelamento = 'TOTAL' | 'PARCIAL_VALOR' | 'PARCIAL_PERCENTUAL' | 'POR_PARTICIPANTE' | 'POR_PARCELA'

export interface CancelamentoInput {
  ref: string
  modo: ModoCancelamento
  valor?: number | null // PARCIAL_VALOR
  percentual?: number | null // PARCIAL_PERCENTUAL (0 < pct <= 100)
  participanteObrigacaoId?: number | null // POR_PARTICIPANTE (obrigação-filha)
  participanteReceitaId?: number | null // POR_PARTICIPANTE (alternativa por Receita)
  parcelaIds?: number[] | null // POR_PARCELA
  motivo?: string | null
  idempotencyKey?: string | null
}

export interface CancelamentoCtx { criadoPorId?: number | null }

// ── estado canônico de UMA obrigação (a referenciada, ou a do participante) ──
interface ObrigacaoCancelavel {
  obrigacaoId: number
  receitaId: number | null
  natureza: Natureza
  moeda: string
  valorContratado: number
  saldoAberto: number // SaldoProjecao.saldo (a receber remanescente)
  recebido: number // SaldoProjecao.recebidoBruto (já pago) — NUNCA cancelado
  status: string
  descricao: string | null
  nome: string
  parcelasPendentes: ParcelaAberta[]
}
interface ParcelaAberta { id: number; numero: number; vencimento: Date | null; valor: number; cobrancaId: number | null; receitaId: number | null }

async function carregarObrigacao(obrigacaoId: number): Promise<ObrigacaoCancelavel | null> {
  const obr = await prisma.obrigacaoEconomica.findUnique({
    where: { id: obrigacaoId },
    select: { id: true, origemTipo: true, origemId: true, natureza: true, moedaContratual: true, valorContratado: true, status: true, observacoes: true },
  })
  if (!obr) return null
  const proj = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId }, select: { saldo: true, recebidoBruto: true } })
  const receitaId = obr.origemTipo === 'Receita' ? obr.origemId ?? null : null
  let descricao = obr.observacoes ?? null
  let nome = 'Participante'
  if (receitaId != null) {
    const rec = await prisma.receita.findUnique({ where: { id: receitaId }, select: { descricao: true, requerentes: { orderBy: { idx: 'asc' }, select: { nome: true }, take: 1 } } }).catch(() => null)
    if (rec) { descricao = rec.descricao ?? descricao; nome = rec.requerentes?.[0]?.nome ?? nome }
  }
  const parcelasPendentes = await carregarParcelasPendentes(receitaId)
  return {
    obrigacaoId,
    receitaId,
    natureza: (obr.natureza as Natureza) ?? 'RECEITA',
    moeda: String(obr.moedaContratual),
    valorContratado: cent(Number(obr.valorContratado)),
    saldoAberto: cent(Number(proj?.saldo ?? obr.valorContratado)),
    recebido: cent(Number(proj?.recebidoBruto ?? 0)),
    status: String(obr.status),
    descricao,
    nome,
    parcelasPendentes,
  }
}

// Parcelas ABERTAS (PENDENTE) da Receita — ligadas por receitaId OU pela Cobrança.
async function carregarParcelasPendentes(receitaId: number | null): Promise<ParcelaAberta[]> {
  if (receitaId == null) return []
  const cobs = await prisma.cobranca.findMany({ where: { receitaId }, select: { id: true } }).catch(() => [] as { id: number }[])
  const cobIds = cobs.map((c) => c.id)
  const where: Prisma.ParcelaFinanceiraWhereInput = cobIds.length
    ? { status: 'PENDENTE', OR: [{ receitaId }, { cobrancaId: { in: cobIds } }] }
    : { status: 'PENDENTE', receitaId }
  const parcelas = await prisma.parcelaFinanceira.findMany({ where, orderBy: { numero: 'asc' }, select: { id: true, numero: true, vencimento: true, valor: true, cobrancaId: true, receitaId: true } }).catch(() => [])
  return parcelas.map((p) => ({ id: p.id, numero: p.numero, vencimento: p.vencimento ?? null, valor: cent(Number(p.valor)), cobrancaId: p.cobrancaId ?? null, receitaId: p.receitaId ?? null }))
}

// Resolve QUAL obrigação o modo atua (a referenciada, ou a do participante).
async function resolverAlvo(input: CancelamentoInput): Promise<{ obrigacaoId: number | null; erro?: string }> {
  if (input.modo === 'POR_PARTICIPANTE') {
    if (input.participanteObrigacaoId != null) return { obrigacaoId: Number(input.participanteObrigacaoId) }
    if (input.participanteReceitaId != null) {
      const o = await prisma.obrigacaoEconomica.findFirst({ where: { origemTipo: 'Receita', origemId: Number(input.participanteReceitaId) }, select: { id: true } })
      return { obrigacaoId: o?.id ?? null, erro: o ? undefined : 'Participante (Receita) não encontrado.' }
    }
    return { obrigacaoId: null, erro: 'Informe o participante (participanteObrigacaoId ou participanteReceitaId).' }
  }
  const id = await resolverId(input.ref)
  return { obrigacaoId: id, erro: id ? undefined : 'Receita não encontrada.' }
}

// Quanto o modo cancela (do saldo ABERTO) + as parcelas que serão afetadas.
interface Alvo {
  valorCancelar: number
  parcelasCanceladas: ParcelaAberta[] // POR_PARCELA
  erros: string[]
}
function calcularAlvo(o: ObrigacaoCancelavel, input: CancelamentoInput): Alvo {
  const erros: string[] = []
  const saldo = o.saldoAberto
  if (input.modo === 'TOTAL') {
    // TOTAL nunca reverte pagamento confirmado (bloqueia; estorne antes).
    if (o.recebido > 0.005) erros.push(`Receita possui ${o.recebido} já recebido. Estorne o pagamento antes de cancelar a Receita inteira.`)
    return { valorCancelar: saldo, parcelasCanceladas: [], erros }
  }
  if (input.modo === 'PARCIAL_VALOR') {
    const v = cent(input.valor ?? 0)
    if (v <= 0) erros.push('Informe um valor maior que zero para cancelar.')
    if (v > saldo + 0.005) erros.push(`Valor a cancelar (${v}) maior que o saldo em aberto (${saldo}).`)
    return { valorCancelar: Math.min(v, saldo), parcelasCanceladas: [], erros }
  }
  if (input.modo === 'PARCIAL_PERCENTUAL') {
    const pct = Number(input.percentual ?? 0)
    if (!(pct > 0) || pct > 100) erros.push('Percentual deve estar entre 0 (exclusivo) e 100.')
    const v = cent(saldo * (pct / 100))
    return { valorCancelar: v, parcelasCanceladas: [], erros }
  }
  if (input.modo === 'POR_PARTICIPANTE') {
    // cancela TODO o saldo aberto do participante (não pago).
    if (saldo <= 0.005) erros.push(`${o.nome}: não há saldo em aberto para cancelar.`)
    return { valorCancelar: saldo, parcelasCanceladas: [], erros }
  }
  // POR_PARCELA
  const ids = new Set((input.parcelaIds ?? []).map((x) => Number(x)))
  if (ids.size === 0) erros.push('Selecione ao menos uma parcela pendente para cancelar.')
  const alvo = o.parcelasPendentes.filter((p) => ids.has(p.id))
  const idsInexistentes = [...ids].filter((id) => !o.parcelasPendentes.some((p) => p.id === id))
  if (idsInexistentes.length) erros.push(`Parcela(s) ${idsInexistentes.join(', ')} não existe(m) ou não está(ão) pendente(s).`)
  const v = cent(alvo.reduce((s, p) => s + p.valor, 0))
  if (v > saldo + 0.005) erros.push(`Soma das parcelas (${v}) maior que o saldo em aberto (${saldo}).`)
  return { valorCancelar: v, parcelasCanceladas: alvo, erros }
}

// Reescala parcelas PENDENTE para somar `alvo` (proporcional; resto no último).
function redistribuirPendentes(pend: ParcelaAberta[], alvo: number): Map<number, number> {
  const out = new Map<number, number>()
  if (!pend.length) return out
  const alvoNN = Math.max(0, cent(alvo))
  const soma = cent(pend.reduce((s, p) => s + p.valor, 0))
  let acc = 0
  pend.forEach((p, i) => {
    const last = i === pend.length - 1
    let v: number
    if (last) v = cent(alvoNN - acc)
    else if (soma > 0.005) v = cent(alvoNN * (p.valor / soma))
    else v = cent(alvoNN / pend.length)
    acc = cent(acc + v)
    out.set(p.id, Math.max(0, v))
  })
  return out
}

// ════════════════════════════════════════════════════════════════════════════
// 1) PREVISÃO (pura — não grava)
// ════════════════════════════════════════════════════════════════════════════
export interface ParcelaAfetada { parcelaId: number; numero: number; vencimento: string | null; valorAntes: number; valorDepois: number; statusDepois: string }
export interface PernaContabil { conta: string; direcao: 'DEBITO' | 'CREDITO'; valor: number }
export interface PrevisaoCancelamento {
  ok: boolean
  erros: string[]
  modo: ModoCancelamento
  obrigacaoId: number
  moeda: string
  oQueCancela: { descricao: string | null; nome: string; valorBase: number }
  oQuePermanece: { saldoAberto: number; recebido: number }
  recalculo: {
    saldoAntes: number
    saldoDepois: number
    parcelasAfetadas: ParcelaAfetada[]
    cobrancasAfetadas: number[]
  }
  impactoContabil: PernaContabil[]
  impactoFinanceiro: { valorContratadoAntes: number; valorContratadoDepois: number; recebido: number; moeda: string }
}

function projetarParcelas(o: ObrigacaoCancelavel, alvo: Alvo, modo: ModoCancelamento): ParcelaAfetada[] {
  if (modo === 'POR_PARCELA') {
    return alvo.parcelasCanceladas.map((p) => ({ parcelaId: p.id, numero: p.numero, vencimento: p.vencimento ? p.vencimento.toISOString() : null, valorAntes: p.valor, valorDepois: 0, statusDepois: 'CANCELADA' }))
  }
  if (!o.parcelasPendentes.length || alvo.valorCancelar <= 0.005) return []
  const somaPend = cent(o.parcelasPendentes.reduce((s, p) => s + p.valor, 0))
  const novoPendente = cent(somaPend - alvo.valorCancelar)
  const novos = redistribuirPendentes(o.parcelasPendentes, novoPendente)
  return o.parcelasPendentes.map((p) => ({ parcelaId: p.id, numero: p.numero, vencimento: p.vencimento ? p.vencimento.toISOString() : null, valorAntes: p.valor, valorDepois: novos.get(p.id) ?? 0, statusDepois: (novos.get(p.id) ?? 0) <= 0.005 ? 'CANCELADA' : 'PENDENTE' }))
}

export async function previsaoCancelamento(input: CancelamentoInput): Promise<PrevisaoCancelamento | null> {
  const { obrigacaoId, erro } = await resolverAlvo(input)
  if (obrigacaoId == null) return erroPrevisao(input, obrigacaoId ?? 0, erro ?? 'Receita não encontrada.')
  const o = await carregarObrigacao(obrigacaoId)
  if (!o) return erroPrevisao(input, obrigacaoId, 'Receita não encontrada.')

  const alvo = calcularAlvo(o, input)
  const valorCancelar = cent(alvo.valorCancelar)
  const saldoDepois = cent(Math.max(0, o.saldoAberto - valorCancelar))
  const parcelasAfetadas = projetarParcelas(o, alvo, input.modo)
  const parcelasEnvolvidas = input.modo === 'POR_PARCELA' ? alvo.parcelasCanceladas : o.parcelasPendentes
  const cobrancasAfetadas = [...new Set(parcelasEnvolvidas.map((p) => p.cobrancaId).filter((v): v is number => v != null))]
  // impacto contábil: reduzir o "a receber" pelo valor cancelado (append-only).
  const impactoContabil: PernaContabil[] = valorCancelar > 0.005 ? lancAjusteContrato(-valorCancelar, aReceber(o.natureza)).pernas.map((p) => ({ conta: p.conta, direcao: p.direcao, valor: p.valor })) : []

  return {
    ok: alvo.erros.length === 0,
    erros: alvo.erros,
    modo: input.modo,
    obrigacaoId: o.obrigacaoId,
    moeda: o.moeda,
    oQueCancela: { descricao: o.descricao, nome: o.nome, valorBase: valorCancelar },
    oQuePermanece: { saldoAberto: saldoDepois, recebido: o.recebido },
    recalculo: { saldoAntes: o.saldoAberto, saldoDepois, parcelasAfetadas, cobrancasAfetadas },
    impactoContabil,
    impactoFinanceiro: { valorContratadoAntes: o.valorContratado, valorContratadoDepois: cent(o.valorContratado - valorCancelar), recebido: o.recebido, moeda: o.moeda },
  }
}

function erroPrevisao(input: CancelamentoInput, obrigacaoId: number, erro: string): PrevisaoCancelamento {
  return {
    ok: false, erros: [erro], modo: input.modo, obrigacaoId, moeda: 'BRL',
    oQueCancela: { descricao: null, nome: '', valorBase: 0 }, oQuePermanece: { saldoAberto: 0, recebido: 0 },
    recalculo: { saldoAntes: 0, saldoDepois: 0, parcelasAfetadas: [], cobrancasAfetadas: [] },
    impactoContabil: [], impactoFinanceiro: { valorContratadoAntes: 0, valorContratadoDepois: 0, recebido: 0, moeda: 'BRL' },
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2) EXECUÇÃO (grava — transacional, auditável, idempotente)
// ════════════════════════════════════════════════════════════════════════════
export interface ResultadoCancelamento {
  ok: boolean
  erros: string[]
  modo: ModoCancelamento
  obrigacaoId: number
  valorCancelado: number
  saldoAntes: number
  saldoDepois: number
  parcelasAfetadas: number
  statusObrigacao: string
  jaCancelada?: boolean
}

export async function executarCancelamento(input: CancelamentoInput, ctx: CancelamentoCtx = {}): Promise<ResultadoCancelamento> {
  const criadoPorId = ctx.criadoPorId ?? null
  const { obrigacaoId, erro } = await resolverAlvo(input)
  if (obrigacaoId == null) return { ok: false, erros: [erro ?? 'Receita não encontrada.'], modo: input.modo, obrigacaoId: 0, valorCancelado: 0, saldoAntes: 0, saldoDepois: 0, parcelasAfetadas: 0, statusObrigacao: '' }
  const o = await carregarObrigacao(obrigacaoId)
  if (!o) return { ok: false, erros: ['Receita não encontrada.'], modo: input.modo, obrigacaoId, valorCancelado: 0, saldoAntes: 0, saldoDepois: 0, parcelasAfetadas: 0, statusObrigacao: '' }

  const alvo = calcularAlvo(o, input)
  if (alvo.erros.length) return { ok: false, erros: alvo.erros, modo: input.modo, obrigacaoId, valorCancelado: 0, saldoAntes: o.saldoAberto, saldoDepois: o.saldoAberto, parcelasAfetadas: 0, statusObrigacao: o.status }

  const motivo = input.motivo?.trim() || null

  // ── TOTAL: reusa cancelarObrigacao (estorna Ledger, status CANCELADO) ──
  if (input.modo === 'TOTAL') {
    const r = await cancelarObrigacao({ obrigacaoId, motivo, criadoPorId })
    if (o.receitaId != null && !r.jaCancelada) {
      await prisma.receita.update({ where: { id: o.receitaId }, data: { cancelada: true, status: 'CANCELADA', canceladoEm: new Date(), canceladoMotivo: motivo?.slice(0, 500) ?? null, canceladoPorId: criadoPorId } }).catch(() => {})
    }
    await registrarEventoReceita({ receitaId: o.receitaId, tipo: 'CANCELAMENTO', descricao: `Cancelamento TOTAL da Receita ${o.descricao ?? obrigacaoId}.${motivo ? ` Motivo: ${motivo}` : ''} Ledger estornado; pagamentos preservados.`, usuarioId: criadoPorId, dados: { acao: 'CANCELAR_AVANCADO', modo: 'TOTAL', obrigacaoId, motivo } })
    return { ok: true, erros: [], modo: 'TOTAL', obrigacaoId, valorCancelado: cent(o.saldoAberto), saldoAntes: o.saldoAberto, saldoDepois: 0, parcelasAfetadas: o.parcelasPendentes.length, statusObrigacao: 'CANCELADO', jaCancelada: r.jaCancelada }
  }

  // ── PARCIAL / POR_PARTICIPANTE / POR_PARCELA: reduz só o ABERTO ──
  const valorCancelar = cent(alvo.valorCancelar)
  if (valorCancelar <= 0.005) return { ok: false, erros: ['Nada a cancelar (saldo em aberto zero).'], modo: input.modo, obrigacaoId, valorCancelado: 0, saldoAntes: o.saldoAberto, saldoDepois: o.saldoAberto, parcelasAfetadas: 0, statusObrigacao: o.status }

  const idemKey = (input.idempotencyKey ?? '').trim() || null
  const somaPend = cent(o.parcelasPendentes.reduce((s, p) => s + p.valor, 0))
  const novoPendente = cent(somaPend - valorCancelar)
  let parcelasAfetadas = 0

  try {
    await prisma.$transaction(async (tx) => {
      // idempotência: mesma key já processada → não repete.
      if (idemKey) {
        const existente = await tx.ocorrenciaFinanceira.findUnique({ where: { idempotencyKey: idemKey } }).catch(() => null)
        if (existente) return
      }
      const obr = await tx.obrigacaoEconomica.findUnique({ where: { id: obrigacaoId }, include: { ledger: true } })
      if (!obr || !obr.ledger) throw new Error('Obrigação/Ledger inexistente.')

      // 1) ocorrência ESTORNO (auditoria) + lançamento que reduz o "a receber".
      const oc = await tx.ocorrenciaFinanceira.create({ data: {
        obrigacaoId, tipo: 'ESTORNO', valor: valorCancelar, moeda: o.moeda as never, data: new Date(),
        status: 'PROCESSADA', observacao: `Cancelamento ${input.modo}${motivo ? ` — ${motivo}` : ''}`.slice(0, 300),
        idempotencyKey: idemKey, correlacaoId: `cancel-adv:${obrigacaoId}`.slice(0, 60), criadoPorId,
      } })
      await registrarLancamento(tx, {
        obrigacaoId, ledgerId: obr.ledger.id, transacaoId: `cancel-adv:${oc.id}`,
        lancamento: lancAjusteContrato(-valorCancelar, aReceber(o.natureza)), ocorrenciaId: oc.id, moeda: o.moeda, criadoPorId,
      })

      // 2) obrigação: reduz o valorContratado (espelha o Ledger).
      await tx.obrigacaoEconomica.update({ where: { id: obrigacaoId }, data: { valorContratado: cent(o.valorContratado - valorCancelar), version: { increment: 1 } } })

      // 3) Receita: reduz o valor congelado (quando há Receita de origem).
      if (o.receitaId != null) {
        const novoValor = cent(o.valorContratado - valorCancelar)
        await tx.receita.update({ where: { id: o.receitaId }, data: { valor: novoValor, valorUnitario: novoValor, valorTotalCongelado: novoValor } }).catch(() => {})
      }

      // 4) Cobranças ABERTAS.
      if (input.modo === 'POR_PARCELA') {
        for (const p of alvo.parcelasCanceladas) {
          await tx.parcelaFinanceira.update({ where: { id: p.id }, data: { status: 'CANCELADA' } }).catch(() => {})
          parcelasAfetadas++
        }
      } else if (o.parcelasPendentes.length) {
        const novos = redistribuirPendentes(o.parcelasPendentes, novoPendente)
        for (const p of o.parcelasPendentes) {
          const nv = novos.get(p.id) ?? 0
          await tx.parcelaFinanceira.update({ where: { id: p.id }, data: nv <= 0.005 ? { valor: 0, status: 'CANCELADA' } : { valor: nv } }).catch(() => {})
          parcelasAfetadas++
        }
      }

      // 5) auditoria.
      if (o.receitaId != null) {
        await tx.eventoFinanceiro.create({ data: {
          receitaId: o.receitaId, tipo: 'CANCELAMENTO', usuarioId: criadoPorId,
          descricao: `Cancelamento ${input.modo} — ${valorCancelar} ${o.moeda} do saldo em aberto${motivo ? ` — ${motivo}` : ''}. Pagamento confirmado preservado.`.slice(0, 500),
          valor: valorCancelar,
          dados: { acao: 'CANCELAR_AVANCADO', modo: input.modo, obrigacaoId, valorCancelado: valorCancelar, saldoAntes: o.saldoAberto, recebidoPreservado: o.recebido, motivo } as unknown as Prisma.InputJsonValue,
        } }).catch(() => {})
      }
    }, { timeout: 30000 })
  } catch (e) {
    return { ok: false, erros: [e instanceof Error ? e.message : 'Falha ao cancelar.'], modo: input.modo, obrigacaoId, valorCancelado: 0, saldoAntes: o.saldoAberto, saldoDepois: o.saldoAberto, parcelasAfetadas: 0, statusObrigacao: o.status }
  }

  const projDepois = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId }, select: { saldo: true } })
  return {
    ok: true, erros: [], modo: input.modo, obrigacaoId, valorCancelado: valorCancelar,
    saldoAntes: o.saldoAberto, saldoDepois: cent(Number(projDepois?.saldo ?? Math.max(0, o.saldoAberto - valorCancelar))),
    parcelasAfetadas, statusObrigacao: o.status,
  }
}
