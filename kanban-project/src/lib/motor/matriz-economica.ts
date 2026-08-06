// src/lib/motor/matriz-economica.ts
// E8 — MOTOR ECONÔMICO POR ELEGIBILIDADE (fatia 1: Emissão) — v2 (correções do Marco)
//
// MATRIZ define O QUE é necessário; FASE/EVENTO define QUANDO fica ELEGÍVEL;
// o motor gera POR ITEM ELEGÍVEL: tarefa + Custo + Receita, vinculados a
// pessoa/documento/fase/ciclo/componente.
//
// Correções:
//  (a) COMPONENTE não vem só da fase → resolverComponente(fase, tipoDoc, alvo),
//      presets INICIAIS e extensíveis (não verdade fixa).
//  (b) ELEGIBILIDADE/quem paga vem do target/generationRule da REGRA
//      (linha reta é condição da regra, não hardcode do motor).
//  (c) CUSTO ≠ RECEITA → dois preços resolvidos INDEPENDENTES.
//  (d) phaseCycle (reemissão) → idempotência inclui o ciclo.
//
// Fonte oficial = Custo/Receita (reforma). NÃO usa CustoPessoa.
// Idempotência via MotorArtefato.automaticKey (@unique).

import { prisma } from '@/lib/prisma'
import {
  Prisma, Moeda, FxRule, ReceitaStatus, CustoStatus,
  TipoCusto, CategoriaReceita, CategoriaCusto,
} from '@prisma/client'
import { gerarCodigoReceita, gerarCodigoCusto } from '@/lib/financeiro/codigos'
import { aplicarCondicaoPagamento } from '@/lib/financeiro/aplicar-condicao'
import { criarObrigacaoEconomicaComLedger, removerObrigacaoOrfaTx } from '@/lib/financeiro/ledger/ledger-service'
import type { VinculoDocumental } from '@/lib/financeiro/ledger/ledger-service'
import { ORIGEM_AUTOMATICA } from '@/lib/financeiro/dominio/origem-lancamento'
// LOTE A · B3 — preço hierárquico (arquivo separado, testável isolado)
import { resolverPrecoPorConfigDB } from './resolver-preco-financeiro.prisma'
import type { ResultadoPreco, ResultadoPrecoOK } from './resolver-preco-financeiro'
import { resolverPendenciaPorChave } from '@/lib/financeiro/pendencia'
import { NaturezaPreco } from '@prisma/client'
import { criarTarefaDeSpec } from '@/src/services/processEngine/taskEngine'
import { resolverElegibilidadeDocumental } from './elegibilidade-documental'

export interface ItemEconomico {
  pessoaId: number; documentoId: number; componente: string
  tarefaId?: number
  custoId?: number; custo?: { valor: number; moeda: string }
  receitaId?: number; receita?: { valor: number; moeda: string }
}
export interface ResultadoMatriz {
  criados: ItemEconomico[]
  pulados: { motivo: string; detalhe?: string }[]
  erros: string[]
  /** Conjunto de automaticKeys que DEVEM existir nesta (fase, ciclo) — usado pelo
   *  reconcile por-documento para remover órfãos (documento/serviço que sumiu). */
  esperados: string[]
}

/**
 * ESCOPO da geração. Sem escopo, o motor projeta a fase inteira (comportamento de
 * sempre, usado pelo `phase.entered`). Com `documentoId`, projeta SÓ aquele
 * documento — que é o que o evento "registro localizado" pede: o custo nasce
 * quando o registro DAQUELE documento é encontrado, não quando a fase abre.
 *
 * É filtro, não motor paralelo: a resolução (Matriz → regra econômica → Tabela de
 * Preços → congelamento → idempotência) é exatamente a mesma.
 */
export interface EscopoGeracao {
  /** projeta apenas este Documento Operacional */
  documentoId?: number | null
  /** origem a gravar na obrigação (default AUTOMATICO_DOCUMENTAL) */
  origemLancamento?: string | null
  /** evento de domínio que causou a projeção (rastreabilidade) */
  eventoOrigemTipo?: string | null
  eventoOrigemId?: number | null
}

/**
 * Gera os itens econômicos elegíveis pela Matriz numa fase/ciclo. Idempotente.
 * Mesmo ciclo = não duplica; novo ciclo = novo conjunto.
 */
export async function gerarEconomicoDaMatriz(
  processoId: number, tipoProcessoId: number, phaseKey: string, phaseCycle = 1,
  escopo: EscopoGeracao = {},
): Promise<ResultadoMatriz> {
  const criados: ItemEconomico[] = []
  const pulados: { motivo: string; detalhe?: string }[] = []
  const erros: string[] = []
  // Chaves que DEVEM existir (documento/serviço elegível AGORA) — base do reconcile.
  const esperados: string[] = []

  // RESOLUÇÃO ÚNICA — a mesma que a reconciliação usa para dizer o que falta.
  // Ela decide QUEM, QUAL documento e QUAL componente, tudo por vínculo de
  // cadastro. Aqui só se cria o que ela apontou.
  const eleg = await resolverElegibilidadeDocumental(processoId, tipoProcessoId, phaseKey, phaseCycle, { documentoId: escopo.documentoId })
  pulados.push(...eleg.pulados)

  for (const el of eleg.itens) {
    const componente = el.componente
    const desc = `${componente} · ${el.pessoaNome}`
    const base = el.chaveBase

    // (c) dois preços INDEPENDENTES — a Configuração Financeira vem do componente.
    const prodCusto = el.custoConfigId ? await prisma.produtoFinanceiro.findUnique({ where: { id: el.custoConfigId } }) : null
    const prodReceita = el.receitaConfigId ? await prisma.produtoFinanceiro.findUnique({ where: { id: el.receitaConfigId } }) : null

    // Só AQUI se escreve: o serviço do processo nasce quando há o que lançar.
    const tipoServico = await acharOuCriarTipoServico(processoId, componente)
    const vinc = { personId: el.pessoaId, documentoId: el.documentoId, tipoServicoId: tipoServico.id, phaseKey, phaseCycle }
    const item: ItemEconomico = { pessoaId: el.pessoaId, documentoId: el.documentoId, componente }

    if (el.criaTarefa) {
      await comIdempotencia(`${base}::tarefa`, processoId, tipoProcessoId, phaseKey, 'task', el.regraId, 'Tarefa', `Solicitar ${componente} de ${el.pessoaNome}`,
        async () => (await criarTarefaDeSpec({
          titulo: `Solicitar ${componente} de ${el.pessoaNome}`, processoId,
          observacoes: `Motor econômico (Matriz) · fase "${phaseKey}" · ciclo ${phaseCycle} · doc ${el.documentoId}`,
        })).id,
        (id) => { item.tarefaId = id }, pulados, erros)
    }
    // PREÇO-FONTE-ÚNICA (§5): a Configuração Financeira NÃO é preço. Resolve SÓ
    // pela Tabela de Preços; sem fallback de valorPadrao; sem zero silencioso.
    // Sem preço válido → PENDÊNCIA rastreável (não lança). Conflito de mesma
    // precedência → BLOQUEIA + pendência. Sucesso → lança com preço CONGELADO.
    if (el.criaCusto) {
      if (!prodCusto) {
        pulados.push({ motivo: 'regra gera CUSTO mas sem Configuração Financeira de custo', detalhe: componente })
      } else {
        const chave = `${base}::custo`
        esperados.push(chave)
        const rC = await resolverPrecoPorConfigDB(prodCusto.id, { processoId, tipoProcessoId: String(tipoProcessoId), natureza: NaturezaPreco.CUSTO })
        const bloqueio = motivoBloqueio(rC)
        if (bloqueio) {
          await registrarPendencia({ chave, processoId, tipoProcessoId, phaseKey, phaseCycle, configId: prodCusto.id, regraId: el.regraId, natureza: NaturezaPreco.CUSTO, motivo: bloqueio.motivo, detalhe: `${componente}: ${bloqueio.detalhe}`, contexto: bloqueio.contexto }, pulados, erros)
        } else {
          // Sem conta contábil de cadastro: a classificação intermediária foi
          // eliminada. O Ledger V3 usa o plano fixo em ledger/plano-contas.ts.
          const cong = congelar(rC, NaturezaPreco.CUSTO, prodCusto.id, el.regraId, chave, { tipoProcessoId, phaseKey, phaseCycle })
          await comIdempotencia(chave, processoId, tipoProcessoId, phaseKey, 'financial', el.regraId, 'ObrigacaoEconomica', desc,
            () => criarCusto(processoId, desc, cong, { ...vinc, productServiceId: prodCusto.id }, escopo),
            (id) => { item.custoId = id; item.custo = { valor: cong.valor, moeda: cong.moeda } }, pulados, erros)
          // §13 — se havia pendência para esta chave, o reprocesso bem-sucedido a resolve.
          await resolverPendenciaPorChave(`pend::${chave}`, 'Preço de custo resolvido e lançamento criado')
        }
      }
    }
    if (el.criaReceita) {
      if (!prodReceita) {
        pulados.push({ motivo: 'regra gera RECEITA mas sem Configuração Financeira de receita', detalhe: componente })
      } else {
        const chave = `${base}::receita`
        esperados.push(chave)
        const rR = await resolverPrecoPorConfigDB(prodReceita.id, { processoId, tipoProcessoId: String(tipoProcessoId), natureza: NaturezaPreco.VENDA })
        const bloqueio = motivoBloqueio(rR)
        if (bloqueio) {
          await registrarPendencia({ chave, processoId, tipoProcessoId, phaseKey, phaseCycle, configId: prodReceita.id, regraId: el.regraId, natureza: NaturezaPreco.VENDA, motivo: bloqueio.motivo, detalhe: `${componente}: ${bloqueio.detalhe}`, contexto: bloqueio.contexto }, pulados, erros)
        } else {
          const cong = congelar(rR, NaturezaPreco.VENDA, prodReceita.id, el.regraId, chave, { tipoProcessoId, phaseKey, phaseCycle })
          await comIdempotencia(chave, processoId, tipoProcessoId, phaseKey, 'financial', el.regraId, 'Receita', desc,
            () => criarReceita(processoId, desc, cong, { ...vinc, productServiceId: prodReceita.id }),
            (id) => { item.receitaId = id; item.receita = { valor: cong.valor, moeda: cong.moeda } }, pulados, erros)
          // §13 — reprocesso bem-sucedido resolve a pendência da chave (se houver).
          await resolverPendenciaPorChave(`pend::${chave}`, 'Preço de venda resolvido e lançamento criado')
        }
      }
    }
    if (item.tarefaId || item.custoId || item.receitaId) criados.push(item)
  }
  return { criados, pulados, erros, esperados }
}

// ============================================================================
// RECONCILE POR DOCUMENTO/SERVIÇO — convergência do motor econômico da Matriz.
//   1) CRIA os itens elegíveis AGORA (gerarEconomicoDaMatriz — idempotente).
//   2) REMOVE os órfãos: lançamentos matriz cujo documento/serviço deixou de
//      existir/ser elegível (automaticKey do ciclo fora do conjunto esperado).
// Remoção SEGURA (dependência bloqueia). Filtra pelo CICLO reconciliado para não
// tocar em lançamentos de outros ciclos (reemissão).
// ============================================================================
export async function reconciliarEconomicoDaFase(
  processoId: number, tipoProcessoId: number, phaseKey: string, phaseCycle = 1,
): Promise<ResultadoMatriz & { removidas: number; bloqueadas: number }> {
  const r = await gerarEconomicoDaMatriz(processoId, tipoProcessoId, phaseKey, phaseCycle)
  const esperados = new Set(r.esperados)
  const marcaCiclo = `::c${phaseCycle}::`
  const ativos = await prisma.motorArtefato.findMany({
    where: { processoId, phaseKey, ruleSource: 'matriz', ruleKind: 'financial', status: 'active' },
    select: { id: true, automaticKey: true, targetTable: true, targetId: true },
  })
  let removidas = 0, bloqueadas = 0
  for (const a of ativos) {
    if (!a.automaticKey.includes(marcaCiclo)) continue // outro ciclo → não mexe
    if (esperados.has(a.automaticKey)) continue
    try {
      await prisma.$transaction(async (tx) => {
        if (a.targetId) {
          if (a.targetTable === 'Custo') await tx.custo.delete({ where: { id: a.targetId } }) // legado histórico
          else if (a.targetTable === 'Receita') await tx.receita.delete({ where: { id: a.targetId } })
          else if (a.targetTable === 'ObrigacaoEconomica') await removerObrigacaoOrfaTx(tx, a.targetId) // V3-native (guarda-se-paga)
        }
        await tx.motorArtefato.update({ where: { id: a.id }, data: { status: 'removed' } })
      }, { timeout: 30000, maxWait: 10000 })
      removidas++
    } catch { bloqueadas++ }
  }
  return { ...r, removidas, bloqueadas }
}

/** Reconcilia o motor econômico (por documento) em todas as fases com lançamentos matriz
 *  + a fase atual. Disparado por eventos operacionais (documento criado/removido, etc.). */
export async function reconciliarEconomicoDoProcesso(
  processoId: number,
): Promise<{ fases: number; criadas: number; removidas: number; bloqueadas: number }> {
  const proc = await prisma.processo.findUnique({ where: { id: processoId }, select: { tipoProcessoMotorId: true, faseAtualKey: true } })
  if (!proc?.tipoProcessoMotorId) return { fases: 0, criadas: 0, removidas: 0, bloqueadas: 0 }
  const arts = await prisma.motorArtefato.findMany({
    where: { processoId, ruleSource: 'matriz', ruleKind: 'financial' }, select: { phaseKey: true }, distinct: ['phaseKey'],
  })
  const fases = new Set<string>(arts.map((a) => a.phaseKey))
  if (proc.faseAtualKey) fases.add(proc.faseAtualKey)
  let criadas = 0, removidas = 0, bloqueadas = 0
  for (const f of fases) {
    const r = await reconciliarEconomicoDaFase(processoId, proc.tipoProcessoMotorId, f, 1)
    criadas += r.criados.length; removidas += r.removidas; bloqueadas += r.bloqueadas
  }
  return { fases: fases.size, criadas, removidas, bloqueadas }
}

async function comIdempotencia(
  automaticKey: string, processoId: number, tipoProcessoId: number, phaseKey: string,
  ruleKind: string, ruleId: number | null, targetTable: string, descricao: string,
  criar: () => Promise<number>, onCreated: (id: number) => void,
  pulados: { motivo: string; detalhe?: string }[], erros: string[],
) {
  let art
  try {
    art = await prisma.motorArtefato.create({
      data: {
        processoId, tipoProcessoId, phaseKey, event: 'entered',
        ruleKind, ruleSource: 'matriz', ruleId, automaticKey,
        targetTable, targetId: null, status: 'active', descricao: descricao.slice(0, 300),
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') { pulados.push({ motivo: 'já criado antes (idempotência)', detalhe: descricao }); return }
    erros.push(`${descricao}: ${(e as Error)?.message ?? 'erro'}`); return
  }
  try {
    const id = await criar()
    await prisma.motorArtefato.update({ where: { id: art.id }, data: { targetId: id } })
    onCreated(id)
  } catch (e) {
    await prisma.motorArtefato.delete({ where: { id: art.id } }).catch(() => {})
    erros.push(`${descricao}: ${(e as Error)?.message ?? 'erro'}`)
  }
}

async function acharOuCriarTipoServico(processoId: number, nome: string) {
  const existente = await prisma.tipoServico.findFirst({ where: { processoId, nome } })
  return existente ?? prisma.tipoServico.create({ data: { processoId, nome, ordem: 0 } })
}

type Vinc = { personId: number; documentoId: number; tipoServicoId: number; phaseKey: string; phaseCycle: number; productServiceId: number | null }

// ── §6 CONGELAMENTO — snapshot imutável do preço/contexto no momento do lançamento ──
interface Congelado {
  valor: number // total já calculado (unitário × quantidade)
  valorUnitario: number
  quantidade: number
  moeda: Moeda
  modoCalculo: string
  natureza: NaturezaPreco
  tabelaValorId: number | null // regra de preço utilizada (pricingRuleId)
  configId: number
  regraFinanceiraId: number | null
  contexto: Prisma.InputJsonValue
  dataReferencia: Date
  chaveIdempotencia: string
}

function congelar(
  r: ResultadoPreco, natureza: NaturezaPreco, configId: number, regraId: number | null, chave: string,
  ctx: { tipoProcessoId: number; phaseKey: string; phaseCycle: number },
): Congelado {
  const ok = r as ResultadoPrecoOK // só chamado quando motivoBloqueio() === null
  return {
    valor: ok.valor, valorUnitario: ok.valorUnitario, quantidade: ok.quantidade, moeda: ok.moeda,
    modoCalculo: ok.modoCalculo, natureza, tabelaValorId: ok.tabelaValorId, configId, regraFinanceiraId: regraId,
    contexto: { nivel: ok.nivel, prioridade: ok.prioridade, especificidade: ok.especificidade, razao: ok.razao, tipoProcessoId: ctx.tipoProcessoId, phaseKey: ctx.phaseKey, phaseCycle: ctx.phaseCycle },
    dataReferencia: new Date(), chaveIdempotencia: chave,
  }
}

// Sucesso resolvível = ok E sem conflito de mesma precedência (§5: conflito BLOQUEIA).
function motivoBloqueio(r: ResultadoPreco): { motivo: string; detalhe: string; contexto: Prisma.InputJsonValue } | null {
  if (!r.ok) {
    return { motivo: r.motivo, detalhe: r.razao, contexto: { alternativasDescartadas: r.alternativasDescartadas } as unknown as Prisma.InputJsonValue }
  }
  if (r.conflito) {
    return { motivo: 'CONFLITO_PRECO', detalhe: r.conflito.nota, contexto: { conflito: r.conflito } as unknown as Prisma.InputJsonValue }
  }
  return null
}

// §5/§6 — pendência financeira RASTREÁVEL e idempotente (chave única no banco).
async function registrarPendencia(
  p: { chave: string; processoId: number; tipoProcessoId: number; phaseKey: string; phaseCycle: number; configId: number | null; regraId: number | null; natureza: NaturezaPreco; motivo: string; detalhe: string; contexto: Prisma.InputJsonValue },
  pulados: { motivo: string; detalhe?: string }[], erros: string[],
): Promise<void> {
  try {
    await prisma.pendenciaFinanceira.create({
      data: {
        processoId: p.processoId, tipoProcessoId: p.tipoProcessoId, phaseKey: p.phaseKey, phaseCycle: p.phaseCycle,
        configFinanceiraId: p.configId, regraFinanceiraId: p.regraId, natureza: p.natureza,
        motivo: p.motivo.slice(0, 40), detalhe: p.detalhe.slice(0, 500), contexto: p.contexto,
        chaveIdempotencia: `pend::${p.chave}`,
      },
    })
    pulados.push({ motivo: `pendência financeira registrada (${p.motivo})`, detalhe: p.detalhe })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      pulados.push({ motivo: 'pendência já registrada (idempotência)', detalhe: p.detalhe }); return
    }
    erros.push(`pendência ${p.detalhe}: ${(e as Error)?.message ?? 'erro'}`)
  }
}

async function criarCusto(pid: number, descricao: string, c: Congelado, v: Vinc, escopo: EscopoGeracao = {}): Promise<number> {
  const codigo = await gerarCodigoCusto()
  const dataBase = new Date()
  // condição → vencimento (data1); parcelas eram do legado. Rastreabilidade do documento
  // (a granularidade da Matriz é por documento) preservada em observacoes; a distinção por
  // documento continua garantida pela automaticKey do MotorArtefato (…::doc:<id>).
  const ap = await aplicarCondicaoPagamento({ configId: c.configId, natureza: 'CUSTO', moeda: String(c.moeda), valor: Number(c.valor), dataBase })
  const docRef = v.documentoId ? ` · doc#${v.documentoId}` : ''
  // A condição APLICADA precisa ficar rastreável na própria obrigação — mesma
  // regra do executor. Sem isto, custo nascido pela Matriz perdia a auditoria
  // de qual condição definiu o vencimento.
  const observacoes = `Custo do motor (Matriz)${docRef}: ${descricao}${ap.resumo}`.slice(0, 300)
  // V3-native: nasce DIRETO como ObrigacaoEconomica + Ledger. NÃO grava no model Custo legado.
  // O VÍNCULO vai em coluna, não em texto: `observacoes` continua legível para quem lê
  // a linha, mas quem PROJETA a Planilha lê documentoId/tipoServicoId/personId.
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({
    natureza: 'CUSTO', valorContratado: Number(c.valor), moedaContratual: String(c.moeda), codigoOperacional: codigo,
    processoId: pid, regraFinanceiraId: c.regraFinanceiraId ?? null, vencimento: ap.data1, observacoes,
    origemTipo: 'nativo', origemId: null, criadoPorId: null,
    vinculo: vinculoDocumental(c, v, escopo),
  })
  return obrigacaoId
}

/** Vínculo + snapshot que a obrigação passa a carregar (tudo por ID). */
function vinculoDocumental(c: Congelado, v: Vinc, escopo: EscopoGeracao): VinculoDocumental {
  return {
    personId: v.personId, documentoId: v.documentoId, tipoServicoId: v.tipoServicoId,
    phaseKey: v.phaseKey, phaseCycle: v.phaseCycle,
    configFinanceiraId: v.productServiceId ?? c.configId,
    origemLancamento: escopo.origemLancamento ?? ORIGEM_AUTOMATICA,
    eventoOrigemTipo: escopo.eventoOrigemTipo ?? null,
    eventoOrigemId: escopo.eventoOrigemId ?? null,
    pricingRuleId: c.tabelaValorId, valorUnitario: c.valorUnitario, quantidade: c.quantidade,
    modoCalculoAplicado: c.modoCalculo, naturezaPreco: c.natureza,
    contextoAplicado: c.contexto, dataReferencia: c.dataReferencia,
    chaveIdempotencia: c.chaveIdempotencia,
  }
}

async function criarReceita(pid: number, descricao: string, c: Congelado, v: Vinc): Promise<number> {
  const codigo = await gerarCodigoReceita()
  const dataBase = new Date()
  // ARQUITETURA (base ÚNICA): Receita = SÓ o contrato. Sem parcelas/condição/vencimento
  // (isso vive na Cobrança). `data1` obrigatório recebe a data de criação (valor neutro).
  const row = await prisma.receita.create({
    data: {
      codigo, processoId: pid, categoria: CategoriaReceita.PASTA_DOCUMENTAL,
      descricao: descricao.slice(0, 300), moeda: c.moeda, valor: c.valor,
      fxEstimado: 1, fxRule: FxRule.VARIAVEL, nParcelas: 1, data1: dataBase, periodicidade: 'Mensal', status: ReceitaStatus.ATIVA,
      personId: v.personId, documentoId: v.documentoId, tipoServicoId: v.tipoServicoId,
      phaseKey: v.phaseKey, phaseCycle: v.phaseCycle, productServiceId: v.productServiceId, origem: 'motor',
      // §6/§8 — preço CONGELADO + rastreabilidade
      pricingRuleId: c.tabelaValorId, valorUnitario: c.valorUnitario, quantidade: c.quantidade, valorTotalCongelado: c.valor,
      modoCalculoAplicado: c.modoCalculo, naturezaPreco: c.natureza, configFinanceiraId: c.configId,
      regraFinanceiraId: c.regraFinanceiraId, contextoAplicado: c.contexto, dataReferencia: c.dataReferencia, chaveIdempotencia: c.chaveIdempotencia,
      eventos: { create: { tipo: 'CRIACAO' as const, descricao: `Receita (contrato) criada pelo motor (Matriz): ${descricao}`.slice(0, 500), valor: c.valor } },
    },
  })
  return row.id
}