// lib/gerenciamento/aplicacao-territorial.ts
// ============================================================================
// APLICAÇÃO TERRITORIAL DE UM ITEM DO CATÁLOGO — fonte única das regras.
//
// Substitui o campo textual único (`ServicoProduto.nationality`, congelado) por
// uma seleção MÚLTIPLA sobre o cadastro oficial de Países e Regiões, com uma
// opção especial "Todas" que significa APLICAÇÃO GLOBAL — e não "todos os países
// existentes hoje". Essa distinção é o coração do módulo:
//
//   • global = true  → indicador explícito. NENHUM vínculo individual é criado,
//     e por isso um país cadastrado amanhã já nasce abrangido.
//   • global = false → valem exatamente os países vinculados. Nenhum país
//     vinculado = SEM APLICAÇÃO TERRITORIAL (estado válido, quando o tipo do
//     item permite).
//
// As duas representações são MUTUAMENTE EXCLUSIVAS e o módulo garante isso em
// toda transição: marcar "Todas" limpa a seleção individual; escolher um país
// desmarca "Todas". Não existe estado intermediário representável.
//
// Módulo PURO: sem Prisma, sem React — testável offline
// (scripts/servico-aplicacao-territorial.test.ts).
// ============================================================================

/** País como vem do cadastro oficial (CatalogoPais). */
export interface PaisAplicavel {
  id: number
  countryKey: string
  countryLabel: string
  nationalityKey?: string | null
  flag?: string | null
  ativo?: boolean
}

/** Estado territorial efetivo de um item. */
export type EstadoTerritorial = 'global' | 'paises' | 'sem_aplicacao'

/**
 * Seleção territorial. Invariante mantida por este módulo:
 * `global === true` implica `paisIds.length === 0`.
 */
export interface SelecaoTerritorial {
  global: boolean
  paisIds: number[]
}

/** Rótulo da opção especial, em um lugar só (UI e testes leem daqui). */
export const ROTULO_TODAS = 'Todas'

/** Rótulos dos estados na listagem do catálogo. */
export const ROTULO_GLOBAL = 'Todos os países'
export const ROTULO_SEM_APLICACAO = 'Sem aplicação territorial'

// ── Normalização de entrada ────────────────────────────────────────────────

/**
 * Ids válidos, inteiros, positivos e sem duplicidade, PRESERVANDO a ordem de
 * seleção (é ela que dá estabilidade ao rótulo "Itália + Espanha" entre cargas).
 * Aceita número, string numérica ou o registro inteiro (`{ id }`) — nunca texto
 * livre: seleção é por id de registro real.
 */
export function idsPaises(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  const out: number[] = []
  for (const x of v) {
    const bruto = x !== null && typeof x === 'object' ? (x as { id?: unknown }).id : x
    if (typeof bruto === 'boolean') continue
    const n = Number(bruto)
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) continue
    if (!out.includes(n)) out.push(n)
  }
  return out
}

/**
 * Normaliza qualquer entrada (formulário, API, banco) para uma seleção válida.
 * REGRA 2/3: global vence e NÃO materializa vínculo individual — os ids são
 * descartados, nunca gravados "por garantia".
 */
export function normalizarSelecao(entrada: {
  global?: unknown
  paisIds?: unknown
}): SelecaoTerritorial {
  const global = entrada.global === true || entrada.global === 'true' || entrada.global === 1
  if (global) return { global: true, paisIds: [] }
  return { global: false, paisIds: idsPaises(entrada.paisIds) }
}

// ── Transições da UI (as 5 regras do "Todas") ──────────────────────────────

/** REGRA 3 — marcar "Todas" limpa as seleções individuais. */
export function marcarTodas(): SelecaoTerritorial {
  return { global: true, paisIds: [] }
}

/** Desmarcar "Todas" deixa o item sem aplicação territorial até escolherem país. */
export function desmarcarTodas(sel: SelecaoTerritorial): SelecaoTerritorial {
  return { global: false, paisIds: [...sel.paisIds] }
}

/** Alterna a opção especial preservando a exclusividade mútua. */
export function alternarTodas(sel: SelecaoTerritorial): SelecaoTerritorial {
  return sel.global ? desmarcarTodas(sel) : marcarTodas()
}

/**
 * REGRA 4 — selecionar um país individual desmarca "Todas" automaticamente.
 * Selecionar de novo o mesmo país REMOVE aquela seleção (remoção individual).
 */
export function alternarPais(sel: SelecaoTerritorial, paisId: number): SelecaoTerritorial {
  if (!Number.isInteger(paisId) || paisId <= 0) return sel
  if (sel.global) return { global: false, paisIds: [paisId] }
  const jaTem = sel.paisIds.includes(paisId)
  return {
    global: false,
    paisIds: jaTem ? sel.paisIds.filter((x) => x !== paisId) : [...sel.paisIds, paisId],
  }
}

/** Remoção individual explícita (o "x" do chip). */
export function removerPais(sel: SelecaoTerritorial, paisId: number): SelecaoTerritorial {
  if (sel.global) return sel
  return { global: false, paisIds: sel.paisIds.filter((x) => x !== paisId) }
}

/**
 * Substitui a lista inteira (saída do MultiSelect), aplicando a REGRA 4: mexer
 * na seleção individual sempre tira o item do global. Esvaziar a lista deixa o
 * item SEM aplicação territorial — nunca faz voltar para "Todas" sozinho.
 */
export function definirPaises(_sel: SelecaoTerritorial, ids: number[]): SelecaoTerritorial {
  return { global: false, paisIds: idsPaises(ids) }
}

// ── Leitura ────────────────────────────────────────────────────────────────

/** Estado efetivo — a única função que classifica. */
export function estadoTerritorial(sel: SelecaoTerritorial): EstadoTerritorial {
  if (sel.global) return 'global'
  return sel.paisIds.length > 0 ? 'paises' : 'sem_aplicacao'
}

/** Ordena os países selecionados segundo a ordem da seleção, resolvendo rótulos. */
export function paisesSelecionados(sel: SelecaoTerritorial, catalogo: PaisAplicavel[]): PaisAplicavel[] {
  if (sel.global) return []
  const porId = new Map(catalogo.map((p) => [p.id, p]))
  return sel.paisIds.map((id) => porId.get(id)).filter((p): p is PaisAplicavel => !!p)
}

/**
 * Rótulo da LISTAGEM do catálogo:
 *   • global            → "Todos os países"
 *   • 1 país            → o nome do país
 *   • 2 países          → "Itália + Espanha"
 *   • 3 ou mais         → "3 países"
 *   • nenhum vínculo    → "Sem aplicação territorial"
 * Ids que não existem mais no cadastro não são inventados: somem da contagem.
 */
export function resumoTerritorial(sel: SelecaoTerritorial, catalogo: PaisAplicavel[]): string {
  if (sel.global) return ROTULO_GLOBAL
  const paises = paisesSelecionados(sel, catalogo)
  if (paises.length === 0) return ROTULO_SEM_APLICACAO
  if (paises.length === 1) return paises[0].countryLabel
  if (paises.length === 2) return `${paises[0].countryLabel} + ${paises[1].countryLabel}`
  return `${paises.length} países`
}

/** Texto que alimenta a busca livre da listagem (nomes dos países + rótulo). */
export function textoBuscavel(sel: SelecaoTerritorial, catalogo: PaisAplicavel[]): string {
  const nomes = paisesSelecionados(sel, catalogo).map((p) => p.countryLabel)
  return [resumoTerritorial(sel, catalogo), ...nomes].join(' ')
}

/**
 * O item é aplicável ao país informado? Global responde `true` para QUALQUER
 * país — inclusive um cadastrado depois. É o predicado do filtro da listagem.
 */
export function aplicaAoPais(sel: SelecaoTerritorial, paisId: number): boolean {
  if (sel.global) return true
  return sel.paisIds.includes(paisId)
}

// ── Validação ──────────────────────────────────────────────────────────────

export interface ErroTerritorial {
  campo: 'aplicacaoGlobal' | 'paises'
  mensagem: string
}

/**
 * Erros de forma (o que não depende do banco). A existência e o estado ativo de
 * cada país são conferidos contra o cadastro no serviço de backend.
 *
 * `permiteSemAplicacao` vem do TIPO do item: quando o tipo exige território, a
 * ausência de vínculo é erro; quando não exige, é um estado válido.
 */
export function validarSelecao(
  sel: SelecaoTerritorial,
  opcoes: { permiteSemAplicacao?: boolean } = {},
): ErroTerritorial[] {
  const erros: ErroTerritorial[] = []
  if (sel.global && sel.paisIds.length > 0) {
    erros.push({ campo: 'aplicacaoGlobal', mensagem: 'Aplicação global não convive com países selecionados.' })
  }
  if (!sel.global && sel.paisIds.length === 0 && opcoes.permiteSemAplicacao === false) {
    erros.push({ campo: 'paises', mensagem: 'Selecione ao menos um país ou marque "Todas".' })
  }
  return erros
}

// ── Compatibilidade com o campo legado ─────────────────────────────────────

/** Apelidos gravados pela tela antiga e pelos scripts de carga → chave do cadastro. */
const APELIDOS_LEGADO: Record<string, string> = {
  italiano: 'italia', italiana: 'italia',
  espanhol: 'espanha', espanhola: 'espanha',
  portugues: 'portugal', portuguesa: 'portugal',
  alemao: 'alemanha', alema: 'alemanha',
}

const DIACRITICOS = /[\u0300-\u036f]/g
const semAcento = (s: string) => s.normalize('NFD').replace(DIACRITICOS, '').toLowerCase().trim()

/**
 * Traduz o valor legado (`nationality`) para uma seleção. Mesma resolução da
 * migration — existe para que um cliente antigo, que ainda mande `nationality`,
 * continue funcionando sem gravar texto livre.
 * Valor desconhecido resolve para GLOBAL: superset seguro, nunca esconde o item.
 */
export function selecaoDoLegado(nationality: string | null | undefined, catalogo: PaisAplicavel[]): SelecaoTerritorial {
  const bruto = semAcento(nationality ?? '')
  if (!bruto || bruto === 'all') return marcarTodas()
  const chave = APELIDOS_LEGADO[bruto] ?? bruto
  const achado = catalogo.find(
    (p) => semAcento(p.countryKey) === chave || semAcento(p.nationalityKey ?? '') === chave,
  )
  return achado ? { global: false, paisIds: [achado.id] } : marcarTodas()
}
