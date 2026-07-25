// lib/financeiro/ocorrencias/ocorrencia-service.ts
// ============================================================================
// Serviço SERVER de OCORRÊNCIAS (Motor Financeiro V3 · Fase 2). Registra um fato
// financeiro: cria a Ocorrência + Pagador (interno/externo) + Aplicação +
// lançamento double-entry no Ledger + projeção + evento Outbox. Transacional e
// idempotente. Excedente NUNCA é aplicado em silêncio (vira crédito explícito).
// ============================================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { registrarLancamento } from '../ledger/ledger-service'
import { lancPagamento, lancPagamentoPagavel, lancDesconto, lancEncargo, lancEstorno, type Perna, type Direcao } from '../ledger/lancamentos'
import { aplicar, type PoliticaAplicacao } from '../dominio/aplicacao'
import { chaveEvento } from '../dominio/eventos'

export interface EntradaOcorrencia {
  obrigacaoId: number
  tipo: 'PAGAMENTO' | 'PAGAMENTO_PARCIAL' | 'DESCONTO' | 'JUROS' | 'MULTA' | 'ESTORNO' | 'AJUSTE'
  valor: number
  moeda?: string
  data?: Date
  formaPagamentoId?: number | null
  origemRecurso?: string | null
  pagador?: { tipo: string; pessoaId?: number | null; parteExterna?: { nome: string; documento?: string | null; tipo?: string | null } | null } | null
  aplicacao?: { politica?: PoliticaAplicacao; parcelaId?: number; manual?: { parcelaId: number; valor: number }[] } | null
  excedenteDestino?: 'CREDITO' | 'ADIANTAMENTO' | 'QUITAR_OUTRO' | 'DEVOLUCAO' | null
  tarifa?: number | null
  diferencaCambial?: number | null
  estornaOcorrenciaId?: number | null
  comprovanteUrl?: string | null
  observacao?: string | null
  idempotencyKey?: string | null
  criadoPorId?: number | null
}

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

/** Registra a ocorrência (transacional + idempotente). */
export async function registrarOcorrencia(e: EntradaOcorrencia) {
  const moeda = (e.moeda ?? 'BRL') as any
  return prisma.$transaction(async (tx) => {
    // idempotência
    if (e.idempotencyKey) {
      const existente = await tx.ocorrenciaFinanceira.findUnique({ where: { idempotencyKey: e.idempotencyKey } })
      if (existente) return { ocorrenciaId: existente.id, idempotente: true }
    }
    const obr = await tx.obrigacaoEconomica.findUnique({ where: { id: e.obrigacaoId }, include: { ledger: true } })
    if (!obr || !obr.ledger) throw new Error('Obrigação/Ledger inexistente para a ocorrência.')

    // pagador (interno ou externo — ParteExterna, sem Pessoa sombra)
    let pagadorId: number | null = null
    if (e.pagador) {
      let parteExternaId: number | null = null
      if (e.pagador.tipo === 'EXTERNO' && e.pagador.parteExterna) {
        const pe = await tx.parteExterna.create({ data: { nome: e.pagador.parteExterna.nome, documento: e.pagador.parteExterna.documento ?? null, tipo: e.pagador.parteExterna.tipo ?? null } })
        parteExternaId = pe.id
      }
      const pg = await tx.pagador.create({ data: { tipo: e.pagador.tipo, pessoaId: e.pagador.pessoaId ?? null, parteExternaId } })
      pagadorId = pg.id
    }

    const oc = await tx.ocorrenciaFinanceira.create({ data: {
      obrigacaoId: obr.id, tipo: e.tipo, valor: e.valor, moeda, data: e.data ?? new Date(),
      formaPagamentoId: e.formaPagamentoId ?? null, origemRecurso: e.origemRecurso ?? null, pagadorId,
      politicaAplicacao: e.aplicacao?.politica ?? null, status: 'PROCESSANDO',
      comprovanteUrl: e.comprovanteUrl ?? null, observacao: e.observacao ?? null,
      estornaId: e.estornaOcorrenciaId ?? null, idempotencyKey: e.idempotencyKey ?? null, criadoPorId: e.criadoPorId ?? null,
    } })

    const transacaoId = `oc:${oc.id}`
    let lancPernas: { tipo: string; pernas: Perna[] } | null = null
    let excedente = 0

    if (e.tipo === 'PAGAMENTO' || e.tipo === 'PAGAMENTO_PARCIAL') {
      // parcelas abertas da obrigação (via cobrança vinculada) + saldo já aplicado
      const cobrancas = await tx.cobranca.findMany({ where: { obrigacaoId: obr.id }, select: { id: true } })
      const cobIds = cobrancas.map((c) => c.id)
      const parcelas = cobIds.length ? await tx.parcelaFinanceira.findMany({ where: { cobrancaId: { in: cobIds } }, select: { id: true, numero: true, vencimento: true, valor: true } }) : []
      const aplicadoPorParcela = new Map<number, number>()
      if (parcelas.length) {
        const aplic = await tx.aplicacaoFinanceira.findMany({ where: { parcelaId: { in: parcelas.map((p) => p.id) } }, select: { parcelaId: true, valorAplicado: true } })
        for (const a of aplic) if (a.parcelaId != null) aplicadoPorParcela.set(a.parcelaId, cent((aplicadoPorParcela.get(a.parcelaId) ?? 0) + Number(a.valorAplicado)))
      }
      const abertas = parcelas.map((p) => ({ parcelaId: p.id, numero: p.numero, vencimento: p.vencimento, saldoAberto: cent(Number(p.valor) - (aplicadoPorParcela.get(p.id) ?? 0)) })).filter((p) => p.saldoAberto > 0)
      let res
      if (abertas.length > 0) {
        res = aplicar(e.valor, abertas, e.aplicacao?.politica ?? 'FIFO', { parcelaId: e.aplicacao?.parcelaId, manual: e.aplicacao?.manual })
        for (const a of res.aplicacoes) {
          await tx.aplicacaoFinanceira.create({ data: { ocorrenciaId: oc.id, parcelaId: a.parcelaId, valorAplicado: a.valor, moeda } })
        }
      } else {
        // Sem parcelas (ex.: lançamento extra): aplica contra o SALDO da obrigação.
        const proj = await tx.saldoProjecao.findUnique({ where: { obrigacaoId: obr.id } })
        const saldo = proj ? Math.max(0, Number(proj.saldo)) : cent(e.valor)
        const quitadoSaldo = Math.min(cent(e.valor), saldo)
        res = { aplicacoes: [], totalAplicado: quitadoSaldo, excedente: cent(e.valor - quitadoSaldo), erros: [] }
      }
      excedente = res.excedente
      if (excedente > 0) {
        // excedente NUNCA aplicado em silêncio: vira crédito explícito + movimento no razão de crédito
        const cred = await tx.creditoFinanceiro.create({ data: { obrigacaoId: obr.id, pessoaId: e.pagador?.pessoaId ?? null, origemOcorrenciaId: oc.id, valor: excedente, moeda, destino: e.excedenteDestino ?? 'CREDITO', status: 'ABERTO' } })
        await tx.creditoMovimento.create({ data: {
          creditoId: cred.id, tipo: 'GERACAO', valor: excedente, saldoAnterior: 0, saldoPosterior: excedente, moeda,
          obrigacaoOrigemId: obr.id, ocorrenciaId: oc.id, pagadorId, pessoaId: e.pagador?.pessoaId ?? null,
          processoId: obr.processoId ?? null, usuarioId: e.criadoPorId ?? null, correlationId: `oc:${oc.id}`,
          observacao: 'Crédito gerado por excedente de pagamento',
        } }).catch(() => {})
      }
      const quitado = res.totalAplicado > 0 ? res.totalAplicado : cent(e.valor - excedente)
      // Roteia por DIREÇÃO: recebimento (A_RECEBER) vs desembolso/baixa (A_PAGAR).
      lancPernas = obr.direcao === 'A_PAGAR'
        ? lancPagamentoPagavel({ valorQuitado: quitado, tarifa: cent(e.tarifa ?? 0) })
        : lancPagamento({ valorQuitado: quitado, tarifa: cent(e.tarifa ?? 0), diferencaCambial: cent(e.diferencaCambial ?? 0) })
    } else if (e.tipo === 'DESCONTO') {
      lancPernas = lancDesconto(e.valor)
    } else if (e.tipo === 'JUROS' || e.tipo === 'MULTA') {
      lancPernas = lancEncargo(e.valor, e.tipo)
    } else if (e.tipo === 'ESTORNO' && e.estornaOcorrenciaId) {
      const orig = await tx.ledgerEntry.findMany({ where: { obrigacaoId: obr.id, ocorrenciaId: e.estornaOcorrenciaId }, select: { contaContabil: true, direcao: true, valorContabil: true } })
      if (orig.length) {
        // ESTORNO PARCIAL: escala as pernas revertidas por (valorEstorno / valorOriginal).
        // Total por padrão (fator 1); nunca apaga/edita o lançamento original.
        const origOc = await tx.ocorrenciaFinanceira.findUnique({ where: { id: e.estornaOcorrenciaId }, select: { valor: true } })
        const origValor = origOc ? cent(Number(origOc.valor)) : 0
        const pedido = cent(e.valor)
        const fator = pedido > 0 && origValor > 0 && pedido < origValor - 0.005 ? pedido / origValor : 1
        lancPernas = lancEstorno(orig.map((o): Perna => ({ conta: o.contaContabil, direcao: o.direcao as Direcao, valor: cent(Number(o.valorContabil) * fator) })))
      }
    }

    if (lancPernas) {
      await registrarLancamento(tx, { obrigacaoId: obr.id, ledgerId: obr.ledger.id, transacaoId, lancamento: lancPernas, ocorrenciaId: oc.id, moeda, data: e.data ?? new Date(), criadoPorId: e.criadoPorId ?? null })
    }

    await tx.ocorrenciaFinanceira.update({ where: { id: oc.id }, data: { status: 'PROCESSADA' } })
    await tx.domainOutbox.create({ data: {
      tipo: 'financeiro.ocorrencia.processada', aggregateType: 'ObrigacaoEconomica', aggregateId: obr.id,
      payload: { obrigacaoId: obr.id, ocorrenciaId: oc.id, ocorrenciaTipo: e.tipo } as Prisma.InputJsonValue,
      chaveIdempotencia: chaveEvento('financeiro.ocorrencia.processada', oc.id),
    } }).catch(() => {})

    const proj = await tx.saldoProjecao.findUnique({ where: { obrigacaoId: obr.id } })
    return { ocorrenciaId: oc.id, idempotente: false, excedente, saldo: proj ? Number(proj.saldo) : null }
  })
}
