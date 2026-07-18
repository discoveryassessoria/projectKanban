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
import { gerarParcelas } from '@/lib/financeiro/parcelas'
// LOTE A · B4 — trava de estado civil (reusa a MESMA engine da árvore, não recria)
import { analyzePessoa } from '@/src/lib/document-generator'
// LOTE A · B3 — preço hierárquico (arquivo separado, testável isolado)
import { resolverPrecoPorConfigDB } from './resolver-preco-financeiro.prisma'
import type { ResultadoPreco, ResultadoPrecoOK } from './resolver-preco-financeiro'
import { resolverPendenciaPorChave } from '@/lib/financeiro/pendencia'
import { NaturezaPreco } from '@prisma/client'
import { criarTarefaDeSpec } from '@/src/services/processEngine/taskEngine'

// ── (a/c) COMPONENTE ECONÔMICO: CONFIGURÁVEL via PhaseEconomicRule ────────────
// Antes era hardcoded (switch por fase + mapa de preços). Agora o administrador
// cadastra pela tela: fase → componente (+ produtos de custo/receita separados).
// Regra aplicável = 1ª ativa cujo documentTypeCode casa (ou é null = qualquer).
// appliesTo (natureza do doc) fica pronto p/ o caso "mesma fase, doc diferente,
// componente diferente" (tradução vs original) — hoje 'any' casa tudo.
type RegraEconomica = {
  documentTypeCode: string | null
  appliesTo: string
  componentKey: string
  componentName: string
  custoProdutoCode: string | null
  receitaProdutoCode: string | null
  custoConfigId?: number | null
  receitaConfigId?: number | null
}
function resolverRegraEconomica(rules: RegraEconomica[], docCode: string): RegraEconomica | null {
  return (
    rules.find((r) => r.documentTypeCode === docCode) ?? // match exato tem prioridade
    rules.find((r) => r.documentTypeCode == null) ??      // regra "qualquer doc"
    null
  )
}

type PessoaMin = {
  id: number; nome: string; sobrenome: string | null; linhaReta: boolean
  casado: boolean; vivo: boolean
  documentos: { id: number; tipo: string }[]
}

// ── (b) SELEÇÃO DE PESSOAS: vem do target/generationRule da REGRA ────────────
function selecionarPessoas(regra: { target: string; generationRule: string }, pessoas: PessoaMin[]): PessoaMin[] {
  if (regra.generationRule === 'all_direct_line') return pessoas.filter((p) => p.linhaReta)
  if (regra.target === 'whole_process') return pessoas
  // futuros: requerente, cônjuge, pacote, entidade…
  return pessoas.filter((p) => p.linhaReta) // default conservador
}

function tipoDocKeyword(code: string): 'NASCIMENTO' | 'CASAMENTO' | 'OBITO' | null {
  const c = code.toUpperCase()
  if (c.includes('NAS')) return 'NASCIMENTO'
  if (c.includes('CAS')) return 'CASAMENTO'
  if (c.includes('OB')) return 'OBITO'
  return null
}

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
}

/**
 * Gera os itens econômicos elegíveis pela Matriz numa fase/ciclo. Idempotente.
 * Mesmo ciclo = não duplica; novo ciclo = novo conjunto.
 */
export async function gerarEconomicoDaMatriz(
  processoId: number, tipoProcessoId: number, phaseKey: string, phaseCycle = 1,
): Promise<ResultadoMatriz> {
  const criados: ItemEconomico[] = []
  const pulados: { motivo: string; detalhe?: string }[] = []
  const erros: string[] = []

  const regras = await prisma.matrizDocumental.findMany({ where: { tipoProcessoId, phaseKey, arquivado: false } })
  if (regras.length === 0) {
    pulados.push({ motivo: `sem regra na Matriz para tipoProcesso ${tipoProcessoId} + fase "${phaseKey}"` })
    return { criados, pulados, erros }
  }

  // Regras econômicas CONFIGURADAS p/ esta fase (tipo específico OU qualquer tipo).
  const economicRules = await prisma.phaseEconomicRule.findMany({
    where: { phaseKey, ativo: true, OR: [{ tipoProcessoId }, { tipoProcessoId: null }] },
    orderBy: { ordem: 'asc' },
  })

  const proc = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { arvore: { select: { pessoas: { select: {
      id: true, nome: true, sobrenome: true, linhaReta: true, casado: true, vivo: true,
      documentos: { where: { status: { notIn: ['CANCELADO', 'INVALIDO'] } }, select: { id: true, tipo: true } },
    } } } } },
  })
  const pessoas = (proc?.arvore?.pessoas ?? []) as PessoaMin[]
  if (pessoas.length === 0) { pulados.push({ motivo: 'processo sem pessoas na árvore' }); return { criados, pulados, erros } }

  for (const regra of regras) {
    const econ = resolverRegraEconomica(economicRules, regra.documentTypeCode)
    if (!econ) { pulados.push({ motivo: `fase "${phaseKey}" sem regra econômica configurada`, detalhe: `cadastre em PhaseEconomicRule (doc "${regra.documentTypeCode}")` }); continue }

    const componente = econ.componentName

    // (c) dois preços INDEPENDENTES — códigos vêm da regra configurada
    // F2 — dual-read: FK real (custoConfigId/receitaConfigId) tem prioridade; código-texto = fallback legado.
    const prodCusto = econ.custoConfigId
      ? await prisma.produtoFinanceiro.findUnique({ where: { id: econ.custoConfigId } })
      : econ.custoProdutoCode ? await prisma.produtoFinanceiro.findFirst({ where: { codigo: econ.custoProdutoCode, ativo: true } }) : null
    const prodReceita = econ.receitaConfigId
      ? await prisma.produtoFinanceiro.findUnique({ where: { id: econ.receitaConfigId } })
      : econ.receitaProdutoCode ? await prisma.produtoFinanceiro.findFirst({ where: { codigo: econ.receitaProdutoCode, ativo: true } }) : null

    const tipoServico = await acharOuCriarTipoServico(processoId, componente)
    const kw = tipoDocKeyword(regra.documentTypeCode)
    if (!kw) { pulados.push({ motivo: `documentTypeCode "${regra.documentTypeCode}" não reconhecido` }); continue }

    // (b) quem é elegível vem da REGRA
    for (const pessoa of selecionarPessoas(regra, pessoas)) {
      // (B4) TRAVA DE ESTADO CIVIL — reusa a MESMA engine da árvore.
      // Nascimento: sempre. Casamento: só se casado. Óbito: só se falecido.
      // Mesmo que um doc "errado" exista na pessoa, o motor NÃO gera fora do estado civil.
      const flags = analyzePessoa({ id: pessoa.id, nome: pessoa.nome, sobrenome: pessoa.sobrenome, casado: pessoa.casado, vivo: pessoa.vivo })
      const permitido = kw === 'NASCIMENTO' ? flags.needsBirth : kw === 'CASAMENTO' ? flags.needsMarriage : kw === 'OBITO' ? flags.needsDeath : false
      if (!permitido) { pulados.push({ motivo: `estado civil não exige ${kw.toLowerCase()}`, detalhe: `${pessoa.nome} ${pessoa.sobrenome ?? ''}`.trim() }); continue }

      for (const doc of pessoa.documentos.filter((d) => String(d.tipo).includes(kw))) {
        const nomePessoa = `${pessoa.nome} ${pessoa.sobrenome ?? ''}`.trim()
        const desc = `${componente} · ${nomePessoa}`
        const base = `${processoId}::${phaseKey}::c${phaseCycle}::matriz:${regra.id}::doc:${doc.id}` // (d) inclui ciclo
        const vinc = { personId: pessoa.id, documentoId: doc.id, tipoServicoId: tipoServico.id, phaseKey, phaseCycle }
        const item: ItemEconomico = { pessoaId: pessoa.id, documentoId: doc.id, componente }

        if (regra.createsTask) {
          await comIdempotencia(`${base}::tarefa`, processoId, tipoProcessoId, phaseKey, 'task', regra.id, 'Tarefa', `Solicitar ${componente} de ${nomePessoa}`,
            async () => (await criarTarefaDeSpec({
              titulo: `Solicitar ${componente} de ${nomePessoa}`, processoId,
              observacoes: `Motor econômico (Matriz) · fase "${phaseKey}" · ciclo ${phaseCycle} · doc ${doc.id}`,
            })).id,
            (id) => { item.tarefaId = id }, pulados, erros)
        }
        // PREÇO-FONTE-ÚNICA (§5): a Configuração Financeira NÃO é preço. Resolve SÓ
        // pela Tabela de Preços; sem fallback de valorPadrao; sem zero silencioso.
        // Sem preço válido → PENDÊNCIA rastreável (não lança). Conflito de mesma
        // precedência → BLOQUEIA + pendência. Sucesso → lança com preço CONGELADO.
        if (regra.createsCost) {
          if (!prodCusto) {
            pulados.push({ motivo: 'regra gera CUSTO mas sem Configuração Financeira de custo', detalhe: componente })
          } else {
            const chave = `${base}::custo`
            const rC = await resolverPrecoPorConfigDB(prodCusto.id, { processoId, tipoProcessoId: String(tipoProcessoId), natureza: NaturezaPreco.CUSTO })
            const bloqueio = motivoBloqueio(rC)
            if (bloqueio) {
              await registrarPendencia({ chave, processoId, tipoProcessoId, phaseKey, phaseCycle, configId: prodCusto.id, regraId: regra.id, natureza: NaturezaPreco.CUSTO, motivo: bloqueio.motivo, detalhe: `${componente}: ${bloqueio.detalhe}`, contexto: bloqueio.contexto }, pulados, erros)
            } else {
              const cong = congelar(rC, NaturezaPreco.CUSTO, prodCusto.id, regra.id, chave, { tipoProcessoId, phaseKey, phaseCycle })
              await comIdempotencia(chave, processoId, tipoProcessoId, phaseKey, 'financial', regra.id, 'Custo', desc,
                () => criarCusto(processoId, desc, cong, { ...vinc, productServiceId: prodCusto.id }),
                (id) => { item.custoId = id; item.custo = { valor: cong.valor, moeda: cong.moeda } }, pulados, erros)
              // §13 — se havia pendência para esta chave, o reprocesso bem-sucedido a resolve.
              await resolverPendenciaPorChave(`pend::${chave}`, 'Preço de custo resolvido e lançamento criado')
            }
          }
        }
        if (regra.createsRevenue) {
          if (!prodReceita) {
            pulados.push({ motivo: 'regra gera RECEITA mas sem Configuração Financeira de receita', detalhe: componente })
          } else {
            const chave = `${base}::receita`
            const rR = await resolverPrecoPorConfigDB(prodReceita.id, { processoId, tipoProcessoId: String(tipoProcessoId), natureza: NaturezaPreco.VENDA })
            const bloqueio = motivoBloqueio(rR)
            if (bloqueio) {
              await registrarPendencia({ chave, processoId, tipoProcessoId, phaseKey, phaseCycle, configId: prodReceita.id, regraId: regra.id, natureza: NaturezaPreco.VENDA, motivo: bloqueio.motivo, detalhe: `${componente}: ${bloqueio.detalhe}`, contexto: bloqueio.contexto }, pulados, erros)
            } else {
              const cong = congelar(rR, NaturezaPreco.VENDA, prodReceita.id, regra.id, chave, { tipoProcessoId, phaseKey, phaseCycle })
              await comIdempotencia(chave, processoId, tipoProcessoId, phaseKey, 'financial', regra.id, 'Receita', desc,
                () => criarReceita(processoId, desc, cong, { ...vinc, productServiceId: prodReceita.id }),
                (id) => { item.receitaId = id; item.receita = { valor: cong.valor, moeda: cong.moeda } }, pulados, erros)
              // §13 — reprocesso bem-sucedido resolve a pendência da chave (se houver).
              await resolverPendenciaPorChave(`pend::${chave}`, 'Preço de venda resolvido e lançamento criado')
            }
          }
        }
        if (item.tarefaId || item.custoId || item.receitaId) criados.push(item)
      }
    }
  }
  return { criados, pulados, erros }
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

async function criarCusto(pid: number, descricao: string, c: Congelado, v: Vinc): Promise<number> {
  const codigo = await gerarCodigoCusto()
  const vencimento = new Date()
  const parcelas = gerarParcelas(c.valor, 1, vencimento)
  const row = await prisma.custo.create({
    data: {
      codigo, processoId: pid, tipo: TipoCusto.SERVICO, categoria: CategoriaCusto.OUTROS,
      descricao: descricao.slice(0, 300), moeda: c.moeda, valor: c.valor,
      fxEstimado: 1, fxRule: FxRule.VARIAVEL, nParcelas: 1, vencimento, custoOperacional: false, status: CustoStatus.ATIVA,
      personId: v.personId, documentoId: v.documentoId, tipoServicoId: v.tipoServicoId,
      phaseKey: v.phaseKey, phaseCycle: v.phaseCycle, productServiceId: v.productServiceId, origem: 'motor',
      // §6/§8 — preço CONGELADO + rastreabilidade
      pricingRuleId: c.tabelaValorId, valorUnitario: c.valorUnitario, quantidade: c.quantidade, valorTotalCongelado: c.valor,
      modoCalculoAplicado: c.modoCalculo, naturezaPreco: c.natureza, configFinanceiraId: c.configId,
      regraFinanceiraId: c.regraFinanceiraId, contextoAplicado: c.contexto, dataReferencia: c.dataReferencia, chaveIdempotencia: c.chaveIdempotencia,
      parcelas: { create: parcelas.map((p) => ({ numero: p.numero, vencimento: p.vencimento, valor: p.valor, status: 'PENDENTE' as const })) },
      eventos: { create: { tipo: 'CRIACAO' as const, descricao: `Custo criado pelo motor (Matriz): ${descricao}`.slice(0, 500), valor: c.valor } },
    },
  })
  return row.id
}

async function criarReceita(pid: number, descricao: string, c: Congelado, v: Vinc): Promise<number> {
  const codigo = await gerarCodigoReceita()
  const data1 = new Date()
  const parcelas = gerarParcelas(c.valor, 1, data1)
  const row = await prisma.receita.create({
    data: {
      codigo, processoId: pid, categoria: CategoriaReceita.PASTA_DOCUMENTAL,
      descricao: descricao.slice(0, 300), moeda: c.moeda, valor: c.valor,
      fxEstimado: 1, fxRule: FxRule.VARIAVEL, nParcelas: 1, data1, periodicidade: 'Mensal', status: ReceitaStatus.ATIVA,
      personId: v.personId, documentoId: v.documentoId, tipoServicoId: v.tipoServicoId,
      phaseKey: v.phaseKey, phaseCycle: v.phaseCycle, productServiceId: v.productServiceId, origem: 'motor',
      // §6/§8 — preço CONGELADO + rastreabilidade
      pricingRuleId: c.tabelaValorId, valorUnitario: c.valorUnitario, quantidade: c.quantidade, valorTotalCongelado: c.valor,
      modoCalculoAplicado: c.modoCalculo, naturezaPreco: c.natureza, configFinanceiraId: c.configId,
      regraFinanceiraId: c.regraFinanceiraId, contextoAplicado: c.contexto, dataReferencia: c.dataReferencia, chaveIdempotencia: c.chaveIdempotencia,
      parcelas: { create: parcelas.map((p) => ({ numero: p.numero, vencimento: p.vencimento, valor: p.valor, status: 'PENDENTE' as const })) },
      eventos: { create: { tipo: 'CRIACAO' as const, descricao: `Receita criada pelo motor (Matriz): ${descricao}`.slice(0, 500), valor: c.valor } },
    },
  })
  return row.id
}