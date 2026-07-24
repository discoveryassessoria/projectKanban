// src/components/financeiro/v3/ReceitaDetalheView.tsx
// ============================================================================
// DETALHE DA RECEITA (Financeiro V3) — componente reutilizável, embutido no
// modal do processo (ProcessoFinanceiroShell) ou na rota de página dedicada.
// Reprodução fiel do mockup aprovado, SEM o cabeçalho falso (sino/usuário) e
// SEM o wrapper full-screen: o container hospedeiro provê padding/scroll.
// Dados EXCLUSIVAMENTE do Motor V3 (Ledger/projeções) via /api/financeiro/v3/receita.
// Valores operacionais em BRL; moeda-base contratual (EUR) apresentada como câmbio.
// ============================================================================
"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import RegistrarPagamentoModal from "@/src/components/financeiro/v3/RegistrarPagamentoModal"
import {
  ArrowLeft, ExternalLink, MoreVertical, Copy, FileText, ChevronDown, ChevronUp,
  Receipt, CreditCard, Wallet, FileCheck, Clock, Search, SlidersHorizontal, Calendar,
  Plus, Pencil, ChevronLeft, ChevronRight, UserPlus, ArrowDownCircle, CheckCircle2,
  Info as InfoIcon, Plus as PlusIcon,
} from "lucide-react"

const fmt = (v: number, m = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency: m }).format(v || 0)
const brl = (v: number) => fmt(v, "BRL")
const dataBR = (s?: string | null) => s ? new Date(s).toLocaleDateString("pt-BR") : "—"
const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }

// classe do badge de status (amber A VENCER · red VENCIDO · blue PARCIAL · green QUITADO)
const statusCls = (s?: string | null) => {
  const S = (s ?? "").toUpperCase()
  if (S.includes("QUITAD")) return "bg-[#4ade80]/15 text-[#4ade80]"
  if (S.includes("VENCID")) return "bg-[#f87171]/15 text-[#f87171]"
  if (S.includes("PARCIAL")) return "bg-[#7dd3fc]/15 text-[#7dd3fc]"
  return "bg-[#d2a948]/15 text-[#d2a948]"
}

// badge de status da parcela
const parcelaStatusCls = (s?: string | null) => {
  switch ((s ?? "").toUpperCase()) {
    case "PAGA": return "bg-[#4ade80]/15 text-[#4ade80]"
    case "VENCIDA": return "bg-[#f87171]/15 text-[#f87171]"
    case "CANCELADA": return "bg-white/10 text-white/50"
    default: return "bg-[#d2a948]/15 text-[#d2a948]"
  }
}
const parcelaStatusLabel = (s?: string | null) => (s === "A_VENCER" ? "A VENCER" : (s ?? "—"))

export function ReceitaDetalheView({ refParam, onVoltar }: { refParam: string; onVoltar: () => void }) {
  const router = useRouter()
  const [d, setD] = useState<any>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tab, setTab] = useState("resumo")
  const [pagOpen, setPagOpen] = useState(false)
  const [busca, setBusca] = useState("")
  const [copiado, setCopiado] = useState(false)
  const [pStatus, setPStatus] = useState("TODAS")
  const [pForma, setPForma] = useState("TODAS")
  const [pResp, setPResp] = useState("TODAS")
  const [pBusca, setPBusca] = useState("")
  const [pPage, setPPage] = useState(1)

  const carregar = useCallback(() => {
    fetch(`/api/financeiro/v3/receita/${encodeURIComponent(refParam)}`, { headers: authHeaders() })
      .then(async (r) => { const j = await r.json(); if (r.ok && j.disponivel) { setD(j.receita); setErro(null) } else setErro(j.fallbackLegado ? "Financeiro V3 indisponível." : "Receita não encontrada.") })
      .catch(() => setErro("Falha ao carregar."))
  }, [refParam])

  useEffect(() => { carregar() }, [carregar])

  const copiarCodigo = () => { if (!d?.codigo) return; navigator.clipboard?.writeText(d.codigo).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500) }).catch(() => {}) }

  if (erro) return <div className="p-8 text-sm text-white/68">{erro}</div>
  if (!d) return <div className="p-8 text-sm text-white/40">carregando…</div>

  const isCusto = d.natureza === "CUSTO"
  const semBase = d.moedaBase === "BRL"
  const fmtEUR = (v: number) => fmt(v, d.moedaBase)
  const moedaBaseLabel = d.moedaBase === "EUR" ? "Euro (EUR)" : d.moedaBase
  const movLink = `/financeiro/v3/processo-preview?processoId=${d.processo.id ?? ""}`
  const pct = d.valorContratadoBrl ? Math.round((d.recebidoBrl / d.valorContratadoBrl) * 100) : 0

  const pagamentosFiltrados = (d.pagamentos ?? []).filter((p: any) => {
    if (!busca.trim()) return true
    const q = busca.toLowerCase()
    return [p.formaLabel, p.banco, p.referencia, p.status, fmt(p.valor, d.moeda)].filter(Boolean).some((s: any) => String(s).toLowerCase().includes(q))
  })

  // ── Parcelas (aba Cobranças) ──
  const rp = d.resumoParcelas ?? { pagas: { qtd: 0, valor: 0 }, aVencer: { qtd: 0, valor: 0 }, vencidas: { qtd: 0, valor: 0 }, canceladas: { qtd: 0, valor: 0 }, total: 0 }
  const parcelas: any[] = d.parcelasDetalhe ?? []
  const formasDistintas: string[] = Array.from(new Set(parcelas.map((p) => p.forma).filter(Boolean)))
  const respsDistintos: string[] = Array.from(new Set(parcelas.map((p) => p.responsavel).filter(Boolean)))
  const statusDistintos: string[] = Array.from(new Set(parcelas.map((p) => p.status).filter(Boolean)))
  const parcelasFiltradas = parcelas.filter((p) => {
    if (pStatus !== "TODAS" && p.status !== pStatus) return false
    if (pForma !== "TODAS" && p.forma !== pForma) return false
    if (pResp !== "TODAS" && p.responsavel !== pResp) return false
    if (pBusca.trim()) {
      const q = pBusca.toLowerCase()
      const hay = [`${p.numero}/${p.totalParcelas}`, p.responsavel, p.forma].filter(Boolean).map(String).join(" ").toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
  const P_POR_PAGINA = 10
  const totalPaginas = Math.max(1, Math.ceil(parcelasFiltradas.length / P_POR_PAGINA))
  const paginaAtual = Math.min(pPage, totalPaginas)
  const parcelasPagina = parcelasFiltradas.slice((paginaAtual - 1) * P_POR_PAGINA, paginaAtual * P_POR_PAGINA)
  const parcDe = parcelasFiltradas.length ? (paginaAtual - 1) * P_POR_PAGINA + 1 : 0
  const parcAte = Math.min(paginaAtual * P_POR_PAGINA, parcelasFiltradas.length)
  const limparFiltros = () => { setPStatus("TODAS"); setPForma("TODAS"); setPResp("TODAS"); setPBusca(""); setPPage(1) }
  const hojeStr = new Date().toDateString()
  const ehHoje = (iso?: string | null) => !!iso && new Date(iso).toDateString() === hojeStr
  const selCls = "rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 text-sm text-white/70 outline-none"

  return (
    <div className="text-white/80">
      <div className="mx-auto max-w-[1400px] px-1 py-1">
        {/* ── Top bar ── */}
        <div className="flex items-start justify-between">
          <div>
            <button onClick={onVoltar} className="mb-3 flex items-center gap-2 text-sm text-white/68 hover:text-white/80"><ArrowLeft className="h-4 w-4" /> Voltar para {isCusto ? "Custos" : "Receitas"}</button>
            <div className="flex items-center gap-3">
              <h1 className="text-[28px] font-bold leading-tight text-white">{d.descricao ?? d.codigo}</h1>
              <span className={`rounded-md px-2.5 py-1 text-xs font-semibold tracking-wide ${statusCls(d.statusLabel)}`}>{d.statusLabel}</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[13px] text-white/40">
              <span>🧾</span> Financeiro <span className="text-white/30">›</span> {isCusto ? "Custos" : "Receitas"} <span className="text-white/30">›</span>
              <span className="text-white/68">{d.codigo}</span>
            </div>
          </div>
        </div>

        {/* ── Info card ── */}
        <div className="mt-5 rounded-xl border border-white/10 bg-[#1b2027] p-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-6">
            <Info rotulo={isCusto ? "Custo" : "Receita"}><span className="inline-flex items-center gap-1.5 font-medium text-white/95">{d.codigo}<button onClick={copiarCodigo} title="Copiar código" className="text-white/40 hover:text-white/80">{copiado ? <CheckCircle2 className="h-3.5 w-3.5 text-[#4ade80]" /> : <Copy className="h-3.5 w-3.5" />}</button></span></Info>
            <Info rotulo="Descrição"><span className="text-white/80">{d.descricao ?? "—"}</span></Info>
            <Info rotulo="Processo"><div className="text-white/80">{d.processo.codigo ?? "—"}{d.processo.nome ? ` – ${d.processo.nome}` : ""}</div>{d.processo.id && <a href={movLink} className="inline-flex items-center gap-1 text-xs text-[#7dd3fc] hover:underline">Abrir processo <ExternalLink className="h-3 w-3" /></a>}</Info>
            <Info rotulo="Responsável">{d.responsavel ? <span className="inline-flex items-center gap-2 text-white/80">{d.responsavel.nome}<span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[11px] text-violet-300">{d.responsavel.papel}</span></span> : "—"}</Info>
            <Info rotulo="Serviço"><span className="text-white/80">{d.servico ?? "—"}</span></Info>
            <Info rotulo="Forma de cobrança"><span className="text-white/80">{d.formaCobranca ?? "—"}</span></Info>
          </div>
          <div className="my-4 border-t border-white/10" />
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Cell rotulo={`Valor base (${d.moedaBase})`} sub={semBase ? "—" : `Contrato em ${d.moedaBase}`}><span className="font-medium text-white/95">{fmtEUR(d.valorBase)}</span></Cell>
            <Cell rotulo="Câmbio aplicado" sub={dataBR(d.dataCotacao)}>
              <span className="inline-flex items-center gap-2 font-medium text-white/95">{d.cotacaoAplicada != null ? brl(d.cotacaoAplicada) : "—"}
                {d.tipoCambio === "FIXO" && <span className="rounded bg-[#4ade80]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#4ade80]">Fixo</span>}
                {d.tipoCambio === "NAO_DEFINIDO" && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white/60">Não definido</span>}
              </span>
            </Cell>
            <Cell rotulo="Valor contratado (BRL)"><span className="font-semibold text-white/95">{brl(d.valorContratadoBrl)}</span></Cell>
            <Cell rotulo={isCusto ? "Pago (BRL)" : "Recebido (BRL)"} sub={`${d.parcelasRecebidas} parcelas`}><span className="font-semibold text-[#4ade80]">{brl(d.recebidoBrl)}</span></Cell>
            <Cell rotulo="Saldo (BRL)" sub={`${d.parcelas} parcelas`}><span className="font-semibold text-[#7dd3fc]">{brl(d.saldoBrl)}</span></Cell>
            <Cell rotulo="Vencimento"><span className="text-white/80">{dataBR(d.vencimento)}</span></Cell>
            <Cell rotulo="Status" sub={d.proximoVencimento ? `Próxima parcela em ${dataBR(d.proximoVencimento)}` : undefined}><span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${statusCls(d.statusLabel)}`}>{d.statusLabel}</span></Cell>
            <Cell rotulo="Criado em" sub={`por ${d.criadoPor}`}><span className="text-white/70">{dataBR(d.criadoEm)} às {d.criadoEm ? new Date(d.criadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""}</span></Cell>
          </div>
        </div>

        {/* ── Abas ── */}
        <div className="mt-5 flex items-center gap-7 border-b border-white/10">
          {[["resumo", "Resumo", Receipt, 0], ["cobrancas", "Cobranças", CreditCard, rp.total], ["pagamentos", "Pagamentos", Wallet, 0], ["documentos", "Documentos", FileCheck, 1], ["timeline", "Timeline", Clock, 0]].map(([id, label, Icon, badge]: any) => (
            <button key={id} onClick={() => setTab(id)} className={`-mb-px flex items-center gap-2 border-b-2 px-1 pb-3 pt-2 text-sm ${tab === id ? "border-[#d2a948] font-medium text-[#d2a948]" : "border-transparent text-white/68 hover:text-white/80"}`}>
              <Icon className="h-4 w-4" /> {label}{badge ? <span className="ml-1 rounded-full bg-[#252c35] px-1.5 text-[11px] text-white/70">{badge}</span> : null}
            </button>
          ))}
        </div>

        {/* ── Conteúdo (main + right) ── */}
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            {/* Resumo financeiro (5 sub-cards + bloco de câmbio) */}
            {tab === "resumo" && (
            <div className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
              <h2 className="text-lg font-semibold text-white">Resumo financeiro</h2>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <SubCard rotulo="Valor contratado" valor={brl(d.valorContratadoBrl)} linhas={!semBase ? [`Base contratual: ${fmtEUR(d.valorBase)}`] : []} />
                <SubCard rotulo={isCusto ? "Pago" : "Recebido"} valor={brl(d.recebidoBrl)} cor="text-[#4ade80]" linhas={[`${pct}% do total`, `${d.parcelasRecebidas} parcelas recebidas`]} />
                <SubCard rotulo="A vencer" valor={brl(d.aVencerBrl)} cor="text-[#d2a948]" linhas={[`${d.parcelasAVencer} parcelas`, `Próximo: ${dataBR(d.proximoVencimento)}`]} />
                <SubCard rotulo="Vencido" valor={brl(d.vencidoBrl)} cor="text-[#f87171]" linhas={[`${d.parcelasVencidas} parcela(s)`, ...(d.parcelasVencidas ? [`Desde ${dataBR(d.proximoVencimento)}`] : [])]} />
                <SubCard rotulo="Saldo a receber" valor={brl(d.saldoBrl)} cor="text-[#7dd3fc]" linhas={[`${d.parcelas} parcelas em aberto`]} />
              </div>
              <div className="mt-4 flex items-start justify-between gap-4 rounded-lg border border-white/10 bg-[#161b21] px-4 py-3">
                <div className="flex items-start gap-2.5 text-sm text-white/68">
                  <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#7dd3fc]" />
                  <span>Os valores operacionais são apresentados em Reais (BRL). A moeda-base contratual desta receita é {moedaBaseLabel}.</span>
                </div>
                <button onClick={() => router.push("/cambio")} className="inline-flex shrink-0 items-center gap-1 text-sm text-[#7dd3fc] hover:underline">Entenda o câmbio aplicado <ExternalLink className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            )}

            {/* Pagamentos */}
            {tab === "pagamentos" && (
            <div className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-white">Pagamentos</h2><span className="rounded-full bg-[#252c35] px-2 py-0.5 text-xs text-white/70">{d.pagamentos.length}</span></div>
                <button onClick={() => setPagOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#d2a948] px-3.5 py-2 text-sm font-semibold text-[#1b1508] hover:bg-[#e0b957]"><PlusIcon className="h-4 w-4" /> Registrar pagamento</button>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pagamentos..." className="w-full rounded-lg border border-white/10 bg-[#12161c] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-white/30" /></div>
                <button className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 text-sm text-white/70"><SlidersHorizontal className="h-4 w-4" /> Filtros</button>
                <button className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 text-sm text-white/70"><Calendar className="h-4 w-4" /> Período <ChevronDown className="h-3.5 w-3.5" /></button>
              </div>
              <table className="mt-4 w-full text-sm">
                <thead><tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-white/40">
                  <th className="pb-2 font-medium">Data</th><th className="pb-2 font-medium">Valor</th><th className="pb-2 font-medium">Forma</th><th className="pb-2 font-medium">Conta recebida</th><th className="pb-2 font-medium">Referência</th><th className="pb-2 font-medium">Status</th><th className="pb-2 font-medium">Ações</th>
                </tr></thead>
                <tbody>{pagamentosFiltrados.map((p: any) => (
                  <tr key={p.id} className="border-b border-white/10">
                    <td className="py-3.5 text-white/70">{dataBR(p.data)}</td>
                    <td className="font-medium text-white/95">{fmt(p.valor, d.moeda)}</td>
                    <td><span className="inline-flex items-center gap-1.5 text-white/70"><span className="flex h-5 w-5 items-center justify-center rounded bg-[#252c35] text-[10px]">{(p.formaLabel ?? "?").slice(0, 1)}</span>{p.formaLabel ?? "—"}</span></td>
                    <td><div className="text-white/70">{p.banco ?? "—"}</div>{(p.agencia || p.conta) && <div className="text-xs text-white/40">Ag: {p.agencia ?? "—"} Cc: {p.conta ?? "—"}</div>}</td>
                    <td className="text-white/68">{p.referencia ?? "—"}</td>
                    <td><span className="inline-flex items-center gap-1.5 text-[#4ade80]"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{p.status}</span></td>
                    <td><div className="flex items-center gap-2 text-white/40"><Pencil className="h-4 w-4 hover:text-white/70" /><FileText className="h-4 w-4 hover:text-white/70" /><MoreVertical className="h-4 w-4 hover:text-white/70" /></div></td>
                  </tr>
                ))}</tbody>
              </table>
              <div className="mt-4 flex items-center justify-between text-sm text-white/40">
                <span>Mostrando {pagamentosFiltrados.length} de {d.pagamentos.length} pagamentos</span>
                <div className="flex items-center gap-1"><button className="rounded border border-white/10 p-1.5 text-white/40"><ChevronLeft className="h-4 w-4" /></button><span className="rounded border border-white/15 bg-[#252c35] px-2.5 py-1 text-xs text-white/80">1</span><button className="rounded border border-white/10 p-1.5 text-white/40"><ChevronRight className="h-4 w-4" /></button></div>
              </div>
            </div>
            )}

            {/* Cobranças (parcelas) */}
            {tab === "cobrancas" && (
              <div className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
                <div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-white">Cobranças</h2><span className="rounded-full bg-[#252c35] px-2 py-0.5 text-xs text-white/70">{rp.total}</span></div>

                {/* KPIs */}
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <SubCard rotulo="Total das cobranças" valor={brl(d.valorContratadoBrl)} linhas={[`${rp.total} parcelas`]} />
                  <SubCard rotulo={isCusto ? "Pago" : "Recebido"} valor={brl(d.resumo.recebidoBrl)} cor="text-[#4ade80]" linhas={[`${rp.pagas.qtd} parcelas pagas`]} />
                  <SubCard rotulo="A vencer" valor={brl(d.aVencerBrl)} cor="text-[#d2a948]" linhas={[`${rp.aVencer.qtd} parcelas`]} />
                  <SubCard rotulo="Vencido" valor={brl(d.vencidoBrl)} cor="text-[#f87171]" linhas={[`${rp.vencidas.qtd} parcela(s)`]} />
                  <SubCard rotulo="Inadimplência" valor={`${d.inadimplenciaPct ?? 0}%`} cor="text-[#f87171]" linhas={[`${rp.vencidas.qtd} parcela vencida`]} />
                </div>

                {/* Filtros */}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <select value={pStatus} onChange={(e) => { setPStatus(e.target.value); setPPage(1) }} className={selCls}>
                    <option value="TODAS">Todas</option>
                    {statusDistintos.map((s) => <option key={s} value={s}>{parcelaStatusLabel(s)}</option>)}
                  </select>
                  <select value={pForma} onChange={(e) => { setPForma(e.target.value); setPPage(1) }} className={selCls}>
                    <option value="TODAS">Forma de pagamento</option>
                    {formasDistintas.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <select value={pResp} onChange={(e) => { setPResp(e.target.value); setPPage(1) }} className={selCls}>
                    <option value="TODAS">Responsável</option>
                    {respsDistintos.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <div className="relative min-w-[180px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                    <input value={pBusca} onChange={(e) => { setPBusca(e.target.value); setPPage(1) }} placeholder="Buscar parcela..." className="w-full rounded-lg border border-white/10 bg-[#12161c] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-white/30" />
                  </div>
                  <button onClick={limparFiltros} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 text-sm text-white/70 hover:border-white/25">Limpar filtros</button>
                </div>

                {/* Tabela de parcelas */}
                {parcelas.length === 0 ? (
                  <div className="mt-6 rounded-lg border border-dashed border-white/10 bg-[#12161c] px-4 py-8 text-center text-sm text-white/40">Nenhuma cobrança/parcela para esta receita.</div>
                ) : (
                  <>
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-white/40">
                          <th className="pb-2 font-medium">Parcela</th>
                          <th className="pb-2 font-medium">Responsável</th>
                          <th className="pb-2 font-medium">Vencimento</th>
                          <th className="pb-2 font-medium">Valor</th>
                          <th className="pb-2 font-medium">Valor base</th>
                          <th className="pb-2 font-medium">Recebido</th>
                          <th className="pb-2 font-medium">Saldo</th>
                          <th className="pb-2 font-medium">Status</th>
                          <th className="pb-2 font-medium">Forma</th>
                          <th className="pb-2 font-medium">Ações</th>
                        </tr></thead>
                        <tbody>{parcelasPagina.map((p: any, i: number) => (
                          <tr key={i} className="border-b border-white/10 align-top">
                            <td className="whitespace-nowrap py-3.5 font-medium text-white/95">{p.numero}/{p.totalParcelas}</td>
                            <td className="py-3.5">
                              <span className="inline-flex items-center gap-1.5 text-white/80">{p.responsavel}
                                {d.responsavel?.nome && p.responsavel === d.responsavel.nome && <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300">Principal</span>}
                              </span>
                            </td>
                            <td className="whitespace-nowrap py-3.5 text-white/70">{dataBR(p.vencimento)}
                              {p.status === "VENCIDA" ? <div className="text-xs text-[#f87171]">{p.diasAtraso} dias de atraso</div> : ehHoje(p.vencimento) ? <div className="text-xs text-[#d2a948]">Hoje</div> : null}
                            </td>
                            <td className="whitespace-nowrap py-3.5 font-medium text-white/95">{brl(p.valorBrl)}</td>
                            <td className="whitespace-nowrap py-3.5">
                              <div className="text-white/80">{fmtEUR(p.valorBase)}</div>
                              <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-white/40">Câmbio: {p.cotacao != null ? brl(p.cotacao) : "—"}
                                {p.tipoCambio === "FIXO" && <span className="rounded bg-[#4ade80]/15 px-1 py-0.5 text-[9px] font-semibold text-[#4ade80]">Fixo</span>}
                                {p.tipoCambio === "NAO_DEFINIDO" && <span className="rounded bg-white/10 px-1 py-0.5 text-[9px] font-semibold text-white/50">—</span>}
                              </div>
                            </td>
                            <td className={`whitespace-nowrap py-3.5 ${p.recebidoBrl > 0 ? "font-medium text-[#4ade80]" : "text-white/70"}`}>{brl(p.recebidoBrl)}</td>
                            <td className="whitespace-nowrap py-3.5 font-medium text-[#7dd3fc]">{brl(p.saldoBrl)}</td>
                            <td className="py-3.5"><span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${parcelaStatusCls(p.status)}`}>{parcelaStatusLabel(p.status)}</span></td>
                            <td className="whitespace-nowrap py-3.5 text-white/70">{p.forma ?? "—"}</td>
                            <td className="py-3.5">
                              {p.status === "PAGA" ? (
                                <button onClick={() => setTab("pagamentos")} className="whitespace-nowrap rounded-lg border border-white/15 bg-[#1b2027] px-2.5 py-1.5 text-xs text-white/80 hover:border-white/25">Ver recebimento</button>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <button onClick={() => setPagOpen(true)} className="whitespace-nowrap rounded-lg bg-[#d2a948] px-2.5 py-1.5 text-xs font-semibold text-[#1b1508] hover:bg-[#e0b957]">Registrar pagamento</button>
                                  <button onClick={() => setPagOpen(true)} title="Registrar pagamento" className="rounded-lg border border-white/10 p-1.5 text-white/40 hover:text-white/70"><MoreVertical className="h-4 w-4" /></button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-sm text-white/40">
                      <span>Mostrando {parcDe}–{parcAte} de {parcelasFiltradas.length} parcelas</span>
                      <div className="flex items-center gap-1">
                        <button disabled={paginaAtual <= 1} onClick={() => setPPage((p) => Math.max(1, p - 1))} className="rounded border border-white/10 p-1.5 text-white/40 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                        <span className="rounded border border-white/15 bg-[#252c35] px-2.5 py-1 text-xs text-white/80">{paginaAtual}</span>
                        <button disabled={paginaAtual >= totalPaginas} onClick={() => setPPage((p) => Math.min(totalPaginas, p + 1))} className="rounded border border-white/10 p-1.5 text-white/40 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Documentos */}
            {tab === "documentos" && (
              <div className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
                <h2 className="text-lg font-semibold text-white">Documentos</h2>
                <div className="mt-6 rounded-lg border border-dashed border-white/10 bg-[#12161c] px-4 py-8 text-center text-sm text-white/40">Nenhum documento vinculado a esta receita.</div>
              </div>
            )}

            {/* Histórico de movimentações */}
            {tab === "timeline" && (
            <div className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Histórico de movimentações</h2>
                <button onClick={() => setTab("timeline")} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:border-white/25">Ver timeline completa <ExternalLink className="h-3 w-3" /></button>
              </div>
              <div className="mt-4">{d.historico.map((h: any, i: number) => {
                const Icon = h.tipo === "OBRIGACAO_CRIADA" ? UserPlus : (h.tipo.startsWith("PAGAMENTO") ? ArrowDownCircle : Receipt)
                const cor = h.tipo === "OBRIGACAO_CRIADA" ? "text-violet-400" : (h.tipo.startsWith("PAGAMENTO") ? "text-[#4ade80]" : "text-white/68")
                const ultimo = i === d.historico.length - 1
                return (
                  <div key={h.id} className="flex gap-4">
                    <div className="w-16 shrink-0 pt-0.5 text-right text-[11px] leading-tight text-white/40">{dataBR(h.data)}<br />{new Date(h.data).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
                    <div className="flex flex-col items-center"><div className={`flex h-8 w-8 items-center justify-center rounded-full bg-[#252c35] ${cor}`}><Icon className="h-4 w-4" /></div>{!ultimo && <div className="w-px flex-1 bg-[#252c35]" />}</div>
                    <div className={`flex-1 ${ultimo ? "" : "pb-6"}`}>
                      <div className="flex items-start justify-between"><div className="font-medium text-white/95">{h.titulo}</div><span className="text-xs text-[#7dd3fc]">{h.ator}</span></div>
                      <div className="mt-0.5 text-sm text-white/68">{h.descricao}</div>
                    </div>
                  </div>
                )
              })}</div>
            </div>
            )}
          </div>

          {/* ── Painel direito ── */}
          <div className="space-y-4">
            <Painel titulo="Situação financeira" aberto>
              <Linha k="Valor contratado" v={brl(d.resumo.contratadoBrl)} />
              <Linha k="Recebido" v={brl(d.resumo.recebidoBrl)} cor="text-[#4ade80]" />
              <Linha k="Saldo a receber" v={brl(d.resumo.saldoBrl)} cor="text-[#7dd3fc]" />
              <Linha k="Descontos" v={brl(d.resumo.descontosBrl)} />
              <Linha k="Juros" v={brl(d.resumo.jurosBrl)} />
              <Linha k="Multa" v={brl(d.resumo.multaBrl)} />
              <div className="my-2 border-t border-white/10" />
              <div className="flex items-center justify-between"><span className="text-sm text-white/70">Valor líquido</span><span className="text-lg font-semibold text-white">{brl(d.resumo.liquidoBrl)}</span></div>
            </Painel>

            <Painel titulo="Resumo das parcelas" aberto>
              <DotLinha cor="bg-[#4ade80]" k={`${rp.pagas.qtd} pagas`} v={brl(rp.pagas.valor)} />
              <DotLinha cor="bg-[#d2a948]" k={`${rp.aVencer.qtd} a vencer`} v={brl(rp.aVencer.valor)} />
              <DotLinha cor="bg-[#f87171]" k={`${rp.vencidas.qtd} vencida`} v={brl(rp.vencidas.valor)} />
              <DotLinha cor="bg-white/40" k={`${rp.canceladas.qtd} canceladas`} v={brl(rp.canceladas.valor)} />
              <div className="my-2 border-t border-white/10" />
              <div className="flex items-center justify-between"><span className="text-sm text-white/70">Total</span><span className="text-sm text-white/80">{rp.total} parcelas</span></div>
            </Painel>

            {!semBase && (
            <Painel titulo="Regra de câmbio" aberto>
              <Linha k="Moeda base" v={d.moedaBase === "EUR" ? `${d.moedaBase} - Euro (€)` : d.moedaBase} />
              <Linha k={`Valor base (${d.moedaBase})`} v={fmtEUR(d.valorBase)} />
              <Linha k="Câmbio aplicado" v={d.cotacaoAplicada != null ? brl(d.cotacaoAplicada) : "—"} />
              <Linha k="Tipo de câmbio" v={d.tipoCambio === "FIXO" ? "Fixo" : (d.tipoCambio === "NAO_DEFINIDO" ? "—" : "Variável")} cor={d.tipoCambio === "FIXO" ? "text-[#4ade80]" : undefined} />
              <Linha k="Data da fixação" v={dataBR(d.dataCotacao)} />
              <div className="my-2 border-t border-white/10" />
              <button onClick={() => router.push("/cambio")} className="inline-flex items-center gap-1 text-sm text-[#7dd3fc] hover:underline">Ver detalhes do câmbio <ExternalLink className="h-3.5 w-3.5" /></button>
            </Painel>
            )}

            {d.distribuicao?.length > 0 && (
            <Painel titulo="Distribuição econômica" aberto>
              {d.distribuicao.map((x: any, i: number) => (
                <div key={i} className="py-1.5"><div className="flex items-center justify-between"><span className="text-sm text-white/80">{x.nome}</span><span className="text-sm text-white/70">{x.percentual.toFixed(2)}%</span></div><div className="text-right text-xs text-white/40">{fmt(x.valor, d.moeda)}</div></div>
              ))}
              <div className="my-2 border-t border-white/10" />
              <div className="flex items-center justify-between"><span className="text-sm text-white/70">Total</span><span className="text-sm text-white/70">{Math.round(d.distribuicaoTotal.percentual)}%</span></div>
              <div className="text-right text-base font-semibold text-white">{fmt(d.distribuicaoTotal.valor, d.moeda)}</div>
            </Painel>
            )}

            <Painel titulo={`Responsáveis (${d.responsaveis?.length ?? 0})`}>
              {(d.responsaveis ?? []).length === 0 ? <div className="text-sm text-white/40">—</div> : (d.responsaveis ?? []).map((r: any, i: number) => (
                <div key={i} className="py-1.5 text-sm text-white/80">{r.nome}</div>
              ))}
            </Painel>

            <Painel titulo={`Pagadores (${d.pagadores?.length ?? 0})`}>
              {(d.pagadores ?? []).length === 0 ? <div className="text-sm text-white/40">—</div> : (d.pagadores ?? []).map((p: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-1.5 text-sm"><span className="text-white/80">{p.nome}</span><span className="text-white/70">{brl(p.valor)}</span></div>
              ))}
            </Painel>

            <div className="rounded-xl border border-white/10 bg-[#1b2027] p-4"><div className="text-sm font-medium text-white/70">Observação</div><div className="mt-1 text-sm text-white/40">{d.observacao ?? "—"}</div></div>
          </div>
        </div>
      </div>
      {pagOpen && d && (
        <RegistrarPagamentoModal
          obrigacaoId={d.obrigacaoId}
          moeda={d.moeda}
          saldo={d.saldo}
          natureza={isCusto ? "CUSTO" : "RECEITA"}
          onClose={() => setPagOpen(false)}
          onDone={() => { setPagOpen(false); carregar() }}
        />
      )}
    </div>
  )
}

function Info({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return <div className="py-1"><div className="mb-1 text-xs text-white/40">{rotulo}</div><div className="text-sm">{children}</div></div>
}
function Cell({ rotulo, children, sub }: { rotulo: string; children: React.ReactNode; sub?: string }) {
  return <div className="py-1"><div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/40">{rotulo}</div><div className="text-sm">{children}</div>{sub && <div className="mt-0.5 text-[11px] text-white/40">{sub}</div>}</div>
}
function SubCard({ rotulo, valor, cor, linhas }: { rotulo: string; valor: string; cor?: string; linhas?: string[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#161b21] p-4">
      <div className="text-[11px] uppercase tracking-wider text-white/40">{rotulo}</div>
      <div className={`mt-1.5 text-xl font-semibold ${cor ?? "text-white/95"}`}>{valor}</div>
      {linhas?.map((l, i) => <div key={i} className="mt-1 text-xs text-white/45">{l}</div>)}
    </div>
  )
}
function Linha({ k, v, cor }: { k: string; v: string; cor?: string }) {
  return <div className="flex items-center justify-between py-1.5 text-sm"><span className="text-white/68">{k}</span><span className={cor ?? "text-white/80"}>{v}</span></div>
}
function DotLinha({ cor, k, v }: { cor: string; k: string; v: string }) {
  return <div className="flex items-center justify-between py-1.5 text-sm"><span className="inline-flex items-center gap-2 text-white/68"><span className={`h-2 w-2 rounded-full ${cor}`} />{k}</span><span className="text-white/80">{v}</span></div>
}
function Painel({ titulo, children, aberto }: { titulo: string; children?: React.ReactNode; aberto?: boolean }) {
  const [open, setOpen] = useState(!!aberto)
  return (
    <div className="rounded-xl border border-white/10 bg-[#1b2027] p-4">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between"><span className="text-sm font-semibold text-white/80">{titulo}</span>{open ? <ChevronUp className="h-4 w-4 text-white/40" /> : <ChevronDown className="h-4 w-4 text-white/40" />}</button>
      {open && children && <div className="mt-3">{children}</div>}
    </div>
  )
}
