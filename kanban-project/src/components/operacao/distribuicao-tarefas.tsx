// src/components/operacao/distribuicao-tarefas.tsx
// ============================================================================
// DISTRIBUIÇÃO DE TAREFAS — a tela de quem decide de quem é o trabalho.
//
// Aberta a partir do cartão "Atribuir tarefas" de Minha Operação (mandato
// "tela de Distribuição própria, ultra fiel ao mockup", 24/09/2026) — tela
// PRÓPRIA, não a mesma superfície de Tarefas e Projetos.
//
// Mesmo princípio de sempre: PROJEÇÃO da Tarefa canônica, nenhuma tabela nova.
// A leitura vem de `GET /api/operacao/visao-global` (a MESMA que Tarefas e
// Projetos usa) — só o agrupamento e os ladrilhos de KPI são próprios desta
// tela. Toda escrita sai pela porta de sempre: `POST /api/tarefas/{id}/
// comando` e `POST /api/tarefas/redistribuir` (o lote canônico).
//
// HONESTIDADE DO MOCKUP (mandato "proibido inventar/mockar"): nem todo campo
// do desenho virou botão ligado —
//   · "Notificar o responsável"      → SEMPRE acontece (atribuirTarefa já
//                                       dispara a notificação); aqui fica
//                                       marcado e desabilitado, nunca uma
//                                       opção que finge controlar algo que já
//                                       é automático.
//   · "Mensagem (opcional)"          → vira o `motivo` do comando (mesmo
//                                       limite de 300 já usado no domínio).
//   · "Definir como prioridade alta" → chama `alterar_prioridade` de verdade
//                                       depois do atribuir.
//   · "Manter prazos originais"      → sempre verdadeiro (nenhum comando de
//                                       atribuição toca `dataPrazo`); fica
//                                       marcado e desabilitado.
//   · "Atribuir a novas tarefas que
//      surgirem nesta fase"          → exige um motor de regra persistente
//                                       que não existe ainda. Fica no desenho,
//                                       desabilitada, rotulada "em breve" —
//                                       nunca marcada como se already fizesse
//                                       algo.
// ============================================================================
"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ClipboardList, History, Search, ChevronDown, ChevronRight, Folder,
  MoreVertical, Download, SlidersHorizontal, X as XIcon, ChevronLeft, Users2, BarChart3,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  auth, dataCurta, Estado, Etiqueta, ROTULO_PRIORIDADE, rotularFase, useRotulosDeFaseProntos, SeletorResponsavel,
} from "./kit-operacional"
import type { LinhaGerencial } from "./visao-global"
import type { ColunaKanban } from "@/lib/operacional/tarefa-projecoes"

const Z_POPOVER = "z-[10060]"
const TODOS = "todos"
const LINHAS_VISIVEIS_POR_GRUPO = 5
const POR_PAGINA_GRUPOS = 5

const ROTULO_STATUS_LINHA: Record<ColunaKanban, string> = {
  SEM_RESPONSAVEL: "Sem responsável",
  A_FAZER: "Atribuída",
  EM_ANDAMENTO: "Em andamento",
  AGUARDANDO_TERCEIRO: "Aguardando terceiro",
  BLOQUEADA: "Bloqueada",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
}
const TOM_STATUS_LINHA: Record<ColunaKanban, "neutro" | "alerta" | "critico" | "acento" | "sucesso"> = {
  SEM_RESPONSAVEL: "neutro",
  A_FAZER: "acento",
  EM_ANDAMENTO: "acento",
  AGUARDANDO_TERCEIRO: "alerta",
  BLOQUEADA: "critico",
  CONCLUIDA: "sucesso",
  CANCELADA: "neutro",
}
const ORDEM_PRIORIDADE: Record<string, number> = { URGENTE: 0, ALTA: 1, MEDIA: 2, BAIXA: 3 }

// `obrigacao-atribuicao.ts` importa o Prisma client em tempo de execução —
// não pode ser importado por um componente "use client". O literal aqui só
// precisa continuar igual ao `ORIGEM_OBRIGACAO_ATRIBUICAO` daquele arquivo
// (mesmo padrão de `minha-operacao.tsx`). NUNCA `l.origem == null`: a maioria
// das tarefas normais também carrega uma `origem` real (ex.: "RECONCILIADOR")
// — o que se exclui aqui é só a obrigação administrativa, não "ter origem".
const ORIGEM_OBRIGACAO_ATRIBUICAO = "obrigacao-atribuicao"

function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase() || "?"
}

interface Funcionario {
  id: number
  nome: string
  email?: string
  tarefasAtivas: number
  atrasadas: number
}

type AgruparPor = "familia" | "fase" | "responsavel"

interface GrupoDistribuicao {
  chave: string
  processoId: number | null
  rotulo: string
  subtitulo: string | null
  linhas: LinhaGerencial[]
  total: number
  semResponsavel: number
  atribuidas: number
  emAndamento: number
  atrasadas: number
  prazoMaisProximo: string | null
  prioridadeMaisAlta: string | null
  responsaveis: { id: number; nome: string; qtd: number }[]
}

function construirGrupos(linhas: LinhaGerencial[], agruparPor: AgruparPor): GrupoDistribuicao[] {
  const chaveDe = (l: LinhaGerencial): string => {
    if (agruparPor === "fase") return l.faseMacroKey ?? "sem-fase"
    if (agruparPor === "responsavel") return l.responsavelId != null ? `u${l.responsavelId}` : "sem-responsavel"
    return l.processoId != null ? `p${l.processoId}` : "sem-processo"
  }
  const rotuloDe = (l: LinhaGerencial): string => {
    if (agruparPor === "fase") return rotularFase(l.faseMacroKey) ?? "Sem fase"
    if (agruparPor === "responsavel") return l.responsavelNome ?? "Sem responsável"
    return l.familiaNome ?? l.processoNome ?? "Sem processo vinculado"
  }
  const subtituloDe = (l: LinhaGerencial): string | null => {
    if (agruparPor === "familia") return l.familiaNome && l.processoNome ? l.processoNome : rotularFase(l.faseMacroKey)
    return null
  }

  const mapa = new Map<string, GrupoDistribuicao>()
  const respPorGrupo = new Map<string, Map<number, { nome: string; qtd: number }>>()
  const faseContagemPorGrupo = new Map<string, Map<string, number>>()

  for (const l of linhas) {
    const chave = chaveDe(l)
    let g = mapa.get(chave)
    if (!g) {
      g = {
        chave, processoId: l.processoId, rotulo: rotuloDe(l), subtitulo: subtituloDe(l),
        linhas: [], total: 0, semResponsavel: 0, atribuidas: 0, emAndamento: 0, atrasadas: 0,
        prazoMaisProximo: null, prioridadeMaisAlta: null, responsaveis: [],
      }
      mapa.set(chave, g)
      respPorGrupo.set(chave, new Map())
      faseContagemPorGrupo.set(chave, new Map())
    }
    g.linhas.push(l)
    g.total++
    if (l.coluna === "SEM_RESPONSAVEL") g.semResponsavel++
    if (l.coluna === "A_FAZER") g.atribuidas++
    if (l.coluna === "EM_ANDAMENTO") g.emAndamento++
    if (l.atrasada) g.atrasadas++
    if (l.dataPrazo && (g.prazoMaisProximo == null || l.dataPrazo < g.prazoMaisProximo)) g.prazoMaisProximo = l.dataPrazo
    if (g.prioridadeMaisAlta == null || (ORDEM_PRIORIDADE[l.prioridade] ?? 9) < (ORDEM_PRIORIDADE[g.prioridadeMaisAlta] ?? 9)) {
      g.prioridadeMaisAlta = l.prioridade
    }
    if (l.responsavelId != null) {
      const rm = respPorGrupo.get(chave)!
      const atual = rm.get(l.responsavelId)
      rm.set(l.responsavelId, { nome: l.responsavelNome ?? "—", qtd: (atual?.qtd ?? 0) + 1 })
    }
    if (agruparPor === "familia" && l.faseMacroKey) {
      const fm = faseContagemPorGrupo.get(chave)!
      fm.set(l.faseMacroKey, (fm.get(l.faseMacroKey) ?? 0) + 1)
    }
  }

  for (const g of mapa.values()) {
    g.responsaveis = [...respPorGrupo.get(g.chave)!.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.qtd - a.qtd)
    if (agruparPor === "familia") {
      const fases = faseContagemPorGrupo.get(g.chave)!
      const faseTopo = [...fases.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
      g.subtitulo = [rotularFase(faseTopo), `${g.total} tarefa${g.total === 1 ? "" : "s"}`].filter(Boolean).join(" · ")
    } else {
      g.subtitulo = `${g.total} tarefa${g.total === 1 ? "" : "s"}`
    }
  }

  // Pendência primeiro (quem tem "sem responsável" precisa de decisão), depois
  // atraso, depois prazo mais próximo — o mesmo princípio de priorização do
  // resto da operação, aplicado ao AGRUPAMENTO.
  return [...mapa.values()].sort((a, b) => {
    if ((a.semResponsavel > 0) !== (b.semResponsavel > 0)) return a.semResponsavel > 0 ? -1 : 1
    if (a.atrasadas !== b.atrasadas) return b.atrasadas - a.atrasadas
    const pa = a.prazoMaisProximo ? Date.parse(a.prazoMaisProximo) : Number.POSITIVE_INFINITY
    const pb = b.prazoMaisProximo ? Date.parse(b.prazoMaisProximo) : Number.POSITIVE_INFINITY
    return pa - pb
  })
}

function csvEscapar(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
function exportarCsv(linhas: LinhaGerencial[]) {
  const cabecalho = ["Família", "Pessoa", "Documento/Tarefa", "Fase", "Etapa atual", "Prazo", "Prioridade", "Responsável", "Status"]
  const corpo = linhas.map((l) => [
    l.familiaNome ?? l.processoNome ?? "—",
    l.pessoaNome ?? "—",
    l.titulo,
    rotularFase(l.faseMacroKey) ?? "—",
    l.etapaAtual ?? "—",
    dataCurta(l.dataPrazo),
    ROTULO_PRIORIDADE[l.prioridade] ?? l.prioridade,
    l.responsavelNome ?? "Sem responsável",
    ROTULO_STATUS_LINHA[l.coluna] ?? l.coluna,
  ].map((c) => csvEscapar(String(c))).join(","))
  const csv = [cabecalho.join(","), ...corpo].join("\n")
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `distribuicao-de-tarefas-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

interface Filtros {
  busca: string
  fase: string | null
  tipo: string | null
  prazo: "todos" | "atrasadas" | "hoje" | "7dias"
  status: ColunaKanban | null
  responsavel: string | null // "sem" | String(id) | null
}
const SEM_FILTRO: Filtros = { busca: "", fase: null, tipo: null, prazo: "todos", status: null, responsavel: null }

/**
 * SUCESSÃO EM MASSA (D5, mandato "grandes fluxos operacionais", 24/09/2026)
 * — quando alguém sai de férias/desliga, a carteira inteira precisa mudar de
 * dono de uma vez, não tarefa por tarefa. Busca TODAS as tarefas abertas da
 * origem (mesma leitura de `/api/operacao/visao-global`) e chama a MESMA
 * porta canônica de lote (`/api/tarefas/redistribuir`) — nenhum motor novo.
 */
function PainelSucessao({ funcionarios, aoFechar, aoConcluido }: {
  funcionarios: Funcionario[] | null
  aoFechar: () => void
  aoConcluido: () => void
}) {
  const [origemId, setOrigemId] = useState<number | "">("")
  const [destinoId, setDestinoId] = useState<number | "">("")
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{ sucesso: number; falha: number } | null>(null)

  const executar = async () => {
    if (!origemId || !destinoId) return
    if (origemId === destinoId) { setErro("Origem e destino não podem ser a mesma pessoa."); return }
    setOcupado(true)
    setErro(null)
    setResultado(null)
    try {
      const r = await fetch(`/api/operacao/visao-global?responsavel=${origemId}&porPagina=500`, { headers: auth() })
      if (!r.ok) throw new Error(String(r.status))
      const d: { linhas?: { taskId: number }[] } = await r.json()
      const ids = (d.linhas ?? []).map((l) => l.taskId)
      if (ids.length === 0) {
        setErro("Esta pessoa não tem tarefas abertas — nada para redistribuir.")
        setOcupado(false)
        return
      }
      const r2 = await fetch("/api/tarefas/redistribuir", {
        method: "POST", headers: auth(),
        body: JSON.stringify({ tarefaIds: ids, novoResponsavelId: destinoId, motivo: "Sucessão em massa" }),
      })
      const d2: { sucesso: number; falha: number } = await r2.json()
      if (!r2.ok && r2.status !== 207) throw new Error(String(r2.status))
      setResultado({ sucesso: d2.sucesso, falha: d2.falha })
      aoConcluido()
    } catch {
      setErro("Não foi possível concluir a sucessão agora.")
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-[var(--overlay-modal)] p-4" onClick={aoFechar}>
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--elev-3)]" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-[var(--border-subtle)] px-4 py-3">
          <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Sucessão em massa</h2>
          <p className="mt-0.5 text-[11.5px] text-[var(--text-secondary)]">Move TODAS as tarefas abertas de uma pessoa para outra, de uma vez — férias, afastamento, desligamento.</p>
        </div>
        <div className="p-4">
          {erro && <div className="mb-3 rounded border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2.5 py-1.5 text-[11px] text-[var(--danger-text)]">{erro}</div>}
          {resultado && (
            <div className="mb-3 rounded border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2.5 py-1.5 text-[11px] text-[var(--success-text)]">
              {resultado.sucesso} tarefa{resultado.sucesso === 1 ? "" : "s"} movida{resultado.sucesso === 1 ? "" : "s"}{resultado.falha > 0 ? `, ${resultado.falha} falhou/falharam` : ""}.
            </div>
          )}
          <label className="block text-[11px] font-medium text-[var(--text-secondary)]">De (sai de férias/desliga)</label>
          <select
            value={origemId}
            onChange={(e) => setOrigemId(e.target.value ? Number(e.target.value) : "")}
            className="mt-1 w-full rounded border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)]"
          >
            <option value="">Selecione…</option>
            {funcionarios?.map((f) => <option key={f.id} value={f.id}>{f.nome} ({f.tarefasAtivas} ativas)</option>)}
          </select>
          <label className="mt-3 block text-[11px] font-medium text-[var(--text-secondary)]">Para (recebe a carteira)</label>
          <select
            value={destinoId}
            onChange={(e) => setDestinoId(e.target.value ? Number(e.target.value) : "")}
            className="mt-1 w-full rounded border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)]"
          >
            <option value="">Selecione…</option>
            {funcionarios?.map((f) => <option key={f.id} value={f.id}>{f.nome} ({f.tarefasAtivas} ativas)</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] px-4 py-2.5">
          <button onClick={aoFechar} className="rounded px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Fechar</button>
          <button
            disabled={ocupado || !origemId || !destinoId}
            onClick={() => void executar()}
            className="rounded bg-[var(--action-primary)] px-3 py-1.5 text-[11px] font-medium text-[var(--action-primary-ink)] disabled:opacity-40"
          >
            {ocupado ? "Movendo…" : "Mover toda a carteira"}
          </button>
        </div>
      </div>
    </div>
  )
}

interface AnalyticsResposta {
  periodoSemanas: number
  throughputPorSemana: { semana: string; concluidas: number }[]
  gargaloPorFase: { faseMacroKey: string; tempoMedioDias: number; quantidade: number }[]
  performanceTerceiro: { terceiro: string; tempoMedioDias: number; quantidade: number }[]
  capacidade: {
    backlogAtual: number
    mediaCriadasPorSemana: number
    mediaConcluidasPorSemana: number
    semanasParaZerarBacklog: number | null
    tendenciaSaudavel: boolean
  }
}

/**
 * ANALYTICS OPERACIONAL (D1-D4, mandato "grandes fluxos operacionais",
 * 24/09/2026) — a primeira vez que o sistema olha throughput, gargalo por
 * etapa, performance de terceiro e capacidade, em vez de só fotografar o
 * agora. Fonte única: `GET /api/operacao/analytics`.
 */
function PainelAnalytics({ aoFechar }: { aoFechar: () => void }) {
  const [dado, setDado] = useState<AnalyticsResposta | null>(null)
  const [falhou, setFalhou] = useState(false)
  useEffect(() => {
    let vivo = true
    fetch("/api/operacao/analytics", { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: AnalyticsResposta) => { if (vivo) setDado(d) })
      .catch(() => { if (vivo) setFalhou(true) })
    return () => { vivo = false }
  }, [])
  const maiorThroughput = Math.max(1, ...(dado?.throughputPorSemana.map((p) => p.concluidas) ?? [1]))

  return (
    <div className="fixed inset-0 z-[10000] flex items-stretch justify-end bg-[var(--overlay-modal)]" onClick={aoFechar}>
      <div className="flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--elev-3)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Analytics da operação</h2>
            <p className="text-[11px] text-[var(--text-secondary)]">Últimas {dado?.periodoSemanas ?? 8} semanas · operação inteira</p>
          </div>
          <button onClick={aoFechar} className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"><XIcon className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {falhou && <Estado tipo="erro" mensagem="Não foi possível carregar os analytics." />}
          {!falhou && dado == null && <Estado tipo="carregando" mensagem="Carregando analytics…" />}
          {dado && (
            <>
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Capacidade</h3>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-page)] px-3 py-2.5">
                  <div className="text-[18px] font-semibold tabular-nums text-[var(--text-primary)]">{dado.capacidade.backlogAtual}</div>
                  <div className="text-[10.5px] text-[var(--text-muted)]">Backlog aberto agora</div>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-page)] px-3 py-2.5">
                  <div className={`text-[18px] font-semibold tabular-nums ${dado.capacidade.tendenciaSaudavel ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}`}>
                    {dado.capacidade.mediaConcluidasPorSemana}/{dado.capacidade.mediaCriadasPorSemana}
                  </div>
                  <div className="text-[10.5px] text-[var(--text-muted)]">Concluídas/criadas por semana</div>
                </div>
              </div>
              <p className="mt-2 text-[12px] text-[var(--text-secondary)]">
                {dado.capacidade.tendenciaSaudavel
                  ? dado.capacidade.semanasParaZerarBacklog != null
                    ? `No ritmo atual, o backlog zera em ~${dado.capacidade.semanasParaZerarBacklog} semanas.`
                    : "A operação está fechando mais do que abrindo — backlog estável ou caindo."
                  : "⚠ A operação está abrindo mais tarefas do que fecha — o backlog está crescendo, não só acumulando por acaso."}
              </p>

              <h3 className="mt-4 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Throughput por semana</h3>
              <div className="mt-2 flex h-20 items-end gap-1">
                {dado.throughputPorSemana.map((p) => (
                  <div key={p.semana} className="flex flex-1 flex-col items-center gap-1" title={`${p.concluidas} na semana de ${dataCurta(p.semana)}`}>
                    <div className={`w-full rounded-t ${p.concluidas > 0 ? "bg-[var(--action-primary)]" : "bg-[var(--border-subtle)]"}`} style={{ height: `${Math.max(2, (p.concluidas / maiorThroughput) * 64)}px` }} />
                    <span className="text-[8px] text-[var(--text-muted)]">{p.semana.slice(5, 10)}</span>
                  </div>
                ))}
              </div>

              <h3 className="mt-4 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Gargalo por fase (tempo médio de ciclo)</h3>
              {dado.gargaloPorFase.length === 0 && <p className="mt-2 text-[12px] text-[var(--text-muted)]">Sem dado suficiente no período.</p>}
              <div className="mt-2 flex flex-col gap-1.5">
                {dado.gargaloPorFase.map((f) => {
                  const maior = Math.max(1, ...dado.gargaloPorFase.map((x) => x.tempoMedioDias))
                  return (
                    <div key={f.faseMacroKey} className="flex items-center gap-2">
                      <span className="w-28 shrink-0 truncate text-[11px] text-[var(--text-secondary)]">{rotularFase(f.faseMacroKey) ?? f.faseMacroKey}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                        <div className="h-full rounded-full bg-[var(--warning)]" style={{ width: `${(f.tempoMedioDias / maior) * 100}%` }} />
                      </div>
                      <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-[var(--text-secondary)]">{f.tempoMedioDias}d ({f.quantidade})</span>
                    </div>
                  )
                })}
              </div>

              <h3 className="mt-4 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Performance de terceiro (tempo médio de ciclo)</h3>
              {dado.performanceTerceiro.length === 0 && <p className="mt-2 text-[12px] text-[var(--text-muted)]">Sem dado suficiente no período.</p>}
              <div className="mt-2 divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)]">
                {dado.performanceTerceiro.map((t) => (
                  <div key={t.terceiro} className="flex items-center justify-between px-3 py-1.5 text-[12px]">
                    <span className="min-w-0 truncate text-[var(--text-primary)]">{t.terceiro}</span>
                    <span className="shrink-0 tabular-nums text-[var(--text-secondary)]">{t.tempoMedioDias}d · {t.quantidade}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** O painel de histórico — leitura pura de `LogAuditoria`, nunca uma tabela nova. */
function PainelHistorico({ aoFechar }: { aoFechar: () => void }) {
  interface ItemHistorico {
    id: number; quando: string; transferencia: boolean; tarefaId: number | null; tarefaTitulo: string | null
    processoId: number | null; autorNome: string | null; destinatarioNome: string | null; motivo: string | null
  }
  const [itens, setItens] = useState<ItemHistorico[] | null>(null)
  useEffect(() => {
    let vivo = true
    fetch("/api/operacao/historico-atribuicoes?limite=80", { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { itens: ItemHistorico[] }) => { if (vivo) setItens(d.itens) })
      .catch(() => { if (vivo) setItens([]) })
    return () => { vivo = false }
  }, [])

  return (
    <div className="fixed inset-0 z-[10000] flex items-stretch justify-end bg-[var(--overlay-modal)]" onClick={aoFechar}>
      <div
        className="flex h-full w-full max-w-md flex-col overflow-hidden border-l border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--elev-3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Histórico de atribuições</h2>
          <button onClick={aoFechar} className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {itens == null && <Estado tipo="carregando" mensagem="Carregando histórico…" />}
          {itens != null && itens.length === 0 && <Estado tipo="vazio" mensagem="Nenhuma atribuição registrada ainda." />}
          {itens?.map((it) => (
            <div key={it.id} className="border-b border-[var(--border-subtle)] px-4 py-2.5">
              <div className="text-[12px] text-[var(--text-primary)]">
                <span className="font-medium">{it.autorNome ?? "Alguém"}</span>{" "}
                {it.transferencia ? "transferiu" : "atribuiu"}{" "}
                <span className="font-medium">{it.tarefaTitulo ?? `tarefa #${it.tarefaId}`}</span>{" "}
                para <span className="font-medium">{it.destinatarioNome ?? "—"}</span>
              </div>
              {it.motivo && <div className="mt-0.5 text-[11px] italic text-[var(--text-secondary)]">"{it.motivo}"</div>}
              <div className="mt-0.5 text-[10.5px] text-[var(--text-muted)]">{new Date(it.quando).toLocaleString("pt-BR")}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
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

export function DistribuicaoTarefas() {
  useRotulosDeFaseProntos()
  const router = useRouter()

  const [universo, setUniverso] = useState<LinhaGerencial[] | null>(null)
  const [falhou, setFalhou] = useState(false)
  const [recarga, setRecarga] = useState(0)
  useEffect(() => {
    let vivo = true
    setFalhou(false)
    fetch("/api/operacao/visao-global?porPagina=500", { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { linhas?: LinhaGerencial[] }) => { if (vivo) setUniverso(d.linhas ?? []) })
      .catch(() => { if (vivo) { setUniverso([]); setFalhou(true) } })
    return () => { vivo = false }
  }, [recarga])

  const [funcionarios, setFuncionarios] = useState<Funcionario[] | null>(null)
  useEffect(() => {
    let vivo = true
    fetch("/api/operacao/atribuiveis", { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { funcionarios?: Funcionario[] }) => { if (vivo) setFuncionarios(d.funcionarios ?? []) })
      .catch(() => { if (vivo) setFuncionarios([]) })
    return () => { vivo = false }
  }, [recarga])

  const carregando = universo == null
  // eslint-disable-next-line react-hooks/purity -- momento de referência do RENDER, nunca dentro de um memo/effect
  const agoraMs = Date.now()

  const [filtros, setFiltros] = useState<Filtros>(SEM_FILTRO)
  const [buscaDigitada, setBuscaDigitada] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setFiltros((f) => ({ ...f, busca: buscaDigitada })), 300)
    return () => clearTimeout(t)
  }, [buscaDigitada])
  const [maisFiltros, setMaisFiltros] = useState(false)
  const [agruparPor, setAgruparPor] = useState<AgruparPor>("familia")
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())
  const [gruposVerTodas, setGruposVerTodas] = useState<Set<string>>(new Set())
  const [pagina, setPagina] = useState(1)
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())
  const [historicoAberto, setHistoricoAberto] = useState(false)
  const [sucessaoAberta, setSucessaoAberta] = useState(false)
  const [analyticsAberto, setAnalyticsAberto] = useState(false)

  const opcoesFase = useMemo(() => {
    const vistos = new Map<string, string>()
    for (const l of universo ?? []) if (l.faseMacroKey) vistos.set(l.faseMacroKey, rotularFase(l.faseMacroKey) ?? l.faseMacroKey)
    return [...vistos.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [universo])
  const opcoesTipo = useMemo(() => {
    const vistos = new Set<string>()
    for (const l of universo ?? []) if (l.servico) vistos.add(l.servico)
    return [...vistos].sort((a, b) => a.localeCompare(b))
  }, [universo])

  const linhasFiltradas = useMemo(() => {
    if (!universo) return null
    let base = universo.filter((l) => l.origem !== ORIGEM_OBRIGACAO_ATRIBUICAO)
    const b = filtros.busca.trim().toLowerCase()
    if (b) {
      base = base.filter((l) =>
        [l.titulo, l.pessoaNome, l.processoNome, l.familiaNome, l.servico, l.terceiroNome]
          .filter(Boolean).some((s) => s!.toLowerCase().includes(b)))
    }
    if (filtros.fase) base = base.filter((l) => l.faseMacroKey === filtros.fase)
    if (filtros.tipo) base = base.filter((l) => l.servico === filtros.tipo)
    if (filtros.status) base = base.filter((l) => l.coluna === filtros.status)
    if (filtros.responsavel === "sem") base = base.filter((l) => l.responsavelId == null)
    else if (filtros.responsavel) base = base.filter((l) => l.responsavelId === Number(filtros.responsavel))
    if (filtros.prazo === "atrasadas") base = base.filter((l) => l.atrasada)
    else if (filtros.prazo === "hoje") base = base.filter((l) => l.venceHoje)
    else if (filtros.prazo === "7dias") base = base.filter((l) => l.diasParaPrazo != null && l.diasParaPrazo >= 0 && l.diasParaPrazo <= 7)
    return base
  }, [universo, filtros])

  const grupos = useMemo(() => (linhasFiltradas ? construirGrupos(linhasFiltradas, agruparPor) : null), [linhasFiltradas, agruparPor])

  // DEEP-LINK — "Distribuir tarefas" (Minha Operação) manda pra cá com
  // `?processo=<id>`, sempre reativo (não só no mount): navegar pra CÁ de
  // dentro daqui mesmo não remonta o componente (mesma causa do clique morto
  // corrigida em `/operacao`, achado real 24/09/2026).
  const searchParams = useSearchParams()
  useEffect(() => {
    const alvo = Number(searchParams.get("processo"))
    if (!Number.isInteger(alvo) || alvo <= 0 || !grupos) return
    const chave = `p${alvo}`
    if (!grupos.some((g) => g.chave === chave)) return
    setExpandidos((prev) => (prev.has(chave) ? prev : new Set(prev).add(chave)))
    document.getElementById(`grupo-${chave}`)?.scrollIntoView({ block: "center" })
  }, [searchParams, grupos])
  const totalPaginas = Math.max(1, Math.ceil((grupos?.length ?? 0) / POR_PAGINA_GRUPOS))
  const paginaValida = Math.min(Math.max(pagina, 1), totalPaginas)
  const gruposVisiveis = grupos?.slice((paginaValida - 1) * POR_PAGINA_GRUPOS, paginaValida * POR_PAGINA_GRUPOS) ?? null

  // ── KPIs — sempre sobre o universo NÃO PAGINADO (mesma régua que os tiles
  // de Minha Operação/Tarefas e Projetos já usam: o número clicável não pode
  // refletir o recorte que a lista já aplicou). Todos escopados a linhas com
  // `origem == null` — obrigação administrativa não é o que se distribui aqui.
  const seteDiasAtras = agoraMs - 7 * 24 * 60 * 60 * 1000
  const kpis = useMemo(() => {
    const base = (universo ?? []).filter((l) => l.origem !== ORIGEM_OBRIGACAO_ATRIBUICAO)
    const semResp = base.filter((l) => l.responsavelId == null)
    const familiasComPendencia = new Set(semResp.map((l) => l.processoId ?? -1)).size
    return {
      semResponsavel: semResp.length,
      urgentes: semResp.filter((l) => l.prioridade === "URGENTE").length,
      familiasComPendencia,
      vencemEm3Dias: semResp.filter((l) => !l.atrasada && l.diasParaPrazo != null && l.diasParaPrazo >= 0 && l.diasParaPrazo <= 3).length,
      atrasadas: semResp.filter((l) => l.atrasada).length,
      membrosEquipe: funcionarios?.length ?? 0,
      atribuidasEstaSemana: base.filter((l) => l.atribuidaEm != null && Date.parse(l.atribuidaEm) >= seteDiasAtras).length,
    }
  }, [universo, funcionarios, seteDiasAtras])

  const temFiltro = filtros.busca.trim() !== "" || filtros.fase != null || filtros.tipo != null || filtros.status != null || filtros.responsavel != null || filtros.prazo !== "todos"
  const limparFiltros = () => { setFiltros(SEM_FILTRO); setBuscaDigitada(""); setPagina(1) }

  // ── SELEÇÃO EM LOTE ──
  const linhasSelecionadas = useMemo(() => (linhasFiltradas ?? []).filter((l) => selecionados.has(l.taskId)), [linhasFiltradas, selecionados])
  const alternarSelecao = (id: number) => setSelecionados((prev) => {
    const novo = new Set(prev)
    if (novo.has(id)) novo.delete(id); else novo.add(id)
    return novo
  })
  const alternarTodosNoGrupo = (ids: number[], todasMarcadas: boolean) => setSelecionados((prev) => {
    const novo = new Set(prev)
    if (todasMarcadas) ids.forEach((id) => novo.delete(id))
    else ids.forEach((id) => novo.add(id))
    return novo
  })
  const todosSelecionadosVisiveis = (linhasFiltradas?.length ?? 0) > 0 && (linhasFiltradas ?? []).every((l) => selecionados.has(l.taskId))
  const alternarTodosVisiveis = () => setSelecionados(todosSelecionadosVisiveis ? new Set() : new Set((linhasFiltradas ?? []).map((l) => l.taskId)))

  const [responsavelEscolhido, setResponsavelEscolhido] = useState<Funcionario | null>(null)
  const [prioridadeAlta, setPrioridadeAlta] = useState(false)
  const [mensagem, setMensagem] = useState("")
  const [loteOcupado, setLoteOcupado] = useState(false)
  const [loteErro, setLoteErro] = useState<string | null>(null)
  const [seletorAberto, setSeletorAberto] = useState(false)

  const atribuirLote = async () => {
    if (!responsavelEscolhido || linhasSelecionadas.length === 0) return
    setLoteOcupado(true)
    setLoteErro(null)
    try {
      const r = await fetch("/api/tarefas/redistribuir", {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          tarefaIds: linhasSelecionadas.map((l) => l.taskId),
          novoResponsavelId: responsavelEscolhido.id,
          motivo: mensagem.trim() || null,
        }),
      })
      const d: { sucesso: number; falha: number } = await r.json()
      if (!r.ok && r.status !== 207) throw new Error(String(r.status))
      // PRIORIDADE ALTA é um comando À PARTE — real, não decorativo: chama
      // `alterar_prioridade` para cada tarefa que acabou de ser atribuída.
      if (prioridadeAlta) {
        await Promise.all(linhasSelecionadas.map((l) =>
          fetch(`/api/tarefas/${l.taskId}/comando`, { method: "POST", headers: auth(), body: JSON.stringify({ acao: "alterar_prioridade", prioridade: "ALTA" }) }),
        ))
      }
      if (d.falha > 0) setLoteErro(`${d.sucesso} atribuída${d.sucesso === 1 ? "" : "s"}, ${d.falha} ${d.falha === 1 ? "falhou" : "falharam"}.`)
      setSelecionados(new Set())
      setResponsavelEscolhido(null)
      setMensagem("")
      setPrioridadeAlta(false)
      setRecarga((n) => n + 1)
    } catch {
      setLoteErro("Não foi possível atribuir agora. Tente de novo.")
    } finally {
      setLoteOcupado(false)
    }
  }

  const [atribuirGrupo, setAtribuirGrupo] = useState<GrupoDistribuicao | null>(null)
  const [grupoOcupado, setGrupoOcupado] = useState(false)
  const [grupoErro, setGrupoErro] = useState<string | null>(null)
  const atribuirGrupoInteiro = async (responsavelId: number) => {
    if (!atribuirGrupo) return
    setGrupoOcupado(true)
    setGrupoErro(null)
    const alvos = atribuirGrupo.linhas.filter((l) => l.coluna === "SEM_RESPONSAVEL")
    try {
      const r = await fetch("/api/tarefas/redistribuir", {
        method: "POST", headers: auth(),
        body: JSON.stringify({ tarefaIds: alvos.map((l) => l.taskId), novoResponsavelId: responsavelId }),
      })
      if (!r.ok && r.status !== 207) throw new Error(String(r.status))
      setAtribuirGrupo(null)
      setRecarga((n) => n + 1)
    } catch {
      setGrupoErro("Não foi possível atribuir agora. Tente de novo.")
    } finally {
      setGrupoOcupado(false)
    }
  }

  const devolverAFila = async (tarefaId: number) => {
    await fetch(`/api/tarefas/${tarefaId}/comando`, { method: "POST", headers: auth(), body: JSON.stringify({ acao: "devolver_a_fila" }) })
    setRecarga((n) => n + 1)
  }

  // D6 — exportação pronta pra auditoria/compliance: lê LogAuditoria de
  // TODAS as tarefas do processo, formata CSV, baixa. Nenhum dado novo.
  const exportarAuditoria = async (processoId: number, nomeFamilia: string) => {
    try {
      const r = await fetch(`/api/operacao/auditoria-processo?processoId=${processoId}`, { headers: auth() })
      if (!r.ok) throw new Error(String(r.status))
      const d: { itens: { quando: string; acao: string; entidade: string; entidadeId: number | null; descricao: string; autor: string }[] } = await r.json()
      const cabecalho = ["Quando", "Ação", "Entidade", "ID", "Descrição", "Autor"]
      const corpo = d.itens.map((i) => [
        new Date(i.quando).toLocaleString("pt-BR"), i.acao, i.entidade, String(i.entidadeId ?? "—"), i.descricao, i.autor,
      ].map((c) => csvEscapar(String(c))).join(","))
      const csv = [cabecalho.join(","), ...corpo].join("\n")
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `auditoria-${nomeFamilia.toLowerCase().replace(/\s+/g, "-")}-processo-${processoId}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setLoteErro("Não foi possível exportar a auditoria agora.")
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface-page)]">
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[var(--info-tile)] text-[var(--info-text)]">
              <ClipboardList className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">Distribuição de tarefas</h1>
              <p className="mt-0.5 max-w-2xl text-[13px] text-[var(--text-secondary)]">
                Atribua tarefas para a sua equipe de forma rápida e organizada. Você pode selecionar tarefas individualmente ou em lote, por família ou por filtro.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setAnalyticsAberto(true)}
              className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
            >
              <BarChart3 className="h-3.5 w-3.5" /> Analytics
            </button>
            <button
              onClick={() => setSucessaoAberta(true)}
              className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
            >
              <Users2 className="h-3.5 w-3.5" /> Sucessão em massa
            </button>
            <button
              onClick={() => setHistoricoAberto(true)}
              className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
            >
              <History className="h-3.5 w-3.5" /> Ver histórico de atribuições
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2.5">
            <div className="text-[20px] font-semibold tabular-nums text-[var(--text-primary)]">{kpis.semResponsavel}</div>
            <div className="text-[11.5px] font-medium text-[var(--text-primary)]">Tarefas sem responsável</div>
            {kpis.urgentes > 0 && <div className="mt-0.5 text-[10.5px] font-medium text-[var(--danger-text)]">{kpis.urgentes} urgentes</div>}
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2.5">
            <div className="text-[20px] font-semibold tabular-nums text-[var(--text-primary)]">{kpis.familiasComPendencia}</div>
            <div className="text-[11.5px] font-medium text-[var(--text-primary)]">Famílias com pendências</div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2.5">
            <div className="text-[20px] font-semibold tabular-nums text-[var(--text-primary)]">{kpis.vencemEm3Dias}</div>
            <div className="text-[11.5px] font-medium text-[var(--text-primary)]">Tarefas vencem em até 3 dias</div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2.5">
            <div className="text-[20px] font-semibold tabular-nums text-[var(--danger-text)]">{kpis.atrasadas}</div>
            <div className="text-[11.5px] font-medium text-[var(--text-primary)]">Tarefas atrasadas</div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2.5">
            <div className="text-[20px] font-semibold tabular-nums text-[var(--text-primary)]">{kpis.membrosEquipe}</div>
            <div className="text-[11.5px] font-medium text-[var(--text-primary)]">Membros da equipe</div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2.5">
            <div className="text-[20px] font-semibold tabular-nums text-[var(--success-text)]">{kpis.atribuidasEstaSemana}</div>
            <div className="text-[11.5px] font-medium text-[var(--text-primary)]">Tarefas atribuídas esta semana</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2.5">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input value={buscaDigitada} onChange={(e) => setBuscaDigitada(e.target.value)} placeholder="Buscar família, pessoa, documento ou tarefa…" className="h-8 bg-[var(--surface-elevated)] pl-8 text-[12px]" />
          </div>
          <Select value={filtros.fase ?? TODOS} onValueChange={(v) => setFiltros((f) => ({ ...f, fase: v === TODOS ? null : v }))}>
            <SelectTrigger className="h-8 w-36 bg-[var(--surface-elevated)] text-[12px]"><SelectValue placeholder="Todas as fases" /></SelectTrigger>
            <SelectContent className={Z_POPOVER}>
              <SelectItem value={TODOS}>Todas as fases</SelectItem>
              {opcoesFase.map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filtros.tipo ?? TODOS} onValueChange={(v) => setFiltros((f) => ({ ...f, tipo: v === TODOS ? null : v }))}>
            <SelectTrigger className="h-8 w-32 bg-[var(--surface-elevated)] text-[12px]"><SelectValue placeholder="Todos os tipos" /></SelectTrigger>
            <SelectContent className={Z_POPOVER}>
              <SelectItem value={TODOS}>Todos os tipos</SelectItem>
              {opcoesTipo.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filtros.prazo} onValueChange={(v) => setFiltros((f) => ({ ...f, prazo: v as Filtros["prazo"] }))}>
            <SelectTrigger className="h-8 w-32 bg-[var(--surface-elevated)] text-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent className={Z_POPOVER}>
              <SelectItem value="todos">Todos os prazos</SelectItem>
              <SelectItem value="atrasadas">Atrasadas</SelectItem>
              <SelectItem value="hoje">Vencem hoje</SelectItem>
              <SelectItem value="7dias">Vencem em 7 dias</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filtros.status ?? TODOS} onValueChange={(v) => setFiltros((f) => ({ ...f, status: v === TODOS ? null : v as ColunaKanban }))}>
            <SelectTrigger className="h-8 w-36 bg-[var(--surface-elevated)] text-[12px]"><SelectValue placeholder="Todos os status" /></SelectTrigger>
            <SelectContent className={Z_POPOVER}>
              <SelectItem value={TODOS}>Todos os status</SelectItem>
              {(Object.keys(ROTULO_STATUS_LINHA) as ColunaKanban[]).filter((c) => c !== "CONCLUIDA").map((c) => (
                <SelectItem key={c} value={c}>{ROTULO_STATUS_LINHA[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {maisFiltros && (
            <Select value={filtros.responsavel ?? TODOS} onValueChange={(v) => setFiltros((f) => ({ ...f, responsavel: v === TODOS ? null : v }))}>
              <SelectTrigger className="h-8 w-40 bg-[var(--surface-elevated)] text-[12px]"><SelectValue placeholder="Todos os responsáveis" /></SelectTrigger>
              <SelectContent className={Z_POPOVER}>
                <SelectItem value={TODOS}>Todos os responsáveis</SelectItem>
                <SelectItem value="sem">Sem responsável</SelectItem>
                {funcionarios?.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <button onClick={() => setMaisFiltros((v) => !v)} className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)]">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Filtros avançados
          </button>
          {temFiltro && (
            <button onClick={limparFiltros} className="flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]">
              <XIcon className="h-3.5 w-3.5" /> Limpar
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <Campo rotulo="Agrupar por:">
              <Select value={agruparPor} onValueChange={(v) => { setAgruparPor(v as AgruparPor); setPagina(1) }}>
                <SelectTrigger className="h-8 w-32 bg-[var(--surface-elevated)] text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent className={Z_POPOVER}>
                  <SelectItem value="familia">Família</SelectItem>
                  <SelectItem value="fase">Fase</SelectItem>
                  <SelectItem value="responsavel">Responsável</SelectItem>
                </SelectContent>
              </Select>
            </Campo>
            <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
              <input type="checkbox" checked={todosSelecionadosVisiveis} onChange={alternarTodosVisiveis} className="h-3.5 w-3.5 accent-[var(--action-primary)]" />
              Selecionar todas da página
            </label>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={selecionados.size === 0}
                  className="flex items-center gap-1.5 rounded-md bg-[var(--action-primary)] px-3 py-1.5 text-[12px] font-medium text-[var(--action-primary-ink)] transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Ações em lote ({selecionados.size}) <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className={Z_POPOVER}>
                <DropdownMenuItem onClick={() => setSeletorAberto(true)}>Atribuir para…</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelecionados(new Set())}>Limpar seleção</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              onClick={() => exportarCsv(linhasFiltradas ?? [])}
              className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)]"
            >
              <Download className="h-3.5 w-3.5" /> Exportar
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
          <div className="min-w-0 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
            {falhou && <Estado tipo="erro" mensagem="Não foi possível carregar a distribuição." aoTentar={() => setRecarga((n) => n + 1)} />}
            {carregando && !falhou && <Estado tipo="carregando" mensagem="Carregando distribuição…" />}
            {!carregando && !falhou && gruposVisiveis?.length === 0 && (
              <Estado tipo="vazio" mensagem={temFiltro ? "Nenhuma tarefa corresponde aos filtros selecionados." : "Nenhuma tarefa aberta na operação."} />
            )}
            {gruposVisiveis != null && gruposVisiveis.length > 0 && (
              <div className="divide-y divide-[var(--border-subtle)]">
                {gruposVisiveis.map((g) => {
                  const aberto = expandidos.has(g.chave)
                  const verTodas = gruposVerTodas.has(g.chave)
                  const linhasVisiveis = verTodas ? g.linhas : g.linhas.slice(0, LINHAS_VISIVEIS_POR_GRUPO)
                  const idsDoGrupo = g.linhas.map((l) => l.taskId)
                  const todasMarcadasNoGrupo = idsDoGrupo.length > 0 && idsDoGrupo.every((id) => selecionados.has(id))
                  return (
                    <div key={g.chave} id={`grupo-${g.chave}`}>
                      <div className="flex w-full flex-wrap items-center gap-3 px-4 py-3 hover:bg-[var(--surface-secondary)]">
                        <input
                          type="checkbox" checked={todasMarcadasNoGrupo}
                          onChange={() => alternarTodosNoGrupo(idsDoGrupo, todasMarcadasNoGrupo)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-3.5 w-3.5 shrink-0 accent-[var(--action-primary)]"
                        />
                        <button
                          onClick={() => setExpandidos((prev) => { const n = new Set(prev); if (n.has(g.chave)) n.delete(g.chave); else n.add(g.chave); return n })}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        >
                          {aberto ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />}
                          {agruparPor === "familia" && <Folder className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{g.rotulo}</span>
                              {agruparPor === "familia" && <Etiqueta tom="neutro">Família</Etiqueta>}
                            </div>
                            {g.subtitulo && <div className="truncate text-[10.5px] text-[var(--text-muted)]">{g.subtitulo}</div>}
                          </div>
                        </button>
                        <div className="shrink-0 text-right">
                          <div className={`text-[12px] tabular-nums ${g.semResponsavel > 0 ? "font-medium text-[var(--danger-text)]" : "text-[var(--text-secondary)]"}`}>
                            {g.semResponsavel} sem responsável
                          </div>
                          <div className="text-[10.5px] text-[var(--text-muted)]">{g.atribuidas} atribuídas · {g.emAndamento} em andamento</div>
                        </div>
                        <div className="shrink-0 text-right text-[11.5px] text-[var(--text-secondary)]">
                          {g.prazoMaisProximo ? <>{dataCurta(g.prazoMaisProximo)}</> : "—"}
                        </div>
                        {g.prioridadeMaisAlta && (
                          <span className="shrink-0 text-[11.5px] text-[var(--text-secondary)]">{ROTULO_PRIORIDADE[g.prioridadeMaisAlta] ?? g.prioridadeMaisAlta}</span>
                        )}
                        <div className="flex shrink-0 -space-x-1.5">
                          {g.responsaveis.slice(0, 2).map((r) => (
                            <span key={r.id} title={r.nome} className="grid h-6 w-6 place-items-center rounded-full border border-[var(--surface-elevated)] bg-[var(--pessoa-tile)] text-[9.5px] font-semibold text-[var(--pessoa)]">
                              {iniciaisDe(r.nome)}
                            </span>
                          ))}
                          {g.responsaveis.length > 2 && (
                            <span className="grid h-6 w-6 place-items-center rounded-full border border-[var(--surface-elevated)] bg-[var(--surface-tertiary)] text-[9.5px] font-semibold text-[var(--text-secondary)]">
                              +{g.responsaveis.length - 2}
                            </span>
                          )}
                        </div>
                        {g.semResponsavel > 0 && (
                          <button
                            onClick={() => setAtribuirGrupo(g)}
                            className="shrink-0 rounded-md bg-[var(--action-primary)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--action-primary-ink)] transition-opacity hover:opacity-90"
                          >
                            Atribuir
                          </button>
                        )}
                        {g.processoId != null && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button onClick={(e) => e.stopPropagation()} className="shrink-0 rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]">
                                <MoreVertical className="h-4 w-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className={Z_POPOVER}>
                              <DropdownMenuItem onClick={() => router.push(`/kanban?processo=${g.processoId}`)}>Ver processo</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void exportarAuditoria(g.processoId!, g.rotulo)}>Exportar auditoria (CSV)</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>

                      {aberto && (
                        <>
                          <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-secondary)]/40 px-4 py-1.5 text-[11px] text-[var(--text-secondary)]">
                            <span>Selecionar todas as {g.linhas.length} tarefas</span>
                            {todasMarcadasNoGrupo && idsDoGrupo.length > 0 && (
                              <Etiqueta tom="acento">{idsDoGrupo.filter((id) => selecionados.has(id)).length} selecionadas</Etiqueta>
                            )}
                          </div>
                          <table className="w-full table-fixed border-collapse text-left">
                            <colgroup>
                              <col className="w-8" />
                              <col className="w-[13%]" />
                              <col className="w-[22%]" />
                              <col className="w-[10%]" />
                              <col className="w-[15%]" />
                              <col className="w-[9%]" />
                              <col className="w-[8%]" />
                              <col className="w-[11%]" />
                              <col className="w-[10%]" />
                              <col className="w-8" />
                            </colgroup>
                            <thead className="sticky top-0 z-10 bg-[var(--surface-overlay)]">
                              <tr className="border-b border-[var(--border-subtle)] [&>th]:overflow-hidden [&>th]:truncate [&>th]:px-3 [&>th]:py-2 [&>th]:text-[10px] [&>th]:font-medium [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-[var(--text-muted)]">
                                <th className="w-8" />
                                <th>Pessoa</th>
                                <th>Documento / Tarefa</th>
                                <th>Fase</th>
                                <th>Etapa atual</th>
                                <th>Prazo</th>
                                <th>Prioridade</th>
                                <th>Responsável</th>
                                <th>Status</th>
                                <th className="w-8" />
                              </tr>
                            </thead>
                            <tbody>
                              {linhasVisiveis.map((l) => (
                                <tr key={l.taskId} className="border-b border-[var(--border-subtle)] transition-colors last:border-b-0 hover:bg-[var(--surface-secondary)]">
                                  <td className="overflow-hidden px-3 py-2">
                                    <input type="checkbox" checked={selecionados.has(l.taskId)} onChange={() => alternarSelecao(l.taskId)} className="h-3.5 w-3.5 accent-[var(--action-primary)]" />
                                  </td>
                                  <td className="overflow-hidden px-3 py-2">
                                    <div className="flex items-center gap-1.5">
                                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--pessoa-tile)] text-[8.5px] font-semibold text-[var(--pessoa)]">
                                        {iniciaisDe(l.pessoaNome ?? l.processoNome ?? "?")}
                                      </span>
                                      <span className="block truncate text-[12px] text-[var(--text-primary)]">{l.pessoaNome ?? "—"}</span>
                                    </div>
                                  </td>
                                  <td className="overflow-hidden px-3 py-2 text-[12px] text-[var(--text-primary)]">
                                    <span className="block truncate">{l.titulo}</span>
                                  </td>
                                  <td className="overflow-hidden truncate px-3 py-2 text-[11.5px] text-[var(--text-secondary)]">{rotularFase(l.faseMacroKey) ?? "—"}</td>
                                  <td className="overflow-hidden px-3 py-2 text-[11.5px] text-[var(--text-secondary)]"><span className="block truncate">{l.etapaAtual ?? "—"}</span></td>
                                  <td className="overflow-hidden truncate px-3 py-2 text-[11.5px] text-[var(--text-secondary)]">{dataCurta(l.dataPrazo)}</td>
                                  <td className="overflow-hidden truncate px-3 py-2 text-[11.5px] text-[var(--text-secondary)]">{ROTULO_PRIORIDADE[l.prioridade] ?? l.prioridade}</td>
                                  <td className="overflow-hidden truncate px-3 py-2 text-[11.5px] text-[var(--text-secondary)]">{l.responsavelNome ?? "—"}</td>
                                  <td className="overflow-hidden px-3 py-2"><Etiqueta tom={TOM_STATUS_LINHA[l.coluna]}>{ROTULO_STATUS_LINHA[l.coluna]}</Etiqueta></td>
                                  <td className="overflow-hidden px-3 py-2">
                                    {l.responsavelId != null && (
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <button className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"><MoreVertical className="h-3.5 w-3.5" /></button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent className={Z_POPOVER}>
                                          <DropdownMenuItem onClick={() => devolverAFila(l.taskId)}>Devolver à fila</DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {g.linhas.length > LINHAS_VISIVEIS_POR_GRUPO && (
                            <div className="border-t border-[var(--border-subtle)] px-4 py-2 text-[11px] text-[var(--text-secondary)]">
                              +{g.linhas.length - linhasVisiveis.length > 0 ? g.linhas.length - linhasVisiveis.length : 0} tarefa{g.linhas.length === 1 ? "" : "s"} da família ·{" "}
                              <button
                                onClick={() => setGruposVerTodas((prev) => { const n = new Set(prev); if (verTodas) n.delete(g.chave); else n.add(g.chave); return n })}
                                className="font-medium text-[var(--action-primary)] hover:underline"
                              >
                                {verTodas ? "Mostrar menos" : "ver todas"}
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
            {grupos != null && grupos.length > 0 && (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-3 py-2">
                <span className="text-[11px] text-[var(--text-muted)]">
                  {grupos.length} família{grupos.length === 1 ? "" : "s"} · {linhasFiltradas?.length ?? 0} tarefa{(linhasFiltradas?.length ?? 0) === 1 ? "" : "s"} no total · {kpis.semResponsavel} sem responsável
                </span>
                {totalPaginas > 1 && (
                  <div className="flex items-center gap-1">
                    <button disabled={paginaValida <= 1} onClick={() => setPagina(paginaValida - 1)} className="rounded border border-[var(--border-default)] p-1 text-[var(--text-secondary)] disabled:opacity-40">
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    {Array.from({ length: totalPaginas }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n} onClick={() => setPagina(n)}
                        className={`h-6 w-6 rounded text-[11px] tabular-nums ${n === paginaValida ? "bg-[var(--action-primary)] text-[var(--action-primary-ink)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"}`}
                      >
                        {n}
                      </button>
                    ))}
                    <button disabled={paginaValida >= totalPaginas} onClick={() => setPagina(paginaValida + 1)} className="rounded border border-[var(--border-default)] p-1 text-[var(--text-secondary)] disabled:opacity-40">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-[var(--action-primary)]/40 bg-[var(--surface-elevated)] p-3.5">
              <h3 className="text-[12.5px] font-semibold text-[var(--text-primary)]">Atribuição em massa</h3>
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Selecione as tarefas e atribua para um ou mais membros da equipe.</p>

              <div className="mt-3 flex items-center justify-between text-[11.5px]">
                <span className="text-[var(--text-secondary)]">Tarefas selecionadas <span className="font-semibold text-[var(--text-primary)]">{selecionados.size}</span></span>
                {selecionados.size > 0 && (
                  <button onClick={() => setSelecionados(new Set())} className="text-[var(--action-primary)] hover:underline">Limpar seleção</button>
                )}
              </div>

              {loteErro && <div className="mt-2 rounded border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2.5 py-1.5 text-[11px] text-[var(--danger-text)]">{loteErro}</div>}

              <label className="mt-3 block text-[11px] font-medium text-[var(--text-secondary)]">Responsável</label>
              {responsavelEscolhido ? (
                <div className="mt-1 flex items-center justify-between rounded border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2.5 py-1.5">
                  <span className="flex items-center gap-1.5 text-[12px] text-[var(--text-primary)]">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--pessoa-tile)] text-[8.5px] font-semibold text-[var(--pessoa)]">{iniciaisDe(responsavelEscolhido.nome)}</span>
                    {responsavelEscolhido.nome}
                  </span>
                  <button onClick={() => setResponsavelEscolhido(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><XIcon className="h-3.5 w-3.5" /></button>
                </div>
              ) : (
                <button
                  onClick={() => setSeletorAberto(true)}
                  className="mt-1 w-full rounded border border-dashed border-[var(--border-default)] bg-[var(--surface-secondary)] px-2.5 py-1.5 text-left text-[12px] text-[var(--text-muted)] hover:bg-[var(--surface-tertiary)]"
                >
                  Selecionar…
                </button>
              )}

              <label className="mt-3 flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                <input type="checkbox" checked readOnly disabled className="h-3.5 w-3.5 accent-[var(--action-primary)]" />
                Notificar o responsável (sempre enviado)
              </label>

              <label className="mt-3 block text-[11px] font-medium text-[var(--text-secondary)]">Mensagem (opcional)</label>
              <textarea
                value={mensagem} onChange={(e) => setMensagem(e.target.value.slice(0, 300))} maxLength={300} rows={3}
                className="mt-1 w-full resize-none rounded border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                placeholder="Segue lote de tarefas para sua análise e execução."
              />
              <div className="mt-0.5 text-right text-[10px] text-[var(--text-muted)]">{mensagem.length}/300</div>

              <div className="mt-3">
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">Opções avançadas</span>
                <label className="mt-1.5 flex items-start gap-2 text-[11px] text-[var(--text-muted)]">
                  <input type="checkbox" disabled className="mt-0.5 h-3.5 w-3.5 accent-[var(--action-primary)]" />
                  <span>Atribuir também novas tarefas desta família que surgirem nesta fase <span className="italic">(em breve)</span></span>
                </label>
                <label className="mt-1.5 flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                  <input type="checkbox" checked readOnly disabled className="h-3.5 w-3.5 accent-[var(--action-primary)]" />
                  Manter prazos originais
                </label>
                <label className="mt-1.5 flex items-center gap-2 text-[11px] text-[var(--text-primary)]">
                  <input type="checkbox" checked={prioridadeAlta} onChange={(e) => setPrioridadeAlta(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--action-primary)]" />
                  Definir como prioridade alta
                </label>
              </div>

              <button
                disabled={loteOcupado || !responsavelEscolhido || selecionados.size === 0}
                onClick={atribuirLote}
                className="mt-3 w-full rounded-md bg-[var(--action-primary)] px-3 py-1.5 text-[12px] font-medium text-[var(--action-primary-ink)] transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {loteOcupado ? "Atribuindo…" : "Atribuir selecionadas"}
              </button>
            </div>

            {funcionarios != null && funcionarios.length > 0 && (
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3.5">
                <h3 className="text-[12.5px] font-semibold text-[var(--text-primary)]">Distribuição por equipe</h3>
                <div className="mt-2.5 flex flex-col gap-2.5">
                  {[...funcionarios].sort((a, b) => b.tarefasAtivas - a.tarefasAtivas).map((f) => {
                    const maior = Math.max(1, ...funcionarios.map((x) => x.tarefasAtivas))
                    return (
                      <div key={f.id} className="flex items-center gap-2">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--pessoa-tile)] text-[9.5px] font-semibold text-[var(--pessoa)]">{iniciaisDe(f.nome)}</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] text-[var(--text-primary)]">{f.nome}</div>
                          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                            <div className={`h-full rounded-full ${f.atrasadas > 0 ? "bg-[var(--danger)]" : "bg-[var(--action-primary)]"}`} style={{ width: `${Math.round((f.tarefasAtivas / maior) * 100)}%` }} />
                          </div>
                        </div>
                        <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--text-muted)]">{f.tarefasAtivas} ativa{f.tarefasAtivas === 1 ? "" : "s"}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {seletorAberto && (
        <SeletorResponsavel
          titulo="Escolher responsável"
          atual={responsavelEscolhido?.id ?? null}
          ocupado={false}
          erro={null}
          aoFechar={() => setSeletorAberto(false)}
          aoEscolher={(id) => {
            const f = funcionarios?.find((x) => x.id === id)
            if (f) setResponsavelEscolhido(f)
            setSeletorAberto(false)
          }}
        />
      )}

      {atribuirGrupo && (
        <SeletorResponsavel
          titulo={`Atribuir ${atribuirGrupo.linhas.filter((l) => l.coluna === "SEM_RESPONSAVEL").length} tarefa(s) sem responsável — ${atribuirGrupo.rotulo}`}
          atual={null} ocupado={grupoOcupado} erro={grupoErro}
          aoFechar={() => { setAtribuirGrupo(null); setGrupoErro(null) }}
          aoEscolher={atribuirGrupoInteiro}
        />
      )}

      {historicoAberto && <PainelHistorico aoFechar={() => setHistoricoAberto(false)} />}

      {sucessaoAberta && (
        <PainelSucessao
          funcionarios={funcionarios}
          aoFechar={() => setSucessaoAberta(false)}
          aoConcluido={() => setRecarga((n) => n + 1)}
        />
      )}

      {analyticsAberto && <PainelAnalytics aoFechar={() => setAnalyticsAberto(false)} />}
    </div>
  )
}
