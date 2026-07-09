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
      id: true, nome: true, sobrenome: true, linhaReta: true,
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
    const prodCusto = econ.custoProdutoCode ? await prisma.produtoFinanceiro.findFirst({ where: { codigo: econ.custoProdutoCode, ativo: true } }) : null
    const prodReceita = econ.receitaProdutoCode ? await prisma.produtoFinanceiro.findFirst({ where: { codigo: econ.receitaProdutoCode, ativo: true } }) : null

    const tipoServico = await acharOuCriarTipoServico(processoId, componente)
    const kw = tipoDocKeyword(regra.documentTypeCode)
    if (!kw) { pulados.push({ motivo: `documentTypeCode "${regra.documentTypeCode}" não reconhecido` }); continue }

    // (b) quem é elegível vem da REGRA
    for (const pessoa of selecionarPessoas(regra, pessoas)) {
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
        if (regra.createsCost) {
          const val = prodCusto?.valorPadrao != null ? Number(prodCusto.valorPadrao) : null
          if (val == null) pulados.push({ motivo: 'sem preço de CUSTO (ProdutoFinanceiro)', detalhe: componente })
          else await comIdempotencia(`${base}::custo`, processoId, tipoProcessoId, phaseKey, 'financial', regra.id, 'Custo', desc,
            () => criarCusto(processoId, desc, val, prodCusto!.moedaPadrao as Moeda, { ...vinc, productServiceId: prodCusto!.id }),
            (id) => { item.custoId = id; item.custo = { valor: val, moeda: prodCusto!.moedaPadrao } }, pulados, erros)
        }
        if (regra.createsRevenue) {
          const val = prodReceita?.valorPadrao != null ? Number(prodReceita.valorPadrao) : null
          if (val == null) pulados.push({ motivo: 'sem preço de RECEITA (ProdutoFinanceiro)', detalhe: componente })
          else await comIdempotencia(`${base}::receita`, processoId, tipoProcessoId, phaseKey, 'financial', regra.id, 'Receita', desc,
            () => criarReceita(processoId, desc, val, prodReceita!.moedaPadrao as Moeda, { ...vinc, productServiceId: prodReceita!.id }),
            (id) => { item.receitaId = id; item.receita = { valor: val, moeda: prodReceita!.moedaPadrao } }, pulados, erros)
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

async function criarCusto(pid: number, descricao: string, valor: number, moeda: Moeda, v: Vinc): Promise<number> {
  const codigo = await gerarCodigoCusto()
  const vencimento = new Date()
  const parcelas = gerarParcelas(valor, 1, vencimento)
  const c = await prisma.custo.create({
    data: {
      codigo, processoId: pid, tipo: TipoCusto.SERVICO, categoria: CategoriaCusto.OUTROS,
      descricao: descricao.slice(0, 300), moeda, valor,
      fxEstimado: 1, fxRule: FxRule.VARIAVEL, nParcelas: 1, vencimento, custoOperacional: false, status: CustoStatus.ATIVA,
      personId: v.personId, documentoId: v.documentoId, tipoServicoId: v.tipoServicoId,
      phaseKey: v.phaseKey, phaseCycle: v.phaseCycle, productServiceId: v.productServiceId, origem: 'motor',
      parcelas: { create: parcelas.map((p) => ({ numero: p.numero, vencimento: p.vencimento, valor: p.valor, status: 'PENDENTE' as const })) },
      eventos: { create: { tipo: 'CRIACAO' as const, descricao: `Custo criado pelo motor (Matriz): ${descricao}`.slice(0, 500), valor } },
    },
  })
  return c.id
}

async function criarReceita(pid: number, descricao: string, valor: number, moeda: Moeda, v: Vinc): Promise<number> {
  const codigo = await gerarCodigoReceita()
  const data1 = new Date()
  const parcelas = gerarParcelas(valor, 1, data1)
  const r = await prisma.receita.create({
    data: {
      codigo, processoId: pid, categoria: CategoriaReceita.PASTA_DOCUMENTAL,
      descricao: descricao.slice(0, 300), moeda, valor,
      fxEstimado: 1, fxRule: FxRule.VARIAVEL, nParcelas: 1, data1, periodicidade: 'Mensal', status: ReceitaStatus.ATIVA,
      personId: v.personId, documentoId: v.documentoId, tipoServicoId: v.tipoServicoId,
      phaseKey: v.phaseKey, phaseCycle: v.phaseCycle, productServiceId: v.productServiceId, origem: 'motor',
      parcelas: { create: parcelas.map((p) => ({ numero: p.numero, vencimento: p.vencimento, valor: p.valor, status: 'PENDENTE' as const })) },
      eventos: { create: { tipo: 'CRIACAO' as const, descricao: `Receita criada pelo motor (Matriz): ${descricao}`.slice(0, 500), valor } },
    },
  })
  return r.id
}