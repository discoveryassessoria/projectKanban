// src/components/arvore/motor/arvore-canvas.tsx
//
// O canvas. Junta câmera, virtualização, conectores, cartões e teclado.
//
// Virtualização: com 2.000 pessoas, montar 2.000 cartões custa ~2.000 nós DOM
// vivos e destrói o scroll. Aqui só é montado o que intersecta a área visível
// mais uma margem — tipicamente 30 a 60 cartões — e a lista só é recalculada
// quando a câmera se move além de um limiar, não a cada quadro.

"use client"

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ResultadoLayout, Orientacao } from "@/src/lib/genealogia/layout/layout-familiar"
import type { AnaliseArvore } from "@/src/lib/genealogia/motor/tipos"
import type { GrafoGenealogico } from "@/src/lib/genealogia/motor/grafo"
import type { PessoaArvore } from "../types"
import { CartaoAdicionar, CartaoPessoa, ROTULO_VAGO } from "./cartao-pessoa"
import type { Fantasma } from "@/src/lib/genealogia/layout/fantasmas"
import { CamadaConectores } from "./camada-conectores"
import { areaVisivel, useViewport, type ApiViewport, type Viewport } from "./use-viewport"
import {
  alturaCard,
  alturaCardRetrato,
  CARTAO_LARGURA,
  EASE,
  RETRATO_LARGURA,
  TREE,
  type ConteudoCartao,
} from "./tokens"
import { CartaoRetrato } from "./cartao-retrato"
import type { SituacaoDocumental } from "@/src/lib/genealogia/documental/indicadores"
import { anoDe } from "@/src/lib/genealogia/motor/texto"
import { podeRecolher, type DirecaoRamo, type EstadoRamos } from "@/src/lib/genealogia/navegacao/ramos"

export interface ArvoreCanvasRef {
  centralizarPessoa: (id: number, zoom?: number) => void
  ajustarTudo: () => void
  zoom: (fator: number) => void
  zoomPara: (k: number) => void
  obterViewport: () => Viewport
  elementoMundo: () => HTMLElement | null
  api: ApiViewport | null
}

export interface ArvoreCanvasProps {
  grafo: GrafoGenealogico
  analise: AnaliseArvore
  layout: ResultadoLayout
  pessoasPorId: Map<number, PessoaArvore>
  orientacao: Orientacao
  /** O que cada card mostra — define também a altura dele. */
  exibicao: ConteudoCartao
  /** Formato do card: deitado (Paisagem) ou em pé (Retrato). */
  formato?: "deitado" | "retrato"
  selecionadaId: number | null
  /** Pessoa raiz — ponto de partida da navegação por teclado. */
  raizId?: number | null
  paisAlvo: string | null
  aoSelecionar: (pessoa: PessoaArvore) => void
  aoFocar: (id: number) => void
  aoMudarViewport?: (v: Viewport) => void
  /** Recebe o retângulo visível em coordenadas do mundo (para o minimapa). */
  aoMudarAreaVisivel?: (r: { x: number; y: number; largura: number; altura: number }) => void
  /**
   * Desliga a virtualização. Usado só na exportação: o PDF precisa de TODOS os
   * cartões no DOM, e virtualizar durante a captura geraria uma árvore com
   * buracos — exatamente o tipo de erro que passa despercebido até o cliente ver.
   */
  renderizarTudo?: boolean
  acoes?: {
    adicionarPai?: (id: number) => void
    adicionarMae?: (id: number) => void
    adicionarConjuge?: (id: number) => void
    adicionarFilho?: (id: number) => void
  }
  /** Grau de parentesco com o requerente, por pessoa. */
  parentescoDe?: (id: number) => string | null
  /** Situação documental oficial, por pessoa. */
  documentalDe?: (id: number) => { situacao: SituacaoDocumental; progresso: number | null; pendentes: number } | null
  aoAbrirPastaDocumental?: (id: number) => void
  /** Ids que casam com os filtros. null = sem filtro ativo. */
  casandoFiltro?: Set<number> | null
  /** Colapso de ramos — estado + quantos ficaram dobrados atrás de cada nó. */
  ramos?: EstadoRamos | null
  escondidosPorPessoa?: Map<number, { ascendentes: number; descendentes: number }>
  aoAlternarRamo?: (id: number, direcao: DirecaoRamo) => void
  /** Conjunto efetivamente desenhado — base para saber se há ramo a dobrar. */
  visiveisSet?: Set<number> | null
  /** Quem está no limite de gerações: o "+" ali revela o próximo bloco. */
  fronteira?: Set<number> | null
  /** Slots vazios de pai/mãe, desenhados onde o ascendente faltaria. */
  fantasmas?: Fantasma[]
}

/**
 * Montagem incremental: quanto entra no DOM por quadro.
 *
 * Virtualizar resolve "quantos cartões existem"; não resolve "quantos nascem de
 * uma vez". Um zoom-out amplo passa a janela de 40 para 600 cartões num único
 * commit — o React monta os 600 no mesmo frame e o gesto trava visivelmente.
 * Aqui a janela entra em lotes, por quadro, começando pelo que está mais perto
 * do centro da tela: o operador vê o miolo imediatamente e a periferia completa
 * em poucos quadros, sem nenhum engasgo.
 */
const LOTE_MONTAGEM = 120

export const ArvoreCanvas = forwardRef<ArvoreCanvasRef, ArvoreCanvasProps>(function ArvoreCanvas(
  {
    grafo,
    analise,
    layout,
    pessoasPorId,
    orientacao,
    exibicao,
    formato = "deitado",
    selecionadaId,
    raizId,
    paisAlvo,
    aoSelecionar,
    aoFocar,
    aoMudarViewport,
    aoMudarAreaVisivel,
    renderizarTudo = false,
    acoes,
    parentescoDe,
    documentalDe,
    aoAbrirPastaDocumental,
    casandoFiltro,
    ramos,
    escondidosPorPessoa,
    aoAlternarRamo,
    visiveisSet,
    fronteira,
    fantasmas,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mundoRef = useRef<HTMLDivElement>(null)
  const [hoverId, setHoverId] = useState<number | null>(null)
  const [tamanho, setTamanho] = useState({ largura: 0, altura: 0 })
  // A área visível é ESTADO, não ref: ela é lida durante o render (para decidir
  // o que montar) e ler ref no render é justamente o que produz tela
  // desatualizada de forma silenciosa. A câmera já publica com histerese, então
  // isto não re-renderiza a cada quadro.
  const [areaVis, setAreaVis] = useState({ x: 0, y: 0, largura: 0, altura: 0 })

  const dim =
    formato === "retrato"
      ? { largura: RETRATO_LARGURA, altura: alturaCardRetrato(exibicao) }
      : { largura: CARTAO_LARGURA, altura: alturaCard(exibicao) }

  const publicarArea = useCallback(
    (v: Viewport) => {
      const c = containerRef.current
      if (!c) return
      const r = areaVisivel(v, c.clientWidth, c.clientHeight, 320)
      setAreaVis(r)
      aoMudarAreaVisivel?.(r)
      aoMudarViewport?.(v)
    },
    [aoMudarAreaVisivel, aoMudarViewport],
  )

  const { viewport, api } = useViewport({
    alvoRef: mundoRef,
    containerRef,
    aoMudar: publicarArea,
  })

  // ---------- medição do container ----------
  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    const medir = () => {
      setTamanho({ largura: c.clientWidth, altura: c.clientHeight })
      publicarArea(api.obter())
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(c)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- enquadrar ao trocar de layout ----------
  const assinaturaLayout = `${layout.nos.size}:${orientacao}:${formato}:${dim.altura}:${Math.round(layout.largura)}x${Math.round(layout.altura)}`
  const ultimaAssinatura = useRef<string>("")
  useEffect(() => {
    if (!layout.nos.size || !tamanho.largura) return
    if (ultimaAssinatura.current === assinaturaLayout) return
    const primeiro = ultimaAssinatura.current === ""
    ultimaAssinatura.current = assinaturaLayout

    // ABERTURA: centrada na PESSOA, em zoom de leitura — não enquadrando a
    // árvore inteira.
    //
    // Enquadrar tudo parece generoso e é o contrário: numa árvore de seis
    // camadas o conteúdo tem ~2.200px de largura, então caber em 1.600 força
    // escala ~0,66. O resultado é o que a captura mostrava — cards minúsculos,
    // texto no limite da legibilidade e metade da tela vazia, porque a largura
    // manda e a altura sobra. A leitura correta abre no tamanho natural, com a
    // pessoa em foco no centro, e deixa o resto para o pan.
    const raiz = raizId != null ? layout.nos.get(raizId) : null
    if (raiz) {
      api.centralizarEm(
        raiz.x + raiz.largura / 2,
        raiz.y + raiz.altura / 2,
        1,
        { imediato: primeiro, duracao: 620 },
      )
    } else {
      api.enquadrar(
        { x: 0, y: 0, largura: layout.largura, altura: layout.altura },
        0.08,
        { imediato: primeiro, duracao: 620 },
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinaturaLayout, tamanho.largura, raizId])

  // ---------- conjuntos de destaque ----------
  const alvoDestaque = hoverId ?? selecionadaId
  const destaque = useMemo(() => {
    if (alvoDestaque == null) {
      return { ascendentes: new Set<number>(), descendentes: new Set<number>(), todos: new Set<number>() }
    }
    const ascendentes = grafo.ancestrais(alvoDestaque)
    const descendentes = grafo.descendentes(alvoDestaque)
    const todos = new Set<number>([alvoDestaque])
    ascendentes.forEach((i) => todos.add(i))
    descendentes.forEach((i) => todos.add(i))
    // O cônjuge de quem está aceso entra junto: sem isso a linha acende e o
    // casal aparece pela metade — um card iluminado ao lado de outro apagado,
    // ligados por uma barra de união acesa. Fica lido como erro.
    const base = [...todos]
    for (const id of base) grafo.conjugesIds(id).forEach((c) => todos.add(c))
    return { ascendentes, descendentes, todos }
  }, [grafo, alvoDestaque])

  // Só faz sentido esmaecer o resto quando existe uma LINHAGEM para destacar.
  // Selecionar alguém sem parentes cadastrados apagava a tela inteira em troca
  // de nenhuma informação — o operador via um card aceso e um borrão.
  const temDestaque = alvoDestaque != null && destaque.todos.size > 1

  // ---------- virtualização ----------
  const visiveis = useMemo(() => {
    const r = areaVis
    const lista: Array<{ id: number; x: number; y: number }> = []
    // Sem área medida ainda (primeiro quadro), desenha tudo até o teto de
    // segurança — evita tela vazia no primeiro frame.
    const semArea = renderizarTudo || r.largura === 0 || r.altura === 0
    layout.nos.forEach((n) => {
      if (
        semArea ||
        (n.x + n.largura >= r.x &&
          n.x <= r.x + r.largura &&
          n.y + n.altura >= r.y &&
          n.y <= r.y + r.altura)
      ) {
        lista.push({ id: n.pessoaId, x: n.x, y: n.y })
      }
    })

    // Ordem de montagem = do centro da tela para fora. Só custa a ordenação
    // quando a janela é maior que um lote; abaixo disso tudo entra junto e
    // ordenar seria trabalho jogado fora.
    if (lista.length > LOTE_MONTAGEM && !semArea) {
      const cx = r.x + r.largura / 2
      const cy = r.y + r.altura / 2
      lista.sort(
        (a, b) =>
          (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2),
      )
    }
    return lista
  }, [layout, areaVis, renderizarTudo])

  // ---------- montagem incremental ----------
  //
  // O teto volta ao primeiro lote no RENDER em que a janela muda (padrão
  // "ajustar estado durante o render"), não num efeito: zerar no efeito
  // produziria um quadro com a lista antiga já pintada e depois um segundo
  // render — exatamente o piscar que a montagem em lotes existe para evitar.
  const [teto, setTeto] = useState(LOTE_MONTAGEM)
  const [janelaAnterior, setJanelaAnterior] = useState(visiveis)
  if (janelaAnterior !== visiveis) {
    setJanelaAnterior(visiveis)
    setTeto(LOTE_MONTAGEM)
  }

  useEffect(() => {
    if (visiveis.length <= LOTE_MONTAGEM) return
    let quadro = 0
    let atual = LOTE_MONTAGEM
    const passo = () => {
      atual += LOTE_MONTAGEM
      setTeto(atual)
      if (atual < visiveis.length) quadro = requestAnimationFrame(passo)
    }
    quadro = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(quadro)
  }, [visiveis])

  // `renderizarTudo` decide no próprio render, não no efeito: o efeito só roda
  // depois da pintura, e a captura não pode esperar um quadro para ter a árvore
  // completa no DOM.
  const montados =
    renderizarTudo || teto >= visiveis.length ? visiveis : visiveis.slice(0, teto)

  const conectoresVisiveis = useMemo(() => {
    const r = areaVis
    if (renderizarTudo || r.largura === 0) return { barras: layout.barras, ligacoes: layout.ligacoes }
    const dentro = (x1: number, y1: number, x2: number, y2: number) =>
      Math.max(x1, x2) >= r.x &&
      Math.min(x1, x2) <= r.x + r.largura &&
      Math.max(y1, y2) >= r.y &&
      Math.min(y1, y2) <= r.y + r.altura
    return {
      barras: layout.barras.filter((b) => dentro(b.x1, b.y1, b.x2, b.y2)),
      ligacoes: layout.ligacoes.filter((l) => dentro(l.ox, l.oy, l.dx, l.dy)),
    }
  }, [layout, areaVis, renderizarTudo])

  // CLIQUE = GAVETA LATERAL.
  //
  // A referência abre um painel na lateral direita com os detalhes da pessoa e
  // um botão para reposicionar a árvore nela. Eu havia colocado um popup
  // ancorado no card; é um padrão diferente, e a gaveta é o que o operador da
  // referência espera — ela cabe a ficha inteira sem cobrir o card clicado.

  // ---------- API imperativa ----------
  const centralizarPessoa = useCallback(
    (id: number, zoom?: number) => {
      const n = layout.nos.get(id)
      if (!n) return
      api.centralizarEm(n.x + n.largura / 2, n.y + n.altura / 2, zoom, { duracao: 560 })
    },
    [layout, api],
  )

  useImperativeHandle(
    ref,
    () => ({
      centralizarPessoa,
      ajustarTudo: () =>
        api.enquadrar({ x: 0, y: 0, largura: layout.largura, altura: layout.altura }, 0.08),
      zoom: (fator: number) => api.zoomPor(fator),
      zoomPara: (k: number) => api.zoomPara(k),
      obterViewport: () => api.obter(),
      elementoMundo: () => mundoRef.current,
      api,
    }),
    [centralizarPessoa, api, layout.largura, layout.altura],
  )

  // NÃO EXISTE arrastar card.
  //
  // Reposicionar nó com o mouse é afordância de editor de grafos, e não existe
  // na árvore de referência: lá o layout é sempre automático e o operador não
  // tem como "estragar" o desenho. Manter o gesto trazia junto a leitura errada
  // ("isto é um diagrama que eu edito") e um estado de posições manuais que
  // precisava ser salvo, versionado por orientação e reposto — custo permanente
  // para uma capacidade que a experiência de referência decidiu não ter.

  // ---------- navegação por teclado ----------
  // Ponto de partida do teclado: sem alguém selecionado as setas não têm de
  // onde sair, e o operador que navega só por teclado fica preso no canvas.
  // A primeira seta seleciona a raiz (ou o topo da linha), e a partir daí a
  // navegação por parentesco funciona.
  const selecionarPrimeira = useCallback(() => {
    const candidato =
      (raizId != null && layout.nos.has(raizId) ? raizId : null) ??
      layout.ordemPorCamada.flat().find((id) => layout.nos.has(id)) ??
      null
    if (candidato == null) return false
    const pessoa = pessoasPorId.get(candidato)
    if (!pessoa) return false
    aoSelecionar(pessoa)
    centralizarPessoa(candidato)
    return true
  }, [raizId, layout, pessoasPorId, aoSelecionar, centralizarPessoa])

  const navegar = useCallback(
    (direcao: "cima" | "baixo" | "esquerda" | "direita") => {
      if (selecionadaId == null) {
        selecionarPrimeira()
        return
      }
      const atual = layout.nos.get(selecionadaId)
      if (!atual) return

      // Semântica genealógica antes de geometria: subir = ascendente,
      // descer = descendente, laterais = irmão/cônjuge. É o que o operador
      // espera; navegar por proximidade de pixel confunde em árvore larga.
      const vertical = orientacao === "vertical"
      const paraAscendente = vertical ? "cima" : "esquerda"
      const paraDescendente = vertical ? "baixo" : "direita"

      let candidatos: number[] = []
      if (direcao === paraAscendente) {
        candidatos = grafo.paisDe(selecionadaId).map((p) => p.id)
      } else if (direcao === paraDescendente) {
        candidatos = grafo.filhosOrdenados(grafo.filhosIds(selecionadaId))
      } else {
        candidatos = [...grafo.irmaosIds(selecionadaId), ...grafo.conjugesIds(selecionadaId)]
      }

      const posicionados = candidatos.filter((id) => layout.nos.has(id))
      if (!posicionados.length) return

      // Entre vários candidatos, o mais próximo na direção pedida.
      const eixo = direcao === "esquerda" || direcao === "direita" ? "x" : "y"
      const ordenados = posicionados
        .map((id) => ({ id, no: layout.nos.get(id)! }))
        .sort((a, b) => {
          if (direcao === "esquerda") return b.no.x - a.no.x
          if (direcao === "direita") return a.no.x - b.no.x
          const da = Math.abs(a.no[eixo] - atual[eixo])
          const db = Math.abs(b.no[eixo] - atual[eixo])
          return da - db
        })

      const alvoId =
        direcao === "esquerda"
          ? (ordenados.find((c) => c.no.x < atual.x) ?? ordenados[0]).id
          : direcao === "direita"
            ? (ordenados.find((c) => c.no.x > atual.x) ?? ordenados[0]).id
            : ordenados[0].id

      const pessoa = pessoasPorId.get(alvoId)
      if (pessoa) {
        aoSelecionar(pessoa)
        centralizarPessoa(alvoId)
      }
    },
    [selecionadaId, layout, grafo, orientacao, pessoasPorId, aoSelecionar, centralizarPessoa, selecionarPrimeira],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.isContentEditable)) {
        return
      }
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault()
          navegar("cima")
          break
        case "ArrowDown":
          e.preventDefault()
          navegar("baixo")
          break
        case "ArrowLeft":
          e.preventDefault()
          navegar("esquerda")
          break
        case "ArrowRight":
          e.preventDefault()
          navegar("direita")
          break
        case "+":
        case "=":
          e.preventDefault()
          api.zoomPor(1.25)
          break
        case "-":
        case "_":
          e.preventDefault()
          api.zoomPor(0.8)
          break
        case "0":
          e.preventDefault()
          api.enquadrar({ x: 0, y: 0, largura: layout.largura, altura: layout.altura }, 0.08)
          break
        case "Enter":
        case " ":
          if (selecionadaId == null) {
            e.preventDefault()
            selecionarPrimeira()
          }
          break
        default:
          break
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [navegar, api, layout.largura, layout.altura, selecionadaId, selecionarPrimeira])

  /**
   * RÓTULO DE CASAMENTO — o dado da união, no lugar da união.
   *
   * Só nas barras ADJACENTES (as desviadas contornam cards e um texto ali
   * cairia por cima de alguém) e só quando a barra tem folga suficiente para o
   * texto caber sem encostar nos dois cards. Uma união sem data e sem lugar não
   * gera rótulo: escrever "Casamento" sem nenhuma informação seria ruído.
   */
  const rotulosUniao = useMemo(() => {
    if (!exibicao.datas) return []
    const vertical = orientacao === "vertical"
    const saida: Array<{ id: string; x: number; y: number; largura: number; texto: string }> = []

    for (const b of conectoresVisiveis.barras) {
      if (b.desviada || b.uniaoId == null) continue
      const u = grafo.unioes.find((x) => x.id === b.uniaoId)
      if (!u) continue

      const partes: string[] = []
      const ano = anoDe(u.data_inicio)
      if (ano) partes.push(`Casamento: ${ano}`)
      const lugar = [u.local, u.pais].filter(Boolean).join(", ")
      if (lugar) partes.push(lugar)
      if (!partes.length) continue

      // Folga disponível ao longo da barra. Abaixo de 28px não há como escrever
      // nada sem esbarrar nos cards — melhor não escrever.
      const vao = vertical ? Math.abs(b.x2 - b.x1) : Math.abs(b.y2 - b.y1)
      if (vao < 28) continue

      saida.push({
        id: `rot-${b.id}`,
        x: (b.x1 + b.x2) / 2,
        y: (b.y1 + b.y2) / 2,
        largura: vertical ? Math.max(vao, 96) : dim.largura - 24,
        texto: partes.join("\n"),
      })
    }
    return saida
  }, [conectoresVisiveis.barras, grafo, orientacao, exibicao.datas, dim.largura])

  // pessoas com sugestão/duplicidade — pré-calculado, não por cartão
  const marcas = useMemo(() => {
    const sugestao = new Set<number>()
    const duplicidade = new Set<number>()
    for (const i of analise.insights) {
      if (i.categoria === "relacao") i.pessoaIds.forEach((id) => sugestao.add(id))
      if (i.categoria === "duplicidade") i.pessoaIds.forEach((id) => duplicidade.add(id))
    }
    return { sugestao, duplicidade }
  }, [analise.insights])

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden outline-none"
      style={{
        // Papel liso. Sem grade, sem textura, sem gradiente: a única coisa que
        // deve chamar atenção no canvas é o nome das pessoas.
        background: TREE.fundo,
        cursor: "grab",
        touchAction: "none",
      }}
      tabIndex={0}
      role="application"
      aria-label="Árvore genealógica — use as setas para navegar entre parentes"
      onClick={() => setHoverId(null)}
    >
      <div
        ref={mundoRef}
        className="absolute left-0 top-0"
        style={{ transformOrigin: "0 0", willChange: "transform" }}
      >
        <CamadaConectores
          barras={conectoresVisiveis.barras}
          ligacoes={conectoresVisiveis.ligacoes}
          largura={layout.largura}
          altura={layout.altura}
          orientacao={orientacao}
          destacados={destaque.todos}
          temDestaque={temDestaque}
          corDestaque={TREE.conectorAtivo}
        />

        {montados.map(({ id, x, y }) => {
          const pessoa = pessoasPorId.get(id)
          if (!pessoa) return null
          const escondidos = escondidosPorPessoa?.get(id)
          const acoesRamo = aoAlternarRamo
            ? {
                podeAscendentes:
                  podeRecolher(grafo, id, "ascendentes", visiveisSet ?? null) ||
                  (escondidos?.ascendentes ?? 0) > 0,
                podeDescendentes:
                  podeRecolher(grafo, id, "descendentes", visiveisSet ?? null) ||
                  (escondidos?.descendentes ?? 0) > 0,
                ascendentesRecolhidos:
                  !!ramos?.ascendentes.has(id) || !!fronteira?.has(id),
                descendentesRecolhidos: !!ramos?.descendentes.has(id),
                escondidosAscendentes: escondidos?.ascendentes ?? 0,
                escondidosDescendentes: escondidos?.descendentes ?? 0,
                aoAlternar: aoAlternarRamo,
              }
            : undefined

          if (formato === "retrato") {
            return (
              <CartaoRetrato
                key={id}
                pessoa={pessoa}
                analise={analise.porPessoa.get(id)}
                x={x}
                y={y}
                largura={dim.largura}
                altura={dim.altura}
                exibicao={exibicao}
                selecionada={selecionadaId === id}
                focada={hoverId === id}
                esmaecida={
                  (casandoFiltro != null && !casandoFiltro.has(id)) ||
                  (temDestaque && !destaque.todos.has(id))
                }
                paisAlvo={paisAlvo}
                temSugestao={marcas.sugestao.has(id)}
                temDuplicidade={marcas.duplicidade.has(id)}
                parentesco={parentescoDe?.(id) ?? null}
                aoClicar={aoSelecionar}
                aoEntrarHover={setHoverId}
                aoAbrirFoco={aoFocar}
                ramo={acoesRamo}
              />
            )
          }

          return (
            <CartaoPessoa
              key={id}
              pessoa={pessoa}
              analise={analise.porPessoa.get(id)}
              x={x}
              y={y}
              largura={dim.largura}
              altura={dim.altura}
              exibicao={exibicao}
              selecionada={selecionadaId === id}
              focada={hoverId === id}
              esmaecida={
                (casandoFiltro != null && !casandoFiltro.has(id)) ||
                (temDestaque && !destaque.todos.has(id))
              }
              ascendente={destaque.ascendentes.has(id)}
              descendente={destaque.descendentes.has(id)}
              paisAlvo={paisAlvo}
              temSugestao={marcas.sugestao.has(id)}
              temDuplicidade={marcas.duplicidade.has(id)}
              aoClicar={aoSelecionar}
              aoEntrarHover={setHoverId}
              aoAbrirFoco={aoFocar}
              acoes={acoes}
              faltaPai={pessoa.paiId == null}
              faltaMae={pessoa.maeId == null}
              multiplosConjuges={grafo.conjugesIds(id).length}
              paisAlternativos={
                // Um conjunto de pais é "alternativo" quando a pessoa tem
                // genitores que NÃO formam casal entre si — sinal de que a
                // filiação ali tem mais de uma leitura possível.
                pessoa.paiId != null &&
                pessoa.maeId != null &&
                !grafo.casal(pessoa.paiId, pessoa.maeId)
              }
              parentesco={parentescoDe?.(id) ?? null}
              documental={documentalDe?.(id) ?? null}
              aoAbrirPasta={aoAbrirPastaDocumental}
              vertical={orientacao === "vertical"}
              ramo={
                aoAlternarRamo
                  ? {
                      // Recolhido só continua oferecendo o botão quando de fato
                      // dobrou alguém — senão vira ruído permanente na tela.
                      // A fronteira geracional conta como recolhida: é ela que
                      // põe o "+" na ponta da leitura.
                      podeAscendentes:
                        podeRecolher(grafo, id, "ascendentes", visiveisSet ?? null) ||
                        (escondidos?.ascendentes ?? 0) > 0 ||
                        !!fronteira?.has(id),
                      podeDescendentes:
                        podeRecolher(grafo, id, "descendentes", visiveisSet ?? null) ||
                        (escondidos?.descendentes ?? 0) > 0,
                      ascendentesRecolhidos:
                        !!ramos?.ascendentes.has(id) || !!fronteira?.has(id),
                      descendentesRecolhidos: !!ramos?.descendentes.has(id),
                      escondidosAscendentes: escondidos?.ascendentes ?? 0,
                      escondidosDescendentes: escondidos?.descendentes ?? 0,
                      aoAlternar: aoAlternarRamo,
                    }
                  : undefined
              }
            />
          )
        })}
        {/* Rótulo do casamento — mora no conector conjugal, não dentro do card.
            Na referência ele fica entre os dois nomes porque ali marido e
            mulher dividem um card só. Aqui cada um tem o seu, então o dado do
            CASAMENTO — que é da união e não de nenhum dos dois — fica onde a
            união está desenhada: sobre a barra que os liga. */}
        {rotulosUniao.map((r) => (
          <span
            key={r.id}
            aria-hidden
            className="pointer-events-none absolute z-[1] whitespace-pre text-center text-[10px] leading-[13px]"
            style={{
              left: r.x,
              top: r.y,
              width: r.largura,
              transform: "translate(-50%, -50%)",
              color: TREE.textoSuave,
              background: TREE.fundo,
              padding: "1px 4px",
              borderRadius: 3,
            }}
          >
            {r.texto}
          </span>
        ))}

        {/* Lugares vagos — o buraco da linha vira trabalho visível */}
        {fantasmas?.map((f) => (
          <CartaoAdicionar
            key={f.id}
            x={f.x}
            y={f.y}
            largura={f.largura}
            altura={f.altura}
            papel={f.papel}
            formato={formato}
            rotulo={ROTULO_VAGO[f.papel]}
            aoClicar={() => {
              if (f.papel === "pai") acoes?.adicionarPai?.(f.filhoId)
              else if (f.papel === "mae") acoes?.adicionarMae?.(f.filhoId)
              else if (f.papel === "conjuge") acoes?.adicionarConjuge?.(f.filhoId)
              else acoes?.adicionarFilho?.(f.filhoId)
            }}
          />
        ))}
      </div>

    </div>
  )
})
