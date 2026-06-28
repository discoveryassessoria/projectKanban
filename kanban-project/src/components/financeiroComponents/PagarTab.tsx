// CRIAR EM: src/components/financeiroComponents/PagarTab.tsx
//
// Aba "A PAGAR" — porte fiel do renderPagar() do mockup, estilo glass.
// Autossuficiente: busca /api/financas/pagar. Dados REAIS (ContaPagar→
// Fornecedor/Categoria/ContaBancaria). Só DPO é "prévia".

"use client"

import { useEffect, useState } from "react"
import {
  CreditCard, FileText, AlertTriangle, Clock, CheckCircle, RefreshCw,
  Landmark, Upload, Plus, Loader2, Check, MoreHorizontal,
} from "lucide-react"

function fmtBRL(v: number): string { return `R$ ${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtBRLshort(v: number): string {
  const n = Math.abs(v ?? 0)
  if (n >= 1000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}k`
  return fmtBRL(v)
}
function fmtDate(d: string | Date | null): string {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}
function dueText(d: string | Date | null): string {
  if (!d) return ""
  const dias = Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000)
  if (dias < 0) return `há ${Math.abs(dias)}d`
  if (dias === 0) return "hoje"
  if (dias === 1) return "amanhã"
  return `em ${dias}d`
}

interface Conta {
  id: number; fornecedor: string; descricao: string; categoria: string; categoriaCor: string | null
  conta: string | null; valor: number; vencimento: string; dataPagamento: string | null; status: string
  numeroParcela: number | null; totalParcelas: number | null
  pago: boolean; cancelado: boolean; aberto: boolean; vencido: boolean; diasParaVencer: number
}
interface PagarData {
  kpis: { aPagar: number; qtdAbertos: number; vencidosTotal: number; qtdVencidos: number; agendadosTotal: number; qtdAgendados: number; pagosMes: number; qtdPagosMes: number; qtdPendentes: number }
  pipeline: { pendente: { qtd: number; total: number }; agendado: { qtd: number; total: number }; pago: { qtd: number; total: number }; cancelado: { qtd: number; total: number } }
  topCategorias: { nome: string; total: number; cor: string | null; qtd: number }[]
  proximos7: { id: number; fornecedor: string; valor: number; vencimento: string }[]
  resumo: { total: number; vencido: number; agendados: number; pagos: number; previstoFuturo: number }
  contas: Conta[]
  contagem: { todos: number; vencidos: number; pendentes: number; agendados: number; pagos: number }
  mock: { dpo: number }
}

const CHIPS = [
  { key: "todos", label: "Todos" },
  { key: "vencidos", label: "Vencidos" },
  { key: "pendentes", label: "Pendentes" },
  { key: "agendados", label: "Agendados" },
  { key: "pagos", label: "✓ Pagos" },
] as const

function statusBadge(c: Conta) {
  if (c.vencido) return <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30">Vencido</span>
  if (c.pago) return <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/30">Pago</span>
  if (c.cancelado) return <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 text-white/50 border border-white/20">Cancelado</span>
  if (c.status === "AGENDADO") return <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30">Agendado</span>
  return <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">Pendente</span>
}

export default function PagarTab() {
  const [data, setData] = useState<PagarData | null>(null)
  const [loading, setLoading] = useState(true)
  const [chip, setChip] = useState<string>("todos")

  useEffect(() => {
    const token = localStorage.getItem("authToken")
    fetch("/api/financas/pagar", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(d => setData(d)).catch(e => console.error(e)).finally(() => setLoading(false))
  }, [])

  if (loading || !data) return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>

  const d = data
  const k = d.kpis

  const contasFiltradas = d.contas.filter(c => {
    if (chip === "todos") return true
    if (chip === "vencidos") return c.vencido
    if (chip === "pendentes") return c.status === "PENDENTE" && !c.vencido
    if (chip === "agendados") return c.status === "AGENDADO" && !c.vencido
    if (chip === "pagos") return c.pago
    return true
  })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><CreditCard className="h-5 w-5" /> Contas a Pagar</h2>
          <div className="text-xs text-white/60 mt-1 flex items-center gap-2 flex-wrap">
            <span><strong className="text-white">{k.qtdAbertos}</strong> pagamentos abertos</span>
            <span className="text-white/30">·</span>
            <span><strong className="text-white">{k.qtdAgendados}</strong> agendados</span>
            <span className="text-white/30">·</span>
            <span><strong className="text-white">{k.qtdPendentes}</strong> pendentes</span>
            <span className="text-white/30">·</span>
            <span>DPO atual: <strong className="text-white">{d.mock.dpo} dias</strong> <span className="text-white/30">·prévia</span></span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <GlassBtn icon={<RefreshCw className="h-3.5 w-3.5" />}>Recorrentes</GlassBtn>
          <GlassBtn icon={<Landmark className="h-3.5 w-3.5" />}>Por fornecedor</GlassBtn>
          <GlassBtn icon={<Upload className="h-3.5 w-3.5" />}>Exportar</GlassBtn>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white"><Plus className="h-3.5 w-3.5" /> Nova despesa</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<FileText className="h-3.5 w-3.5" />} label="Total a Pagar" value={fmtBRL(k.aPagar)} valueColor="text-amber-400" sub={`${k.qtdAbertos} pagamentos`} />
        <Kpi icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Vencidos" value={fmtBRL(k.vencidosTotal)} valueColor={k.vencidosTotal > 0 ? "text-red-400" : "text-green-400"} sub={k.qtdVencidos > 0 ? `${k.qtdVencidos} atrasados` : "✓ Em dia"} />
        <Kpi icon={<Clock className="h-3.5 w-3.5" />} label="Agendados" value={fmtBRL(k.agendadosTotal)} sub={`${k.qtdAgendados} prontos p/ pagar`} />
        <Kpi icon={<CheckCircle className="h-3.5 w-3.5" />} label="Pago no mês" value={fmtBRL(k.pagosMes)} valueColor="text-green-400" sub={`${k.qtdPagosMes} pagamentos efetuados`} />
      </div>

      {/* PIPELINE */}
      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-white flex items-center gap-2"><RefreshCw className="h-4 w-4" /> Pipeline de Pagamentos</div>
          <span className="text-[11px] text-white/40">{d.contagem.todos} no funil</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <PipelineCard color="#f59e0b" label="Pendente" qtd={d.pipeline.pendente.qtd} total={d.pipeline.pendente.total} hint="Aguardando" />
          <PipelineCard color="#0ea5e9" label="Agendado" qtd={d.pipeline.agendado.qtd} total={d.pipeline.agendado.total} hint="Pronto p/ pagar" />
          <PipelineCard color="#22c55e" label="Pago" qtd={d.pipeline.pago.qtd} total={d.pipeline.pago.total} hint="Concluído" />
          <PipelineCard color="#94a3b8" label="Cancelado" qtd={d.pipeline.cancelado.qtd} total={d.pipeline.cancelado.total} hint="Encerrado" />
        </div>
      </div>

      {/* QUICK CHIPS */}
      <div className="flex items-center gap-2 flex-wrap">
        {CHIPS.map(c => {
          const count = (d.contagem as any)[c.key] ?? 0
          const active = chip === c.key
          return (
            <button key={c.key} onClick={() => setChip(c.key)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors ${active ? "bg-white/15 border-white/30 text-white" : "bg-white/5 border-white/10 text-white/60 hover:text-white"}`}>
              {c.label}<span className="text-[10px] bg-white/10 px-1.5 rounded-full">{count}</span>
            </button>
          )
        })}
      </div>

      {/* TABELA + PAINÉIS */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        <div className="lg:col-span-3 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4 overflow-x-auto">
          {contasFiltradas.length === 0 ? (
            <p className="text-sm text-white/40 py-10 text-center">Nenhum pagamento neste filtro.</p>
          ) : (
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-white/40 text-xs border-b border-white/10">
                  <th className="text-left font-medium py-1.5">Fornecedor</th>
                  <th className="text-left font-medium py-1.5">Descrição</th>
                  <th className="text-left font-medium py-1.5">Categoria</th>
                  <th className="text-left font-medium py-1.5">Conta</th>
                  <th className="text-right font-medium py-1.5">Vencimento</th>
                  <th className="text-right font-medium py-1.5">Valor</th>
                  <th className="text-center font-medium py-1.5">Status</th>
                  <th className="text-center font-medium py-1.5">Ações</th>
                </tr>
              </thead>
              <tbody>
                {contasFiltradas.map(c => (
                  <tr key={c.id} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                    <td className="py-2 text-white/90 font-medium">{c.fornecedor}</td>
                    <td className="py-2">
                      <div className="text-white/80">{c.descricao}</div>
                      {c.totalParcelas && c.totalParcelas > 1 && c.numeroParcela && <div className="text-[11px] text-white/40">Parcela {c.numeroParcela} de {c.totalParcelas}</div>}
                    </td>
                    <td className="py-2">
                      <span className="text-[11px] px-2 py-0.5 rounded" style={{ background: c.categoriaCor ? `${c.categoriaCor}33` : "rgba(255,255,255,0.1)", color: c.categoriaCor || "rgba(255,255,255,0.7)" }}>{c.categoria}</span>
                    </td>
                    <td className="py-2 text-white/60 text-xs">{c.conta || "—"}</td>
                    <td className="py-2 text-right tabular-nums">
                      <div className="text-white/80">{fmtDate(c.vencimento)}</div>
                      <div className={`text-[10px] ${c.vencido ? "text-red-400" : "text-white/40"}`}>{c.pago ? "pago " + fmtDate(c.dataPagamento) : dueText(c.vencimento)}</div>
                    </td>
                    <td className="py-2 text-right text-white font-medium tabular-nums">{fmtBRL(c.valor)}</td>
                    <td className="py-2 text-center">{statusBadge(c)}</td>
                    <td className="py-2 text-center">
                      {c.status === "AGENDADO" && !c.pago ? (
                        <button className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-green-600/80 hover:bg-green-600 text-white"><Check className="h-3 w-3" /> Pagar</button>
                      ) : (c.status === "PENDENTE" || c.vencido) && !c.pago ? (
                        <button className="px-2 py-1 text-[11px] rounded border border-white/20 text-white/80 hover:bg-white/10">Agendar</button>
                      ) : c.pago ? (
                        <span className="text-[11px] text-green-300">✓ Pago</span>
                      ) : (
                        <button className="text-white/40 hover:text-white"><MoreHorizontal className="h-4 w-4" /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="space-y-3">
          <SidePanel title="Resumo do período">
            <Row label="Total a pagar" value={fmtBRLshort(d.resumo.total)} />
            <Row label="Vencido" value={fmtBRLshort(d.resumo.vencido)} valueColor="text-red-400" />
            <Row label="Agendados" value={fmtBRLshort(d.resumo.agendados)} valueColor="text-sky-400" />
            <Row label="Já pagos" value={fmtBRLshort(d.resumo.pagos)} valueColor="text-green-400" />
            <Row label="Previsto futuro" value={fmtBRLshort(d.resumo.previstoFuturo)} />
          </SidePanel>
          <SidePanel title="Top categorias">
            {d.topCategorias.length === 0 ? (
              <p className="text-xs text-white/40">Sem despesas em aberto.</p>
            ) : d.topCategorias.slice(0, 6).map(cat => (
              <Row key={cat.nome} label={<span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: cat.cor || "#64748b" }} />{cat.nome}</span>} value={fmtBRLshort(cat.total)} />
            ))}
          </SidePanel>
          <SidePanel title="Próximos 7 dias">
            {d.proximos7.length === 0 ? (
              <p className="text-xs text-white/40">Nenhum pagamento nos próximos 7 dias.</p>
            ) : d.proximos7.map(p => (
              <div key={p.id} className="flex justify-between items-start text-sm">
                <div>
                  <div className="text-white/80">{p.fornecedor}</div>
                  <div className="text-[10px] text-white/40">{fmtDate(p.vencimento)} · {dueText(p.vencimento)}</div>
                </div>
                <span className="text-white font-medium">{fmtBRLshort(p.valor)}</span>
              </div>
            ))}
          </SidePanel>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// SUBCOMPONENTES
// ============================================================
function GlassBtn({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-transparent border border-white/30 text-white hover:bg-white/10">{icon}{children}</button>
}

function Kpi({ icon, label, value, sub, valueColor = "text-white" }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; valueColor?: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4">
      <div className="flex items-center gap-1.5 text-white/50 text-xs font-medium"><span className="text-white/60">{icon}</span>{label}</div>
      <div className={`font-bold mt-1.5 text-xl ${valueColor}`}>{value}</div>
      {sub && <div className="text-[11px] text-white/40 mt-1">{sub}</div>}
    </div>
  )
}

function PipelineCard({ color, label, qtd, total, hint }: { color: string; label: string; qtd: number; total: number; hint: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3" style={{ borderTop: `2px solid ${color}` }}>
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-white/50">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />{label}
      </div>
      <div className="text-xl font-bold text-white mt-1">{qtd}</div>
      <div className="text-[11px] text-white/40">{fmtBRLshort(total)} · {hint}</div>
    </div>
  )
}

function SidePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
      <div className="text-[11px] text-white/50 font-bold uppercase tracking-wider mb-2">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}
function Row({ label, value, valueColor = "text-white" }: { label: React.ReactNode; value: string; valueColor?: string }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-white/70">{label}</span>
      <span className={`font-medium ${valueColor}`}>{value}</span>
    </div>
  )
}