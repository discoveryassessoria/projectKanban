"use client"
// F5-UI.4 — Dashboard/Relatório dedicado de Contas a Pagar. Reusa o read-model
// listarContasAPagar (via /api/financeiro/v3/contas-a-pagar). KPIs + gráfico de baldes +
// agrupamentos (fornecedor/moeda) + exportação CSV. Sem lib de gráfico (barras em CSS,
// CSP-safe). Navegação integrada: abrir item chama onAbrirDetalhe.
import { useEffect, useState } from "react"
import { AlertTriangle, CalendarDays, Wallet, Download } from "lucide-react"
import { authHeaders } from "@/src/lib/financeiro/http"

const brl = (v: number) => `R$ ${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`

const BALDES: { key: string; label: string; cor: string }[] = [
  { key: "vencidas", label: "Vencidas", cor: "var(--danger)" },
  { key: "hoje", label: "Vencem hoje", cor: "var(--warning)" },
  { key: "proximas", label: "Próximas (7d)", cor: "var(--accent-primary)" },
  { key: "parciais", label: "Parciais", cor: "var(--info)" },
  { key: "futuras", label: "Futuras", cor: "var(--text-secondary)" },
  { key: "pagas", label: "Pagas", cor: "var(--success)" },
]

function Kpi({ titulo, valor, sub, icon: Ic, cor }: any) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
      <div className="flex items-start justify-between gap-2"><span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{titulo}</span>{Ic && <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)]" style={{ background: `color-mix(in srgb, ${cor} 15%, transparent)`, color: cor }}><Ic className="h-4 w-4" /></span>}</div>
      <div className="mt-2 text-2xl font-bold text-[var(--text-primary)]">{valor}</div>
      <div className="mt-1 text-[11px] text-[var(--text-muted)]">{sub}</div>
    </div>
  )
}

export function ContasAPagarDashboard({ processoId }: { processoId: number }) {
  const [d, setD] = useState<any | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    fetch(`/api/financeiro/v3/contas-a-pagar?processoId=${processoId}`, { headers: authHeaders() }).then((r) => r.json())
      .then((j) => { if (vivo) { j?.ok ? setD(j) : setErro(j?.erro ?? j?.motivo ?? "Falha ao carregar.") } })
      .catch(() => { if (vivo) setErro("Falha ao carregar.") })
    return () => { vivo = false }
  }, [processoId])

  if (erro) return <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-8 text-center text-sm text-[var(--text-muted)]">{erro}</div>
  if (!d) return <div className="py-8 text-sm text-[var(--text-muted)]">carregando…</div>

  const maxBalde = Math.max(1, ...BALDES.map((b) => d.baldes[b.key]?.totalBrl ?? 0))

  const exportarCsv = () => {
    const head = ["Código", "Descrição", "Fornecedor", "Moeda", "Valor", "SaldoBRL", "Vencimento", "Balde", "Estado", "Processo"]
    const linhas = (d.itens as any[]).map((o) => [o.codigoOperacional ?? "", o.descricao ?? "", o.fornecedor ?? "", o.moeda, o.valorContratado, o.saldoBrl, o.vencimento ?? "", o.balde ?? "", o.estadoCusto ?? "", o.processoId ?? ""])
    const csv = [head, ...linhas].map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n")
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a"); a.href = url; a.download = `contas-a-pagar-proc-${processoId}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-[var(--text-primary)]">Contas a Pagar — painel</h2><p className="text-sm text-[var(--text-muted)]">Visão operacional dos pagáveis do processo (motor V3).</p></div>
        <button onClick={exportarCsv} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-active)]"><Download className="h-4 w-4" /> Exportar CSV</button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Kpi titulo="A pagar (aberto)" valor={brl(d.kpis.aPagarBrl)} sub={`${d.kpis.qtdAbertas} conta(s) aberta(s)`} icon={Wallet} cor="var(--warning)" />
        <Kpi titulo="Vencido" valor={brl(d.kpis.vencidoBrl)} sub={`${d.kpis.qtdVencidas} vencida(s)`} icon={AlertTriangle} cor="var(--danger)" />
        <Kpi titulo="Total de contas" valor={String(d.kpis.total)} sub="no processo" icon={CalendarDays} cor="var(--info)" />
      </div>

      {/* Gráfico de baldes (barras CSS) */}
      <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
        <h3 className="mb-4 text-sm font-semibold text-[var(--text-secondary)]">Distribuição por situação</h3>
        <div className="space-y-2.5">
          {BALDES.map((b) => { const v = d.baldes[b.key]?.totalBrl ?? 0; const q = d.baldes[b.key]?.qtd ?? 0; return (
            <div key={b.key} className="flex items-center gap-3">
              <div className="w-28 shrink-0 text-xs text-[var(--text-secondary)]">{b.label}</div>
              <div className="h-4 flex-1 overflow-hidden rounded-full bg-[var(--surface-active)]"><span className="block h-full rounded-full" style={{ width: `${Math.max(v > 0 ? 4 : 0, (v / maxBalde) * 100)}%`, background: b.cor }} /></div>
              <div className="w-40 shrink-0 text-right text-xs text-[var(--text-primary)]">{brl(v)} <span className="text-[var(--text-muted)]">({q})</span></div>
            </div>
          ) })}
        </div>
      </div>

      {/* Agrupamentos */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-secondary)]">Por fornecedor</h3>
          {(d.porFornecedor as any[]).slice(0, 8).map((f) => (
            <div key={f.nome} className="flex items-center justify-between border-t border-[var(--border-default)] py-2 text-sm first:border-t-0"><span className="truncate text-[var(--text-secondary)]">{f.nome}</span><span className="text-[var(--text-primary)]">{brl(f.saldoBrl)} <span className="text-[var(--text-muted)]">({f.qtd})</span></span></div>
          ))}
          {(d.porFornecedor as any[]).length === 0 && <div className="py-4 text-center text-sm text-[var(--text-muted)]">Sem dados</div>}
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-secondary)]">Por moeda</h3>
          {(d.porMoeda as any[]).map((m) => (
            <div key={m.nome} className="flex items-center justify-between border-t border-[var(--border-default)] py-2 text-sm first:border-t-0"><span className="text-[var(--text-secondary)]">{m.nome}</span><span className="text-[var(--text-primary)]">{brl(m.saldoBrl)} <span className="text-[var(--text-muted)]">({m.qtd})</span></span></div>
          ))}
          {(d.porMoeda as any[]).length === 0 && <div className="py-4 text-center text-sm text-[var(--text-muted)]">Sem dados</div>}
        </div>
      </div>
    </div>
  )
}
