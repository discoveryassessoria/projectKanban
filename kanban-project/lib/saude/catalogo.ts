// lib/saude/catalogo.ts
//
// CATÁLOGO OFICIAL E VERSIONADO das verificações de saúde.
//
// Nenhuma verificação existe "escondida no código": para o motor executar, ela
// precisa estar declarada aqui, com id imutável, domínio, criticidade, timeout,
// orientação de correção e responsável. É este catálogo que responde "quantas
// verificações existem", "quais domínios têm cobertura" e "o que ainda falta".

import type { Dominio, ModoExecucao, ResultadoVerificacao, Severidade } from './tipos'
import { DOMINIOS } from './tipos'

/** Sobe a cada mudança no conjunto de verificações. Fica gravado na execução. */
// 1.1.0 — 21/08/2026: entraram as verificações do cadastro declarativo e da
// identidade de execução (EXE-001/002, CAD-001..005, DOC-L01). Cada uma existe
// porque a classe de falha correspondente virou impossível por construção, e o que
// se vigia aqui é justamente a construção continuar valendo no ambiente real.
export const VERSAO_CATALOGO = '1.1.0'

export interface ContextoVerificacao {
  /** agora, congelado no início da rodada (execuções são comparáveis) */
  agora: Date
  modo: ModoExecucao
}

export interface Verificacao {
  /** id técnico IMUTÁVEL — nunca muda, nem se o nome mudar */
  id: string
  /** código legível, estável, usado em log e na tela */
  codigo: string
  nome: string
  descricao: string
  dominio: Dominio
  modulo: string
  /** severidade dos achados quando a verificação não define outra */
  severidadePadrao: Severidade
  /** obrigatória: sua ausência/falha impede declarar o sistema saudável */
  obrigatoria: boolean
  /** em que modos ela roda */
  modos: ModoExecucao[]
  /** versão do catálogo em que foi introduzida */
  introduzidaEm: string
  timeoutMs: number
  /** o que fazer quando falha */
  orientacao: string
  /** para onde ir corrigir */
  rotaCorrecao?: string
  /** existe correção automática segura? (id da correção) */
  correcaoAutomatica?: string | null
  responsavel: string
  ativo: boolean
  /** a verificação em si — recebe contexto, devolve achados */
  executar: (ctx: ContextoVerificacao) => Promise<ResultadoVerificacao>
}

const REGISTRO = new Map<string, Verificacao>()

/** Declara uma verificação no catálogo. Id e código duplicados são erro. */
export function registrar(v: Verificacao): Verificacao {
  if (REGISTRO.has(v.id)) throw new Error(`[saude] verificação duplicada: ${v.id}`)
  for (const existente of REGISTRO.values()) {
    if (existente.codigo === v.codigo) throw new Error(`[saude] código duplicado: ${v.codigo}`)
  }
  REGISTRO.set(v.id, v)
  return v
}

export const catalogo = (): Verificacao[] => [...REGISTRO.values()]
export const verificacaoPorId = (id: string) => REGISTRO.get(id) ?? null
export const verificacaoPorCodigo = (codigo: string) =>
  [...REGISTRO.values()].find((v) => v.codigo === codigo) ?? null

/** Verificações que rodam no modo pedido (só as ativas). */
export const elegiveis = (modo: ModoExecucao): Verificacao[] =>
  catalogo().filter((v) => v.ativo && v.modos.includes(modo))

/** Domínios declarados que ainda não têm NENHUMA verificação ativa. */
export function dominiosSemCobertura(): Dominio[] {
  const cobertos = new Set(catalogo().filter((v) => v.ativo).map((v) => v.dominio))
  return DOMINIOS.filter((d) => !cobertos.has(d))
}

/** Matriz de cobertura por domínio — alimenta a aba Cobertura da tela. */
export interface CoberturaDominio {
  dominio: Dominio
  total: number
  obrigatorias: number
  ativas: number
}
export function cobertura(): CoberturaDominio[] {
  return DOMINIOS.map((dominio) => {
    const doDominio = catalogo().filter((v) => v.dominio === dominio)
    return {
      dominio,
      total: doDominio.length,
      obrigatorias: doDominio.filter((v) => v.obrigatoria).length,
      ativas: doDominio.filter((v) => v.ativo).length,
    }
  })
}

/** Só os metadados — o que a API expõe sem serializar função. */
export const metadados = (v: Verificacao) => ({
  id: v.id, codigo: v.codigo, nome: v.nome, descricao: v.descricao, dominio: v.dominio,
  modulo: v.modulo, severidadePadrao: v.severidadePadrao, obrigatoria: v.obrigatoria,
  modos: v.modos, introduzidaEm: v.introduzidaEm, timeoutMs: v.timeoutMs,
  orientacao: v.orientacao, rotaCorrecao: v.rotaCorrecao ?? null,
  correcaoAutomatica: v.correcaoAutomatica ?? null, responsavel: v.responsavel, ativo: v.ativo,
})
