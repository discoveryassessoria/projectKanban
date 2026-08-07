// lib/gerenciamento/classificacao-exclusao.ts
//
// CLASSIFICAÇÃO CANÔNICA DE DEPENDÊNCIAS — fonte ÚNICA e PURA da regra que decide
// se um cadastro pode ser excluído definitivamente.
//
// Existem exatamente DUAS classes. Não existe terceira via, nem "meio termo":
//
//   CONFIGURACAO   → o registro apenas PARAMETRIZA o cadastro (como precificar,
//                    quando lançar, a que fase se aplica, a que documento se
//                    liga). Nunca é histórico. NUNCA bloqueia exclusão: é
//                    removido em cascata (se exclusivo) ou desvinculado (se
//                    compartilhado).
//
//   FATO_HISTORICO → o registro é PROVA de que algo aconteceu de verdade: um
//                    valor lançado, um pagamento, uma cobrança, um documento
//                    emitido, um uso dentro de um Processo real. É IMUTÁVEL:
//                    nunca é apagado, e a sua simples existência proíbe a
//                    exclusão definitiva (o cadastro é INATIVADO).
//
// A regra final é literal e vive aqui (nunca reescrita nos chamadores):
//
//     deletionAllowed = historicalFacts.total === 0
//
// Somar dependências de configuração nessa conta é o defeito que este módulo
// existe para tornar impossível: uma Regra de Aplicabilidade Econômica ou uma
// Configuração Financeira JAMAIS bloqueiam a exclusão por si sós.

export type ClasseDependencia = "CONFIGURACAO" | "FATO_HISTORICO"

/** O que o motor faz com uma dependência de configuração ao excluir o dono. */
export type AcaoConfiguracional =
  | "EXCLUIR" // pertence exclusivamente ao cadastro → some junto
  | "DESVINCULAR" // é cadastro mestre compartilhado → só o vínculo é desfeito

/**
 * ENTIDADES DE CONFIGURAÇÃO. Chave canônica → rótulo humano.
 * Toda chave listada aqui é, por definição, NÃO-HISTÓRICA.
 */
export const ENTIDADES_CONFIGURACAO = {
  ConfiguracaoFinanceira: "Configuração Financeira",
  RegraAplicabilidadeEconomica: "Regra de Aplicabilidade Econômica",
  AutomacaoFinanceiraDeFase: "Automação Financeira de Fase",
  RegraDePreco: "Regra de Preço (Tabela de Valores)",
  VinculoTabelaPreco: "Vínculo com Tabela de Preços",
  AplicacaoTerritorial: "Aplicação territorial (países/regiões)",
  VinculoCondicaoPagamento: "Vínculo com Condição de Pagamento",
  VinculoConfigFinanceiraServico: "Vínculo Serviço ↔ Configuração Financeira",
  VinculoTipoServico: "Vínculo com Tipo de Serviço",
  VinculoTipoDocumento: "Vínculo com Tipo de Documento",
  ItemCatalogoMestre: "Item do Cadastro Mestre",
  ProjecaoServicoServico: "Projeção de serviço no Cadastro Mestre",
} as const

/**
 * FATOS HISTÓRICOS. Chave canônica → rótulo humano.
 * Toda chave listada aqui é IMUTÁVEL: nunca apagada, sempre bloqueia hard delete.
 */
export const ENTIDADES_FATO_HISTORICO = {
  Receita: "Receita lançada",
  Custo: "Custo lançado",
  ObrigacaoEconomica: "Obrigação econômica (motor financeiro)",
  PendenciaFinanceira: "Pendência financeira registrada em processo",
  NecessidadeDocumental: "Necessidade documental em processo",
  DocumentoGerado: "Documento gerado",
  EvidenciaRegistral: "Evidência registral",
} as const

export type ChaveConfiguracao = keyof typeof ENTIDADES_CONFIGURACAO
export type ChaveFatoHistorico = keyof typeof ENTIDADES_FATO_HISTORICO

const SET_CONFIG = new Set<string>(Object.keys(ENTIDADES_CONFIGURACAO))
const SET_FATO = new Set<string>(Object.keys(ENTIDADES_FATO_HISTORICO))

/** Classifica uma chave canônica. Chave desconhecida é ERRO — nunca "assume histórico". */
export function classificar(entidade: string): ClasseDependencia {
  if (SET_CONFIG.has(entidade)) return "CONFIGURACAO"
  if (SET_FATO.has(entidade)) return "FATO_HISTORICO"
  throw new Error(
    `Entidade "${entidade}" não está classificada em lib/gerenciamento/classificacao-exclusao.ts. ` +
      `Classifique-a como CONFIGURACAO ou FATO_HISTORICO antes de usá-la na análise de exclusão.`,
  )
}

export function ehConfiguracao(entidade: string): boolean {
  return SET_CONFIG.has(entidade)
}
export function ehFatoHistorico(entidade: string): boolean {
  return SET_FATO.has(entidade)
}

export function rotuloDe(entidade: string): string {
  const c = ENTIDADES_CONFIGURACAO as Record<string, string>
  const f = ENTIDADES_FATO_HISTORICO as Record<string, string>
  return c[entidade] ?? f[entidade] ?? entidade
}

export interface DependenciaConfiguracional {
  entidade: ChaveConfiguracao
  rotulo: string
  quantidade: number
  acao: AcaoConfiguracional
  ids: number[]
}

export interface FatoHistoricoDetectado {
  entidade: ChaveFatoHistorico
  rotulo: string
  quantidade: number
}

export function dependencia(
  entidade: ChaveConfiguracao,
  quantidade: number,
  acao: AcaoConfiguracional,
  ids: number[] = [],
): DependenciaConfiguracional {
  return { entidade, rotulo: ENTIDADES_CONFIGURACAO[entidade], quantidade, acao, ids }
}

export function fato(entidade: ChaveFatoHistorico, quantidade: number): FatoHistoricoDetectado {
  return { entidade, rotulo: ENTIDADES_FATO_HISTORICO[entidade], quantidade }
}

export function totalizar<T extends { quantidade: number }>(itens: T[]): number {
  return itens.reduce((s, i) => s + i.quantidade, 0)
}

/**
 * A REGRA. Literal, em um lugar só: só o fato histórico bloqueia.
 * `configDependencies` NÃO entra nesta conta — nem somado, nem como fallback.
 */
export function permiteExclusaoDefinitiva(fatos: { total: number }): boolean {
  return fatos.total === 0
}

/** Espelho da regra: sem hard delete, o caminho é inativar preservando o histórico. */
export function exigeInativacao(fatos: { total: number }): boolean {
  return !permiteExclusaoDefinitiva(fatos)
}
