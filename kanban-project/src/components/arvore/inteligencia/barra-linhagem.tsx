"use client"

// src/components/arvore/inteligencia/barra-linhagem.tsx
// ============================================================================
// BARRA DE LINHAGEM — controles novos, gramática visual velha.
//
// Tudo aqui é `absolute`, por cima do canvas, com exatamente a mesma casca dos
// botões "Buscar" e "Análise" que já existiam:
//
//     rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px]
//     text-gray-600 shadow-sm hover:border-gray-300 hover:text-gray-900
//
// Isso não é economia de esforço: é o requisito. A árvore tem de continuar
// parecendo a mesma. Nenhum controle daqui entra no fluxo do canvas — abrir,
// fechar ou trocar de requerente não move um card.
//
// O CONTROLE PRINCIPAL é um seletor de DUAS opções — "Árvore completa" e
// "Linhagem do requerente" — em vez de um botão de liga/desliga. Um toggle
// esconde que existem dois modos; o segmentado mostra onde você está e para
// onde pode ir, que é o que um operador precisa ao abrir um processo alheio.
// ============================================================================

import { useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronRight, Eye, Filter, Users2, X } from "lucide-react"
import type { DegrauLinhagem, Linhagem, MapaLinhagens } from "@/src/lib/genealogia/motor/linhagens"
import type { EstiloFoco, ModoFoco } from "@/src/lib/genealogia/navegacao/foco"
import { ROTULO_FILTRO, type ChaveFiltro, type EstadoFiltros } from "@/src/lib/genealogia/navegacao/filtros"
import type { ResumoLinhagem } from "@/src/lib/genealogia/operacional/dossie"
import type { AcaoRecomendada } from "@/src/lib/genealogia/operacional/diagnostico"

const CASCA =
  "flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-900"
const CASCA_ATIVA =
  "flex items-center gap-2 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-[13px] font-medium text-gray-900 shadow-sm transition"

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
  resumo: ResumoLinhagem | null
  comparacao: ResumoLinhagem[]
  trilha: DegrauLinhagem[]
  proximaAcao: AcaoRecomendada
  relacionadosVisiveis: boolean
  onAlternarRelacionados: () => void
  totalRelacionados: number
  totalRecuado: number
  totalRecolhivel: number
  onRecolherTudo: () => void
  onIrParaPessoa: (pessoaId: number) => void
  carregando: boolean
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
function useFecharFora(aberto: boolean, fechar: () => void) {
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

export function BarraLinhagem(props: Props) {
  const {
    mapa, linhagem, requerenteSelecionadoId, onSelecionarRequerente,
    modo, onModo, estilo, onEstilo,
    filtros, filtrosAtivos, onAlternarFiltro, onLimparFiltros,
    resumo, comparacao, trilha, proximaAcao,
    relacionadosVisiveis, onAlternarRelacionados, totalRelacionados,
    totalRecuado, totalRecolhivel, onRecolherTudo, onIrParaPessoa, carregando,
  } = props

  const [menuRequerente, setMenuRequerente] = useState(false)
  const [menuFiltros, setMenuFiltros] = useState(false)
  const [resumoAberto, setResumoAberto] = useState(false)
  const [comparando, setComparando] = useState(false)

  const refRequerente = useFecharFora(menuRequerente, () => setMenuRequerente(false))
  const refFiltros = useFecharFora(menuFiltros, () => setMenuFiltros(false))
  const refResumo = useFecharFora(resumoAberto, () => setResumoAberto(false))
  const refComparar = useFecharFora(comparando, () => setComparando(false))

  // Sem requerente cadastrado não há linhagem para escolher. A barra some em vez
  // de oferecer um seletor vazio — controle que não faz nada é ruído.
  if (mapa.linhagens.length === 0) return null

  const emLinhagem = modo === "linhagem"

  return (
    <div className="absolute left-4 top-4 z-20 flex max-w-[calc(100%-2rem)] flex-col gap-2">
      <div className="flex flex-wrap items-start gap-2">
        {/* ── VISUALIZAÇÃO: dois estados explícitos ────────────────────── */}
        <div
          role="group"
          aria-label="Visualização da árvore"
          className="flex items-center overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
        >
          <button
            onClick={() => onModo("todos")}
            aria-pressed={!emLinhagem}
            className={`px-3 py-2 text-[13px] transition ${
              !emLinhagem
                ? "bg-gray-50 font-medium text-gray-900"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`}
            title="Ver a árvore inteira, como sempre"
          >
            Árvore completa
          </button>
          <span aria-hidden className="h-5 w-px bg-gray-200" />
          <button
            onClick={() => onModo("linhagem")}
            aria-pressed={emLinhagem}
            className={`flex items-center gap-1.5 px-3 py-2 text-[13px] transition ${
              emLinhagem
                ? "bg-gray-50 font-medium text-gray-900"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`}
            title="Ver somente a linhagem do requerente selecionado (L)"
          >
            Linhagem do requerente
            {emLinhagem && totalRecuado > 0 && (
              <span className="rounded-full bg-gray-200 px-1.5 text-[11px] tabular-nums text-gray-700">
                −{totalRecuado}
              </span>
            )}
          </button>
        </div>

        {/* ── Requerente em foco ───────────────────────────────────────── */}
        <div ref={refRequerente} className="relative">
          <button
            onClick={() => setMenuRequerente((v) => !v)}
            className={CASCA}
            title="Escolher o requerente cuja linhagem será exibida"
          >
            <span className="max-w-[180px] truncate">
              {linhagem?.nome ?? "Escolher requerente"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          </button>

          {menuRequerente && (
            <div className="absolute left-0 top-full mt-1 w-[300px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
              <p className="border-b border-gray-100 px-3 py-2 text-[11px] uppercase tracking-wide text-gray-500">
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
                        className={`flex w-full items-start gap-2 px-3 py-2 text-left text-[13px] transition hover:bg-gray-50 ${
                          ativo ? "bg-gray-50 font-medium text-gray-900" : "text-gray-700"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{l.nome}</span>
                          <span className="block text-[11px] text-gray-500">
                            {l.geracoes} geração(ões) · {l.visivel.size} pessoa(s) na linha
                            {l.danteCausaId == null ? " · sem ascendente estrangeiro" : ""}
                          </span>
                        </span>
                        {l.marca === "menor" && (
                          <span className="mt-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
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
                  className="w-full border-t border-gray-100 px-3 py-2 text-left text-[12px] text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
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
              className={CASCA}
              title={
                estilo === "esmaecer"
                  ? "Os demais ramos estão a 20%. Clique para ocultá-los."
                  : "Os demais ramos estão ocultos. Clique para deixá-los a 20%."
              }
            >
              <Eye className="h-4 w-4" />
              <span className="hidden md:inline">{estilo === "esmaecer" ? "A 20%" : "Ocultos"}</span>
            </button>

            {totalRelacionados > 0 && (
              <button
                onClick={onAlternarRelacionados}
                className={relacionadosVisiveis ? CASCA_ATIVA : CASCA}
                title="Revelar irmãos, cônjuges e filhos de quem está na linha, sem sair do foco"
              >
                <Users2 className="h-4 w-4" />
                <span className="hidden md:inline">Mostrar relacionados</span>
                <span className="rounded-full bg-gray-100 px-1.5 text-[11px] tabular-nums text-gray-600">
                  {totalRelacionados}
                </span>
              </button>
            )}

            <button
              onClick={() => onModo("todos")}
              className={CASCA}
              title="Restaurar todos os ramos (ESC)"
            >
              Voltar para árvore completa
            </button>
          </>
        )}

        {/* ── Filtros rápidos ──────────────────────────────────────────── */}
        <div ref={refFiltros} className="relative">
          <button
            onClick={() => setMenuFiltros((v) => !v)}
            className={filtrosAtivos > 0 ? CASCA_ATIVA : CASCA}
            title="Filtros rápidos — realçam, não escondem"
          >
            <Filter className="h-4 w-4" />
            <span className="hidden sm:inline">Filtros</span>
            {filtrosAtivos > 0 && (
              <span className="rounded-full bg-gray-200 px-1.5 text-[11px] tabular-nums text-gray-700">
                {filtrosAtivos}
              </span>
            )}
          </button>

          {menuFiltros && (
            <div className="absolute left-0 top-full mt-1 w-[260px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
              <p className="border-b border-gray-100 px-3 py-2 text-[11px] leading-snug text-gray-500">
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
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-gray-700 transition hover:bg-gray-50"
                      >
                        <span
                          aria-hidden
                          className={`h-3.5 w-3.5 shrink-0 rounded border ${
                            ligado ? "border-gray-800 bg-gray-800" : "border-gray-300 bg-white"
                          }`}
                        />
                        {ROTULO_FILTRO[chave]}
                      </button>
                    </li>
                  )
                })}
              </ul>
              {(filtrosAtivos > 0 || totalRecolhivel > 0) && (
                <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2">
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

        {/* ── Resumo do requerente ─────────────────────────────────────── */}
        {resumo && (
          <div ref={refResumo} className="relative">
            <button
              onClick={() => setResumoAberto((v) => !v)}
              className={resumoAberto ? CASCA_ATIVA : CASCA}
              title="Resumo da linhagem em foco"
            >
              <span className="tabular-nums">
                {resumo.documental.necessarias > 0
                  ? `${resumo.documental.atendidas + resumo.documental.dispensadas}/${resumo.documental.necessarias}`
                  : "—"}
              </span>
              <span className="hidden lg:inline text-gray-400">·</span>
              <span className="hidden lg:inline">{resumo.pessoas} na linha</span>
            </button>

            {resumoAberto && (
              <div className="absolute left-0 top-full mt-1 w-[330px] rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
                <p className="text-[13px] font-semibold text-gray-900">{resumo.nome}</p>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  Linhagem: {resumo.pessoas} pessoas · {resumo.geracoes} geração(ões)
                </p>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  Ascendente transmissor:{" "}
                  {resumo.danteCausaNome ? (
                    <button
                      onClick={() => {
                        onIrParaPessoa(resumo.danteCausaId!)
                        setResumoAberto(false)
                      }}
                      className="font-medium text-gray-800 underline underline-offset-2 transition hover:text-gray-950"
                    >
                      {resumo.danteCausaNome}
                    </button>
                  ) : (
                    <span className="text-gray-400">não identificado</span>
                  )}
                </p>

                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
                  <Linha
                    rotulo="Documentos"
                    texto={
                      resumo.documental.necessarias > 0
                        ? `${resumo.documental.atendidas + resumo.documental.dispensadas}/${resumo.documental.necessarias}`
                        : "sem exigência"
                    }
                  />
                  <Linha rotulo="Pendências" texto={String(resumo.documental.pendentes)} />
                  <Linha rotulo="Bloqueios" texto={String(resumo.bloqueios)} />
                  <Linha rotulo="Divergências" texto={String(resumo.divergencias)} />
                  <Linha rotulo="Tarefas abertas" texto={String(resumo.tarefasAbertas)} />
                  <Linha rotulo="Tarefas vencidas" texto={String(resumo.tarefasVencidas)} />
                </dl>

                <div className="mt-3 border-t border-gray-100 pt-2 text-[12px]">
                  <span className="text-gray-500">Prazo do processo: </span>
                  {resumo.prazo ? (
                    <span className="font-medium text-gray-800">
                      {resumo.prazo.rotuloDias} ({resumo.prazo.rotuloStatus})
                    </span>
                  ) : (
                    <span className="text-gray-400">sem SLA configurado</span>
                  )}
                </div>

                <div className="mt-3 rounded-md bg-gray-50 p-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Próxima ação
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-gray-700">
                    {proximaAcao.pessoaNome ? `${proximaAcao.pessoaNome}: ` : ""}
                    {proximaAcao.acao}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-gray-400">
                    Fonte: {proximaAcao.fonte}
                  </p>
                  {proximaAcao.pessoaId != null && (
                    <button
                      onClick={() => {
                        onIrParaPessoa(proximaAcao.pessoaId!)
                        setResumoAberto(false)
                      }}
                      className="mt-1.5 text-[12px] font-medium text-gray-800 underline underline-offset-2 transition hover:text-gray-950"
                    >
                      Ir até a pessoa
                    </button>
                  )}
                </div>

                {carregando && (
                  <p className="mt-2 text-[11px] text-gray-400">Atualizando dados operacionais…</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Comparação entre requerentes ─────────────────────────────── */}
        {comparacao.length > 1 && (
          <div ref={refComparar} className="relative">
            <button
              onClick={() => setComparando((v) => !v)}
              className={comparando ? CASCA_ATIVA : CASCA}
              title="Comparar o estado de todos os requerentes"
            >
              Comparar
            </button>
            {comparando && (
              <div className="absolute left-0 top-full mt-1 w-[380px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                <p className="border-b border-gray-100 px-3 py-2 text-[11px] uppercase tracking-wide text-gray-500">
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
                          className="w-full px-3 py-2 text-left transition hover:bg-gray-50"
                        >
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[13px] font-medium text-gray-900">
                              {r.nome}
                            </span>
                            <span className="shrink-0 text-[12px] tabular-nums text-gray-700">
                              {total > 0 ? `${feitos}/${total}` : "sem exigência"}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[11px] text-gray-500">
                            {r.pessoas} na linhagem
                            {completa
                              ? " · completa"
                              : ` · ${r.documental.pendentes} pendência(s)`}
                            {r.bloqueios > 0 ? ` · ${r.bloqueios} bloqueio(s)` : ""}
                            {r.tarefasVencidas > 0 ? ` · ${r.tarefasVencidas} vencida(s)` : ""}
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
      </div>

      {/* ── BREADCRUMB DA LINHAGEM ─────────────────────────────────────────
          Projeção do caminho que já existe na árvore: cada degrau aponta para o
          MESMO nó do canvas. Não é uma segunda representação da estrutura. */}
      {emLinhagem && trilha.length > 1 && (
        <nav
          aria-label="Caminho da linhagem"
          className="flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 shadow-sm"
        >
          {trilha.map((degrau, i) => (
            <span key={degrau.pessoaId} className="flex items-center gap-1">
              {i > 0 && <ChevronRight aria-hidden className="h-3 w-3 shrink-0 text-gray-300" />}
              <button
                onClick={() => onIrParaPessoa(degrau.pessoaId)}
                title={`${degrau.rotulo}${degrau.compartilhadoPor > 1 ? ` · ${degrau.compartilhadoPor} requerentes dependem` : ""}`}
                className={`max-w-[150px] truncate rounded px-1.5 py-0.5 text-[12px] transition hover:bg-gray-100 ${
                  degrau.ehDanteCausa ? "font-semibold text-gray-900" : "text-gray-600"
                }`}
              >
                <span className="text-gray-400">{degrau.rotulo}: </span>
                {degrau.nome}
              </button>
            </span>
          ))}
        </nav>
      )}
    </div>
  )
}

function Linha({ rotulo, texto }: { rotulo: string; texto: string }) {
  return (
    <>
      <dt className="text-gray-500">{rotulo}</dt>
      <dd className="text-right font-medium tabular-nums text-gray-900">{texto}</dd>
    </>
  )
}
