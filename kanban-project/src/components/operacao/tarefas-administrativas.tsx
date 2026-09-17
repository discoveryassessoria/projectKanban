// src/components/operacao/tarefas-administrativas.tsx
// ============================================================================
// TAREFAS ADMINISTRATIVAS — a visão gerencial das obrigações administrativas
// canônicas (tipo: ADMINISTRATIVA).
//
// NÃO é uma segunda fonte de verdade: lê `GET /api/operacao/visao-global`
// (a MESMA rota de "Tarefas e Projetos"), só filtrando `tipoTarefa:
// ["ADMINISTRATIVA"]`. Nenhum motor novo, nenhuma tabela nova — a tarefa
// administrativa já existe (lib/operacional/obrigacao-atribuicao.ts) e já
// aparece em Minha Operação/Tarefas e Projetos/Home/Sino pelos MESMOS
// mecanismos de qualquer Tarefa. Esta tela é só uma LEITURA especializada:
// "de todas as tarefas administrativas, quais precisam da minha atenção
// agora, e para onde eu vou para resolver cada uma".
//
// GENÉRICA POR DESENHO — hoje só existe UMA natureza de tarefa administrativa
// (`obrigacao-atribuicao`, "distribuir tarefas sem responsável"), mas a tela
// nunca hardcoda "distribuição" na estrutura: cada linha é projetada a partir
// de um CATÁLOGO indexado por `origem` (`CATALOGO_ADMINISTRATIVO` abaixo).
// Uma futura natureza (ex.: "revisar SLA estourado") só precisa de uma nova
// entrada nesse catálogo — a lista, os filtros e os indicadores continuam
// funcionando sem mudança.
// ============================================================================
"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, ArrowRight, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { auth, Estado, Etiqueta, ROTULO_STATUS } from "./kit-operacional"
import type { LinhaGerencial } from "@/lib/operacional/tarefa-projecoes"
import { urlDistribuicaoDoProcesso, urlOperacionalDaTarefa } from "@/lib/operacional/navegacao"

// `obrigacao-atribuicao.ts` importa o Prisma client em tempo de execução —
// não pode ser importado por um componente "use client" (o bundler arrastaria
// o motor todo pro browser). A chave é só um literal de leitura aqui; o dono
// da constante real continua sendo `lib/operacional/obrigacao-atribuicao.ts`
// (`ORIGEM_OBRIGACAO_ATRIBUICAO`) — este literal só precisa continuar igual.
const ORIGEM_OBRIGACAO_ATRIBUICAO = "obrigacao-atribuicao"

const TODOS = "todos"
const Z_POPOVER = "z-[10060]"
const CLASSE_SELECT = "w-full bg-[var(--surface-elevated)] text-[13px] data-[size=default]:h-9"

// ── CATÁLOGO POR ORIGEM — a ÚNICA parte desta tela que conhece uma natureza
// específica de tarefa administrativa. Tudo o resto (indicadores, filtros,
// busca, lista) é genérico sobre `LinhaGerencial`. ──────────────────────────
interface ContextoCatalogo {
  /** processoId -> quantas tarefas NORMAIS deste processo ainda estão sem responsável, AGORA. */
  semResponsavelPorProcesso: Map<number, number>
}
interface EntradaCatalogo {
  rotulo: string
  situacao: (linha: LinhaGerencial, ctx: ContextoCatalogo) => string
  link: (linha: LinhaGerencial) => string
}
const CATALOGO_ADMINISTRATIVO: Record<string, EntradaCatalogo> = {
  [ORIGEM_OBRIGACAO_ATRIBUICAO]: {
    rotulo: "Atribuir tarefas",
    situacao: (linha, ctx) => {
      const n = linha.processoId != null ? ctx.semResponsavelPorProcesso.get(linha.processoId) ?? 0 : 0
      return `${n} tarefa${n === 1 ? "" : "s"} aguardando distribuição`
    },
    link: (linha) => (linha.processoId != null ? urlDistribuicaoDoProcesso(linha.processoId) : urlOperacionalDaTarefa({ taskId: linha.taskId, processoId: linha.processoId })),
  },
}

/** Fallback GENÉRICO para uma origem que o catálogo ainda não conhece — nunca quebra, nunca esconde a linha. */
function projetarLinha(linha: LinhaGerencial, ctx: ContextoCatalogo) {
  const entrada = linha.origem ? CATALOGO_ADMINISTRATIVO[linha.origem] : undefined
  const concluida = linha.concluidaEm != null
  return {
    acao: entrada?.rotulo ?? linha.titulo,
    contexto: linha.familiaNome ? `${linha.familiaNome} · ${linha.processoNome ?? "—"}` : linha.processoNome ?? "—",
    situacao: entrada ? entrada.situacao(linha, ctx) : concluida ? "Concluída" : ROTULO_STATUS[linha.statusTarefa] ?? linha.statusTarefa,
    link: entrada ? entrada.link(linha) : urlOperacionalDaTarefa({ taskId: linha.taskId, processoId: linha.processoId }),
    rotuloTipo: entrada?.rotulo ?? (linha.origem ?? "Outra"),
  }
}

type StatusTela = "pendente" | "em_andamento" | "concluida"
function statusDaLinha(linha: LinhaGerencial): StatusTela {
  if (linha.concluidaEm != null) return "concluida"
  if (linha.statusTarefa === "EM_ANDAMENTO") return "em_andamento"
  return "pendente"
}
const ROTULO_STATUS_TELA: Record<StatusTela, string> = { pendente: "Pendente", em_andamento: "Em andamento", concluida: "Concluída" }
const TOM_STATUS_TELA: Record<StatusTela, "neutro" | "acento" | "sucesso"> = { pendente: "acento", em_andamento: "neutro", concluida: "sucesso" }

interface FiltrosTela {
  status: StatusTela | null
  origem: string | null
  responsavelId: number | null
  processoId: number | null
  busca: string
}
const FILTROS_VAZIOS: FiltrosTela = { status: null, origem: null, responsavelId: null, processoId: null, busca: "" }

function Tile({ rotulo, valor, tom }: { rotulo: string; valor: number; tom?: "alerta" }) {
  return (
    <div className="flex flex-1 flex-col gap-0.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 py-3">
      <span className={`text-xl font-semibold tabular-nums ${tom === "alerta" && valor > 0 ? "text-[var(--warning-text)]" : "text-[var(--text-primary)]"}`}>
        {valor}
      </span>
      <span className="text-[11px] font-medium text-[var(--text-secondary)]">{rotulo}</span>
    </div>
  )
}

export function TarefasAdministrativas() {
  const router = useRouter()
  const [todasLinhas, setTodasLinhas] = useState<LinhaGerencial[] | null>(null)
  const [falhou, setFalhou] = useState(false)
  const [recarga, setRecarga] = useState(0)
  const [semResponsavelPorProcesso, setSemResponsavelPorProcesso] = useState<Map<number, number>>(new Map())
  const [filtros, setFiltros] = useState<FiltrosTela>(FILTROS_VAZIOS)
  const [buscaDigitada, setBuscaDigitada] = useState("")

  // A LEITURA — a MESMA rota de Tarefas e Projetos, só recortada por tipo.
  // Volume esperado é baixo (no máximo uma obrigação aberta por processo por
  // natureza), então uma página só (500) sem paginação server-side é
  // suficiente e mantém a tela simples.
  useEffect(() => {
    let vivo = true
    setTodasLinhas(null)
    setFalhou(false)
    const p = new URLSearchParams({ incluirEncerradas: "1", porPagina: "500" })
    p.append("tipoTarefa", "ADMINISTRATIVA")
    fetch(`/api/operacao/visao-global?${p.toString()}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { linhas: LinhaGerencial[] }) => { if (vivo) setTodasLinhas(d.linhas) })
      .catch(() => { if (vivo) { setTodasLinhas([]); setFalhou(true) } })
    return () => { vivo = false }
  }, [recarga])

  // A CONTAGEM VIVA "sem responsável" por processo — nunca lida da própria
  // linha (ela nunca guarda esse número, de propósito: envelheceria). Uma
  // pequena consulta por processo com obrigação aberta, na MESMA leitura
  // (`semResponsavel=1&tipoTarefa=NORMAL`) que o chip da Central usa.
  useEffect(() => {
    if (!todasLinhas) return
    const processoIds = [...new Set(
      todasLinhas
        .filter((l) => l.origem === ORIGEM_OBRIGACAO_ATRIBUICAO && l.concluidaEm == null && l.processoId != null)
        .map((l) => l.processoId as number),
    )]
    if (processoIds.length === 0) { setSemResponsavelPorProcesso(new Map()); return }
    let vivo = true
    Promise.all(
      processoIds.map((id) => {
        const p = new URLSearchParams({ processo: String(id), semResponsavel: "1", porPagina: "1" })
        p.append("tipoTarefa", "NORMAL")
        return fetch(`/api/operacao/visao-global?${p.toString()}`, { headers: auth() })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((d: { total: number }) => [id, d.total] as const)
          .catch(() => [id, 0] as const)
      }),
    ).then((pares) => { if (vivo) setSemResponsavelPorProcesso(new Map(pares)) })
    return () => { vivo = false }
  }, [todasLinhas])

  useEffect(() => {
    const t = setTimeout(() => setFiltros((f) => ({ ...f, busca: buscaDigitada })), 250)
    return () => clearTimeout(t)
  }, [buscaDigitada])

  const ctx: ContextoCatalogo = useMemo(() => ({ semResponsavelPorProcesso }), [semResponsavelPorProcesso])

  const indicadores = useMemo(() => {
    const linhas = todasLinhas ?? []
    let pendentes = 0, emAndamento = 0, concluidas = 0, semResponsavel = 0
    for (const l of linhas) {
      const s = statusDaLinha(l)
      if (s === "pendente") pendentes++
      else if (s === "em_andamento") emAndamento++
      else concluidas++
      if (s !== "concluida" && l.responsavelId == null) semResponsavel++
    }
    return { pendentes, emAndamento, concluidas, semResponsavel }
  }, [todasLinhas])

  // ── OPÇÕES DE FILTRO — derivadas dos dados reais, nunca hardcoded: uma
  // origem nova aparece aqui automaticamente, sem precisar tocar esta tela. ──
  const opcoesOrigem = useMemo(() => {
    const vistos = new Map<string, string>()
    for (const l of todasLinhas ?? []) {
      const chave = l.origem ?? "outra"
      if (!vistos.has(chave)) vistos.set(chave, CATALOGO_ADMINISTRATIVO[chave]?.rotulo ?? (l.origem ?? "Outra"))
    }
    return [...vistos.entries()]
  }, [todasLinhas])
  const opcoesResponsavel = useMemo(() => {
    const vistos = new Map<number, string>()
    for (const l of todasLinhas ?? []) if (l.responsavelId != null) vistos.set(l.responsavelId, l.responsavelNome ?? `#${l.responsavelId}`)
    return [...vistos.entries()]
  }, [todasLinhas])
  const opcoesProcesso = useMemo(() => {
    const vistos = new Map<number, string>()
    for (const l of todasLinhas ?? []) {
      if (l.processoId == null) continue
      const rotulo = l.familiaNome ? `${l.familiaNome} · ${l.processoNome ?? "—"}` : l.processoNome ?? `#${l.processoId}`
      vistos.set(l.processoId, rotulo)
    }
    return [...vistos.entries()]
  }, [todasLinhas])

  const linhasFiltradas = useMemo(() => {
    const busca = filtros.busca.trim().toLowerCase()
    return (todasLinhas ?? []).filter((l) => {
      if (filtros.status != null && statusDaLinha(l) !== filtros.status) return false
      if (filtros.origem != null && (l.origem ?? "outra") !== filtros.origem) return false
      if (filtros.responsavelId != null && l.responsavelId !== filtros.responsavelId) return false
      if (filtros.processoId != null && l.processoId !== filtros.processoId) return false
      if (busca) {
        const alvo = `${l.titulo} ${l.processoNome ?? ""} ${l.familiaNome ?? ""} ${l.responsavelNome ?? ""}`.toLowerCase()
        if (!alvo.includes(busca)) return false
      }
      return true
    })
  }, [todasLinhas, filtros])

  const temFiltro = filtros.status != null || filtros.origem != null || filtros.responsavelId != null || filtros.processoId != null || filtros.busca.trim() !== ""
  const limparFiltros = () => { setFiltros(FILTROS_VAZIOS); setBuscaDigitada("") }

  return (
    <div className="flex flex-col gap-4">
      {/* ── INDICADORES COMPACTOS ── */}
      <div className="flex flex-wrap gap-2.5">
        <Tile rotulo="Pendentes" valor={indicadores.pendentes} />
        <Tile rotulo="Em andamento" valor={indicadores.emAndamento} />
        <Tile rotulo="Concluídas" valor={indicadores.concluidas} />
        <Tile rotulo="Sem responsável" valor={indicadores.semResponsavel} tom="alerta" />
      </div>

      {/* ── FILTROS ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input
            value={buscaDigitada}
            onChange={(e) => setBuscaDigitada(e.target.value)}
            placeholder="Buscar por tarefa, família, processo ou responsável…"
            className="h-9 bg-[var(--surface-primary)] pl-8 text-[13px]"
          />
        </div>
        <Select value={filtros.status ?? TODOS} onValueChange={(v) => setFiltros((f) => ({ ...f, status: v === TODOS ? null : (v as StatusTela) }))}>
          <SelectTrigger className={`${CLASSE_SELECT} w-[160px]`}><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent className={`bg-[var(--surface-overlay)] ${Z_POPOVER}`}>
            <SelectItem value={TODOS}>Todos os status</SelectItem>
            {(["pendente", "em_andamento", "concluida"] as const).map((s) => (
              <SelectItem key={s} value={s}>{ROTULO_STATUS_TELA[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filtros.origem ?? TODOS} onValueChange={(v) => setFiltros((f) => ({ ...f, origem: v === TODOS ? null : v }))}>
          <SelectTrigger className={`${CLASSE_SELECT} w-[200px]`}><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent className={`bg-[var(--surface-overlay)] ${Z_POPOVER}`}>
            <SelectItem value={TODOS}>Todos os tipos</SelectItem>
            {opcoesOrigem.map(([chave, rotulo]) => <SelectItem key={chave} value={chave}>{rotulo}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtros.responsavelId != null ? String(filtros.responsavelId) : TODOS} onValueChange={(v) => setFiltros((f) => ({ ...f, responsavelId: v === TODOS ? null : Number(v) }))}>
          <SelectTrigger className={`${CLASSE_SELECT} w-[180px]`}><SelectValue placeholder="Responsável" /></SelectTrigger>
          <SelectContent className={`bg-[var(--surface-overlay)] ${Z_POPOVER}`}>
            <SelectItem value={TODOS}>Todos os responsáveis</SelectItem>
            {opcoesResponsavel.map(([id, nome]) => <SelectItem key={id} value={String(id)}>{nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtros.processoId != null ? String(filtros.processoId) : TODOS} onValueChange={(v) => setFiltros((f) => ({ ...f, processoId: v === TODOS ? null : Number(v) }))}>
          <SelectTrigger className={`${CLASSE_SELECT} w-[220px]`}><SelectValue placeholder="Família/Processo" /></SelectTrigger>
          <SelectContent className={`bg-[var(--surface-overlay)] ${Z_POPOVER}`}>
            <SelectItem value={TODOS}>Todas as famílias/processos</SelectItem>
            {opcoesProcesso.map(([id, rotulo]) => <SelectItem key={id} value={String(id)}>{rotulo}</SelectItem>)}
          </SelectContent>
        </Select>
        {temFiltro && <Button variant="link" size="sm" onClick={limparFiltros} className="px-1 text-[var(--text-secondary)]">Limpar filtros</Button>}
      </div>

      {/* ── LISTA ── */}
      <div className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)]">
        {todasLinhas == null && <Estado tipo="carregando" mensagem="Carregando tarefas administrativas…" />}
        {falhou && <Estado tipo="erro" mensagem="Não foi possível carregar as tarefas administrativas." aoTentar={() => setRecarga((n) => n + 1)} />}
        {todasLinhas != null && !falhou && linhasFiltradas.length === 0 && (
          <Estado tipo="vazio" mensagem={temFiltro ? "Nenhuma tarefa administrativa bate com este filtro." : "Nenhuma tarefa administrativa em aberto — nada aguardando gestão agora."} />
        )}
        {todasLinhas != null && !falhou && linhasFiltradas.map((linha) => {
          const p = projetarLinha(linha, ctx)
          const status = statusDaLinha(linha)
          return (
            <div
              key={linha.taskId}
              role="button"
              tabIndex={0}
              onClick={() => router.push(p.link)}
              onKeyDown={(e) => { if (e.key === "Enter") router.push(p.link) }}
              className="flex cursor-pointer items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3 transition-colors last:border-b-0 hover:bg-[var(--surface-primary)]"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--info-tile)] text-[var(--info-text)]">
                <ShieldCheck className="h-4 w-4" />
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{p.acao}</p>
                <p className="truncate text-[11.5px] text-[var(--text-secondary)]">{p.contexto}</p>
              </div>

              <p className="hidden min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-secondary)] sm:block">{p.situacao}</p>

              <div className="hidden shrink-0 flex-col items-end gap-1 md:flex">
                <span className="text-[11.5px] text-[var(--text-secondary)]">
                  {linha.responsavelNome ? `Responsável: ${linha.responsavelNome}` : "Sem responsável"}
                </span>
                <Etiqueta tom={TOM_STATUS_TELA[status]}>{ROTULO_STATUS_TELA[status]}</Etiqueta>
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={(e) => { e.stopPropagation(); router.push(p.link) }}
                className="shrink-0 gap-1"
              >
                Abrir <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
