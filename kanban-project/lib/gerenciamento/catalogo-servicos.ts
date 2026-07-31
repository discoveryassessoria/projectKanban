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
//   • `servico` — ServicoProduto (registro operacional do serviço), projetado no
//     ItemCatalogo. Traz o código público (SRV-n) e a aplicação territorial.
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
import {
  resumoTerritorial, textoBuscavel, aplicaAoPais,
  type PaisAplicavel, type SelecaoTerritorial,
} from './aplicacao-territorial'

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

/** Categoria oficial como as rotas devolvem: id (referência) + nome (exibição). */
export interface CategoriaRef {
  id: number
  nome: string
  code?: string
}

/** ItemCatalogo como vem de /api/gerenciamento/catalogo-mestre. */
export interface ItemMestreBruto {
  id: number
  code: string
  name: string
  descricao?: string | null
  natureza: string
  /** REFERÊNCIA estrutural. O nome vem junto só para exibir. */
  categoriaId?: number | null
  categoria?: CategoriaRef | null
  unidade?: string | null
  ativo: boolean
  _count?: ContagemVinculos | null
}

/** ServicoProduto como vem de /api/gerenciamento/produtos-servicos. */
export interface ServicoBruto {
  id: number
  publicCode?: string | null
  name: string
  descricao?: string | null
  unidadePadrao?: string | null
  /** Indicador explícito de aplicação global ("Todas"). */
  aplicacaoGlobal?: boolean | null
  /** Vínculos reais com o cadastro de Países e Regiões, na ordem de criação. */
  paises?: { paisId: number }[] | null
  ativo: boolean
  itemCatalogoId?: number | null
  /** espelho no mestre (aditivo no GET) — de onde saem unidade e vínculos. */
  itemCatalogo?: {
    id: number
    natureza: string
    unidade?: string | null
    /** A categoria vive NO MESTRE — portador único, sem cópia no serviço. */
    categoriaId?: number | null
    categoria?: CategoriaRef | null
    _count?: ContagemVinculos | null
  } | null
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
  /** REFERÊNCIA à categoria oficial. É por ela que se filtra. */
  categoriaId: number | null
  /** Nome da categoria — exibição apenas. Nunca usado para localizar entidade. */
  categoria: string | null
  unidade: string | null
  /**
   * Aplicação territorial do item. `null` para item TÉCNICO: o conceito é do
   * serviço, e inventar um estado para quem não tem seria mentir na listagem.
   */
  territorio: SelecaoTerritorial | null
  /** Família de leitura — separa venda de item cobrado relacionado. */
  grupo: GrupoCatalogo
  /**
   * Só faz sentido em item de natureza DOCUMENTO: existe um Documento Mestre
   * (TipoDocumentoCadastro) apontando para este item? Se não existe, a linha é
   * um cadastro documental solto no catálogo — o que a arquitetura não admite.
   */
  documentoMestreVinculado: boolean | null
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

// ── Grupos de leitura do catálogo ──────────────────────────────────────────
// O catálogo mostra duas famílias que NÃO podem se confundir na tela:
//
//   • `servico_pacote`         — o que a empresa VENDE (serviço ou pacote);
//   • `documento_relacionado`  — o que é COBRADO POR TABELA junto do serviço
//     (documento, taxa, despesa, logística, outros). Uma certidão vive aqui: no
//     catálogo ela é só a REFERÊNCIA comercial/financeira ao Documento Mestre,
//     nunca um cadastro documental. A fonte oficial dela continua sendo
//     Gerenciamento › Documentos e Protocolos › Documentos.
//
// A separação é ESTRUTURAL — natureza do item e unidade de cobrança —, nunca
// por nome, código ou texto (P3).

export type GrupoCatalogo = 'servico_pacote' | 'documento_relacionado'

export const GRUPOS: readonly { valor: GrupoCatalogo; titulo: string; ajuda: string }[] = [
  { valor: 'servico_pacote', titulo: 'Serviços e Pacotes', ajuda: 'O que a empresa vende e executa.' },
  { valor: 'documento_relacionado', titulo: 'Documentos e Itens Relacionados', ajuda: 'Itens cobrados junto do serviço. O cadastro oficial do documento vive em Documentos e Protocolos.' },
]

export const GRUPO_TITULO: Record<GrupoCatalogo, string> = {
  servico_pacote: 'Serviços e Pacotes',
  documento_relacionado: 'Documentos e Itens Relacionados',
}

/**
 * PACOTE não é uma natureza do Cadastro Mestre — é uma UNIDADE de cobrança
 * (`UnidadeItem.PACOTE`). Um pacote vendido é, portanto, um item cuja unidade é
 * pacote. Regra estrutural: nada aqui olha o nome do item.
 */
export function ehPacote(unidade: string | null | undefined): boolean {
  return (unidade ?? '').trim().toUpperCase() === 'PACOTE'
}

/** Grupo do item — a única função que classifica a família de leitura. */
export function grupoDoItem(l: { natureza: string; unidade: string | null }): GrupoCatalogo {
  if (l.natureza === 'SERVICO' || ehPacote(l.unidade)) return 'servico_pacote'
  return 'documento_relacionado'
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
  const unidade = txt(s.unidadePadrao) ?? txt(s.itemCatalogo?.unidade)
  return {
    grupo: grupoDoItem({ natureza, unidade }),
    documentoMestreVinculado: natureza === 'DOCUMENTO' ? num(cont?.tiposDocumento) > 0 : null,
    chave: `servico:${s.id}`,
    origem: 'servico',
    id: s.id,
    itemCatalogoId: s.itemCatalogoId ?? s.itemCatalogo?.id ?? null,
    codigo: txt(s.publicCode),
    nome: s.name,
    descricao: txt(s.descricao),
    natureza,
    tipo: rotuloTipo(natureza),
    categoriaId: s.itemCatalogo?.categoriaId ?? s.itemCatalogo?.categoria?.id ?? null,
    categoria: txt(s.itemCatalogo?.categoria?.nome),
    unidade,
    // Ausência do campo (payload antigo) lê como GLOBAL — mesmo default do banco.
    territorio: s.aplicacaoGlobal === false
      ? { global: false, paisIds: (s.paises ?? []).map((v) => v.paisId) }
      : { global: true, paisIds: [] },
    ativo: !!s.ativo,
    vinculos: somarVinculos(cont),
    comercializavel: ehComercializavel(natureza, cont),
  }
}

/** Linha da tela a partir de um item técnico do mestre. */
export function linhaDeItem(i: ItemMestreBruto): ItemUnificado {
  const unidade = txt(i.unidade)
  return {
    grupo: grupoDoItem({ natureza: i.natureza, unidade }),
    // Certidão/documento só é legítimo no catálogo quando é REFERÊNCIA a um
    // Documento Mestre. Sem esse vínculo, é cadastro documental duplicado.
    documentoMestreVinculado: i.natureza === 'DOCUMENTO' ? num(i._count?.tiposDocumento) > 0 : null,
    chave: `item:${i.id}`,
    origem: 'item',
    id: i.id,
    itemCatalogoId: i.id,
    codigo: null,
    nome: i.name,
    descricao: txt(i.descricao),
    natureza: i.natureza,
    tipo: rotuloTipo(i.natureza),
    categoriaId: i.categoriaId ?? i.categoria?.id ?? null,
    categoria: txt(i.categoria?.nome),
    unidade,
    territorio: null,
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
 *  • `comercial` (padrão) — SÓ o que a empresa efetivamente vende: serviços e
 *    pacotes com relevância comercial. Documento/taxa NÃO entram aqui, mesmo
 *    tendo preço — preço não transforma certidão em serviço;
 *  • `relacionados` — os itens cobrados junto do serviço (documentos, taxas,
 *    despesas, logística), que existem para serem referenciados pela
 *    configuração financeira;
 *  • `todos` — o cadastro inteiro, exibido em DUAS SEÇÕES separadas, para que a
 *    mistura visual nunca leve a ler documento como serviço.
 */
export type EscopoCatalogo = 'comercial' | 'relacionados' | 'todos'

export const ESCOPOS: readonly { valor: EscopoCatalogo; label: string; ajuda: string }[] = [
  { valor: 'comercial', label: 'Comercializáveis', ajuda: 'Serviços e pacotes efetivamente vendidos.' },
  { valor: 'relacionados', label: 'Itens cobrados relacionados', ajuda: 'Documentos, taxas e etapas cobrados junto do serviço. O cadastro oficial do documento vive em Documentos e Protocolos.' },
  { valor: 'todos', label: 'Todos', ajuda: 'O cadastro inteiro, separado por família — venda de um lado, itens relacionados do outro.' },
]

/**
 * A linha pertence ao escopo COMERCIAL? Duas condições, ambas estruturais:
 * ser da família de venda E ter relevância comercial. É a regra que tira a
 * certidão precificada da aba "Comercializáveis".
 */
export function ehDoEscopoComercial(l: ItemUnificado): boolean {
  return l.grupo === 'servico_pacote' && l.comercializavel
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Rótulo da coluna "Aplicação" na listagem. Item técnico devolve `null` — não
 * tem território, e escrever "Sem aplicação territorial" ali seria afirmar algo
 * que não foi decidido sobre ele.
 */
export function rotuloTerritorio(l: ItemUnificado, paises: PaisAplicavel[]): string | null {
  return l.territorio ? resumoTerritorial(l.territorio, paises) : null
}

/**
 * FILTRO por país: um id do cadastro, ou `'global'` para ver só o que se aplica
 * a todos. Item sem território nunca casa com filtro territorial. Um item GLOBAL
 * casa com QUALQUER país — inclusive um cadastrado depois.
 */
export type FiltroPais = number | 'global' | null

/**
 * Filtros da listagem. Toda entidade se filtra por ID (categoria, país); tipo e
 * status vêm da fonte oficial; e a BUSCA LIVRE alcança apenas conteúdo próprio
 * do registro — código, nome e descrição. Procurar categoria ou país digitando
 * o nome não é oferecido: para isso existe o filtro por id.
 */
export interface FiltrosCatalogo {
  escopo?: EscopoCatalogo
  busca?: string
  categoriaId?: number | null
  pais?: FiltroPais
  /** Natureza oficial do item (`NaturezaItem`), não rótulo de tela. */
  natureza?: string | null
  ativo?: boolean | null
}

export function filtrarCatalogo(linhas: ItemUnificado[], opcoes: FiltrosCatalogo = {}): ItemUnificado[] {
  const escopo = opcoes.escopo ?? 'comercial'
  const q = norm((opcoes.busca ?? '').trim())
  const pais = opcoes.pais ?? null
  const categoriaId = opcoes.categoriaId ?? null
  const natureza = opcoes.natureza ?? null
  const ativo = opcoes.ativo ?? null
  return linhas.filter((l) => {
    if (escopo === 'comercial' && !ehDoEscopoComercial(l)) return false
    if (escopo === 'relacionados' && ehDoEscopoComercial(l)) return false
    if (categoriaId !== null && l.categoriaId !== categoriaId) return false
    if (natureza !== null && l.natureza !== natureza) return false
    if (ativo !== null && l.ativo !== ativo) return false
    if (pais !== null) {
      if (!l.territorio) return false
      if (pais === 'global') { if (!l.territorio.global) return false }
      else if (!aplicaAoPais(l.territorio, pais)) return false
    }
    if (!q) return true
    // Conteúdo PRÓPRIO do registro apenas.
    return norm([l.codigo ?? '', l.nome, l.descricao ?? ''].join(' ')).includes(q)
  })
}

/** Contagem por escopo — alimenta os rótulos do seletor sem recalcular na tela. */
export function contarPorEscopo(linhas: ItemUnificado[]): Record<EscopoCatalogo, number> {
  const comercial = linhas.filter(ehDoEscopoComercial).length
  return { comercial, relacionados: linhas.length - comercial, todos: linhas.length }
}

/**
 * Agrupa para a exibição em SEÇÕES (usada na aba "Todos"). Devolve os grupos na
 * ordem oficial e sem seção vazia — a separação existe para orientar a leitura,
 * não para criar cabeçalho sem conteúdo.
 */
export function agruparParaExibicao(
  linhas: ItemUnificado[],
): { grupo: GrupoCatalogo; titulo: string; ajuda: string; linhas: ItemUnificado[] }[] {
  return GRUPOS
    .map((g) => ({ grupo: g.valor, titulo: g.titulo, ajuda: g.ajuda, linhas: linhas.filter((l) => l.grupo === g.valor) }))
    .filter((s) => s.linhas.length > 0)
}

/** Naturezas oficiais reexportadas para a tela não manter segunda lista. */
export const NATUREZAS_OFICIAIS = NATUREZAS_ITEM_OFICIAIS
