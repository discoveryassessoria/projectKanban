// lib/financeiro/ledger/ledger-service.ts
// ============================================================================
// Serviço SERVER do Ledger (Motor Financeiro V3 · Fase 1). Único ponto que
// PERSISTE lançamentos double-entry. Transacional + idempotente. Nunca altera
// saldo direto — grava entries balanceados e RECALCULA a projeção (replay).
// Emite domain events no Outbox (DomainOutbox). Ver spec §4, §0.
// ============================================================================
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { lancObrigacaoCriada, type Lancamento, type Direcao as PernaDirecao } from './lancamentos'
import { projetar, type EntryProjecao } from './projecao'
import { direcaoDe, aReceber, type Natureza } from '../dominio/obrigacao-economica'
import { ESTADO_CUSTO_INICIAL } from '../dominio/estado-custo'
import { chaveEvento } from '../dominio/eventos'

type Tx = Prisma.TransactionClient

/**
 * Persiste um lançamento (N pernas balanceadas) no Ledger de uma obrigação,
 * dentro de uma transação. Idempotente por `transacaoId` (chave única por perna).
 * Após gravar, recalcula a projeção materializada (cache) por replay.
 */
export async function registrarLancamento(tx: Tx, args: {
  obrigacaoId: number
  ledgerId: number
  transacaoId: string
  lancamento: Lancamento
  ocorrenciaId?: number | null
  moeda?: string
  data?: Date
  criadoPorId?: number | null
}): Promise<{ entriesCriados: number }> {
  const { obrigacaoId, ledgerId, transacaoId, lancamento } = args
  const data = args.data ?? new Date()
  const moeda = (args.moeda ?? 'BRL') as any

  // idempotência: se já existe qualquer entry desta transação, não repete.
  const jaTem = await tx.ledgerEntry.count({ where: { transacaoId } })
  if (jaTem > 0) { await recomputarProjecao(tx, obrigacaoId); return { entriesCriados: 0 } }

  const ultima = await tx.ledgerEntry.aggregate({ where: { ledgerId }, _max: { sequencia: true } })
  let seq = (ultima._max.sequencia ?? 0)

  for (const p of lancamento.pernas) {
    seq += 1
    await tx.ledgerEntry.create({ data: {
      ledgerId, obrigacaoId, ocorrenciaId: args.ocorrenciaId ?? null, transacaoId,
      tipo: lancamento.tipo, contaContabil: p.conta, direcao: p.direcao,
      valor: p.valor, moeda, valorContabil: p.valor, data, sequencia: seq,
      idempotencyKey: `${transacaoId}#${p.conta}#${p.direcao}#${seq}`,
      criadoPorId: args.criadoPorId ?? null,
    } })
  }
  await recomputarProjecao(tx, obrigacaoId)
  return { entriesCriados: lancamento.pernas.length }
}

/** Recalcula a projeção (cache) por REPLAY de todos os entries. Fonte = Ledger. */
export async function recomputarProjecao(tx: Tx, obrigacaoId: number): Promise<void> {
  const entries = await tx.ledgerEntry.findMany({ where: { obrigacaoId }, select: { contaContabil: true, direcao: true, valorContabil: true, sequencia: true } })
  const proj = projetar(entries.map((e): EntryProjecao => ({ conta: e.contaContabil, direcao: e.direcao as PernaDirecao, valor: Number(e.valorContabil), sequencia: e.sequencia })))
  await tx.saldoProjecao.upsert({
    where: { obrigacaoId },
    create: { obrigacaoId, recebidoBruto: proj.recebidoBruto, recebidoLiquido: proj.recebidoLiquido, saldo: proj.saldo, ultimaSequenciaAplicada: proj.ultimaSequenciaAplicada },
    update: { recebidoBruto: proj.recebidoBruto, recebidoLiquido: proj.recebidoLiquido, saldo: proj.saldo, ultimaSequenciaAplicada: proj.ultimaSequenciaAplicada },
  })
}

/**
 * Cria (ou reaproveita) a ObrigacaoEconomica de origem, seu Ledger e o
 * lançamento OBRIGACAO_CRIADA balanceado; emite evento no Outbox. Idempotente
 * por (origemTipo, origemId): reprocessar NÃO duplica.
 */
export interface CriarObrigacaoInput {
  natureza: Natureza
  valorContratado: number
  moedaContratual?: string
  codigoOperacional?: string | null
  processoId?: number | null
  faseId?: number | null
  clienteId?: number | null
  fornecedorId?: number | null
  itemCatalogoId?: number | null
  regraFinanceiraId?: number | null
  vencimento?: Date | null
  observacoes?: string | null
  origemTipo?: string | null // 'Receita' | 'Custo' | 'nativo'
  origemId?: number | null
  estadoCusto?: string | null // F4 — estado de negócio inicial (só custo); default CONTRATADO
  criadoPorId?: number | null
  db?: PrismaClient
  /**
   * VÍNCULO DOCUMENTAL + snapshot de preço. Opcional: o lançamento manual não
   * tem cadeia documental e passa sem isto. Quando presente, a obrigação passa a
   * saber DE QUEM e DE QUÊ ela é — o que a Planilha Documental projeta. Não é
   * segunda fonte de verdade: o Ledger continua sendo a única verdade do saldo.
   */
  vinculo?: VinculoDocumental | null
}

/**
 * Vínculo operacional de uma obrigação com a cadeia documental que a originou,
 * mais o preço CONGELADO no instante do lançamento. Tudo por ID — nunca por
 * nome de pessoa, título de tarefa ou rótulo de serviço.
 */
export interface VinculoDocumental {
  personId?: number | null
  documentoId?: number | null
  tipoServicoId?: number | null
  phaseKey?: string | null
  phaseCycle?: number | null
  configFinanceiraId?: number | null
  /** AUTOMATICO_DOCUMENTAL | BACKFILL_DOCUMENTAL | MANUAL */
  origemLancamento?: string | null
  eventoOrigemTipo?: string | null
  eventoOrigemId?: number | null
  // snapshot §7 — mudar a Tabela de Preços não reescreve história
  pricingRuleId?: number | null
  valorUnitario?: number | null
  quantidade?: number | null
  modoCalculoAplicado?: string | null
  naturezaPreco?: string | null
  contextoAplicado?: Prisma.InputJsonValue | null
  dataReferencia?: Date | null
  /** chave idempotente do lançamento (@unique no banco — trava a duplicação) */
  chaveIdempotencia?: string | null
}

/** Traduz o vínculo para os campos da obrigação (undefined = não mexe). */
function camposDoVinculo(v?: VinculoDocumental | null) {
  if (!v) return {}
  return {
    personId: v.personId ?? null,
    documentoId: v.documentoId ?? null,
    tipoServicoId: v.tipoServicoId ?? null,
    phaseKey: v.phaseKey ?? null,
    phaseCycle: v.phaseCycle ?? null,
    configFinanceiraId: v.configFinanceiraId ?? null,
    origemLancamento: v.origemLancamento ?? null,
    eventoOrigemTipo: v.eventoOrigemTipo ?? null,
    eventoOrigemId: v.eventoOrigemId ?? null,
    pricingRuleId: v.pricingRuleId ?? null,
    valorUnitario: v.valorUnitario ?? null,
    quantidade: v.quantidade ?? null,
    modoCalculoAplicado: v.modoCalculoAplicado ?? null,
    naturezaPreco: v.naturezaPreco ?? null,
    contextoAplicado: v.contextoAplicado ?? Prisma.DbNull,
    dataReferencia: v.dataReferencia ?? null,
    chaveIdempotencia: v.chaveIdempotencia ?? null,
  }
}

export async function criarObrigacaoEconomicaComLedger(input: CriarObrigacaoInput): Promise<{ obrigacaoId: number; reaproveitada: boolean }> {
  const client = input.db ?? prisma
  return client.$transaction((tx) => criarObrigacaoEconomicaComLedgerTx(tx, input))
}

/**
 * Cria a obrigação + Ledger DENTRO de uma transação já aberta. Usado pelo motor de
 * fase V3-native para criar Custo diretamente no V3, na mesma transação do MotorArtefato
 * (idempotência/rollback atômicos). Mesma lógica de criarObrigacaoEconomicaComLedger.
 */
export async function criarObrigacaoEconomicaComLedgerTx(tx: Tx, input: CriarObrigacaoInput): Promise<{ obrigacaoId: number; reaproveitada: boolean }> {
  const moeda = (input.moedaContratual ?? 'BRL') as any
  const dir = direcaoDe(input.natureza)
  {
    // idempotência pela origem
    if (input.origemTipo && input.origemId != null) {
      const existente = await tx.obrigacaoEconomica.findUnique({ where: { origemTipo_origemId: { origemTipo: input.origemTipo, origemId: input.origemId } } })
      if (existente) return { obrigacaoId: existente.id, reaproveitada: true }
    }
    // Idempotência do lançamento DOCUMENTAL: o custo derivado da cadeia documental
    // não tem Receita/Custo de origem (origemTipo='nativo', origemId=null), então a
    // chave acima não o protege. `chaveIdempotencia` é @unique no banco: reprocessar
    // o mesmo evento devolve a MESMA obrigação em vez de criar a segunda.
    if (input.vinculo?.chaveIdempotencia) {
      const jaExiste = await tx.obrigacaoEconomica.findUnique({ where: { chaveIdempotencia: input.vinculo.chaveIdempotencia } })
      if (jaExiste) return { obrigacaoId: jaExiste.id, reaproveitada: true }
    }

    const obr = await tx.obrigacaoEconomica.create({ data: {
      codigoOperacional: input.codigoOperacional ?? null,
      natureza: input.natureza, direcao: dir,
      processoId: input.processoId ?? null, faseId: input.faseId ?? null, clienteId: input.clienteId ?? null,
      fornecedorId: input.fornecedorId ?? null, itemCatalogoId: input.itemCatalogoId ?? null,
      regraFinanceiraId: input.regraFinanceiraId ?? null,
      moedaContratual: moeda, moedaContabil: moeda,
      valorContratado: input.valorContratado,
      vencimento: input.vencimento ?? null, observacoes: input.observacoes ?? null,
      status: 'ATIVO', origemTipo: input.origemTipo ?? 'nativo', origemId: input.origemId ?? null,
      estadoCusto: input.natureza === 'CUSTO' ? (input.estadoCusto ?? ESTADO_CUSTO_INICIAL) : null,
      criadoPorId: input.criadoPorId ?? null,
      ...camposDoVinculo(input.vinculo),
    } })

    const ledger = await tx.ledgerFinanceiro.create({ data: { obrigacaoId: obr.id, moedaContabil: moeda } })

    // ocorrência OBRIGACAO_CRIADA + lançamento balanceado
    const oc = await tx.ocorrenciaFinanceira.create({ data: {
      obrigacaoId: obr.id, tipo: 'OBRIGACAO_CRIADA', valor: input.valorContratado, moeda, data: new Date(),
      status: 'PROCESSADA', idempotencyKey: `obr-criada:${obr.id}`, criadoPorId: input.criadoPorId ?? null,
    } })
    const lanc = lancObrigacaoCriada(input.valorContratado, aReceber(input.natureza))
    await registrarLancamento(tx, { obrigacaoId: obr.id, ledgerId: ledger.id, transacaoId: `obr-criada:${obr.id}`, lancamento: lanc, ocorrenciaId: oc.id, moeda, criadoPorId: input.criadoPorId ?? null })

    // domain event (Outbox) — dedup por chave
    await tx.domainOutbox.create({ data: {
      tipo: 'financeiro.obrigacao.criada', aggregateType: 'ObrigacaoEconomica', aggregateId: obr.id,
      payload: { obrigacaoId: obr.id, codigoOperacional: obr.codigoOperacional, natureza: obr.natureza, valorContratado: Number(obr.valorContratado) } as Prisma.InputJsonValue,
      chaveIdempotencia: chaveEvento('financeiro.obrigacao.criada', obr.id),
    } }).catch(() => { /* já emitido (chave única) — idempotente */ })

    return { obrigacaoId: obr.id, reaproveitada: false }
  }
}

/**
 * Remove uma obrigação ÓRFÃ do motor (reconciliação: regra/config deixou de aplicar),
 * DENTRO de uma transação. LANÇA se houver pagamento (recebido>0) — o catch da
 * reconciliação preserva o lançamento (mesma semântica do FK RESTRICT do Custo legado).
 * Filhos removidos em ordem de FK; o Ledger histórico só é apagado quando não há pagamento.
 */
export async function removerObrigacaoOrfaTx(tx: Tx, obrigacaoId: number): Promise<void> {
  const proj = await tx.saldoProjecao.findUnique({ where: { obrigacaoId }, select: { recebidoBruto: true } })
  if (proj && Number(proj.recebidoBruto) > 0.005) throw new Error(`obrigação ${obrigacaoId} tem pagamento — reconciliação não remove`)
  await tx.ledgerEntry.deleteMany({ where: { obrigacaoId } })
  await tx.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId } })
  await tx.saldoProjecao.deleteMany({ where: { obrigacaoId } })
  await tx.ledgerFinanceiro.deleteMany({ where: { obrigacaoId } })
  await tx.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: obrigacaoId } })
  await tx.obrigacaoEconomica.delete({ where: { id: obrigacaoId } })
}
