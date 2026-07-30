// lib/gerenciamento/catalogo-servicos.ts
// ============================================================================
// CATÁLOGO DE SERVIÇOS — a ÚNICA face de usuário do Cadastro Mestre.
//
// O Cadastro Mestre (ItemCatalogo) continua sendo a estrutura técnica interna e
// a fonte única de identidade dos itens: nenhum registro, id ou vínculo muda.
// O que deixa de existir é a SEGUNDA TELA sobre ele ("Catálogo Mestre", em
// Sistema › Cadastros Auxiliares). Tudo o que o operador precisa ver e editar
// passa por Gerenciamento › Serviços › Catálogo de Serviços.
//
// A tela mostra DUAS ORIGENS do MESMO mestre — sem cadastro paralelo e sem
// duplicar linha:
//   • `servico` — ServicoProduto (registro operacional do serviço), que é
//     projetado no ItemCatalogo por dual-write. Traz nacionalidade e código
//     público (SRV-n).
//   • `item`    — ItemCatalogo que NÃO é projeção de um ServicoProduto
//     (documento, taxa, despesa, logística, etapa cobrada, pacote…). São os
//     "itens técnicos unificados": vivem no mesmo cadastro, sem tela própria.
// O deduplicador é ESTRUTURAL: um ItemCatalogo com serviço projetado nele já
// aparece pela origem `servico`, então nunca entra de novo como `item`.
//
// NOMENCLATURA: naturezas eliminadas da arquitetura (PRODUTO, HONORARIO) nunca
// são exibidas nem oferecidas — o dado histórico segue no banco, legível pelos
// lançamentos antigos (ver lib/financeiro/catalogo-oficial.ts, fonte única da
// elegibilidade). "Produto" não é conceito desta tela nem de nenhum menu.
//
// Módulo PURO: sem Prisma, sem React — testável offline
// (scripts/catalogo-servicos-unificado.test.ts).
// ============================================================================

import {
  NATUREZAS_ITEM_OFICIAIS,
  naturezaItemOficial,
  type NaturezaItemRaw,
} from '../financeiro/catalogo-oficial' // relativo: o módulo é importado por tsx nos testes

// ── Nomenclatura de negócio ────────────────────────────────────────────────

/** Rótulo de NEGÓCIO de cada natureza oficial (o que o operador lê na tela). */
export const TIPO_ITEM_LABEL: Record<string, string> = {
  SERVICO: 'Serviço',
  DOCUMENTO: 'Documento',
  TAXA: 'Taxa',
  DESPESA: 'Despesa',
  LOGISTICA: 'Logística',
  OUTRO: 'Outro',
}

/** Tipos oferecidos no cadastro, na ordem em que o operador pensa. */
export const TIPOS_CADASTRAVEIS: readonly NaturezaItemRaw[] =
  ['SERVICO', 'DOCUMENTO', 'TAXA', 'DESPESA', 'LOGISTICA', 'OUTRO'] as const

/** Rótulo de negócio da natureza (nunca expõe nomenclatura eliminada). */
export function rotuloTipo(natureza: string | null | undefined): string {
  if (!natureza) return '—'
  return TIPO_ITEM_LABEL[natureza] ?? '—'
}

// ── Entrada (formato que as rotas já devolvem) ──────────────────────────────

/** Contadores de vínculo do ItemCatalogo (`_count` do Prisma). */
export interface ContagemVinculos {
  tiposDocumento?: number | null
  produtos?: number | null
  servicos?: number | null
  precos?: number | null
}

/** ItemCatalogo como vem de /api/gerenciamento/catalogo-mestre. */
export interface ItemMestreBruto {
  id: number
  code: string
  name: string
  descricao?: string | null
  natureza: string
  categoria?: string | null
  unidade?: string | null
  ativo: boolean
  _count?: ContagemVinculos | null
}

/** ServicoProduto como vem de /api/gerenciamento/produtos-servicos. */
export interface ServicoBruto {
  id: number
  publicCode?: string | null
  name: string
  category?: string | null
  descricao?: string | null
  unidadePadrao?: string | null
  nationality?: string | null
  ativo: boolean
  itemCatalogoId?: number | null
  /** espelho no mestre (aditivo no GET) — de onde saem unidade e vínculos. */
  itemCatalogo?: { id: number; natureza: string; unidade?: string | null; _count?: ContagemVinculos | null } | null
}

// ── Saída (linha da tela) ──────────────────────────────────────────────────

export type OrigemItem = 'servico' | 'item'

export interface ItemUnificado {
  /** chave estável de renderização (origem + id) — nunca colide entre origens. */
  chave: string
  origem: OrigemItem
  /** id na tabela de origem: ServicoProduto.id ou ItemCatalogo.id. */
  id: number
  /** id do mestre técnico, quando existe (é ele que os vínculos referenciam). */
  itemCatalogoId: number | null
  /** código PÚBLICO (SRV-n). Chave técnica interna nunca aparece na tela. */
  codigo: string | null
  nome: string
  descricao: string | null
  natureza: string
  /** rótulo de negócio da natureza. */
  tipo: string
  categoria: string | null
  unidade: string | null
  /** só serviço tem nacionalidade/modalidade. */
  nacionalidade: string | null
  ativo: boolean
  /** quantos consumidores apontam para o mestre deste item. */
  vinculos: number
  /** o item é cobrável hoje (regra estrutural, ver `ehComercializavel`). */
  comercializavel: boolean
}

const num = (v: number | null | undefined) => (typeof v === 'number' && v > 0 ? v : 0)
const txt = (v: string | null | undefined) => {
  const s = (v ?? '').trim()
  return s === '' ? null : s
}

/**
 * Vínculos que precisam sobreviver a qualquer mudança de tela: tipos de
 * documento, configurações financeiras e preços que apontam para o mestre.
 * A projeção `servicos` NÃO conta — é o próprio item se olhando no espelho.
 */
export function somarVinculos(c?: ContagemVinculos | null): number {
  if (!c) return 0
  return num(c.tiposDocumento) + num(c.produtos) + num(c.precos)
}

/**
 * O item é COMERCIALIZÁVEL (pertinente ao catálogo de venda)?
 *
 * Regra ESTRUTURAL, nunca por nome/código/texto:
 *   • serviço é comercializável por definição (é o que a empresa vende/executa);
 *   • qualquer outro item é comercializável quando já tem Configuração
 *     Financeira ou preço na Tabela de Valores apontando para ele.
 * Um documento que existe só como estrutura documental (sem config e sem preço)
 * é um item TÉCNICO: continua no mesmo cadastro, fora da visão comercial.
 */
export function ehComercializavel(natureza: string, c?: ContagemVinculos | null): boolean {
  if (natureza === 'SERVICO') return true
  return num(c?.produtos) > 0 || num(c?.precos) > 0
}

/** Linha da tela a partir do registro operacional do serviço. */
export function linhaDeServico(s: ServicoBruto): ItemUnificado {
  const cont = s.itemCatalogo?._count ?? null
  const natureza = s.itemCatalogo?.natureza ?? 'SERVICO'
  return {
    chave: `servico:${s.id}`,
    origem: 'servico',
    id: s.id,
    itemCatalogoId: s.itemCatalogoId ?? s.itemCatalogo?.id ?? null,
    codigo: txt(s.publicCode),
    nome: s.name,
    descricao: txt(s.descricao),
    natureza,
    tipo: rotuloTipo(natureza),
    categoria: txt(s.category),
    unidade: txt(s.unidadePadrao) ?? txt(s.itemCatalogo?.unidade),
    nacionalidade: txt(s.nationality) ?? 'all',
    ativo: !!s.ativo,
    vinculos: somarVinculos(cont),
    comercializavel: ehComercializavel(natureza, cont),
  }
}

/** Linha da tela a partir de um item técnico do mestre. */
export function linhaDeItem(i: ItemMestreBruto): ItemUnificado {
  return {
    chave: `item:${i.id}`,
    origem: 'item',
    id: i.id,
    itemCatalogoId: i.id,
    codigo: null,
    nome: i.name,
    descricao: txt(i.descricao),
    natureza: i.natureza,
    tipo: rotuloTipo(i.natureza),
    categoria: txt(i.categoria),
    unidade: txt(i.unidade),
    nacionalidade: null,
    ativo: !!i.ativo,
    vinculos: somarVinculos(i._count),
    comercializavel: ehComercializavel(i.natureza, i._count),
  }
}

/**
 * Unifica as duas origens em UMA lista, sem duplicar e sem inventar registro:
 *  • todo ServicoProduto entra como `servico`;
 *  • ItemCatalogo entra como `item` só quando não é projeção de um serviço
 *    (`_count.servicos === 0`) e sua natureza é OFICIAL — itens de estrutura
 *    eliminada (PRODUTO/HONORARIO) ficam preservados no banco e fora da tela.
 * Ordena por tipo e nome, para a leitura ficar estável entre cargas.
 */
export function unificarCatalogo(entrada: {
  servicos?: ServicoBruto[] | null
  itens?: ItemMestreBruto[] | null
}): ItemUnificado[] {
  const linhas = [
    ...(entrada.servicos ?? []).map(linhaDeServico),
    ...(entrada.itens ?? [])
      .filter((i) => num(i._count?.servicos) === 0 && naturezaItemOficial(i.natureza))
      .map(linhaDeItem),
  ]
  return linhas.sort((a, b) => {
    const t = ordemTipo(a.natureza) - ordemTipo(b.natureza)
    return t !== 0 ? t : a.nome.localeCompare(b.nome, 'pt-BR')
  })
}

const ordemTipo = (n: string) => {
  const i = (TIPOS_CADASTRAVEIS as readonly string[]).indexOf(n)
  return i < 0 ? TIPOS_CADASTRAVEIS.length : i
}

// ── Filtros da tela ────────────────────────────────────────────────────────

/**
 * ESCOPO da lista:
 *  • `comercial` (padrão) — só o que é cobrável hoje: exibe somente os itens
 *    comercializáveis pertinentes;
 *  • `tecnico` — os itens técnicos do mesmo cadastro (sem config e sem preço);
 *  • `todos`   — o cadastro mestre inteiro (naturezas oficiais).
 */
export type EscopoCatalogo = 'comercial' | 'tecnico' | 'todos'

export const ESCOPOS: readonly { valor: EscopoCatalogo; label: string; ajuda: string }[] = [
  { valor: 'comercial', label: 'Comercializáveis', ajuda: 'Serviços e itens com configuração financeira ou preço.' },
  { valor: 'tecnico', label: 'Itens técnicos', ajuda: 'Documentos, taxas e etapas do mesmo cadastro, ainda sem cobrança.' },
  { valor: 'todos', label: 'Todos', ajuda: 'O cadastro mestre inteiro, com a nomenclatura de negócio.' },
]

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Aplica escopo + busca (código, nome, categoria, tipo) — acento-insensível. */
export function filtrarCatalogo(
  linhas: ItemUnificado[],
  opcoes: { escopo?: EscopoCatalogo; busca?: string } = {},
): ItemUnificado[] {
  const escopo = opcoes.escopo ?? 'comercial'
  const q = norm((opcoes.busca ?? '').trim())
  return linhas.filter((l) => {
    if (escopo === 'comercial' && !l.comercializavel) return false
    if (escopo === 'tecnico' && l.comercializavel) return false
    if (!q) return true
    return norm([l.codigo ?? '', l.nome, l.categoria ?? '', l.tipo].join(' ')).includes(q)
  })
}

/** Contagem por escopo — alimenta os rótulos do seletor sem recalcular na tela. */
export function contarPorEscopo(linhas: ItemUnificado[]): Record<EscopoCatalogo, number> {
  const comercial = linhas.filter((l) => l.comercializavel).length
  return { comercial, tecnico: linhas.length - comercial, todos: linhas.length }
}

/** Naturezas oficiais reexportadas para a tela não manter segunda lista. */
export const NATUREZAS_OFICIAIS = NATUREZAS_ITEM_OFICIAIS
