// src/services/financeiro/pendencias-parametrizacao.ts
// ============================================================================
// PENDÊNCIAS DE PARAMETRIZAÇÃO — o que falta para uma regra poder gerar dinheiro.
//
// POR QUE ISTO É DERIVADO, E NÃO UMA TABELA
// -----------------------------------------
// "Falta o custo de Apostilamento de Certidão" é uma FUNÇÃO do cadastro: no
// instante em que o preço for cadastrado, a pendência deixa de existir. Guardá-la
// numa tabela criaria uma segunda verdade que envelhece — alguém preencheria o
// preço e a lista continuaria acusando falta até que outra rotina a limpasse.
// Aqui a lista é calculada toda vez, a partir das mesmas tabelas que o motor lê.
//
// Duas perguntas, um só apurador:
//   • a tela administrativa pergunta "o que falta no cadastro?" (visão geral);
//   • o guard de publicação pergunta "esta regra pode ser publicada?" (uma regra).
// Se fossem dois códigos, a tela dispensaria o que o guard barra — e o operador
// aprenderia a não confiar em nenhum dos dois.
// ============================================================================

import { prisma } from "@/lib/prisma"
import { resolverPrecoPorConfigDB } from "@/src/lib/motor/resolver-preco-financeiro.prisma"
import { NaturezaPreco } from "@prisma/client"

/** Marcador de valor de andaime — nunca pode ser publicado como preço real. */
export const MARCA_PLACEHOLDER = "[AJUSTAR]"

export type TipoPendencia =
  | "SEM_PRECO_DE_CUSTO"
  | "SEM_PRECO_DE_VENDA"
  | "SEM_CONFIG_DE_CUSTO"
  | "SEM_CONFIG_DE_VENDA"
  | "SEM_FORNECEDOR"
  | "SEM_POLITICA_COMERCIAL"
  | "COMPONENTE_INATIVO"
  | "REGRA_NAO_PUBLICADA"
  | "PRECO_PLACEHOLDER"

export interface Pendencia {
  tipo: TipoPendencia
  /** o que falta, em uma frase que o operador entende sem saber o schema */
  mensagem: string
  /** onde preencher */
  onde: string
  phaseKey: string | null
  componentKey: string | null
  componentName: string | null
  configFinanceiraId: number | null
  regraDocumentalId: number | null
  /** true = impede publicação/execução; false = alerta */
  bloqueia: boolean
}

const ONDE = {
  preco: "Gerenciamento › Financeiro › Tabela de Valores",
  config: "Gerenciamento › Financeiro › Configuração Financeira",
  componente: "Gerenciamento › Financeiro › Aplicabilidade Econômica",
  fornecedor: "Gerenciamento › Cadastros › Fornecedores",
  matriz: "Gerenciamento › Documentos › Regras Documentais",
} as const

/** Um preço vigente existe e é válido? `valor <= 0` já é descartado pelo resolvedor. */
async function precoResolve(configId: number, natureza: NaturezaPreco): Promise<boolean> {
  const r = await resolverPrecoPorConfigDB(configId, { natureza }).catch(() => null)
  return !!r && r.ok && !r.conflito
}

/** A configuração tem alguma linha de preço marcada como andaime? */
async function temPlaceholder(configId: number): Promise<boolean> {
  const n = await prisma.tabelaValor.count({
    where: { configuracaoFinanceiraItemId: configId, arquivado: false, name: { contains: MARCA_PLACEHOLDER } },
  })
  return n > 0
}

/**
 * Pendências de UM componente econômico. É a unidade que o guard de publicação
 * consulta e que a tela lista.
 */
export async function pendenciasDoComponente(econId: number): Promise<Pendencia[]> {
  const econ = await prisma.phaseEconomicRule.findUnique({ where: { id: econId } })
  if (!econ) return []
  const p: Pendencia[] = []
  const base = {
    phaseKey: econ.phaseKey, componentKey: econ.componentKey, componentName: econ.componentName,
    regraDocumentalId: null,
  }

  if (!econ.ativo) {
    p.push({
      ...base, tipo: "COMPONENTE_INATIVO", configFinanceiraId: null, bloqueia: true,
      mensagem: `"${econ.componentName}" está inativo — não gera custo nem receita`,
      onde: ONDE.componente,
    })
  }

  // ── lado do CUSTO ────────────────────────────────────────────────────────
  if (econ.custoConfigId) {
    if (!(await precoResolve(econ.custoConfigId, NaturezaPreco.CUSTO))) {
      p.push({
        ...base, tipo: "SEM_PRECO_DE_CUSTO", configFinanceiraId: econ.custoConfigId, bloqueia: true,
        mensagem: `Falta o custo de ${econ.componentName}`, onde: ONDE.preco,
      })
    }
    if (await temPlaceholder(econ.custoConfigId)) {
      p.push({
        ...base, tipo: "PRECO_PLACEHOLDER", configFinanceiraId: econ.custoConfigId, bloqueia: true,
        mensagem: `${econ.componentName} tem preço de custo marcado ${MARCA_PLACEHOLDER}`, onde: ONDE.preco,
      })
    }
    const cfg = await prisma.produtoFinanceiro.findUnique({
      where: { id: econ.custoConfigId },
      select: { fornecedorPadraoId: true, repasse: true, reembolsavel: true, cobravelDoCliente: true },
    })
    if (cfg && cfg.fornecedorPadraoId == null) {
      p.push({
        ...base, tipo: "SEM_FORNECEDOR", configFinanceiraId: econ.custoConfigId, bloqueia: false,
        mensagem: `Fornecedor não definido para ${econ.componentName}`, onde: ONDE.fornecedor,
      })
    }
    if (cfg && !cfg.repasse && !cfg.reembolsavel && !cfg.cobravelDoCliente) {
      p.push({
        ...base, tipo: "SEM_POLITICA_COMERCIAL", configFinanceiraId: econ.custoConfigId, bloqueia: false,
        mensagem: `${econ.componentName} não declara política (absorvido / reembolsável / repassado)`,
        onde: ONDE.config,
      })
    }
  } else {
    p.push({
      ...base, tipo: "SEM_CONFIG_DE_CUSTO", configFinanceiraId: null, bloqueia: true,
      mensagem: `${econ.componentName} não tem Configuração Financeira de custo`, onde: ONDE.componente,
    })
  }

  // ── lado da RECEITA ──────────────────────────────────────────────────────
  // Ausência de config de receita NÃO bloqueia: há serviço que a Discovery
  // absorve e não cobra. O que bloqueia é declarar que cobra e não ter preço.
  if (econ.receitaConfigId) {
    if (!(await precoResolve(econ.receitaConfigId, NaturezaPreco.VENDA))) {
      p.push({
        ...base, tipo: "SEM_PRECO_DE_VENDA", configFinanceiraId: econ.receitaConfigId, bloqueia: true,
        mensagem: `Falta o preço de venda de ${econ.componentName}`, onde: ONDE.preco,
      })
    }
    if (await temPlaceholder(econ.receitaConfigId)) {
      p.push({
        ...base, tipo: "PRECO_PLACEHOLDER", configFinanceiraId: econ.receitaConfigId, bloqueia: true,
        mensagem: `${econ.componentName} tem preço de venda marcado ${MARCA_PLACEHOLDER}`, onde: ONDE.preco,
      })
    }
  }

  return p
}

/**
 * Estados que a PRÓPRIA publicação resolve. Eles bloqueiam a EXECUÇÃO do motor
 * — e é por isso que são pendências —, mas não podem bloquear o ato de publicar:
 * publicar é justamente ativar o componente e publicar a regra. Tratá-los como
 * impedimento faria o estado dizer "não pode publicar" enquanto a publicação
 * diria "posso", e o operador olharia um botão desabilitado sem motivo.
 */
const RESOLVIDOS_PELA_PUBLICACAO: TipoPendencia[] = ["COMPONENTE_INATIVO", "REGRA_NAO_PUBLICADA"]

/**
 * O que IMPEDE publicar, entre as pendências apuradas. Uma regra só, usada pelo
 * estado do assistente e pela publicação coordenada — se fossem duas, o botão e
 * o servidor discordariam.
 */
export function impedimentosDePublicacao(pendencias: Pendencia[]): Pendencia[] {
  return pendencias.filter((p) => p.bloqueia && !RESOLVIDOS_PELA_PUBLICACAO.includes(p.tipo))
}

export interface RelatorioPendencias {
  componentes: number
  componentesProntos: number
  pendencias: Pendencia[]
  /** quantas impedem publicação/execução */
  bloqueantes: number
}

/**
 * Visão geral do cadastro — o que a tela administrativa mostra.
 *
 * `phaseKeys` recorta o ESCOPO. Sem ele, a apuração é do cadastro inteiro, o que
 * é certo para o painel global e ERRADO para o assistente: uma pendência de
 * outro tipo de processo bloquearia a publicação deste. O escopo é do chamador,
 * não uma decisão desta função.
 */
export async function pendenciasDaParametrizacao(
  filtro?: { phaseKey?: string; phaseKeys?: string[] },
): Promise<RelatorioPendencias> {
  const escopoFase = filtro?.phaseKey
    ? { phaseKey: filtro.phaseKey }
    : filtro?.phaseKeys?.length ? { phaseKey: { in: filtro.phaseKeys } } : {}
  const econs = await prisma.phaseEconomicRule.findMany({
    where: escopoFase,
    select: { id: true }, orderBy: [{ phaseKey: "asc" }, { ordem: "asc" }],
  })
  const pendencias: Pendencia[] = []
  let prontos = 0
  for (const e of econs) {
    const p = await pendenciasDoComponente(e.id)
    if (p.length === 0) prontos++
    pendencias.push(...p)
  }

  // Regra documental existente mas não publicada — o motor não a executa.
  const naoPublicadas = await prisma.matrizDocumental.findMany({
    where: { arquivado: false, status: { not: "PUBLICADA" }, ...escopoFase },
    select: { id: true, phaseKey: true, status: true, documentTypeCode: true },
  })
  for (const r of naoPublicadas) {
    pendencias.push({
      tipo: "REGRA_NAO_PUBLICADA", bloqueia: true,
      mensagem: `Regra documental de "${r.documentTypeCode}" ainda não publicada (${r.status})`,
      onde: ONDE.matriz,
      phaseKey: r.phaseKey, componentKey: null, componentName: null,
      configFinanceiraId: null, regraDocumentalId: r.id,
    })
  }

  return {
    componentes: econs.length,
    componentesProntos: prontos,
    pendencias,
    bloqueantes: pendencias.filter((x) => x.bloqueia).length,
  }
}

/**
 * A regra documental pode ser PUBLICADA? Publicar é autorizar o motor a lançar
 * dinheiro; sem preço vigente ele não lançaria — registraria pendência. Barrar
 * aqui transforma um erro silencioso e tardio numa recusa imediata e explicada.
 */
export async function podePublicarRegraDocumental(
  regraId: number,
): Promise<{ pode: boolean; impedimentos: Pendencia[] }> {
  const regra = await prisma.matrizDocumental.findUnique({ where: { id: regraId } })
  if (!regra) return { pode: false, impedimentos: [] }
  // Regra que não gera dinheiro não depende de preço nenhum.
  if (!regra.createsCost && !regra.createsRevenue) return { pode: true, impedimentos: [] }

  const econs = await prisma.phaseEconomicRule.findMany({
    where: { phaseKey: regra.phaseKey ?? "", ativo: true },
    select: { id: true },
  })
  if (econs.length === 0) {
    return {
      pode: false,
      impedimentos: [{
        tipo: "SEM_CONFIG_DE_CUSTO", bloqueia: true,
        mensagem: `A fase "${regra.phaseKey}" não tem nenhum componente econômico ativo — a regra geraria custo sem ter o que lançar`,
        onde: ONDE.componente,
        phaseKey: regra.phaseKey, componentKey: null, componentName: null,
        configFinanceiraId: null, regraDocumentalId: regraId,
      }],
    }
  }
  const impedimentos: Pendencia[] = []
  for (const e of econs) {
    const p = await pendenciasDoComponente(e.id)
    impedimentos.push(...p.filter((x) => x.bloqueia).map((x) => ({ ...x, regraDocumentalId: regraId })))
  }
  return { pode: impedimentos.length === 0, impedimentos }
}
