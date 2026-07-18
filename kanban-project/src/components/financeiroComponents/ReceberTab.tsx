// CRIAR EM: src/components/financeiroComponents/ReceberTab.tsx
//
// Aba "A RECEBER" — porte fiel do renderReceber() do mockup, estilo glass.
// Autossuficiente: busca /api/financas/receber. Dados REAIS do banco
// (ParcelaFinanceira→Receita→Processo). Só DSO é "prévia".

"use client"

import { useEffect, useState } from "react"
import {
  Inbox, FileText, AlertTriangle, Calendar, TrendingUp, BarChart3,
  MessageSquare, Upload, Plus, Loader2, Check, Ban, RotateCcw,
} from "lucide-react"
import { OrigemBadge, StatusBadge, VerOrigemLink, LancamentoDetalheModal, CancelarEstornarModal } from "@/src/components/financeiro/shared/FinanceiroGeralShared"
import PendenciasFinanceirasPanel from "@/src/components/financeiro/shared/PendenciasFinanceirasPanel"

function fmtBRL(v: number): string { return `R$ ${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtBRLshort(v: number): string {
  const n = Math.abs(v ?? 0)
  if (n >= 1000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}k`
  return fmtBRL(v)
}
function fmtPct(v: number): string { return `${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` }
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
const PAIS_FLAG: Record<string, string> = { PORTUGAL: "🇵🇹", ESPANHA: "🇪🇸", ALEMANHA: "🇩🇪", ITALIA: "🇮🇹" }
const PAIS_LABEL: Record<string, string> = { PORTUGAL: "Portugal", ESPANHA: "Espanha", ALEMANHA: "Alemanha", ITALIA: "Itália" }

interface Parcela {
  id: number; numero: number; totalParcelas: number; cliente: string; processoId: number | null
  pais: string | null; descricao: string; categoria: string; valorBRL: number
  vencimento: string; dataPagamento: string | null; status: string
  recebida: boolean; cancelada: boolean; atrasada: boolean; diasParaVencer: number
  // §1/§3/§5 — canônico
  lancamentoOrigemTipo?: "receita"; lancamentoOrigemId?: number | null; origem?: string
  natureza?: string; editavelEstrutural?: boolean; estorno?: boolean
  canceladoEm?: string | null; estornadoEm?: string | null
}
interface ReceberData {
  kpis: { aReceber: number; vencido: number; aVencer7: number; aVencer30: number; inadimplencia: number; ticketMedio: number; qtdAberto: number; qtdAtrasadas: number; qtdAVencer7: number; processosAtivos: number }
  aging: { noPrazo: { total: number; qtd: number }; d30: { total: number; qtd: number }; d60: { total: number; qtd: number }; d90: { total: number; qtd: number } }
  porPais: { pais: string; total: number }[]
  topDevedores: { processoId: number; nome: string; pais: string | null; total: number }[]
  resumo: { totalPrevisto: number; recebido: number; emAberto: number; atrasado: number; previstoFuturo: number }
  parcelas: Parcela[]
  contagem: { todos: number; atrasadas: number; proximos7: number; proximos30: number; recebidas: number }
  mock: { dso: number }
}

const CHIPS = [
  { key: "todos", label: "Todos" },
  { key: "atrasadas", label: "Atrasados" },
  { key: "proximos7", label: "Próximos 7 dias" },
  { key: "proximos30", label: "Próximos 30 dias" },
  { key: "recebidas", label: "✓ Recebidos" },
] as const

function statusEntrada(p: Parcela) {
  return { statusBruto: p.status, canceladoEm: p.canceladoEm ?? null, estornadoEm: p.estornadoEm ?? null, estorno: p.estorno ?? false, vencida: p.atrasada, liquidada: p.recebida }
}

export default function ReceberTab() {
  const [data, setData] = useState<ReceberData | null>(null)
  const [loading, setLoading] = useState(true)
  const [chip, setChip] = useState<string>("todos")
  const [detalhe, setDetalhe] = useState<{ tipo: "receita" | "custo"; id: number } | null>(null)
  const [acao, setAcao] = useState<{ acao: "cancelar" | "estornar"; tipo: "receita" | "custo"; id: number; resumo: { item: string; valor: string; processo: string | null } } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function carregar() {
    const token = localStorage.getItem("authToken")
    fetch("/api/financas/receber", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(d => setData(d)).catch(e => console.error(e)).finally(() => setLoading(false))
  }
  useEffect(() => { carregar() }, [])

  if (loading || !data) return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>

  const d = data
  const k = d.kpis
  const ag = d.aging
  const totalAg = k.aReceber || 1

  const parcelasFiltradas = d.parcelas.filter(p => {
    if (chip === "todos") return true
    if (chip === "atrasadas") return p.atrasada
    if (chip === "proximos7") return !p.atrasada && !p.recebida && p.diasParaVencer >= 0 && p.diasParaVencer <= 7
    if (chip === "proximos30") return !p.atrasada && !p.recebida && p.diasParaVencer >= 0 && p.diasParaVencer <= 30
    if (chip === "recebidas") return p.recebida
    return true
  })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><Inbox className="h-5 w-5" /> Contas a Receber</h2>
          <div className="text-xs text-white/60 mt-1 flex items-center gap-2 flex-wrap">
            <span><strong className="text-white">{k.qtdAberto}</strong> parcelas em aberto</span>
            <span className="text-white/30">·</span>
            <span><strong className="text-white">{k.processosAtivos}</strong> processos ativos</span>
            <span className="text-white/30">·</span>
            <span>Ticket médio <strong className="text-white">{fmtBRL(k.ticketMedio)}</strong></span>
            <span className="text-white/30">·</span>
            <span>DSO atual: <strong className="text-white">{d.mock.dso} dias</strong> <span className="text-white/30">·prévia</span></span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <GlassBtn icon={<BarChart3 className="h-3.5 w-3.5" />}>Aging report</GlassBtn>
          <GlassBtn icon={<MessageSquare className="h-3.5 w-3.5" />}>Cobrança em lote</GlassBtn>
          <GlassBtn icon={<Upload className="h-3.5 w-3.5" />}>Exportar</GlassBtn>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white"><Plus className="h-3.5 w-3.5" /> Nova receita</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4">
          <div className="flex items-center gap-1.5 text-white/50 text-xs font-medium"><FileText className="h-3.5 w-3.5" /> Total em Aberto</div>
          <div className="text-xl font-bold text-white mt-1.5">{fmtBRL(k.aReceber)}</div>
          <div className="text-[11px] text-white/40 mt-1">{k.qtdAberto} parcelas · ticket {fmtBRLshort(k.ticketMedio)}</div>
          <div className="flex gap-0.5 mt-2 h-1.5 rounded-full overflow-hidden bg-white/10">
            <div className="bg-green-500" style={{ width: `${(ag.noPrazo.total / totalAg) * 100}%` }} title="No prazo" />
            <div className="bg-amber-400" style={{ width: `${(ag.d30.total / totalAg) * 100}%` }} title="1-30d" />
            <div className="bg-orange-500" style={{ width: `${(ag.d60.total / totalAg) * 100}%` }} title="31-60d" />
            <div className="bg-red-500" style={{ width: `${(ag.d90.total / totalAg) * 100}%` }} title="60+d" />
          </div>
        </div>
        <Kpi icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Vencido" value={fmtBRL(k.vencido)} valueColor="text-red-400" sub={`${k.qtdAtrasadas} parcelas atrasadas`} />
        <Kpi icon={<Calendar className="h-3.5 w-3.5" />} label="A Vencer · 7 dias" value={fmtBRL(k.aVencer7)} valueColor="text-amber-400" sub={`${k.qtdAVencer7} próximas · 30d: ${fmtBRLshort(k.aVencer30)}`} />
        <Kpi icon={<TrendingUp className="h-3.5 w-3.5" />} label="Inadimplência" value={fmtPct(k.inadimplencia)} valueColor={k.inadimplencia > 5 ? "text-red-400" : "text-amber-400"} sub="Meta < 3% · Setor ~7%" />
      </div>

      {/* AGING DETALHADO */}
      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-white flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Aging · Distribuição por idade</div>
          <span className="text-[11px] text-white/40">Total: {fmtBRL(k.aReceber)}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <AgingCard color="#22c55e" label="No prazo" total={ag.noPrazo.total} pct={(ag.noPrazo.total / totalAg) * 100} qtd={ag.noPrazo.qtd} />
          <AgingCard color="#f59e0b" label="1–30 dias" total={ag.d30.total} pct={(ag.d30.total / totalAg) * 100} qtd={ag.d30.qtd} />
          <AgingCard color="#f97316" label="31–60 dias" total={ag.d60.total} pct={(ag.d60.total / totalAg) * 100} qtd={ag.d60.qtd} />
          <AgingCard color="#ef4444" label="60+ dias" total={ag.d90.total} pct={(ag.d90.total / totalAg) * 100} qtd={ag.d90.qtd} />
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
          {parcelasFiltradas.length === 0 ? (
            <p className="text-sm text-white/40 py-10 text-center">Nenhuma parcela neste filtro.</p>
          ) : (
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr className="text-white/40 text-xs border-b border-white/10">
                  <th className="text-left font-medium py-1.5">Cliente / Processo</th>
                  <th className="text-left font-medium py-1.5">Descrição</th>
                  <th className="text-left font-medium py-1.5">Categoria</th>
                  <th className="text-right font-medium py-1.5">Vencimento</th>
                  <th className="text-right font-medium py-1.5">Valor</th>
                  <th className="text-center font-medium py-1.5">Status</th>
                  <th className="text-center font-medium py-1.5">Ações</th>
                </tr>
              </thead>
              <tbody>
                {parcelasFiltradas.map(p => (
                  <tr key={p.id} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                    <td className="py-2">
                      <div className="text-white/90 font-medium flex items-center gap-1.5">{p.pais ? PAIS_FLAG[p.pais] + " " : ""}{p.cliente}<OrigemBadge origem={p.origem} /></div>
                      <div className="text-[11px] text-white/40 flex items-center gap-2">
                        {p.pais ? PAIS_LABEL[p.pais] : "— sem vínculo —"}
                        {p.lancamentoOrigemId != null && <VerOrigemLink tipo="receita" id={p.lancamentoOrigemId} onOpen={(t, id) => setDetalhe({ tipo: t, id })} />}
                      </div>
                    </td>
                    <td className="py-2">
                      <div className="text-white/80">{p.descricao}</div>
                      {p.totalParcelas > 1 && <div className="text-[11px] text-white/40">Parcela {p.numero} de {p.totalParcelas}</div>}
                    </td>
                    <td className="py-2"><span className="text-[11px] px-2 py-0.5 rounded bg-white/10 text-white/70">{p.categoria}</span></td>
                    <td className="py-2 text-right tabular-nums">
                      <div className="text-white/80">{fmtDate(p.vencimento)}</div>
                      <div className={`text-[10px] ${p.atrasada ? "text-red-400" : "text-white/40"}`}>{p.recebida ? "em " + fmtDate(p.dataPagamento) : dueText(p.vencimento)}</div>
                    </td>
                    <td className="py-2 text-right text-white font-medium tabular-nums">{fmtBRL(p.valorBRL)}</td>
                    <td className="py-2 text-center"><StatusBadge e={statusEntrada(p)} /></td>
                    <td className="py-2 text-center">
                      <div className="inline-flex items-center gap-1.5 justify-center">
                        {!p.recebida && !p.cancelada && !p.estorno && (
                          <button className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-green-600/80 hover:bg-green-600 text-white"><Check className="h-3 w-3" /> Receber</button>
                        )}
                        {/* §5/§6 — ações canônicas: cancelar (aberto) / estornar (recebido). Projeção de PROCESSO só tem ação operacional. */}
                        {p.lancamentoOrigemId != null && !p.cancelada && !p.estorno && !p.estornadoEm && (
                          p.recebida ? (
                            <button onClick={() => setAcao({ acao: "estornar", tipo: "receita", id: p.lancamentoOrigemId!, resumo: { item: p.descricao, valor: fmtBRL(p.valorBRL), processo: p.cliente } })}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-purple-500/30 text-purple-300 hover:bg-purple-500/10"><RotateCcw className="h-3 w-3" /> Estornar</button>
                          ) : (
                            <button onClick={() => setAcao({ acao: "cancelar", tipo: "receita", id: p.lancamentoOrigemId!, resumo: { item: p.descricao, valor: fmtBRL(p.valorBRL), processo: p.cliente } })}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-red-500/30 text-red-300 hover:bg-red-500/10"><Ban className="h-3 w-3" /> Cancelar</button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="space-y-3">
          <SidePanel title="Resumo do período">
            <Row label="Total previsto" value={fmtBRLshort(d.resumo.totalPrevisto)} />
            <Row label="Recebido" value={fmtBRLshort(d.resumo.recebido)} valueColor="text-green-400" />
            <Row label="Em aberto" value={fmtBRLshort(d.resumo.emAberto)} />
            <Row label="Atrasado" value={fmtBRLshort(d.resumo.atrasado)} valueColor="text-red-400" />
            <Row label="Previsto futuro" value={fmtBRLshort(d.resumo.previstoFuturo)} />
          </SidePanel>
          <SidePanel title="Por país">
            {d.porPais.map(p => (
              <Row key={p.pais} label={`${PAIS_FLAG[p.pais]} ${PAIS_LABEL[p.pais]}`} value={fmtBRLshort(p.total)} />
            ))}
          </SidePanel>
          <SidePanel title="Top devedores">
            {d.topDevedores.length === 0 ? (
              <p className="text-xs text-white/40">Sem devedores em aberto.</p>
            ) : d.topDevedores.map(t => (
              <Row key={t.processoId} label={`${t.pais ? PAIS_FLAG[t.pais] + " " : ""}${t.nome}`} value={fmtBRLshort(t.total)} />
            ))}
          </SidePanel>
          <PendenciasFinanceirasPanel compact />
        </div>
      </div>

      {detalhe && <LancamentoDetalheModal tipo={detalhe.tipo} id={detalhe.id} onClose={() => setDetalhe(null)} />}
      {acao && <CancelarEstornarModal {...acao} onClose={() => setAcao(null)} onDone={(m) => { setAcao(null); setToast(m); carregar() }} />}
      {toast && <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-zinc-800 border border-white/10 px-4 py-2 text-sm text-white shadow-xl" onClick={() => setToast(null)}>{toast}</div>}
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

function AgingCard({ color, label, total, pct, qtd }: { color: string; label: string; total: number; pct: number; qtd: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="text-[11px] text-white/50 font-semibold uppercase tracking-wide">{label}</div>
      <div className="text-lg font-bold text-white mt-1">{fmtBRL(total)}</div>
      <div className="text-[11px] text-white/40">{fmtPct(pct)} · {qtd} parcelas</div>
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