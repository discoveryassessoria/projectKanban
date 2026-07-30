// src/lib/genealogia/layout/fantasmas.ts
//
// SLOTS VAZIOS DE ASCENDENTE — "+ Adicionar pai" / "+ Adicionar mãe".
//
// Numa árvore de cidadania, o que importa não é só quem está cadastrado: é ONDE
// a linha para. Uma árvore que desenha apenas o que existe transmite a mensagem
// errada — parece completa. Desenhar o lugar vago onde o pai deveria estar
// transforma o buraco em trabalho visível, e é exatamente ali que o operador
// clica para continuar.
//
// POR QUE FORA DO MOTOR DE LAYOUT: o layout tem uma garantia dura e testada de
// não-sobreposição por construção. Injetar nós sintéticos nele obrigaria a
// reabrir ranking, ordenação e empacotamento — risco alto por um ganho que não
// precisa disso. Aqui os fantasmas são posicionados DEPOIS, no espaço livre
// que sobra, e qualquer posição que colida com um card real é simplesmente
// descartada. O pior caso é não desenhar um "+", nunca desenhar por cima.

import type { CaixaNo, Orientacao, ResultadoLayout } from "./layout-familiar"
import type { GrafoGenealogico } from "../motor/grafo"

/**
 * Papel do lugar vago.
 *
 * `pai`/`mae` sobem uma geração; `conjuge` fica na MESMA linha, encostado na
 * pessoa (é o par que falta); `filho` desce uma geração. São quatro lacunas
 * distintas porque o clique de cada uma abre um cadastro diferente — e porque
 * o lugar onde o card nasce é o que informa ao operador o que ele vai criar.
 */
export type PapelFantasma = "pai" | "mae" | "conjuge" | "filho"

export interface Fantasma {
  /** Determinístico: mesma lacuna gera sempre o mesmo id. */
  id: string
  /** Pessoa a partir da qual a lacuna existe. */
  filhoId: number
  papel: PapelFantasma
  x: number
  y: number
  largura: number
  altura: number
}

export interface OpcoesFantasmas {
  orientacao: Orientacao
  largura: number
  altura: number
  /** Só estes ids ganham slot vago de ASCENDENTE. Sem isso, uma árvore grande
   *  vira um campo de "+" — o ruído que a versão anterior tinha. */
  candidatos: Iterable<number>
  /** Quem pode ganhar o slot "acrescentar o cônjuge" (pessoa sem união). */
  candidatosConjuge?: Iterable<number>
  /** Quem pode ganhar o slot "acrescentar filho(a)" — tipicamente só o foco. */
  candidatosFilho?: Iterable<number>
  /** Folga entre camadas, para o fantasma cair na altura certa. */
  gapCamada?: number
  /** Folga conjugal — o vago encosta no cônjuge com a MESMA folga dos reais. */
  gapCasal?: number
}

const GAP_PADRAO = 118
const GAP_PAR = 22

/**
 * Posiciona os slots vagos de pai/mãe dos `candidatos`.
 *
 * O par (pai, mãe) é tratado junto: quando os DOIS faltam, os dois cartões
 * nascem lado a lado, na mesma gramática do casal. Quando falta um só, ele
 * nasce ao lado do genitor que existe.
 */
export function calcularFantasmas(
  g: GrafoGenealogico,
  layout: ResultadoLayout,
  opcoes: OpcoesFantasmas,
): Fantasma[] {
  const { orientacao, largura, altura } = opcoes
  const vertical = orientacao === "vertical"
  const gap = opcoes.gapCamada ?? GAP_PADRAO
  const passo = (vertical ? altura : largura) + gap

  const ocupadas = [...layout.nos.values()]
  const fantasmas: Fantasma[] = []

  const colide = (x: number, y: number): boolean => {
    for (const n of ocupadas) {
      if (x + largura <= n.x + 1 || n.x + n.largura <= x + 1) continue
      if (y + altura <= n.y + 1 || n.y + n.altura <= y + 1) continue
      return true
    }
    return false
  }

  const registrar = (f: Fantasma) => {
    fantasmas.push(f)
    // O fantasma passa a ocupar espaço: dois "+" não podem nascer no mesmo lugar.
    ocupadas.push({
      pessoaId: -1,
      x: f.x,
      y: f.y,
      largura: f.largura,
      altura: f.altura,
      camada: -1,
    } as CaixaNo)
  }

  for (const filhoId of opcoes.candidatos) {
    const no = layout.nos.get(filhoId)
    if (!no) continue
    const p = g.pessoa(filhoId)
    if (!p) continue

    const faltaPai = p.paiId == null || !layout.nos.has(p.paiId)
    const faltaMae = p.maeId == null || !layout.nos.has(p.maeId)
    if (!faltaPai && !faltaMae) continue

    // Camada dos genitores: uma acima (ou uma à esquerda, na horizontal).
    const posCamada = vertical ? no.y - passo : no.x - passo

    // Ancoragem lateral: se um genitor existe, o vago encosta nele; se os dois
    // faltam, o par nasce centralizado sobre o filho.
    const existente =
      (!faltaPai && p.paiId != null ? layout.nos.get(p.paiId) : null) ??
      (!faltaMae && p.maeId != null ? layout.nos.get(p.maeId) : null) ??
      null

    const centroFilho = vertical ? no.x + no.largura / 2 : no.y + no.altura / 2
    const tamOrdem = vertical ? largura : altura

    const posicionar = (deslocamento: number) => {
      const ordem = existente
        ? (vertical ? existente.x : existente.y) + deslocamento
        : centroFilho - tamOrdem / 2 + deslocamento
      return vertical
        ? { x: ordem, y: posCamada }
        : { x: posCamada, y: ordem }
    }

    if (faltaPai && faltaMae) {
      // Convenção genealógica: pai à esquerda (ou acima, na horizontal).
      const pai = posicionar(-(tamOrdem + GAP_PAR) / 2)
      const mae = posicionar((tamOrdem + GAP_PAR) / 2)
      if (!colide(pai.x, pai.y)) {
        registrar({ id: `fant-pai-${filhoId}`, filhoId, papel: "pai", ...pai, largura, altura })
      }
      if (!colide(mae.x, mae.y)) {
        registrar({ id: `fant-mae-${filhoId}`, filhoId, papel: "mae", ...mae, largura, altura })
      }
      continue
    }

    // Falta um só: encosta no genitor existente, do lado correspondente.
    const lado = faltaPai ? -(tamOrdem + GAP_PAR) : tamOrdem + GAP_PAR
    const pos = posicionar(lado)
    if (colide(pos.x, pos.y)) continue
    registrar({
      id: `fant-${faltaPai ? "pai" : "mae"}-${filhoId}`,
      filhoId,
      papel: faltaPai ? "pai" : "mae",
      ...pos,
      largura,
      altura,
    })
  }

  // ---------------------------------------------------------------
  // CÔNJUGE VAGO — o outro lado do casal que ainda não foi cadastrado.
  //
  // É o slot que a referência mostra como "ACRESCENTAR O CÔNJUGE", e ele existe
  // por uma razão de domínio, não de estética: numa árvore de cidadania o
  // casamento é o evento que transmite (ou não) o direito, e uma pessoa
  // desenhada sozinha se lê como "não casou" — conclusão que o dado não
  // sustenta. O lugar vago devolve a pergunta.
  //
  // Ele nasce na MESMA camada, encostado na pessoa, com a mesma folga conjugal
  // dos casais reais — é isso que faz o par vago ser lido como par.
  // ---------------------------------------------------------------
  const gapPar = opcoes.gapCasal ?? GAP_PAR
  for (const pessoaId of opcoes.candidatosConjuge ?? []) {
    const no = layout.nos.get(pessoaId)
    if (!no) continue
    if (g.conjugesIds(pessoaId).some((c) => layout.nos.has(c))) continue

    // Convenção do desenho: o cônjuge vago entra DEPOIS da pessoa no eixo de
    // ordem (à direita na leitura em pé, abaixo na deitada) — o mesmo lugar em
    // que um cônjuge real entraria.
    //
    // Quando esse lado está ocupado (um irmão logo abaixo, por exemplo), o vago
    // vai para o lado ANTERIOR em vez de sumir. Desistir na primeira colisão
    // fazia o convite desaparecer justamente nas árvores densas — que são as
    // que mais têm cônjuge faltando.
    const passoOrdemConjuge = (vertical ? largura : altura) + gapPar
    const depois = vertical
      ? { x: no.x + passoOrdemConjuge, y: no.y }
      : { x: no.x, y: no.y + passoOrdemConjuge }
    const antes = vertical
      ? { x: no.x - passoOrdemConjuge, y: no.y }
      : { x: no.x, y: no.y - passoOrdemConjuge }

    const pos = !colide(depois.x, depois.y)
      ? depois
      : !colide(antes.x, antes.y)
        ? antes
        : null
    if (!pos) continue
    registrar({ id: `fant-conjuge-${pessoaId}`, filhoId: pessoaId, papel: "conjuge", ...pos, largura, altura })
  }

  // ---------------------------------------------------------------
  // FILHO(A) VAGO — a continuação da linha para baixo.
  // ---------------------------------------------------------------
  for (const pessoaId of opcoes.candidatosFilho ?? []) {
    const no = layout.nos.get(pessoaId)
    if (!no) continue

    const filhos = g.filhosIds(pessoaId).filter((f) => layout.nos.has(f))
    // Encosta no último filho já desenhado; sem filhos, nasce alinhado à pessoa.
    const ultimo = filhos
      .map((f) => layout.nos.get(f)!)
      .sort((a, b) => (vertical ? a.x - b.x : a.y - b.y))
      .pop()

    const posCamadaFilho = vertical ? no.y + passo : no.x - passo
    const base = ultimo
      ? (vertical ? ultimo.x : ultimo.y) + (vertical ? largura : altura) + GAP_PAR
      : (vertical ? no.x : no.y)
    const passoOrdem = (vertical ? largura : altura) + GAP_PAR

    // O lugar logo abaixo do último filho pode já estar ocupado por outro slot
    // vago (um "acrescentar cônjuge" do irmão, por exemplo). Em vez de desistir
    // na primeira colisão — que fazia o convite simplesmente sumir da tela —
    // desce alguns degraus procurando o primeiro espaço livre.
    let colocado = false
    for (let tentativa = 0; tentativa < 4 && !colocado; tentativa++) {
      const ordem = base + tentativa * passoOrdem
      const pos = vertical ? { x: ordem, y: posCamadaFilho } : { x: posCamadaFilho, y: ordem }
      if (colide(pos.x, pos.y)) continue
      registrar({ id: `fant-filho-${pessoaId}`, filhoId: pessoaId, papel: "filho", ...pos, largura, altura })
      colocado = true
    }
  }

  return fantasmas
}

/**
 * Quem merece slot vago.
 *
 * Regra de admissão: a pessoa em foco, a linha de cidadania e os ascendentes
 * diretos do foco. É onde a continuação da pesquisa realmente acontece — um
 * "+" pendurado em cada primo de terceiro grau só produz poluição.
 */
export function candidatosAFantasma(
  g: GrafoGenealogico,
  focoId: number | null,
  linhaCidadania: number[],
  visiveis: Set<number> | null,
  teto = 40,
): number[] {
  const dentro = (id: number) => (visiveis ? visiveis.has(id) : true)
  const escolhidos: number[] = []
  const vistos = new Set<number>()

  const add = (id: number) => {
    if (vistos.has(id) || !dentro(id) || escolhidos.length >= teto) return
    vistos.add(id)
    escolhidos.push(id)
  }

  if (focoId != null) {
    add(focoId)
    for (const a of g.ancestrais(focoId)) add(a)
  }
  for (const id of linhaCidadania) add(id)

  return escolhidos
}
