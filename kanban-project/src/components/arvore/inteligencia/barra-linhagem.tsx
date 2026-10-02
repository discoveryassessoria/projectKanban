"use client"

// src/components/arvore/inteligencia/barra-linhagem.tsx
// ============================================================================
// CONTROLES DE LINHAGEM DA BARRA ÚNICA.
//
// A árvore tem UMA barra de ferramentas acima do canvas — a linha com
// PAISAGEM | RETRATO. Os controles de linhagem (visualização, requerente, foco,
// filtros, Saúde, Comparar) moram NESSA MESMA LINHA, ao lado de Paisagem/Retrato;
// não existe mais uma segunda barra sobreposta ao canvas.
//
// O que antes eram faixas empilhadas sobre o canvas (resumo do requerente,
// legenda da Saúde e trilha da linhagem) virou CARTÕES FLUTUANTES — ver
// `cartoes-flutuantes.tsx`. Aqui fica só o que é CONTROLE.
//
// Os botões usam a mesma casca da linha de ferramentas que já existia
// (`CLASSE_BOTAO_BARRA`), para a árvore continuar parecendo a mesma.
//
// O CONTROLE PRINCIPAL é um seletor de DUAS opções — "Árvore completa" e
// "Linhagem do requerente" — em vez de um botão de liga/desliga. Um toggle
// esconde que existem dois modos; o segmentado mostra onde você está e para
// onde pode ir, que é o que um operador precisa ao abrir um processo alheio.
// ============================================================================

import { useEffect, useRef, useState } from "react"
import { Activity, ChevronDown, Eye, Filter, GitCompare, Users2, X } from "lucide-react"
import { LAYER } from "@/src/lib/ui/layers"
import type { Linhagem, MapaLinhagens } from "@/src/lib/genealogia/motor/linhagens"
import type { EstiloFoco, ModoFoco } from "@/src/lib/genealogia/navegacao/foco"
import { ROTULO_FILTRO, type ChaveFiltro, type EstadoFiltros } from "@/src/lib/genealogia/navegacao/filtros"
import type { ResumoLinhagem } from "@/src/lib/genealogia/operacional/dossie"

/** Botão da linha de ferramentas (a mesma casca de PAISAGEM/RETRATO/PDF). */
export const CLASSE_BOTAO_BARRA =
  "flex items-center gap-2 rounded px-3 py-2 text-sm font-medium transition-colors hover:bg-[var(--surface-tertiary)] disabled:cursor-not-allowed disabled:opacity-50"
export const CLASSE_BOTAO_BARRA_ATIVO =
  "flex items-center gap-2 rounded px-3 py-2 text-sm font-medium transition-colors bg-[var(--surface-tertiary)] text-white/95"
/** Painel de menu aberto a partir da barra: superfície OPACA de popover. */
export const CLASSE_MENU_BARRA =
  "absolute left-0 top-full mt-1 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] text-gray-900 shadow-[var(--elev-2)]"
/** Camada dos menus da barra (SSOT em `layers.ts`). */
export const CAMADA_MENU_BARRA = LAYER.popover

const FILTROS_RAPIDOS: ChaveFiltro[] = [
  "requerentes",
  "pendencia_documental",
  "inconsistencia",
  "incompletas",
  "vivas",
  "falecidas",
  "casadas",
]

interface Props {
  mapa: MapaLinhagens
  linhagem: Linhagem | null
  requerenteSelecionadoId: number | null
  onSelecionarRequerente: (id: number | null) => void
  modo: ModoFoco
  onModo: (m: ModoFoco) => void
  estilo: EstiloFoco
  onEstilo: (e: EstiloFoco) => void
  filtros: EstadoFiltros
  filtrosAtivos: number
  onAlternarFiltro: (c: ChaveFiltro) => void
  onLimparFiltros: () => void
  comparacao: ResumoLinhagem[]
  relacionadosVisiveis: boolean
  onAlternarRelacionados: () => void
  totalRelacionados: number
  saudeLigada: boolean
  onAlternarSaude: () => void
  /** Quantas pessoas cada filtro casaria agora. */
  contagemFiltros: Record<string, number>
  totalRecuado: number
  totalRecolhivel: number
  onRecolherTudo: () => void
}

export const MARCA_MENU_ABERTO = "arvoreMenuAberto"
/**
 * Evento com que a árvore manda fechar a camada mais externa.
 *
 * Por que não um listener de Escape aqui: a árvore abre DENTRO do modal do
 * processo, e o modal também fecha no Escape, por um listener próprio em
 * `document`. Dois donos do mesmo Escape significa que dispensar o menu de
 * filtros fechava o processo inteiro. Agora existe um dono só — o handler em
 * fase de CAPTURA da árvore — e ele avisa por este evento quem precisa fechar.
 */
export const EVENTO_FECHAR_CAMADA = "arvore:fechar-camada"
let menusAbertos = 0

function marcarMenu(aberto: boolean) {
  if (typeof document === "undefined" || !aberto) return () => {}
  menusAbertos++
  document.body.dataset[MARCA_MENU_ABERTO] = "1"
  return () => {
    menusAbertos = Math.max(0, menusAbertos - 1)
    if (menusAbertos === 0) delete document.body.dataset[MARCA_MENU_ABERTO]
  }
}

/**
 * Fecha o menu ao clicar fora, e marca no `body` que há menu aberto.
 *
 * A marca existe por um conflito real de teclado: a árvore tem um ESC global que
 * fecha o painel da pessoa, e cada menu daqui também fecha no ESC. Sem
 * coordenação, dispensar o menu de filtros fechava junto o painel que o usuário
 * estava lendo.
 */
export function useFecharFora(aberto: boolean, fechar: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const desmarcar = marcarMenu(true)
    const aoClicar = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) fechar()
    }
    // Sem listener de Escape próprio — ver EVENTO_FECHAR_CAMADA.
    const aoFecharCamada = () => fechar()
    document.addEventListener("mousedown", aoClicar)
    document.addEventListener(EVENTO_FECHAR_CAMADA, aoFecharCamada)
    return () => {
      document.removeEventListener("mousedown", aoClicar)
      document.removeEventListener(EVENTO_FECHAR_CAMADA, aoFecharCamada)
      desmarcar()
    }
  }, [aberto, fechar])
  return ref
}

/** Os controles de linhagem, como fragmento da linha de ferramentas. */
export function ControlesLinhagem(props: Props) {
  const {
    mapa, linhagem, requerenteSelecionadoId, onSelecionarRequerente,
    modo, onModo, estilo, onEstilo,
    filtros, filtrosAtivos, onAlternarFiltro, onLimparFiltros, comparacao,
    relacionadosVisiveis, onAlternarRelacionados, totalRelacionados,
    saudeLigada, onAlternarSaude, contagemFiltros,
    totalRecuado, totalRecolhivel, onRecolherTudo,
  } = props

  const [menuRequerente, setMenuRequerente] = useState(false)
  const [menuFiltros, setMenuFiltros] = useState(false)
  const [comparando, setComparando] = useState(false)

  const refRequerente = useFecharFora(menuRequerente, () => setMenuRequerente(false))
  const refFiltros = useFecharFora(menuFiltros, () => setMenuFiltros(false))
  const refComparar = useFecharFora(comparando, () => setComparando(false))

  // Sem requerente cadastrado não há linhagem para escolher. Os controles somem em
  // vez de oferecer um seletor vazio — controle que não faz nada é ruído.
  if (mapa.linhagens.length === 0) return null

  const emLinhagem = modo === "linhagem"

  return (
    <>
      {/* ── VISUALIZAÇÃO: dois estados explícitos ────────────────────── */}
      <div
        role="group"
        aria-label="Visualização da árvore"
        className="flex items-center overflow-hidden rounded border border-[var(--border-default)]"
      >
        <button
          onClick={() => onModo("todos")}
          aria-pressed={!emLinhagem}
          className={`px-3 py-2 text-sm font-medium transition-colors ${
            !emLinhagem ? "bg-[var(--surface-tertiary)] text-white/95" : "hover:bg-[var(--surface-tertiary)]"
          }`}
          title="Ver a árvore inteira, como sempre"
        >
          Árvore completa
        </button>
        <span aria-hidden className="h-5 w-px bg-[var(--border-default)]" />
        <button
          onClick={() => onModo("linhagem")}
          aria-pressed={emLinhagem}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
            emLinhagem ? "bg-[var(--surface-tertiary)] text-white/95" : "hover:bg-[var(--surface-tertiary)]"
          }`}
          title="Ver somente a linhagem do requerente selecionado (L)"
        >
          Linhagem
          <span className="hidden @[1300px]:inline">do requerente</span>
          {emLinhagem && totalRecuado > 0 && (
            <span className="rounded-full bg-[var(--surface-secondary)] px-1.5 text-[11px] tabular-nums text-gray-700">
              −{totalRecuado}
            </span>
          )}
        </button>
      </div>

      {/* ── Requerente em foco ───────────────────────────────────────── */}
      <div ref={refRequerente} className="relative">
        <button
          onClick={() => setMenuRequerente((v) => !v)}
          className={CLASSE_BOTAO_BARRA}
          title="Escolher o requerente cuja linhagem será exibida"
        >
          <span className="max-w-[130px] truncate">{linhagem?.nome ?? "Escolher requerente"}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </button>

        {menuRequerente && (
          <div
            className={`${CLASSE_MENU_BARRA} w-[300px] max-w-[calc(100vw-1.5rem)]`}
            style={{ zIndex: CAMADA_MENU_BARRA }}
          >
            <p className="border-b border-[var(--border-default)] px-3 py-2 text-[11px] uppercase tracking-wide text-gray-500">
              {mapa.linhagens.length} requerente(s) neste processo
            </p>
            <ul className="max-h-[280px] overflow-y-auto">
              {mapa.linhagens.map((l) => {
                const ativo = l.requerenteId === requerenteSelecionadoId
                return (
                  <li key={l.requerenteId}>
                    <button
                      onClick={() => {
                        onSelecionarRequerente(l.requerenteId)
                        // Escolher requerente é pedir para ver a linha dele.
                        onModo("linhagem")
                        setMenuRequerente(false)
                      }}
                      className={`flex w-full items-start gap-2 px-3 py-2 text-left text-[13px] transition hover:bg-[var(--surface-hover)] ${
                        ativo ? "bg-[var(--surface-selected)] font-medium text-gray-900" : "text-gray-700"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{l.nome}</span>
                        <span className="block text-[11px] text-gray-500">
                          {l.geracoes} geração(ões) · {l.visivel.size} pessoa(s) na linha
                          {l.danteCausaId == null ? " · sem ascendente estrangeiro" : ""}
                        </span>
                      </span>
                      {l.maioridade === "MENOR" && (
                        <span className="mt-0.5 rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                          menor
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
            {mapa.linhagens.length > 1 && (
              <button
                onClick={() => {
                  setMenuRequerente(false)
                  setComparando(true)
                }}
                className="w-full border-t border-[var(--border-default)] px-3 py-2 text-left text-[12px] text-gray-600 transition hover:bg-[var(--surface-hover)] hover:text-gray-900"
              >
                Comparar requerentes
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Controles do modo linhagem ───────────────────────────────── */}
      {emLinhagem && (
        <>
          <button
            onClick={() => onEstilo(estilo === "esmaecer" ? "ocultar" : "esmaecer")}
            className={CLASSE_BOTAO_BARRA}
            title={
              estilo === "esmaecer"
                ? "Os demais ramos estão a 20%. Clique para ocultá-los."
                : "Os demais ramos estão ocultos. Clique para deixá-los a 20%."
            }
          >
            <Eye className="h-4 w-4" />
            <span className="hidden @[1700px]:inline">{estilo === "esmaecer" ? "A 20%" : "Ocultos"}</span>
          </button>

          {totalRelacionados > 0 && (
            <button
              onClick={onAlternarRelacionados}
              className={relacionadosVisiveis ? CLASSE_BOTAO_BARRA_ATIVO : CLASSE_BOTAO_BARRA}
              title="Revelar irmãos, cônjuges e filhos de quem está na linha, sem sair do foco"
              aria-label="Mostrar relacionados"
            >
              <Users2 className="h-4 w-4" />
              <span className="hidden @[1700px]:inline">Mostrar relacionados</span>
              <span className="rounded-full bg-[var(--surface-secondary)] px-1.5 text-[11px] tabular-nums text-gray-700">
                {totalRelacionados}
              </span>
            </button>
          )}

          <button
            onClick={() => onModo("todos")}
            className={CLASSE_BOTAO_BARRA}
            title="Restaurar todos os ramos (ESC)"
          >
            <X className="h-4 w-4 @[1700px]:hidden" aria-hidden />
            <span className="sr-only @[1700px]:not-sr-only">Voltar para árvore completa</span>
          </button>
        </>
      )}

      {/* ── Filtros rápidos ──────────────────────────────────────────── */}
      <div ref={refFiltros} className="relative">
        <button
          onClick={() => setMenuFiltros((v) => !v)}
          className={filtrosAtivos > 0 ? CLASSE_BOTAO_BARRA_ATIVO : CLASSE_BOTAO_BARRA}
          title="Filtros rápidos — realçam, não escondem"
          aria-label="Filtros rápidos"
        >
          <Filter className="h-4 w-4" />
          <span className="hidden @[1500px]:inline">Filtros</span>
          {filtrosAtivos > 0 && (
            <span className="rounded-full bg-[var(--surface-secondary)] px-1.5 text-[11px] tabular-nums text-gray-700">
              {filtrosAtivos}
            </span>
          )}
        </button>

        {menuFiltros && (
          <div
            className={`${CLASSE_MENU_BARRA} w-[260px] max-w-[calc(100vw-1.5rem)]`}
            style={{ zIndex: CAMADA_MENU_BARRA }}
          >
            <p className="border-b border-[var(--border-default)] px-3 py-2 text-[11px] leading-snug text-gray-500">
              O filtro <strong className="font-semibold">realça</strong> quem casa. Ninguém sai da
              árvore — esconder um pai deixaria o filho órfão na tela.
            </p>
            <ul className="max-h-[300px] overflow-y-auto py-1">
              {FILTROS_RAPIDOS.map((chave) => {
                const ligado = filtros.chaves.has(chave)
                return (
                  <li key={chave}>
                    <button
                      onClick={() => onAlternarFiltro(chave)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-gray-700 transition hover:bg-[var(--surface-hover)]"
                    >
                      <span
                        aria-hidden
                        className={`h-3.5 w-3.5 shrink-0 rounded border ${
                          ligado
                            ? "border-[var(--border-strong)] bg-[var(--action-primary)]"
                            : "border-[var(--border-default)] bg-[var(--surface-input)]"
                        }`}
                      />
                      <span className="min-w-0 flex-1">{ROTULO_FILTRO[chave]}</span>
                      {contagemFiltros[chave] != null && (
                        <span className="text-[11px] tabular-nums text-gray-500">{contagemFiltros[chave]}</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
            {(filtrosAtivos > 0 || totalRecolhivel > 0) && (
              <div className="flex items-center justify-between gap-2 border-t border-[var(--border-default)] px-3 py-2">
                {filtrosAtivos > 0 ? (
                  <button
                    onClick={onLimparFiltros}
                    className="flex items-center gap-1 text-[12px] text-gray-500 transition hover:text-gray-800"
                  >
                    <X className="h-3.5 w-3.5" /> Limpar
                  </button>
                ) : (
                  <span />
                )}
                {totalRecolhivel > 0 && (
                  <button
                    onClick={onRecolherTudo}
                    className="text-[12px] text-gray-500 transition hover:text-gray-800"
                    title="Voltar a recolher os ramos que foram expandidos"
                  >
                    Recolher ramos ({totalRecolhivel})
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Modo Saúde (heatmap) ─────────────────────────────────────── */}
      <button
        onClick={onAlternarSaude}
        aria-pressed={saudeLigada}
        aria-label="Modo Saúde"
        className={saudeLigada ? CLASSE_BOTAO_BARRA_ATIVO : CLASSE_BOTAO_BARRA}
        title="Sinalizar cada pessoa por saúde operacional — o cartão não muda, ganha um anel"
      >
        <Activity className="h-4 w-4" />
        <span className="hidden @[1500px]:inline">Saúde</span>
      </button>

      {/* ── Comparação entre requerentes (na barra única, não em linha própria) ── */}
      {comparacao.length > 1 && (
        <div ref={refComparar} className="relative">
          <button
            onClick={() => setComparando((v) => !v)}
            className={comparando ? CLASSE_BOTAO_BARRA_ATIVO : CLASSE_BOTAO_BARRA}
            title="Comparar o estado de todos os requerentes"
            aria-label="Comparar requerentes"
          >
            <GitCompare className="h-4 w-4" />
            <span className="hidden @[1500px]:inline">Comparar</span>
          </button>
          {comparando && (
            <div
              className={`${CLASSE_MENU_BARRA} w-[380px] max-w-[calc(100vw-1.5rem)]`}
              style={{ zIndex: CAMADA_MENU_BARRA }}
            >
              <p className="border-b border-[var(--border-default)] px-3 py-2 text-[11px] uppercase tracking-wide text-gray-500">
                Comparação · clique para focar a linhagem
              </p>
              <ul className="max-h-[340px] overflow-y-auto">
                {comparacao.map((r) => {
                  const total = r.documental.necessarias
                  const feitos = r.documental.atendidas + r.documental.dispensadas
                  const completa = total > 0 && feitos === total
                  return (
                    <li key={r.requerenteId}>
                      <button
                        onClick={() => {
                          onSelecionarRequerente(r.requerenteId)
                          setComparando(false)
                        }}
                        className="w-full px-3 py-2 text-left transition hover:bg-[var(--surface-hover)]"
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[13px] font-medium text-gray-900">{r.nome}</span>
                          <span className="shrink-0 text-[12px] tabular-nums text-gray-700">
                            {total > 0 ? `${feitos}/${total}` : "sem exigência"}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[11px] text-gray-500">
                          {r.pessoas} na linhagem
                          {completa ? " · completa" : ` · ${r.documental.pendentes} pendência(s)`}
                          {r.bloqueios > 0 ? ` · ${r.bloqueios} bloqueio(s)` : ""}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  )
}
