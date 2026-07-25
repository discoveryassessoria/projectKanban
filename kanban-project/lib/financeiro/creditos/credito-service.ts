// lib/financeiro/creditos/credito-service.ts
// ============================================================================
// Serviço SERVER de CRÉDITOS FINANCEIROS. Um crédito nasce ABERTO (ex.: excedente
// de um pagamento — ver lib/financeiro/ocorrencias/ocorrencia-service.ts) e pode
// ser CONSUMIDO para quitar outra obrigação. A aplicação é TRANSACIONAL: reduz o
// saldo do crédito (consumo parcial mantém ABERTO / total → UTILIZADO) e registra
// a utilização como OcorrenciaFinanceira (origemRecurso 'CREDITO'), o que a torna
// auditável no extrato.
//
// SEM MIGRAÇÃO: não existe tabela de "utilização de crédito". O histórico é
// DERIVADO das OcorrenciaFinanceira com origemRecurso='CREDITO' (correlacionadas
// pela observação "Crédito aplicado #<id>" e/ou pela obrigação alvo). Trabalhamos
// só com as tabelas existentes (CreditoFinanceiro + OcorrenciaFinanceira).
// ============================================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** Arredonda para centavos exatos (decimal). Evita erro de ponto flutuante. */
const cent = (v: number | Prisma.Decimal) => Math.round((Number(v) || 0) * 100) / 100

export interface CreditoDisponivel {
  id: number
  valor: number // saldoDisponivel (valor corrente do crédito ABERTO)
  moeda: string
  destino: string
  origem: number | null // origemOcorrenciaId (ocorrência que gerou o crédito)
  pessoaId: number | null
  obrigacaoId: number | null
  criadoEm: Date
}

export interface FiltroCreditos {
  processoId?: number | null
  obrigacaoId?: number | null
  pessoaId?: number | null
}

/**
 * Resolve o WHERE de créditos ABERTOS/positivos a partir do filtro.
 * Quando processoId vier, cruza obrigacaoId → ObrigacaoEconomica.processoId
 * (créditos ligados a obrigações daquele processo).
 */
async function montarWhereCreditos(f: FiltroCreditos): Promise<Prisma.CreditoFinanceiroWhereInput | null> {
  const where: Prisma.CreditoFinanceiroWhereInput = { status: 'ABERTO', valor: { gt: 0 } }
  if (f.pessoaId != null) where.pessoaId = Number(f.pessoaId)
  if (f.obrigacaoId != null) where.obrigacaoId = Number(f.obrigacaoId)

  if (f.processoId != null) {
    const obrs = await prisma.obrigacaoEconomica.findMany({ where: { processoId: Number(f.processoId) }, select: { id: true } })
    const ids = obrs.map((o) => o.id)
    if (ids.length === 0) return null // processo sem obrigações → nenhum crédito
    // Intersecta com um obrigacaoId específico, se também informado.
    if (f.obrigacaoId != null) {
      if (!ids.includes(Number(f.obrigacaoId))) return null
      where.obrigacaoId = Number(f.obrigacaoId)
    } else {
      where.obrigacaoId = { in: ids }
    }
  }
  return where
}

/**
 * Lista créditos DISPONÍVEIS (status ABERTO, valor > 0), já projetados para a UI.
 * `valor` é o saldo disponível corrente do crédito.
 */
export async function listarCreditosDisponiveis(f: FiltroCreditos): Promise<CreditoDisponivel[]> {
  const where = await montarWhereCreditos(f)
  if (!where) return []
  const rows = await prisma.creditoFinanceiro.findMany({ where, orderBy: { criadoEm: 'asc' } })
  return rows.map((c) => ({
    id: c.id,
    valor: cent(c.valor),
    moeda: String(c.moeda),
    destino: c.destino,
    origem: c.origemOcorrenciaId ?? null,
    pessoaId: c.pessoaId ?? null,
    obrigacaoId: c.obrigacaoId ?? null,
    criadoEm: c.criadoEm,
  }))
}

/** Soma dos créditos ABERTOS (saldo disponível) para o filtro informado. */
export async function saldoDisponivelCredito(pessoaId?: number | null, obrigacaoId?: number | null, processoId?: number | null): Promise<number> {
  const where = await montarWhereCreditos({ pessoaId, obrigacaoId, processoId })
  if (!where) return 0
  const rows = await prisma.creditoFinanceiro.findMany({ where, select: { valor: true } })
  return cent(rows.reduce((acc, r) => acc + Number(r.valor), 0))
}

export interface EntradaAplicarCredito {
  /** Crédito específico a consumir. Se ausente, consome ABERTOS por FIFO (pessoa/processo). */
  creditoId?: number | null
  /** Valor a aplicar (em BRL/decimal). Nunca acima do disponível. */
  valor: number
  /** Obrigação que recebe a quitação (alvo). */
  obrigacaoAlvoId: number
  /** Escopo do FIFO quando creditoId não vier. */
  pessoaId?: number | null
  processoId?: number | null
  criadoPorId?: number | null
  /** Idempotência opcional (não re-aplica a mesma operação). */
  idempotencyKey?: string | null
}

export interface CreditoAfetado {
  creditoId: number
  consumido: number
  saldoRestante: number
  status: 'ABERTO' | 'UTILIZADO'
  ocorrenciaId: number
}

export interface ResultadoAplicarCredito {
  aplicado: number
  creditosAfetados: CreditoAfetado[]
  idempotente?: boolean
}

/**
 * Aplica crédito(s) numa obrigação alvo. TRANSACIONAL.
 * - Consome créditos ABERTOS (por id, ou FIFO por pessoa/processo) até `valor`.
 * - NUNCA consome acima do disponível: lança erro se o pedido exceder o saldo.
 * - Consumo parcial reduz CreditoFinanceiro.valor (mantém ABERTO);
 *   consumo total marca status 'UTILIZADO'.
 * - Registra a utilização como OcorrenciaFinanceira { obrigacaoId: alvo,
 *   tipo:'PAGAMENTO', valor, origemRecurso:'CREDITO', observacao:'Crédito aplicado #<id>' }.
 */
export async function aplicarCredito(e: EntradaAplicarCredito): Promise<ResultadoAplicarCredito> {
  const pedido = cent(e.valor)
  if (!e.obrigacaoAlvoId) throw new Error('obrigacaoAlvoId é obrigatório.')
  if (pedido <= 0) throw new Error('valor a aplicar deve ser positivo.')

  return prisma.$transaction(async (tx) => {
    // Idempotência: se qualquer ocorrência desta operação já existe, retorna sem re-aplicar.
    if (e.idempotencyKey) {
      const jaFeito = await tx.ocorrenciaFinanceira.findFirst({ where: { idempotencyKey: { startsWith: `${e.idempotencyKey}#` } }, select: { id: true } })
      if (jaFeito) return { aplicado: 0, creditosAfetados: [], idempotente: true }
    }

    // Confere a obrigação alvo (o registro de utilização exige uma obrigação real: FK).
    const alvo = await tx.obrigacaoEconomica.findUnique({ where: { id: Number(e.obrigacaoAlvoId) }, select: { id: true } })
    if (!alvo) throw new Error('Obrigação alvo inexistente.')

    // Seleciona os créditos candidatos (ABERTOS, valor > 0), em ordem FIFO (criadoEm asc).
    let candidatos: { id: number; valor: Prisma.Decimal; moeda: string }[]
    if (e.creditoId != null) {
      const c = await tx.creditoFinanceiro.findUnique({ where: { id: Number(e.creditoId) }, select: { id: true, valor: true, moeda: true, status: true } })
      if (!c || c.status !== 'ABERTO' || Number(c.valor) <= 0) throw new Error('Crédito indisponível para aplicação.')
      candidatos = [{ id: c.id, valor: c.valor, moeda: String(c.moeda) }]
    } else {
      const where: Prisma.CreditoFinanceiroWhereInput = { status: 'ABERTO', valor: { gt: 0 } }
      if (e.pessoaId != null) where.pessoaId = Number(e.pessoaId)
      if (e.processoId != null) {
        const obrs = await tx.obrigacaoEconomica.findMany({ where: { processoId: Number(e.processoId) }, select: { id: true } })
        const ids = obrs.map((o) => o.id)
        where.obrigacaoId = { in: ids.length ? ids : [-1] }
      }
      if (e.pessoaId == null && e.processoId == null) throw new Error('Informe creditoId, pessoaId ou processoId para localizar créditos.')
      const rows = await tx.creditoFinanceiro.findMany({ where, orderBy: { criadoEm: 'asc' }, select: { id: true, valor: true, moeda: true } })
      candidatos = rows.map((r) => ({ id: r.id, valor: r.valor, moeda: String(r.moeda) }))
    }

    const disponivel = cent(candidatos.reduce((acc, c) => acc + Number(c.valor), 0))
    if (pedido > disponivel + 0.005) throw new Error(`Valor solicitado (${pedido}) excede o crédito disponível (${disponivel}).`)

    const creditosAfetados: CreditoAfetado[] = []
    let restante = pedido

    for (const c of candidatos) {
      if (restante <= 0) break
      const saldoCred = cent(c.valor)
      const consumir = Math.min(saldoCred, restante)
      if (consumir <= 0) continue
      const saldoRestante = cent(saldoCred - consumir)
      const status: 'ABERTO' | 'UTILIZADO' = saldoRestante > 0 ? 'ABERTO' : 'UTILIZADO'

      await tx.creditoFinanceiro.update({ where: { id: c.id }, data: { valor: saldoRestante, status } })

      // Utilização auditável no extrato da obrigação alvo.
      const oc = await tx.ocorrenciaFinanceira.create({ data: {
        obrigacaoId: alvo.id,
        tipo: 'PAGAMENTO',
        valor: consumir,
        moeda: c.moeda as Prisma.OcorrenciaFinanceiraCreateInput['moeda'],
        data: new Date(),
        origemRecurso: 'CREDITO',
        observacao: `Crédito aplicado #${c.id}`,
        status: 'PROCESSADA',
        idempotencyKey: e.idempotencyKey ? `${e.idempotencyKey}#${c.id}` : null,
        criadoPorId: e.criadoPorId ?? null,
      } })

      creditosAfetados.push({ creditoId: c.id, consumido: consumir, saldoRestante, status, ocorrenciaId: oc.id })
      restante = cent(restante - consumir)
    }

    return { aplicado: cent(pedido - restante), creditosAfetados, idempotente: false }
  })
}

export interface UtilizacaoCredito {
  ocorrenciaId: number
  obrigacaoId: number
  valor: number
  moeda: string
  data: Date
  observacao: string | null
}

/**
 * Histórico de utilização de um crédito. DERIVADO (sem tabela própria — sem
 * migração): busca as OcorrenciaFinanceira de origemRecurso 'CREDITO' cuja
 * observação referencia "#<creditoId>". Retorna o que for possível a partir
 * dos dados existentes.
 */
export async function historicoUtilizacaoCredito(creditoId: number): Promise<UtilizacaoCredito[]> {
  const rows = await prisma.ocorrenciaFinanceira.findMany({
    where: { origemRecurso: 'CREDITO', observacao: { contains: `#${Number(creditoId)}` } },
    orderBy: { data: 'asc' },
    select: { id: true, obrigacaoId: true, valor: true, moeda: true, data: true, observacao: true },
  })
  // Guarda extra: casa exatamente "#<id>" (evita colisão de substring com #12 vs #123).
  const re = new RegExp(`#${Number(creditoId)}(?!\\d)`)
  return rows
    .filter((r) => r.observacao != null && re.test(r.observacao))
    .map((r) => ({ ocorrenciaId: r.id, obrigacaoId: r.obrigacaoId, valor: cent(r.valor), moeda: String(r.moeda), data: r.data, observacao: r.observacao }))
}
