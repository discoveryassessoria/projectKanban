// Aba "COBRANÇAS" do Financeiro Geral — VISÃO CONSOLIDADA (todos os processos).
// MESMA entidade Cobranca do Financeiro do Processo: nenhuma tabela paralela,
// nenhuma duplicação, nenhuma sincronização. Consulta GET /api/financeiro/cobrancas
// (a versão "todos os processos" do que o Processo mostra filtrado por processoId).
// Clicar numa cobrança abre o MESMO ReceitaCobrancaModal da tela de processo.
"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Search, Receipt, Building2, User, Calendar, Filter } from "lucide-react"
import { ReceitaCobrancaModal } from "@/src/components/financeiro/ReceitaCobrancaModal"

const OURO = "#D2A948"
const GLASS = "rounded-xl border border-white/10 bg-white/[0.05] backdrop-blur-md"

function brl(v: number, moeda = "EUR"): string {
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(v ?? 0) }
  catch { return `${moeda} ${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` }
}
function dt(d: string | Date | null): string {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  ABERTA: { label: "Aberta", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  PARCIAL: { label: "Parcial", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  QUITADA: { label: "Quitada", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  CANCELADA: { label: "Cancelada", cls: "bg-white/10 text-white/50 border-white/15" },
  RENEGOCIADA: { label: "Renegociada", cls: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
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
  const [aberta, setAberta] = useState<number | null>(null) // receitaId

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
    return {
      total: resumo.total,
      valor: resumo.valorTotal,
      recebido: resumo.recebidoTotal,
      saldo: resumo.valorTotal - resumo.recebidoTotal,
    }
  }, [resumo])

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${OURO}22`, color: OURO }}>
          <Receipt className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">Cobranças</h2>
          <p className="text-sm text-white/50">Todas as cobranças de todos os processos — base financeira única.</p>
        </div>
      </div>

      {/* KPIs */}
      {kpis && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className={`${GLASS} p-4`}>
            <p className="text-xs uppercase tracking-wide text-white/40">Cobranças</p>
            <p className="mt-1 text-2xl font-semibold text-white">{kpis.total}</p>
          </div>
          <div className={`${GLASS} p-4`}>
            <p className="text-xs uppercase tracking-wide text-white/40">Valor total</p>
            <p className="mt-1 text-2xl font-semibold" style={{ color: OURO }}>{brl(kpis.valor)}</p>
          </div>
          <div className={`${GLASS} p-4`}>
            <p className="text-xs uppercase tracking-wide text-white/40">Recebido</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-300">{brl(kpis.recebido)}</p>
          </div>
          <div className={`${GLASS} p-4`}>
            <p className="text-xs uppercase tracking-wide text-white/40">Em aberto</p>
            <p className="mt-1 text-2xl font-semibold text-white">{brl(kpis.saldo)}</p>
          </div>
        </div>
      )}

      {/* Filtros + busca */}
      <div className={`${GLASS} flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between`}>
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-white/40" />
          {STATUS_FILTROS.map((s) => (
            <button
              key={s || "todos"}
              onClick={() => setStatus(s)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                status === s ? "border-white/20 bg-white/10 text-white" : "border-transparent text-white/50 hover:text-white"
              }`}
              style={status === s && s ? { borderColor: `${OURO}55`, color: OURO } : undefined}
            >
              {s ? STATUS_META[s]?.label ?? s : "Todas"}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por código, descrição ou processo…"
            className="w-full rounded-lg border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/25 md:w-80"
          />
        </div>
      </div>

      {/* Lista / estados */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-white/50" />
        </div>
      ) : cobrancas.length === 0 ? (
        <div className={`${GLASS} flex flex-col items-center justify-center gap-2 py-16 text-center`}>
          <Receipt className="h-10 w-10 text-white/20" />
          <p className="text-white/60">Nenhuma cobrança encontrada</p>
          <p className="text-sm text-white/35">
            {status || busca ? "Ajuste os filtros de busca." : "As cobranças aparecem aqui assim que forem criadas nos processos."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {cobrancas.map((c) => {
            const meta = STATUS_META[c.status] ?? { label: c.status, cls: "bg-white/10 text-white/60 border-white/15" }
            return (
              <button
                key={c.id}
                onClick={() => setAberta(c.receitaId)}
                className={`${GLASS} group flex w-full items-center gap-4 p-4 text-left transition hover:border-white/20 hover:bg-white/[0.08]`}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: `${OURO}18`, color: OURO }}>
                  <Receipt className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-white">{c.descricao || c.receitaCodigo || `Cobrança #${c.id}`}</span>
                    <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>{meta.label}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/45">
                    {c.processoNome && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{c.processoNome}</span>}
                    {c.requerente && <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{c.requerente}</span>}
                    <span>{c.nParcelas} {c.nParcelas === 1 ? "parcela" : "parcelas"}</span>
                    {c.proximoVencimento && <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />vence {dt(c.proximoVencimento)}</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold" style={{ color: OURO }}>{brl(c.valorTotal, c.moeda)}</p>
                  <p className="mt-0.5 text-xs text-white/45">
                    {c.recebido > 0 ? <span className="text-emerald-300">{brl(c.recebido, c.moeda)} recebido</span> : "sem recebimentos"}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {aberta != null && (
        <ReceitaCobrancaModal
          receitaId={aberta}
          onClose={() => setAberta(null)}
          onChanged={carregar}
        />
      )}
    </div>
  )
}
