"use client"
// src/components/torre/TorreVisaoGeral.tsx — aba VISÃO GERAL (Torre nova, frente B1, 01/10/2026).
// Na ORDEM do protótipo: faixa "Hoje" · SITUAÇÃO · AGENDA (`TorreKpis`) · FUNIL POR FASE (`TorreFunil`) · "Precisa de você" embutido
// (`TorrePrecisaDeVoce`, da frente B2, âncora `#pdv`) · "As 5 palavras da Torre".
// As props chegam do casco JÁ filtradas pelo país do cabeçalho (linhas e processos): a Visão geral inteira fala do país escolhido.
// Uma conta por número: os cartões leem `numeroDoKpi` (a lista que o clique filtra), a barra do funil lê o risco do Radar, o tempo
// médio e a meta vêm de `/api/torre/funil`, e a frase do dia usa as mesmas listas (processos, decisões, gargalo do funil).
import { useEffect, useMemo, useState } from "react"
import type { ChaveKpi } from "@/lib/operacional/torre-kpis"
import type { Aba } from "@/lib/operacional/torre-abas"
import {
  ESCOPO_VAZIO, funilDasFases, gargaloDaSemana, rotuloDoPaisFiltrado, textoDaFaseNasPalavras,
  type DadosDoFunilPorEscopo, type RespostaDoFunil,
} from "@/lib/operacional/torre-funil-puro"
import type { LinhaTorre } from "./tipos"
import type { ProcessoDaTorre } from "./tipos-processos"
import type { ItemPrecisa } from "./tipos-precisa"
import { TorreKpis, type Tendencias } from "./TorreKpis"
import { TorreFunil } from "./TorreFunil"
import { TorrePrecisaDeVoce } from "./TorrePrecisaDeVoce"
import { api, erroDe } from "./torre-base"
import "./visao-geral.css"

export interface PropsDaVisaoGeral {
  /** As linhas de tarefa da Torre, JÁ filtradas pelo país do cabeçalho (a mesma lista da aba Tarefas). */
  linhas: LinhaTorre[]
  /** Os processos ativos, JÁ filtrados pelo país; `null` = ainda carregando. */
  processos: ProcessoDaTorre[] | null
  /** As decisões do dia ("Precisa de você"), JÁ filtradas pelo país; `null` = ainda carregando. */
  itensPrecisa: ItemPrecisa[] | null
  /** O instante único da AGENDA (dia operacional) — o mesmo da aba Tarefas. */
  agora: Date
  /** A tendência "vs semana passada" (foto de 7 dias) e o backlog da semana. */
  tend: Tendencias | null
  /** O país do cabeçalho está filtrando? (a tendência é do total e some quando filtra) */
  filtrandoPais: boolean
  /** O cartão ativo (filtro do indicador) — o casco guarda; os cartões navegam por URL. */
  kpiAtivo?: ChaveKpi | null
  onEscolherKpi?: (k: ChaveKpi) => void
  onProcessos: () => void
  onRisco: () => void
  /** Navega para outra aba da Torre (ex.: "Ver equipe" → `equipe`). */
  irParaAba: (aba: Aba) => void
  /** Abre a "Revisar o dia" (o casco). Sem ela, o botão da faixa aciona o mesmo botão do cabeçalho. */
  onRevisar?: () => void
}

const ABRIR_REVISAO_DO_CABECALHO = () => {
  document.querySelector<HTMLButtonElement>(".tor-cab-btns .tor-btn.pri")?.click()
}

/** O tempo médio real, a meta e a semana (`/api/torre/funil`): uma leitura por recarga da Torre. Mantém o último resultado enquanto recarrega. */
function useDadosDoFunil(agora: Date) {
  const [estado, setEstado] = useState<{ dados: RespostaDoFunil | null; erro: string | null }>({ dados: null, erro: null })
  const chave = agora.getTime()
  useEffect(() => {
    let vivo = true
    void api<RespostaDoFunil>("/api/torre/funil").then((r) => {
      if (!vivo) return
      if (r.ok) setEstado({ dados: r.data, erro: null })
      else setEstado((e) => ({ dados: e.dados, erro: erroDe(r.data, "Não foi possível carregar o tempo médio e as metas por fase.") }))
    })
    return () => { vivo = false }
  }, [chave])
  return { ...estado, carregando: estado.dados == null && estado.erro == null }
}

export function TorreVisaoGeral({ linhas, processos, itensPrecisa, agora, tend, filtrandoPais, onProcessos, onRisco, irParaAba, onRevisar }: PropsDaVisaoGeral) {
  const { dados, erro, carregando } = useDadosDoFunil(agora)

  // O escopo do funil: geral, ou o do PAÍS escolhido (o rótulo é o que a lista de processos e as linhas carregam).
  const escopo: DadosDoFunilPorEscopo | null = useMemo(() => {
    if (!dados) return null
    if (!filtrandoPais) return dados.geral
    const rotulo = rotuloDoPaisFiltrado(processos, linhas)
    return (rotulo ? dados.porPais[rotulo] : null) ?? ESCOPO_VAZIO
  }, [dados, filtrandoPais, processos, linhas])

  const funil = useMemo(() => (dados && processos
    ? funilDasFases({ fases: dados.fases, processos, linhas, escopo: escopo ?? ESCOPO_VAZIO })
    : null), [dados, processos, linhas, escopo])
  const gargalo = useMemo(() => (funil ? gargaloDaSemana(funil.linhas) : null), [funil])

  return (
    <div className="tvg">
      <TorreKpis
        linhas={linhas} processos={processos} itensPrecisa={itensPrecisa} agora={agora} tend={tend} filtrandoPais={filtrandoPais}
        gargalo={gargalo} onProcessos={onProcessos} onRisco={onRisco} onRevisar={onRevisar ?? ABRIR_REVISAO_DO_CABECALHO}
      />
      <TorreFunil funil={funil} semana={escopo?.semana ?? null} carregandoDados={carregando} erroDados={erro} />

      <div id="pdv" className="tvg-pdv">
        <TorrePrecisaDeVoce itens={itensPrecisa} carregando={itensPrecisa == null} erro={null} irParaAba={irParaAba} {...PROPS_EMBUTIDO} />
      </div>

      <p className="tvg-palavras" data-testid="torre-5-palavras">
        <b>As 5 palavras da Torre:</b>
        <span><b>Processo</b> = uma família</span>
        <span><b>Fase</b> = {textoDaFaseNasPalavras(funil?.linhas ?? [])}</span>
        <span><b>Certidão</b> = a unidade de trabalho (uma certidão de uma pessoa)</span>
        <span><b>Passo</b> = onde a certidão está (solicitar, aguardando, conferir, pronta)</span>
        <span><b>Prazo</b> = a única data que manda; <b>Cobrar em</b> = quando cobrar o terceiro</span>
      </p>
    </div>
  )
}

// A seção "Precisa de você" embutida é da frente B2 (prop `embutido`).
const PROPS_EMBUTIDO = { embutido: true }
