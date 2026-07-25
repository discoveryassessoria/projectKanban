// src/components/financeiro/v3/ReceitaDetalheView.tsx
// ============================================================================
// DETALHE DA RECEITA (Financeiro V3) — componente reutilizável, embutido no
// modal do processo (ProcessoFinanceiroShell) ou na rota de página dedicada.
// Layout rico aprovado (#80): SEM cabeçalho/sidebar da app — só o conteúdo do
// detalhe; o container hospedeiro provê padding/scroll.
// Dados EXCLUSIVAMENTE do Motor V3 (Ledger/projeções) via /api/financeiro/v3/receita.
// Valores operacionais em BRL; moeda-base contratual (EUR) apresentada como câmbio.
// ============================================================================
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import RegistrarPagamentoModal from "@/src/components/financeiro/v3/RegistrarPagamentoModal"
import RegistrarPagamentoView from "@/src/components/financeiro/v3/RegistrarPagamentoView"
import EditarDistribuicaoView from "@/src/components/financeiro/v3/EditarDistribuicaoView"
import EstornoModal from "@/src/components/financeiro/v3/EstornoModal"
import DefinirEscopoDrawer, { type EscopoEscolhido } from "@/src/components/financeiro/v3/DefinirEscopoDrawer"
import AcaoReceitaModal, { type AcaoReceita } from "@/src/components/financeiro/v3/AcaoReceitaModal"
import EditarReceitaView from "@/src/components/financeiro/v3/EditarReceitaView"
import { NovaFaturaModal } from "@/src/components/kanban/NovaFaturaModal"
import { uploadFiles } from "@/src/lib/storage"
import { emitirMutacaoFinanceira } from "@/src/lib/financeiro-bus"
import { LAYER } from "@/src/lib/ui/layers"
import {
  ArrowLeft, ExternalLink, MoreVertical, Copy, ChevronDown, ChevronUp,
  Receipt, CreditCard, Wallet, FileCheck, Clock, Search, SlidersHorizontal, Calendar,
  Plus, Pencil, ChevronLeft, ChevronRight, UserPlus, ArrowDownCircle, CheckCircle2,
  Info as InfoIcon, X, AlertTriangle, Send, FileText, Loader2, ChevronRight as ChevronRightSm,
  Download, File as FileIcon, Users, StickyNote, RotateCcw,
  Archive, RefreshCcw, Ban, ArrowLeftRight,
} from "lucide-react"

const fmt = (v: number, m = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency: m }).format(v || 0)
const brl = (v: number) => fmt(v, "BRL")
const dataBR = (s?: string | null) => s ? new Date(s).toLocaleDateString("pt-BR") : "—"
const horaBR = (s?: string | null) => s ? new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""
const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }
const iniciais = (n?: string | null) => (n ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?"
const fmtTamanho = (b?: number | null) => { if (b == null) return null; if (b < 1024) return `${b} B`; if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`; return `${(b / (1024 * 1024)).toFixed(1)} MB` }

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
  const [tab, setTab] = useState("cobrancas")
  const [drawerPart, setDrawerPart] = useState<any>(null) // participante aberto no drawer (obrigacaoId + nome)
  const [pagOpen, setPagOpen] = useState(false)
  const [receberOpen, setReceberOpen] = useState(false)
  const [receberEscopo, setReceberEscopo] = useState<EscopoEscolhido | null>(null)
  const [distribuicaoOpen, setDistribuicaoOpen] = useState(false)
  const [acaoModal, setAcaoModal] = useState<AcaoReceita | null>(null)
  const [editarReceitaOpen, setEditarReceitaOpen] = useState(false)
  const [faturaOpen, setFaturaOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [maisOpen, setMaisOpen] = useState(false)
  const [verMais, setVerMais] = useState(false)
  const [busca, setBusca] = useState("")
  const [copiado, setCopiado] = useState(false)
  const [pStatus, setPStatus] = useState("TODAS")
  const [pForma, setPForma] = useState("TODAS")
  const [pResp, setPResp] = useState("TODAS")
  const [pBusca, setPBusca] = useState("")
  const [pPage, setPPage] = useState(1)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const jaCarregou = useRef(false)
  const carregar = useCallback(() => {
    fetch(`/api/financeiro/v3/receita/${encodeURIComponent(refParam)}`, { headers: authHeaders() })
      .then(async (r) => {
        const j = await r.json(); if (r.ok && j.disponivel) { setD(j.receita); setErro(null) } else setErro(j.fallbackLegado ? "Financeiro V3 indisponível." : "Receita não encontrada.")
        // RECARGA (pós-mutação) propaga a revalidação p/ lista/dashboard/central; a 1ª carga não.
        if (jaCarregou.current) emitirMutacaoFinanceira({ obrigacaoId: r.ok && j.disponivel ? j.receita?.obrigacaoId : null })
        jaCarregou.current = true
      })
      .catch(() => setErro("Falha ao carregar."))
  }, [refParam])

  useEffect(() => { carregar() }, [carregar])

  const copiarCodigo = () => { if (!d?.codigo) return; navigator.clipboard?.writeText(d.codigo).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500) }).catch(() => {}) }

  // "Editar" um pagamento confirmado = estornar (auditável, total ou parcial) via EstornoModal.
  // Nunca edição in-place de lançamento financeiro (integridade contábil).
  const [estornoAlvo, setEstornoAlvo] = useState<any>(null)

  // "Enviar cobrança" (Fase D) = marcar a Cobrança como enviada ao cliente
  // (estado auditável — não há entrega real de e-mail/WhatsApp).
  const enviarCobranca = async () => {
    const cobs: any[] = d?.cobrancas ?? []
    if (cobs.length === 0) { alert("Nenhuma cobrança para enviar. Gere uma cobrança primeiro."); return }
    const alvo = cobs.find((c) => c.enviadaEm == null) ?? cobs[0]
    if (!window.confirm("Marcar esta cobrança como enviada ao cliente?")) return
    try {
      const res = await fetch(`/api/financeiro/cobrancas/${alvo.id}/enviar`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() } })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) alert(j?.erro || `Falha ao enviar a cobrança (HTTP ${res.status}).`)
      else carregar()
    } catch { alert("Falha de rede ao enviar a cobrança.") }
  }

  // Anexar documento: upload ao R2 → vincula na Receita → refetch.
  const onSelecionarArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (e.target) e.target.value = "" // permite reanexar o mesmo arquivo
    if (!file || d?.receitaId == null) return
    setUploading(true)
    try {
      const [enviado] = await uploadFiles([file], { prefix: "financeiro/documentos" })
      if (!enviado) throw new Error("Falha no upload do arquivo.")
      const res = await fetch(`/api/financeiro/receitas/${d.receitaId}/documentos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ arquivoUrl: enviado.url, arquivoNome: enviado.name, tipo: null, tamanho: enviado.size }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) alert(j?.error || `Falha ao vincular documento (HTTP ${res.status}).`)
      else carregar()
    } catch (err) {
      alert((err as Error)?.message || "Falha ao anexar o documento.")
    } finally {
      setUploading(false)
    }
  }

  if (erro) return <div className="p-8 text-sm text-white/68">{erro}</div>
  if (!d) return <div className="p-8 text-sm text-white/40">carregando…</div>

  const isCusto = d.natureza === "CUSTO"
  const semBase = d.moedaBase === "BRL"
  const fmtEUR = (v: number) => fmt(v, d.moedaBase)
  const moedaBaseLabel = d.moedaBase === "EUR" ? "Euro (EUR)" : d.moedaBase
  const pct = d.valorContratadoBrl ? Math.round((d.recebidoBrl / d.valorContratadoBrl) * 100) : 0
  const podeEditar = d.receitaId != null
  const temProcesso = d.processo?.id != null

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

  // ── Distribuição entre requerentes ──
  const dist: any[] = d.distribuicaoRequerentes ?? []
  const divisaoIgual = dist.length > 1 && new Set(dist.map((r) => Math.round(Number(r.percentual)))).size === 1
  const historico: any[] = d.historico ?? []
  const documentos: any[] = d.documentos ?? []

  // ── Participantes financeiros (visão consolidada do grupo) ──
  const participantes: any[] = d.participantes ?? []
  const somaBase = participantes.reduce((s, p) => s + (Number(p.valorBase) || 0), 0)
  const somaContratado = participantes.reduce((s, p) => s + (Number(p.valorContratadoBrl) || 0), 0)
  const somaRecebido = participantes.reduce((s, p) => s + (Number(p.recebidoBrl) || 0), 0)
  const somaSaldo = participantes.reduce((s, p) => s + (Number(p.saldoBrl) || 0), 0)
  const somaParcelas = participantes.reduce((s, p) => s + (Number(p.parcelas) || 0), 0)
  const somaRecParcelas = participantes.reduce((s, p) => s + (Number(p.parcelasRecebidas) || 0), 0)
  const papelLabel = (papel?: string | null) => {
    const P = (papel ?? "").toUpperCase()
    if (!P || P.includes("PRINCIPAL")) return "Principal"
    return papel as string
  }

  // Exportação real (CSV) das linhas de participantes.
  const exportarParticipantesCsv = () => {
    const header = ["Participante", "Papel", "Participação", "Moeda", "% Participação", "Valor contratado (BRL)", "Recebido (BRL)", "Saldo (BRL)", "Próximo vencimento", "Status", "Parcelas", "Parcelas recebidas"]
    const linhas = participantes.map((p) => [p.nome, papelLabel(p.papel), p.valorBase, p.moedaBase, p.participacaoPct, p.valorContratadoBrl, p.recebidoBrl, p.saldoBrl, p.proximoVencimento ? dataBR(p.proximoVencimento) : "", p.status, p.parcelas, p.parcelasRecebidas])
    const csv = [header, ...linhas].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n")
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = `${d.codigo ?? "participantes"}-participantes.csv`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }

  const alertaIcone = (sev: string) => {
    if (sev === "crit") return "text-[#f87171]"
    if (sev === "warn") return "text-[#d2a948]"
    return "text-[#7dd3fc]"
  }

  // Contadores só quando > 0 (Resumo/Timeline/Observações não têm contador).
  const tabs: [string, string, any, number][] = [
    ["cobrancas", "Cobranças", CreditCard, rp.total],
    ["participantes", "Participantes Financeiros", Users, d.participantesCount ?? participantes.length],
    ["pagamentos", "Pagamentos", Wallet, (d.pagamentos ?? []).length],
    ["documentos", "Documentos", FileCheck, documentos.length],
    ["timeline", "Timeline", Clock, 0],
    ["observacoes", "Observações", StickyNote, 0],
  ]

  return (
    <div className="text-white/80">
      <div className="mx-auto max-w-[1400px] px-1 py-1">
        {/* ── HEADER ── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <button onClick={onVoltar} className="mb-3 flex items-center gap-2 text-sm text-white/68 hover:text-white/80"><ArrowLeft className="h-4 w-4" /> Voltar para {isCusto ? "Custos" : "Receitas"}</button>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[28px] font-bold leading-tight text-white">{d.descricao ?? d.codigo}</h1>
              <span className={`rounded-md px-2.5 py-1 text-xs font-semibold tracking-wide ${statusCls(d.statusLabel)}`}>{d.statusLabel}</span>
              {d.consolidado && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-medium text-violet-300"><Users className="h-3.5 w-3.5" /> {d.participantesCount} participantes</span>
              )}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[13px] text-white/40">
              <span>🧾</span> Financeiro <span className="text-white/30">›</span> {isCusto ? "Custos" : "Receitas"} <span className="text-white/30">›</span>
              <span className="text-white/68">{d.codigo}</span>
            </div>
            {d.criadoPor === "Sistema" && (
              <div className="mt-1.5 text-[12px] text-white/40">Receita gerada automaticamente pela regra financeira da fase.</div>
            )}
            <div className="mt-1 text-[12px] text-white/40">{d.codigo} · {dataBR(d.criadoEm)} · Criado por {d.criadoPor}</div>
          </div>

          {/* Ações do topo */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => podeEditar && setEditOpen(true)}
              disabled={!podeEditar}
              title={podeEditar ? "Editar metadados da receita" : "Edição disponível apenas para receitas de origem"}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#1b2027] px-3.5 py-2 text-sm font-medium text-white/80 hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-40"
            ><Pencil className="h-4 w-4" /> Editar receita</button>

            <button onClick={() => setReceberOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#d2a948] px-3.5 py-2 text-sm font-semibold text-[#1b1508] hover:bg-[#e0b957]"><Plus className="h-4 w-4" /> Registrar pagamento</button>

            <div className="relative">
              <button onClick={() => setMaisOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#1b2027] px-3 py-2 text-sm text-white/80 hover:border-white/25">Mais ações <ChevronDown className="h-3.5 w-3.5" /></button>
              {maisOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMaisOpen(false)} />
                  <div className="absolute right-0 z-50 mt-1 w-60 overflow-hidden rounded-lg border border-white/10 bg-[#1b2027] py-1 shadow-xl shadow-black/40">
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/30">Gestão financeira</div>
                    <button onClick={() => { setMaisOpen(false); setEditarReceitaOpen(true) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white/80 hover:bg-white/5"><Pencil className="h-4 w-4 text-white/45" /> Editar Receita</button>
                    <button onClick={() => { setMaisOpen(false); setEditarReceitaOpen(true) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white/80 hover:bg-white/5"><ArrowLeftRight className="h-4 w-4 text-white/45" /> Editar regra de câmbio</button>
                    <button onClick={() => { setMaisOpen(false); temProcesso ? setFaturaOpen(true) : undefined }} disabled={!temProcesso} title={temProcesso ? "" : "Processo não vinculado"} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white/80 hover:bg-white/5 disabled:opacity-40"><FileText className="h-4 w-4 text-white/45" /> Gerar fatura</button>
                    <button onClick={() => { setMaisOpen(false); setAcaoModal("recibo") }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white/80 hover:bg-white/5"><FileCheck className="h-4 w-4 text-white/45" /> Gerar recibo</button>
                    <div className="my-1 border-t border-white/10" />
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/30">Críticas</div>
                    <button onClick={() => { setMaisOpen(false); setAcaoModal("renegociar") }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white/80 hover:bg-white/5"><RefreshCcw className="h-4 w-4 text-[#7dd3fc]" /> Renegociar</button>
                    <button onClick={() => { setMaisOpen(false); setTab("pagamentos") }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white/80 hover:bg-white/5"><RotateCcw className="h-4 w-4 text-[#f87171]" /> Estornar pagamento</button>
                    <div className="my-1 border-t border-white/10" />
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/30">Encerramento</div>
                    <button onClick={() => { setMaisOpen(false); setAcaoModal("arquivar") }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white/80 hover:bg-white/5"><Archive className="h-4 w-4 text-[#a78bfa]" /> Arquivar</button>
                    <button onClick={() => { setMaisOpen(false); setAcaoModal("cancelar") }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#f87171] hover:bg-white/5"><Ban className="h-4 w-4" /> Cancelar Receita</button>
                    <div className="my-1 border-t border-white/10" />
                    <button onClick={() => { setMaisOpen(false); setTab("timeline") }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white/80 hover:bg-white/5"><Clock className="h-4 w-4 text-white/45" /> Ver movimentações</button>
                    <button onClick={() => { setMaisOpen(false); copiarCodigo() }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white/80 hover:bg-white/5">{copiado ? <CheckCircle2 className="h-4 w-4 text-[#4ade80]" /> : <Copy className="h-4 w-4 text-white/45" />} Copiar código</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── TOP: (info + situação + ações)  |  sidebar ── */}
        <div className="mt-5 space-y-5">
          {/* ─── COLUNA PRINCIPAL ─── */}
          <div className="min-w-0 space-y-5">
            {/* INFO CARD */}
            <div className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
                <Info rotulo={isCusto ? "Custo" : "Receita"}><span className="inline-flex items-center gap-1.5 font-medium text-white/95">{d.codigo}<button onClick={copiarCodigo} title="Copiar código" className="text-white/40 hover:text-white/80">{copiado ? <CheckCircle2 className="h-3.5 w-3.5 text-[#4ade80]" /> : <Copy className="h-3.5 w-3.5" />}</button></span></Info>
                <Info rotulo={`Moeda-base (Contrato)`}><span className="font-medium text-white/95">{fmtEUR(d.valorBase)}</span><div className="mt-0.5 text-[11px] text-white/40">{moedaBaseLabel}</div></Info>
                <Info rotulo="Câmbio aplicado">
                  <span className="inline-flex items-center gap-2 font-medium text-white/95">{d.cotacaoAplicada != null ? brl(d.cotacaoAplicada) : "—"}
                    {d.tipoCambio === "FIXO" && <span className="rounded bg-[#4ade80]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#4ade80]">Fixo</span>}
                  </span>
                  <div className="mt-0.5 text-[11px] text-white/40">{d.tipoCambio === "FIXO" ? `Fixo desde ${dataBR(d.dataCotacao)}` : dataBR(d.dataCotacao)}</div>
                </Info>
                <Info rotulo="Valor contratado (BRL)"><span className="font-semibold text-white/95">{brl(d.valorContratadoBrl)}</span></Info>
              </div>

              {verMais && (
                <>
                  <div className="my-4 border-t border-white/10" />
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
                    <Info rotulo="Status">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${statusCls(d.statusLabel)}`}>{d.statusLabel}</span>
                      {d.proximoVencimento && <div className="mt-1 text-[11px] text-white/40">Próxima parcela em {dataBR(d.proximoVencimento)}</div>}
                    </Info>
                    <Info rotulo="Descrição"><span className="text-white/80">{d.descricao ?? "—"}</span></Info>
                    <Info rotulo="Forma de cobrança"><span className="text-white/80">{d.formaCobranca ?? "—"}</span></Info>
                    <Info rotulo="Responsável">{d.responsavel ? <span className="inline-flex items-center gap-2 text-white/80">{d.responsavel.nome}<span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[11px] text-violet-300">Principal</span></span> : "—"}</Info>
                    <Info rotulo="Criado em"><span className="text-white/70">{dataBR(d.criadoEm)} às {horaBR(d.criadoEm)}</span><div className="mt-0.5 text-[11px] text-white/40">por {d.criadoPor}</div></Info>
                    <Info rotulo="Vencimento final"><span className="text-white/80">{dataBR(d.vencimento)}</span></Info>
                    <Info rotulo="Processo">
                      <div className="text-white/80">{d.processo.codigo ?? "—"}{d.processo.nome ? ` – ${d.processo.nome}` : ""}</div>
                      {temProcesso && <a href={`/financeiro/v3/processo-preview?processoId=${d.processo.id}`} className="inline-flex items-center gap-1 text-xs text-[#7dd3fc] hover:underline">Abrir processo <ExternalLink className="h-3 w-3" /></a>}
                    </Info>
                    <Info rotulo="Câmbio">
                      <button onClick={() => router.push("/cambio")} className="inline-flex items-center gap-1 text-sm text-[#7dd3fc] hover:underline">Entenda o câmbio aplicado <ExternalLink className="h-3.5 w-3.5" /></button>
                    </Info>
                  </div>
                </>
              )}

              <button onClick={() => setVerMais((v) => !v)} className="mt-4 inline-flex items-center gap-1.5 text-sm text-[#7dd3fc] hover:underline">
                {verMais ? "Ocultar detalhes da receita" : "Ver mais detalhes da receita"} {verMais ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>

            {/* SITUAÇÃO FINANCEIRA */}
            <div className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
              <h2 className="text-lg font-semibold text-white">Situação financeira</h2>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <SubCard rotulo="Valor contratado" valor={brl(d.valorContratadoBrl)} linhas={!semBase ? [`Base contratual: ${fmtEUR(d.valorBase)}`] : []} />
                <SubCard rotulo={isCusto ? "Pago" : "Recebido"} valor={brl(d.recebidoBrl)} cor="text-[#4ade80]" linhas={[`${pct}% do total`, `${d.parcelasRecebidas} parcela(s) recebida(s)`]} />
                <SubCard rotulo="A vencer" valor={brl(d.aVencerBrl)} cor="text-[#d2a948]" linhas={[`${d.parcelasAVencer} parcela(s)`, `Próximo: ${dataBR(d.proximoVencimento)}`]} />
                <SubCard rotulo="Vencido" valor={brl(d.vencidoBrl)} cor="text-[#f87171]" linhas={[`${d.parcelasVencidas} parcela(s)`, ...(d.parcelasVencidas ? [`Desde ${dataBR(d.proximoVencimento)}`] : [])]} />
                <SubCard rotulo="Saldo a receber" valor={brl(d.saldoBrl)} cor="text-[#7dd3fc]" linhas={[`${d.parcelas} parcela(s) em aberto`]} />
              </div>
            </div>

          </div>

          
        </div>

        {/* ── ABAS ── */}
        <div className="mt-6 flex items-center gap-7 overflow-x-auto border-b border-white/10">
          {tabs.map(([id, label, Icon, badge]) => (
            <button key={id} onClick={() => setTab(id)} className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-1 pb-3 pt-2 text-sm ${tab === id ? "border-[#d2a948] font-medium text-[#d2a948]" : "border-transparent text-white/68 hover:text-white/80"}`}>
              <Icon className="h-4 w-4" /> {label}{badge ? <span className="ml-1 rounded-full bg-[#252c35] px-1.5 text-[11px] text-white/70">{badge}</span> : null}
            </button>
          ))}
        </div>

        {/* ── CONTEÚDO DAS ABAS ── */}
        <div className="mt-5">
          {/* Participantes Financeiros */}
          {tab === "participantes" && (
            <div className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><span>👥</span> Participantes Financeiros</h2>
                  <p className="mt-1 text-sm text-white/45">Distribuição desta Receita entre os responsáveis pelo pagamento.</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => setDistribuicaoOpen(true)} title="Editar como o total é dividido entre os participantes" className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#1b2027] px-3 py-2 text-sm font-medium text-white/80 hover:border-white/25"><Pencil className="h-4 w-4" /> Editar distribuição</button>
                  <button onClick={exportarParticipantesCsv} title="Exportar participantes em CSV" className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#1b2027] px-3 py-2 text-sm font-medium text-white/80 hover:border-white/25"><Download className="h-4 w-4" /> Exportar</button>
                </div>
              </div>

              {participantes.length === 0 ? (
                <div className="mt-6 rounded-lg border border-dashed border-white/10 bg-[#12161c] px-4 py-8 text-center text-sm text-white/40">Sem participantes na distribuição desta receita.</div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-white/40">
                      <th className="pb-2 font-medium">Participante</th>
                      <th className="pb-2 font-medium">Participação ({d.moedaBase})</th>
                      <th className="pb-2 font-medium">Valor contratado (BRL)</th>
                      <th className="pb-2 font-medium">Recebido (BRL)</th>
                      <th className="pb-2 font-medium">Saldo (BRL)</th>
                      <th className="pb-2 font-medium">Próximo vencimento</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Ações</th>
                    </tr></thead>
                    <tbody>
                      {participantes.map((p: any, i: number) => (
                        <tr key={p.obrigacaoId ?? i} className="border-b border-white/10 align-top">
                          <td className="py-3.5">
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-[11px] font-semibold text-violet-300">{iniciais(p.nome)}</span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-sm font-medium text-white/90">{p.nome}</span>
                                  <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">{papelLabel(p.papel)}</span>
                                </div>
                                <div className="text-[11px] text-white/40">Requerente</div>
                              </div>
                            </div>
                          </td>
                          <td className="whitespace-nowrap py-3.5">
                            <div className="font-medium text-white/90">{fmt(p.valorBase, p.moedaBase)}</div>
                            <div className="mt-0.5 text-xs text-white/40">{Number(p.participacaoPct).toFixed(2)}%</div>
                          </td>
                          <td className="whitespace-nowrap py-3.5 font-medium text-white/95">{brl(p.valorContratadoBrl)}</td>
                          <td className="whitespace-nowrap py-3.5">
                            <div className={p.recebidoBrl > 0 ? "font-medium text-[#4ade80]" : "text-white/70"}>{brl(p.recebidoBrl)}</div>
                            <div className="mt-0.5 text-xs text-white/40">{p.parcelasRecebidas} parcela(s)</div>
                          </td>
                          <td className="whitespace-nowrap py-3.5">
                            <div className="font-medium text-[#7dd3fc]">{brl(p.saldoBrl)}</div>
                            <div className="mt-0.5 text-xs text-white/40">{p.parcelas} parcela(s)</div>
                          </td>
                          <td className="whitespace-nowrap py-3.5 text-white/70">{dataBR(p.proximoVencimento)}</td>
                          <td className="py-3.5"><span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${statusCls(p.status)}`}>{p.status}</span></td>
                          <td className="py-3.5">
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => setDrawerPart({ obrigacaoId: p.obrigacaoId, nome: p.nome })} className="whitespace-nowrap rounded-lg border border-white/15 bg-[#1b2027] px-2.5 py-1.5 text-xs font-medium text-white/80 hover:border-white/30">Abrir</button>
                              <button onClick={() => setDrawerPart({ obrigacaoId: p.obrigacaoId, nome: p.nome })} title="Abrir participante" className="rounded-lg border border-white/10 p-1.5 text-white/40 hover:text-white/70"><MoreVertical className="h-4 w-4" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {/* Totalização — valida que a distribuição fecha em 100% e bate com o consolidado */}
                      <tr className="border-t-2 border-white/15 bg-[#161b21]">
                        <td className="py-3.5">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4ade80]/15 text-[#4ade80]"><CheckCircle2 className="h-4 w-4" /></span>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white/90">Total da distribuição</div>
                              <div className="text-[11px] text-white/45">100,00%</div>
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap py-3.5 font-semibold text-white/90">{fmt(somaBase, d.moedaBase)}</td>
                        <td className="whitespace-nowrap py-3.5 font-semibold text-white/95">{brl(somaContratado)}</td>
                        <td className="whitespace-nowrap py-3.5">
                          <div className="font-semibold text-[#4ade80]">{brl(somaRecebido)}</div>
                          <div className="mt-0.5 text-xs text-white/40">{somaRecParcelas} parcela(s)</div>
                        </td>
                        <td className="whitespace-nowrap py-3.5">
                          <div className="font-semibold text-[#7dd3fc]">{brl(somaSaldo)}</div>
                          <div className="mt-0.5 text-xs text-white/40">{somaParcelas} parcela(s)</div>
                        </td>
                        <td className="py-3.5 text-white/30">—</td>
                        <td className="py-3.5 text-white/30">—</td>
                        <td className="py-3.5 text-white/30">—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Pagamentos */}
          {tab === "pagamentos" && (
          <div className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-white">Pagamentos</h2><span className="rounded-full bg-[#252c35] px-2 py-0.5 text-xs text-white/70">{d.pagamentos.length}</span></div>
              <button onClick={() => setReceberOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#d2a948] px-3.5 py-2 text-sm font-semibold text-[#1b1508] hover:bg-[#e0b957]"><Plus className="h-4 w-4" /> Registrar pagamento</button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="relative min-w-[180px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pagamentos..." className="w-full rounded-lg border border-white/10 bg-[#12161c] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-white/30" /></div>
              <button className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 text-sm text-white/70"><SlidersHorizontal className="h-4 w-4" /> Filtros</button>
              <button className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 text-sm text-white/70"><Calendar className="h-4 w-4" /> Período <ChevronDown className="h-3.5 w-3.5" /></button>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
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
                    <td><PagamentoRowMenu p={p} onEstornar={() => setEstornoAlvo(p)} onTimeline={() => setTab("timeline")} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
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
                        <th className="pb-2 font-medium">Restante (BRL)</th>
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
                                <button onClick={() => setReceberOpen(true)} className="whitespace-nowrap rounded-lg bg-[#d2a948] px-2.5 py-1.5 text-xs font-semibold text-[#1b1508] hover:bg-[#e0b957]">Registrar pagamento</button>
                                <button onClick={() => setReceberOpen(true)} title="Registrar pagamento" className="rounded-lg border border-white/10 p-1.5 text-white/40 hover:text-white/70"><MoreVertical className="h-4 w-4" /></button>
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
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-white">Documentos</h2><span className="rounded-full bg-[#252c35] px-2 py-0.5 text-xs text-white/70">{documentos.length}</span></div>
                <input ref={fileInputRef} type="file" className="hidden" onChange={onSelecionarArquivo} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || d.receitaId == null}
                  title={d.receitaId == null ? "Anexo disponível apenas para receitas de origem" : "Anexar documento"}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#d2a948] px-3.5 py-2 text-sm font-semibold text-[#1b1508] hover:bg-[#e0b957] disabled:cursor-not-allowed disabled:opacity-50"
                >{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {uploading ? "Enviando…" : "Anexar documento"}</button>
              </div>
              {documentos.length === 0 ? (
                <div className="mt-6 rounded-lg border border-dashed border-white/10 bg-[#12161c] px-4 py-8 text-center text-sm text-white/40">Nenhum documento vinculado a esta receita.</div>
              ) : (
                <div className="mt-4 space-y-2">
                  {documentos.map((doc: any) => (
                    <div key={doc.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#161b21] px-4 py-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#252c35] text-white/60"><FileIcon className="h-4.5 w-4.5" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-white/90">{doc.nome}</div>
                        <div className="mt-0.5 text-xs text-white/40">{[doc.tipo, fmtTamanho(doc.tamanho), `Anexado em ${dataBR(doc.criadoEm)}`].filter(Boolean).join(" · ")}</div>
                      </div>
                      <a href={doc.url} target="_blank" rel="noreferrer" download className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-white/80 hover:border-white/25"><Download className="h-4 w-4" /> Baixar</a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Timeline / Histórico de movimentações */}
          {tab === "timeline" && (
          <div className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
            <h2 className="text-lg font-semibold text-white">Histórico de movimentações</h2>
            <div className="mt-4">{historico.map((h: any, i: number) => {
              const Icon = h.tipo === "OBRIGACAO_CRIADA" ? UserPlus : (String(h.tipo).startsWith("PAGAMENTO") ? ArrowDownCircle : Receipt)
              const cor = h.tipo === "OBRIGACAO_CRIADA" ? "text-violet-400" : (String(h.tipo).startsWith("PAGAMENTO") ? "text-[#4ade80]" : "text-white/68")
              const ultimo = i === historico.length - 1
              return (
                <div key={h.id ?? i} className="flex gap-4">
                  <div className="w-16 shrink-0 pt-0.5 text-right text-[11px] leading-tight text-white/40">{dataBR(h.data)}<br />{horaBR(h.data)}</div>
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

          {/* Observações */}
          {tab === "observacoes" && (
            <div className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
              <div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-white">Observações</h2></div>
              <div className="mt-4 rounded-lg border border-white/10 bg-[#161b21] px-4 py-4">
                <div className="whitespace-pre-wrap text-sm text-white/80">{d.observacao ?? "—"}</div>
              </div>
              <div className="mt-2 text-xs text-white/40">Notas internas</div>
            </div>
          )}
        </div>
      </div>

      {/* ── DRAWER DO PARTICIPANTE ── */}
      {drawerPart && (
        <ParticipanteDrawer
          obrigacaoId={drawerPart.obrigacaoId}
          nome={drawerPart.nome}
          codigoReceita={d.codigo}
          onClose={() => setDrawerPart(null)}
          onPagamentoRegistrado={carregar}
        />
      )}

      {/* ── MODAIS ── */}
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
      {receberOpen && d && (
        <DefinirEscopoDrawer
          receitaRef={String(d.obrigacaoId)}
          onClose={() => setReceberOpen(false)}
          onEscolher={(e) => { setReceberEscopo(e); setReceberOpen(false) }}
        />
      )}
      {receberEscopo && d && (
        <RegistrarPagamentoView
          obrigacaoId={receberEscopo.obrigacaoId}
          receitaRef={String(d.obrigacaoId)}
          escopo={receberEscopo}
          onTrocarEscopo={() => { setReceberEscopo(null); setReceberOpen(true) }}
          onClose={() => setReceberEscopo(null)}
          onDone={() => { setReceberEscopo(null); carregar() }}
        />
      )}
      {distribuicaoOpen && d && (
        <EditarDistribuicaoView
          obrigacaoId={d.obrigacaoId}
          receitaRef={String(d.obrigacaoId)}
          onClose={() => setDistribuicaoOpen(false)}
          onDone={() => { setDistribuicaoOpen(false); carregar() }}
        />
      )}
      {estornoAlvo && d && (
        <EstornoModal
          obrigacaoId={d.obrigacaoId}
          moeda={d.moeda}
          pagamento={estornoAlvo}
          onClose={() => setEstornoAlvo(null)}
          onDone={() => { setEstornoAlvo(null); carregar() }}
        />
      )}
      {acaoModal && d && (
        <AcaoReceitaModal
          acao={acaoModal}
          receitaRef={String(d.obrigacaoId)}
          onClose={() => setAcaoModal(null)}
          onDone={() => { setAcaoModal(null); carregar() }}
        />
      )}
      {editarReceitaOpen && d && (
        <EditarReceitaView
          obrigacaoId={d.obrigacaoId}
          receitaRef={String(d.obrigacaoId)}
          onClose={() => setEditarReceitaOpen(false)}
          onDone={() => { setEditarReceitaOpen(false); carregar() }}
        />
      )}
      {faturaOpen && temProcesso && (
        <NovaFaturaModal
          processoId={d.processo.id}
          receitaId={d.receitaId}
          onClose={() => setFaturaOpen(false)}
          onSuccess={() => { setFaturaOpen(false); carregar() }}
        />
      )}
      {editOpen && podeEditar && (
        <EditarReceitaModal
          receitaId={d.receitaId}
          descricaoInicial={d.descricao ?? ""}
          observacaoInicial={d.observacao ?? ""}
          onClose={() => setEditOpen(false)}
          onDone={() => { setEditOpen(false); carregar() }}
        />
      )}
    </div>
  )
}

// ── Menu de ações por linha de PAGAMENTO — só ações realmente ligadas (sem botão morto):
// Estornar (total/parcial via EstornoModal), Ver movimentações (Timeline) e Copiar referência. ──
function PagamentoRowMenu({ p, onEstornar, onTimeline }: { p: any; onEstornar: () => void; onTimeline: () => void }) {
  const [open, setOpen] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const ref = p?.referencia ?? p?.codigo ?? null
  const copiar = async () => { if (!ref) return; try { await navigator.clipboard.writeText(String(ref)); setCopiado(true); setTimeout(() => setCopiado(false), 1400) } catch { /* clipboard indisponível */ } }
  return (
    <div className="relative flex justify-end">
      <button onClick={() => setOpen(o => !o)} title="Ações do pagamento" className="rounded-lg border border-white/10 p-1.5 text-white/40 hover:text-white/80"><MoreVertical className="h-4 w-4" /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-50 w-52 overflow-hidden rounded-lg border border-white/10 bg-[#1b2027] py-1 shadow-xl shadow-black/40">
            <button onClick={() => { setOpen(false); onTimeline() }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white/80 hover:bg-white/5"><Clock className="h-4 w-4 text-white/45" /> Ver movimentações</button>
            <button onClick={() => { setOpen(false); copiar() }} disabled={!ref} title={ref ? "" : "Sem referência"} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white/80 hover:bg-white/5 disabled:opacity-40">{copiado ? <CheckCircle2 className="h-4 w-4 text-[#4ade80]" /> : <Copy className="h-4 w-4 text-white/45" />} Copiar referência</button>
            <div className="my-1 border-t border-white/10" />
            <button onClick={() => { setOpen(false); onEstornar() }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#f87171] hover:bg-white/5"><RotateCcw className="h-4 w-4" /> Estornar (total ou parcial)</button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Drawer do participante: visão de UM requerente DENTRO do contexto da Receita ──
// Busca a visão single (?obrigacao=<id>) e mostra status/valores/parcelas/pagamentos
// daquele participante, sem sair da tela consolidada. Read-focused + registrar pagamento.
function ParticipanteDrawer({ obrigacaoId, nome, codigoReceita, onClose, onPagamentoRegistrado }: { obrigacaoId: number; nome: string; codigoReceita: string; onClose: () => void; onPagamentoRegistrado: () => void }) {
  const [pd, setPd] = useState<any>(null)
  const [pErro, setPErro] = useState<string | null>(null)
  const [pagOpen, setPagOpen] = useState(false)

  const load = useCallback(() => {
    fetch(`/api/financeiro/v3/receita/${obrigacaoId}?obrigacao=${obrigacaoId}`, { headers: authHeaders() })
      .then(async (r) => { const j = await r.json(); if (r.ok && j.disponivel) { setPd(j.receita); setPErro(null) } else setPErro("Participante não encontrado.") })
      .catch(() => setPErro("Falha ao carregar."))
  }, [obrigacaoId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const orig = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onEsc)
    return () => { document.body.style.overflow = orig; document.removeEventListener("keydown", onEsc) }
  }, [onClose])

  if (typeof document === "undefined") return null

  const parcelas: any[] = pd?.parcelasDetalhe ?? []
  const pagamentos: any[] = pd?.pagamentos ?? []

  return createPortal(
    <>
      <div className="fixed inset-0 flex justify-end bg-black/60" style={{ zIndex: LAYER.aboveProcessDrawer }} onClick={onClose}>
        <div className="flex h-full w-full max-w-[600px] flex-col overflow-hidden border-l border-white/10 bg-[#1b2027] shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-xs font-semibold text-violet-300">{iniciais(nome)}</span>
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-white">{nome}</h3>
                <div className="text-xs text-white/40">participante de {codigoReceita}</div>
              </div>
            </div>
            <button onClick={onClose} className="shrink-0 text-white/40 hover:text-white/80"><X className="h-5 w-5" /></button>
          </div>

          {/* Corpo */}
          <div className="flex-1 overflow-y-auto px-5 py-5">
            {pErro ? (
              <div className="rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-3 py-2 text-sm text-[#f87171]">{pErro}</div>
            ) : !pd ? (
              <div className="flex items-center gap-2 text-sm text-white/40"><Loader2 className="h-4 w-4 animate-spin" /> carregando…</div>
            ) : (
              <div className="space-y-5">
                {/* Status + valores */}
                <div>
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${statusCls(pd.statusLabel)}`}>{pd.statusLabel}</span>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-white/10 bg-[#161b21] p-3">
                      <div className="text-[11px] uppercase tracking-wider text-white/40">Contratado</div>
                      <div className="mt-1 text-base font-semibold text-white/95">{brl(pd.valorContratadoBrl)}</div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-[#161b21] p-3">
                      <div className="text-[11px] uppercase tracking-wider text-white/40">Recebido</div>
                      <div className="mt-1 text-base font-semibold text-[#4ade80]">{brl(pd.recebidoBrl)}</div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-[#161b21] p-3">
                      <div className="text-[11px] uppercase tracking-wider text-white/40">Saldo</div>
                      <div className="mt-1 text-base font-semibold text-[#7dd3fc]">{brl(pd.saldoBrl)}</div>
                    </div>
                  </div>
                </div>

                {/* Parcelas */}
                <div>
                  <div className="mb-2 text-sm font-semibold text-white/85">Parcelas <span className="text-white/40">({parcelas.length})</span></div>
                  {parcelas.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-white/10 bg-[#12161c] px-3 py-5 text-center text-xs text-white/40">Sem parcelas.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-white/40">
                          <th className="pb-2 font-medium">Parcela</th>
                          <th className="pb-2 font-medium">Vencimento</th>
                          <th className="pb-2 font-medium">Valor</th>
                          <th className="pb-2 font-medium">Recebido</th>
                          <th className="pb-2 font-medium">Status</th>
                        </tr></thead>
                        <tbody>{parcelas.map((p: any, i: number) => (
                          <tr key={i} className="border-b border-white/10">
                            <td className="whitespace-nowrap py-2.5 font-medium text-white/90">{p.numero}/{p.totalParcelas}</td>
                            <td className="whitespace-nowrap py-2.5 text-white/70">{dataBR(p.vencimento)}</td>
                            <td className="whitespace-nowrap py-2.5 text-white/90">{brl(p.valorBrl)}</td>
                            <td className={`whitespace-nowrap py-2.5 ${p.recebidoBrl > 0 ? "text-[#4ade80]" : "text-white/70"}`}>{brl(p.recebidoBrl)}</td>
                            <td className="py-2.5"><span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${parcelaStatusCls(p.status)}`}>{parcelaStatusLabel(p.status)}</span></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Pagamentos */}
                <div>
                  <div className="mb-2 text-sm font-semibold text-white/85">Pagamentos <span className="text-white/40">({pagamentos.length})</span></div>
                  {pagamentos.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-white/10 bg-[#12161c] px-3 py-5 text-center text-xs text-white/40">Nenhum pagamento registrado.</div>
                  ) : (
                    <div className="space-y-2">
                      {pagamentos.map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-[#161b21] px-3 py-2.5">
                          <div className="min-w-0">
                            <div className="text-sm text-white/85">{fmt(p.valor, pd.moeda)}</div>
                            <div className="text-[11px] text-white/40">{dataBR(p.data)} · {p.formaLabel ?? "—"}</div>
                          </div>
                          <span className="inline-flex items-center gap-1.5 text-xs text-[#4ade80]"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{p.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Rodapé */}
          <div className="flex items-center justify-between gap-2 border-t border-white/10 px-5 py-4">
            <button onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 hover:border-white/25">Fechar</button>
            <button onClick={() => setPagOpen(true)} disabled={!pd} className="inline-flex items-center gap-2 rounded-lg bg-[#d2a948] px-4 py-2 text-sm font-semibold text-[#1b1508] hover:bg-[#e0b957] disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-4 w-4" /> Registrar pagamento</button>
          </div>
        </div>
      </div>

      {pagOpen && pd && (
        <RegistrarPagamentoModal
          obrigacaoId={pd.obrigacaoId ?? obrigacaoId}
          moeda={pd.moeda}
          saldo={pd.saldo}
          natureza="RECEITA"
          onClose={() => setPagOpen(false)}
          onDone={() => { setPagOpen(false); load(); onPagamentoRegistrado() }}
        />
      )}
    </>,
    document.body,
  )
}

// ── Modal de edição de metadados seguros (descrição + observações) ──
function EditarReceitaModal({ receitaId, descricaoInicial, observacaoInicial, onClose, onDone }: { receitaId: number; descricaoInicial: string; observacaoInicial: string; onClose: () => void; onDone: () => void }) {
  const [descricao, setDescricao] = useState(descricaoInicial)
  const [observacoes, setObservacoes] = useState(observacaoInicial)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    const orig = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape" && !salvando) onClose() }
    document.addEventListener("keydown", onEsc)
    return () => { document.body.style.overflow = orig; document.removeEventListener("keydown", onEsc) }
  }, [onClose, salvando])

  const salvar = async () => {
    if (!descricao.trim()) { setErro("A descrição é obrigatória."); return }
    setSalvando(true); setErro(null)
    try {
      const res = await fetch(`/api/financeiro/receitas/${receitaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ descricao: descricao.trim(), observacoes: observacoes.trim() || null }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(j?.error || `Falha ao salvar (HTTP ${res.status}).`); setSalvando(false); return }
      onDone()
    } catch { setErro("Falha de rede ao salvar."); setSalvando(false) }
  }

  const inp = "mt-1 w-full rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-[#7dd3fc]/50 focus:ring-1 focus:ring-[#7dd3fc]/25"
  const lbl = "block text-[11px] font-medium uppercase tracking-wider text-white/45"

  if (typeof document === "undefined") return null
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center bg-black/60 p-4" style={{ zIndex: LAYER.aboveProcess }} onClick={() => !salvando && onClose()}>
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#1b2027] shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h3 className="text-base font-semibold text-white">Editar receita</h3>
          <button onClick={() => !salvando && onClose()} className="text-white/40 hover:text-white/80"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 px-5 py-5">
          <div>
            <label className={lbl}>Descrição</label>
            <input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={300} className={inp} placeholder="Descrição da receita" />
          </div>
          <div>
            <label className={lbl}>Observações</label>
            <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={4} className={`${inp} resize-none`} placeholder="Observações internas (opcional)" />
          </div>
          <p className="text-xs text-white/40">Apenas metadados são editáveis. Valores, câmbio e parcelas são governados pelo Ledger e não mudam por aqui.</p>
          {erro && <div className="rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-3 py-2 text-sm text-[#f87171]">{erro}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button onClick={() => !salvando && onClose()} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 hover:border-white/25">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="inline-flex items-center gap-2 rounded-lg bg-[#d2a948] px-4 py-2 text-sm font-semibold text-[#1b1508] hover:bg-[#e0b957] disabled:opacity-60">{salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Salvar</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Info({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return <div><div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/40">{rotulo}</div><div className="text-sm">{children}</div></div>
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
