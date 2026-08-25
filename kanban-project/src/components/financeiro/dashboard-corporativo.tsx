// DASHBOARD CORPORATIVO — Financeiro Geral
//
// Extraído de src/app/financeiro/page.tsx (mesma composição, mesmos textos e dados)
// para permitir ajuste visual isolado desta tela sem tocar em componentes globais.
//
// Identidade visual da referência: fundo arquitetônico escurecido, cards glass/dark,
// acento graphite no que é ativo/primário, e as cores de status
// verde / vermelho / azul / âmbar.

"use client"

import { useEffect, useRef } from "react"
import {
  Wallet, ArrowDownRight, ArrowUpRight, AlertTriangle, TrendingUp, Target,
  Activity, Globe, Inbox, CreditCard, FileText, BarChart3, Download, Plus,
  Lock, Scale, Bell, Calendar, CheckCircle, ShieldCheck, MoreVertical,
} from "lucide-react"

// ============================================================
// TOKENS DA REFERÊNCIA
// ============================================================
export const OURO = 'var(--accent-primary)'
export const OURO_TINTA = 'var(--accent-text)'
const CARD = "rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-md"

// ============================================================
// FORMATO
// ============================================================
export function fmtBRL(v: number): string {
  return `R$ ${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
export function fmtBRLshort(v: number): string {
  const n = Math.abs(v ?? 0)
  if (n >= 1000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}k`
  return fmtBRL(v)
}
export function fmtEUR(v: number): string { return `€ ${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
export function fmtUSD(v: number): string { return `US$ ${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
export function fmtPct(v: number): string { return `${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` }
export function fmtDate(d: string | Date | null): string {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}
export function dueText(d: string | Date | null): string {
  if (!d) return ""
  const dias = Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000)
  if (dias < 0) return `há ${Math.abs(dias)}d`
  if (dias === 0) return "hoje"
  if (dias === 1) return "amanhã"
  return `em ${dias}d`
}
const PAIS_FLAG: Record<string, string> = { PORTUGAL: "🇵🇹", ESPANHA: "🇪🇸", ALEMANHA: "🇩🇪", ITALIA: "🇮🇹" }

// ============================================================
// TIPOS
// ============================================================
export interface DashboardData {
  kpis: {
    caixaBRL: number; recebidoMesBRL: number; aReceberMesBRL: number; aPagarBRL: number
    qtdPagarPendentes: number; qtdPagarAgendados: number; inadimplenciaPct: number
    qtdVencidas: number; vencidasBRL: number; lucroMesBRL: number; margemPct: number; processosAtivos: number
  }
  contas: { id: number; nome: string; banco: string | null; saldoBRL: number; cor: string | null }[]
  proximosRecebimentos: { id: number; cliente: string; pais: string | null; processoId: number | null; descricao: string; valorBRL: number; vencimento: string; atrasado: boolean }[]
  proximosPagamentos: { id: number; fornecedor: string; valorBRL: number; vencimento: string; atrasado: boolean }[]
  atividade: { id: number; acao: string; entidade: string; descricao: string; usuario: string; data: string }[]
  fx: { EUR: number; USD: number; BRL: number }
  mock: {
    ticketMedioBRL: number; novosProcessos: number; conversaoPct: number; burnRateBRL: number; runwayDias: number
    dso: number; dpo: number; colaboradores: number
    fechamentoLabel: string; fechamentoStatus: string; conciliacaoDiff: number; conciliacaoPendencias: number
    aVencerFiscalBRL: number; qtdImpostos: number; comissoesPendBRL: number; qtdComissoes: number
    forecast30BRL: number; exposicaoEUR: number; exposicaoUSD: number; exposicaoBRL: number
    serie6meses: { labels: string[]; entradas: number[]; saidas: number[]; saldo: number[]; totalEntradas: number; totalSaidas: number; totalSaldo: number }
    receitaPorPais: Record<string, number>
    alertas: { tipo: string; titulo: string; texto: string; meta: string }[]
  }
}

// ============================================================
// DASHBOARD
// ============================================================
export function DashboardCorporativo({ dash, onGoTab, onClickProcesso }: {
  dash: DashboardData
  onGoTab: (t: string) => void
  onClickProcesso: (id: number, pais: string) => void
}) {
  const k = dash.kpis
  const m = dash.mock
  const hoje = new Date()

  return (
    <div className="space-y-4">
      {/* Header do módulo */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <BarChart3 className="h-5 w-5" style={{ color: OURO_TINTA }} /> Dashboard Corporativo
          </h2>
          <div className="text-xs text-[var(--text-secondary)] mt-1 flex items-center gap-2 flex-wrap">
            <span>{hoje.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</span>
            <span className="text-[var(--text-muted)]">·</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--surface-secondary)]" /><strong className="text-white">{k.processosAtivos}</strong> processos ativos</span>
            <span className="text-[var(--text-muted)]">·</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: OURO }} /><strong className="text-white">{m.colaboradores}</strong> colaboradores</span>
            <span className="text-[var(--text-muted)]">·</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--action-primary)]" /> Contas em dia</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <GlassBtn icon={<BarChart3 className="h-3.5 w-3.5" />} disabled title="Comparação de períodos indisponível nesta visão">Comparar</GlassBtn>
          <GlassBtn icon={<Download className="h-3.5 w-3.5" />} disabled title="Exportação indisponível nesta visão">Exportar</GlassBtn>
          <button
            disabled
            title="Lançamento financeiro é feito dentro de um processo (Processo › Financeiro)"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg text-[var(--accent-ink)] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: OURO }}
          >
            <Plus className="h-3.5 w-3.5" /> Novo Lançamento
          </button>
        </div>
      </div>

      {/* STRIP TOPO: Fechamento / Conciliação / A Vencer */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StripCard topColor="#64748b" icon={<Lock className="h-3.5 w-3.5" />} label="Fechamento Mensal"
          value={m.fechamentoLabel}
          sub={<>Status: <strong className="text-white/80">{m.fechamentoStatus}</strong></>}
          action={{ label: "Ir para DRE", onClick: () => onGoTab("dre") }} />
        <StripCard topColor="#64748b" icon={<Scale className="h-3.5 w-3.5" />} label="Conciliação Bancária"
          value={fmtBRLshort(Math.abs(m.conciliacaoDiff))}
          sub={<>Diferença · {m.conciliacaoPendencias} pendência(s)</>}
          action={{ label: "Conciliar", onClick: () => onGoTab("tesouraria") }} />
        <StripCard topColor="#b91c1c" icon={<AlertTriangle className="h-3.5 w-3.5" />} label="A Vencer (fiscal)"
          value={fmtBRLshort(m.aVencerFiscalBRL)}
          sub={<>{m.qtdImpostos} imposto(s) · Comissões {fmtBRLshort(m.comissoesPendBRL)} ({m.qtdComissoes})</>}
          action={{ label: "Cadastros", onClick: () => onGoTab("comissoes") }} />
      </div>

      {/* KPIs — 8 indicadores em UMA linha (layout oficial) */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi accent="#cbd5e1" icon={<Wallet className="h-4 w-4" />} label="Caixa Consolidado"
          value={fmtBRL(k.caixaBRL)} sub="Saldo das contas bancárias" />
        <Kpi accent="#22c55e" icon={<ArrowDownRight className="h-4 w-4" />} label="Recebido no Mês"
          value={fmtBRL(k.recebidoMesBRL)} sub={`A receber: ${fmtBRL(k.aReceberMesBRL)}`} />
        <Kpi accent="#f59e0b" icon={<ArrowUpRight className="h-4 w-4" />} label="A Pagar"
          value={fmtBRL(k.aPagarBRL)} sub={`${k.qtdPagarPendentes} pendentes · ${k.qtdPagarAgendados} agendados`} />
        <Kpi accent="#ef4444" icon={<AlertTriangle className="h-4 w-4" />} label="Inadimplência"
          value={fmtPct(k.inadimplenciaPct)} sub={`${k.qtdVencidas} parcelas · ${fmtBRL(k.vencidasBRL)}`} />
        <Kpi accent="#22c55e" icon={<TrendingUp className="h-4 w-4" />} label="Lucro do Mês"
          value={fmtBRL(k.lucroMesBRL)} sub={`Realizado · ${hoje.getDate()}/31 dias`} />
        <Kpi accent={OURO} icon={<Target className="h-4 w-4" />} label="Margem Líquida"
          value={fmtPct(k.margemPct)} sub="Meta 35%" />
        <Kpi accent="#38bdf8" icon={<Activity className="h-4 w-4" />} label="Forecast 30 dias"
          value={fmtBRL(m.forecast30BRL)} sub="Entrada líquida prevista" mock />
        <Kpi accent="#38bdf8" icon={<Globe className="h-4 w-4" />} label="Exposição Cambial"
          value={fmtBRL(m.exposicaoBRL)} sub={`${fmtEUR(m.exposicaoEUR)} + ${fmtUSD(m.exposicaoUSD)}`} mock />
      </div>

      {/* MINI-KPIS (6) */}
      <div className={`${CARD} px-2 py-3`}>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-y-3">
          <Mini label="Ticket Médio" value={fmtBRLshort(m.ticketMedioBRL)} hint="↗ +5,2%" />
          <Mini label="Novos Processos" value={`${m.novosProcessos}`} hint="este mês" />
          <Mini label="Conversão Lead→Cliente" value={`${m.conversaoPct}%`} hint="↗ +3 pontos" />
          <Mini label="Burn Rate (30 dias)" value={fmtBRLshort(m.burnRateBRL)} hint={`Runway ~${m.runwayDias}d`} />
          <Mini label="DSO – A Receber" value={`${m.dso}`} hint="dias" />
          <Mini label="DPO – A Pagar" value={`${m.dpo}`} hint="dias" last />
        </div>
      </div>

      {/* GRÁFICO + ALERTAS */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <div className={`lg:col-span-3 ${CARD} p-4`}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-white flex items-center gap-2"><Activity className="h-4 w-4" style={{ color: OURO_TINTA }} /> Entradas vs Saídas · Últimos 6 meses</div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)] bg-[var(--surface-primary)] border border-[var(--border-default)] px-2 py-1 rounded-md">6 meses <span className="text-[var(--text-muted)]">▾</span></span>
              <button type="button" aria-label="Opções do gráfico" className="text-[var(--text-muted)] hover:text-white/80 transition-colors">
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
          </div>
          <FluxoChart serie={m.serie6meses} />
          <div className="flex gap-5 mt-3 text-xs text-white/70 flex-wrap">
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[var(--action-primary)]" /> Entradas · <strong className="text-white">{fmtBRL(m.serie6meses.totalEntradas)}</strong></span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-600" /> Saídas · <strong className="text-white">{fmtBRL(m.serie6meses.totalSaidas)}</strong></span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[var(--surface-secondary)]" /> Saldo · <strong className="text-white">{fmtBRL(m.serie6meses.totalSaldo)}</strong></span>
          </div>
        </div>
        <div className={`lg:col-span-2 ${CARD} p-4`}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-white flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" style={{ color: OURO_TINTA }} /> Alertas e Aprovações
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                m.alertas.length === 0
                  ? "bg-[var(--surface-primary)] text-[var(--text-secondary)] border-[var(--border-default)]"
                  : "bg-[var(--surface-secondary)] text-red-700 border-[var(--border-default)]"
              }`}>{m.alertas.length}</span>
            </div>
            <button onClick={() => onGoTab("auditoria")} className="text-xs text-[var(--text-secondary)] hover:text-white">Ver todos</button>
          </div>
          {m.alertas.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-10">
              <div className="h-12 w-12 rounded-full grid place-items-center bg-[var(--surface-secondary)] border border-[var(--border-default)] mb-3">
                <ShieldCheck className="h-6 w-6 text-green-800" />
              </div>
              <p className="text-sm text-[var(--text-secondary)]">Nenhum alerta ou aprovação pendente</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Tudo em dia!</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {m.alertas.map((a, i) => <AlertCard key={i} {...a} />)}
            </div>
          )}
        </div>
      </div>

      {/* LINHA 1: Próximos Recebimentos · Pagamentos · Exposição Cambial · Atividade Recente (4 colunas, layout oficial) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <ListCard icon={<Inbox className="h-4 w-4" style={{ color: OURO_TINTA }} />} title="Próximos Recebimentos"
          onVerTodos={() => onGoTab("receber")} empty="Nenhum recebimento em aberto."
          colLeft="Cliente" colMid="Descrição"
          rows={dash.proximosRecebimentos.map(r => ({
            id: r.id, left: `${r.pais ? PAIS_FLAG[r.pais] + " " : ""}${r.cliente}`, mid: r.descricao,
            val: fmtBRL(r.valorBRL), due: fmtDate(r.vencimento), dueHint: dueText(r.vencimento),
            critical: r.atrasado, onClick: () => r.processoId && r.pais && onClickProcesso(r.processoId, r.pais),
          }))} />
        <ListCard icon={<CreditCard className="h-4 w-4" style={{ color: OURO_TINTA }} />} title="Próximos Pagamentos"
          onVerTodos={() => onGoTab("pagar")} empty="Nenhum pagamento em aberto."
          colLeft="Fornecedor" colMid="Vencimento"
          rows={dash.proximosPagamentos.map(p => ({
            id: p.id, left: p.fornecedor, mid: fmtDate(p.vencimento), val: fmtBRL(p.valorBRL),
            due: fmtDate(p.vencimento), dueHint: dueText(p.vencimento), critical: p.atrasado,
          }))} />
        <div className={`${CARD} p-4`}>
          <div className="text-sm font-semibold text-white flex items-center gap-2 mb-3"><Globe className="h-4 w-4" style={{ color: OURO_TINTA }} /> Exposição Cambial <span className="text-[10px] text-[var(--text-muted)] bg-[var(--surface-primary)] px-1.5 py-0.5 rounded">prévia</span></div>
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3 mb-2">
            <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)] font-semibold uppercase tracking-wide">
              <span>🇪🇺 EUR</span><span>@ R$ {dash.fx.EUR.toFixed(2)}</span>
            </div>
            <div className="text-xl font-bold text-white mt-1">{fmtEUR(m.exposicaoEUR)}</div>
            <div className="text-xs text-[var(--text-secondary)]">≈ {fmtBRL(m.exposicaoEUR * dash.fx.EUR)}</div>
          </div>
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
            <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)] font-semibold uppercase tracking-wide">
              <span>🇺🇸 USD</span><span>@ R$ {dash.fx.USD.toFixed(2)}</span>
            </div>
            <div className="text-xl font-bold text-white mt-1">{fmtUSD(m.exposicaoUSD)}</div>
            <div className="text-xs text-[var(--text-secondary)]">≈ {fmtBRL(m.exposicaoUSD * dash.fx.USD)}</div>
          </div>
        </div>
        <div className={`${CARD} p-4`}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-white flex items-center gap-2"><FileText className="h-4 w-4" style={{ color: OURO_TINTA }} /> Atividade Recente</div>
            <button onClick={() => onGoTab("auditoria")} className="text-xs text-[var(--text-secondary)] hover:text-white">Ver auditoria</button>
          </div>
          <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
            {dash.atividade.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-6 text-center">Sem registros de auditoria.</p>
            ) : dash.atividade.map(a => (
              <div key={a.id} className="text-xs border-l-2 border-[var(--border-strong)] pl-3 py-1">
                <div className="text-[var(--text-muted)]">{fmtDate(a.data)}</div>
                <div className="text-white/80"><span className="font-medium">{a.usuario}</span> · {a.acao}</div>
                <div className="text-[var(--text-muted)]">{a.entidade}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* LINHA 2: Receita por País · Contas Bancárias */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className={`${CARD} p-4`}>
          <div className="text-sm font-semibold text-white flex items-center gap-2 mb-3"><Globe className="h-4 w-4" style={{ color: OURO_TINTA }} /> Receita por País · YTD <span className="text-[10px] text-[var(--text-muted)] bg-[var(--surface-primary)] px-1.5 py-0.5 rounded">prévia</span></div>
          <ReceitaPaisBars data={m.receitaPorPais} />
        </div>

        <div className={`${CARD} p-4`}>
          <div className="text-sm font-semibold text-white flex items-center gap-2 mb-3"><Wallet className="h-4 w-4" style={{ color: OURO_TINTA }} /> Contas Bancárias</div>
          {dash.contas.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-4 text-center">Nenhuma conta bancária cadastrada.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {dash.contas.map(c => (
                <div key={c.id} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-secondary)]">{c.banco || "Conta"}</span>
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.cor || "#64748b" }} />
                  </div>
                  <div className="text-white font-semibold mt-1">{c.nome}</div>
                  <div className="text-lg font-bold text-white mt-1">{fmtBRL(c.saldoBRL)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// GRÁFICO Chart.js (linha de área: Entradas / Saídas / Saldo)
// ============================================================
function FluxoChart({ serie }: { serie: DashboardData["mock"]["serie6meses"] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<any>(null)

  useEffect(() => {
    let cancelled = false
    async function draw() {
      const Chart = (await import("chart.js/auto")).default
      if (cancelled || !ref.current) return
      if (chartRef.current) chartRef.current.destroy()
      chartRef.current = new Chart(ref.current, {
        type: "line",
        data: {
          labels: serie.labels,
          datasets: [
            { label: "Entradas", data: serie.entradas, borderColor: "#4ade80", backgroundColor: "rgba(74,222,128,0.12)", fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: "#4ade80" },
            { label: "Saídas", data: serie.saidas, borderColor: "#f87171", backgroundColor: "rgba(248,113,113,0.10)", fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: "#f87171" },
            { label: "Saldo", data: serie.saldo, borderColor: "#7dd3fc", borderDash: [4, 4], fill: false, tension: 0.35, borderWidth: 2, pointRadius: 2 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: {
              ticks: {
                // evita rótulos redundantes ("R$ -0k") quando a série é toda zero
                callback: (v: any) => "R$ " + (Object.is(Math.round(v / 1000), -0) ? 0 : Math.round(v / 1000)) + "k",
                color: "var(--text-muted)", font: { size: 10.5 },
                maxTicksLimit: 6,
              },
              beginAtZero: true,
              grid: { color: "var(--text-muted)" },
            },
            x: { ticks: { color: "var(--text-muted)", font: { size: 10.5 } }, grid: { display: false } },
          },
        },
      })
    }
    draw()
    return () => { cancelled = true; if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null } }
  }, [serie])

  return <div className="h-56"><canvas ref={ref} /></div>
}

// ============================================================
// SUBCOMPONENTES
// ============================================================
function GlassBtn({ icon, children, onClick, disabled, title }: { icon: React.ReactNode; children: React.ReactNode; onClick?: () => void; disabled?: boolean; title?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-[var(--surface-primary)] border border-[var(--border-strong)] text-white/90 hover:bg-[var(--surface-hover)] hover:text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--surface-hover)]">
      {icon}{children}
    </button>
  )
}

function StripCard({ topColor, icon, label, value, valueColor = "text-white", sub, action, mock }: {
  topColor: string; icon: React.ReactNode; label: string; value: string; valueColor?: string
  sub: React.ReactNode; action: { label: string; onClick: () => void }; mock?: boolean
}) {
  // Neutralização: sem borda superior colorida (decorativa). Valor mantém cor
  // semântica só quando fizer sentido (valueColor).
  void topColor
  return (
    <div className={`${CARD} p-4 relative`}>
      {mock && <span className="absolute top-2 right-2 text-[9px] text-[var(--text-muted)] bg-[var(--surface-primary)] px-1.5 py-0.5 rounded">prévia</span>}
      <div className="flex items-center gap-1.5 text-[var(--text-secondary)] text-xs font-medium">{icon}{label}</div>
      <div className={`text-[22px] font-bold mt-1 ${valueColor}`}>{value}</div>
      <div className="text-[11px] text-[var(--text-muted)] mt-1">{sub}</div>
      <button onClick={action.onClick} className="mt-2 text-[11px] px-2.5 py-1 rounded-md border border-[var(--border-strong)] text-white/80 hover:bg-[var(--surface-hover)] transition-colors">{action.label}</button>
    </div>
  )
}

// KPI conforme layout oficial: ícone com cor SEMÂNTICA (o significado vive no
// ícone), rótulo em caixa normal, VALOR branco, SEM linha colorida inferior,
// SEM borda colorida. Todos os 8 KPIs têm o mesmo tamanho (uma linha).
function Kpi({ icon, label, value, sub, mock, accent }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; mock?: boolean; accent: string
}) {
  return (
    <div className={`${CARD} relative overflow-hidden`}>
      {mock && <span className="absolute top-2 right-2 text-[9px] text-[var(--text-muted)] bg-[var(--surface-primary)] px-1.5 py-0.5 rounded">prévia</span>}
      <div className="p-3.5">
        <div className="flex items-center gap-2">
          <span
            className="h-9 w-9 shrink-0 rounded-full grid place-items-center"
            style={{ background: `${accent}1f`, border: `1px solid ${accent}40`, color: accent }}
          >
            {icon}
          </span>
          <span className={`text-[11px] font-semibold text-[var(--text-secondary)] leading-tight ${mock ? "pr-8" : ""}`}>{label}</span>
        </div>
        <div className="font-bold mt-2 text-xl text-white">{value}</div>
        {sub && <div className="text-[11px] text-[var(--text-muted)] mt-1">{sub}</div>}
      </div>
    </div>
  )
}

function Mini({ label, value, hint, mock, last }: { label: string; value: string; hint: string; mock?: boolean; last?: boolean }) {
  return (
    <div className={`px-3 ${last ? "" : "xl:border-r border-[var(--border-default)]"}`}>
      <div className="text-[10px] text-[var(--text-muted)] font-semibold uppercase tracking-wide flex items-center gap-1 xl:whitespace-nowrap">
        {label}{mock && <span className="text-[var(--text-muted)]">·prévia</span>}
      </div>
      <div className="text-base font-bold text-white mt-1">{value} <span className="text-[11px] text-[var(--text-muted)] font-medium">{hint}</span></div>
    </div>
  )
}

function AlertCard({ tipo, titulo, texto, meta }: { tipo: string; titulo: string; texto: string; meta: string }) {
  const styles: Record<string, { border: string; icon: React.ReactNode }> = {
    critical: { border: "border-l-red-400", icon: <AlertTriangle className="h-4 w-4 text-red-700" /> },
    warning: { border: "border-l-amber-400", icon: <Bell className="h-4 w-4 text-amber-800" /> },
    info: { border: "border-l-sky-400", icon: <Calendar className="h-4 w-4 text-[var(--text-secondary)]" /> },
    success: { border: "border-l-green-400", icon: <CheckCircle className="h-4 w-4 text-green-800" /> },
  }
  const s = styles[tipo] || styles.info
  return (
    <div className={`flex gap-2 items-start bg-[var(--surface-primary)] border border-[var(--border-default)] border-l-2 ${s.border} rounded-lg p-2.5`}>
      <div className="mt-0.5">{s.icon}</div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-white">{titulo}</div>
        <div className="text-xs text-white/70">{texto}</div>
        <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{meta}</div>
      </div>
    </div>
  )
}

function ReceitaPaisBars({ data }: { data: Record<string, number> }) {
  const cores: Record<string, string> = { "Itália": "#ef4444", "Espanha": "#f59e0b", "Alemanha": "#94a3b8", "Portugal": "#16a34a" }
  const total = Object.values(data).reduce((a, b) => a + b, 0) || 1
  return (
    <div className="space-y-2.5">
      {Object.entries(data).map(([pais, val]) => (
        <div key={pais}>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-white/80 inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: cores[pais] || "#64748b" }} />{pais}</span>
            <strong className="text-white">{fmtBRL(val)}</strong>
          </div>
          <div className="h-1.5 bg-[var(--surface-primary)] rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(val / total) * 100}%`, background: cores[pais] || "#64748b" }} />
          </div>
        </div>
      ))}
    </div>
  )
}

interface Row { id: number; left: string; mid: string; val: string; due: string; dueHint: string; critical?: boolean; onClick?: () => void }
function ListCard({ icon, title, rows, colLeft, colMid, empty, onVerTodos }: {
  icon: React.ReactNode; title: string; rows: Row[]; colLeft: string; colMid: string; empty: string; onVerTodos: () => void
}) {
  return (
    <div className={`${CARD} p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-white flex items-center gap-2">{icon}{title}</div>
        <button onClick={onVerTodos} className="text-xs text-[var(--text-secondary)] hover:text-white">Ver todos</button>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-8">
          <div className="h-11 w-11 rounded-full grid place-items-center bg-[var(--surface-primary)] border border-[var(--border-default)] mb-2 opacity-40">{icon}</div>
          <p className="text-sm text-[var(--text-muted)]">{empty}</p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[var(--text-muted)] text-xs border-b border-[var(--border-default)]">
              <th className="text-left font-medium py-1.5">{colLeft}</th>
              <th className="text-left font-medium py-1.5">{colMid}</th>
              <th className="text-right font-medium py-1.5">Valor</th>
              <th className="text-right font-medium py-1.5">Vencimento</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} onClick={r.onClick}
                className={`border-b border-[var(--border-subtle)] last:border-0 ${r.onClick ? "cursor-pointer hover:bg-[var(--surface-hover)]" : ""}`}>
                <td className="py-2 text-white/90"><span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 ${r.critical ? "bg-red-600" : "bg-[var(--surface-secondary)]"}`} />{r.left}</td>
                <td className="py-2 text-[var(--text-secondary)]">{r.mid}</td>
                <td className="py-2 text-right text-white font-medium tabular-nums">{r.val}</td>
                <td className="py-2 text-right tabular-nums">
                  <div className="text-white/80">{r.due}</div>
                  <div className={`text-[10px] ${r.critical ? "text-red-700" : "text-[var(--text-muted)]"}`}>{r.dueHint}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
