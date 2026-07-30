// src/components/arvore/motor/arvore-inteligente.tsx
//
// Montagem completa da árvore: câmera + motor + painéis + teclado.
//
// Substitui o par (ReactFlowTree + dagre + 5 passadas de correção) mantendo
// exatamente o mesmo contrato de callbacks da view antiga — nada do fluxo de
// cadastro, permissões ou modais precisou mudar de lugar.

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
import {
  Baby,
  BookMarked,
  Crown,
  FoldVertical,
  GitBranch,
  Heart,
  Lightbulb,
  ListTree,
  Route,
  FolderOpen,
  Sparkles,
  Target,
  UnfoldVertical,
  UserPlus,
  Users,
} from "lucide-react"
import type { Orientacao } from "@/src/lib/genealogia/layout/layout-familiar"
import type { CategoriaInsight } from "@/src/lib/genealogia/motor/tipos"
import { nomeCompleto } from "@/src/lib/genealogia/motor/texto"
import type { PessoaArvore, UniaoArvore } from "../types"
import { ArvoreCanvas, type ArvoreCanvasRef } from "./arvore-canvas"
import {
  ControlesArvore,
  DicaAtalhos,
  EXIBICAO_PADRAO,
  type OpcoesExibicao,
  type Vista,
} from "./controles-arvore"
import { Minimapa } from "./minimapa"
import { VistaLeque, CORES_LEQUE, type CorLeque } from "./vista-leque"
import { VistaDescendencia } from "./vista-descendencia"
import { calcularFantasmas, candidatosAFantasma } from "@/src/lib/genealogia/layout/fantasmas"
import type { AbaPessoa } from "./painel-pessoa"
import { PaletaComandos, type ComandoPaleta } from "./paleta-comandos"
import { PainelInteligencia } from "./painel-inteligencia"
import { PainelPessoa } from "./painel-pessoa"
import { useArvoreMotor, type ModoVisualizacao } from "./use-arvore-motor"
import {
  alternarAscendentes,
  alternarRamo,
  contarRecolhidos,
  GERACOES_PADRAO,
  desserializarRamos,
  expandirAte,
  ramosVazios,
  recolherColaterais,
  serializarRamos,
  temRamoRecolhido,
  type DirecaoRamo,
  type EstadoRamos,
} from "@/src/lib/genealogia/navegacao/ramos"
import { PainelEstatisticas } from "./painel-estatisticas"
import {
  alternarFiltro,
  aplicarFiltros,
  contarAtivos,
  filtrosVazios,
  ROTULO_FILTRO,
  temFiltroAtivo,
  type ChaveFiltro,
  type EstadoFiltros,
} from "@/src/lib/genealogia/navegacao/filtros"
import { calcularParentesco, caminhoGenealogico } from "@/src/lib/genealogia/motor/parentesco"
import { insightsDaPessoa } from "@/src/lib/genealogia/motor/analisar"
import {
  indicadorDaPessoa,
  projetarIndicadores,
  type NecessidadeOficial,
} from "@/src/lib/genealogia/documental/indicadores"
import {
  atual as paradaAtual,
  avancar as avancarHistorico,
  estadoInicial,
  navegar as navegarHistorico,
  podeAvancar,
  podeVoltar,
  registrarZoom,
  voltar as voltarHistorico,
  type EstadoHistorico,
} from "@/src/lib/genealogia/navegacao/historico"
import {
  alturaCard,
  alturaCardRetrato,
  CARTAO_LARGURA,
  CSS_MOVIMENTO_REDUZIDO,
  FOLGAS,
  GAVETA_LARGURA,
  RETRATO_LARGURA,
} from "./tokens"

export interface ArvoreInteligenteRef {
  centralizarPessoa: (id: number) => void
  ajustar: () => void
  /**
   * Prepara a árvore para captura (PDF/PNG): desliga a virtualização, zera a
   * transformação da câmera e entrega o elemento com a árvore INTEIRA no DOM.
   * Restaura tudo ao final, mesmo se a captura falhar.
   */
  capturar: (
    executar: (elemento: HTMLElement, dimensoes: { largura: number; altura: number }) => Promise<void>,
  ) => Promise<void>
}

export interface ArvoreInteligenteProps {
  pessoas: PessoaArvore[]
  unioes: UniaoArvore[]
  pessoaPrincipal: PessoaArvore | null
  paisProcesso?: string | null
  selecionadaId: number | null
  aoSelecionarPessoa: (pessoa: PessoaArvore) => void
  aoAdicionarPai?: (pessoaId: number) => void
  aoAdicionarMae?: (pessoaId: number) => void
  aoAdicionarFilho?: (pessoaId: number) => void
  aoAdicionarConjuge?: (pessoaId: number) => void
  telaCheia: boolean
  aoAlternarTelaCheia: () => void
  /** Botões extras da view hospedeira (ex.: exportar PDF). */
  acoesExtras?: React.ReactNode
  /**
   * OBSOLETO — o layout é sempre automático, como na experiência de referência.
   * As props continuam aceitas para não quebrar o hospedeiro, mas são ignoradas:
   * não existe mais posicionar card à mão nem estado de posição para salvar.
   */
  posicoesSalvas?: Record<string, Record<string, { x: number; y: number }>> | null
  aoSalvarPosicoes?: (p: Record<string, Record<string, { x: number; y: number }>>) => void
  /** Necessidades OFICIAIS do Sistema Documental (indicador consumido). */
  necessidades?: NecessidadeOficial[]
  /** Atalho contextual para a Pasta Documental — a árvore não gere documento. */
  aoAbrirPastaDocumental?: (pessoaId: number) => void
  /** Pessoa selecionada, para o painel lateral operacional. */
  pessoaSelecionada?: PessoaArvore | null
  aoFecharPainel?: () => void
  aoEditarPessoa?: (p: PessoaArvore) => void
  /** Abre a PÁGINA COMPLETA da pessoa — o botão "Pessoa" da gaveta. */
  aoAbrirPaginaPessoa?: (p: PessoaArvore) => void
}

const CHAVE_PREFERENCIAS = "discovery.arvore.preferencias.v1"
/** Ramos dobrados são por ÁRVORE: a dobra de um processo não vale para outro. */
const CHAVE_RAMOS = "discovery.arvore.ramos.v1"

function lerRamos(raizId: number | null): EstadoRamos {
  if (typeof window === "undefined" || raizId == null) return ramosVazios()
  try {
    const bruto = window.localStorage.getItem(`${CHAVE_RAMOS}:${raizId}`)
    return bruto ? desserializarRamos(JSON.parse(bruto)) : ramosVazios()
  } catch {
    return ramosVazios()
  }
}

interface Preferencias {
  orientacao: Orientacao
  exibicao: OpcoesExibicao
  vista: Vista
  geracoesLeque: number
  /** Gerações mostradas em Paisagem/Retrato antes de pedir "+". */
  geracoesVisiveis: number
  /** Gerações mostradas na Descendência. */
  geracoesDescendencia: number
  colorirLeque: CorLeque
}

/**
 * Vista → (orientação, modo).
 *
 * As quatro visualizações não são quatro motores: são duas projeções do mesmo
 * layout (deitada e em pé), mais o leque, que tem desenho próprio. Manter esse
 * mapeamento explícito num lugar só evita o clássico "troquei de aba e o estado
 * ficou pela metade".
 */
const MAPA_VISTA: Record<Vista, { orientacao: Orientacao; modo: ModoVisualizacao } | null> = {
  // Paisagem e Retrato colocam a pessoa em foco NO CENTRO: descendentes de um
  // lado, ascendentes do outro. Antes eu usava o modo "ascendentes", que
  // desenhava só para cima — a pessoa ficava na ponta da árvore, e não no meio
  // dela, que é a leitura da referência.
  paisagem: { orientacao: "horizontal", modo: "ramo" },
  retrato: { orientacao: "vertical", modo: "ramo" },
  descendencia: { orientacao: "vertical", modo: "descendentes" },
  leque: null,
}

const PREFERENCIAS_PADRAO: Preferencias = {
  // Abertura em PAISAGEM: é a leitura que responde "de onde vem a cidadania?"
  // com a pessoa à esquerda e as gerações crescendo para a direita.
  orientacao: "horizontal",
  exibicao: EXIBICAO_PADRAO,
  vista: "paisagem",
  geracoesLeque: 6,
  geracoesVisiveis: GERACOES_PADRAO,
  geracoesDescendencia: 4,
  colorirLeque: "linhas",
}

const VISTAS_VALIDAS: Vista[] = ["paisagem", "retrato", "leque", "descendencia"]

/** Filtros de realce oferecidos na tela — todos vindos do motor (B6). */
const FILTROS_DISPONIVEIS = (Object.keys(ROTULO_FILTRO) as ChaveFiltro[]).map((chave) => ({
  chave: chave as string,
  rotulo: ROTULO_FILTRO[chave],
}))

function lerPreferencias(): Preferencias {
  if (typeof window === "undefined") return PREFERENCIAS_PADRAO
  try {
    const bruto = window.localStorage.getItem(CHAVE_PREFERENCIAS)
    if (!bruto) return PREFERENCIAS_PADRAO
    const p = JSON.parse(bruto) as Partial<Preferencias>
    const vista = VISTAS_VALIDAS.includes(p.vista as Vista) ? (p.vista as Vista) : PREFERENCIAS_PADRAO.vista
    const mapeada = MAPA_VISTA[vista]
    return {
      // A orientação é DERIVADA da vista quando a vista tem uma: guardar as duas
      // soltas foi o que permitia reabrir a tela em "paisagem" desenhada em pé.
      orientacao: mapeada ? mapeada.orientacao : p.orientacao === "vertical" ? "vertical" : "horizontal",
      exibicao: { ...EXIBICAO_PADRAO, ...(p.exibicao ?? {}) },
      vista,
      geracoesLeque: Number.isFinite(p.geracoesLeque) ? Math.min(7, Math.max(4, Number(p.geracoesLeque))) : 6,
      geracoesVisiveis: Number.isFinite(p.geracoesVisiveis)
        ? Math.min(12, Math.max(2, Number(p.geracoesVisiveis)))
        : GERACOES_PADRAO,
      geracoesDescendencia: Number.isFinite(p.geracoesDescendencia)
        ? Math.min(4, Math.max(1, Number(p.geracoesDescendencia)))
        : 4,
      colorirLeque: CORES_LEQUE.some((c) => c.id === p.colorirLeque)
        ? (p.colorirLeque as CorLeque)
        : "linhas",
    }
  } catch {
    return PREFERENCIAS_PADRAO
  }
}

export const ArvoreInteligente = forwardRef<ArvoreInteligenteRef, ArvoreInteligenteProps>(
  function ArvoreInteligente(
    {
      pessoas,
      unioes,
      pessoaPrincipal,
      paisProcesso,
      selecionadaId,
      aoSelecionarPessoa,
      aoAdicionarPai,
      aoAdicionarMae,
      aoAdicionarFilho,
      aoAdicionarConjuge,
      telaCheia,
      aoAlternarTelaCheia,
      acoesExtras,
      necessidades,
      aoAbrirPastaDocumental,
      pessoaSelecionada,
      aoFecharPainel,
      aoEditarPessoa,
      aoAbrirPaginaPessoa,
    },
    ref,
  ) {
    const canvasRef = useRef<ArvoreCanvasRef>(null)
    const [modo, setModo] = useState<ModoVisualizacao>("ramo")
    const [focoId, setFocoId] = useState<number | null>(null)
    const [historico, setHistorico] = useState<EstadoHistorico>(() =>
      estadoInicial({ modo: "completa", focoId: null, selecionadaId: null, zoom: null, rotulo: "Árvore completa" }),
    )
    // Bloqueia o registro no histórico enquanto o próprio histórico está
    // aplicando um estado — senão voltar cria uma entrada nova e o operador
    // nunca chega ao começo.
    const aplicandoHistorico = useRef(false)
    const [prefs, setPrefs] = useState<Preferencias>(() => lerPreferencias())
    const [buscaAberta, setBuscaAberta] = useState(false)
    const [inteligenciaAberta, setInteligenciaAberta] = useState(false)
    const [categoriaInicial, setCategoriaInicial] = useState<CategoriaInsight | null>(null)
    const [atalhosVisiveis, setAtalhosVisiveis] = useState(false)
    const [recentes, setRecentes] = useState<number[]>([])
    const [area, setArea] = useState({ x: 0, y: 0, largura: 0, altura: 0 })
    const [exportando, setExportando] = useState(false)
    const [indiceAberto, setIndiceAberto] = useState(false)
    // O minimapa nasce ABERTO no desktop e RECOLHIDO em tela estreita. Num
    // tablet ele come um quinto da área útil, e a área útil é justamente o que
    // falta ali; o botão de reabrir fica no mesmo canto, então nada some.
    const [minimapaAberto, setMinimapaAberto] = useState(
      () => typeof window === "undefined" || window.innerWidth >= 1280,
    )
    const [ramos, setRamos] = useState<EstadoRamos>(() => lerRamos(pessoaPrincipal?.id ?? null))
    /**
     * FILTROS AVANÇADOS (B6) — religados.
     *
     * A capacidade existia, foi testada e continuou no domínio (`filtros.ts`),
     * mas a barra que a acionava saiu quando o canvas virou papel limpo. O
     * resultado foi pior que remover: o motor de filtro seguia vivo, o canvas
     * seguia aceitando `casandoFiltro`, e nada ligava os dois — capacidade
     * paga e inalcançável.
     *
     * Aqui ela volta SEM devolver mobília ao canvas: os interruptores moram no
     * menu de configurações que já existe, e os atalhos moram no ⌘K. O desenho
     * não ganha um pixel; o filtro volta a funcionar.
     *
     * O comportamento é o mesmo de antes: filtro REALÇA, não esconde. Quem não
     * casa recua de opacidade e continua no lugar — esconder mudaria a
     * topologia e deixaria filho órfão na tela.
     */
    const [filtros, setFiltros] = useState<EstadoFiltros>(() => filtrosVazios())
    /** Aba com que a gaveta abre — o cartão rápido leva direto ao lugar certo. */
    const [abaPainel, setAbaPainel] = useState<AbaPessoa>("resumo")
    const resolverExportacao = useRef<(() => void) | null>(null)

    // A captura precisa esperar o React montar TODOS os cartões (um quadro não
    // basta: o commit e o paint são etapas distintas). Este efeito avisa quando
    // o DOM já reflete o modo de exportação.
    useEffect(() => {
      if (!exportando) return
      const id = requestAnimationFrame(() =>
        requestAnimationFrame(() => resolverExportacao.current?.()),
      )
      return () => cancelAnimationFrame(id)
    }, [exportando])

    useEffect(() => {
      try {
        window.localStorage.setItem(CHAVE_PREFERENCIAS, JSON.stringify(prefs))
      } catch {
        // preferência é conveniência: falhar aqui não pode quebrar a árvore
      }
    }, [prefs])

    // Troca de árvore (outro processo) recarrega as dobras daquela árvore —
    // reaproveitar as do processo anterior esconderia gente sem explicação.
    const raizAtual = pessoaPrincipal?.id ?? null
    const raizAnterior = useRef(raizAtual)
    useEffect(() => {
      if (raizAnterior.current === raizAtual) return
      raizAnterior.current = raizAtual
      setRamos(lerRamos(raizAtual))
    }, [raizAtual])

    useEffect(() => {
      if (typeof window === "undefined" || raizAtual == null) return
      try {
        window.localStorage.setItem(
          `${CHAVE_RAMOS}:${raizAtual}`,
          JSON.stringify(serializarRamos(ramos)),
        )
      } catch {
        // dobra é conveniência: falhar em persistir não pode quebrar a árvore
      }
    }, [ramos, raizAtual])

    const {
      grafo,
      analise,
      layout,
      indiceBusca,
      paisAlvo,
      ocultos,
      escondidosPorPessoa,
      fronteira,
      visiveis,
      facetas,
    } = useArvoreMotor({
      pessoas,
      unioes,
      pessoaPrincipalId: pessoaPrincipal?.id ?? null,
      paisProcesso,
      modo,
      // SELEÇÃO NÃO É FOCO.
      //
      // Isto era `focoId ?? selecionadaId`: clicar num card mudava o conjunto
      // visível, o layout inteiro refluía e a câmera se reenquadrava. Na
      // captura dava para ver a árvore trocar de gente ao simples clique — e o
      // recuo da câmera para a gaveta era engolido pelo reenquadramento.
      // Selecionar abre a gaveta e não mexe no desenho; quem re-enraíza é
      // "Ver árvore a partir desta pessoa".
      focoId,
      orientacao: prefs.orientacao,
      // Retrato tem card PRÓPRIO (em pé). O layout precisa saber disso, senão
      // reserva a caixa deitada e o desenho sai com buraco.
      larguraNo: prefs.vista === "retrato" ? RETRATO_LARGURA : CARTAO_LARGURA,
      alturaNo:
        prefs.vista === "retrato"
          ? alturaCardRetrato(prefs.exibicao)
          : alturaCard(prefs.exibicao),
      ramos,
      // O limite só vale nas leituras de ascendência: em "árvore completa" ou
      // ao isolar um ramo o operador pediu explicitamente para ver tudo.
      limiteGeracoes: modo === "ramo" || modo === "ascendentes" ? prefs.geracoesVisiveis : 0,
    })

    // Slots vagos de pai/mãe — o buraco da linha vira trabalho visível.
    // Só na leitura de ascendência: em Descendência um "+ pai" não faz sentido.
    const fantasmas = useMemo(() => {
      if (prefs.vista === "leque" || prefs.vista === "descendencia") return []
      if (!aoAdicionarPai && !aoAdicionarMae && !aoAdicionarConjuge && !aoAdicionarFilho) return []

      const alvo = focoId ?? selecionadaId ?? pessoaPrincipal?.id ?? null

      // CÔNJUGE VAGO: só para quem está desenhado, não tem união e é parte da
      // leitura em curso (o foco, a linha de cidadania e os filhos do foco).
      // Espalhar "acrescentar cônjuge" por toda a árvore devolveria o campo de
      // "+" que o desenho anterior tinha.
      const candidatosConjuge = new Set<number>()
      if (aoAdicionarConjuge && alvo != null) {
        const considerar = [alvo, ...grafo.filhosIds(alvo), ...analise.linhaCidadania]
        for (const id of considerar) {
          if (!layout.nos.has(id)) continue
          if (grafo.conjugesIds(id).some((c) => layout.nos.has(c))) continue
          candidatosConjuge.add(id)
        }
      }

      return calcularFantasmas(grafo, layout, {
        orientacao: prefs.orientacao,
        largura: prefs.vista === "retrato" ? RETRATO_LARGURA : CARTAO_LARGURA,
        altura:
          prefs.vista === "retrato"
            ? alturaCardRetrato(prefs.exibicao)
            : alturaCard(prefs.exibicao),
        gapCamada: FOLGAS[prefs.orientacao].camada,
        gapCasal: FOLGAS[prefs.orientacao].casal,
        candidatos: aoAdicionarPai || aoAdicionarMae
          ? candidatosAFantasma(grafo, alvo, analise.linhaCidadania, visiveis)
          : [],
        candidatosConjuge,
        // FILHO VAGO: um só, na descendência do foco. É a continuação da linha,
        // não um convite pendurado em cada pessoa da árvore.
        candidatosFilho: aoAdicionarFilho && alvo != null && layout.nos.has(alvo) ? [alvo] : [],
      })
    }, [
      grafo,
      layout,
      prefs.vista,
      prefs.orientacao,
      prefs.exibicao,
      focoId,
      selecionadaId,
      pessoaPrincipal?.id,
      analise.linhaCidadania,
      visiveis,
      aoAdicionarPai,
      aoAdicionarMae,
      aoAdicionarConjuge,
      aoAdicionarFilho,
    ])

    const pessoasPorId = useMemo(() => {
      const m = new Map<number, PessoaArvore>()
      for (const p of pessoas) m.set(p.id, p)
      return m
    }, [pessoas])

    const sexoPorId = useMemo(() => {
      const m = new Map<number, string | null | undefined>()
      for (const p of pessoas) m.set(p.id, p.sexo)
      return m
    }, [pessoas])

    // Indicador documental por sujeito — projeção do que o Sistema Documental
    // já decidiu. Recalcula só quando as necessidades mudam.
    const projecaoDocumental = useMemo(() => projetarIndicadores(necessidades), [necessidades])

    const indicadorDe = useCallback(
      (pessoaId: number) =>
        indicadorDaPessoa(
          projecaoDocumental,
          pessoaId,
          grafo.unioesDe(pessoaId).map((u) => u.id),
        ),
      [projecaoDocumental, grafo],
    )

    // Ponto focal para o rótulo de parentesco: o requerente é a referência que
    // importa num processo de cidadania, não a pessoa selecionada.
    const referenciaId = analise.porPessoa.size
      ? (analise.linhaCidadania[0] ?? pessoaPrincipal?.id ?? null)
      : null

    // Conjunto que CASA com os filtros. Memoizado pela identidade dos filtros e
    // da análise: hover, pan e zoom não passam por aqui. `null` quando não há
    // filtro ligado — é o que faz o canvas desenhar todo mundo em cheio.
    const casandoFiltro = useMemo(() => {
      if (!temFiltroAtivo(filtros)) return null
      return aplicarFiltros(
        { grafo, analise, documental: projecaoDocumental },
        { ...filtros, referenciaId: filtros.referenciaId ?? pessoaPrincipal?.id ?? null },
      )
    }, [filtros, grafo, analise, projecaoDocumental, pessoaPrincipal?.id])

    const alternarFiltroDe = useCallback((chave: ChaveFiltro) => {
      setFiltros((f) => alternarFiltro(f, chave))
    }, [])

    const trocarGeracaoFiltrada = useCallback((g: number | null) => {
      setFiltros((f) => ({ ...f, geracao: g }))
    }, [])

    const limparFiltros = useCallback(() => setFiltros(filtrosVazios()), [])

    const parentescoDe = useCallback(
      (pessoaId: number) => {
        if (referenciaId == null || pessoaId === referenciaId) return null
        return calcularParentesco(grafo, referenciaId, pessoaId)?.rotulo ?? null
      },
      [grafo, referenciaId],
    )

    const geracoesDisponiveis = useMemo(() => {
      const s = new Set<number>()
      analise.porPessoa.forEach((a) => s.add(a.geracao))
      return [...s].sort((a, b) => a - b)
    }, [analise])

    const nomeDe = useCallback(
      (id: number) => {
        const p = pessoasPorId.get(id)
        return p ? nomeCompleto(p) : `#${id}`
      },
      [pessoasPorId],
    )

    // A GAVETA ROUBA 400px DA TELA.
    //
    // Sem compensar, a pessoa em foco continua centrada na tela INTEIRA — ou
    // seja, atrás do painel ou colada na borda esquerda, que foi o que a
    // captura mostrou. A câmera desloca meia largura do painel ao abrir e
    // devolve ao fechar, mantendo o foco no centro da área que sobrou.
    const gavetaAberta = !!pessoaSelecionada
    const gavetaAnterior = useRef(gavetaAberta)
    useEffect(() => {
      if (gavetaAnterior.current === gavetaAberta) return
      gavetaAnterior.current = gavetaAberta
      const k = canvasRef.current?.obterViewport().k ?? 1
      canvasRef.current?.api?.panPor((gavetaAberta ? -1 : 1) * (GAVETA_LARGURA / 2) * k, 0)
    }, [gavetaAberta])

    // ---------- colapso de ramos ----------
    const alternarRamoDe = useCallback(
      (id: number, direcao: DirecaoRamo) => {
        setRamos((r) =>
          direcao === "ascendentes"
            ? alternarAscendentes(r, id, fronteira)
            : alternarRamo(r, id, direcao),
        )
      },
      [fronteira],
    )

    // ---------- navegação ----------
    const irParaPessoa = useCallback(
      (id: number, abrirPainel = true) => {
        const pessoa = pessoasPorId.get(id)
        if (!pessoa) return

        // Atrás de uma dobra? Abre só as fronteiras que escondem esta pessoa.
        // Ir para alguém e não ver nada acontecer é o pior resultado possível.
        setRamos((r) => expandirAte(grafo, r, id))

        // Se a pessoa está fora do modo atual, o modo cede — nunca deixamos o
        // operador clicar num resultado e "não acontecer nada".
        if (!layout.nos.has(id)) {
          setModo("completa")
          setFocoId(null)
          // espera o layout novo antes de centralizar
          requestAnimationFrame(() => {
            requestAnimationFrame(() => canvasRef.current?.centralizarPessoa(id, 1))
          })
        } else {
          canvasRef.current?.centralizarPessoa(id, Math.max(0.75, canvasRef.current.obterViewport().k))
        }

        if (abrirPainel) aoSelecionarPessoa(pessoa)
        setRecentes((r) => [id, ...r.filter((x) => x !== id)].slice(0, 8))
      },
      [pessoasPorId, layout.nos, aoSelecionarPessoa, grafo],
    )

    const registrar = useCallback(
      (destino: { modo: ModoVisualizacao; focoId: number | null; selecionadaId: number | null; rotulo: string }) => {
        if (aplicandoHistorico.current) return
        setHistorico((h) =>
          navegarHistorico(h, {
            modo: destino.modo,
            focoId: destino.focoId,
            selecionadaId: destino.selecionadaId,
            zoom: canvasRef.current?.obterViewport().k ?? null,
            rotulo: destino.rotulo,
          }),
        )
      },
      [],
    )

    const irParaModo = useCallback(
      (novoModo: ModoVisualizacao, novoFoco: number | null, rotulo: string) => {
        setModo(novoModo)
        setFocoId(novoFoco)
        registrar({ modo: novoModo, focoId: novoFoco, selecionadaId, rotulo })
      },
      [registrar, selecionadaId],
    )

    // Re-enraizar: "ver a árvore a partir desta pessoa". É o gesto que o
    // operador mais repete ao subir uma linha, e por isso é a ação primária do
    // cartão rápido. Mantém a visualização atual e registra no histórico, para
    // que voltar desfaça exatamente um salto.
    const enraizarEm = useCallback(
      (id: number) => {
        setFocoId(id)
        setRamos((r) => expandirAte(grafo, r, id))
        registrar({ modo, focoId: id, selecionadaId, rotulo: `Árvore a partir de ${nomeDe(id)}` })
        requestAnimationFrame(() =>
          requestAnimationFrame(() => canvasRef.current?.centralizarPessoa(id)),
        )
      },
      [grafo, registrar, modo, selecionadaId, nomeDe],
    )

    const abrirFicha = useCallback(
      (id: number, aba: AbaPessoa = "resumo") => {
        const p = pessoasPorId.get(id)
        if (!p) return
        setAbaPainel(aba)
        aoSelecionarPessoa(p)
      },
      [pessoasPorId, aoSelecionarPessoa],
    )

    // Trocar de visualização mantém o CONTEXTO: quem estava em foco continua em
    // foco. Trocar de aba e ser jogado de volta ao começo da árvore é o erro que
    // faz o operador parar de usar as outras visualizações.
    const trocarVista = useCallback(
      (nova: Vista) => {
        setPrefs((p) => ({ ...p, vista: nova, orientacao: MAPA_VISTA[nova]?.orientacao ?? p.orientacao }))
        const mapeada = MAPA_VISTA[nova]
        if (mapeada) {
          setModo(mapeada.modo)
          setFocoId((f) => f ?? selecionadaId ?? null)
        }
        requestAnimationFrame(() =>
          requestAnimationFrame(() => canvasRef.current?.ajustarTudo()),
        )
      },
      [selecionadaId],
    )

    const focarFamilia = useCallback(
      (id: number) => {
        irParaModo("familia", id, `Família de ${nomeDe(id)}`)
      },
      [irParaModo, nomeDe],
    )

    const isolarRamo = useCallback(
      (id: number) => {
        irParaModo("ramo", id, `Ramo de ${nomeDe(id)}`)
      },
      [irParaModo, nomeDe],
    )

    const verCompleta = useCallback(() => {
      irParaModo("completa", null, "Árvore completa")
      requestAnimationFrame(() => canvasRef.current?.ajustarTudo())
    }, [irParaModo])

    /**
     * INÍCIO — volta à pessoa inicial e FECHA as linhas expandidas.
     * RECENTRAR — volta à pessoa inicial e MANTÉM o que foi expandido.
     * São duas funções distintas: depois de abrir seis ramos, uma desfaz o
     * trabalho e a outra só devolve o enquadramento.
     */
    const voltarAoRequerente = useCallback(() => {
      if (referenciaId == null) return
      setRamos(ramosVazios())
      setFocoId(null)
      const pessoa = pessoasPorId.get(referenciaId)
      if (pessoa) aoSelecionarPessoa(pessoa)
      registrar({ modo, focoId: null, selecionadaId: referenciaId, rotulo: "Início" })
      requestAnimationFrame(() =>
        requestAnimationFrame(() => canvasRef.current?.centralizarPessoa(referenciaId, 1)),
      )
    }, [referenciaId, pessoasPorId, aoSelecionarPessoa, registrar, modo])

    const recentrar = useCallback(() => {
      if (referenciaId == null) return
      setFocoId(null)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => canvasRef.current?.centralizarPessoa(referenciaId)),
      )
    }, [referenciaId])

    // Aplicar uma parada do histórico: restaura modo, foco, seleção e zoom.
    const aplicarParada = useCallback(
      (proximo: EstadoHistorico) => {
        const parada = paradaAtual(proximo)
        if (!parada) return
        aplicandoHistorico.current = true
        setHistorico(proximo)
        setModo(parada.modo as ModoVisualizacao)
        setFocoId(parada.focoId)
        if (parada.selecionadaId != null) {
          const pessoa = pessoasPorId.get(parada.selecionadaId)
          if (pessoa) aoSelecionarPessoa(pessoa)
        }
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (parada.selecionadaId != null) {
              canvasRef.current?.centralizarPessoa(parada.selecionadaId, parada.zoom ?? undefined)
            } else if (parada.zoom != null) {
              canvasRef.current?.zoomPara(parada.zoom)
            }
            aplicandoHistorico.current = false
          })
        })
      },
      [pessoasPorId, aoSelecionarPessoa],
    )

    const navegarVoltar = useCallback(() => aplicarParada(voltarHistorico(historico)), [historico, aplicarParada])
    const navegarAvancar = useCallback(() => aplicarParada(avancarHistorico(historico)), [historico, aplicarParada])

    const selecionar = useCallback(
      (pessoa: PessoaArvore) => {
        // Clique num card abre a gaveta lateral na aba de resumo — é o
        // comportamento da referência ("clicking a person's name triggers a
        // side sheet displaying additional details").
        setAbaPainel("resumo")
        aoSelecionarPessoa(pessoa)
        setRecentes((r) => [pessoa.id, ...r.filter((x) => x !== pessoa.id)].slice(0, 8))
        registrar({ modo, focoId, selecionadaId: pessoa.id, rotulo: nomeCompleto(pessoa) })
      },
      [aoSelecionarPessoa, registrar, modo, focoId],
    )

    // ABERTURA: a árvore nasce centrada no requerente, não no centro geométrico
    // do desenho. Num processo de cidadania o requerente é sempre o ponto de
    // partida da leitura; enquadrar "tudo" obriga o operador a procurá-lo.
    const abriuCentralizado = useRef(false)
    useEffect(() => {
      if (abriuCentralizado.current) return
      if (referenciaId == null || !layout.nos.has(referenciaId)) return
      abriuCentralizado.current = true
      const id = requestAnimationFrame(() =>
        requestAnimationFrame(() => canvasRef.current?.centralizarPessoa(referenciaId, 1)),
      )
      return () => cancelAnimationFrame(id)
    }, [referenciaId, layout])


    useImperativeHandle(
      ref,
      () => ({
        centralizarPessoa: (id: number) => irParaPessoa(id, false),
        ajustar: () => canvasRef.current?.ajustarTudo(),
        capturar: async (executar) => {
          // A exportação vale para as QUATRO visualizações. No canvas o alvo é o
          // mundo do layout; no leque é o próprio SVG, que já tem o tamanho
          // final. Sem este segundo caminho, o botão de PDF ficaria inerte
          // exatamente na vista em que a árvore cabe inteira numa página.
          const doCanvas = canvasRef.current?.elementoMundo() ?? null
          const doLeque = doCanvas
            ? null
            : (document.querySelector("[data-arvore] [data-leque-mundo]") as HTMLElement | null)
          const mundo = doCanvas ?? doLeque
          if (!mundo) return

          const dimensoes = doCanvas
            ? { largura: layout.largura, altura: layout.altura }
            : {
                largura: Number(doLeque?.dataset.largura ?? 0),
                altura: Number(doLeque?.dataset.altura ?? 0),
              }
          if (!dimensoes.largura || !dimensoes.altura) return

          const transformOriginal = mundo.style.transform
          setExportando(true)
          try {
            await new Promise<void>((resolve) => {
              resolverExportacao.current = resolve
            })
            resolverExportacao.current = null
            mundo.style.transform = "none"
            mundo.style.width = `${dimensoes.largura}px`
            mundo.style.height = `${dimensoes.altura}px`
            await executar(mundo, dimensoes)
          } finally {
            mundo.style.transform = transformOriginal
            mundo.style.width = ""
            mundo.style.height = ""
            setExportando(false)
            canvasRef.current?.ajustarTudo()
          }
        },
      }),
      [irParaPessoa, layout.largura, layout.altura],
    )

    // ---------- atalhos globais ----------
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        const alvo = e.target as HTMLElement | null
        const digitando =
          !!alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.isContentEditable)

        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
          e.preventDefault()
          setBuscaAberta(true)
          return
        }
        if (digitando) return

        if (e.key === "/") {
          e.preventDefault()
          setBuscaAberta(true)
        } else if (e.key.toLowerCase() === "i") {
          e.preventDefault()
          setInteligenciaAberta((v) => !v)
        } else if (e.key.toLowerCase() === "s") {
          e.preventDefault()
          setIndiceAberto((v) => !v)
        } else if (e.key.toLowerCase() === "m") {
          e.preventDefault()
          setMinimapaAberto((v) => !v)
        } else if (e.key === "?") {
          e.preventDefault()
          setAtalhosVisiveis(true)
        } else if (e.key === "Escape") {
          if (atalhosVisiveis) setAtalhosVisiveis(false)
          else if (buscaAberta) setBuscaAberta(false)
          else if (indiceAberto) setIndiceAberto(false)
          else if (inteligenciaAberta) setInteligenciaAberta(false)
          // O botão de fechar da gaveta anuncia "(Esc)". Sem esta linha a
          // promessa era falsa e a gaveta ficava aberta cobrindo os menus do
          // canto direito — inclusive impedindo trocar de visualização.
          else if (pessoaSelecionada) aoFecharPainel?.()
          else if (modo !== "completa") {
            setModo("completa")
            setFocoId(null)
          }
        }
      }
      window.addEventListener("keydown", onKey)
      return () => window.removeEventListener("keydown", onKey)
    }, [
      atalhosVisiveis,
      buscaAberta,
      inteligenciaAberta,
      indiceAberto,
      modo,
      pessoaSelecionada,
      aoFecharPainel,
    ])

    // ---------- comandos da paleta ----------
    const comandos: ComandoPaleta[] = useMemo(() => {
      const base: ComandoPaleta[] = [
        {
          id: "modo-completa",
          rotulo: "Ver árvore completa",
          descricao: "Mostra todas as pessoas",
          icone: <ListTree className="h-3.5 w-3.5" />,
          executar: () => {
            setModo("completa")
            setFocoId(null)
          },
        },
        {
          id: "modo-linha",
          rotulo: "Ver só a linha de cidadania",
          descricao: "Requerente até o dante causa, com os cônjuges",
          icone: <Route className="h-3.5 w-3.5" />,
          executar: () => setModo("linha"),
        },
        {
          id: "inteligencia",
          rotulo: "Abrir o que a árvore encontrou",
          descricao: `${analise.insights.length} achados · saúde ${analise.qualidade.score}/100`,
          atalho: "I",
          icone: <Lightbulb className="h-3.5 w-3.5" />,
          executar: () => setInteligenciaAberta(true),
        },
        {
          id: "orientacao",
          rotulo: prefs.orientacao === "vertical" ? "Deitar a árvore (horizontal)" : "Levantar a árvore (vertical)",
          icone: <GitBranch className="h-3.5 w-3.5" />,
          executar: () =>
            setPrefs((p) => ({ ...p, orientacao: p.orientacao === "vertical" ? "horizontal" : "vertical" })),
        },
        {
          id: "voltar-requerente",
          rotulo: "Voltar ao requerente",
          descricao: referenciaId != null ? nomeDe(referenciaId) : "Nenhum requerente identificado",
          icone: <Target className="h-3.5 w-3.5" />,
          executar: voltarAoRequerente,
        },
        // ---------------------------------------------------------------
        // COMANDOS QUE ESTAVAM ÓRFÃOS.
        //
        // "Recolher colaterais", "expandir tudo" e a contagem de gente escondida
        // continuaram existindo no motor de navegação e deixaram de ter porta:
        // a barra que os acionava saiu. Eles voltam aqui, no ⌘K, que é overlay —
        // a capacidade volta sem custar um pixel ao desenho.
        // ---------------------------------------------------------------
        {
          id: "recolher-colaterais",
          rotulo: "Recolher os colaterais",
          descricao: "Deixa só a linha de cidadania aberta; o resto dobra sem sair da árvore",
          icone: <FoldVertical className="h-3.5 w-3.5" />,
          executar: () =>
            setRamos(recolherColaterais(grafo, analise.linhaCidadania, referenciaId)),
        },
        ...(temRamoRecolhido(ramos)
          ? [
              {
                id: "expandir-tudo",
                rotulo: "Expandir todos os ramos",
                descricao: `${contarRecolhidos(ramos)} ramo(s) dobrado(s) agora`,
                icone: <UnfoldVertical className="h-3.5 w-3.5" />,
                executar: () => setRamos(ramosVazios()),
              } satisfies ComandoPaleta,
            ]
          : []),
        ...(ocultos.length
          ? [
              {
                id: "revelar-ocultos",
                rotulo: `Revelar ${ocultos.length} pessoa(s) fora desta leitura`,
                descricao: "Volta à árvore completa, sem modo de foco",
                icone: <Sparkles className="h-3.5 w-3.5" />,
                executar: () => {
                  setModo("completa")
                  setFocoId(null)
                },
              } satisfies ComandoPaleta,
            ]
          : []),
        ...(temFiltroAtivo(filtros)
          ? [
              {
                id: "limpar-realce",
                rotulo: `Limpar o realce (${contarAtivos(filtros)} ativo(s))`,
                descricao: casandoFiltro
                  ? `${casandoFiltro.size} de ${grafo.pessoas.length} pessoas em evidência`
                  : undefined,
                icone: <Sparkles className="h-3.5 w-3.5" />,
                executar: limparFiltros,
              } satisfies ComandoPaleta,
            ]
          : FILTROS_DISPONIVEIS.map((f) => ({
              id: `realce-${f.chave}`,
              rotulo: `Realçar: ${f.rotulo}`,
              descricao: "Acende quem casa e recua o resto — ninguém sai do lugar",
              icone: <Sparkles className="h-3.5 w-3.5" />,
              executar: () => alternarFiltroDe(f.chave as ChaveFiltro),
            }))),
        {
          id: "estatisticas",
          rotulo: "Estatísticas da árvore",
          descricao: `${facetas.sobrenomes.length} sobrenomes · ${facetas.localidades.length} lugares${
            facetas.sobrenomesComVariacao.length
              ? ` · ${facetas.sobrenomesComVariacao.length} com variação de grafia`
              : ""
          }`,
          atalho: "S",
          icone: <BookMarked className="h-3.5 w-3.5" />,
          executar: () => setIndiceAberto(true),
        },
      ]


      if (analise.danteCausaId != null) {
        base.splice(2, 0, {
          id: "ir-dante-causa",
          rotulo: `Ir para o dante causa — ${nomeDe(analise.danteCausaId)}`,
          descricao: "O ascendente que origina o direito",
          icone: <Crown className="h-3.5 w-3.5" />,
          executar: () => irParaPessoa(analise.danteCausaId!),
        })
      }

      const sel = selecionadaId
      if (sel != null) {
        const nome = nomeDe(sel)
        base.push(
          {
            id: "focar-familia",
            rotulo: `Focar a família de ${nome}`,
            icone: <ListTree className="h-3.5 w-3.5" />,
            executar: () => focarFamilia(sel),
          },
          {
            id: "ver-ascendentes",
            rotulo: `Ver ascendentes de ${nome}`,
            icone: <Route className="h-3.5 w-3.5" />,
            executar: () => irParaModo("ascendentes", sel, `Ascendentes de ${nome}`),
          },
          {
            id: "ver-descendentes",
            rotulo: `Ver descendentes de ${nome}`,
            icone: <GitBranch className="h-3.5 w-3.5" />,
            executar: () => irParaModo("descendentes", sel, `Descendentes de ${nome}`),
          },
          // A gaveta sabe abrir JÁ na seção pedida (`abaInicial`), e essa
          // capacidade ficou sem quem a chamasse quando a barra saiu. Estes
          // comandos são a porta: "me leve direto às relações desta pessoa".
          {
            id: "ficha-relacoes",
            rotulo: `Abrir ${nome} em Parentescos`,
            icone: <Users className="h-3.5 w-3.5" />,
            executar: () => abrirFicha(sel, "relacoes"),
          },
          {
            id: "ficha-documental",
            rotulo: `Abrir ${nome} em Situação documental`,
            icone: <FolderOpen className="h-3.5 w-3.5" />,
            executar: () => abrirFicha(sel, "documental"),
          },
          {
            id: "ficha-alertas",
            rotulo: `Abrir ${nome} em Alertas`,
            icone: <Lightbulb className="h-3.5 w-3.5" />,
            executar: () => abrirFicha(sel, "alertas"),
          },
          {
            id: "isolar-ramo",
            rotulo: `Isolar o ramo de ${nome}`,
            descricao: "Mostra só esta descendência e a subida até a origem",
            icone: <Route className="h-3.5 w-3.5" />,
            executar: () => isolarRamo(sel),
          },
          {
            id: "dobrar-descendentes",
            rotulo: ramos.descendentes.has(sel)
              ? `Expandir os descendentes de ${nome}`
              : `Recolher os descendentes de ${nome}`,
            descricao: "Dobra o ramo sem tirar a pessoa da árvore",
            icone: ramos.descendentes.has(sel) ? (
              <UnfoldVertical className="h-3.5 w-3.5" />
            ) : (
              <FoldVertical className="h-3.5 w-3.5" />
            ),
            executar: () => alternarRamoDe(sel, "descendentes"),
          },
          {
            id: "dobrar-ascendentes",
            rotulo: ramos.ascendentes.has(sel)
              ? `Expandir os ascendentes de ${nome}`
              : `Recolher os ascendentes de ${nome}`,
            descricao: "Dobra a subida sem tirar a pessoa da árvore",
            icone: ramos.ascendentes.has(sel) ? (
              <UnfoldVertical className="h-3.5 w-3.5" />
            ) : (
              <FoldVertical className="h-3.5 w-3.5" />
            ),
            executar: () => alternarRamoDe(sel, "ascendentes"),
          },
        )
        if (aoAbrirPastaDocumental) {
          base.push({
            id: "pasta-documental",
            rotulo: `Abrir a Pasta Documental de ${nome}`,
            descricao: "Vai para o Sistema Documental no contexto desta pessoa",
            icone: <FolderOpen className="h-3.5 w-3.5" />,
            executar: () => aoAbrirPastaDocumental(sel),
          })
        }
        if (aoAdicionarPai) {
          base.push({
            id: "add-pai",
            rotulo: `Adicionar pai de ${nome}`,
            icone: <UserPlus className="h-3.5 w-3.5" />,
            executar: () => aoAdicionarPai(sel),
          })
        }
        if (aoAdicionarMae) {
          base.push({
            id: "add-mae",
            rotulo: `Adicionar mãe de ${nome}`,
            icone: <UserPlus className="h-3.5 w-3.5" />,
            executar: () => aoAdicionarMae(sel),
          })
        }
        if (aoAdicionarConjuge) {
          base.push({
            id: "add-conjuge",
            rotulo: `Adicionar cônjuge de ${nome}`,
            icone: <Heart className="h-3.5 w-3.5" />,
            executar: () => aoAdicionarConjuge(sel),
          })
        }
        if (aoAdicionarFilho) {
          base.push({
            id: "add-filho",
            rotulo: `Adicionar filho(a) de ${nome}`,
            icone: <Baby className="h-3.5 w-3.5" />,
            executar: () => aoAdicionarFilho(sel),
          })
        }
      }

      return base
    }, [
      analise.insights.length,
      analise.qualidade.score,
      analise.danteCausaId,
      prefs.orientacao,
      selecionadaId,
      nomeDe,
      irParaPessoa,
      focarFamilia,
      isolarRamo,
      irParaModo,
      voltarAoRequerente,
      referenciaId,
      aoAbrirPastaDocumental,
      aoAdicionarPai,
      aoAdicionarMae,
      aoAdicionarConjuge,
      aoAdicionarFilho,
      ramos,
      facetas,
      alternarRamoDe,
      grafo,
      analise.linhaCidadania,
      ocultos.length,
      filtros,
      casandoFiltro,
      alternarFiltroDe,
      limparFiltros,
      abrirFicha,
    ])

    // O CANVAS VAI DE PONTA A PONTA.
    //
    // A faixa de cabeçalho que existia aqui — título, subtítulo, trilha de
    // parentesco, chip de linha — saiu inteira. Ela roubava altura do papel,
    // repetia o que a árvore já desenha e, sobretudo, não existe na experiência
    // de referência: lá os comandos flutuam sobre o desenho. A identificação da
    // pessoa continua onde ela é acionável — na gaveta e na página da pessoa.

    return (
      <div data-arvore className="relative flex h-full w-full flex-col">
        <style>{CSS_MOVIMENTO_REDUZIDO}</style>

        <div className="relative flex-1 overflow-hidden">
          {prefs.vista === "descendencia" ? (
            <VistaDescendencia
              grafo={grafo}
              analise={analise}
              pessoasPorId={pessoasPorId}
              raizId={focoId ?? selecionadaId ?? referenciaId ?? pessoaPrincipal?.id ?? null}
              selecionadaId={selecionadaId}
              paisAlvo={paisAlvo}
              recolhidos={ramos.descendentes}
              geracoes={prefs.geracoesDescendencia}
              retratos={prefs.exibicao.retratos}
              aoAlternarRamo={(id) => alternarRamoDe(id, "descendentes")}
              aoExpandirTudo={() =>
                setRamos((r) => ({ ...r, descendentes: new Set<number>() }))
              }
              aoSelecionar={selecionar}
              aoEnraizar={enraizarEm}
              parentescoDe={parentescoDe}
              documentalDe={(id) => {
                const i = indicadorDe(id)
                return { situacao: i.situacao, progresso: i.progresso, pendentes: i.pendentes + i.naoLocalizadas }
              }}
              aoAbrirPastaDocumental={aoAbrirPastaDocumental}
            />
          ) : prefs.vista === "leque" ? (
            <VistaLeque
              grafo={grafo}
              analise={analise}
              pessoasPorId={pessoasPorId}
              raizId={focoId ?? selecionadaId ?? referenciaId ?? pessoaPrincipal?.id ?? null}
              selecionadaId={selecionadaId}
              paisAlvo={paisAlvo}
              geracoes={prefs.geracoesLeque}
              colorirPor={prefs.colorirLeque}
              aoSelecionar={selecionar}
              aoReenraizar={enraizarEm}
              aoAdicionarPai={aoAdicionarPai}
              aoAdicionarMae={aoAdicionarMae}
            />
          ) : (
            <ArvoreCanvas
              ref={canvasRef}
              grafo={grafo}
              analise={analise}
              layout={layout}
              pessoasPorId={pessoasPorId}
              orientacao={prefs.orientacao}
              exibicao={prefs.exibicao}
              formato={prefs.vista === "retrato" ? "retrato" : "deitado"}
              selecionadaId={selecionadaId}
              raizId={pessoaPrincipal?.id ?? null}
              paisAlvo={paisAlvo}
              aoSelecionar={selecionar}
              aoFocar={focarFamilia}
              aoMudarAreaVisivel={setArea}
              renderizarTudo={exportando}
              parentescoDe={parentescoDe}
              documentalDe={(id) => {
                const i = indicadorDe(id)
                return { situacao: i.situacao, progresso: i.progresso, pendentes: i.pendentes + i.naoLocalizadas }
              }}
              aoAbrirPastaDocumental={aoAbrirPastaDocumental}
              casandoFiltro={casandoFiltro}
              acoes={{
                adicionarPai: aoAdicionarPai,
                adicionarMae: aoAdicionarMae,
                adicionarConjuge: aoAdicionarConjuge,
                adicionarFilho: aoAdicionarFilho,
              }}
              ramos={ramos}
              escondidosPorPessoa={escondidosPorPessoa}
              aoAlternarRamo={alternarRamoDe}
              visiveisSet={visiveis}
              fronteira={fronteira}
              fantasmas={fantasmas}
            />
          )}

          {/* Minimapa — só nas leituras que têm câmera livre. No leque e na
              descendência o desenho já cabe na tela e um mapa ali seria
              mobília sem função. */}
          {prefs.vista !== "leque" && prefs.vista !== "descendencia" && layout.nos.size > 0 && (
            <Minimapa
              layout={layout}
              sexoPorId={sexoPorId}
              area={area}
              selecionadaId={selecionadaId}
              raizId={referenciaId}
              aberto={minimapaAberto}
              aoAlternar={setMinimapaAberto}
              aoNavegar={(x, y) => canvasRef.current?.api?.centralizarEm(x, y)}
            />
          )}

          <ControlesArvore
            analise={analise}
            vista={prefs.vista}
            aoTrocarVista={trocarVista}
            aoAbrirBusca={() => setBuscaAberta(true)}
            aoAbrirInteligencia={() => {
              setCategoriaInicial(null)
              setInteligenciaAberta((v) => !v)
            }}
            inteligenciaAberta={inteligenciaAberta}
            telaCheia={telaCheia}
            aoAlternarTelaCheia={aoAlternarTelaCheia}
            extras={acoesExtras}
            podeVoltar={podeVoltar(historico)}
            podeAvancar={podeAvancar(historico)}
            aoVoltar={navegarVoltar}
            aoAvancar={navegarAvancar}
            aoVoltarAoRequerente={voltarAoRequerente}
            aoRecentrar={recentrar}
            temRequerente={referenciaId != null}
            temSelecao={selecionadaId != null}
            aoZoom={(f) => {
              canvasRef.current?.zoom(f)
              const k = canvasRef.current?.obterViewport().k
              if (k != null) setHistorico((h) => registrarZoom(h, k))
            }}
            aoAjustar={() => canvasRef.current?.ajustarTudo()}
            aoAbrirEstatisticas={() => setIndiceAberto(true)}
            exibicao={prefs.exibicao}
            aoTrocarExibicao={(o) => setPrefs((p) => ({ ...p, exibicao: o }))}
            geracoesLeque={prefs.geracoesLeque}
            aoTrocarGeracoesLeque={(n) => setPrefs((p) => ({ ...p, geracoesLeque: n }))}
            geracoesVisiveis={prefs.geracoesVisiveis}
            aoTrocarGeracoesVisiveis={(n) => setPrefs((p) => ({ ...p, geracoesVisiveis: n }))}
            geracoesDescendencia={prefs.geracoesDescendencia}
            aoTrocarGeracoesDescendencia={(n) => setPrefs((p) => ({ ...p, geracoesDescendencia: n }))}
            colorirLeque={prefs.colorirLeque}
            aoTrocarColorirLeque={(c) => setPrefs((p) => ({ ...p, colorirLeque: c }))}
            recentes={recentes.filter((id) => id !== selecionadaId).slice(0, 8)}
            nomeDe={nomeDe}
            aoIrParaPessoa={irParaPessoa}
            filtrosAtivos={filtros.chaves as Set<string>}
            filtrosDisponiveis={FILTROS_DISPONIVEIS}
            aoAlternarFiltro={(c) => alternarFiltroDe(c as ChaveFiltro)}
            geracaoFiltrada={filtros.geracao}
            geracoesDisponiveis={geracoesDisponiveis}
            aoTrocarGeracaoFiltrada={trocarGeracaoFiltrada}
            aoLimparFiltros={limparFiltros}
            resumoFiltro={
              casandoFiltro
                ? { casando: casandoFiltro.size, total: grafo.pessoas.length }
                : null
            }
            recuoDireita={gavetaAberta ? GAVETA_LARGURA : 0}
          />

          <PainelEstatisticas
            aberto={indiceAberto}
            facetas={facetas}
            qualidade={analise.qualidade}
            aoFechar={() => setIndiceAberto(false)}
            aoIrParaPessoa={(id) => irParaPessoa(id)}
          />

          {pessoaSelecionada && (
            <PainelPessoa
              pessoa={pessoaSelecionada}
              grafo={grafo}
              analise={analise}
              indicador={indicadorDe(pessoaSelecionada.id)}
              parentesco={parentescoDe(pessoaSelecionada.id)}
              insights={insightsDaPessoa(analise, pessoaSelecionada.id)}
              aoFechar={() => aoFecharPainel?.()}
              aoIrParaPessoa={(id) => irParaPessoa(id)}
              aoAbrirPastaDocumental={aoAbrirPastaDocumental}
              aoEditar={aoEditarPessoa}
              aoAbrirPessoa={aoAbrirPaginaPessoa}
              aoVerArvore={enraizarEm}
              abaInicial={abaPainel}
              aoAdicionarPai={aoAdicionarPai}
              aoAdicionarMae={aoAdicionarMae}
              aoAdicionarConjuge={aoAdicionarConjuge}
              aoAdicionarFilho={aoAdicionarFilho}
            />
          )}

          <PainelInteligencia
            analise={analise}
            aberto={inteligenciaAberta}
            aoFechar={() => setInteligenciaAberta(false)}
            aoIrParaPessoa={(id) => irParaPessoa(id)}
            nomeDe={nomeDe}
            categoriaInicial={categoriaInicial}
          />
        </div>

        <PaletaComandos
          aberta={buscaAberta}
          aoFechar={() => setBuscaAberta(false)}
          indice={indiceBusca}
          comandos={comandos}
          aoEscolherPessoa={(id) => irParaPessoa(id)}
        />

        <DicaAtalhos visivel={atalhosVisiveis} aoFechar={() => setAtalhosVisiveis(false)} />
      </div>
    )
  },
)
