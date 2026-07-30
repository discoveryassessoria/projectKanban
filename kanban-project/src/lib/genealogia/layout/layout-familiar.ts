// src/lib/genealogia/layout/layout-familiar.ts
//
// Motor de layout genealógico.
//
// O que havia antes: dagre genérico + 5 passadas de correção, sendo uma delas
// O(n²) repetida 10 vezes, empurrando nós até "não sobrepor". Com 300 pessoas
// isso é ~4,5 milhões de comparações por render, e ainda assim sobrepunha
// (o laço tinha limite de iterações; quando estourava, ficava errado na tela).
//
// O que existe agora: um algoritmo em camadas, determinístico, com garantia de
// NÃO-SOBREPOSIÇÃO POR CONSTRUÇÃO — os nós são empacotados numa ordem e nunca
// invadem o vizinho, porque o passo de centralização é feito com restrição de
// folga mínima (método de prioridade). Custo: O(passes · n).
//
// Estrutura de desenho: casal = um "slot" único; filhos pendurados num
// barramento de irmãos (linha horizontal) a partir do meio da barra de união —
// a mesma gramática visual que genealogista profissional lê sem pensar.

import type { GrafoGenealogico } from "../motor/grafo"
import { tsDe } from "../motor/texto"

export type Orientacao = "vertical" | "horizontal"
export type Densidade = "compacta" | "confortavel"

export interface CaixaNo {
  pessoaId: number
  x: number
  y: number
  largura: number
  altura: number
  /** Geração normalizada: 0 = camada mais alta (ancestral mais antigo). */
  camada: number
}

export interface BarraUniao {
  id: string
  aId: number
  bId: number
  /** União que originou a barra — o rótulo de casamento é lido a partir dela. */
  uniaoId: number | null
  /** Segmento entre os dois cônjuges, em coordenadas finais. */
  x1: number
  y1: number
  x2: number
  y2: number
  /** Ponto de onde desce a descendência. */
  ancoraX: number
  ancoraY: number
  /**
   * true quando os dois cônjuges NÃO estão lado a lado no desenho — acontece
   * com múltiplos casamentos (esposa1 · marido · esposa2: a barra marido↔esposa1
   * e a barra marido↔esposa2 são adjacentes, mas numa terceira união a barra
   * teria de atravessar o card de outra pessoa). Quando desviada, o conector é
   * desenhado por fora, contornando os cards do meio, em vez de passar por cima
   * deles fingindo que ninguém está ali.
   */
  desviada: boolean
}

export interface LigacaoFilho {
  id: string
  paiIds: number[]
  filhoId: string | number
  /** Origem (âncora do casal ou base do genitor único). */
  ox: number
  oy: number
  /** Destino (topo do card do filho). */
  dx: number
  dy: number
  /** Coordenada do barramento de irmãos. */
  barramento: number
  tipo: "casal" | "unico"
}

export interface ResultadoLayout {
  nos: Map<number, CaixaNo>
  barras: BarraUniao[]
  ligacoes: LigacaoFilho[]
  largura: number
  altura: number
  minX: number
  minY: number
  camadas: number
  /** Slots por camada — usado pelo minimapa e pela navegação por teclado. */
  ordemPorCamada: number[][]
}

export interface OpcoesLayout {
  orientacao: Orientacao
  densidade: Densidade
  larguraNo: number
  alturaNo: number
  /** Somente estes ids entram no layout (modo foco). null = todos. */
  visiveis?: Set<number> | null
  raizId?: number | null
  /**
   * Posições definidas à mão pelo operador (arrastar), por pessoa, em
   * coordenadas finais. Aplicadas DEPOIS do cálculo automático e ANTES dos
   * conectores — assim as linhas acompanham o card movido em vez de ficarem
   * apontando para o lugar antigo (o defeito clássico de layout com override).
   */
  posicoesManuais?: Record<string | number, { x: number; y: number }> | null
  /**
   * Folgas do desenho, em pixels. Quando informadas vencem a `densidade` — é o
   * caminho pelo qual os tokens visuais da árvore chegam ao motor sem que o
   * motor precise conhecer a camada de UI.
   */
  folgas?: { ordem: number; casal: number; camada: number } | null
}

interface Slot {
  id: string
  membros: number[]      // 1 ou 2 pessoas
  camada: number
  x: number              // centro do slot
  largura: number
  ordem: number
  fixo: boolean
}

const PASSES_ORDENACAO = 4
const PASSES_CENTRALIZACAO = 12

export function calcularLayout(
  g: GrafoGenealogico,
  opcoes: OpcoesLayout,
): ResultadoLayout {
  const { larguraNo, alturaNo, orientacao, densidade } = opcoes
  const vertical = orientacao === "vertical"

  // Todo o cálculo acontece num espaço abstrato de CAMADA × ORDEM. A orientação
  // só decide, no fim, qual eixo da tela recebe cada um.
  //
  // Isto substitui a transposição que existia antes (calcular na vertical e
  // girar o resultado). Girar trocava também LARGURA por ALTURA das caixas — só
  // que o cartão é desenhado sempre 232×96, porque nome de pessoa precisa de
  // largura nas duas orientações. O layout reservava 96×232 e o cartão ocupava
  // 232×96: no modo horizontal a árvore saía com buraco no meio e cartões
  // brigando pelo mesmo espaço.
  const tamOrdem = vertical ? larguraNo : alturaNo    // ao longo da camada
  const tamCamada = vertical ? alturaNo : larguraNo   // entre camadas

  // As folgas vêm dos tokens visuais quando a UI as informa; a densidade
  // continua valendo para quem chama o motor sem interface (testes, exportação).
  const gapX = opcoes.folgas?.ordem ?? (densidade === "compacta" ? 28 : 48)
  // O casal NUNCA encosta: dois cônjuges colados voltariam a ser lidos como um
  // card de casal, e a regra deste desenho é que cada pessoa tem o seu.
  const gapCasal = Math.max(4, opcoes.folgas?.casal ?? (densidade === "compacta" ? 14 : 22))
  // Folga entre gerações. 118 esticava a leitura em pé: as gerações ficavam
  // longe demais para o olho ligar pai e filho num movimento só.
  const gapCamada = opcoes.folgas?.camada ?? (densidade === "compacta" ? 64 : 88)

  const visiveis =
    opcoes.visiveis && opcoes.visiveis.size > 0
      ? opcoes.visiveis
      : new Set(g.pessoas.map((p) => p.id))

  const pessoas = g.pessoas.filter((p) => visiveis.has(p.id))
  if (pessoas.length === 0) {
    return {
      nos: new Map(),
      barras: [],
      ligacoes: [],
      largura: 0,
      altura: 0,
      minX: 0,
      minY: 0,
      camadas: 0,
      ordemPorCamada: [],
    }
  }

  // ---------------------------------------------------------------
  // 1. RANK — geração de cada pessoa (ancestral em cima)
  //    Longest-path a partir dos descendentes + nivelamento de casais.
  //    Garante pai estritamente acima do filho mesmo com dado inconsistente.
  // ---------------------------------------------------------------
  const rank = calcularRanks(g, visiveis, opcoes.raizId ?? null)

  // ---------------------------------------------------------------
  // 2. SLOTS — casal vira uma unidade indivisível
  // ---------------------------------------------------------------
  const slotDe = new Map<number, Slot>()
  const slots: Slot[] = []
  const usados = new Set<number>()

  // Ordem estável: por rank, depois nascimento, depois id — layout determinístico.
  const ordenadas = [...pessoas].sort((a, b) => {
    const ra = rank.get(a.id) ?? 0
    const rb = rank.get(b.id) ?? 0
    if (ra !== rb) return rb - ra
    const ta = tsDe(a.data_nasc)
    const tb = tsDe(b.data_nasc)
    if (ta != null && tb != null && ta !== tb) return ta - tb
    if (ta == null && tb != null) return 1
    if (ta != null && tb == null) return -1
    return a.id - b.id
  })

  for (const p of ordenadas) {
    if (usados.has(p.id)) continue

    // Um slot é a CADEIA CONJUGAL inteira, não um par. Quem casou duas vezes
    // aparece entre as duas famílias — que é onde o genealogista procura.
    const membros = montarCadeiaConjugal(g, p.id, rank, visiveis, usados)
    membros.forEach((m) => usados.add(m))

    const slot: Slot = {
      id: `slot-${membros.join("-")}`,
      membros,
      camada: rank.get(p.id) ?? 0,
      x: 0,
      largura: membros.length * tamOrdem + (membros.length - 1) * gapCasal,
      ordem: 0,
      fixo: false,
    }
    slots.push(slot)
    membros.forEach((m) => slotDe.set(m, slot))
  }

  // ---------------------------------------------------------------
  // 3. CAMADAS — normaliza para 0..n (0 = mais antigo, no topo)
  // ---------------------------------------------------------------
  const ranksUsados = [...new Set(slots.map((s) => s.camada))].sort((a, b) => b - a)
  const mapaCamada = new Map<number, number>()
  ranksUsados.forEach((r, i) => mapaCamada.set(r, i))
  for (const s of slots) s.camada = mapaCamada.get(s.camada)!
  const totalCamadas = ranksUsados.length

  const porCamada: Slot[][] = Array.from({ length: totalCamadas }, () => [])
  for (const s of slots) porCamada[s.camada].push(s)

  // ---------------------------------------------------------------
  // 4. ORDENAÇÃO dentro da camada — barycenter iterativo (reduz cruzamentos)
  // ---------------------------------------------------------------
  // Semente estável: filhos ordenados por nascimento sob os pais.
  for (const camada of porCamada) {
    camada.sort((a, b) => chaveSemente(g, a) - chaveSemente(g, b) || a.id.localeCompare(b.id))
    camada.forEach((s, i) => (s.ordem = i))
  }

  const vizinhosAcima = new Map<string, Slot[]>()
  const vizinhosAbaixo = new Map<string, Slot[]>()
  for (const s of slots) {
    const acima: Slot[] = []
    const abaixo: Slot[] = []
    for (const m of s.membros) {
      for (const paiId of [g.pessoa(m)?.paiId, g.pessoa(m)?.maeId]) {
        if (paiId == null || !visiveis.has(paiId)) continue
        const alvo = slotDe.get(paiId)
        if (alvo && alvo !== s && !acima.includes(alvo)) acima.push(alvo)
      }
      for (const filhoId of g.filhosIds(m)) {
        if (!visiveis.has(filhoId)) continue
        const alvo = slotDe.get(filhoId)
        if (alvo && alvo !== s && !abaixo.includes(alvo)) abaixo.push(alvo)
      }
    }
    vizinhosAcima.set(s.id, acima)
    vizinhosAbaixo.set(s.id, abaixo)
  }

  for (let passe = 0; passe < PASSES_ORDENACAO; passe++) {
    const descendo = passe % 2 === 0
    const sequencia = descendo
      ? [...Array(totalCamadas).keys()]
      : [...Array(totalCamadas).keys()].reverse()

    for (const c of sequencia) {
      const camada = porCamada[c]
      const bary = new Map<string, number>()
      for (const s of camada) {
        const refs = descendo ? vizinhosAcima.get(s.id)! : vizinhosAbaixo.get(s.id)!
        const validos = refs.filter((r) => r.camada !== s.camada)
        bary.set(s.id, validos.length ? media(validos.map((r) => r.ordem)) : s.ordem)
      }
      camada.sort((a, b) => (bary.get(a.id)! - bary.get(b.id)!) || a.ordem - b.ordem)
      camada.forEach((s, i) => (s.ordem = i))
    }
  }

  // ---------------------------------------------------------------
  // 5. X — empacotamento + centralização com folga garantida
  // ---------------------------------------------------------------
  for (const camada of porCamada) {
    let cursor = 0
    for (const s of camada) {
      s.x = cursor + s.largura / 2
      cursor += s.largura + gapX
    }
  }

  // Relaxação: puxa cada slot para o baricentro dos vizinhos, respeitando
  // sempre a folga mínima com o vizinho da esquerda e da direita. Como o
  // movimento é clamped, sobreposição é impossível — não existe "passada de
  // correção" depois, porque não há o que corrigir.
  for (let passe = 0; passe < PASSES_CENTRALIZACAO; passe++) {
    const descendo = passe % 2 === 0
    const sequencia = descendo
      ? [...Array(totalCamadas).keys()]
      : [...Array(totalCamadas).keys()].reverse()

    for (const c of sequencia) {
      const camada = porCamada[c]
      for (let i = 0; i < camada.length; i++) {
        const s = camada[i]
        const refs = descendo ? vizinhosAbaixo.get(s.id)! : vizinhosAcima.get(s.id)!
        const validos = refs.filter((r) => r.camada !== s.camada)
        if (validos.length === 0) continue

        const alvo = media(validos.map((r) => r.x))
        const anterior = camada[i - 1]
        const proximo = camada[i + 1]
        const limiteEsq = anterior
          ? anterior.x + anterior.largura / 2 + gapX + s.largura / 2
          : -Infinity
        const limiteDir = proximo
          ? proximo.x - proximo.largura / 2 - gapX - s.largura / 2
          : Infinity

        s.x = Math.min(Math.max(alvo, limiteEsq), limiteDir)
      }

      // Compactação à esquerda: elimina buracos criados pela relaxação sem
      // nunca aproximar além da folga mínima.
      for (let i = 1; i < camada.length; i++) {
        const anterior = camada[i - 1]
        const atual = camada[i]
        const minimo = anterior.x + anterior.largura / 2 + gapX + atual.largura / 2
        if (atual.x < minimo) atual.x = minimo
      }
    }
  }

  // ---------------------------------------------------------------
  // 6. COORDENADAS FINAIS — projeta camada×ordem nos eixos da tela
  // ---------------------------------------------------------------
  const passoCamada = tamCamada + gapCamada
  const nos = new Map<number, CaixaNo>()

  // SENTIDO DA LEITURA HORIZONTAL.
  //
  // Na deitada, a referência põe os DESCENDENTES À ESQUERDA e os ASCENDENTES À
  // DIREITA — a árvore cresce para a direita conforme se sobe no tempo. Como o
  // rank 0 é o ancestral mais antigo, mandar rank 0 para x=0 produzia o
  // espelho exato disso: o bisavô à esquerda e o requerente na borda direita.
  // Aqui a camada é invertida no eixo X, e só nele; a vertical continua com o
  // mais antigo em cima, que é o correto para a leitura em pé.
  const colocar = (pessoaId: number, posOrdem: number, camada: number) => {
    const camadaProjetada = vertical ? camada : totalCamadas - 1 - camada
    const posCamada = camadaProjetada * passoCamada
    nos.set(pessoaId, {
      pessoaId,
      x: vertical ? posOrdem : posCamada,
      y: vertical ? posCamada : posOrdem,
      // O cartão tem o MESMO tamanho nas duas orientações.
      largura: larguraNo,
      altura: alturaNo,
      camada,
    })
  }

  for (const s of slots) {
    const inicio = s.x - s.largura / 2
    s.membros.forEach((m, i) => colocar(m, inicio + i * (tamOrdem + gapCasal), s.camada))
  }

  // ---------------------------------------------------------------
  // 7. NORMALIZAÇÃO — origem em 0,0
  // ---------------------------------------------------------------
  let minX = Infinity
  let minY = Infinity
  nos.forEach((n) => {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
  })
  const dx = Number.isFinite(minX) ? -minX : 0
  const dy = Number.isFinite(minY) ? -minY : 0
  nos.forEach((n) => {
    n.x += dx
    n.y += dy
  })

  // ---------------------------------------------------------------
  // 8. POSIÇÕES MANUAIS — a vontade do operador vence o automático
  // ---------------------------------------------------------------
  if (opcoes.posicoesManuais) {
    for (const [chave, pos] of Object.entries(opcoes.posicoesManuais)) {
      const id = Number(chave)
      const no = nos.get(id)
      if (!no || !pos || typeof pos.x !== "number" || typeof pos.y !== "number") continue
      no.x = pos.x
      no.y = pos.y
    }
  }

  // ---------------------------------------------------------------
  // 9. CONECTORES — calculados sobre as posições FINAIS
  // ---------------------------------------------------------------
  const { barras, ligacoes } = construirConectores(g, nos, visiveis, orientacao)

  let maxX = -Infinity
  let maxY = -Infinity
  minX = Infinity
  minY = Infinity
  nos.forEach((n) => {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.largura)
    maxY = Math.max(maxY, n.y + n.altura)
  })

  const ordemPorCamada = porCamada.map((camada) =>
    [...camada]
      .sort((a, b) => a.x - b.x)
      .flatMap((s) => s.membros.filter((m) => nos.has(m))),
  )

  return {
    nos,
    barras,
    ligacoes,
    largura: Number.isFinite(maxX) ? maxX - Math.min(0, minX) : 0,
    altura: Number.isFinite(maxY) ? maxY - Math.min(0, minY) : 0,
    minX: Math.min(0, minX),
    minY: Math.min(0, minY),
    camadas: totalCamadas,
    ordemPorCamada,
  }
}

/**
 * Conectores no espaço final. Uma linha por FAMÍLIA (barra de união + barramento
 * de irmãos), nunca uma por parentesco — é o que mantém a leitura possível numa
 * família de cinco filhos.
 */
function construirConectores(
  g: GrafoGenealogico,
  nos: Map<number, CaixaNo>,
  visiveis: Set<number>,
  orientacao: Orientacao,
): { barras: BarraUniao[]; ligacoes: LigacaoFilho[] } {
  const vertical = orientacao === "vertical"
  const barras: BarraUniao[] = []
  const ligacoes: LigacaoFilho[] = []
  const casaisFeitos = new Set<string>()

  // saída da geração dos pais / entrada na geração dos filhos
  // Saída = borda do GENITOR voltada para o filho. Entrada = borda do FILHO
  // voltada para o genitor. Na horizontal o ascendente está à DIREITA, então a
  // linha sai pela esquerda dele e entra pela direita do filho.
  const saida = (n: CaixaNo) =>
    vertical
      ? { x: n.x + n.largura / 2, y: n.y + n.altura }
      : { x: n.x, y: n.y + n.altura / 2 }
  const entrada = (n: CaixaNo) =>
    vertical
      ? { x: n.x + n.largura / 2, y: n.y }
      : { x: n.x + n.largura, y: n.y + n.altura / 2 }

  // Índice por camada para detectar cônjuges NÃO adjacentes (3ª união, cadeia
  // longa). Sem isto a barra de união seria desenhada por cima do card de quem
  // está no meio — o operador leria um casamento que não existe.
  const porCamada = new Map<number, CaixaNo[]>()
  nos.forEach((n) => {
    const arr = porCamada.get(n.camada)
    if (arr) arr.push(n)
    else porCamada.set(n.camada, [n])
  })
  const ini = (n: CaixaNo) => (vertical ? n.x : n.y)
  const fim = (n: CaixaNo) => (vertical ? n.x + n.largura : n.y + n.altura)
  porCamada.forEach((arr) => arr.sort((p, q) => ini(p) - ini(q)))

  const haCardEntre = (a: CaixaNo, b: CaixaNo): boolean => {
    if (a.camada !== b.camada) return true
    const [esq, dir] = ini(a) <= ini(b) ? [a, b] : [b, a]
    const vaoIni = fim(esq)
    const vaoFim = ini(dir)
    if (vaoFim - vaoIni < 1) return false
    for (const n of porCamada.get(a.camada) || []) {
      if (n === a || n === b) continue
      if (fim(n) > vaoIni + 1 && ini(n) < vaoFim - 1) return true
    }
    return false
  }

  /** Folga do desvio: a barra passa por baixo dos cards do meio. */
  const DESVIO = 16

  for (const casal of g.todosCasais()) {
    const na = nos.get(casal.a)
    const nb = nos.get(casal.b)
    if (!na || !nb || !visiveis.has(casal.a) || !visiveis.has(casal.b)) continue
    if (casaisFeitos.has(casal.chave)) continue
    casaisFeitos.add(casal.chave)

    // A barra liga os dois cards pela borda voltada um para o outro.
    const primeiro = vertical ? (na.x <= nb.x ? na : nb) : na.y <= nb.y ? na : nb
    const segundo = primeiro === na ? nb : na
    const desviada = haCardEntre(primeiro, segundo)

    // Adjacentes: barra reta entre as bordas que se olham.
    // Não adjacentes: a barra sai da base dos dois cards e contorna por fora.
    const barra: BarraUniao = vertical
      ? {
          id: `uniao-${casal.chave}`,
          aId: primeiro.pessoaId,
          bId: segundo.pessoaId,
          uniaoId: casal.uniaoId,
          x1: desviada ? primeiro.x + primeiro.largura / 2 : primeiro.x + primeiro.largura,
          y1: desviada ? primeiro.y + primeiro.altura : primeiro.y + primeiro.altura / 2,
          x2: desviada ? segundo.x + segundo.largura / 2 : segundo.x,
          y2: desviada ? segundo.y + segundo.altura : segundo.y + segundo.altura / 2,
          ancoraX: desviada
            ? (primeiro.x + primeiro.largura / 2 + segundo.x + segundo.largura / 2) / 2
            : (primeiro.x + primeiro.largura + segundo.x) / 2,
          ancoraY:
            Math.max(primeiro.y + primeiro.altura, segundo.y + segundo.altura) +
            (desviada ? DESVIO : 0),
          desviada,
        }
      : {
          id: `uniao-${casal.chave}`,
          aId: primeiro.pessoaId,
          bId: segundo.pessoaId,
          uniaoId: casal.uniaoId,
          x1: desviada ? primeiro.x + primeiro.largura : primeiro.x + primeiro.largura / 2,
          y1: desviada ? primeiro.y + primeiro.altura / 2 : primeiro.y + primeiro.altura,
          x2: desviada ? segundo.x + segundo.largura : segundo.x + segundo.largura / 2,
          y2: desviada ? segundo.y + segundo.altura / 2 : segundo.y,
          // O barramento dos filhos sai pela ESQUERDA do casal, porque é para lá
          // que a descendência cresce na leitura deitada.
          ancoraX:
            Math.min(primeiro.x, segundo.x) - (desviada ? DESVIO : 0),
          ancoraY: desviada
            ? (primeiro.y + primeiro.altura / 2 + segundo.y + segundo.altura / 2) / 2
            : (primeiro.y + primeiro.altura + segundo.y) / 2,
          desviada,
        }
    barras.push(barra)

    const filhos = g.filhosOrdenados(casal.filhos.filter((f) => visiveis.has(f) && nos.has(f)))
    if (!filhos.length) continue

    const alvos = filhos.map((f) => entrada(nos.get(f)!))
    const barramento = vertical
      ? barra.ancoraY + (Math.min(...alvos.map((a) => a.y)) - barra.ancoraY) / 2
      : barra.ancoraX + (Math.max(...alvos.map((a) => a.x)) - barra.ancoraX) / 2

    filhos.forEach((filhoId, i) => {
      ligacoes.push({
        id: `lig-${casal.chave}-${filhoId}`,
        paiIds: [casal.a, casal.b],
        filhoId,
        ox: barra.ancoraX,
        oy: barra.ancoraY,
        dx: alvos[i].x,
        dy: alvos[i].y,
        barramento,
        tipo: "casal",
      })
    })
  }

  // Genitor único: só existe linha quando o outro genitor não está na árvore.
  for (const p of g.pessoas) {
    if (!visiveis.has(p.id) || !nos.has(p.id)) continue
    const temPai = p.paiId != null && nos.has(p.paiId)
    const temMae = p.maeId != null && nos.has(p.maeId)
    if (temPai && temMae && g.casal(p.paiId!, p.maeId!)) continue

    for (const genitorId of [p.paiId, p.maeId]) {
      if (genitorId == null || !nos.has(genitorId)) continue
      const ng = nos.get(genitorId)!
      const nf = nos.get(p.id)!
      const o = saida(ng)
      const d = entrada(nf)
      ligacoes.push({
        id: `lig-unico-${genitorId}-${p.id}`,
        paiIds: [genitorId],
        filhoId: p.id,
        ox: o.x,
        oy: o.y,
        dx: d.x,
        dy: d.y,
        barramento: vertical ? o.y + (d.y - o.y) / 2 : o.x + (d.x - o.x) / 2,
        tipo: "unico",
      })
    }
  }

  return { barras, ligacoes }
}

// ---------------------------------------------------------------
// auxiliares
// ---------------------------------------------------------------

/**
 * Rank = GERAÇÃO da pessoa (maior = mais antigo, fica no topo).
 *
 * A tentação é calcular pelo caminho mais longo até o descendente mais fundo.
 * Isso está errado em genealogia e produz um defeito visível: todo mundo que
 * não teve filhos — um tio-avô, um irmão solteiro — cai na última camada, ao
 * lado dos bisnetos. Na tela, um tio de 1925 aparece como se fosse da geração
 * dos netos de 1990.
 *
 * O correto é medir a geração a partir da RAIZ (requerente), andando pelo
 * parentesco: pai/mãe sobem um nível, filho desce um, cônjuge fica no mesmo.
 * Depois disso, dois ajustes garantem que o desenho nunca minta:
 *   · cônjuges terminam sempre na mesma camada;
 *   · todo ascendente fica estritamente acima do descendente, mesmo quando o
 *     dado está inconsistente (é o motor de conflitos que acusa o erro; o
 *     layout só não pode desenhar um pai abaixo do filho).
 */
function calcularRanks(
  g: GrafoGenealogico,
  visiveis: Set<number>,
  raizId: number | null,
): Map<number, number> {
  const rank = new Map<number, number>()

  // 1. Geração relativa à raiz, propagada por componente conexo. Se a raiz não
  //    foi informada (ou não está visível), começa pela pessoa mais antiga
  //    visível — e cada componente desconexo recebe a sua própria origem.
  const sementes: number[] = []
  if (raizId != null && visiveis.has(raizId)) sementes.push(raizId)
  for (const p of g.pessoas) if (visiveis.has(p.id)) sementes.push(p.id)

  for (const semente of sementes) {
    if (rank.has(semente)) continue
    rank.set(semente, 0)
    const fila = [semente]
    while (fila.length) {
      const atual = fila.shift()!
      const nivel = rank.get(atual)!
      const p = g.pessoa(atual)
      if (!p) continue

      const vizinhos: Array<[number, number]> = []
      if (p.paiId != null && visiveis.has(p.paiId)) vizinhos.push([p.paiId, nivel + 1])
      if (p.maeId != null && visiveis.has(p.maeId)) vizinhos.push([p.maeId, nivel + 1])
      for (const f of g.filhosIds(atual)) if (visiveis.has(f)) vizinhos.push([f, nivel - 1])
      for (const c of g.conjugesIds(atual)) if (visiveis.has(c)) vizinhos.push([c, nivel])

      for (const [vid, vnivel] of vizinhos) {
        if (rank.has(vid)) continue
        rank.set(vid, vnivel)
        fila.push(vid)
      }
    }
  }

  // 2. Coerência: cônjuges na mesma camada, ascendente estritamente acima.
  //    Converge rápido; o teto de passes existe só como rede contra dado
  //    circular (filiação em ciclo), que o motor de conflitos reporta à parte.
  for (let passe = 0; passe < 12; passe++) {
    let mudou = false

    for (const casal of g.todosCasais()) {
      if (!visiveis.has(casal.a) || !visiveis.has(casal.b)) continue
      const ra = rank.get(casal.a)
      const rb = rank.get(casal.b)
      if (ra == null || rb == null || ra === rb) continue
      const alvo = Math.max(ra, rb)
      rank.set(casal.a, alvo)
      rank.set(casal.b, alvo)
      mudou = true
    }

    for (const p of g.pessoas) {
      if (!visiveis.has(p.id)) continue
      const rp = rank.get(p.id)
      if (rp == null) continue
      for (const genitorId of [p.paiId, p.maeId]) {
        if (genitorId == null || !visiveis.has(genitorId)) continue
        const rg = rank.get(genitorId)
        if (rg == null || rg > rp) continue
        rank.set(genitorId, rp + 1)
        mudou = true
      }
    }

    if (!mudou) break
  }

  return rank
}

/**
 * CADEIA CONJUGAL — todos os cônjuges de uma pessoa no mesmo slot.
 *
 * A versão anterior escolhia UM parceiro e descartava os demais; a segunda
 * esposa virava um slot solto em algum ponto da camada, longe do marido, e a
 * barra de união atravessava meia tela. Em processo de cidadania isso é grave:
 * segundo casamento é justamente onde nasce a linha que transmite o direito, e
 * ver os dois núcleos separados leva o operador a concluir errado.
 *
 * Ordem produzida (marido com duas esposas, por data de casamento):
 *
 *        [esposa 1] ══ [MARIDO] ══ [esposa 2]
 *             │                        │
 *          filhos 1                 filhos 2
 *
 * O eixo é a pessoa com mais uniões (o "eixo" da cadeia); as demais se
 * distribuem cronologicamente à esquerda e à direita, do centro para fora.
 */
function montarCadeiaConjugal(
  g: GrafoGenealogico,
  inicialId: number,
  rank: Map<number, number>,
  visiveis: Set<number>,
  usados: Set<number>,
): number[] {
  const mesmaCamada = (id: number) => (rank.get(id) ?? 0) === (rank.get(inicialId) ?? 0)
  const elegivel = (id: number) => visiveis.has(id) && !usados.has(id) && mesmaCamada(id)

  // Componente conexo pelo casamento, dentro da camada.
  const componente = new Set<number>([inicialId])
  const fila = [inicialId]
  while (fila.length) {
    const atual = fila.shift()!
    for (const c of g.conjugesOrdenados(atual)) {
      if (componente.has(c) || !elegivel(c)) continue
      componente.add(c)
      fila.push(c)
    }
  }

  if (componente.size === 1) return [inicialId]

  const grau = (id: number) => g.conjugesOrdenados(id).filter((c) => componente.has(c)).length

  if (componente.size === 2) {
    const [a, b] = [...componente]
    return ordenarCasal(g, a, b)
  }

  // Eixo: quem tem mais uniões dentro do componente (empate → menor id).
  let eixo = inicialId
  for (const id of componente) {
    const gi = grau(id)
    const ge = grau(eixo)
    if (gi > ge || (gi === ge && id < eixo)) eixo = id
  }

  const parceiros = g.conjugesOrdenados(eixo).filter((c) => componente.has(c))
  const esquerda: number[] = []
  const direita: number[] = []
  parceiros.forEach((c, i) => {
    // 1ª união à esquerda, 2ª à direita, 3ª mais à esquerda... do centro p/ fora.
    if (i % 2 === 0) esquerda.unshift(c)
    else direita.push(c)
  })

  const cadeia = [...esquerda, eixo, ...direita]
  const colocados = new Set(cadeia)

  // Cônjuge-de-cônjuge (o componente pode ser maior que uma estrela): entra
  // encostado no parceiro dele, do lado de fora — nunca no meio da cadeia.
  for (const id of componente) {
    if (colocados.has(id)) continue
    const ancora = g.conjugesOrdenados(id).find((c) => colocados.has(c))
    const idx = ancora != null ? cadeia.indexOf(ancora) : -1
    if (idx >= 0 && idx < cadeia.length / 2) cadeia.unshift(id)
    else cadeia.push(id)
    colocados.add(id)
  }

  return cadeia
}

function ordenarCasal(g: GrafoGenealogico, a: number, b: number): [number, number] {
  // Convenção genealógica: masculino à esquerda; sem sexo, id menor à esquerda.
  const pa = g.pessoa(a)
  const pb = g.pessoa(b)
  const sa = (pa?.sexo || "").charAt(0).toUpperCase()
  const sb = (pb?.sexo || "").charAt(0).toUpperCase()
  if (sa === "M" && sb !== "M") return [a, b]
  if (sb === "M" && sa !== "M") return [b, a]
  return a <= b ? [a, b] : [b, a]
}

function chaveSemente(g: GrafoGenealogico, s: Slot): number {
  const p = g.pessoa(s.membros[0])
  const ts = tsDe(p?.data_nasc)
  return ts ?? Number.MAX_SAFE_INTEGER - s.membros[0]
}

function media(v: number[]): number {
  if (!v.length) return 0
  return v.reduce((a, b) => a + b, 0) / v.length
}

/** Conjunto visível para os modos de foco da árvore. */
export function calcularVisiveis(
  g: GrafoGenealogico,
  modo: "completa" | "ascendentes" | "descendentes" | "linha" | "familia" | "ramo",
  focoId: number | null,
  linhaCidadania: number[],
): Set<number> | null {
  if (modo === "completa" || focoId == null) {
    if (modo === "linha" && linhaCidadania.length) {
      // A linha sozinha fica ilegível sem os cônjuges: eles entram junto.
      const s = new Set(linhaCidadania)
      for (const id of linhaCidadania) g.conjugesIds(id).forEach((c) => s.add(c))
      return s
    }
    return null
  }

  switch (modo) {
    case "ascendentes": {
      const s = new Set<number>([focoId, ...g.ancestrais(focoId)])
      const comConjuges = new Set(s)
      s.forEach((id) => g.conjugesIds(id).forEach((c) => comConjuges.add(c)))
      return comConjuges
    }
    case "descendentes": {
      const s = new Set<number>([focoId, ...g.descendentes(focoId)])
      const comConjuges = new Set(s)
      s.forEach((id) => g.conjugesIds(id).forEach((c) => comConjuges.add(c)))
      return comConjuges
    }
    case "linha": {
      const s = new Set(linhaCidadania.length ? linhaCidadania : [focoId])
      s.forEach((id) => g.conjugesIds(id).forEach((c) => s.add(c)))
      return s
    }
    case "ramo": {
      // Isolar ramo = a pessoa, TUDO que desce dela e a linha que sobe até a
      // raiz. Sem a subida o ramo fica solto no ar e o operador perde a
      // referência de onde aquilo se encaixa na família.
      const s = new Set<number>([focoId])
      g.descendentes(focoId).forEach((d) => s.add(d))
      g.ancestrais(focoId).forEach((a) => s.add(a))
      const comConjuges = new Set(s)
      s.forEach((id) => g.conjugesIds(id).forEach((c) => comConjuges.add(c)))
      return comConjuges
    }
    case "familia": {
      // Núcleo: a pessoa, pais, irmãos, cônjuges e filhos. O "zoom social".
      const s = new Set<number>([focoId])
      g.paisDe(focoId).forEach((p) => s.add(p.id))
      g.irmaosIds(focoId).forEach((i) => s.add(i))
      g.conjugesIds(focoId).forEach((c) => s.add(c))
      g.filhosIds(focoId).forEach((f) => s.add(f))
      // avós dão contexto sem explodir o grafo
      g.paisDe(focoId).forEach((p) => g.paisDe(p.id).forEach((av) => s.add(av.id)))
      return s
    }
    default:
      return null
  }
}
