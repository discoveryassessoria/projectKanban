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
import { lancPagamento, lancPagamentoPagavel, lancDesconto, lancDescontoPagavel, lancEncargo, lancEncargoPagavel, lancEstorno, type Perna, type Direcao } from '../ledger/lancamentos'
import { aplicar, type PoliticaAplicacao } from '../dominio/aplicacao'
import { chaveEvento } from '../dominio/eventos'
import { aplicarTransicaoEstadoCustoTx } from '../acoes/estado-custo-service'

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
  return prisma.$transaction(async (tx) => registrarOcorrenciaTx(tx, e))
}

/**
 * Núcleo transacional da ocorrência — recebe o `tx` para permitir compor VÁRIAS
 * ocorrências numa ÚNICA transação (ex.: recebimento multi-forma atômico). NÃO abre
 * transação própria. Idempotente e com exclusão mútua por obrigação (FOR UPDATE).
 */
export async function registrarOcorrenciaTx(tx: Prisma.TransactionClient, e: EntradaOcorrencia) {
  const moeda = (e.moeda ?? 'BRL') as any
  // MUTEX: lock de linha na obrigação — serializa ocorrências concorrentes na MESMA
  // obrigação (impede estorno/pagamento duplicado por duplo-clique/retry simultâneo).
  // Re-lock dentro da mesma transação é no-op. Row-level lock do Postgres.
  await tx.$queryRaw`SELECT id FROM "ObrigacaoEconomica" WHERE id = ${e.obrigacaoId} FOR UPDATE`
  // idempotência SOB O LOCK: retry com a mesma key vê a ocorrência já commitada e
  // retorna o MESMO resultado, sem remutar.
  if (e.idempotencyKey) {
    const existente = await tx.ocorrenciaFinanceira.findUnique({ where: { idempotencyKey: e.idempotencyKey } })
    if (existente) {
      const projPrev = await tx.saldoProjecao.findUnique({ where: { obrigacaoId: e.obrigacaoId } })
      return { ocorrenciaId: existente.id, idempotente: true, excedente: 0, saldo: projPrev ? Number(projPrev.saldo) : null }
    }
  }
  {
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
        } })
      }
      const quitado = res.totalAplicado > 0 ? res.totalAplicado : cent(e.valor - excedente)
      // A1: pagamento que quita 0 (tudo virou excedente/crédito) NÃO gera lançamento de pagamento
      // (evita "exige ≥2 pernas"); o crédito já foi registrado acima.
      if (quitado > 0.005) {
        // Roteia por DIREÇÃO: recebimento (A_RECEBER) vs desembolso/baixa (A_PAGAR).
        lancPernas = obr.direcao === 'A_PAGAR'
          ? lancPagamentoPagavel({ valorQuitado: quitado, tarifa: cent(e.tarifa ?? 0) })
          : lancPagamento({ valorQuitado: quitado, tarifa: cent(e.tarifa ?? 0), diferencaCambial: cent(e.diferencaCambial ?? 0) })
      }
    } else if (e.tipo === 'DESCONTO') {
      // C1: desconto NUNCA abaixa o a receber além do saldo aberto (não deixa saldo negativo).
      const projD = await tx.saldoProjecao.findUnique({ where: { obrigacaoId: obr.id } })
      const saldoAberto = Math.max(0, projD ? cent(Number(projD.saldo)) : cent(e.valor))
      const descAplicavel = Math.min(cent(e.valor), saldoAberto)
      // Roteia por DIREÇÃO: desconto CONCEDIDO (a receber) × desconto OBTIDO (a pagar).
      // Sem isto o desconto de um custo abateria "Clientes a Receber" e o saldo a pagar
      // ficaria eternamente em aberto.
      if (descAplicavel > 0.005) lancPernas = obr.direcao === 'A_PAGAR' ? lancDescontoPagavel(descAplicavel) : lancDesconto(descAplicavel)
    } else if (e.tipo === 'JUROS' || e.tipo === 'MULTA') {
      // Idem para encargos: no custo, juros/multa AUMENTAM o passivo a pagar.
      lancPernas = obr.direcao === 'A_PAGAR' ? lancEncargoPagavel(e.valor, e.tipo) : lancEncargo(e.valor, e.tipo)
    } else if (e.tipo === 'ESTORNO' && e.estornaOcorrenciaId) {
      const origOc = await tx.ocorrenciaFinanceira.findUnique({ where: { id: e.estornaOcorrenciaId }, select: { valor: true } })
      if (!origOc) throw new Error('Ocorrência a estornar inexistente.')
      const origValor = cent(Number(origOc.valor))
      // C2: NÃO estornar além do que resta estornável (evita reversão em dobro). Sob o MUTEX
      // (FOR UPDATE da obrigação), estornos concorrentes são serializados: o 2º já enxerga o
      // 1º como PROCESSADA e é corretamente barrado.
      const estornosPrev = await tx.ocorrenciaFinanceira.aggregate({ where: { estornaId: e.estornaOcorrenciaId, tipo: 'ESTORNO', status: 'PROCESSADA' }, _sum: { valor: true } })
      const jaEstornado = cent(Number(estornosPrev._sum.valor ?? 0))
      const pedido = cent(e.valor)
      if (jaEstornado + pedido > origValor + 0.01) {
        throw new Error(`Pagamento já estornado (${jaEstornado} de ${origValor}); estorno de ${pedido} excede o restante.`)
      }
      // ESTORNO PARCIAL: escala as pernas por (valorEstorno / valorOriginal); total = fator 1.
      const fator = pedido > 0 && origValor > 0 && pedido < origValor - 0.005 ? pedido / origValor : 1
      // 1) reverte as pernas do razão (parte QUITADA); nunca apaga/edita o lançamento original
      const orig = await tx.ledgerEntry.findMany({ where: { obrigacaoId: obr.id, ocorrenciaId: e.estornaOcorrenciaId }, select: { contaContabil: true, direcao: true, valorContabil: true } })
      if (orig.length) {
        lancPernas = lancEstorno(orig.map((o): Perna => ({ conta: o.contaContabil, direcao: o.direcao as Direcao, valor: cent(Number(o.valorContabil) * fator) })))
      }
      // 2) P0#4: revoga o CRÉDITO de excedente originado por ESTE pagamento (proporcional ao
      //    estornado). Bloqueia se já consumido (evita benefício duplicado); nunca negativa.
      await revogarCreditoDeExcedente(tx, e.estornaOcorrenciaId, fator, oc.id, obr.id, e.criadoPorId ?? null)
    }

    if (lancPernas) {
      await registrarLancamento(tx, { obrigacaoId: obr.id, ledgerId: obr.ledger.id, transacaoId, lancamento: lancPernas, ocorrenciaId: oc.id, moeda, data: e.data ?? new Date(), criadoPorId: e.criadoPorId ?? null })
    }

    await tx.ocorrenciaFinanceira.update({ where: { id: oc.id }, data: { status: 'PROCESSADA' } })

    // TIMELINE do ESTORNO: o motivo/categoria fica VISÍVEL na timeline da Receita (nunca só
    // em log técnico). Dentro da transação → some junto se a mutação falhar.
    if (e.tipo === 'ESTORNO' && obr.origemTipo === 'Receita' && obr.origemId != null) {
      await tx.eventoFinanceiro.create({ data: {
        receitaId: obr.origemId, tipo: obr.direcao === 'A_PAGAR' ? 'ESTORNO_PAGAMENTO' : 'ESTORNO_RECEBIMENTO',
        descricao: `Estorno de ${moeda} ${cent(e.valor)} (pagamento #${e.estornaOcorrenciaId})${e.observacao ? ' · ' + e.observacao : ''}`.slice(0, 480),
      } })
    }

    // Evento de domínio OBRIGATÓRIO dentro da transação (sem best-effort): se falhar,
    // a mutação financeira inteira faz rollback (nada de estado parcial). O motivo/categoria
    // (observacao) entra no payload → fica AUDITÁVEL, não só no free-text da ocorrência.
    await tx.domainOutbox.create({ data: {
      tipo: 'financeiro.ocorrencia.processada', aggregateType: 'ObrigacaoEconomica', aggregateId: obr.id,
      payload: { obrigacaoId: obr.id, ocorrenciaId: oc.id, ocorrenciaTipo: e.tipo, observacao: e.observacao ?? null } as Prisma.InputJsonValue,
      chaveIdempotencia: chaveEvento('financeiro.ocorrencia.processada', oc.id),
    } })

    const proj = await tx.saldoProjecao.findUnique({ where: { obrigacaoId: obr.id } })
    const saldoNovo = proj ? Number(proj.saldo) : null

    // F4.2 — estado de negócio do CUSTO dirigido pelo evento (transição explícita, não
    // inferida no read): pagamento que quita → PAGO; estorno que reabre saldo → CONTRATADO.
    if (obr.natureza === 'CUSTO' && saldoNovo != null) {
      if ((e.tipo === 'PAGAMENTO' || e.tipo === 'PAGAMENTO_PARCIAL') && saldoNovo <= 0.005) {
        await aplicarTransicaoEstadoCustoTx(tx, obr.id, 'PAGO', { usuarioId: e.criadoPorId ?? null, motivo: 'pagamento total' })
      } else if (e.tipo === 'ESTORNO' && saldoNovo > 0.005) {
        await aplicarTransicaoEstadoCustoTx(tx, obr.id, 'CONTRATADO', { usuarioId: e.criadoPorId ?? null, motivo: 'estorno reabriu o saldo' })
      }
    }
    return { ocorrenciaId: oc.id, idempotente: false, excedente, saldo: saldoNovo }
  }
}

/**
 * P0#4 — Revoga o CreditoFinanceiro de excedente originado por um pagamento que está
 * sendo estornado, proporcional ao fator do estorno. Rastreia origem por
 * `origemOcorrenciaId`. NUNCA apaga fisicamente: cria CreditoMovimento 'ESTORNO'
 * (compensação auditável) e reduz o saldo do crédito. Se o crédito já foi consumido
 * além do revogável, BLOQUEIA o estorno (impede benefício duplicado); nunca deixa saldo
 * negativo. Preserva histórico e auditoria. Idempotente sob o MUTEX da obrigação.
 */
async function revogarCreditoDeExcedente(
  tx: Prisma.TransactionClient,
  estornaOcorrenciaId: number,
  fator: number,
  estornoOcId: number,
  obrigacaoId: number,
  criadoPorId: number | null,
) {
  const cred = await tx.creditoFinanceiro.findFirst({ where: { origemOcorrenciaId: estornaOcorrenciaId } })
  if (!cred) return // pagamento sem excedente → nada a revogar
  const ger = await tx.creditoMovimento.findFirst({ where: { creditoId: cred.id, tipo: 'GERACAO' }, select: { valor: true } })
  const gerado = ger ? cent(Number(ger.valor)) : cent(Number(cred.valor))
  const disponivel = cent(Number(cred.valor)) // coluna decrementada a cada consumo (FIFO)
  const revogarPedido = cent(gerado * fator)
  if (revogarPedido <= 0.005) return
  // Idempotência: se JÁ existe um movimento de ESTORNO deste crédito por esta ocorrência de
  // estorno, não repete (retry seguro sob a mesma transação/idempotencyKey).
  const jaRevogado = await tx.creditoMovimento.findFirst({ where: { creditoId: cred.id, tipo: 'ESTORNO', ocorrenciaId: estornoOcId }, select: { id: true } })
  if (jaRevogado) return
  if (revogarPedido > disponivel + 0.01) {
    // crédito consumido além do revogável → estornar geraria benefício duplicado
    throw new Error(`Estorno bloqueado: o crédito de excedente #${cred.id} originado por este pagamento já foi ${disponivel <= 0.005 ? 'totalmente' : 'parcialmente'} utilizado (disponível ${disponivel} de ${gerado}). Resolva o uso do crédito antes de estornar.`)
  }
  const depois = cent(disponivel - revogarPedido)
  await tx.creditoFinanceiro.update({ where: { id: cred.id }, data: { valor: depois, status: depois <= 0.005 ? 'ESTORNADO' : cred.status } })
  await tx.creditoMovimento.create({ data: {
    creditoId: cred.id, tipo: 'ESTORNO', valor: revogarPedido, saldoAnterior: disponivel, saldoPosterior: depois, moeda: cred.moeda,
    obrigacaoOrigemId: obrigacaoId, ocorrenciaId: estornoOcId, correlationId: `oc:${estornoOcId}`,
    usuarioId: criadoPorId, observacao: `Crédito revogado por estorno da ocorrência ${estornaOcorrenciaId}`,
  } })
}
