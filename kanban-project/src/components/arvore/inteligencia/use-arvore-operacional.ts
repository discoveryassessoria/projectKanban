"use client"

// src/components/arvore/inteligencia/use-arvore-operacional.ts
// ============================================================================
// A PONTE ENTRE A ÁRVORE E OS MOTORES — e nada além de uma ponte.
//
// Este hook não desenha, não decide regra e não guarda verdade. Ele lê os fatos
// operacionais do processo numa requisição só, roda os motores PUROS sobre eles
// e devolve o resultado pronto para a tela consumir.
//
// Por que tudo passa por aqui em vez de cada componente buscar o que precisa:
// a linhagem, o dossiê, o foco e os sinais do cartão são derivações da MESMA
// entrada. Calculá-los em três lugares diferentes garantiria três respostas
// diferentes na mesma tela em algum momento.
//
// Sobre custo: a análise genealógica é cara e o React re-renderiza muito
// (arrastar um nó dispara dezenas de renders). Toda derivação abaixo é
// memoizada pela ENTRADA, e as entradas são estáveis porque `pessoas` vem do
// cache da camada de dados, que preserva a referência enquanto a resposta não
// muda. Trocar de requerente recalcula só o foco — um Map — e não a análise.
// ============================================================================

import { useCallback, useMemo, useState } from "react"
import { useApi } from "@/src/lib/dados"
import type { AnaliseArvore, PessoaEntrada, UniaoEntrada } from "@/src/lib/genealogia/motor/tipos"
import type { GrafoGenealogico } from "@/src/lib/genealogia/motor/grafo"
import {
  mapaDeLinhagens,
  relacionadosDaLinhagem,
  trilhaDaLinhagem,
  type DegrauLinhagem,
  type Linhagem,
  type MapaLinhagens,
} from "@/src/lib/genealogia/motor/linhagens"
import {
  diagnosticar,
  resolveNextGenealogyAction,
  type AcaoRecomendada,
  type Diagnostico,
} from "@/src/lib/genealogia/operacional/diagnostico"
import {
  calcularFoco,
  gruposRecolhiveis,
  preferenciasPadrao,
  type EstiloFoco,
  type ModoFoco,
  type PreferenciasFoco,
  type ResultadoFoco,
} from "@/src/lib/genealogia/navegacao/foco"
import {
  aplicarFiltros,
  contarAtivos,
  filtrosVazios,
  temFiltroAtivo,
  alternarFiltro,
  type ChaveFiltro,
  type EstadoFiltros,
} from "@/src/lib/genealogia/navegacao/filtros"
import { analisarLacunas, type LacunaParental } from "@/src/lib/genealogia/navegacao/lacunas"
import { calcularSaude, contarPorNivel, type NivelSaudePessoa, type SaudePessoa } from "@/src/lib/genealogia/operacional/saude"
import type { EstadoAtual } from "@/src/lib/genealogia/operacional/comparacao"
import { eventosDaPessoa, marcarConflitos, type EventoProjetado } from "@/src/lib/genealogia/motor/eventos"
import { projetarIndicadores } from "@/src/lib/genealogia/documental/indicadores"
import {
  fatosVazios,
  projetarDossies,
  resumirLinhagem,
  type DossiePessoa,
  type FatosOperacionais,
  type PrazoDoProcesso,
  type ResumoLinhagem,
} from "@/src/lib/genealogia/operacional/dossie"
import type { ContextoAuditor } from "@/src/lib/genealogia/operacional/auditor"
import { calcularParentesco } from "@/src/lib/genealogia/motor/parentesco"
import type { ContextoPerguntas } from "@/src/lib/genealogia/operacional/perguntas"
import type { SinaisPessoa } from "../react-flow-tree"

interface RespostaOperacional extends FatosOperacionais {
  prazo: PrazoDoProcesso | null
}

export interface ArvoreOperacional {
  /** Linhagens de todos os requerentes, prontas para o seletor. */
  mapa: MapaLinhagens
  /** Linhagem em foco. null quando o modo é "todos" e nada foi escolhido. */
  linhagem: Linhagem | null
  requerenteSelecionadoId: number | null
  selecionarRequerente: (id: number | null) => void

  modo: ModoFoco
  setModo: (m: ModoFoco) => void
  estilo: EstiloFoco
  setEstilo: (e: EstiloFoco) => void

  filtros: EstadoFiltros
  alternar: (chave: ChaveFiltro) => void
  limparFiltros: () => void
  filtrosAtivos: number

  foco: ResultadoFoco
  sinais: Map<number, SinaisPessoa>
  dossies: Map<number, DossiePessoa>
  resumo: ResumoLinhagem | null
  /** Contexto pronto para as perguntas da árvore. null sem análise. */
  perguntas: ContextoPerguntas | null

  /** Caminho requerente → transmissor, clicável. Vazio fora do modo linhagem. */
  trilha: DegrauLinhagem[]
  /** Diagnóstico do escopo em foco. */
  diagnostico: Diagnostico
  proximaAcao: AcaoRecomendada
  /** Resumos de TODOS os requerentes, para a comparação. */
  comparacao: ResumoLinhagem[]

  /** "Mostrar relacionados": revela irmãos/cônjuges/filhos da linha. */
  relacionadosVisiveis: boolean
  alternarRelacionados: () => void
  totalRelacionados: number
  /** Contexto da pessoa para a busca ("Bisavô de Marco"). */
  contextoDe: (pessoaId: number) => string | null
  /** O que significa faltar pai/mãe em cada slot desenhado. */
  lacunas: Map<string, LacunaParental>
  /** Contexto do Modo Auditor. null sem análise. */
  auditor: ContextoAuditor | null

  /** Modo Saúde (heatmap). Desligado = o canvas não recebe anel nenhum. */
  saudeLigada: boolean
  alternarSaude: () => void
  saude: Map<number, SaudePessoa> | undefined
  contagemSaude: Record<NivelSaudePessoa, number>

  /** Números de hoje, para o preview montar a coluna ANTES. */
  estadoAtual: EstadoAtual | undefined
  /** Quantas pessoas cada filtro rápido casaria, agora. */
  contagemFiltros: Record<string, number>
  /** Linha do tempo de uma pessoa — projeção oficial, sem tabela nova. */
  eventosDe: (pessoaId: number) => EventoProjetado[]

  /** Grupos "+N irmãos" que ainda estão recolhidos. */
  expandirGrupo: (chave: string) => void
  recolherTudo: () => void
  totalRecolhivel: number

  financeiroVisivel: boolean
  carregando: boolean
  erro: Error | undefined
  recarregar: () => Promise<unknown>
}

const SEM_DOSSIES = new Map<number, DossiePessoa>()

export function useArvoreOperacional(params: {
  processoId: number
  pessoas: PessoaEntrada[]
  unioes: UniaoEntrada[]
  analise: (AnaliseArvore & { grafo: GrafoGenealogico }) | null
}): ArvoreOperacional {
  const { processoId, pessoas, analise } = params

  // Uma leitura só, com cache e revalidação da camada oficial. Sem pessoas na
  // árvore não há o que projetar: a chave vira null e a requisição nem sai.
  const req = useApi<RespostaOperacional>(
    pessoas.length ? `/api/processos/${processoId}/genealogia/operacional` : null,
  )
  const fatos: FatosOperacionais = useMemo(
    () =>
      req.dados
        ? {
            necessidades: req.dados.necessidades ?? [],
            tarefas: req.dados.tarefas ?? [],
            lancamentos: req.dados.lancamentos ?? [],
            financeiroVisivel: Boolean(req.dados.financeiroVisivel),
          }
        : fatosVazios(),
    [req.dados],
  )

  const mapa = useMemo<MapaLinhagens>(
    () =>
      analise
        ? mapaDeLinhagens(analise.grafo, analise.paisAlvo, analise.linhaCidadania[0] ?? null)
        : {
            linhagens: [],
            porRequerente: new Map(),
            compartilhadas: new Map(),
            emAlgumaLinha: new Set(),
            semInfluencia: new Set(),
            papeis: new Map(),
          },
    [analise],
  )

  const [modo, setModo] = useState<ModoFoco>("todos")
  const [estilo, setEstilo] = useState<EstiloFoco>("esmaecer")
  const [escolhaManual, setEscolhaManual] = useState<number | null>(null)
  const [gruposExpandidos, setGruposExpandidos] = useState<ReadonlySet<string>>(new Set())
  const [filtros, setFiltros] = useState<EstadoFiltros>(filtrosVazios)
  const [relacionadosVisiveis, setRelacionadosVisiveis] = useState(false)
  const [saudeLigada, setSaudeLigada] = useState(false)

  /**
   * "Agora" congelado no ciclo de vida do componente.
   *
   * `tarefa vencida` depende de hoje, mas ler `new Date()` durante o render faria
   * o diagnóstico ter identidade nova a cada render — e ele é dependência de
   * memo. Um valor por montagem é preciso o bastante (ninguém mantém a árvore
   * aberta atravessando a meia-noite esperando um alerta mudar) e mantém tudo
   * memoizável.
   */
  const [agora] = useState(() => new Date())

  // Requerente em foco: o escolhido à mão; senão o primeiro da lista (a linhagem
  // mais mapeada). Nunca `undefined` silencioso — a árvore abre centrada em
  // alguém, e esse alguém é sempre o mesmo entre dois carregamentos.
  const requerenteSelecionadoId =
    escolhaManual != null && mapa.porRequerente.has(escolhaManual)
      ? escolhaManual
      : (mapa.linhagens[0]?.requerenteId ?? null)

  const linhagem = requerenteSelecionadoId != null
    ? (mapa.porRequerente.get(requerenteSelecionadoId) ?? null)
    : null

  const dossies = useMemo<Map<number, DossiePessoa>>(
    () => (analise ? projetarDossies({ grafo: analise.grafo, analise, mapa, fatos }) : SEM_DOSSIES),
    [analise, mapa, fatos],
  )

  // Filtro REALÇA: quem casa fica em pleno mesmo fora da linhagem. Esconder por
  // filtro deixaria o pai filtrado fora e o filho órfão na tela.
  const realcados = useMemo<ReadonlySet<number> | undefined>(() => {
    if (!analise || !temFiltroAtivo(filtros)) return undefined
    const documental = projetarIndicadores(fatos.necessidades)
    return aplicarFiltros(
      { grafo: analise.grafo, analise, documental },
      { ...filtros, referenciaId: filtros.referenciaId ?? requerenteSelecionadoId },
    )
  }, [analise, filtros, fatos.necessidades, requerenteSelecionadoId])

  // "Mostrar relacionados" entra como REALCE, não como linhagem: irmão, cônjuge
  // e filho voltam a ficar em pleno sem entrar na cadeia de transmissão. Assim o
  // botão revela gente sem contaminar o cálculo documental do requerente.
  const realcadosComRelacionados = useMemo<ReadonlySet<number> | undefined>(() => {
    if (!relacionadosVisiveis || !analise || !linhagem) return realcados
    const extras = relacionadosDaLinhagem(analise.grafo, linhagem)
    if (!realcados) return extras
    return new Set([...realcados, ...extras])
  }, [relacionadosVisiveis, analise, linhagem, realcados])

  const totalRelacionados = useMemo(
    () => (analise && linhagem ? relacionadosDaLinhagem(analise.grafo, linhagem).size : 0),
    [analise, linhagem],
  )

  const preferencias = useMemo<PreferenciasFoco>(
    () => ({
      ...preferenciasPadrao(),
      modo,
      estilo,
      gruposExpandidos,
      realcados: realcadosComRelacionados,
    }),
    [modo, estilo, gruposExpandidos, realcadosComRelacionados],
  )

  const foco = useMemo<ResultadoFoco>(
    () =>
      analise
        ? calcularFoco(analise.grafo, modo === "linhagem" ? linhagem : null, preferencias)
        : { estados: new Map(), gruposAtivos: [], totalRecuado: 0, totalPleno: 0 },
    [analise, linhagem, modo, preferencias],
  )

  // Quantos ramos existem para recolher NO MODO ATUAL. Fora do modo linhagem o
  // recolhimento não age (ver `calcularFoco`), então o número é zero — anunciar
  // "12 ramos recolhíveis" numa vista que não recolhe nada seria mentir.
  const totalRecolhivel = useMemo(
    () =>
      analise && modo === "linhagem" && linhagem
        ? gruposRecolhiveis(analise.grafo, linhagem.visivel).length
        : 0,
    [analise, modo, linhagem],
  )

  // Duas marcas por cartão, no máximo. Só nascem quando há o que sinalizar —
  // um Map vazio faz o canvas seguir o caminho de custo zero.
  const sinais = useMemo<Map<number, SinaisPessoa>>(() => {
    const m = new Map<number, SinaisPessoa>()
    for (const [id, d] of dossies) {
      const divergencia = d.divergencias.some(
        (i) => i.severidade === "critico" || i.severidade === "alto",
      )
      const tarefaAberta = d.tarefasAbertas.length > 0
      if (divergencia || tarefaAberta) m.set(id, { divergencia, tarefaAberta })
    }
    return m
  }, [dossies])

  const prazo = req.dados?.prazo ?? null

  const resumo = useMemo<ResumoLinhagem | null>(
    () => (linhagem ? resumirLinhagem(linhagem, dossies, prazo, agora) : null),
    [linhagem, dossies, prazo, agora],
  )

  // Comparação: um resumo por requerente. É o mesmo `resumirLinhagem` — nenhuma
  // segunda contagem, e por isso a comparação nunca discorda do resumo do topo.
  const comparacao = useMemo<ResumoLinhagem[]>(
    () => mapa.linhagens.map((l) => resumirLinhagem(l, dossies, prazo, agora)),
    [mapa, dossies, prazo, agora],
  )

  // O canvas só desenha slot "+pai/+mãe" para a pessoa RAIZ (profundidade 0);
  // calcular para a árvore inteira seria explicar slot que ninguém vê.
  const lacunas = useMemo<Map<string, LacunaParental>>(() => {
    if (!analise) return new Map()
    const raiz = analise.linhaCidadania[0] ?? pessoas[0]?.id
    return raiz != null ? analisarLacunas(analise.grafo, mapa, [raiz]) : new Map()
  }, [analise, mapa, pessoas])

  const trilha = useMemo<DegrauLinhagem[]>(
    () => (analise && linhagem ? trilhaDaLinhagem(analise.grafo, linhagem, mapa) : []),
    [analise, linhagem, mapa],
  )

  const diagnostico = useMemo<Diagnostico>(
    () =>
      analise
        ? diagnosticar({
            grafo: analise.grafo,
            analise,
            mapa,
            dossies,
            // O diagnóstico segue o escopo da tela: no modo linhagem fala da
            // linha; na vista completa fala da árvore.
            linhagem: modo === "linhagem" ? linhagem : null,
            prazo,
            agora,
          })
        : {
            saude: "saudavel",
            rotuloSaude: "Saudável",
            resumo: "Sem pessoas na árvore",
            problemas: [],
            criticos: 0,
            atencao: 0,
            semExigenciaMaterializada: true,
          },
    [analise, mapa, dossies, modo, linhagem, prazo, agora],
  )

  // O Auditor come exatamente o mesmo contexto do diagnóstico — nenhuma
  // projeção nova, nenhuma segunda leitura. Ele só narra o que já foi apurado.
  const auditor = useMemo<ContextoAuditor | null>(
    () => (analise ? { grafo: analise.grafo, analise, mapa, dossies, linhagem } : null),
    [analise, mapa, dossies, linhagem],
  )

  // O heatmap sai dos MESMOS dossiês do diagnóstico — nenhuma leitura nova,
  // nenhum segundo critério. Desligado, é `undefined`: o canvas então segue o
  // caminho de custo zero e o cartão não recebe anel.
  const saudeCalculada = useMemo<Map<number, SaudePessoa> | undefined>(
    () =>
      analise && saudeLigada
        ? calcularSaude(analise.grafo, dossies, modo === "linhagem" ? linhagem : null)
        : undefined,
    [analise, dossies, saudeLigada, modo, linhagem],
  )
  const contagemSaude = useMemo(
    () => contarPorNivel(saudeCalculada ?? new Map()),
    [saudeCalculada],
  )

  const proximaAcao = useMemo<AcaoRecomendada>(
    () => resolveNextGenealogyAction(diagnostico),
    [diagnostico],
  )

  // O contexto das perguntas é memoizado junto: sem isso, cada render entregaria
  // um objeto novo ao painel e a resposta seria recalculada a cada movimento do
  // mouse sobre o canvas.
  const perguntas = useMemo<ContextoPerguntas | null>(
    () => (analise ? { grafo: analise.grafo, analise, mapa, dossies, linhagem } : null),
    [analise, mapa, dossies, linhagem],
  )

  // ANTES do preview: os mesmos números que a barra já mostra. Nada é lido de
  // novo — se o resumo e o preview discordassem, um dos dois estaria mentindo.
  const estadoAtual = useMemo<EstadoAtual | undefined>(
    () =>
      resumo
        ? {
            documentosExigidos: resumo.documental.necessarias,
            documentosConcluidos: resumo.documental.atendidas + resumo.documental.dispensadas,
            pendencias: resumo.documental.pendentes,
            bloqueios: resumo.bloqueios,
            pessoasNaLinhagem: resumo.pessoas,
            ascendenteTransmissor: resumo.danteCausaNome,
          }
        : undefined,
    [resumo],
  )

  // CONTADOR POR FILTRO. Cada chave é avaliada isoladamente contra a árvore —
  // é o que responde "quantas pessoas isso pega?" ANTES de o usuário ligar o
  // filtro e ter de contar cartão na tela.
  const contagemFiltros = useMemo<Record<string, number>>(() => {
    if (!analise) return {}
    const documental = projetarIndicadores(fatos.necessidades)
    const ctx = { grafo: analise.grafo, analise, documental }
    const chaves: ChaveFiltro[] = [
      "requerentes", "pendencia_documental", "inconsistencia",
      "incompletas", "vivas", "falecidas", "casadas",
    ]
    const saidaFiltros: Record<string, number> = {}
    for (const chave of chaves) {
      saidaFiltros[chave] = aplicarFiltros(ctx, {
        ...filtrosVazios(),
        chaves: new Set([chave]),
        referenciaId: requerenteSelecionadoId,
      }).size
    }
    return saidaFiltros
  }, [analise, fatos.necessidades, requerenteSelecionadoId])

  // Timeline: projeção de `motor/eventos.ts` sobre as colunas de Pessoa/Uniao.
  // `marcarConflitos` sinaliza data que contradiz outra da própria árvore — a
  // linha do tempo mostra o conflito em vez de escolher uma das duas datas.
  // Quem tem conflito de data quem diz é o motor de cronologia, não a timeline:
  // reavaliar as datas aqui seria uma segunda opinião sobre a mesma contradição.
  const pessoasComConflito = useMemo(() => {
    const ids = new Set<number>()
    for (const i of analise?.insights ?? []) {
      if (i.categoria === "conflito") for (const id of i.pessoaIds) ids.add(id)
    }
    return ids
  }, [analise])

  const eventosDe = useCallback(
    (pessoaId: number): EventoProjetado[] =>
      analise ? marcarConflitos(eventosDaPessoa(analise.grafo, pessoaId), pessoasComConflito) : [],
    [analise, pessoasComConflito],
  )

  const selecionarRequerente = useCallback((id: number | null) => setEscolhaManual(id), [])
  const alternarRelacionados = useCallback(() => setRelacionadosVisiveis((v) => !v), [])
  const alternarSaude = useCallback(() => setSaudeLigada((v) => !v), [])

  // Contexto da busca: parentesco em relação ao requerente em foco, mais o aviso
  // de que a pessoa está (ou não) na linha dele. Reusa `calcularParentesco` —
  // não há segunda tabela de parentesco nesta base.
  const contextoDe = useCallback(
    (pessoaId: number): string | null => {
      if (!analise || !linhagem) return null
      if (pessoaId === linhagem.requerenteId) return "Requerente"
      const partes: string[] = []
      const par = calcularParentesco(analise.grafo, linhagem.requerenteId, pessoaId)
      if (par) partes.push(`${par.rotulo} de ${linhagem.nome}`)
      if (linhagem.naLinha.has(pessoaId)) partes.push("na linha de transmissão")
      else if (linhagem.conjugesDaLinha.has(pessoaId)) partes.push("cônjuge da linha")
      return partes.length ? partes.join(" · ") : null
    },
    [analise, linhagem],
  )
  const expandirGrupo = useCallback((chave: string) => {
    setGruposExpandidos((atual) => {
      const proximo = new Set(atual)
      proximo.add(chave)
      return proximo
    })
  }, [])
  const recolherTudo = useCallback(() => setGruposExpandidos(new Set()), [])
  const alternar = useCallback((chave: ChaveFiltro) => setFiltros((f) => alternarFiltro(f, chave)), [])
  const limparFiltros = useCallback(() => setFiltros(filtrosVazios()), [])

  return {
    mapa,
    linhagem,
    requerenteSelecionadoId,
    selecionarRequerente,
    modo,
    setModo,
    estilo,
    setEstilo,
    filtros,
    alternar,
    limparFiltros,
    filtrosAtivos: contarAtivos(filtros),
    foco,
    sinais,
    dossies,
    resumo,
    perguntas,
    trilha,
    diagnostico,
    proximaAcao,
    comparacao,
    relacionadosVisiveis,
    alternarRelacionados,
    totalRelacionados,
    contextoDe,
    lacunas,
    auditor,
    saudeLigada,
    alternarSaude,
    saude: saudeCalculada,
    contagemSaude,
    estadoAtual,
    contagemFiltros,
    eventosDe,
    expandirGrupo,
    recolherTudo,
    totalRecolhivel,
    financeiroVisivel: fatos.financeiroVisivel,
    carregando: req.carregando,
    erro: req.erro,
    recarregar: req.recarregar,
  }
}
