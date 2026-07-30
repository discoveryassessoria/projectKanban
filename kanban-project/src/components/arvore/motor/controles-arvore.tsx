// src/components/arvore/motor/controles-arvore.tsx
//
// CONTROLES FLUTUANTES DA ÁRVORE.
//
// A barra que existia aqui antes era um CABEÇALHO: ocupava uma faixa inteira da
// tela, empurrava o papel para baixo e carregava título, subtítulo e chip de
// linha. A referência não tem faixa nenhuma — o papel vai de ponta a ponta e os
// comandos flutuam POR CIMA dele, no canto superior direito, em caixinhas
// brancas independentes:
//
//     [ ⌗ PAISAGEM ⌄ ] [ ⚙ ] [ ⌂ ] [ ⛶ ] [ ◎ ] [ − | + ]
//
// Sete comandos, nessa ordem: escolher a visualização, ajustar o que o card
// mostra, voltar à pessoa focal, enquadrar a árvore, centralizar a seleção,
// afastar, aproximar. Nada mais mora aqui.
//
// O que é DISCOVERY e não existe na referência (voltar/avançar, localizar
// pessoa, sugestões da árvore, tela cheia, exportar) vai para um segundo grupo
// no canto superior ESQUERDO, na mesma gramática visual. Não some — mas também
// não invade o grupo que a referência define.

"use client"

import { memo, useEffect, useRef, useState } from "react"
import {
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Home,
  Lightbulb,
  LocateFixed,
  Maximize,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react"
import type { AnaliseArvore } from "@/src/lib/genealogia/motor/tipos"
import { CORES_LEQUE, type CorLeque } from "./vista-leque"
import { CONTROLE, EASE, SEVERIDADE_COR, TREE } from "./tokens"

export type Vista = "paisagem" | "retrato" | "leque" | "descendencia"

/**
 * OPÇÕES DE EXIBIÇÃO — o que cada card mostra.
 *
 * Na experiência de referência não se escolhe o TAMANHO do card: escolhe-se
 * QUAIS INFORMAÇÕES ele carrega, e o tamanho é consequência. É uma diferença
 * real de modelo mental — "quero ver o lugar de nascimento" é uma pergunta que
 * o operador faz; "quero cards de 190px" não é.
 */
export interface OpcoesExibicao {
  retratos: boolean
  datas: boolean
  lugares: boolean
  codigos: boolean
}

export const EXIBICAO_PADRAO: OpcoesExibicao = {
  retratos: true,
  datas: true,
  lugares: false,
  codigos: true,
}

const ROTULO_EXIBICAO: Array<{ id: keyof OpcoesExibicao; rotulo: string }> = [
  { id: "retratos", rotulo: "Retratos" },
  { id: "datas", rotulo: "Datas de vida" },
  { id: "lugares", rotulo: "Lugar de nascimento" },
  { id: "codigos", rotulo: "Código da pessoa" },
]

export const VISTAS: Array<{ id: Vista; rotulo: string; dica: string }> = [
  { id: "paisagem", rotulo: "Paisagem", dica: "Descendentes à esquerda, ascendentes à direita" },
  { id: "retrato", rotulo: "Retrato", dica: "Ascendentes acima, descendentes abaixo" },
  { id: "leque", rotulo: "Leque", dica: "Gerações em anéis concêntricos" },
  { id: "descendencia", rotulo: "Descendência", dica: "Descendentes a partir da pessoa" },
]

export interface ControlesArvoreProps {
  analise: AnaliseArvore
  vista: Vista
  aoTrocarVista: (v: Vista) => void
  aoAbrirBusca: () => void
  aoAbrirInteligencia: () => void
  inteligenciaAberta: boolean
  telaCheia: boolean
  aoAlternarTelaCheia: () => void
  extras?: React.ReactNode
  podeVoltar: boolean
  podeAvancar: boolean
  aoVoltar: () => void
  aoAvancar: () => void
  /** Início — volta à pessoa focal e fecha as linhas expandidas. */
  aoVoltarAoRequerente: () => void
  /** Centralizar a seleção — mantém as expansões. */
  aoRecentrar: () => void
  temRequerente: boolean
  temSelecao: boolean
  aoZoom: (fator: number) => void
  aoAjustar: () => void
  // ---- itens do menu de opções ----
  aoAbrirEstatisticas: () => void
  exibicao: OpcoesExibicao
  aoTrocarExibicao: (o: OpcoesExibicao) => void
  geracoesLeque: number
  aoTrocarGeracoesLeque: (n: number) => void
  colorirLeque: CorLeque
  aoTrocarColorirLeque: (c: CorLeque) => void
  geracoesVisiveis: number
  aoTrocarGeracoesVisiveis: (n: number) => void
  geracoesDescendencia: number
  aoTrocarGeracoesDescendencia: (n: number) => void
  /** Pessoas visitadas nesta sessão, da mais recente para a mais antiga. */
  recentes: number[]
  nomeDe: (id: number) => string
  aoIrParaPessoa: (id: number) => void
  // ---- realce por filtro (B6) ----
  /**
   * Filtros de REALCE.
   *
   * Eles moram dentro do menu de configurações, e não numa barra sobre o
   * canvas: a barra é que tinha sido removida por transformar o papel em
   * ferramenta de engenharia — a CAPACIDADE nunca deveria ter ido junto. Aqui
   * ela volta sem devolver mobília ao desenho.
   */
  filtrosAtivos: Set<string>
  filtrosDisponiveis: Array<{ chave: string; rotulo: string }>
  aoAlternarFiltro: (chave: string) => void
  geracaoFiltrada: number | null
  geracoesDisponiveis: number[]
  aoTrocarGeracaoFiltrada: (g: number | null) => void
  aoLimparFiltros: () => void
  /** Quantos casam / quantos existem — a leitura honesta do realce. */
  resumoFiltro: { casando: number; total: number } | null
  /**
   * Quanto a gaveta ocupa da direita.
   *
   * Sem isto o grupo da referência fica ATRÁS do painel: presente na estrutura,
   * inalcançável na tela — inclusive o seletor de visualização, que é a única
   * forma de sair da leitura atual. O grupo anda para a esquerda junto com a
   * borda útil do canvas, como na referência.
   */
  recuoDireita?: number
}

/** Caixa branca padrão dos controles — a unidade visual da referência. */
function estiloCaixa(): React.CSSProperties {
  return {
    background: TREE.cartao,
    border: `1px solid ${TREE.cartaoBorda}`,
    borderRadius: CONTROLE.raio,
    boxShadow: TREE.sombra,
    height: CONTROLE.altura,
  }
}

export const ControlesArvore = memo(function ControlesArvore(props: ControlesArvoreProps) {
  const {
    analise,
    vista,
    aoTrocarVista,
    aoAbrirBusca,
    aoAbrirInteligencia,
    inteligenciaAberta,
    telaCheia,
    aoAlternarTelaCheia,
    extras,
    podeVoltar,
    podeAvancar,
    aoVoltar,
    aoAvancar,
    aoVoltarAoRequerente,
    aoRecentrar,
    temRequerente,
    temSelecao,
    aoZoom,
    aoAjustar,
    recentes,
    nomeDe,
    aoIrParaPessoa,
    recuoDireita = 0,
  } = props

  const criticos = analise.insights.filter(
    (i) => i.severidade === "critico" || i.severidade === "alto",
  ).length

  const zoomVale = vista !== "descendencia"

  return (
    <>
      {/* ---------------- grupo Discovery (esquerda) ---------------- */}
      <div
        data-arvore-controles="secundario"
        data-no-pan
        className="absolute z-30 flex items-center"
        style={{ top: CONTROLE.margem, left: CONTROLE.margem, ...estiloCaixa() }}
      >
        <BotaoIcone titulo="Voltar" onClick={aoVoltar} desabilitado={!podeVoltar}>
          <ChevronLeft style={{ width: CONTROLE.icone, height: CONTROLE.icone }} />
        </BotaoIcone>
        <BotaoIcone titulo="Avançar" onClick={aoAvancar} desabilitado={!podeAvancar}>
          <ChevronRight style={{ width: CONTROLE.icone, height: CONTROLE.icone }} />
        </BotaoIcone>
        <Divisor />
        <BotaoIcone titulo="Localizar pessoa (⌘K)" onClick={aoAbrirBusca}>
          <Search style={{ width: CONTROLE.icone, height: CONTROLE.icone }} />
        </BotaoIcone>
        <BotaoIcone
          titulo={criticos > 0 ? `${criticos} ponto(s) de atenção` : "Sugestões da árvore"}
          onClick={aoAbrirInteligencia}
          ativo={inteligenciaAberta}
        >
          <span className="relative inline-flex">
            <Lightbulb style={{ width: CONTROLE.icone, height: CONTROLE.icone }} />
            {criticos > 0 && (
              <span
                aria-hidden
                className="absolute -right-[3px] -top-[3px] h-[7px] w-[7px] rounded-full"
                style={{ background: SEVERIDADE_COR.alto, border: `1px solid ${TREE.cartao}` }}
              />
            )}
          </span>
        </BotaoIcone>
        <MenuRecentes recentes={recentes} nomeDe={nomeDe} aoIrParaPessoa={aoIrParaPessoa} />
        <Divisor />
        <BotaoIcone
          titulo={telaCheia ? "Sair da tela cheia" : "Tela cheia"}
          onClick={aoAlternarTelaCheia}
        >
          {telaCheia ? (
            <Minimize2 style={{ width: CONTROLE.icone, height: CONTROLE.icone }} />
          ) : (
            <Maximize2 style={{ width: CONTROLE.icone, height: CONTROLE.icone }} />
          )}
        </BotaoIcone>
        {extras && (
          <>
            <Divisor />
            <span className="flex items-center px-0.5">{extras}</span>
          </>
        )}
      </div>

      {/* ---------------- grupo da referência (direita) ---------------- */}
      <div
        data-arvore-controles="principal"
        data-no-pan
        className="absolute z-30 flex items-center"
        style={{
          top: CONTROLE.margem,
          right: CONTROLE.margem + recuoDireita,
          gap: CONTROLE.folga,
          transition: `right 260ms ${EASE.suave}`,
        }}
      >
        <SeletorVista vista={vista} aoTrocarVista={aoTrocarVista} />

        <div className="flex items-center" style={estiloCaixa()}>
          <MenuOpcoes {...props} />
        </div>

        <div className="flex items-center" style={estiloCaixa()}>
          <BotaoIcone
            titulo="Início — volta à pessoa inicial e fecha as linhas expandidas"
            onClick={aoVoltarAoRequerente}
            desabilitado={!temRequerente}
          >
            <Home style={{ width: CONTROLE.icone, height: CONTROLE.icone }} />
          </BotaoIcone>
        </div>

        <div className="flex items-center" style={estiloCaixa()}>
          <BotaoIcone titulo="Enquadrar a árvore inteira" onClick={aoAjustar}>
            <Maximize style={{ width: CONTROLE.icone, height: CONTROLE.icone }} />
          </BotaoIcone>
        </div>

        <div className="flex items-center" style={estiloCaixa()}>
          <BotaoIcone
            titulo="Centralizar a pessoa selecionada"
            onClick={aoRecentrar}
            desabilitado={!temSelecao && !temRequerente}
          >
            <LocateFixed style={{ width: CONTROLE.icone, height: CONTROLE.icone }} />
          </BotaoIcone>
        </div>

        {zoomVale && (
          <div className="flex items-center" style={estiloCaixa()}>
            <BotaoIcone titulo="Afastar" onClick={() => aoZoom(0.8)}>
              <Minus style={{ width: CONTROLE.icone, height: CONTROLE.icone }} />
            </BotaoIcone>
            <Divisor />
            <BotaoIcone titulo="Aproximar" onClick={() => aoZoom(1.25)}>
              <Plus style={{ width: CONTROLE.icone, height: CONTROLE.icone }} />
            </BotaoIcone>
          </div>
        )}
      </div>
    </>
  )
})

/**
 * Glifo da visualização — desenho próprio (três nós ligados), não ícone de
 * terceiro. Muda de forma conforme a leitura escolhida, que é o que dá a
 * sensação de "estou nesta visualização" antes mesmo de ler o rótulo.
 */
function GlifoVista({ vista }: { vista: Vista }) {
  const cor = TREE.textoFraco
  const comum = { fill: cor }
  if (vista === "retrato") {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <rect x="6.5" y="1" width="5" height="4" rx="1" {...comum} />
        <rect x="1" y="13" width="5" height="4" rx="1" {...comum} />
        <rect x="12" y="13" width="5" height="4" rx="1" {...comum} />
        <path d="M9 5v4M3.5 13V9h11v4" stroke={cor} strokeWidth="1.2" fill="none" />
      </svg>
    )
  }
  if (vista === "leque") {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <path d="M2 15a7 7 0 0114 0" stroke={cor} strokeWidth="1.4" fill="none" />
        <path d="M4.6 15a4.4 4.4 0 018.8 0" stroke={cor} strokeWidth="1.4" fill="none" />
        <circle cx="9" cy="15" r="1.6" {...comum} />
      </svg>
    )
  }
  if (vista === "descendencia") {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <rect x="1" y="1.5" width="5" height="3.5" rx="1" {...comum} />
        <rect x="8" y="7.2" width="8" height="3.5" rx="1" {...comum} />
        <rect x="8" y="13" width="8" height="3.5" rx="1" {...comum} />
        <path d="M3.5 5v9.8M3.5 8.9H8M3.5 14.8H8" stroke={cor} strokeWidth="1.2" fill="none" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <rect x="1" y="6.5" width="5" height="5" rx="1" {...comum} />
      <rect x="12" y="1" width="5" height="4" rx="1" {...comum} />
      <rect x="12" y="13" width="5" height="4" rx="1" {...comum} />
      <path d="M6 9h3.5V3h2.5M9.5 9v6H12" stroke={cor} strokeWidth="1.2" fill="none" />
    </svg>
  )
}

/**
 * Seletor de visualização.
 *
 * Pastilha com o glifo, o nome da leitura em caixa alta e a seta — exatamente
 * a âncora da referência. Não é um segmentado: com quatro opções sempre
 * visíveis o canto vira barra de ferramentas, que é o que esta tela não pode
 * parecer.
 */
function SeletorVista({
  vista,
  aoTrocarVista,
}: {
  vista: Vista
  aoTrocarVista: (v: Vista) => void
}) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useFecharFora(ref, aberto, () => setAberto(false))

  const atual = VISTAS.find((v) => v.id === vista) ?? VISTAS[0]

  return (
    <div className="relative shrink-0" ref={ref} style={estiloCaixa()}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label={`Visualização: ${atual.rotulo}`}
        onClick={() => setAberto((v) => !v)}
        className="flex h-full items-center gap-2 rounded-[6px] px-3 arv-hover"
        title={atual.dica}
      >
        <GlifoVista vista={vista} />
        <span
          className="text-[12px] font-semibold uppercase tracking-[0.04em]"
          style={{ color: TREE.texto }}
        >
          {atual.rotulo}
        </span>
        <ChevronDown className="h-3.5 w-3.5" style={{ color: TREE.textoFraco }} />
      </button>

      {aberto && (
        <div
          data-arvore-overlay
          role="menu"
          className="absolute left-0 top-full z-30 mt-1.5 w-[248px] overflow-hidden rounded-lg py-1"
          style={{
            background: TREE.popover,
            border: `1px solid ${TREE.cartaoBorda}`,
            boxShadow: TREE.sombraPainel,
            animation: `menuEntrada 130ms ${EASE.rapido}`,
          }}
        >
          <style>{`
            @keyframes menuEntrada {
              from { opacity: 0; transform: translateY(-4px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>
          {VISTAS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="menuitemradio"
              aria-checked={v.id === vista}
              onClick={() => {
                aoTrocarVista(v.id)
                setAberto(false)
              }}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left arv-hover"
              style={{ color: v.id === vista ? TREE.acentoTexto : TREE.texto }}
            >
              <GlifoVista vista={v.id} />
              <span className="flex min-w-0 flex-col">
                <span className="text-[12.5px] font-medium">{v.rotulo}</span>
                <span className="truncate text-[10.5px]" style={{ color: TREE.textoSuave }}>
                  {v.dica}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Fecha ao clicar fora ou apertar Esc — em um lugar só. */
function useFecharFora(
  ref: React.RefObject<HTMLDivElement | null>,
  ativo: boolean,
  fechar: () => void,
) {
  useEffect(() => {
    if (!ativo) return
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) fechar()
    }
    const esc = (e: KeyboardEvent) => e.key === "Escape" && fechar()
    document.addEventListener("mousedown", fora)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("mousedown", fora)
      document.removeEventListener("keydown", esc)
    }
  }, [ativo, fechar, ref])
}

/**
 * OPÇÕES DO LAYOUT — o que a tela mostra.
 *
 * Só entram aqui coisas que a experiência de referência oferece: o que aparece
 * no card, quantas gerações abrem de uma vez, e — no leque — quantos anéis e
 * por que critério colorir.
 */
function MenuOpcoes({
  vista,
  aoAbrirEstatisticas,
  exibicao,
  aoTrocarExibicao,
  geracoesLeque,
  aoTrocarGeracoesLeque,
  colorirLeque,
  aoTrocarColorirLeque,
  geracoesVisiveis,
  aoTrocarGeracoesVisiveis,
  geracoesDescendencia,
  aoTrocarGeracoesDescendencia,
  filtrosAtivos,
  filtrosDisponiveis,
  aoAlternarFiltro,
  geracaoFiltrada,
  geracoesDisponiveis,
  aoTrocarGeracaoFiltrada,
  aoLimparFiltros,
  resumoFiltro,
}: ControlesArvoreProps) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useFecharFora(ref, aberto, () => setAberto(false))

  const temFiltro = filtrosAtivos.size > 0 || geracaoFiltrada != null

  return (
    <div className="relative" ref={ref}>
      <BotaoIcone
        titulo={
          temFiltro
            ? `Configurações do layout — ${filtrosAtivos.size + (geracaoFiltrada != null ? 1 : 0)} realce(s) ativo(s)`
            : "Configurações do layout"
        }
        onClick={() => setAberto((v) => !v)}
        ativo={aberto || temFiltro}
      >
        <SlidersHorizontal style={{ width: CONTROLE.icone, height: CONTROLE.icone }} />
      </BotaoIcone>

      {aberto && (
        <div
          data-arvore-overlay
          role="menu"
          className="absolute right-0 top-full z-30 mt-1.5 w-[252px] overflow-hidden rounded-lg py-1"
          style={{
            background: TREE.popover,
            border: `1px solid ${TREE.cartaoBorda}`,
            boxShadow: TREE.sombraPainel,
            animation: `menuEntrada 130ms ${EASE.rapido}`,
          }}
        >
          <Titulo>Mostrar no card</Titulo>
          {ROTULO_EXIBICAO.map((o) => (
            <label
              key={o.id}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12.5px] arv-hover"
              style={{ color: TREE.texto }}
            >
              <input
                type="checkbox"
                checked={exibicao[o.id]}
                onChange={() => aoTrocarExibicao({ ...exibicao, [o.id]: !exibicao[o.id] })}
              />
              {o.rotulo}
            </label>
          ))}

          <Separador />

          {vista === "leque" ? (
            <>
              <Titulo>Leque</Titulo>
              <Campo rotulo="Gerações">
                <select
                  value={geracoesLeque}
                  onChange={(e) => aoTrocarGeracoesLeque(Number(e.target.value))}
                  aria-label="Gerações no leque"
                  className="rounded border px-1.5 py-0.5 text-[12px]"
                  style={{ borderColor: TREE.cartaoBorda, color: TREE.texto, background: TREE.cartao }}
                >
                  {[4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Colorir por">
                <select
                  value={colorirLeque}
                  onChange={(e) => aoTrocarColorirLeque(e.target.value as CorLeque)}
                  aria-label="Critério de cor do leque"
                  className="min-w-0 rounded border px-1.5 py-0.5 text-[12px]"
                  style={{ borderColor: TREE.cartaoBorda, color: TREE.texto, background: TREE.cartao }}
                >
                  {CORES_LEQUE.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.rotulo}
                    </option>
                  ))}
                </select>
              </Campo>
            </>
          ) : vista === "descendencia" ? (
            <Campo rotulo="Gerações">
              <select
                value={geracoesDescendencia}
                onChange={(e) => aoTrocarGeracoesDescendencia(Number(e.target.value))}
                aria-label="Gerações de descendência"
                className="rounded border px-1.5 py-0.5 text-[12px]"
                style={{ borderColor: TREE.cartaoBorda, color: TREE.texto, background: TREE.cartao }}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Campo>
          ) : (
            <Campo rotulo="Gerações na tela">
              <select
                value={geracoesVisiveis}
                onChange={(e) => aoTrocarGeracoesVisiveis(Number(e.target.value))}
                aria-label="Gerações mostradas de uma vez"
                className="rounded border px-1.5 py-0.5 text-[12px]"
                style={{ borderColor: TREE.cartaoBorda, color: TREE.texto, background: TREE.cartao }}
                title="Quantas gerações abrem de uma vez; o + no card revela as próximas"
              >
                {[2, 3, 4, 5, 6, 8, 12].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Campo>
          )}

          <Separador />

          {/* REALCE — o filtro não esconde ninguém: acende quem casa e recua o
              resto. Esconder mudaria a topologia (um pai filtrado deixaria o
              filho órfão na tela) e destruiria a referência espacial que o
              operador acabou de construir. */}
          <Titulo>Realçar na árvore</Titulo>
          {filtrosDisponiveis.map((f) => (
            <label
              key={f.chave}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12.5px] arv-hover"
              style={{ color: TREE.texto }}
            >
              <input
                type="checkbox"
                checked={filtrosAtivos.has(f.chave)}
                onChange={() => aoAlternarFiltro(f.chave)}
              />
              {f.rotulo}
            </label>
          ))}

          {geracoesDisponiveis.length > 1 && (
            <Campo rotulo="Geração">
              <select
                value={geracaoFiltrada ?? ""}
                onChange={(e) =>
                  aoTrocarGeracaoFiltrada(e.target.value === "" ? null : Number(e.target.value))
                }
                aria-label="Realçar uma geração"
                className="rounded border px-1.5 py-0.5 text-[12px]"
                style={{ borderColor: TREE.cartaoBorda, color: TREE.texto, background: TREE.cartao }}
              >
                <option value="">Todas</option>
                {geracoesDisponiveis.map((g) => (
                  <option key={g} value={g}>
                    {g === 0 ? "Requerente" : g > 0 ? `${g}ª acima` : `${Math.abs(g)}ª abaixo`}
                  </option>
                ))}
              </select>
            </Campo>
          )}

          {resumoFiltro && (
            <div className="px-3 pb-1 pt-0.5">
              <p className="text-[11px] tabular-nums" style={{ color: TREE.textoSuave }}>
                {resumoFiltro.casando} de {resumoFiltro.total} pessoas em evidência
              </p>
              <button
                type="button"
                onClick={aoLimparFiltros}
                className="mt-1 rounded px-1.5 py-0.5 text-[11.5px] font-medium arv-hover"
                style={{ border: `1px solid ${TREE.cartaoBorda}`, color: TREE.texto }}
              >
                Limpar realce
              </button>
            </div>
          )}

          <Separador />

          <ItemMenu
            icone={<BarChart3 className="h-3.5 w-3.5" />}
            rotulo="Estatísticas da árvore"
            onClick={() => {
              aoAbrirEstatisticas()
              setAberto(false)
            }}
          />
        </div>
      )}
    </div>
  )
}

function Titulo({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="px-3 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide"
      style={{ color: TREE.textoSuave }}
    >
      {children}
    </p>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between gap-2 px-3 py-1.5 text-[12px]"
      style={{ color: TREE.textoFraco }}
    >
      <span>{rotulo}</span>
      {children}
    </div>
  )
}

/**
 * Pessoas recentes.
 *
 * Voltar/avançar percorre a TRAJETÓRIA; este menu responde "em quem eu já
 * estive?". São perguntas diferentes, e usar o histórico para reencontrar
 * alguém obriga a desfazer tudo que veio depois.
 */
function MenuRecentes({
  recentes,
  nomeDe,
  aoIrParaPessoa,
}: {
  recentes: number[]
  nomeDe: (id: number) => string
  aoIrParaPessoa: (id: number) => void
}) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useFecharFora(ref, aberto, () => setAberto(false))

  return (
    <div className="relative" ref={ref}>
      <BotaoIcone
        titulo={recentes.length ? "Pessoas visitadas nesta sessão" : "Nenhuma pessoa visitada ainda"}
        onClick={() => setAberto((v) => !v)}
        desabilitado={recentes.length === 0}
        ativo={aberto}
      >
        <Clock style={{ width: CONTROLE.icone, height: CONTROLE.icone }} />
      </BotaoIcone>

      {aberto && recentes.length > 0 && (
        <div
          data-arvore-overlay
          role="menu"
          className="absolute left-0 top-full z-30 mt-1.5 w-[228px] overflow-hidden rounded-lg py-1"
          style={{
            background: TREE.popover,
            border: `1px solid ${TREE.cartaoBorda}`,
            boxShadow: TREE.sombraPainel,
            animation: `menuEntrada 130ms ${EASE.rapido}`,
          }}
        >
          <Titulo>Visitadas</Titulo>
          {recentes.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              onClick={() => {
                aoIrParaPessoa(id)
                setAberto(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] arv-hover"
              style={{ color: TREE.texto }}
            >
              <span className="truncate">{nomeDe(id)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Fio vertical entre botões do mesmo grupo — separa sem criar caixa nova. */
function Divisor() {
  return <span aria-hidden className="h-[18px] w-px" style={{ background: TREE.cartaoBorda }} />
}

function Separador() {
  return <div className="my-1 h-px" style={{ background: TREE.cartaoBorda }} />
}

function ItemMenu({
  icone,
  rotulo,
  detalhe,
  ativo,
  onClick,
}: {
  icone: React.ReactNode
  rotulo: string
  detalhe?: string
  ativo?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors arv-hover"
      style={{ color: ativo ? TREE.acentoTexto : TREE.texto }}
    >
      <span style={{ color: ativo ? TREE.acentoTexto : TREE.textoFraco }}>{icone}</span>
      <span className="flex-1 truncate">{rotulo}</span>
      {detalhe && (
        <span className="text-[10.5px]" style={{ color: TREE.textoSuave }}>
          {detalhe}
        </span>
      )}
    </button>
  )
}

function BotaoIcone({
  children,
  titulo,
  onClick,
  desabilitado,
  ativo,
}: {
  children: React.ReactNode
  titulo: string
  onClick: () => void
  desabilitado?: boolean
  ativo?: boolean
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      onClick={onClick}
      disabled={desabilitado}
      className="inline-flex items-center justify-center rounded-[5px] transition-colors disabled:cursor-default disabled:opacity-35 arv-hover"
      style={{
        width: CONTROLE.altura - 4,
        height: CONTROLE.altura - 4,
        margin: 1,
        color: ativo ? TREE.acentoTexto : TREE.textoFraco,
        background: ativo ? TREE.hover : "transparent",
      }}
    >
      {children}
    </button>
  )
}

/** Painel de atalhos — chamado por "?" e a partir da paleta. */
export function DicaAtalhos({ visivel, aoFechar }: { visivel: boolean; aoFechar: () => void }) {
  if (!visivel) return null
  const linhas: Array<[string, string]> = [
    ["⌘K  ou  /", "Buscar pessoa"],
    ["← ↑ → ↓", "Navegar entre parentes"],
    ["+  −", "Aproximar e afastar"],
    ["0", "Enquadrar a árvore"],
    ["I", "Sugestões e verificações"],
    ["S", "Índice de sobrenomes e lugares"],
    ["M", "Mostrar/esconder o minimapa"],
    ["Duplo clique", "Focar a família da pessoa"],
    ["Esc", "Fechar / voltar à árvore completa"],
  ]

  return (
    <div
      data-arvore-overlay
      className="fixed inset-0 z-[10050] flex items-center justify-center"
      style={{ background: TREE.veu }}
      onClick={aoFechar}
      role="dialog"
      aria-label="Atalhos de teclado"
    >
      <div
        className="w-[380px] rounded-xl p-4"
        style={{
          background: TREE.popover,
          border: `1px solid ${TREE.cartaoBorda}`,
          boxShadow: TREE.sombraPainel,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-[13px] font-semibold" style={{ color: TREE.texto }}>
          Atalhos
        </h2>
        <dl className="space-y-1">
          {linhas.map(([tecla, oque]) => (
            <div key={tecla} className="flex items-baseline gap-3">
              <dt
                className="w-[104px] shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-medium tabular-nums"
                style={{ background: TREE.hover, color: TREE.textoFraco }}
              >
                {tecla}
              </dt>
              <dd className="text-[12.5px]" style={{ color: TREE.texto }}>
                {oque}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
