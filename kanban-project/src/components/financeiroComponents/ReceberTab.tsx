// A RECEBER — Financeiro Geral
//
// Fiel ao Golden Master aprovado: 5 KPIs (Total em Aberto / Total Pago no Mês /
// Vencido / A Vencer 7 dias / Inadimplência), Aging por idade, tabela com
// Processo·Cliente / Título / Vencimento / Valor / Recebido / Saldo / Situação /
// Ações e painel lateral (Resumo do Período / Por País / Top Devedores /
// Pendências Financeiras). Linguagem visual 100% do kit compartilhado.
//
// Somente frontend: consome o endpoint EXISTENTE /api/financas/receber (GET) e
// preserva integralmente as ações de negócio (receber/cancelar/estornar).

"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Inbox, FileText, AlertTriangle, Calendar, TrendingUp, BarChart3, Wallet,
  MessageSquare, Upload, Plus, Loader2, Check, Ban, RotateCcw, Filter, ChevronDown,
} from "lucide-react"
import {
  OrigemBadge, StatusBadge as SituacaoBadge, VerOrigemLink,
  LancamentoDetalheModal,
} from "@/src/components/financeiro/shared/FinanceiroGeralShared"
import PendenciasFinanceirasPanel from "@/src/components/financeiro/shared/PendenciasFinanceirasPanel"
import {
  PageHeader, PrimaryButton, SecondaryButton, KpiCard, SurfaceCard, SectionCard,
  Thead, Th, Tr, EmptyState, FilterChip, SidePanel, MetricRow, PreviaTag,
  fmtBRL, fmtBRLshort, fmtPct, fmtDate,
} from "@/src/components/financeiroComponents/ui/kit"

function dueText(d: string | Date | null): string {
  if (!d) return ""
  const dias = Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000)
  if (dias < 0) return `há ${Math.abs(dias)}d`
  if (dias === 0) return "hoje"
  if (dias === 1) return "amanhã"
  return `em ${dias}d`
}
// SEM LISTA LOCAL DE PAÍSES. Havia dois mapas fixos, em MAIÚSCULAS, consultados
// com o valor que o banco grava em minúsculas — a bandeira e o rótulo nunca
// apareciam, e país novo jamais apareceria. O rótulo e a bandeira agora vêm do
// Cadastro Mestre pela própria API; o que sobra aqui é o fallback de
// apresentação, derivado da chave, sem enumerar país nenhum.
const rotuloDePais = (k?: string | null) =>
  k ? k.charAt(0).toUpperCase() + k.slice(1).toLowerCase() : ""

interface Parcela {
  id: number; numero: number; totalParcelas: number; cliente: string; processoId: number | null
  pais: string | null; descricao: string; categoria: string; valorBRL: number
  vencimento: string; dataPagamento: string | null; status: string
  recebida: boolean; cancelada: boolean; atrasada: boolean; diasParaVencer: number
  lancamentoOrigemTipo?: "receita"; lancamentoOrigemId?: number | null; origem?: string
  natureza?: string; editavelEstrutural?: boolean; estorno?: boolean
  canceladoEm?: string | null; estornadoEm?: string | null
}
interface ReceberData {
  kpis: { aReceber: number; vencido: number; aVencer7: number; aVencer30: number; inadimplencia: number; ticketMedio: number; qtdAberto: number; qtdAtrasadas: number; qtdAVencer7: number; processosAtivos: number }
  aging: { noPrazo: { total: number; qtd: number }; d30: { total: number; qtd: number }; d60: { total: number; qtd: number }; d90: { total: number; qtd: number } }
  porPais: { pais: string; chave?: string; flag?: string | null; total: number }[]
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
  { key: "recebidas", label: "Recebidos" },
] as const

function statusEntrada(p: Parcela) {
  return { statusBruto: p.status, canceladoEm: p.canceladoEm ?? null, estornadoEm: p.estornadoEm ?? null, estorno: p.estorno ?? false, vencida: p.atrasada, liquidada: p.recebida }
}

export default function ReceberTab() {
  const [data, setData] = useState<ReceberData | null>(null)
  const [loading, setLoading] = useState(true)
  const [chip, setChip] = useState<string>("todos")
  const [detalhe, setDetalhe] = useState<{ tipo: "receita" | "custo"; id: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function carregar() {
    const token = localStorage.getItem("authToken")
    fetch("/api/financas/receber", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(d => setData(d)).catch(e => console.error(e)).finally(() => setLoading(false))
  }
  useEffect(() => { carregar() }, [])

  const pagoMes = useMemo(() => {
    if (!data) return { valor: 0, qtd: 0 }
    const now = new Date()
    const recebidas = data.parcelas.filter(p => p.recebida && p.dataPagamento &&
      new Date(p.dataPagamento).getMonth() === now.getMonth() && new Date(p.dataPagamento).getFullYear() === now.getFullYear())
    return { valor: recebidas.reduce((a, p) => a + p.valorBRL, 0), qtd: recebidas.length }
  }, [data])

  if (loading || !data) return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--text-muted)" }} /></div>

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
      <PageHeader
        icon={<Inbox className="h-5 w-5" />}
        title="Contas a Receber"
        meta={
          <>
            <span><strong style={{ color: "var(--text-primary)" }}>{k.qtdAberto}</strong> parcelas em aberto</span>
            <span style={{ color: "var(--text-muted)" }}>·</span>
            <span><strong style={{ color: "var(--text-primary)" }}>{k.processosAtivos}</strong> processos ativos</span>
            <span style={{ color: "var(--text-muted)" }}>·</span>
            <span>Ticket médio <strong style={{ color: "var(--text-primary)" }}>{fmtBRL(k.ticketMedio)}</strong></span>
            <span style={{ color: "var(--text-muted)" }}>·</span>
            <span className="inline-flex items-center gap-1.5">DSO atual: <strong style={{ color: "var(--text-primary)" }}>{d.mock.dso} dias</strong> <PreviaTag inline /></span>
          </>
        }
        actions={
          <>
            <SecondaryButton icon={<BarChart3 className="h-3.5 w-3.5" />}>Aging report</SecondaryButton>
            <SecondaryButton icon={<MessageSquare className="h-3.5 w-3.5" />}>Cobrança em lote</SecondaryButton>
            <SecondaryButton icon={<Upload className="h-3.5 w-3.5" />}>Exportar</SecondaryButton>
            <PrimaryButton icon={<Plus className="h-3.5 w-3.5" />}>Nova receita</PrimaryButton>
          </>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <KpiCard icon={<FileText className="h-4 w-4" />} label="Total em Aberto" value={fmtBRL(k.aReceber)} sub={`${k.qtdAberto} parcelas · ticket ${fmtBRLshort(k.ticketMedio)}`} />
        <KpiCard icon={<Wallet className="h-4 w-4" />} label="Total Pago no Mês" value={fmtBRL(pagoMes.valor)} sub={`${pagoMes.qtd} pagamentos`} />
        <KpiCard icon={<Calendar className="h-4 w-4" />} label="Vencido" value={fmtBRL(k.vencido)} sub={`${k.qtdAtrasadas} parcelas atrasadas`} />
        <KpiCard icon={<Calendar className="h-4 w-4" />} label="A Vencer - 7 dias" value={fmtBRL(k.aVencer7)} sub={`${k.qtdAVencer7} próximas · 30d: ${fmtBRLshort(k.aVencer30)}`} />
        <KpiCard icon={<AlertTriangle className="h-4 w-4" />} label="Inadimplência" value={fmtPct(k.inadimplencia)} sub="Meta < 3% · Setor ~7%" />
      </div>

      {/* AGING */}
      <SectionCard
        icon={<BarChart3 className="h-4 w-4" />} title="Aging - Distribuição por idade"
        right={<span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Total: {fmtBRL(k.aReceber)}</span>}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <AgingTile label="No prazo" total={ag.noPrazo.total} pct={(ag.noPrazo.total / totalAg) * 100} qtd={ag.noPrazo.qtd} />
          <AgingTile label="1–30 dias" total={ag.d30.total} pct={(ag.d30.total / totalAg) * 100} qtd={ag.d30.qtd} />
          <AgingTile label="31–60 dias" total={ag.d60.total} pct={(ag.d60.total / totalAg) * 100} qtd={ag.d60.qtd} />
          <AgingTile label="60+ dias" total={ag.d90.total} pct={(ag.d90.total / totalAg) * 100} qtd={ag.d90.qtd} />
        </div>
      </SectionCard>

      {/* CHIPS + FILTROS */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {CHIPS.map(c => (
            <FilterChip key={c.key} active={chip === c.key} onClick={() => setChip(c.key)} count={(d.contagem as any)[c.key] ?? 0}>
              {c.label}
            </FilterChip>
          ))}
        </div>
        <SecondaryButton icon={<Filter className="h-3.5 w-3.5" />}>Filtros</SecondaryButton>
      </div>

      {/* TABELA + PAINÉIS */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 items-start">
        <SurfaceCard className="lg:col-span-3" padding="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <Thead>
                <Th><span className="inline-flex"><input type="checkbox" className="accent-[var(--accent-primary)]" aria-label="Selecionar todos" /></span></Th>
                <Th>Processo / Cliente</Th><Th>Título</Th><Th align="right">Vencimento</Th>
                <Th align="right">Valor</Th><Th align="right">Recebido</Th><Th align="right">Saldo</Th>
                <Th align="center">Situação</Th><Th align="center">Ações</Th>
              </Thead>
              <tbody>
                {parcelasFiltradas.map(p => {
                  const recebido = p.recebida ? p.valorBRL : 0
                  const saldo = p.valorBRL - recebido
                  return (
                    <Tr key={p.id}>
                      <td className="py-2.5 px-2"><input type="checkbox" className="accent-[var(--accent-primary)]" aria-label="Selecionar" /></td>
                      <td className="py-2.5 px-2">
                        <div className="font-medium flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>{p.cliente}<OrigemBadge origem={p.origem} /></div>
                        <div className="text-[11px] flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
                          {p.pais ? rotuloDePais(p.pais) : "— sem vínculo —"}
                          {p.lancamentoOrigemId != null && <VerOrigemLink tipo="receita" id={p.lancamentoOrigemId} onOpen={(t, id) => setDetalhe({ tipo: t, id })} />}
                        </div>
                      </td>
                      <td className="py-2.5 px-2">
                        <div style={{ color: "var(--text-secondary)" }}>{p.descricao}</div>
                        {p.totalParcelas > 1 && <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>Parcela {p.numero} de {p.totalParcelas}</div>}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums">
                        <div style={{ color: "var(--text-secondary)" }}>{fmtDate(p.vencimento)}</div>
                        <div className="text-[10px]" style={{ color: p.atrasada ? "var(--danger)" : "var(--text-muted)" }}>{p.recebida ? "em " + fmtDate(p.dataPagamento) : dueText(p.vencimento)}</div>
                      </td>
                      <td className="py-2.5 px-2 text-right font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>{fmtBRL(p.valorBRL)}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums" style={{ color: recebido > 0 ? "var(--success)" : "var(--text-muted)" }}>{fmtBRL(recebido)}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>{fmtBRL(saldo)}</td>
                      <td className="py-2.5 px-2 text-center"><SituacaoBadge e={statusEntrada(p)} /></td>
                      <td className="py-2.5 px-2 text-center">
                        <div className="inline-flex items-center gap-1.5 justify-center">
                          {/* Registrar pagamento/estorno/cancelar é EXCLUSIVO do fluxo canônico
                              (Financeiro do processo → Receita). Aqui é somente-leitura após o
                              corte legado: os botões ficam desabilitados com motivo visível. */}
                          {!p.recebida && !p.cancelada && !p.estorno && (
                            <button disabled title="Registrar pagamento é feito no Financeiro do processo (fluxo canônico)." className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded text-white cursor-not-allowed opacity-40" style={{ background: "color-mix(in srgb, var(--success) 75%, black)" }}><Check className="h-3 w-3" /> Receber</button>
                          )}
                          {p.lancamentoOrigemId != null && !p.cancelada && !p.estorno && !p.estornadoEm && (
                            p.recebida ? (
                              <button disabled title="Estorno é feito no Financeiro do processo → aba Pagamentos (fluxo canônico)."
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border cursor-not-allowed opacity-40" style={{ borderColor: "color-mix(in srgb, var(--info) 30%, transparent)", color: "var(--info)" }}><RotateCcw className="h-3 w-3" /> Estornar</button>
                            ) : (
                              <button disabled title="Cancelar é feito no Financeiro do processo → Mais ações (fluxo canônico)."
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border cursor-not-allowed opacity-40" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)", color: "var(--danger)" }}><Ban className="h-3 w-3" /> Cancelar</button>
                            )
                          )}
                        </div>
                      </td>
                    </Tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {parcelasFiltradas.length === 0 && (
            <EmptyState icon={<Calendar className="h-6 w-6" />} title="Nenhuma parcela neste filtro." subtitle="Tente ajustar os filtros ou criar uma nova receita." />
          )}
        </SurfaceCard>

        <div className="space-y-3">
          <SidePanel title={<span className="inline-flex items-center gap-1">Resumo do Período <ChevronDown className="h-3 w-3" /></span>}>
            <MetricRow label="Total previsto" value={fmtBRL(d.resumo.totalPrevisto)} />
            <MetricRow label="Recebido" value={fmtBRL(d.resumo.recebido)} tone="success" />
            <MetricRow label="Em aberto" value={fmtBRL(d.resumo.emAberto)} />
            <MetricRow label="Atrasado" value={fmtBRL(d.resumo.atrasado)} tone="danger" />
            <MetricRow label="Previsto futuro" value={fmtBRL(d.resumo.previstoFuturo)} />
          </SidePanel>
          <SidePanel title="Por País">
            {d.porPais.map(p => (
              <MetricRow key={p.pais} label={`${p.flag ?? ""} ${p.pais}`.trim()} value={fmtBRL(p.total)} />
            ))}
          </SidePanel>
          <SidePanel title="Top Devedores">
            {d.topDevedores.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Sem devedores em aberto.</p>
            ) : d.topDevedores.map(t => (
              <MetricRow key={t.processoId} label={t.nome} value={fmtBRLshort(t.total)} />
            ))}
          </SidePanel>
          <PendenciasFinanceirasPanel compact />
        </div>
      </div>

      {detalhe && <LancamentoDetalheModal tipo={detalhe.tipo} id={detalhe.id} onClose={() => setDetalhe(null)} />}
      {toast && <div className="fixed bottom-4 right-4 z-50 rounded-lg border px-4 py-2 text-sm shadow-[var(--elev-3)]" style={{ background: "var(--surface-secondary)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} onClick={() => setToast(null)}>{toast}</div>}
    </div>
  )
}

function AgingTile({ label, total, pct, qtd }: { label: string; total: number; pct: number; qtd: number }) {
  return (
    <SurfaceCard padding="p-3">
      <div className="flex items-start justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>{label}</div>
        <Calendar className="h-3.5 w-3.5" style={{ color: "var(--text-muted)" }} />
      </div>
      <div className="text-lg font-bold mt-1 tabular-nums" style={{ color: "var(--text-primary)" }}>{fmtBRL(total)}</div>
      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{fmtPct(pct)} · {qtd} parcelas</div>
    </SurfaceCard>
  )
}
