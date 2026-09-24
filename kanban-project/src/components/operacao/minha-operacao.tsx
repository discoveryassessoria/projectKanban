// src/components/operacao/minha-operacao.tsx
// ============================================================================
// MINHA OPERAÇÃO — a central PESSOAL de atenção operacional.
//
// Mental model (mandato "Minha Operação", 15/09/2026):
//   NOTIFICAÇÕES         = o que aconteceu.
//   MINHA OPERAÇÃO       = o que exige minha atenção agora.
//   PROCESSO → WORKFLOW  = onde o trabalho é EXECUTADO.
//
// Esta tela é só PROJEÇÃO + PRIORIZAÇÃO + CONSULTA + NAVEGAÇÃO. Fonte única:
// `GET /api/operacao/tarefas?visao=minha_fila` (a MESMA `minhaFila()` que já
// alimentava a antiga Minha Fila) — nenhum motor novo, nenhuma Tarefa
// sintética, nenhum passo virando linha própria.
//
// UMA LINHA = UMA TAREFA CANÔNICA. "Aguardar cartório", "Acompanhar hoje",
// "Retorno recebido" NUNCA são Tarefas separadas — são a CONDIÇÃO atual da
// MESMA linha (mesma taskId, mesmo stepInstanceId), lida dos mesmos booleanos
// canônicos que já alimentavam `central-tarefas.tsx` (`emRisco`,
// `atrasoInterno`, `atrasoTerceiro`, `acompanhamentoVencido`,
// `retornoRecebido`, `coluna`) — nunca um novo estado inventado aqui.
//
// Identidade visual: 100% tokens/componentes de `visao-global.tsx`
// (Tarefas e Projetos) — `Etiqueta`/`Estado` do kit compartilhado, shadcn
// (`Input`/`Select`/`Popover`), mesmos tokens de superfície/borda/texto.
// ============================================================================
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Search, Play, CalendarClock, AlertTriangle, Clock3, Hourglass, CheckCircle2,
  SlidersHorizontal, X as XIcon, ArrowUpRight, UserPlus,
  ChevronLeft, ChevronRight, LayoutGrid, List,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import {
  auth, dataCurta, Estado, Etiqueta, ROTULO_STATUS, ROTULO_PRIORIDADE, rotularFase, useRotulosDeFaseProntos,
  SeletorResponsavel, acaoPrincipal, type LinhaDeFila, type LinhaOperacional,
} from "./kit-operacional"
import {
  CATEGORIAS_ATENCAO, classificarAtencaoOperacional, motivosAtivos, ordenarPorAtencaoOperacional, rotuloDeAtencao,
  ROTULO_MOTIVO, type CategoriaAtencao,
} from "@/lib/operacional/atencao-operacional"
import { urlOperacionalDaTarefa, urlDistribuicaoDoProcesso } from "@/lib/operacional/navegacao"
import { MinhaOperacaoDetalhe } from "./minha-operacao-detalhe"

// `obrigacao-atribuicao.ts` importa o Prisma client em tempo de execução —
// não pode ser importado por um componente "use client". O literal aqui só
// precisa continuar igual ao `ORIGEM_OBRIGACAO_ATRIBUICAO` daquele arquivo.
const ORIGEM_OBRIGACAO_ATRIBUICAO = "obrigacao-atribuicao"

/**
 * O CARTÃO DA OBRIGAÇÃO ADMINISTRATIVA — "O QUE / ONDE / SITUAÇÃO / AÇÃO"
 * em vez de uma linha de tabela genérica. A natureza da tarefa (distribuir,
 * nunca executar uma certidão) muda a apresentação, nunca o fato de que é
 * trabalho real do usuário logado — por isso vive DENTRO de Minha Operação,
 * nunca numa tela separada.
 *
 * A CONTAGEM "N aguardando responsável" é lida agora (nunca guardada na
 * linha, de propósito — ver obrigacao-atribuicao.ts) pela MESMA leitura que
 * o chip "sem responsável" da Central usa.
 */
function CartaoObrigacaoAdministrativa({ l }: { l: LinhaOperacional }) {
  const router = useRouter()
  const [semResponsavel, setSemResponsavel] = useState<number | null>(null)

  useEffect(() => {
    if (l.processoId == null) return
    let vivo = true
    const p = new URLSearchParams({ processo: String(l.processoId), semResponsavel: "1", porPagina: "1" })
    p.append("tipoTarefa", "NORMAL")
    fetch(`/api/operacao/visao-global?${p.toString()}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { total: number }) => { if (vivo) setSemResponsavel(d.total) })
      .catch(() => { if (vivo) setSemResponsavel(null) })
    return () => { vivo = false }
  }, [l.processoId])

  const contexto = l.familiaNome ? `${l.familiaNome} · ${l.processoNome ?? "—"}` : l.processoNome ?? "—"
  const abrirDistribuicao = () => { if (l.processoId != null) router.push(urlDistribuicaoDoProcesso(l.processoId)) }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={abrirDistribuicao}
      onKeyDown={(e) => { if (e.key === "Enter") abrirDistribuicao() }}
      className="flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border border-[var(--info-tile)] bg-[var(--info-tile)]/25 px-4 py-3 transition-colors hover:bg-[var(--info-tile)]/40"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--info-tile)] text-[var(--info-text)]">
        <UserPlus className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">Atribuir tarefas</p>
        <p className="truncate text-[11.5px] text-[var(--text-secondary)]">{contexto}</p>
      </div>
      <p className="shrink-0 text-[12.5px] text-[var(--text-secondary)]">
        {semResponsavel == null ? "…" : `${semResponsavel} tarefa${semResponsavel === 1 ? "" : "s"} aguardando responsável`}
      </p>
      <span className="shrink-0 text-[11.5px] text-[var(--text-secondary)]">Responsável: {l.responsavelNome ?? "—"}</span>
      <button
        onClick={(e) => { e.stopPropagation(); abrirDistribuicao() }}
        className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--action-primary)] bg-[var(--action-primary)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--action-primary-ink)] transition-opacity hover:opacity-90"
      >
        Distribuir tarefas <ArrowUpRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

const ICONE_CATEGORIA: Record<CategoriaAtencao, React.ComponentType<{ className?: string }>> = {
  paraAgirAgora: Play,
  acompanharHoje: CalendarClock,
  atrasoInterno: AlertTriangle,
  terceirosAtrasados: Clock3,
  aguardandoTerceiros: Hourglass,
}
/** Mesmos tokens semânticos de tile/tinta que `visao-global.tsx` (Etapa 5) já usa — nunca cor inventada. */
const TOM_CATEGORIA: Record<CategoriaAtencao, string> = {
  paraAgirAgora: "bg-[var(--info-tile)] text-[var(--info-text)]",
  acompanharHoje: "bg-[var(--warning-tile)] text-[var(--warning-text)]",
  atrasoInterno: "bg-[var(--danger-tile)] text-[var(--danger-text)]",
  terceirosAtrasados: "bg-[var(--warning-tile)] text-[var(--warning-text)]",
  aguardandoTerceiros: "bg-[var(--surface-tertiary)] text-[var(--text-secondary)]",
}

const TODOS = "todos"
const Z_POPOVER = "z-[10060]"
const POR_PAGINA_GRUPOS = 8
const LINHAS_VISIVEIS_POR_FAMILIA = 5

interface GrupoOperacional {
  chave: string
  processoId: number | null
  rotuloPrincipal: string
  rotuloSecundario: string | null
  faseMacroKey: string | null
  linhas: LinhaOperacional[]
  pessoas: number
  paraFazer: number
  acompanhar: number
  atrasadas: number
  terceirosAtrasados: number
  /** Vem de um universo SEPARADO (`concluidas_hoje`) — `linhas` acima nunca inclui concluída (minhaFila exclui de propósito). */
  concluidas: number
  proximoPrazo: string | null
}

/**
 * A LINHA DENTRO DE UM GRUPO — mesma tabela de sempre, agora escopada a UMA
 * família/processo por vez. Extraída para não repetir a marcação ao renderizar
 * N grupos — a TAREFA continua sendo a mesma linha canônica, só o container
 * visual mudou (item 13 do mandato: agrupamento é projeção, não motor).
 */
function LinhaOperacaoTabela({ l, selecionado, aoSelecionar, aoExecutar, ocupado, marcado, aoMarcar, mostrarSelecao }: {
  l: LinhaOperacional
  /**
   * CLICAR PARA OLHAR NUNCA ASSUME TRABALHO — o clique na LINHA só abre o
   * painel de detalhe (`aoSelecionar`), nunca comanda. Quem inicia clica no
   * botão da ação, explicitamente.
   */
  selecionado: boolean
  aoSelecionar: () => void
  /** A ação do botão: comanda (quando há o que comandar) e SÓ DEPOIS navega. */
  aoExecutar: () => void
  ocupado: boolean
  marcado: boolean
  aoMarcar: () => void
  /** `tarefas.editar` — sem ela, a coluna nem existe (nunca um checkbox morto). */
  mostrarSelecao: boolean
}) {
  const atencaoLinha = rotuloDeAtencao(l)
  const acao = acaoPrincipal(l)
  return (
    <tr
      onClick={aoSelecionar}
      className={`cursor-pointer border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--surface-secondary)] last:border-b-0 ${selecionado ? "bg-[var(--surface-secondary)]" : ""}`}
    >
      {mostrarSelecao && (
        <td className="w-8 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={marcado} onChange={aoMarcar} className="h-3.5 w-3.5 accent-[var(--action-primary)]" />
        </td>
      )}
      <td className="px-3 py-2.5">
        <Etiqueta tom={atencaoLinha.tom === "critico" ? "critico" : atencaoLinha.tom === "alerta" ? "alerta" : "neutro"}>{atencaoLinha.rotulo}</Etiqueta>
      </td>
      <td className="max-w-[160px] px-3 py-2.5">
        <div className="truncate text-[12px] font-medium text-[var(--text-primary)]">{l.pessoaNome ?? "—"}</div>
        <div className="truncate text-[10.5px] text-[var(--text-muted)]">{l.processoNome ?? "—"}</div>
      </td>
      <td className="max-w-[220px] overflow-hidden px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {l.emRisco && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--danger)]" title={l.motivosRisco.length ? l.motivosRisco.join(" · ") : "Em risco"} />
          )}
          <span className="block min-w-0 truncate text-[12.5px] font-medium text-[var(--text-primary)]">{l.titulo}</span>
        </div>
        {/* MOTIVOS CONCORRENTES — vários relógios podem tocar ao mesmo tempo
            pra MESMA tarefa (mandato "motor de atenção operacional",
            17/09/2026): nunca vira segunda linha, só um rodapé informativo. */}
        {motivosAtivos(l).length > 1 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {motivosAtivos(l).map((m) => (
              <span key={m} className="rounded-full bg-[var(--warning-tile)] px-1.5 py-0.5 text-[9.5px] font-medium text-[var(--warning-text)]">
                {ROTULO_MOTIVO[m]}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 text-[11.5px] text-[var(--text-secondary)]">{rotularFase(l.faseMacroKey) ?? "—"}</td>
      <td className="max-w-[160px] px-3 py-2.5 text-[11.5px] text-[var(--text-secondary)]">
        <div className="truncate">{l.etapaAtual ?? "—"}</div>
        <div className="truncate text-[10px] text-[var(--text-muted)]">{textoDaProximaAcao(l)}</div>
      </td>
      <td className="px-3 py-2.5">
        <div className={`text-[11.5px] ${l.atrasada ? "text-[var(--danger-text)]" : "text-[var(--text-secondary)]"}`}>{l.rotuloDoPrazo}</div>
        {l.dataPrazo && <div className="text-[10px] tabular-nums text-[var(--text-muted)]">{dataCurta(l.dataPrazo)}</div>}
      </td>
      <td className="px-3 py-2.5 text-[11.5px] text-[var(--text-secondary)]">{ROTULO_PRIORIDADE[l.prioridade] ?? l.prioridade}</td>
      <td className="max-w-[180px] overflow-hidden truncate px-3 py-2.5 text-[11.5px] text-[var(--text-secondary)]">{textoDaSituacao(l)}</td>
      <td className="max-w-[140px] overflow-hidden px-3 py-2.5 text-[11.5px] text-[var(--text-secondary)]">
        {l.terceiroNome ? <span className="block truncate text-[var(--info-text)]">{l.terceiroNome}</span> : "—"}
      </td>
      <td className="px-3 py-2.5">
        <button
          disabled={ocupado}
          onClick={(e) => { e.stopPropagation(); aoExecutar() }}
          className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2 py-1 text-[10.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
        >
          {ocupado && acao.comando === "iniciar" ? "Iniciando…" : acao.rotulo} <ArrowUpRight className="h-3 w-3" />
        </button>
      </td>
    </tr>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-[var(--text-secondary)]">{rotulo}</span>
      {children}
    </label>
  )
}

/** A situação em linguagem de gente — mandato §16: passo ≠ estado operacional. */
function textoDaSituacao(l: LinhaOperacional): string {
  if (l.requerDecisao) return "Requer decisão"
  if (l.coluna === "AGUARDANDO_TERCEIRO") {
    return l.esperandoDe === "cliente" ? "Aguardando o cliente" : `Aguardando ${l.terceiroNome ?? "terceiro"}`
  }
  if (l.coluna === "BLOQUEADA") return l.motivoBloqueio ? `Bloqueada — ${l.motivoBloqueio}` : "Bloqueada"
  if (l.coluna === "A_FAZER") return "Ação necessária"
  if (l.coluna === "CONCLUIDA") return "Concluída"
  return ROTULO_STATUS[l.statusTarefa] ?? l.statusTarefa
}

/** A próxima ação/acontecimento — mandato §15, a coluna mais importante da tela. */
function textoDaProximaAcao(l: LinhaOperacional): string {
  if (l.proximoAcontecimento?.descricao) return l.proximoAcontecimento.descricao
  if (l.requerDecisao) return "Decidir o que fazer com esta operação"
  if (l.coluna === "A_FAZER") return l.etapaAtual ? `Executar: ${l.etapaAtual}` : "Iniciar"
  if (l.coluna === "AGUARDANDO_TERCEIRO") return `Aguardar ${l.terceiroNome ?? "terceiro"}`
  return l.etapaAtual ?? "—"
}

interface Filtros {
  busca: string
  fase: string | null
  /** Client-side — vem do universo já carregado, sem round-trip novo. */
  etapa: string | null
  prioridade: string | null
  terceiro: string | null
  prazo: "todos" | "atrasadas" | "hoje" | "7dias"
}
const SEM_FILTRO: Filtros = { busca: "", fase: null, etapa: null, prioridade: null, terceiro: null, prazo: "todos" }

export function MinhaOperacao() {
  useRotulosDeFaseProntos()
  const router = useRouter()
  // ATRIBUIÇÃO EM LOTE é distribuição — mesma permissão que já guarda "Sem
  // responsável"/"Distribuir tarefas" em toda a operação (`tarefas.editar`,
  // `/api/operacao/atribuiveis`: "só quem distribui vê a lista de para-quem-
  // distribuir"). Sem este porteiro, quem não tem a permissão via checkbox e
  // botão que sempre falham ao tentar usar — botão morto (achado real,
  // teste com Daniela/assistente, 24/09/2026).
  const { pode: podePermissao } = usePermissoes()
  const podeAtribuirLote = podePermissao("tarefas.editar")
  // DEEP-LINK — a notificação de "nova atribuição em lote" (Sino) e o
  // cartão da obrigação administrativa mandam pra cá com `?processo=<id>`,
  // lido só uma vez, no mount, pra abrir aquele contexto já expandido.
  const paramsIniciais = useSearchParams()
  const [processoAlvoId] = useState<number | null>(() => {
    const n = Number(paramsIniciais.get("processo"))
    return Number.isInteger(n) && n > 0 ? n : null
  })
  const [expandidos, setExpandidos] = useState<Set<string>>(() => (processoAlvoId != null ? new Set([String(processoAlvoId)]) : new Set()))
  const [resultado, setResultado] = useState<{ chave: string; lista: LinhaOperacional[] | null } | null>(null)
  const [recarga, setRecarga] = useState(0)
  // ABRE EM "PARA FAZER", NUNCA EM "TODAS" (mandato 17/09/2026, item 1): quem
  // tem 300 tarefas abertas não deve precisar procurar dentro das 300 pra
  // achar as 12 que exigem ação agora. "Todas" continua existindo — só não é
  // mais a porta de entrada.
  const [categoria, setCategoria] = useState<CategoriaAtencao | "todas">("paraAgirAgora")
  const [filtros, setFiltros] = useState<Filtros>(SEM_FILTRO)
  const [maisFiltros, setMaisFiltros] = useState(false)
  const [pagina, setPagina] = useState(1)
  const [selecionado, setSelecionado] = useState<number | null>(null)
  const [visaoModo, setVisaoModo] = useState<"familia" | "lista">("familia")
  const [selecionadosLote, setSelecionadosLote] = useState<Set<number>>(new Set())
  const [loteAberto, setLoteAberto] = useState(false)
  const [loteOcupado, setLoteOcupado] = useState(false)
  const [loteErro, setLoteErro] = useState<string | null>(null)
  const [familiasVerTodas, setFamiliasVerTodas] = useState<Set<string>>(new Set())
  const [usuario, setUsuario] = useState<{ nome?: string } | null>(null)

  useEffect(() => {
    try {
      const bruto = localStorage.getItem("user")
      if (bruto) setUsuario(JSON.parse(bruto))
    } catch { /* leitura best-effort — sem usuário salvo, cai no fallback do saudação */ }
  }, [])

  // A BUSCA TEM DEBOUNCE — não dispara um request por tecla (mandato §21).
  const [buscaDigitada, setBuscaDigitada] = useState("")
  useEffect(() => {
    const t = setTimeout(() => { setFiltros((f) => ({ ...f, busca: buscaDigitada })); setPagina(1) }, 350)
    return () => clearTimeout(t)
  }, [buscaDigitada])

  // ── FILTROS SERVER-SIDE (mandato §20): fase/terceiro/prazo/busca viram
  // query string e entram no `where` do banco, ANTES da paginação — a MESMA
  // leitura de `visaoGerencial`/Tarefas e Projetos. A categoria de atenção
  // (KPI/chip) continua client-side: é estado COMPOSTO (`categoriasDaLinha`),
  // não uma coluna do banco — filtrar por ela sobre o universo já filtrado
  // pelo servidor é o mesmo padrão que os TILES de Tarefas e Projetos usam.
  const query = useMemo(() => {
    const p = new URLSearchParams({ visao: "minha_fila" })
    if (filtros.busca.trim()) p.set("busca", filtros.busca.trim())
    if (filtros.fase) p.set("fase", filtros.fase)
    if (filtros.terceiro) p.set("terceiro", filtros.terceiro)
    if (filtros.prazo !== "todos") p.set("prazo", filtros.prazo)
    return p.toString()
  }, [filtros])

  const chave = `${query}#${recarga}`
  useEffect(() => {
    let vivo = true
    fetch(`/api/operacao/tarefas?${query}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { linhas?: LinhaOperacional[] }) => { if (vivo) setResultado({ chave, lista: d.linhas ?? [] }) })
      .catch(() => { if (vivo) setResultado({ chave, lista: null }) })
    return () => { vivo = false }
  }, [chave, query])

  const carregando = resultado?.chave !== chave
  const linhas = carregando ? null : resultado?.lista ?? null
  const falhou = !carregando && linhas == null

  /**
   * RELEITURA IMEDIATA APÓS COMANDO — antes de `comandar` devolver, a tela
   * ainda mostrava o estado velho: quem clicava "Iniciar" via o cartão dizer
   * "A fazer" por um instante que podia durar até a próxima leitura natural.
   * Se a releitura demorasse, falhasse ou fosse descartada, a janela virava
   * permanente — "cliquei em Iniciar e nada aconteceu", com a tarefa já
   * iniciada no banco. `comandar` espera ESTA função antes de dar o ato por
   * encerrado.
   */
  const recarregarAgora = useCallback(async (): Promise<LinhaOperacional[] | null> => {
    try {
      const r = await fetch(`/api/operacao/tarefas?${query}`, { headers: auth() })
      if (!r.ok) return null
      const d: { linhas?: LinhaOperacional[] } = await r.json()
      const lista = d.linhas ?? []
      setResultado({ chave, lista })
      return lista
    } catch {
      return null
    }
  }, [query, chave])

  const [ocupado, setOcupado] = useState(false)
  const [erroComando, setErroComando] = useState<string | null>(null)

  /**
   * TODA MUDANÇA SAI POR UMA PORTA SÓ — inclusive o conflito: quando outro
   * responsável mexeu na tarefa antes, a porta responde 409 e a tela DIZ
   * isso e recarrega, em vez de deixar o clique parecer morto (achado real,
   * mandato "Minha Operação — Iniciar não pode virar só navegação",
   * 24/09/2026).
   */
  const comandar = useCallback(
    async (tarefaId: number, corpo: Record<string, unknown>): Promise<boolean> => {
      setOcupado(true)
      setErroComando(null)
      try {
        const r = await fetch(`/api/tarefas/${tarefaId}/comando`, {
          method: "POST",
          headers: auth(),
          body: JSON.stringify(corpo),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) {
          // O CÓDIGO IMPORTA para quem lê. "Não foi possível" não diz se falta
          // permissão, se alguém chegou antes ou se o servidor caiu.
          const porStatus: Record<number, string> = {
            401: "Sua sessão expirou. Entre de novo.",
            403: "Você não tem permissão para esta ação.",
            409: "Esta tarefa foi alterada por outra pessoa. A lista foi atualizada.",
            422: d.error ?? "A ação não é válida para o estado atual desta tarefa.",
          }
          setErroComando(porStatus[r.status] ?? d.error ?? `Não foi possível concluir a ação (HTTP ${r.status}).`)
          await recarregarAgora()
          return false
        }
        // ESPERA a lista nova. Sem isto o ato "terminava" antes de a tela mudar.
        await recarregarAgora()
        setRecarga((n) => n + 1) // também atualiza KPIs e opções de filtro
        return true
      } catch {
        // FALHA DE REDE NÃO É SILÊNCIO. O comando pode ter chegado ao servidor e
        // só a resposta ter se perdido — por isso relemos antes de acusar.
        const lista = await recarregarAgora()
        setErroComando(
          lista == null
            ? "Falha de rede. Verifique a conexão e tente novamente."
            : "A resposta do servidor não chegou. A lista foi atualizada — confira o estado da tarefa.",
        )
        return false
      } finally {
        setOcupado(false)
      }
    },
    [recarregarAgora],
  )

  // A NATUREZA da tarefa muda a APRESENTAÇÃO, nunca o fato de que é trabalho
  // real do usuário: a obrigação administrativa vira CARTÃO próprio (O QUE/
  // ONDE/SITUAÇÃO/AÇÃO), nunca uma linha genérica da tabela operacional —
  // por isso sai do pipeline de categoria/tabela/paginação abaixo, mas
  // continua vindo da MESMA `linhas` (mesma `/api/operacao/tarefas`).
  const linhasAdministrativas = useMemo(() => linhas?.filter((l) => l.origem === ORIGEM_OBRIGACAO_ATRIBUICAO) ?? [], [linhas])
  // `null` preservado (nunca `[]`) — o pipeline de categoria/tabela abaixo
  // distingue "ainda carregando" de "carregou e está vazio" por isto.
  const linhasNormais = useMemo(() => (linhas ? linhas.filter((l) => l.origem !== ORIGEM_OBRIGACAO_ATRIBUICAO) : null), [linhas])

  // ── OPÇÕES DOS FILTROS — de um universo ESTÁVEL (fetch próprio, sem
  // filtro), nunca do resultado já filtrado — senão escolher uma fase faria
  // as outras fases desaparecerem do próprio seletor de fase.
  const [universo, setUniverso] = useState<LinhaOperacional[] | null>(null)
  useEffect(() => {
    let vivo = true
    fetch(`/api/operacao/tarefas?visao=minha_fila`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { linhas?: LinhaOperacional[] }) => { if (vivo) setUniverso(d.linhas ?? []) })
      .catch(() => { if (vivo) setUniverso([]) })
    return () => { vivo = false }
  }, [recarga])
  const opcoesFase = useMemo(() => {
    const vistos = new Map<string, string>()
    for (const l of universo ?? []) if (l.faseMacroKey) vistos.set(l.faseMacroKey, rotularFase(l.faseMacroKey) ?? l.faseMacroKey)
    return [...vistos.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [universo])
  const opcoesTerceiro = useMemo(() => {
    const vistos = new Set<string>()
    for (const l of universo ?? []) if (l.terceiroNome) vistos.add(l.terceiroNome)
    return [...vistos].sort((a, b) => a.localeCompare(b))
  }, [universo])
  const opcoesEtapa = useMemo(() => {
    const vistos = new Set<string>()
    for (const l of universo ?? []) if (l.etapaAtual) vistos.add(l.etapaAtual)
    return [...vistos].sort((a, b) => a.localeCompare(b))
  }, [universo])
  const opcoesPrioridade = useMemo(() => {
    const vistos = new Set<string>()
    for (const l of universo ?? []) vistos.add(l.prioridade)
    return [...vistos].sort((a, b) => (ROTULO_PRIORIDADE[a] ?? a).localeCompare(ROTULO_PRIORIDADE[b] ?? b))
  }, [universo])

  // KPI "Concluídas hoje" + badge por família — universo À PARTE (minhaFila
  // exclui concluída de propósito), sempre do usuário do token.
  const [concluidasHoje, setConcluidasHoje] = useState<LinhaOperacional[] | null>(null)
  useEffect(() => {
    let vivo = true
    fetch(`/api/operacao/tarefas?visao=concluidas_hoje`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { linhas?: LinhaOperacional[] }) => { if (vivo) setConcluidasHoje(d.linhas ?? []) })
      .catch(() => { if (vivo) setConcluidasHoje([]) })
    return () => { vivo = false }
  }, [recarga])
  const concluidasPorProcesso = useMemo(() => {
    const mapa = new Map<number, number>()
    for (const l of concluidasHoje ?? []) {
      if (l.processoId == null) continue
      mapa.set(l.processoId, (mapa.get(l.processoId) ?? 0) + 1)
    }
    return mapa
  }, [concluidasHoje])

  // ── AS CONTAGENS DE FILA — MESMO UNIVERSO da tabela (mandato "fila real de
  // trabalho", 17/09/2026): sobre o resultado JÁ FILTRADO pelo servidor
  // (fase/terceiro/prazo/busca), nunca sobre o universo total. EXCLUSIVA —
  // `classificarAtencaoOperacional` devolve UMA fila por tarefa (nunca
  // "Para fazer" E "Aguardando terceiros" ao mesmo tempo), porque o
  // contador de cada fila PRECISA fechar com o que a própria fila lista.
  const porCategoria = useMemo(() => {
    const mapa = new Map<CategoriaAtencao, LinhaOperacional[]>(CATEGORIAS_ATENCAO.map((c) => [c.chave, []]))
    for (const l of linhasNormais ?? []) {
      const c = classificarAtencaoOperacional(l)
      if (c !== "outras") mapa.get(c)?.push(l)
    }
    return mapa
  }, [linhasNormais])

  const filtradas = useMemo(() => {
    if (!linhasNormais) return null
    let base = categoria === "todas" ? linhasNormais : linhasNormais.filter((l) => classificarAtencaoOperacional(l) === categoria)
    if (filtros.etapa) base = base.filter((l) => l.etapaAtual === filtros.etapa)
    if (filtros.prioridade) base = base.filter((l) => l.prioridade === filtros.prioridade)
    return base
  }, [linhasNormais, categoria, filtros.etapa, filtros.prioridade])

  const ordenadas = useMemo(() => (filtradas ? ordenarPorAtencaoOperacional(filtradas) : null), [filtradas])

  // ── AGRUPAMENTO POR FAMÍLIA/PROCESSO — item 11/13 do mandato 17/09/2026:
  // "não quero uma experiência interminável" quando o usuário tem várias
  // famílias com muitas tarefas cada. Projeção VISUAL sobre a MESMA lista já
  // filtrada/ordenada — as tarefas continuam individuais e canônicas; só a
  // apresentação principal passa a ser por contexto, com a família do
  // deep-link já expandida.
  const grupos = useMemo<GrupoOperacional[] | null>(() => {
    if (!ordenadas) return null
    const mapa = new Map<string, GrupoOperacional>()
    const pessoasPorGrupo = new Map<string, Set<number>>()
    for (const l of ordenadas) {
      const chave = l.processoId != null ? String(l.processoId) : "sem-processo"
      let g = mapa.get(chave)
      if (!g) {
        g = {
          chave,
          processoId: l.processoId,
          faseMacroKey: l.faseMacroKey,
          rotuloPrincipal: l.familiaNome ?? l.processoNome ?? "Sem processo vinculado",
          rotuloSecundario: l.familiaNome && l.processoNome ? l.processoNome : null,
          linhas: [], pessoas: 0, paraFazer: 0, acompanhar: 0, atrasadas: 0,
          terceirosAtrasados: 0, concluidas: 0, proximoPrazo: null,
        }
        mapa.set(chave, g)
        pessoasPorGrupo.set(chave, new Set())
      }
      g.linhas.push(l)
      if (l.pessoaId != null) pessoasPorGrupo.get(chave)!.add(l.pessoaId)
      const c = classificarAtencaoOperacional(l)
      if (c === "paraAgirAgora") g.paraFazer++
      else if (c === "acompanharHoje") g.acompanhar++
      else if (c === "terceirosAtrasados") g.terceirosAtrasados++
      if (l.atrasada) g.atrasadas++
      if (l.dataPrazo && (g.proximoPrazo == null || l.dataPrazo < g.proximoPrazo)) g.proximoPrazo = l.dataPrazo
    }
    for (const g of mapa.values()) {
      g.pessoas = pessoasPorGrupo.get(g.chave)?.size ?? 0
      g.concluidas = g.processoId != null ? concluidasPorProcesso.get(g.processoId) ?? 0 : 0
    }
    // O pior sinal primeiro — mesmo princípio do ranking de atenção, agora
    // agregado: quem tem atraso aparece antes de quem só tem prazo distante.
    return [...mapa.values()].sort((a, b) => {
      if (a.atrasadas !== b.atrasadas) return b.atrasadas - a.atrasadas
      const pa = a.proximoPrazo ? Date.parse(a.proximoPrazo) : Number.POSITIVE_INFINITY
      const pb = b.proximoPrazo ? Date.parse(b.proximoPrazo) : Number.POSITIVE_INFINITY
      return pa - pb
    })
  }, [ordenadas, concluidasPorProcesso])

  const alternarGrupo = (chave: string) => setExpandidos((prev) => {
    const novo = new Set(prev)
    if (novo.has(chave)) novo.delete(chave); else novo.add(chave)
    return novo
  })

  const alternarSelecaoLote = (taskId: number) => setSelecionadosLote((prev) => {
    const novo = new Set(prev)
    if (novo.has(taskId)) novo.delete(taskId); else novo.add(taskId)
    return novo
  })
  const alternarTodosNaFamilia = (ids: number[], todasMarcadas: boolean) => setSelecionadosLote((prev) => {
    const novo = new Set(prev)
    if (todasMarcadas) ids.forEach((id) => novo.delete(id))
    else ids.forEach((id) => novo.add(id))
    return novo
  })

  // ── ATRIBUIÇÃO EM LOTE — mesma porta de sempre (`POST /api/tarefas/{id}/
  // comando`), chamada uma vez por tarefa selecionada (mandato "Seleção em
  // massa": lote chama a porta de UMA linha, nunca uma porta paralela).
  const linhasSelecionadasLote = useMemo(
    () => (ordenadas ?? []).filter((l) => selecionadosLote.has(l.taskId)),
    [ordenadas, selecionadosLote],
  )
  const atribuirLote = async (responsavelId: number) => {
    setLoteOcupado(true)
    setLoteErro(null)
    let falhas = 0
    for (const l of linhasSelecionadasLote) {
      try {
        const r = await fetch(`/api/tarefas/${l.taskId}/comando`, {
          method: "POST",
          headers: auth(),
          body: JSON.stringify({ acao: l.responsavelId == null ? "atribuir" : "transferir", responsavelId }),
        })
        if (!r.ok) falhas++
      } catch {
        falhas++
      }
    }
    setLoteOcupado(false)
    if (falhas > 0) {
      setLoteErro(`${falhas} tarefa${falhas === 1 ? "" : "s"} não pôde${falhas === 1 ? "" : "ram"} ser atribuída${falhas === 1 ? "" : "s"}.`)
      return
    }
    setLoteAberto(false)
    setSelecionadosLote(new Set())
    setRecarga((n) => n + 1)
  }

  const totalPaginas = Math.max(1, Math.ceil((grupos?.length ?? 0) / POR_PAGINA_GRUPOS))
  const paginaValida = Math.min(Math.max(pagina, 1), totalPaginas)
  const gruposVisiveis = grupos?.slice((paginaValida - 1) * POR_PAGINA_GRUPOS, paginaValida * POR_PAGINA_GRUPOS) ?? null

  // O rótulo da fila ATIVA no cabeçalho do grupo — "N tarefas · Aguardando
  // terceiros", nunca hardcoded "a fazer" pra QUALQUER fila (era o defeito
  // real da Grisotto: 3 tarefas aguardando cartório anunciadas como "3
  // tarefas a fazer" só porque o rótulo do cabeçalho nunca olhava a fila).
  const rotuloFilaAtiva = categoria === "todas" ? null : CATEGORIAS_ATENCAO.find((c) => c.chave === categoria)?.rotulo ?? null

  const temFiltro = filtros.busca.trim() !== "" || filtros.fase != null || filtros.etapa != null || filtros.prioridade != null || filtros.terceiro != null || filtros.prazo !== "todos" || categoria !== "paraAgirAgora"
  const limparFiltros = () => { setFiltros(SEM_FILTRO); setBuscaDigitada(""); setCategoria("paraAgirAgora"); setPagina(1) }

  /**
   * ONDE O TRABALHO ACONTECE — Minha Operação não executa. O deep-link
   * canônico leva ao processo, na Central, no documento e na etapa daquela
   * tarefa — a MESMA função que o Kanban, a visão global e as notificações
   * usam. Nunca uma rota própria.
   */
  const abrirOTrabalho = useCallback((l: LinhaOperacional) => {
    router.push(urlOperacionalDaTarefa({ taskId: l.taskId, processoId: l.processoId }))
  }, [router])

  /**
   * A AÇÃO PRINCIPAL DA LINHA — assumir e ir trabalhar, no mesmo gesto.
   *
   *   INICIAR    assume o trabalho e LEVA à etapa. Quem clica "Iniciar tarefa"
   *              está indo trabalhar agora; parar na fila obrigaria um
   *              segundo clique para chegar onde o trabalho acontece.
   *   CONTINUAR  só navega. Não reinicia nada, não escreve nada.
   *
   * A NAVEGAÇÃO SÓ ACONTECE DEPOIS DO SUCESSO CONFIRMADO — navegar junto com
   * o pedido (ou apesar dele) levaria a pessoa para a etapa acreditando que
   * assumiu um trabalho que continuou de ninguém (achado real: a versão
   * anterior desta tela só navegava, nunca comandava — "Iniciar" só existia
   * na Central, um clique a mais para todo mundo, sempre).
   */
  const irParaOTrabalho = useCallback(async (l: LinhaOperacional) => {
    const acao = acaoPrincipal(l)
    if (acao.comando === "iniciar") {
      const ok = await comandar(l.taskId, { acao: "iniciar" })
      if (!ok) return
    }
    abrirOTrabalho(l)
  }, [comandar, abrirOTrabalho])

  const primeiroNome = usuario?.nome?.trim().split(/\s+/)[0]

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface-page)]">
      {/* ── CABEÇALHO ── */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-6 py-5">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-primary)]">
            {primeiroNome ? `Olá, ${primeiroNome}!` : "Minha Operação"}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">Aqui está tudo o que precisa da sua atenção agora.</p>
        </div>
        <div className="relative w-full max-w-sm sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input
            value={buscaDigitada}
            onChange={(e) => setBuscaDigitada(e.target.value)}
            placeholder="Buscar por pessoa, processo, documento, cartório…"
            className="h-9 bg-[var(--surface-elevated)] pl-8 text-[13px]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-6 py-4">
        <div className="flex h-full min-h-0 gap-4">
          <div className={`flex min-h-0 min-w-0 flex-1 flex-col gap-3 ${selecionado != null ? "hidden lg:flex" : ""}`}>
            {/* O QUE ACONTECEU AO COMANDAR — nunca falha silenciosa. Antes de
                existir, um 403/409/rede perdida no "Iniciar tarefa" não
                aparecia em lugar nenhum: a pessoa clicava, nada mudava, e o
                botão parecia morto. */}
            {erroComando && (
              <div
                role="alert"
                className="flex items-start justify-between gap-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger-tile)] px-3.5 py-2.5 text-[12px] text-[var(--danger-text)]"
              >
                <span>{erroComando}</span>
                <button
                  onClick={() => setErroComando(null)}
                  className="shrink-0 text-[var(--danger-text)]/70 transition-colors hover:text-[var(--danger-text)]"
                  aria-label="Fechar aviso de erro"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* ── OBRIGAÇÕES ADMINISTRATIVAS — cartão próprio, sempre visível
                independente da categoria/filtro ativo na tabela abaixo (a
                tabela é só para tarefas NORMAL/TRANSVERSAL). "Se existe uma
                tarefa canônica ativa atribuída a mim que exige uma ação
                minha, eu preciso encontrá-la em Minha Operação." ── */}
            {linhasAdministrativas.length > 0 && (
              <div className="flex flex-col gap-2">
                {linhasAdministrativas.map((l) => <CartaoObrigacaoAdministrativa key={l.taskId} l={l} />)}
              </div>
            )}

            {/* ── LADRILHOS DE ATENÇÃO — 6 tiles (mandato "tela de Operação",
                24/09/2026): as 5 categorias já canônicas de
                `atencao-operacional.ts` + "Concluídas hoje" (universo
                separado, `minhaFila` exclui CONCLUIDA de propósito). Clicar
                num ladrilho filtra a tabela abaixo pela mesma categoria —
                "Concluídas hoje" é só informativo (não tem linha própria no
                pipeline de categoria). ── */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <button
                onClick={() => { setCategoria("todas"); setPagina(1) }}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  categoria === "todas"
                    ? "border-[var(--action-primary)] bg-[var(--surface-elevated)]"
                    : "border-[var(--border-subtle)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-secondary)]"
                }`}
              >
                <div className="text-[20px] font-semibold tabular-nums text-[var(--text-primary)]">{linhasNormais?.length ?? 0}</div>
                <div className="text-[11.5px] font-medium text-[var(--text-primary)]">Todas</div>
                <div className="text-[10px] text-[var(--text-muted)]">Toda a sua fila</div>
              </button>
              {CATEGORIAS_ATENCAO.map((c) => {
                const Icone = ICONE_CATEGORIA[c.chave]
                const n = porCategoria.get(c.chave)?.length ?? 0
                const ativo = categoria === c.chave
                return (
                  <button
                    key={c.chave}
                    title={c.tooltip}
                    onClick={() => { setCategoria(ativo ? "todas" : c.chave); setPagina(1) }}
                    className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      ativo
                        ? "border-[var(--action-primary)] bg-[var(--surface-elevated)]"
                        : "border-[var(--border-subtle)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-secondary)]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Icone className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                      <span className="text-[20px] font-semibold tabular-nums text-[var(--text-primary)]">{n}</span>
                    </div>
                    <div className="text-[11.5px] font-medium text-[var(--text-primary)]">{c.rotulo}</div>
                    <div className="truncate text-[10px] text-[var(--text-muted)]">{c.tooltip}</div>
                  </button>
                )
              })}
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2.5 text-left">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success-text)]" />
                  <span className="text-[20px] font-semibold tabular-nums text-[var(--text-primary)]">{concluidasHoje?.length ?? 0}</span>
                </div>
                <div className="text-[11.5px] font-medium text-[var(--text-primary)]">Concluídas hoje</div>
                <div className="truncate text-[10px] text-[var(--text-muted)]">Tarefas finalizadas</div>
              </div>
            </div>

            {/* ── FILTROS — item 10, + Etapa atual/Prioridade (client-side) ── */}
            <div className="flex flex-wrap items-end gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2.5">
              <Campo rotulo="Fase">
                <Select value={filtros.fase ?? TODOS} onValueChange={(v) => { setFiltros((f) => ({ ...f, fase: v === TODOS ? null : v })); setPagina(1) }}>
                  <SelectTrigger className="h-8 w-40 bg-[var(--surface-elevated)] text-[12px]"><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent className={Z_POPOVER}>
                    <SelectItem value={TODOS}>Todas as fases</SelectItem>
                    {opcoesFase.map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo rotulo="Etapa atual">
                <Select value={filtros.etapa ?? TODOS} onValueChange={(v) => { setFiltros((f) => ({ ...f, etapa: v === TODOS ? null : v })); setPagina(1) }}>
                  <SelectTrigger className="h-8 w-40 bg-[var(--surface-elevated)] text-[12px]"><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent className={Z_POPOVER}>
                    <SelectItem value={TODOS}>Todas as etapas</SelectItem>
                    {opcoesEtapa.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo rotulo="Prioridade">
                <Select value={filtros.prioridade ?? TODOS} onValueChange={(v) => { setFiltros((f) => ({ ...f, prioridade: v === TODOS ? null : v })); setPagina(1) }}>
                  <SelectTrigger className="h-8 w-32 bg-[var(--surface-elevated)] text-[12px]"><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent className={Z_POPOVER}>
                    <SelectItem value={TODOS}>Todas</SelectItem>
                    {opcoesPrioridade.map((p) => <SelectItem key={p} value={p}>{ROTULO_PRIORIDADE[p] ?? p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo rotulo="Terceiro">
                <Select value={filtros.terceiro ?? TODOS} onValueChange={(v) => { setFiltros((f) => ({ ...f, terceiro: v === TODOS ? null : v })); setPagina(1) }}>
                  <SelectTrigger className="h-8 w-40 bg-[var(--surface-elevated)] text-[12px]"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent className={Z_POPOVER}>
                    <SelectItem value={TODOS}>Todos os terceiros</SelectItem>
                    {opcoesTerceiro.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo rotulo="Prazo">
                <Select value={filtros.prazo} onValueChange={(v) => { setFiltros((f) => ({ ...f, prazo: v as Filtros["prazo"] })); setPagina(1) }}>
                  <SelectTrigger className="h-8 w-36 bg-[var(--surface-elevated)] text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent className={Z_POPOVER}>
                    <SelectItem value="todos">Qualquer prazo</SelectItem>
                    <SelectItem value="atrasadas">Atrasadas</SelectItem>
                    <SelectItem value="hoje">Vencem hoje</SelectItem>
                    <SelectItem value="7dias">Vencem em 7 dias</SelectItem>
                  </SelectContent>
                </Select>
              </Campo>
              <button
                onClick={() => setMaisFiltros((v) => !v)}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)]"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" /> Mais filtros
              </button>
              {temFiltro && (
                <button onClick={limparFiltros} className="flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]">
                  <XIcon className="h-3.5 w-3.5" /> Limpar filtros
                </button>
              )}
              <div className="ml-auto flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] p-0.5">
                <button
                  onClick={() => setVisaoModo("familia")}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[12px] font-medium transition-colors ${visaoModo === "familia" ? "bg-[var(--action-primary)] text-[var(--action-primary-ink)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"}`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" /> Visão por família
                </button>
                <button
                  onClick={() => setVisaoModo("lista")}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[12px] font-medium transition-colors ${visaoModo === "lista" ? "bg-[var(--action-primary)] text-[var(--action-primary-ink)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"}`}
                >
                  <List className="h-3.5 w-3.5" /> Visão por lista
                </button>
              </div>
            </div>

            {podeAtribuirLote && selecionadosLote.size > 0 && (
              <div className="flex items-center gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-secondary)] px-3.5 py-2 shadow-[var(--elev-1)]">
                <span className="text-[12px] font-semibold text-[var(--text-primary)]">{selecionadosLote.size} selecionada{selecionadosLote.size === 1 ? "" : "s"}</span>
                <button
                  onClick={() => setLoteAberto(true)}
                  className="rounded-md bg-[var(--action-primary)] px-3 py-1.5 text-[12px] font-medium text-[var(--action-primary-ink)] transition-opacity hover:opacity-90"
                >
                  Atribuir selecionadas
                </button>
                <button onClick={() => setSelecionadosLote(new Set())} className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  Limpar seleção
                </button>
              </div>
            )}

            {/* ── TABELA — item 13, "Visão por família" (padrão) ou "Visão por lista" (chata) ── */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
              {falhou && <Estado tipo="erro" mensagem="Não foi possível carregar sua operação." aoTentar={() => setRecarga((n) => n + 1)} />}
              {carregando && <Estado tipo="carregando" mensagem="Carregando sua operação…" />}
              {!carregando && !falhou && gruposVisiveis?.length === 0 && (
                <Estado
                  tipo="vazio"
                  mensagem={
                    temFiltro
                      ? "Nenhuma operação corresponde aos filtros selecionados."
                      : linhasAdministrativas.length > 0
                        ? "Nenhuma tarefa operacional pendente — veja a obrigação administrativa acima."
                        : "Nenhuma operação exige sua atenção agora."
                  }
                />
              )}

              {visaoModo === "lista" && !carregando && !falhou && ordenadas != null && ordenadas.length > 0 && (
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="w-full border-collapse text-left">
                    <thead className="sticky top-0 z-10 bg-[var(--surface-overlay)]">
                      <tr className="border-b border-[var(--border-subtle)] [&>th]:px-3 [&>th]:py-2 [&>th]:text-[10px] [&>th]:font-medium [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-[var(--text-muted)]">
                        {podeAtribuirLote && <th className="w-8" />}
                        <th>Atenção</th>
                        <th>Pessoa</th>
                        <th>Documento / Tarefa</th>
                        <th>Fase</th>
                        <th>Etapa atual</th>
                        <th>Prazo</th>
                        <th>Prioridade</th>
                        <th>Situação</th>
                        <th>Terceiro</th>
                        <th className="w-24">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordenadas.map((l) => (
                        <LinhaOperacaoTabela
                          key={l.taskId}
                          l={l}
                          selecionado={selecionado === l.taskId}
                          aoSelecionar={() => setSelecionado(l.taskId)}
                          aoExecutar={() => void irParaOTrabalho(l)}
                          ocupado={ocupado}
                          marcado={selecionadosLote.has(l.taskId)}
                          aoMarcar={() => alternarSelecaoLote(l.taskId)}
                          mostrarSelecao={podeAtribuirLote}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {visaoModo === "familia" && gruposVisiveis != null && gruposVisiveis.length > 0 && (
                <div className="min-h-0 flex-1 overflow-auto divide-y divide-[var(--border-subtle)]">
                  {gruposVisiveis.map((g) => {
                    const aberto = expandidos.has(g.chave)
                    const verTodas = familiasVerTodas.has(g.chave)
                    const linhasVisiveis = verTodas ? g.linhas : g.linhas.slice(0, LINHAS_VISIVEIS_POR_FAMILIA)
                    const idsDaFamilia = g.linhas.map((l) => l.taskId)
                    const todasMarcadas = idsDaFamilia.length > 0 && idsDaFamilia.every((id) => selecionadosLote.has(id))
                    return (
                      <div key={g.chave}>
                        <button
                          onClick={() => alternarGrupo(g.chave)}
                          className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-secondary)]"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="w-3 shrink-0 text-[10px] text-[var(--text-muted)]">{aberto ? "▾" : "▸"}</span>
                            <div className="min-w-0">
                              <div className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{g.rotuloPrincipal}</div>
                              {g.rotuloSecundario && <div className="truncate text-[10.5px] text-[var(--text-muted)]">{g.rotuloSecundario}</div>}
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                                <span className="rounded-full bg-[var(--info-tile)] px-1.5 py-0.5 font-medium text-[var(--info-text)]">{g.paraFazer} para fazer</span>
                                <span className="rounded-full bg-[var(--warning-tile)] px-1.5 py-0.5 font-medium text-[var(--warning-text)]">{g.acompanhar} acompanhar</span>
                                <span className="rounded-full bg-[var(--danger-tile)] px-1.5 py-0.5 font-medium text-[var(--danger-text)]">{g.atrasadas} atrasadas</span>
                                <span className="rounded-full bg-[var(--warning-tile)] px-1.5 py-0.5 font-medium text-[var(--warning-text)]">{g.terceirosAtrasados} terceiros atrasados</span>
                                <span className="rounded-full bg-[var(--success-tile)] px-1.5 py-0.5 font-medium text-[var(--success-text)]">{g.concluidas} concluídas</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1 text-[11.5px] text-[var(--text-secondary)]">
                            <span className="tabular-nums">{g.pessoas} pessoa{g.pessoas === 1 ? "" : "s"} · {g.linhas.length} tarefa{g.linhas.length === 1 ? "" : "s"} no total</span>
                            {g.proximoPrazo && <span className="tabular-nums">Próximo prazo: {dataCurta(g.proximoPrazo)}</span>}
                          </div>
                        </button>
                        {aberto && (
                          <>
                            {podeAtribuirLote && (
                              <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] bg-[var(--surface-secondary)]/40 px-4 py-1.5">
                                <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                                  <input
                                    type="checkbox"
                                    checked={todasMarcadas}
                                    onChange={() => alternarTodosNaFamilia(idsDaFamilia, todasMarcadas)}
                                    className="h-3.5 w-3.5 accent-[var(--action-primary)]"
                                  />
                                  Selecionar todas ({idsDaFamilia.length})
                                </label>
                              </div>
                            )}
                            <table className="w-full border-collapse text-left">
                              <thead className="sticky top-0 z-10 bg-[var(--surface-overlay)]">
                                <tr className="border-b border-[var(--border-subtle)] [&>th]:px-3 [&>th]:py-2 [&>th]:text-[10px] [&>th]:font-medium [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-[var(--text-muted)]">
                                  {podeAtribuirLote && <th className="w-8" />}
                                  <th>Atenção</th>
                                  <th>Pessoa</th>
                                  <th>Documento / Tarefa</th>
                                  <th>Fase</th>
                                  <th>Etapa atual</th>
                                  <th>Prazo</th>
                                  <th>Prioridade</th>
                                  <th>Situação</th>
                                  <th>Terceiro</th>
                                  <th className="w-24">Ações</th>
                                </tr>
                              </thead>
                              <tbody>
                                {linhasVisiveis.map((l) => (
                                  <LinhaOperacaoTabela
                                    key={l.taskId}
                                    l={l}
                                    selecionado={selecionado === l.taskId}
                                    aoSelecionar={() => setSelecionado(l.taskId)}
                                    aoExecutar={() => void irParaOTrabalho(l)}
                                    ocupado={ocupado}
                                    marcado={selecionadosLote.has(l.taskId)}
                                    aoMarcar={() => alternarSelecaoLote(l.taskId)}
                                    mostrarSelecao={podeAtribuirLote}
                                  />
                                ))}
                              </tbody>
                            </table>
                            {g.linhas.length > LINHAS_VISIVEIS_POR_FAMILIA && (
                              <div className="border-t border-[var(--border-subtle)] px-4 py-2 text-[11px] text-[var(--text-secondary)]">
                                Mostrando {linhasVisiveis.length} de {g.linhas.length} tarefas ·{" "}
                                <button
                                  onClick={() => setFamiliasVerTodas((prev) => {
                                    const novo = new Set(prev)
                                    if (verTodas) novo.delete(g.chave); else novo.add(g.chave)
                                    return novo
                                  })}
                                  className="font-medium text-[var(--action-primary)] hover:underline"
                                >
                                  {verTodas ? "Mostrar menos" : `Ver todas as tarefas de ${g.rotuloPrincipal}`}
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {visaoModo === "familia" && grupos != null && grupos.length > 0 && (
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-3 py-2">
                  <span className="text-[11px] text-[var(--text-muted)]">
                    Total de famílias: {grupos.length} | Total de tarefas: {ordenadas?.length ?? 0} | Exibindo: {gruposVisiveis?.length ?? 0} famílias
                  </span>
                  {totalPaginas > 1 && (
                    <div className="flex items-center gap-2">
                      <button disabled={paginaValida <= 1} onClick={() => setPagina(paginaValida - 1)} className="rounded border border-[var(--border-default)] p-1 text-[var(--text-secondary)] disabled:opacity-40">
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <span className="text-[11px] tabular-nums text-[var(--text-primary)]">{paginaValida} / {totalPaginas}</span>
                      <button disabled={paginaValida >= totalPaginas} onClick={() => setPagina(paginaValida + 1)} className="rounded border border-[var(--border-default)] p-1 text-[var(--text-secondary)] disabled:opacity-40">
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── PAINEL DE DETALHE — item 21+ ── */}
          {selecionado != null && (
            <div className="flex w-full min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] lg:w-[420px]">
              <MinhaOperacaoDetalhe taskId={selecionado} aoFechar={() => setSelecionado(null)} />
            </div>
          )}
        </div>
      </div>

      {loteAberto && (
        <SeletorResponsavel
          titulo={`Atribuir ${linhasSelecionadasLote.length} tarefa${linhasSelecionadasLote.length === 1 ? "" : "s"}`}
          atual={null}
          ocupado={loteOcupado}
          erro={loteErro}
          aoFechar={() => { setLoteAberto(false); setLoteErro(null) }}
          aoEscolher={atribuirLote}
        />
      )}
    </div>
  )
}
