// src/components/kanban/ProcessoHistorico.tsx
// ============================================================================
// DIÁRIO OPERACIONAL DO PROCESSO — linha do tempo completa (Discovery DS).
// Fonte: /api/processos/[id]/logs (LogAuditoria). Categoriza os eventos por tipo
// (Workflow/Documentos/Tarefas/Pessoas/Comunicação/Eventos/Alterações/Arquivos),
// agrupa por dia, e mostra resumo + usuários + filtros rápidos na lateral.
// Só apresentação: nenhuma regra/fluxo alterado.
// ============================================================================
"use client"

import { useState, useEffect, useMemo } from "react"
import {
  GitBranch, FileText, CheckSquare, Users, Mail, CalendarDays, Edit3, Paperclip,
  Download, Filter, Search, RotateCcw, ChevronDown, BarChart3, ExternalLink, Info,
} from "lucide-react"

interface LogItem {
  id: number
  acao: string
  entidade: string
  entidadeId: number | null
  descricao: string
  detalhes: Record<string, any> | null
  criadoEm: string
  usuario: { id: number; nome: string } | null
}

interface ProcessoHistoricoProps { processoId: number; onUpdate?: () => void }

// ── Tipos do diário (chips + ícone/cor) ─────────────────────────────────────
type TipoKey = "workflow" | "documentos" | "tarefas" | "pessoas" | "comunicacao" | "eventos" | "alteracoes" | "arquivos"
const TIPOS: { key: TipoKey; label: string; icon: any; cor: string }[] = [
  { key: "workflow", label: "Workflow", icon: GitBranch, cor: "#7dd3fc" },
  { key: "documentos", label: "Documentos", icon: FileText, cor: "#4ade80" },
  { key: "tarefas", label: "Tarefas", icon: CheckSquare, cor: "#a78bfa" },
  { key: "pessoas", label: "Pessoas", icon: Users, cor: "#2dd4bf" },
  { key: "comunicacao", label: "Comunicação", icon: Mail, cor: "#fb923c" },
  { key: "eventos", label: "Eventos", icon: CalendarDays, cor: "#fbbf24" },
  { key: "alteracoes", label: "Alterações", icon: Edit3, cor: "#d2a948" },
  { key: "arquivos", label: "Arquivos", icon: Paperclip, cor: "#94a3b8" },
]
const TIPO_POR_KEY = Object.fromEntries(TIPOS.map((t) => [t.key, t]))

function tipoDoLog(l: LogItem): TipoKey {
  const e = (l.entidade || "").toUpperCase()
  const a = (l.acao || "").toUpperCase()
  if (e === "DOCUMENTO" || e === "NECESSIDADE" || e.includes("DOCUMENTO")) return "documentos"
  if (e === "TAREFA" || e === "ATIVIDADE") return "tarefas"
  if (e === "PESSOA" || e === "REQUERENTE" || e === "CONTRATANTE" || e === "CLIENTE") return "pessoas"
  if (e === "EVENTO") return "eventos"
  if (e === "ARQUIVO" || e === "ANEXO") return "arquivos"
  if (e === "COMUNICACAO" || e === "EMAIL" || e === "MENSAGEM") return "comunicacao"
  if (e === "PROCESSO" && (a === "AVANCAR" || a === "RETROCEDER" || a === "MOVER" || a.includes("FASE"))) return "workflow"
  if (e === "WORKFLOW" || e === "FASE" || e === "OPERACAO") return "workflow"
  return "alteracoes"
}

const iniciais = (nome?: string | null) => (nome ?? "").split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "—"
const horaBR = (s: string) => new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })

function relativa(s: string): string {
  const diff = Date.now() - new Date(s).getTime()
  const min = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000)
  if (min < 1) return "agora"
  if (min < 60) return `${min} min atrás`
  if (h < 24) return `${h}h atrás`
  if (d < 7) return `${d} dia${d > 1 ? "s" : ""} atrás`
  return new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}
function diaLabel(s: string): string {
  const d = new Date(s); d.setHours(0, 0, 0, 0)
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1)
  const fmt = new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })
  if (d.getTime() === hoje.getTime()) return `Hoje - ${fmt}`
  if (d.getTime() === ontem.getTime()) return `Ontem - ${fmt}`
  return fmt
}

const CARD = "rounded-xl border border-white/10 bg-[#1b2027]"

export function ProcessoHistorico({ processoId }: ProcessoHistoricoProps) {
  const [logs, setLogs] = useState<LogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [tipo, setTipo] = useState<TipoKey | "todos">("todos")
  const [busca, setBusca] = useState("")
  const [limite, setLimite] = useState(20)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/processos/${processoId}/logs?limite=200`)
      .then((r) => r.ok ? r.json() : { logs: [] }).then((d) => setLogs(d.logs || [])).catch(() => setLogs([])).finally(() => setLoading(false))
  }, [processoId])

  const contagem = useMemo(() => {
    const c: Record<string, number> = {}
    for (const l of logs) c[tipoDoLog(l)] = (c[tipoDoLog(l)] ?? 0) + 1
    return c
  }, [logs])

  const filtrados = useMemo(() => logs
    .filter((l) => tipo === "todos" || tipoDoLog(l) === tipo)
    .filter((l) => !busca || `${l.descricao} ${l.usuario?.nome ?? ""} ${l.entidade}`.toLowerCase().includes(busca.toLowerCase()))
    .sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime()), [logs, tipo, busca])

  const visiveis = filtrados.slice(0, limite)
  const grupos = useMemo(() => {
    const g: { dia: string; itens: LogItem[] }[] = []
    for (const l of visiveis) {
      const dia = diaLabel(l.criadoEm)
      const ult = g[g.length - 1]
      if (ult && ult.dia === dia) ult.itens.push(l); else g.push({ dia, itens: [l] })
    }
    return g
  }, [visiveis])

  // sidebar: resumo + usuários
  const stats = useMemo(() => {
    const now = new Date()
    const hoje0 = new Date(now); hoje0.setHours(0, 0, 0, 0)
    const semana0 = new Date(hoje0); semana0.setDate(semana0.getDate() - 6)
    const mes0 = new Date(now.getFullYear(), now.getMonth(), 1)
    const hoje = logs.filter((l) => new Date(l.criadoEm) >= hoje0).length
    const semana = logs.filter((l) => new Date(l.criadoEm) >= semana0).length
    const mes = logs.filter((l) => new Date(l.criadoEm) >= mes0).length
    const usuarios = new Set(logs.map((l) => l.usuario?.id).filter((v) => v != null)).size
    const ultimo = logs.length ? relativa([...logs].sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime())[0].criadoEm) : "—"
    return { total: logs.length, hoje, semana, mes, usuarios, ultimo }
  }, [logs])

  const usuarios = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of logs) if (l.usuario?.nome) m.set(l.usuario.nome, (m.get(l.usuario.nome) ?? 0) + 1)
    return [...m.entries()].map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n).slice(0, 5)
  }, [logs])

  return (
    <div className="h-full overflow-y-auto p-6 text-white/80">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_300px]">
        {/* ── Coluna principal ── */}
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-white">Diário Operacional do Processo <Info className="h-4 w-4 text-white/40" /></h2>
              <p className="text-sm text-white/45">Linha do tempo completa de tudo que aconteceu neste processo</p>
            </div>
            <div className="flex items-center gap-2">
              <button className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#1b2027] px-3 py-2 text-sm text-white/80 hover:bg-[#252c35]"><Download className="h-4 w-4" /> Exportar <ChevronDown className="h-3.5 w-3.5" /></button>
              <button className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#1b2027] px-3 py-2 text-sm text-white/80 hover:bg-[#252c35]"><Filter className="h-4 w-4" /> Filtros <ChevronDown className="h-3.5 w-3.5" /></button>
            </div>
          </div>

          {/* filtros */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[240px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no histórico..." className="w-full rounded-lg border border-white/10 bg-[#12161c] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-white/30" /></div>
            <div className="flex items-center justify-between gap-6 rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 text-sm"><span className="inline-flex items-center gap-1.5 text-white/70"><CalendarDays className="h-3.5 w-3.5 text-white/40" /> Período: Todo o período</span><ChevronDown className="h-3.5 w-3.5 text-white/40" /></div>
            <button onClick={() => { setBusca(""); setTipo("todos") }} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 text-sm text-white/70"><RotateCcw className="h-3.5 w-3.5" /> Limpar filtros</button>
          </div>

          {/* chips por tipo */}
          <div className="mt-3 flex flex-wrap gap-2">
            <ChipTipo ativo={tipo === "todos"} onClick={() => setTipo("todos")} icon={BarChart3} cor="#d2a948" label="Todos" n={logs.length} />
            {TIPOS.map((t) => <ChipTipo key={t.key} ativo={tipo === t.key} onClick={() => setTipo(t.key)} icon={t.icon} cor={t.cor} label={t.label} n={contagem[t.key] ?? 0} />)}
          </div>

          {/* timeline */}
          <div className="mt-5">
            {loading ? <div className="py-16 text-center text-sm text-white/40">Carregando histórico…</div>
              : visiveis.length === 0 ? <div className="py-16 text-center text-sm text-white/40">Nenhum evento no histórico.</div>
              : grupos.map((g) => (
                <div key={g.dia} className="mb-5">
                  <div className="mb-3 text-[13px] font-semibold text-white/55">{g.dia}</div>
                  <div className="relative">
                    {g.itens.map((l, i) => {
                      const t = TIPO_POR_KEY[tipoDoLog(l)]
                      const sub = l.detalhes && typeof l.detalhes === "object" ? Object.entries(l.detalhes).slice(0, 2).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") : ""
                      return (
                        <div key={l.id} className="flex gap-3">
                          <div className="flex w-14 shrink-0 flex-col items-end pt-2 text-right"><span className="text-[12px] tabular-nums text-white/60">{horaBR(l.criadoEm)}</span></div>
                          <div className="flex flex-col items-center pt-2.5"><span className="h-2.5 w-2.5 rounded-full ring-4 ring-[#1b2027]" style={{ background: t.cor }} />{i < g.itens.length - 1 && <span className="mt-1 w-px flex-1 bg-white/10" />}</div>
                          <div className="min-w-0 flex-1 pb-4">
                            <div className={`${CARD} flex items-start gap-3 p-3.5`}>
                              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: `${t.cor}22`, color: t.cor }}><t.icon className="h-4.5 w-4.5" /></span>
                              <div className="min-w-0 flex-1">
                                <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ background: `${t.cor}22`, color: t.cor }}>{t.label}</span>
                                <div className="mt-1 text-sm font-medium text-white/90">{l.descricao}</div>
                                {sub && <div className="mt-0.5 truncate text-[12px] text-white/45">{sub}</div>}
                              </div>
                              <div className="flex shrink-0 items-center gap-2.5">
                                {l.usuario && <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-[#252c35] text-[10px] font-semibold text-white/70">{iniciais(l.usuario.nome)}</span><div className="text-right leading-tight"><div className="text-[12px] text-white/80">{l.usuario.nome}</div><div className="text-[10px] text-white/40">Usuário</div></div></div>}
                                <span className="text-[11px] text-white/40">{relativa(l.criadoEm)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            {!loading && filtrados.length > visiveis.length && (
              <div className="pt-2 text-center"><button onClick={() => setLimite((n) => n + 20)} className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#1b2027] px-4 py-2 text-sm text-white/80 hover:bg-[#252c35]"><ChevronDown className="h-4 w-4" /> Carregar mais eventos</button></div>
            )}
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div className="space-y-4">
          <div className={`${CARD} p-4`}>
            <div className="mb-3 text-sm font-semibold text-white">Resumo do histórico</div>
            <div className="space-y-1.5 text-sm">
              <ResumoLinha k="Total de eventos" v={stats.total} />
              <ResumoLinha k="Hoje" v={stats.hoje} />
              <ResumoLinha k="Esta semana" v={stats.semana} />
              <ResumoLinha k="Este mês" v={stats.mes} />
              <ResumoLinha k="Usuários envolvidos" v={stats.usuarios} />
              <div className="flex justify-between"><span className="text-white/55">Último evento</span><span className="text-white/70">{stats.ultimo}</span></div>
            </div>
          </div>

          <div className={`${CARD} p-4`}>
            <div className="mb-3 text-sm font-semibold text-white">Filtros rápidos</div>
            <div className="space-y-1">
              <FiltroRapido icon={FileText} cor="#4ade80" label="Apenas documentos" n={contagem.documentos ?? 0} onClick={() => setTipo("documentos")} />
              <FiltroRapido icon={CheckSquare} cor="#a78bfa" label="Apenas tarefas" n={contagem.tarefas ?? 0} onClick={() => setTipo("tarefas")} />
              <FiltroRapido icon={Edit3} cor="#d2a948" label="Só alterações" n={contagem.alteracoes ?? 0} onClick={() => setTipo("alteracoes")} />
              <FiltroRapido icon={Mail} cor="#fb923c" label="Apenas comunicação" n={contagem.comunicacao ?? 0} onClick={() => setTipo("comunicacao")} />
              <FiltroRapido icon={GitBranch} cor="#7dd3fc" label="Apenas workflow" n={contagem.workflow ?? 0} onClick={() => setTipo("workflow")} />
            </div>
          </div>

          <div className={`${CARD} p-4`}>
            <div className="mb-3 text-sm font-semibold text-white">Usuários envolvidos</div>
            {usuarios.length === 0 ? <div className="text-xs text-white/40">Sem registros.</div> : (
              <div className="space-y-2">
                {usuarios.map((u) => (
                  <div key={u.nome} className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#252c35] text-[10px] font-semibold text-white/70">{iniciais(u.nome)}</span><span className="truncate text-sm text-white/80">{u.nome}</span></div>
                    <span className="shrink-0 rounded-full bg-[#252c35] px-2 py-0.5 text-[11px] text-white/60">{u.n}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={`${CARD} p-4`}>
            <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-white"><Info className="h-4 w-4 text-white/40" /> Sobre o histórico</div>
            <p className="text-[12px] leading-relaxed text-white/50">Este diário registra todas as ações operacionais realizadas no processo. Informações financeiras estão disponíveis no módulo Financeiro.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function ChipTipo({ ativo, onClick, icon: Ic, cor, label, n }: { ativo: boolean; onClick: () => void; icon: any; cor: string; label: string; n: number }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${ativo ? "border-[#d2a948]/50 bg-[#d2a948]/12" : "border-white/10 bg-[#1b2027] hover:bg-[#252c35]"}`}>
      <Ic className="h-4 w-4" style={{ color: cor }} />
      <span className={ativo ? "text-white/90" : "text-white/70"}>{label}</span>
      <span className="text-[11px] font-semibold" style={{ color: ativo ? "#d2a948" : "rgba(255,255,255,0.5)" }}>{n}</span>
    </button>
  )
}
function ResumoLinha({ k, v }: { k: string; v: number }) {
  return <div className="flex justify-between"><span className="text-white/55">{k}</span><span className="font-semibold tabular-nums text-white/90">{v}</span></div>
}
function FiltroRapido({ icon: Ic, cor, label, n, onClick }: { icon: any; cor: string; label: string; n: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[#252c35]">
      <span className="inline-flex items-center gap-2 text-white/70"><Ic className="h-4 w-4" style={{ color: cor }} /> {label}</span>
      <span className="rounded-full bg-[#252c35] px-2 py-0.5 text-[11px] text-white/60">{n}</span>
    </button>
  )
}
