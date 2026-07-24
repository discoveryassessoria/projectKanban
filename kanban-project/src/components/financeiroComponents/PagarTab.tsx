// A PAGAR — Financeiro Geral
//
// Fiel ao Golden Master aprovado (imagem oficial): 5 KPIs (Total a Pagar /
// Vencidos / A Vencer 7d / Pago (Mês) / Previsto (Mês)), filtros em chips,
// toolbar (Mês atual + busca), DataTable com Vencimento/Título/Fornecedor/
// Categoria/Processo/Valor/Status/Forma de Pagamento/Ações e paginação.
// Linguagem visual 100% do kit compartilhado.
//
// Somente frontend: consome o endpoint EXISTENTE /api/financas/pagar (GET).
// Campos só-de-exibição do mock (nf/processoCodigo/familia/formaPagamento)
// são OPCIONAIS: aparecem quando existem e degradam para "—" quando não.

"use client"

import { useEffect, useMemo, useState } from "react"
import {
  CreditCard, AlertTriangle, Calendar, CheckCircle, BarChart3, Download,
  Filter, Plus, Loader2, Search, ArrowUpDown, FileText, ChevronDown,
} from "lucide-react"
import { LancamentoDetalheModal } from "@/src/components/financeiro/shared/FinanceiroGeralShared"
import {
  PageHeader, PrimaryButton, SecondaryButton, KpiCard, SurfaceCard,
  Thead, Th, Tr, EmptyState, FilterChip, SearchInput, StatusBadge, ActionMenu,
  Pagination, fmtBRL, fmtDate,
} from "@/src/components/financeiroComponents/ui/kit"

function dueText(d: string | Date | null): string {
  if (!d) return ""
  const dias = Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000)
  if (dias < 0) return `há ${Math.abs(dias)}d`
  if (dias === 0) return "hoje"
  if (dias === 1) return "amanhã"
  return `${dias} dias`
}

interface Conta {
  id: string; fornecedor: string; descricao: string; categoria: string; categoriaCor: string | null
  conta: string | null; valor: number; vencimento: string; dataPagamento: string | null; status: string
  numeroParcela: number | null; totalParcelas: number | null
  pago: boolean; cancelado: boolean; aberto: boolean; vencido: boolean; diasParaVencer: number
  origem?: string; lancamentoOrigem?: { tipo: "custo" | "contaPagar"; id: number }
  // campos só-de-exibição (opcionais)
  nf?: string; processoCodigo?: string; familia?: string; formaPagamento?: string
}
interface PagarData {
  kpis: { aPagar: number; qtdAbertos: number; vencidosTotal: number; qtdVencidos: number; agendadosTotal: number; qtdAgendados: number; pagosMes: number; qtdPagosMes: number; qtdPendentes: number }
  contas: Conta[]
  contagem: { todos: number; vencidos: number; pendentes: number; agendados: number; pagos: number }
  mock: { dpo: number }
}

const CHIPS = [
  { key: "todos", label: "Todos" },
  { key: "vencidos", label: "Vencidos" },
  { key: "avencer", label: "A Vencer" },
  { key: "pagos", label: "Pagos" },
  { key: "cancelados", label: "Cancelados" },
] as const

function estadoConta(c: Conta): { tone: "danger" | "warning" | "success" | "neutral"; label: string } {
  if (c.cancelado) return { tone: "neutral", label: "Cancelado" }
  if (c.pago) return { tone: "success", label: "Pago" }
  if (c.vencido) return { tone: "danger", label: "Vencido" }
  return { tone: "warning", label: "A Vencer" }
}

export default function PagarTab() {
  const [data, setData] = useState<PagarData | null>(null)
  const [loading, setLoading] = useState(true)
  const [chip, setChip] = useState<string>("todos")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [detalhe, setDetalhe] = useState<{ tipo: "receita" | "custo"; id: number } | null>(null)

  useEffect(() => {
    const token = localStorage.getItem("authToken")
    fetch("/api/financas/pagar", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(d => setData(d)).catch(e => console.error(e)).finally(() => setLoading(false))
  }, [])

  const derived = useMemo(() => {
    if (!data) return null
    const now = new Date()
    const sameMonth = (d: string | null) => d && new Date(d).getMonth() === now.getMonth() && new Date(d).getFullYear() === now.getFullYear()
    const avencer = data.contas.filter(c => !c.vencido && !c.pago && !c.cancelado && c.diasParaVencer >= 0 && c.diasParaVencer <= 7)
    const previstoMes = data.contas.filter(c => sameMonth(c.vencimento) && !c.cancelado)
    return {
      aVencer7: avencer.reduce((a, c) => a + c.valor, 0), qtdAVencer7: avencer.length,
      previstoMes: previstoMes.reduce((a, c) => a + c.valor, 0), qtdPrevistoMes: previstoMes.length,
    }
  }, [data])

  if (loading || !data || !derived) return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--text-muted)" }} /></div>

  const k = data.kpis
  const busca = q.trim().toLowerCase()
  const filtradas = data.contas.filter(c => {
    if (chip === "vencidos" && !c.vencido) return false
    if (chip === "avencer" && !(!c.vencido && !c.pago && !c.cancelado)) return false
    if (chip === "pagos" && !c.pago) return false
    if (chip === "cancelados" && !c.cancelado) return false
    if (busca && !(`${c.fornecedor} ${c.descricao} ${c.categoria} ${c.processoCodigo ?? ""} ${c.familia ?? ""}`.toLowerCase().includes(busca))) return false
    return true
  })
  const total = filtradas.length
  const pages = Math.max(1, Math.ceil(total / perPage))
  const pageSafe = Math.min(page, pages)
  const start = (pageSafe - 1) * perPage
  const visiveis = filtradas.slice(start, start + perPage)

  const contagem = (key: string) => {
    if (key === "todos") return data.contas.length
    if (key === "vencidos") return data.contas.filter(c => c.vencido).length
    if (key === "avencer") return data.contas.filter(c => !c.vencido && !c.pago && !c.cancelado).length
    if (key === "pagos") return data.contas.filter(c => c.pago).length
    if (key === "cancelados") return data.contas.filter(c => c.cancelado).length
    return 0
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<CreditCard className="h-5 w-5" />}
        title="A Pagar"
        subtitle="Gerencie todos os seus pagamentos e despesas."
        actions={
          <>
            <SecondaryButton icon={<Download className="h-3.5 w-3.5" />}>Relatório</SecondaryButton>
            <SecondaryButton icon={<Filter className="h-3.5 w-3.5" />}>Filtros <ChevronDown className="h-3 w-3" /></SecondaryButton>
            <PrimaryButton icon={<Plus className="h-3.5 w-3.5" />}>Novo Pagamento</PrimaryButton>
          </>
        }
      />

      {/* KPIs (mesmo componente de A Receber; ícone à direita conforme oficial) */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <KpiCard iconRight iconVariant="plain" icon={<CreditCard className="h-4 w-4" />} label="Total a Pagar" value={fmtBRL(k.aPagar)} sub={`${k.qtdAbertos} títulos`} />
        <KpiCard iconRight iconVariant="plain" iconTone="danger" icon={<AlertTriangle className="h-4 w-4" />} label="Vencidos" value={fmtBRL(k.vencidosTotal)} tone="danger" sub={`${k.qtdVencidos} títulos`} />
        <KpiCard iconRight iconVariant="plain" iconTone="warning" icon={<Calendar className="h-4 w-4" />} label="A Vencer (7 dias)" value={fmtBRL(derived.aVencer7)} tone="warning" sub={`${derived.qtdAVencer7} títulos`} />
        <KpiCard iconRight iconVariant="plain" iconTone="success" icon={<CheckCircle className="h-4 w-4" />} label="Pago (Mês)" value={fmtBRL(k.pagosMes)} tone="success" sub={`${k.qtdPagosMes} títulos`} />
        <KpiCard iconRight iconVariant="plain" icon={<BarChart3 className="h-4 w-4" />} label="Previsto (Mês)" value={fmtBRL(derived.previstoMes)} sub={`${derived.qtdPrevistoMes} títulos`} />
      </div>

      {/* TOOLBAR: chips + Mês atual + busca */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {CHIPS.map(c => (
            <FilterChip key={c.key} active={chip === c.key} onClick={() => { setChip(c.key); setPage(1) }} count={contagem(c.key)}>{c.label}</FilterChip>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm" style={{ background: "var(--surface-primary)", borderColor: "var(--border-default)", color: "var(--text-secondary)" }}>
            <Calendar className="h-3.5 w-3.5" /> Mês atual <ChevronDown className="h-3 w-3" />
          </span>
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1) }} icon={<Search className="h-4 w-4" />} placeholder="Pesquisar…" className="w-56" />
        </div>
      </div>

      {/* TABELA */}
      <SurfaceCard padding="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1040px]">
            <Thead>
              <Th><span className="inline-flex items-center gap-1">Vencimento <ArrowUpDown className="h-3 w-3 opacity-50" /></span></Th>
              <Th><span className="inline-flex items-center gap-1">Título <ArrowUpDown className="h-3 w-3 opacity-50" /></span></Th>
              <Th>Fornecedor</Th><Th>Categoria</Th><Th>Processo</Th>
              <Th align="right">Valor</Th><Th align="center">Status</Th><Th>Forma de Pagamento</Th><Th align="right">Ações</Th>
            </Thead>
            <tbody>
              {visiveis.map(c => {
                const est = estadoConta(c)
                const iconColor = est.tone === "danger" ? "var(--danger)" : est.tone === "success" ? "var(--success)" : est.tone === "warning" ? "var(--warning)" : "var(--text-muted)"
                return (
                  <Tr key={c.id}>
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-2">
                        <span className="grid place-items-center h-7 w-7 rounded-md border shrink-0" style={{ background: "var(--surface-secondary)", borderColor: "var(--border-default)", color: iconColor }}><FileText className="h-3.5 w-3.5" /></span>
                        <div>
                          <div className="tabular-nums" style={{ color: "var(--text-primary)" }}>{fmtDate(c.vencimento)}</div>
                          <div className="text-[10px]" style={{ color: c.vencido ? "var(--danger)" : c.pago ? "var(--success)" : "var(--text-muted)" }}>{c.pago ? "Pago" : c.vencido ? "Vencido" : dueText(c.vencimento)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-2">
                      <div style={{ color: "var(--text-primary)" }}>{c.descricao}</div>
                      {(c.nf || (c.totalParcelas && c.totalParcelas > 1)) && <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{c.nf ? c.nf : `Parcela ${c.numeroParcela} de ${c.totalParcelas}`}</div>}
                    </td>
                    <td className="py-2.5 px-2" style={{ color: "var(--text-secondary)" }}>{c.fornecedor}</td>
                    <td className="py-2.5 px-2" style={{ color: "var(--text-secondary)" }}>{c.categoria}</td>
                    <td className="py-2.5 px-2">
                      <div style={{ color: "var(--text-secondary)" }}>{c.processoCodigo ?? "—"}</div>
                      {c.familia && <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{c.familia}</div>}
                    </td>
                    <td className="py-2.5 px-2 text-right font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>{fmtBRL(c.valor)}</td>
                    <td className="py-2.5 px-2 text-center"><StatusBadge tone={est.tone}>{est.label}</StatusBadge></td>
                    <td className="py-2.5 px-2" style={{ color: "var(--text-secondary)" }}>{c.formaPagamento ?? c.conta ?? "—"}</td>
                    <td className="py-2.5 px-2 text-right"><ActionMenu onClick={() => c.lancamentoOrigem?.tipo === "custo" && setDetalhe({ tipo: "custo", id: c.lancamentoOrigem.id })} /></td>
                  </Tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {total === 0 ? (
          <EmptyState icon={<CreditCard className="h-6 w-6" />} title="Nenhum pagamento neste filtro." subtitle="Ajuste os filtros ou cadastre um novo pagamento." />
        ) : (
          <div className="px-3 pb-3">
            <Pagination from={start + 1} to={Math.min(start + perPage, total)} total={total} unit="títulos" page={pageSafe} pages={pages} onPage={setPage} perPage={perPage} onPerPage={(n) => { setPerPage(n); setPage(1) }} />
          </div>
        )}
      </SurfaceCard>

      {detalhe && <LancamentoDetalheModal tipo={detalhe.tipo} id={detalhe.id} onClose={() => setDetalhe(null)} />}
    </div>
  )
}
