// src/lib/genealogia/navegacao/ramos.ts
//
// COLAPSO E EXPANSÃO DE RAMOS — módulo puro.
//
// Sem isto, uma árvore de 3.000 pessoas só tem dois estados: tudo na tela
// (ilegível) ou um modo de foco que apaga o resto (perde contexto). O
// genealogista profissional trabalha entre os dois: mantém a linha aberta e
// recolhe o que já resolveu — exatamente como o FamilySearch faz ao dobrar um
// ramo colateral em "+12".
//
// MODELO — por que alcançabilidade e não subtração de conjunto:
//
//   Recolher "descendentes de X" NÃO é `visíveis menos descendentes(X)`. Um neto
//   de X pode ser também neto de Y (casamento entre ramos, primos que se casam —
//   corriqueiro em genealogia italiana de comune pequena). Subtrair sumiria com
//   ele mesmo estando o ramo de Y inteiro aberto, e a árvore mentiria.
//
//   Aqui o conjunto visível é o que se ALCANÇA a partir da âncora andando pelo
//   parentesco, sem atravessar uma fronteira recolhida. Se existe outro caminho
//   aberto, a pessoa continua na tela. É o único modelo que não produz buraco.
//
// DUAS INVARIANTES que caem de graça do modelo e que a UI depende:
//
//   · SEM LINHA SOLTA — quem está na tela tem o genitor e o cônjuge na tela.
//     O alcance sobe do filho para o pai/mãe e atravessa o casamento, então
//     nunca sobra conector apontando para o vazio. A consequência é que dobrar
//     um ramo não esconde alguém cujo filho continua desenhado — o que também
//     é o correto genealogicamente.
//
//   · A ÂNCORA NUNCA SOME — a pessoa em foco é ponto de partida do alcance,
//     então nenhuma dobra consegue apagar a tela debaixo do operador.
//
// Este módulo não persiste nada e não conhece documento algum: recebe grafo +
// estado e devolve conjuntos.

import type { GrafoGenealogico } from "../motor/grafo"

export interface EstadoRamos {
  /** Ids cujos ASCENDENTES estão recolhidos (não se sobe além deles). */
  ascendentes: Set<number>
  /** Ids cujos DESCENDENTES estão recolhidos (não se desce além deles). */
  descendentes: Set<number>
  /**
   * Ids em que o operador venceu explicitamente o LIMITE DE GERAÇÕES.
   *
   * A árvore não abre com tudo na tela: abre com um número legível de gerações
   * e cresce onde o operador pede. Sem isso, um processo com 2.000 pessoas
   * nasce como um paredão em que nenhum nome é legível — tecnicamente correto e
   * praticamente inútil. Estes ids são as portas que já foram abertas.
   */
  expandidos: Set<number>
}

export function ramosVazios(): EstadoRamos {
  return { ascendentes: new Set(), descendentes: new Set(), expandidos: new Set() }
}

/** Quantas gerações de ascendentes a leitura mostra antes de pedir "+". */
export const GERACOES_PADRAO = 4

/**
 * Quantas gerações cada clique no "+" revela.
 *
 * Duas, conforme a referência ("expand one family line another 2
 * generations") — e não o bloco inteiro. A diferença é sensível: revelar 4 de
 * uma vez reenquadra a árvore toda e o operador perde de vista o ramo que
 * estava seguindo.
 */
export const PASSO_EXPANSAO = 2

/**
 * FRONTEIRA GERACIONAL — quem está no limite do que se mostra.
 *
 * Sobe a partir do foco contando gerações. Quem chega ao limite AINDA TENDO
 * ascendentes cadastrados entra na fronteira: o card dele ganha o "+" e a
 * subida para ali. Passar por uma porta já aberta (`expandidos`) recarrega a
 * cota, então cada clique revela mais um bloco de gerações — e não a árvore
 * inteira de uma vez.
 */
export function fronteiraGeracional(
  g: GrafoGenealogico,
  focoId: number | null,
  limite: number,
  expandidos: Set<number>,
): Set<number> {
  const fronteira = new Set<number>()
  if (focoId == null || limite <= 0 || !g.existe(focoId)) return fronteira

  const melhorRestante = new Map<number, number>()
  const fila: Array<[number, number]> = [[focoId, limite]]
  melhorRestante.set(focoId, limite)

  while (fila.length) {
    const [atual, restante] = fila.shift()!
    // Um caminho mais generoso já passou por aqui: aquele manda.
    if ((melhorRestante.get(atual) ?? -1) > restante) continue

    const pais = g.paisDe(atual)
    if (!pais.length) continue

    // A PORTA ABERTA É CHECADA ANTES do fim da cota. Na ordem inversa, quem
    // acabou de ser expandido ainda tinha `restante = 0`, virava fronteira e a
    // travessia parava ali — o clique no "+" não revelava nada.
    const expandido = expandidos.has(atual)

    if (restante <= 0 && !expandido) {
      fronteira.add(atual)
      continue
    }

    // Porta aberta: a cota recomeça, revelando exatamente PASSO_EXPANSAO
    // gerações a partir dali (a geração seguinte já consome um degrau).
    const proximo = expandido ? PASSO_EXPANSAO - 1 : restante - 1

    for (const pai of pais) {
      const anterior = melhorRestante.get(pai.id)
      if (anterior != null && anterior >= proximo) continue
      melhorRestante.set(pai.id, proximo)
      fila.push([pai.id, proximo])
    }
  }

  // Quem o operador abriu não é fronteira, mesmo que a conta dissesse que sim.
  for (const id of expandidos) fronteira.delete(id)
  return fronteira
}

/**
 * Une o recolhimento explícito com a fronteira geracional.
 *
 * O motor de alcance não precisa saber a diferença entre "o operador dobrou" e
 * "ainda não foi pedido": para ele, os dois são fronteira. A distinção existe
 * só na hora de alternar, para o clique fazer o que o operador espera.
 */
export function comFronteira(r: EstadoRamos, fronteira: Set<number>): EstadoRamos {
  if (!fronteira.size) return r
  const ascendentes = new Set(r.ascendentes)
  for (const id of fronteira) ascendentes.add(id)
  return { ...r, ascendentes }
}

/**
 * Alternar ascendentes, ciente da fronteira.
 *
 * Quatro situações, uma única resposta previsível — o "+" sempre abre e o "−"
 * sempre fecha, independentemente de o limite ser explícito ou geracional.
 */
export function alternarAscendentes(
  r: EstadoRamos,
  pessoaId: number,
  fronteira: Set<number>,
): EstadoRamos {
  if (r.ascendentes.has(pessoaId)) {
    return { ...r, ascendentes: remover(r.ascendentes, pessoaId) }
  }
  if (fronteira.has(pessoaId)) {
    const expandidos = new Set(r.expandidos)
    expandidos.add(pessoaId)
    return { ...r, expandidos }
  }
  if (r.expandidos.has(pessoaId)) {
    return { ...r, expandidos: remover(r.expandidos, pessoaId) }
  }
  const ascendentes = new Set(r.ascendentes)
  ascendentes.add(pessoaId)
  return { ...r, ascendentes }
}

export function temRamoRecolhido(r: EstadoRamos): boolean {
  return r.ascendentes.size > 0 || r.descendentes.size > 0 || r.expandidos.size > 0
}

export function contarRecolhidos(r: EstadoRamos): number {
  return r.ascendentes.size + r.descendentes.size
}

export type DirecaoRamo = "ascendentes" | "descendentes"

export function alternarRamo(
  r: EstadoRamos,
  pessoaId: number,
  direcao: DirecaoRamo,
): EstadoRamos {
  const alvo = new Set(r[direcao])
  if (alvo.has(pessoaId)) alvo.delete(pessoaId)
  else alvo.add(pessoaId)
  return { ...r, [direcao]: alvo } as EstadoRamos
}

export function recolherRamo(r: EstadoRamos, pessoaId: number, direcao: DirecaoRamo): EstadoRamos {
  if (r[direcao].has(pessoaId)) return r
  const alvo = new Set(r[direcao])
  alvo.add(pessoaId)
  return { ...r, [direcao]: alvo } as EstadoRamos
}

export function expandirRamo(r: EstadoRamos, pessoaId: number, direcao: DirecaoRamo): EstadoRamos {
  if (!r[direcao].has(pessoaId)) return r
  const alvo = new Set(r[direcao])
  alvo.delete(pessoaId)
  return { ...r, [direcao]: alvo } as EstadoRamos
}

/** Expande a pessoa nas duas direções — usado ao "ir para" alguém escondido. */
export function expandirPessoa(r: EstadoRamos, pessoaId: number): EstadoRamos {
  return {
    ...r,
    ascendentes: remover(r.ascendentes, pessoaId),
    descendentes: remover(r.descendentes, pessoaId),
  }
}

function remover(s: Set<number>, id: number): Set<number> {
  if (!s.has(id)) return s
  const novo = new Set(s)
  novo.delete(id)
  return novo
}

export interface ResultadoRamos {
  /** Conjunto final que vai para o layout. */
  visiveis: Set<number> | null
  /** Por pessoa recolhida: quantos ficaram escondidos atrás dela. */
  escondidosPorPessoa: Map<number, { ascendentes: number; descendentes: number }>
  /** Total de pessoas escondidas pelo colapso (não pelo modo de foco). */
  totalEscondidos: number
}

/**
 * Aplica o colapso sobre o conjunto que o modo de foco já deixou visível.
 *
 * @param base conjunto do modo de foco (null = árvore inteira)
 * @param ancoras pontos de partida da alcançabilidade (raiz, foco, selecionada)
 */
export function aplicarRamos(
  g: GrafoGenealogico,
  base: Set<number> | null,
  ramos: EstadoRamos,
  ancoras: Array<number | null | undefined>,
): ResultadoRamos {
  const vazio: ResultadoRamos = {
    visiveis: base,
    escondidosPorPessoa: new Map(),
    totalEscondidos: 0,
  }
  if (!temRamoRecolhido(ramos)) return vazio

  const noBase = (id: number) => (base ? base.has(id) : g.existe(id))

  // Âncoras: a primeira que existir e estiver na base. Sem âncora válida o
  // colapso não tem de onde partir e é ignorado (nunca esvazia a tela).
  const partidas = ancoras.filter((a): a is number => a != null && noBase(a))
  if (!partidas.length) {
    const primeira = g.pessoas.find((p) => noBase(p.id))
    if (!primeira) return vazio
    partidas.push(primeira.id)
  }

  const alcancados = new Set<number>()
  const fila: number[] = []

  const visitar = (id: number) => {
    if (alcancados.has(id) || !noBase(id)) return
    alcancados.add(id)
    fila.push(id)
  }

  partidas.forEach(visitar)

  /**
   * A dobra é da FAMÍLIA, não do indivíduo.
   *
   * Recolher os descendentes de um marido tem de recolher os filhos do casal,
   * senão eles voltam à tela pela esposa — que não está dobrada — e o gesto
   * simplesmente não funciona para ninguém casado, ou seja, para quase todo
   * mundo. Por isso a barreira é verificada no FILHO (algum genitor dele está
   * dobrado?), e não só em quem está sendo percorrido.
   */
  const filhoBloqueado = (filhoId: number): boolean => {
    const f = g.pessoa(filhoId)
    if (!f) return false
    return (
      (f.paiId != null && ramos.descendentes.has(f.paiId)) ||
      (f.maeId != null && ramos.descendentes.has(f.maeId))
    )
  }

  while (fila.length) {
    const atual = fila.shift()!

    // Cônjuge é sempre alcançado: o casal é uma unidade de desenho.
    for (const c of g.conjugesIds(atual)) visitar(c)

    if (!ramos.ascendentes.has(atual)) {
      for (const p of g.paisDe(atual)) visitar(p.id)
    }
    if (!ramos.descendentes.has(atual)) {
      for (const f of g.filhosIds(atual)) {
        if (filhoBloqueado(f)) continue
        visitar(f)
      }
    }
  }

  // Cônjuge alcançado por casamento não pode reabrir o ramo que foi recolhido —
  // ele entra como folha. Isso é intencional: o operador recolheu a linha do
  // marido, não quer a linha inteira da esposa voltando por baixo.

  const escondidosPorPessoa = new Map<number, { ascendentes: number; descendentes: number }>()

  for (const id of ramos.ascendentes) {
    if (!alcancados.has(id)) continue
    let n = 0
    for (const a of g.ancestrais(id)) if (noBase(a) && !alcancados.has(a)) n++
    if (n > 0) registrar(escondidosPorPessoa, id, "ascendentes", n)
  }
  for (const id of ramos.descendentes) {
    if (!alcancados.has(id)) continue
    let n = 0
    for (const d of g.descendentes(id)) if (noBase(d) && !alcancados.has(d)) n++
    if (n > 0) registrar(escondidosPorPessoa, id, "descendentes", n)
  }

  const totalBase = base ? base.size : g.pessoas.length
  return {
    visiveis: alcancados,
    escondidosPorPessoa,
    totalEscondidos: Math.max(0, totalBase - alcancados.size),
  }
}

function registrar(
  m: Map<number, { ascendentes: number; descendentes: number }>,
  id: number,
  direcao: DirecaoRamo,
  n: number,
) {
  const atual = m.get(id) || { ascendentes: 0, descendentes: 0 }
  atual[direcao] = n
  m.set(id, atual)
}

/**
 * Desdobra o que estiver escondendo `alvoId`.
 *
 * Sem isto, buscar alguém que está atrás de uma dobra não faz nada visível — o
 * pior defeito possível numa busca, porque o operador conclui que a pessoa não
 * existe na árvore. Abrimos só as fronteiras que atrapalham: as demais dobras
 * que o operador criou continuam de pé.
 */
export function expandirAte(
  g: GrafoGenealogico,
  r: EstadoRamos,
  alvoId: number,
): EstadoRamos {
  // Sem atalho por "nada está dobrado": a pessoa pode estar fora da tela por
  // causa do LIMITE DE GERAÇÕES, que não é uma dobra explícita. Um atalho aqui
  // fazia a busca não surtir efeito nenhum justamente no caso mais comum —
  // procurar um ascendente distante numa árvore recém-aberta.
  if (!g.existe(alvoId)) return r

  // Quem dobrou os DESCENDENTES e está acima do alvo bloqueia a descida.
  const acima = g.ancestrais(alvoId)
  acima.add(alvoId)
  // Quem dobrou os ASCENDENTES e está abaixo do alvo bloqueia a subida.
  const abaixo = g.descendentes(alvoId)
  abaixo.add(alvoId)

  const descendentes = new Set([...r.descendentes].filter((id) => !acima.has(id)))
  const ascendentes = new Set([...r.ascendentes].filter((id) => !abaixo.has(id)))

  // A pessoa também pode estar além do LIMITE de gerações, e não atrás de uma
  // dobra. Abrir as portas do caminho descendente até ela resolve os dois casos
  // com o mesmo gesto — quem busca alguém quer ver a pessoa, não entender por
  // que ela não aparecia.
  const expandidos = new Set(r.expandidos)
  for (const id of abaixo) expandidos.add(id)

  const igual =
    descendentes.size === r.descendentes.size &&
    ascendentes.size === r.ascendentes.size &&
    expandidos.size === r.expandidos.size
  if (igual) return r
  return { ascendentes, descendentes, expandidos }
}

/**
 * Quem PODE ser recolhido — a UI só oferece o gesto onde ele produz efeito.
 * Um card sem filhos não ganha "recolher descendentes"; oferecer o botão ali é
 * prometer uma ação que não faz nada.
 */
export function podeRecolher(
  g: GrafoGenealogico,
  pessoaId: number,
  direcao: DirecaoRamo,
  visiveis: Set<number> | null,
): boolean {
  const dentro = (id: number) => (visiveis ? visiveis.has(id) : true)
  if (direcao === "descendentes") {
    return g.filhosIds(pessoaId).some(dentro)
  }
  return g.paisDe(pessoaId).some((p) => dentro(p.id))
}

/**
 * Recolhimento sugerido para árvore grande: mantém a linha de cidadania e a
 * família imediata do requerente abertas e dobra os colaterais.
 *
 * Não é aplicado sozinho — a árvore nunca se reorganiza sem gesto do operador.
 * É o que o botão "Recolher colaterais" executa.
 */
export function recolherColaterais(
  g: GrafoGenealogico,
  linhaCidadania: number[],
  raizId: number | null,
): EstadoRamos {
  const preservar = new Set<number>(linhaCidadania)
  if (raizId != null) {
    preservar.add(raizId)
    g.conjugesIds(raizId).forEach((c) => preservar.add(c))
    g.filhosIds(raizId).forEach((f) => preservar.add(f))
  }
  for (const id of [...preservar]) g.conjugesIds(id).forEach((c) => preservar.add(c))

  const descendentes = new Set<number>()
  for (const id of preservar) {
    // Irmão de quem está na linha vira folha recolhida: ele é o começo de um
    // ramo colateral inteiro que quase nunca interessa na tela de trabalho.
    for (const irmaoId of g.irmaosIds(id)) {
      if (preservar.has(irmaoId)) continue
      if (g.filhosIds(irmaoId).length) descendentes.add(irmaoId)
    }
  }

  return { ascendentes: new Set(), descendentes, expandidos: new Set() }
}

/**
 * Serialização estável para persistir a preferência (localStorage).
 * Array ordenado — assim a chave não muda por reordenação do Set.
 */
export function serializarRamos(r: EstadoRamos): {
  ascendentes: number[]
  descendentes: number[]
  expandidos: number[]
} {
  return {
    ascendentes: [...r.ascendentes].sort((a, b) => a - b),
    descendentes: [...r.descendentes].sort((a, b) => a - b),
    expandidos: [...r.expandidos].sort((a, b) => a - b),
  }
}

export function desserializarRamos(v: unknown): EstadoRamos {
  const bruto = v as
    | { ascendentes?: unknown; descendentes?: unknown; expandidos?: unknown }
    | null
  return {
    ascendentes: paraSet(bruto?.ascendentes),
    descendentes: paraSet(bruto?.descendentes),
    expandidos: paraSet(bruto?.expandidos),
  }
}

function paraSet(v: unknown): Set<number> {
  if (!Array.isArray(v)) return new Set()
  return new Set(v.filter((n): n is number => typeof n === "number" && Number.isFinite(n)))
}
