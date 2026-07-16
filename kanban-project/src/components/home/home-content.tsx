"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  FolderKanban,
  GitBranch,
  LayoutGrid,
  ListChecks,
  LogOut,
  Plus,
  RefreshCw,
  Settings,
  TreeDeciduous,
  TrendingUp,
  Users,
} from "lucide-react"
import type { HomeData } from "@/src/types/home"
import { GlobalSearch } from "@/src/components/home/global-search"
import {
  EmptyState,
  PriorityBadge,
  SectionCard,
  SectionHeader,
  formatarHorario,
  formatarPrazo,
  nivelStyle,
  tempoRelativo,
} from "@/src/components/home/home-primitives"

function saudacao(): string {
  const h = new Date().getHours()
  if (h < 12) return "Bom dia"
  if (h < 18) return "Boa tarde"
  return "Boa noite"
}

// ===========================================================================
// Cabeçalho operacional
// ===========================================================================
function OperationalHeader({ data, onLogout, recarregar }: { data: HomeData; onLogout: () => void; recarregar: () => void }) {
  const { attentionSummary: s, permissions: p } = data
  const dataHoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
  const situacao =
    s.total > 0
      ? `${s.total} ${s.total === 1 ? "item precisa" : "itens precisam"} da sua atenção agora.`
      : "Tudo em dia — nada exige ação imediata."

  return (
    <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{dataHoje}</p>
          <h1 className="mt-0.5 truncate text-xl font-bold tracking-tight text-slate-900 md:text-2xl">
            {saudacao()}, {data.usuario.nome.split(" ")[0]}!
          </h1>
          <p className={`mt-1 flex items-center gap-1.5 text-sm ${s.total > 0 ? "text-slate-700" : "text-emerald-700"}`}>
            {s.total > 0 ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
            <span className="font-medium">{situacao}</span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {p.criarProcesso && (
            <Link href="/kanban" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700">
              <Plus className="h-4 w-4" /> Novo Processo
            </Link>
          )}
          {p.criarTarefa && (
            <Link href="/activities" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-sm font-medium text-white hover:bg-sky-700">
              <Plus className="h-4 w-4" /> Nova Tarefa
            </Link>
          )}
          <Link href="/events" aria-label="Agenda" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <CalendarClock className="h-4 w-4" /> <span className="hidden sm:inline">Agenda</span>
          </Link>
          <button onClick={recarregar} aria-label="Atualizar" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={onLogout} aria-label="Sair" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {p.verProcessos && (
        <div className="mt-4">
          <GlobalSearch />
        </div>
      )}
    </header>
  )
}

// ===========================================================================
// Alertas prioritários
// ===========================================================================
function PriorityAlerts({ data }: { data: HomeData }) {
  const alertas = data.priorityAlerts
  if (alertas.length === 0) {
    return (
      <SectionCard>
        <div className="flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          Nenhum alerta prioritário. Operação sem pendências impeditivas.
        </div>
      </SectionCard>
    )
  }
  return (
    <div>
      <SectionHeader titulo="Alertas prioritários" descricao="O que exige atenção agora" icon={AlertTriangle} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {alertas.map((a) => {
          const st = nivelStyle(a.nivel)
          return (
            <Link
              key={a.key}
              href={a.href}
              className={`group flex items-center gap-3 rounded-xl border p-4 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500/40 ${st.card}`}
            >
              <span className={`flex h-11 min-w-11 items-center justify-center rounded-lg px-2 text-lg font-bold text-white ${st.dot}`}>
                {a.quantidade}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{a.titulo}</p>
                <p className="truncate text-xs text-slate-600">{a.descricao}</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// ===========================================================================
// Próximas ações
// ===========================================================================
function NextActions({ data }: { data: HomeData }) {
  if (!data.permissions.verTarefas) return null
  const acoes = data.nextActions
  return (
    <SectionCard>
      <SectionHeader
        titulo="Próximas ações"
        descricao="Itens executáveis, dos mais urgentes"
        icon={ListChecks}
        acao={
          <Link href="/activities" className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 hover:text-sky-700">
            Ver todas{data.nextActionsTotal ? ` (${data.nextActionsTotal})` : ""} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      {acoes.length === 0 ? (
        <EmptyState icon={CheckCircle2}>Nenhuma ação pendente atribuída a você.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {acoes.map((t) => (
            <li key={t.id}>
              <Link href={t.href} className="flex items-center gap-3 py-2.5 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none">
                <span className={`h-2 w-2 shrink-0 rounded-full ${t.vencida ? "bg-red-500" : t.venceHoje ? "bg-amber-500" : "bg-slate-300"}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{t.titulo}</p>
                  <p className="truncate text-xs text-slate-500">
                    {[t.familiaNome ?? t.processoNome, t.faseLabel, t.responsavelNome ?? "Sem responsável"].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <PriorityBadge prioridade={t.prioridade} />
                <span className={`w-16 shrink-0 text-right text-xs font-medium ${t.vencida ? "text-red-600" : t.venceHoje ? "text-amber-600" : "text-slate-500"}`}>
                  {t.vencida ? "vencida" : t.venceHoje ? "hoje" : formatarPrazo(t.prazo)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

// ===========================================================================
// Fila da equipe
// ===========================================================================
function TeamQueue({ data }: { data: HomeData }) {
  if (!data.permissions.verTarefas) return null
  const grupos = data.teamQueue
  return (
    <SectionCard>
      <SectionHeader titulo="Fila da equipe" descricao="Carga de trabalho por responsável" icon={Users} />
      {grupos.length === 0 ? (
        <EmptyState>Nenhuma tarefa pendente na fila.</EmptyState>
      ) : (
        <ul className="space-y-1.5">
          {grupos.map((g) => (
            <li key={g.key}>
              <Link
                href={g.href}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500/30 ${
                  g.ehMinhas ? "border-sky-200 bg-sky-50/60" : "border-slate-200"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{g.nome}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                    <span>{g.pendentes} pendente{g.pendentes === 1 ? "" : "s"}</span>
                    {g.vencidas > 0 && <span className="text-red-600">· {g.vencidas} vencida{g.vencidas === 1 ? "" : "s"}</span>}
                    {g.criticas > 0 && <span className="text-amber-600">· {g.criticas} crítica{g.criticas === 1 ? "" : "s"}</span>}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

// ===========================================================================
// Processos por fase
// ===========================================================================
function ProcessesByPhase({ data }: { data: HomeData }) {
  if (!data.permissions.verProcessos) return null
  const fases = data.processesByPhase
  const maxTotal = Math.max(1, ...fases.map((f) => f.total))
  return (
    <SectionCard>
      <SectionHeader titulo="Processos por fase" descricao="Distribuição operacional na ordem do Workflow Macro" icon={LayoutGrid} />
      {fases.length === 0 ? (
        <EmptyState icon={FolderKanban}>Nenhuma fase configurada ou processo cadastrado.</EmptyState>
      ) : (
        <div className="space-y-1">
          {fases.map((f) => (
            <Link
              key={f.phaseKey}
              href={f.href}
              className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
            >
              <span className="w-40 shrink-0 truncate text-sm text-slate-700">{f.label}</span>
              <div className="relative h-5 flex-1 overflow-hidden rounded bg-slate-100">
                <div
                  className="h-full rounded bg-sky-500/80 transition-all"
                  style={{ width: `${Math.round((f.total / maxTotal) * 100)}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-900">{f.total}</span>
              <div className="hidden w-28 shrink-0 items-center justify-end gap-1.5 sm:flex">
                {f.bloqueados > 0 && (
                  <span title="Bloqueados" className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">{f.bloqueados} bloq.</span>
                )}
                {f.prontos > 0 && (
                  <span title="Prontos para avançar" className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">{f.prontos} ok</span>
                )}
                {f.slaVencido > 0 && (
                  <span title="SLA vencido" className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">{f.slaVencido} SLA</span>
                )}
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-slate-400" />
            </Link>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ===========================================================================
// Gargalos
// ===========================================================================
function Bottlenecks({ data }: { data: HomeData }) {
  const itens = data.bottlenecks
  if (!data.permissions.verProcessos && !data.permissions.verTarefas) return null
  return (
    <SectionCard>
      <SectionHeader titulo="Gargalos" descricao="Maiores volumes de pendência, por impacto" icon={TrendingUp} />
      {itens.length === 0 ? (
        <EmptyState icon={CheckCircle2}>Nenhum gargalo relevante no momento.</EmptyState>
      ) : (
        <ul className="space-y-1.5">
          {itens.map((b) => {
            const st = nivelStyle(b.nivel)
            return (
              <li key={b.key}>
                <Link href={b.href} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500/30">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{b.titulo}</span>
                  <span className={`rounded px-2 py-0.5 text-sm font-semibold tabular-nums ${st.chip}`}>{b.quantidade}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </SectionCard>
  )
}

// ===========================================================================
// Agenda de hoje
// ===========================================================================
const TIPO_EVENTO_LABEL: Record<string, string> = {
  CONSULADO: "Consulado",
  CARTORIO: "Cartório",
  REUNIAO: "Reunião",
  PRAZO: "Prazo",
  AUDIENCIA: "Audiência",
  ENTREGA_DOCUMENTO: "Entrega",
  OUTRO: "Evento",
}
function TodayAgenda({ data }: { data: HomeData }) {
  if (!data.permissions.verEventos) return null
  const eventos = data.todayAgenda
  return (
    <SectionCard>
      <SectionHeader
        titulo="Agenda de hoje"
        icon={CalendarClock}
        acao={
          <Link href="/events" className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 hover:text-sky-700">
            Ver agenda <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      {eventos.length === 0 ? (
        <EmptyState icon={CalendarClock}>Nenhum compromisso para hoje.</EmptyState>
      ) : (
        <ul className="space-y-1.5">
          {eventos.map((e) => (
            <li key={e.id}>
              <Link href={e.href} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none">
                <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-700">
                  {e.diaInteiro ? "dia" : formatarHorario(e.horario)}
                </span>
                <span className="h-8 w-px shrink-0 bg-slate-200" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{e.titulo}</p>
                  <p className="truncate text-xs text-slate-500">
                    {[TIPO_EVENTO_LABEL[e.tipo] ?? e.tipo, e.processoNome, e.local].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

// ===========================================================================
// Atividade recente
// ===========================================================================
function iconeAtividade(tipo: string) {
  switch (tipo) {
    case "criacao": return { Icon: Plus, cor: "text-emerald-600 bg-emerald-50" }
    case "conclusao": return { Icon: CheckCircle2, cor: "text-sky-600 bg-sky-50" }
    case "movimento": return { Icon: ArrowRight, cor: "text-amber-600 bg-amber-50" }
    case "fase": return { Icon: GitBranch, cor: "text-violet-600 bg-violet-50" }
    default: return { Icon: Clock, cor: "text-slate-500 bg-slate-100" }
  }
}
function RecentActivity({ data }: { data: HomeData }) {
  const atividades = data.recentActivity
  return (
    <SectionCard>
      <SectionHeader
        titulo="Atividade recente"
        icon={Clock}
        acao={
          <Link href="/activities" className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 hover:text-sky-700">
            Ver histórico <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      {atividades.length === 0 ? (
        <EmptyState>Nenhuma atividade recente.</EmptyState>
      ) : (
        <ul className="space-y-0.5">
          {atividades.map((a) => {
            const { Icon, cor } = iconeAtividade(a.tipo)
            const inner = (
              <div className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${cor}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-800">{a.descricao}</p>
                  <p className="text-xs text-slate-400">
                    {[a.usuarioNome, tempoRelativo(a.quando)].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
            )
            return <li key={a.id}>{a.href ? <Link href={a.href} className="block focus:outline-none">{inner}</Link> : inner}</li>
          })}
        </ul>
      )}
    </SectionCard>
  )
}

// ===========================================================================
// Ações rápidas (discretas, sem duplicar o cabeçalho)
// ===========================================================================
function QuickActions() {
  const links = [
    { href: "/kanban", label: "Abrir Kanban", Icon: FolderKanban },
    { href: "/genealogy", label: "Genealogia", Icon: TreeDeciduous },
    { href: "/mensagens", label: "Mensagens", Icon: Bell },
    { href: "/settings", label: "Configurações", Icon: Settings },
  ]
  return (
    <div className="flex flex-wrap items-center gap-2">
      {links.map(({ href, label, Icon }) => (
        <Link key={href} href={href} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
          <Icon className="h-3.5 w-3.5 text-slate-400" /> {label}
        </Link>
      ))}
    </div>
  )
}

// ===========================================================================
// Composição
// ===========================================================================
export function HomeContent({ data, onLogout, recarregar }: { data: HomeData; onLogout: () => void; recarregar: () => void }) {
  const semAcesso = !data.permissions.verProcessos && !data.permissions.verTarefas && !data.permissions.verEventos
  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 md:px-6">
      <OperationalHeader data={data} onLogout={onLogout} recarregar={recarregar} />

      {semAcesso ? (
        <SectionCard className="text-center">
          <div className="py-10">
            <Settings className="mx-auto mb-3 h-8 w-8 text-slate-300" />
            <h3 className="text-base font-semibold text-slate-800">Acesso ainda não liberado</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Sua conta está configurada, mas o administrador ainda não liberou as permissões. Entre em contato para solicitar acesso.
            </p>
          </div>
        </SectionCard>
      ) : (
        <>
          <PriorityAlerts data={data} />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              <NextActions data={data} />
              <ProcessesByPhase data={data} />
              <Bottlenecks data={data} />
            </div>
            <div className="space-y-5">
              <TeamQueue data={data} />
              <TodayAgenda data={data} />
              <RecentActivity data={data} />
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <QuickActions />
          </div>
        </>
      )}
    </div>
  )
}
