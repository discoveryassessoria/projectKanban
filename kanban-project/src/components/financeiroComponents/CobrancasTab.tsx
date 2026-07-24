// COBRANÇAS — Financeiro Geral (visão consolidada, todos os processos).
// MESMA entidade Cobranca do Financeiro do Processo — nenhuma tabela paralela,
// nenhuma duplicação. GET /api/financeiro/cobrancas. Clicar abre o MESMO
// ReceitaCobrancaModal da tela de processo.
//
// Linguagem visual 100% do kit compartilhado: KPIs neutros, filtros/busca/
// estado vazio padronizados, dourado só em ação/ativo, sem cor decorativa.

"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Search, Receipt, Building2, User, Calendar, Filter } from "lucide-react"
import { ReceitaCobrancaModal } from "@/src/components/financeiro/ReceitaCobrancaModal"
import {
  PageHeader, KpiCard, SurfaceCard, FilterChip, SearchInput,
  StatusBadge, EmptyState,
} from "@/src/components/financeiroComponents/ui/kit"

function brl(v: number, moeda = "EUR"): string {
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(v ?? 0) }
  catch { return `${moeda} ${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` }
}
function dt(d: string | Date | null): string {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

const STATUS_META: Record<string, { label: string; tone: "info" | "warning" | "success" | "neutral" | "accent" }> = {
  ABERTA: { label: "Aberta", tone: "info" },
  PARCIAL: { label: "Parcial", tone: "warning" },
  QUITADA: { label: "Quitada", tone: "success" },
  CANCELADA: { label: "Cancelada", tone: "neutral" },
  RENEGOCIADA: { label: "Renegociada", tone: "accent" },
}

interface Cobranca {
  id: number; receitaId: number; processoId: number; moeda: string
  valorTotal: number; status: string; criadoEm: string
  nParcelas: number; recebido: number; saldo: number; proximoVencimento: string | null
  receitaCodigo: string | null; descricao: string | null; requerente: string | null; processoNome: string | null
}
interface Resumo {
  total: number; valorTotal: number; recebidoTotal: number
  porStatus: { status: string; quantidade: number; valor: number }[]
}

const STATUS_FILTROS = ["", "ABERTA", "PARCIAL", "QUITADA", "CANCELADA", "RENEGOCIADA"]

export default function CobrancasTab() {
  const [cobrancas, setCobrancas] = useState<Cobranca[]>([])
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState("")
  const [q, setQ] = useState("")
  const [busca, setBusca] = useState("")
  const [aberta, setAberta] = useState<number | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setBusca(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  async function carregar() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (status) params.set("status", status)
      if (busca) params.set("q", busca)
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
      const r = await fetch(`/api/financeiro/cobrancas?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const j = await r.json()
      setCobrancas(j.cobrancas || [])
      setResumo(j.resumo || null)
    } catch { setCobrancas([]); setResumo(null) }
    finally { setLoading(false) }
  }

  useEffect(() => { carregar() /* eslint-disable-next-line */ }, [status, busca])

  const kpis = useMemo(() => {
    if (!resumo) return null
    return { total: resumo.total, valor: resumo.valorTotal, recebido: resumo.recebidoTotal, saldo: resumo.valorTotal - resumo.recebidoTotal }
  }, [resumo])

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<Receipt className="h-5 w-5" />}
        title="Cobranças"
        subtitle="Todas as cobranças de todos os processos — base financeira única."
      />

      {kpis && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Cobranças" value={kpis.total} />
          <KpiCard label="Valor total" value={brl(kpis.valor)} />
          <KpiCard label="Recebido" value={brl(kpis.recebido)} tone="success" />
          <KpiCard label="Em aberto" value={brl(kpis.saldo)} />
        </div>
      )}

      {/* Filtros + busca */}
      <SurfaceCard padding="p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4" style={{ color: "var(--text-muted)" }} />
            {STATUS_FILTROS.map((s) => (
              <FilterChip key={s || "todos"} active={status === s} onClick={() => setStatus(s)}>
                {s ? STATUS_META[s]?.label ?? s : "Todas"}
              </FilterChip>
            ))}
          </div>
          <SearchInput
            value={q} onChange={setQ} icon={<Search className="h-4 w-4" />}
            placeholder="Buscar por código, descrição ou processo…" className="md:w-80"
          />
        </div>
      </SurfaceCard>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--text-muted)" }} /></div>
      ) : cobrancas.length === 0 ? (
        <SurfaceCard padding="p-0">
          <EmptyState
            icon={<Receipt className="h-6 w-6" />}
            title="Nenhuma cobrança encontrada"
            subtitle={status || busca ? "Ajuste os filtros de busca." : "As cobranças aparecem aqui assim que forem criadas nos processos."}
          />
        </SurfaceCard>
      ) : (
        <div className="space-y-2">
          {cobrancas.map((c) => {
            const meta = STATUS_META[c.status] ?? { label: c.status, tone: "neutral" as const }
            return (
              <SurfaceCard key={c.id} onClick={() => setAberta(c.receitaId)} padding="p-4">
                <div className="flex items-center gap-4 text-left">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border"
                    style={{ background: "var(--surface-secondary)", borderColor: "var(--border-default)", color: "var(--text-secondary)" }}>
                    <Receipt className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium" style={{ color: "var(--text-primary)" }}>{c.descricao || c.receitaCodigo || `Cobrança #${c.id}`}</span>
                      <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      {c.processoNome && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{c.processoNome}</span>}
                      {c.requerente && <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{c.requerente}</span>}
                      <span>{c.nParcelas} {c.nParcelas === 1 ? "parcela" : "parcelas"}</span>
                      {c.proximoVencimento && <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />vence {dt(c.proximoVencimento)}</span>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{brl(c.valorTotal, c.moeda)}</p>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                      {c.recebido > 0 ? <span style={{ color: "var(--success)" }}>{brl(c.recebido, c.moeda)} recebido</span> : "sem recebimentos"}
                    </p>
                  </div>
                </div>
              </SurfaceCard>
            )
          })}
        </div>
      )}

      {aberta != null && (
        <ReceitaCobrancaModal receitaId={aberta} onClose={() => setAberta(null)} onChanged={carregar} />
      )}
    </div>
  )
}
