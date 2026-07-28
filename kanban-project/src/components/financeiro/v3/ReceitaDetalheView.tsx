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
import CancelamentoAvancadoModal from "@/src/components/financeiro/v3/CancelamentoAvancadoModal"
import DuplicarReceitaModal from "@/src/components/financeiro/v3/DuplicarReceitaModal"
import { CronogramaPagavelPanel } from "@/src/components/financeiro/v3/CronogramaPagavelPanel"
import { RepassePanel } from "@/src/components/financeiro/v3/RepassePanel"
import ExcluirReceitaModal from "@/src/components/financeiro/v3/ExcluirReceitaModal"
import ParticipanteContaView from "@/src/components/financeiro/v3/ParticipanteContaView"
import { vocabularioFinanceiro } from "@/lib/financeiro/vocabulario"
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
  Archive, RefreshCcw, Ban, ArrowLeftRight, Trash2,
} from "lucide-react"

const fmt = (v: number, m = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency: m }).format(v || 0)
import { textoBrlOuOrigem, TITULO_SEM_COTACAO } from "./ValorBrl"

const brl = (v: number) => fmt(v, "BRL")
// Apresentação de valor não convertido: helper compartilhado (ValorBrl).
const dataBR = (s?: string | null) => s ? new Date(s).toLocaleDateString("pt-BR") : "—"
const horaBR = (s?: string | null) => s ? new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""
const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }
const iniciais = (n?: string | null) => (n ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?"
const fmtTamanho = (b?: number | null) => { if (b == null) return null; if (b < 1024) return `${b} B`; if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`; return `${(b / (1024 * 1024)).toFixed(1)} MB` }

// tom do badge de status (amber A VENCER · red VENCIDO · blue PARCIAL · green QUITADO)
const statusTom = (s?: string | null) => {
  const S = (s ?? "").toUpperCase()
  if (S.includes("QUITAD")) return "var(--success)"
  if (S.includes("VENCID")) return "var(--danger)"
  if (S.includes("PARCIAL")) return "var(--info)"
  return "var(--accent-primary)"
}
// classe (texto) + estilo (fundo translúcido via color-mix) do badge de status
const statusCls = (s?: string | null) => `text-[${statusTom(s)}]`
const statusBg = (s?: string | null): React.CSSProperties => ({ background: `color-mix(in srgb, ${statusTom(s)} 15%, transparent)` })

// tom do badge de status da parcela (null = neutro/cancelada)
const parcelaTom = (s?: string | null) => {
  switch ((s ?? "").toUpperCase()) {
    case "PAGA": return "var(--success)"
    case "VENCIDA": return "var(--danger)"
    case "CANCELADA": return null
    default: return "var(--accent-primary)"
  }
}
const parcelaStatusCls = (s?: string | null) => { const t = parcelaTom(s); return t ? `text-[${t}]` : "text-[var(--text-muted)]" }
const parcelaStatusBg = (s?: string | null): React.CSSProperties => { const t = parcelaTom(s); return t ? { background: `color-mix(in srgb, ${t} 15%, transparent)` } : { background: "var(--surface-hover)" } }
const parcelaStatusLabel = (s?: string | null) => (s === "A_VENCER" ? "A VENCER" : (s ?? "—"))

export function ReceitaDetalheView({ refParam, onVoltar }: { refParam: string; onVoltar: () => void }) {
  const router = useRouter()
  const [d, setD] = useState<any>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tab, setTab] = useState("cobrancas")
  const [drawerPart, setDrawerPart] = useState<any>(null) // participante aberto no drawer (obrigacaoId + nome)
  const [receberOpen, setReceberOpen] = useState(false)
  const [receberEscopo, setReceberEscopo] = useState<EscopoEscolhido | null>(null)
  const [distribuicaoOpen, setDistribuicaoOpen] = useState(false)
  const [acaoModal, setAcaoModal] = useState<AcaoReceita | null>(null)
  const [cancelamentoOpen, setCancelamentoOpen] = useState(false)
  const [duplicarOpen, setDuplicarOpen] = useState(false)
  const [excluirOpen, setExcluirOpen] = useState(false)
  const [timelineGeral, setTimelineGeral] = useState<any[] | null>(null)
  const [editarReceitaOpen, setEditarReceitaOpen] = useState(false)
  const [faturaOpen, setFaturaOpen] = useState(false)
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

  // Timeline GERAL da Receita (só eventos de negócio; individuais vivem no ParticipanteContaView).
  // Carregada de forma preguiçosa ao abrir a aba Timeline.
  useEffect(() => {
    if (tab !== "timeline" || timelineGeral != null) return
    fetch(`/api/financeiro/v3/receita/${encodeURIComponent(refParam)}/timeline?escopo=geral`, { headers: authHeaders() })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (r.ok && j.disponivel && Array.isArray(j.eventos)) setTimelineGeral(j.eventos); else setTimelineGeral([]) })
      .catch(() => setTimelineGeral([]))
  }, [tab, timelineGeral, refParam])

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
      const res = await fetch(`/api/financeiro/v3/cobrancas/${alvo.id}/enviar`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() } })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) alert(j?.erro || `Falha ao enviar a cobrança (HTTP ${res.status}).`)
      else carregar()
    } catch { alert("Falha de rede ao enviar a cobrança.") }
  }

  // Anexar documento: upload ao R2 → vincula na Receita → refetch.
  const onSelecionarArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (e.target) e.target.value = "" // permite reanexar o mesmo arquivo
    if (!file) return
    setUploading(true)
    try {
      const [enviado] = await uploadFiles([file], { prefix: "financeiro/documentos" })
      if (!enviado) throw new Error("Falha no upload do arquivo.")
      const res = await fetch(`/api/financeiro/v3/obrigacoes/${d.obrigacaoId}/documentos`, {
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

  if (erro) return <div className="p-8 text-sm text-[var(--text-secondary)]">{erro}</div>
  if (!d) return <div className="p-8 text-sm text-[var(--text-muted)]">carregando…</div>

  const isCusto = d.natureza === "CUSTO"
  const voc = vocabularioFinanceiro(d.natureza)
  const semBase = d.moedaBase === "BRL"
  const fmtEUR = (v: number) => fmt(v, d.moedaBase)
  const moedaBaseLabel = d.moedaBase === "EUR" ? "Euro (EUR)" : d.moedaBase
  const pct = d.valorContratadoBrl ? Math.round((d.recebidoBrl / d.valorContratadoBrl) * 100) : 0
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
  const selCls = "rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-secondary)] outline-none"

  // ── Distribuição entre requerentes ──
  const dist: any[] = d.distribuicaoRequerentes ?? []
  const divisaoIgual = dist.length > 1 && new Set(dist.map((r) => Math.round(Number(r.percentual)))).size === 1
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
    if (sev === "crit") return "text-[var(--danger)]"
    if (sev === "warn") return "text-[var(--accent-primary)]"
    return "text-[var(--info)]"
  }

  // Contadores só quando > 0 (Resumo/Timeline/Observações não têm contador).
  const tabs: [string, string, any, number][] = [
    ["cobrancas", isCusto ? "Parcelas" : "Cobranças", CreditCard, rp.total],
    ...((isCusto ? [] : [["participantes", "Participantes Financeiros", Users, d.participantesCount ?? participantes.length]]) as [string, string, any, number][]),
    ["pagamentos", "Pagamentos", Wallet, (d.pagamentos ?? []).length],
    ["documentos", "Documentos", FileCheck, documentos.length],
    ...((isCusto ? [["repasses", "Repasses", ArrowLeftRight, (d.repasses ?? []).filter((r: { status: string }) => r.status !== "CANCELADO").length]] : []) as [string, string, any, number][]),
    ["timeline", "Timeline", Clock, 0],
    ["observacoes", "Observações", StickyNote, 0],
  ]

  return (
    <div className="text-[var(--text-secondary)]">
      <div className="mx-auto max-w-[1400px] px-1 py-1">
        {/* ── HEADER ── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <button onClick={onVoltar} className="mb-3 flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-secondary)]"><ArrowLeft className="h-4 w-4" /> Voltar para {isCusto ? "Custos" : "Receitas"}</button>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[28px] font-bold leading-tight text-[var(--text-primary)]">{d.descricao ?? d.codigo}</h1>
              <span className={`rounded-[var(--radius-sm)] px-2.5 py-1 text-xs font-semibold tracking-wide ${statusCls(d.statusLabel)}`} style={statusBg(d.statusLabel)}>{d.statusLabel}</span>
              {d.consolidado && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-hover)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]"><Users className="h-3.5 w-3.5" /> {d.participantesCount} participantes</span>
              )}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
              <span>🧾</span> Financeiro <span className="text-[var(--text-muted)]">›</span> {isCusto ? "Custos" : "Receitas"} <span className="text-[var(--text-muted)]">›</span>
              <span className="text-[var(--text-secondary)]">{d.codigo}</span>
            </div>
            {d.criadoPor === "Sistema" && (
              <div className="mt-1.5 text-[12px] text-[var(--text-muted)]">Receita gerada automaticamente pela regra financeira da fase.</div>
            )}
            <div className="mt-1 text-[12px] text-[var(--text-muted)]">{d.codigo} · {dataBR(d.criadoEm)} · Criado por {d.criadoPor}</div>
          </div>

          {/* Ações do topo */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditarReceitaOpen(true)}
              title="Editar receita (dados e regra de câmbio) — fluxo canônico"
              className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-primary)] px-3.5 py-2 text-sm font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
            ><Pencil className="h-4 w-4" /> Editar receita</button>

            <button onClick={() => setReceberOpen(true)} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-3.5 py-2 text-sm font-semibold text-[var(--accent-ink)] hover:bg-[var(--accent-hover)]"><Plus className="h-4 w-4" /> Registrar pagamento</button>

            <div className="relative">
              <button onClick={() => setMaisOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:border-[var(--border-strong)]">Mais ações <ChevronDown className="h-3.5 w-3.5" /></button>
              {maisOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMaisOpen(false)} />
                  <div className="absolute right-0 z-50 mt-1 w-60 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-popover)] py-1 shadow-[var(--shadow-surface)]">
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Gestão financeira</div>
                    <button onClick={() => { setMaisOpen(false); setEditarReceitaOpen(true) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><Pencil className="h-4 w-4 text-[var(--text-muted)]" /> Editar {isCusto ? "custo" : "Receita"}</button>
                    <button onClick={() => { setMaisOpen(false); setEditarReceitaOpen(true) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><ArrowLeftRight className="h-4 w-4 text-[var(--text-muted)]" /> Editar regra de câmbio</button>
                    {/* Fatura e recibo são do lado A_RECEBER (cobrança/comprovante ao cliente) — não se aplicam a custo. */}
                    {!isCusto && <button onClick={() => { setMaisOpen(false); temProcesso ? setFaturaOpen(true) : undefined }} disabled={!temProcesso} title={temProcesso ? "" : "Processo não vinculado"} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"><FileText className="h-4 w-4 text-[var(--text-muted)]" /> Gerar fatura</button>}
                    {!isCusto && <button onClick={() => { setMaisOpen(false); setAcaoModal("recibo") }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><FileCheck className="h-4 w-4 text-[var(--text-muted)]" /> Gerar recibo</button>}
                    <div className="my-1 border-t border-[var(--border-default)]" />
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Críticas</div>
                    {/* Renegociação atua sobre cobranças (A_RECEBER); custo não tem cobrança. */}
                    {!isCusto && <button onClick={() => { setMaisOpen(false); setAcaoModal("renegociar") }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><RefreshCcw className="h-4 w-4 text-[var(--info)]" /> Renegociar</button>}
                    <button onClick={() => { setMaisOpen(false); setTab("pagamentos") }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><RotateCcw className="h-4 w-4 text-[var(--danger)]" /> Estornar pagamento</button>
                    <div className="my-1 border-t border-[var(--border-default)]" />
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Encerramento</div>
                    <button onClick={() => { setMaisOpen(false); setDuplicarOpen(true) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><Copy className="h-4 w-4 text-[var(--text-muted)]" /> Duplicar {isCusto ? "custo" : "receita"}</button>
                    <button onClick={() => { setMaisOpen(false); setAcaoModal("arquivar") }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><Archive className="h-4 w-4 text-[var(--info)]" /> Arquivar {isCusto ? "custo" : "receita"}</button>
                    <button onClick={() => { setMaisOpen(false); setCancelamentoOpen(true) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--danger)] hover:bg-[var(--surface-hover)]"><Ban className="h-4 w-4" /> Cancelar {isCusto ? "custo" : "Receita"}</button>
                    <button onClick={() => { setMaisOpen(false); setExcluirOpen(true) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--danger)] hover:bg-[var(--surface-hover)]"><Trash2 className="h-4 w-4" /> Excluir {isCusto ? "custo" : "Receita"}</button>
                    <div className="my-1 border-t border-[var(--border-default)]" />
                    <button onClick={() => { setMaisOpen(false); setTab("timeline") }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><Clock className="h-4 w-4 text-[var(--text-muted)]" /> Ver movimentações</button>
                    <button onClick={() => { setMaisOpen(false); copiarCodigo() }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">{copiado ? <CheckCircle2 className="h-4 w-4 text-[var(--success)]" /> : <Copy className="h-4 w-4 text-[var(--text-muted)]" />} Copiar código</button>
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
            <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
                <Info rotulo={isCusto ? "Custo" : "Receita"}><span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-primary)]">{d.codigo}<button onClick={copiarCodigo} title="Copiar código" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]">{copiado ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" /> : <Copy className="h-3.5 w-3.5" />}</button></span></Info>
                <Info rotulo={`Moeda-base (Contrato)`}><span className="font-medium text-[var(--text-primary)]">{fmtEUR(d.valorBase)}</span><div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{moedaBaseLabel}</div></Info>
                <Info rotulo="Câmbio aplicado">
                  <span className="inline-flex items-center gap-2 font-medium text-[var(--text-primary)]">{d.cotacaoAplicada != null ? brl(d.cotacaoAplicada) : "—"}
                    {d.tipoCambio === "FIXO" && <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-[var(--success)]" style={{ background: "color-mix(in srgb, var(--success) 15%, transparent)" }}>Fixo</span>}
                  </span>
                  <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{d.tipoCambio === "FIXO" ? `Fixo desde ${dataBR(d.dataCotacao)}` : dataBR(d.dataCotacao)}</div>
                </Info>
                <Info rotulo="Valor contratado (BRL)"><span className={`font-semibold ${Number(d.naoConvertido ?? 0) > 0 ? "text-[var(--warning)]" : "text-[var(--text-primary)]"}`} title={Number(d.naoConvertido ?? 0) > 0 ? TITULO_SEM_COTACAO : undefined}>{textoBrlOuOrigem(d.valorContratadoBrl, d.naoConvertido, d.moedaBase)}</span></Info>
              </div>

              {verMais && (
                <>
                  <div className="my-4 border-t border-[var(--border-default)]" />
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
                    <Info rotulo="Status">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${statusCls(d.statusLabel)}`} style={statusBg(d.statusLabel)}>{d.statusLabel}</span>
                      {d.proximoVencimento && <div className="mt-1 text-[11px] text-[var(--text-muted)]">Próxima parcela em {dataBR(d.proximoVencimento)}</div>}
                    </Info>
                    <Info rotulo="Descrição"><span className="text-[var(--text-secondary)]">{d.descricao ?? "—"}</span></Info>
                    <Info rotulo="Forma de cobrança"><span className="text-[var(--text-secondary)]">{d.formaCobranca ?? "—"}</span></Info>
                    <Info rotulo="Responsável">{d.responsavel ? <span className="inline-flex items-center gap-2 text-[var(--text-secondary)]">{d.responsavel.nome}<span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">Principal</span></span> : "—"}</Info>
                    <Info rotulo="Criado em"><span className="text-[var(--text-secondary)]">{dataBR(d.criadoEm)} às {horaBR(d.criadoEm)}</span><div className="mt-0.5 text-[11px] text-[var(--text-muted)]">por {d.criadoPor}</div></Info>
                    <Info rotulo="Vencimento final"><span className="text-[var(--text-secondary)]">{dataBR(d.vencimento)}</span></Info>
                    <Info rotulo="Processo">
                      <div className="text-[var(--text-secondary)]">{d.processo.codigo ?? "—"}{d.processo.nome ? ` – ${d.processo.nome}` : ""}</div>
                      {temProcesso && <a href={`/financeiro/v3/processo-preview?processoId=${d.processo.id}`} className="inline-flex items-center gap-1 text-xs text-[var(--info)] hover:underline">Abrir processo <ExternalLink className="h-3 w-3" /></a>}
                    </Info>
                    <Info rotulo="Câmbio">
                      <button onClick={() => router.push("/cambio")} className="inline-flex items-center gap-1 text-sm text-[var(--info)] hover:underline">Entenda o câmbio aplicado <ExternalLink className="h-3.5 w-3.5" /></button>
                    </Info>
                  </div>
                </>
              )}

              <button onClick={() => setVerMais((v) => !v)} className="mt-4 inline-flex items-center gap-1.5 text-sm text-[var(--info)] hover:underline">
                {verMais ? "Ocultar detalhes da receita" : "Ver mais detalhes da receita"} {verMais ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>

            {/* SITUAÇÃO FINANCEIRA */}
            <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Situação financeira</h2>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <SubCard rotulo="Valor contratado" valor={textoBrlOuOrigem(d.valorContratadoBrl, d.naoConvertido, d.moedaBase)} linhas={!semBase ? [`Base contratual: ${fmtEUR(d.valorBase)}`] : []} />
                <SubCard rotulo={isCusto ? "Pago" : "Recebido"} valor={brl(d.recebidoBrl)} cor="text-[var(--success)]" linhas={[`${pct}% do total`, `${d.parcelasRecebidas} parcela(s) recebida(s)`]} />
                <SubCard rotulo="A vencer" valor={brl(d.aVencerBrl)} cor="text-[var(--accent-primary)]" linhas={[`${d.parcelasAVencer} parcela(s)`, `Próximo: ${dataBR(d.proximoVencimento)}`]} />
                <SubCard rotulo="Vencido" valor={brl(d.vencidoBrl)} cor="text-[var(--danger)]" linhas={[`${d.parcelasVencidas} parcela(s)`, ...(d.parcelasVencidas ? [`Desde ${dataBR(d.proximoVencimento)}`] : [])]} />
                <SubCard rotulo={voc.saldo} valor={brl(d.saldoBrl)} cor="text-[var(--info)]" linhas={[`${d.parcelas} parcela(s) em aberto`]} />
              </div>
            </div>

          </div>

          
        </div>

        {/* ── ABAS ── */}
        <div className="mt-6 flex items-center gap-7 overflow-x-auto border-b border-[var(--border-default)]">
          {tabs.map(([id, label, Icon, badge]) => (
            <button key={id} onClick={() => setTab(id)} className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-1 pb-3 pt-2 text-sm ${tab === id ? "border-[var(--accent-primary)] font-medium text-[var(--accent-primary)]" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-secondary)]"}`}>
              <Icon className="h-4 w-4" /> {label}{badge ? <span className="ml-1 rounded-full bg-[var(--surface-hover)] px-1.5 text-[11px] text-[var(--text-secondary)]">{badge}</span> : null}
            </button>
          ))}
        </div>

        {/* ── CONTEÚDO DAS ABAS ── */}
        <div className="mt-5">
          {/* Participantes Financeiros */}
          {tab === "participantes" && (
            <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]"><span>👥</span> Participantes Financeiros</h2>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">Distribuição desta Receita entre os responsáveis pelo pagamento.</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => setDistribuicaoOpen(true)} title="Editar como o total é dividido entre os participantes" className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)]"><Pencil className="h-4 w-4" /> Editar distribuição</button>
                  <button onClick={exportarParticipantesCsv} title="Exportar participantes em CSV" className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)]"><Download className="h-4 w-4" /> Exportar</button>
                </div>
              </div>

              {participantes.length === 0 ? (
                <div className="mt-6 rounded-[var(--radius-sm)] border border-dashed border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">Sem participantes na distribuição desta receita.</div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-[var(--border-default)] text-left text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
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
                        <tr key={p.obrigacaoId ?? i} className="border-b border-[var(--border-default)] align-top">
                          <td className="py-3.5">
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-hover)] text-[11px] font-semibold text-[var(--text-secondary)]">{iniciais(p.nome)}</span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-sm font-medium text-[var(--text-primary)]">{p.nome}</span>
                                  <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">{papelLabel(p.papel)}</span>
                                </div>
                                <div className="text-[11px] text-[var(--text-muted)]">Requerente</div>
                              </div>
                            </div>
                          </td>
                          <td className="whitespace-nowrap py-3.5">
                            <div className="font-medium text-[var(--text-primary)]">{fmt(p.valorBase, p.moedaBase)}</div>
                            <div className="mt-0.5 text-xs text-[var(--text-muted)]">{Number(p.participacaoPct).toFixed(2)}%</div>
                          </td>
                          <td className="whitespace-nowrap py-3.5 font-medium text-[var(--text-primary)]">{brl(p.valorContratadoBrl)}</td>
                          <td className="whitespace-nowrap py-3.5">
                            <div className={p.recebidoBrl > 0 ? "font-medium text-[var(--success)]" : "text-[var(--text-secondary)]"}>{brl(p.recebidoBrl)}</div>
                            <div className="mt-0.5 text-xs text-[var(--text-muted)]">{p.parcelasRecebidas} parcela(s)</div>
                          </td>
                          <td className="whitespace-nowrap py-3.5">
                            <div className="font-medium text-[var(--info)]">{brl(p.saldoBrl)}</div>
                            <div className="mt-0.5 text-xs text-[var(--text-muted)]">{p.parcelas} parcela(s)</div>
                          </td>
                          <td className="whitespace-nowrap py-3.5 text-[var(--text-secondary)]">{dataBR(p.proximoVencimento)}</td>
                          <td className="py-3.5"><span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${statusCls(p.status)}`} style={statusBg(p.status)}>{p.status}</span></td>
                          <td className="py-3.5">
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => setDrawerPart({ obrigacaoId: p.obrigacaoId, nome: p.nome })} className="whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-primary)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)]">Abrir</button>
                              <button onClick={() => setDrawerPart({ obrigacaoId: p.obrigacaoId, nome: p.nome })} title="Abrir participante" className="rounded-[var(--radius-sm)] border border-[var(--border-default)] p-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><MoreVertical className="h-4 w-4" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {/* Totalização — valida que a distribuição fecha em 100% e bate com o consolidado */}
                      <tr className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-secondary)]">
                        <td className="py-3.5">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--success)]" style={{ background: "color-mix(in srgb, var(--success) 15%, transparent)" }}><CheckCircle2 className="h-4 w-4" /></span>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-[var(--text-primary)]">Total da distribuição</div>
                              <div className="text-[11px] text-[var(--text-muted)]">100,00%</div>
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap py-3.5 font-semibold text-[var(--text-primary)]">{fmt(somaBase, d.moedaBase)}</td>
                        <td className="whitespace-nowrap py-3.5 font-semibold text-[var(--text-primary)]">{brl(somaContratado)}</td>
                        <td className="whitespace-nowrap py-3.5">
                          <div className="font-semibold text-[var(--success)]">{brl(somaRecebido)}</div>
                          <div className="mt-0.5 text-xs text-[var(--text-muted)]">{somaRecParcelas} parcela(s)</div>
                        </td>
                        <td className="whitespace-nowrap py-3.5">
                          <div className="font-semibold text-[var(--info)]">{brl(somaSaldo)}</div>
                          <div className="mt-0.5 text-xs text-[var(--text-muted)]">{somaParcelas} parcela(s)</div>
                        </td>
                        <td className="py-3.5 text-[var(--text-muted)]">—</td>
                        <td className="py-3.5 text-[var(--text-muted)]">—</td>
                        <td className="py-3.5 text-[var(--text-muted)]">—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Pagamentos */}
          {tab === "pagamentos" && (
          <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-[var(--text-primary)]">Pagamentos</h2><span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">{d.pagamentos.length}</span></div>
              <button onClick={() => setReceberOpen(true)} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-3.5 py-2 text-sm font-semibold text-[var(--accent-ink)] hover:bg-[var(--accent-hover)]"><Plus className="h-4 w-4" /> Registrar pagamento</button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="relative min-w-[180px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pagamentos..." className="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-[var(--text-muted)]" /></div>
              <button disabled title="Filtro avançado de pagamentos indisponível — use a busca acima" className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-40"><SlidersHorizontal className="h-4 w-4" /> Filtros</button>
              <button disabled title="Filtro por período indisponível — use a busca acima" className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-40"><Calendar className="h-4 w-4" /> Período <ChevronDown className="h-3.5 w-3.5" /></button>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border-default)] text-left text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="pb-2 font-medium">Data</th><th className="pb-2 font-medium">Valor</th><th className="pb-2 font-medium">Forma</th><th className="pb-2 font-medium">Conta recebida</th><th className="pb-2 font-medium">Referência</th><th className="pb-2 font-medium">Status</th><th className="pb-2 font-medium">Ações</th>
                </tr></thead>
                <tbody>{pagamentosFiltrados.map((p: any) => (
                  <tr key={p.id} className="border-b border-[var(--border-default)]">
                    <td className="py-3.5 text-[var(--text-secondary)]">{dataBR(p.data)}</td>
                    <td className="font-medium text-[var(--text-primary)]">{fmt(p.valor, d.moeda)}</td>
                    <td><span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]"><span className="flex h-5 w-5 items-center justify-center rounded bg-[var(--surface-hover)] text-[10px]">{(p.formaLabel ?? "?").slice(0, 1)}</span>{p.formaLabel ?? "—"}</span></td>
                    <td><div className="text-[var(--text-secondary)]">{p.banco ?? "—"}</div>{(p.agencia || p.conta) && <div className="text-xs text-[var(--text-muted)]">Ag: {p.agencia ?? "—"} Cc: {p.conta ?? "—"}</div>}</td>
                    <td className="text-[var(--text-secondary)]">{p.referencia ?? "—"}</td>
                    <td><span className="inline-flex items-center gap-1.5 text-[var(--success)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />{p.status}</span></td>
                    <td><PagamentoRowMenu p={p} onEstornar={() => setEstornoAlvo(p)} onTimeline={() => setTab("timeline")} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-[var(--text-muted)]">
              <span>Mostrando {pagamentosFiltrados.length} de {d.pagamentos.length} pagamentos</span>
              <div className="flex items-center gap-1"><button disabled title="Página única" className="rounded border border-[var(--border-default)] p-1.5 text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><span className="rounded border border-[var(--border-strong)] bg-[var(--surface-active)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">1</span><button disabled title="Página única" className="rounded border border-[var(--border-default)] p-1.5 text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div>
            </div>
          </div>
          )}

          {/* F5 — Cronograma de pagáveis (custo): aba "Parcelas" */}
          {tab === "cobrancas" && isCusto && (
            <CronogramaPagavelPanel obrigacaoId={d.obrigacaoId} parcelas={d.cronogramaPagavel ?? []} valorContratado={d.valorContratado} moeda={d.moeda} onChange={() => carregar()} />
          )}

          {/* F5 — Repasses/reembolsos (custo) */}
          {tab === "repasses" && isCusto && (
            <RepassePanel obrigacaoId={d.obrigacaoId} repasses={d.repasses ?? []} onChange={() => carregar()} />
          )}

          {/* Cobranças (parcelas) — receita */}
          {tab === "cobrancas" && !isCusto && (
            <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
              <div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-[var(--text-primary)]">{isCusto ? "Parcelas" : "Cobranças"}</h2><span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">{rp.total}</span></div>

              {/* KPIs */}
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <SubCard rotulo="Total das cobranças" valor={brl(d.valorContratadoBrl)} linhas={[`${rp.total} parcelas`]} />
                <SubCard rotulo={isCusto ? "Pago" : "Recebido"} valor={brl(d.resumo.recebidoBrl)} cor="text-[var(--success)]" linhas={[`${rp.pagas.qtd} parcelas pagas`]} />
                <SubCard rotulo="A vencer" valor={brl(d.aVencerBrl)} cor="text-[var(--accent-primary)]" linhas={[`${rp.aVencer.qtd} parcelas`]} />
                <SubCard rotulo="Vencido" valor={brl(d.vencidoBrl)} cor="text-[var(--danger)]" linhas={[`${rp.vencidas.qtd} parcela(s)`]} />
                <SubCard rotulo="Inadimplência" valor={`${d.inadimplenciaPct ?? 0}%`} cor="text-[var(--danger)]" linhas={[`${rp.vencidas.qtd} parcela vencida`]} />
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
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input value={pBusca} onChange={(e) => { setPBusca(e.target.value); setPPage(1) }} placeholder="Buscar parcela..." className="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-[var(--text-muted)]" />
                </div>
                <button onClick={limparFiltros} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:border-[var(--border-strong)]">Limpar filtros</button>
              </div>

              {/* Tabela de parcelas */}
              {parcelas.length === 0 ? (
                <div className="mt-6 rounded-[var(--radius-sm)] border border-dashed border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">Nenhuma cobrança/parcela para esta receita.</div>
              ) : (
                <>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-[var(--border-default)] text-left text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
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
                        <tr key={i} className="border-b border-[var(--border-default)] align-top">
                          <td className="whitespace-nowrap py-3.5 font-medium text-[var(--text-primary)]">{p.numero}/{p.totalParcelas}</td>
                          <td className="py-3.5">
                            <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">{p.responsavel}
                              {d.responsavel?.nome && p.responsavel === d.responsavel.nome && <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">Principal</span>}
                            </span>
                          </td>
                          <td className="whitespace-nowrap py-3.5 text-[var(--text-secondary)]">{dataBR(p.vencimento)}
                            {p.status === "VENCIDA" ? <div className="text-xs text-[var(--danger)]">{p.diasAtraso} dias de atraso</div> : ehHoje(p.vencimento) ? <div className="text-xs text-[var(--accent-primary)]">Hoje</div> : null}
                          </td>
                          <td className="whitespace-nowrap py-3.5 font-medium text-[var(--text-primary)]">{brl(p.valorBrl)}</td>
                          <td className="whitespace-nowrap py-3.5">
                            <div className="text-[var(--text-secondary)]">{fmtEUR(p.valorBase)}</div>
                            <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">Câmbio: {p.cotacao != null ? brl(p.cotacao) : "—"}
                              {p.tipoCambio === "FIXO" && <span className="rounded px-1 py-0.5 text-[9px] font-semibold text-[var(--success)]" style={{ background: "color-mix(in srgb, var(--success) 15%, transparent)" }}>Fixo</span>}
                              {p.tipoCambio === "NAO_DEFINIDO" && <span className="rounded bg-[var(--surface-hover)] px-1 py-0.5 text-[9px] font-semibold text-[var(--text-muted)]">—</span>}
                            </div>
                          </td>
                          <td className={`whitespace-nowrap py-3.5 ${p.recebidoBrl > 0 ? "font-medium text-[var(--success)]" : "text-[var(--text-secondary)]"}`}>{brl(p.recebidoBrl)}</td>
                          <td className="whitespace-nowrap py-3.5 font-medium text-[var(--info)]">{brl(p.saldoBrl)}</td>
                          <td className="py-3.5"><span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${parcelaStatusCls(p.status)}`} style={parcelaStatusBg(p.status)}>{parcelaStatusLabel(p.status)}</span></td>
                          <td className="whitespace-nowrap py-3.5 text-[var(--text-secondary)]">{p.forma ?? "—"}</td>
                          <td className="py-3.5">
                            {p.status === "PAGA" ? (
                              <button onClick={() => setTab("pagamentos")} className="whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-primary)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--border-strong)]">Ver recebimento</button>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <button onClick={() => setReceberOpen(true)} className="whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-2.5 py-1.5 text-xs font-semibold text-[var(--accent-ink)] hover:bg-[var(--accent-hover)]">Registrar pagamento</button>
                                <button onClick={() => setReceberOpen(true)} title="Registrar pagamento" className="rounded-[var(--radius-sm)] border border-[var(--border-default)] p-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><MoreVertical className="h-4 w-4" /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-sm text-[var(--text-muted)]">
                    <span>Mostrando {parcDe}–{parcAte} de {parcelasFiltradas.length} parcelas</span>
                    <div className="flex items-center gap-1">
                      <button disabled={paginaAtual <= 1} onClick={() => setPPage((p) => Math.max(1, p - 1))} className="rounded border border-[var(--border-default)] p-1.5 text-[var(--text-muted)] disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                      <span className="rounded border border-[var(--border-strong)] bg-[var(--surface-active)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">{paginaAtual}</span>
                      <button disabled={paginaAtual >= totalPaginas} onClick={() => setPPage((p) => Math.min(totalPaginas, p + 1))} className="rounded border border-[var(--border-default)] p-1.5 text-[var(--text-muted)] disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Documentos */}
          {tab === "documentos" && (
            <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-[var(--text-primary)]">Documentos</h2><span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">{documentos.length}</span></div>
                <input ref={fileInputRef} type="file" className="hidden" onChange={onSelecionarArquivo} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title="Anexar documento"
                  className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-3.5 py-2 text-sm font-semibold text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {uploading ? "Enviando…" : "Anexar documento"}</button>
              </div>
              {documentos.length === 0 ? (
                <div className="mt-6 rounded-[var(--radius-sm)] border border-dashed border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">Nenhum documento vinculado a {isCusto ? "este custo" : "esta receita"}.</div>
              ) : (
                <div className="mt-4 space-y-2">
                  {documentos.map((doc: any) => (
                    <div key={doc.id} className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface-hover)] text-[var(--text-secondary)]"><FileIcon className="h-4.5 w-4.5" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[var(--text-primary)]">{doc.nome}</div>
                        <div className="mt-0.5 text-xs text-[var(--text-muted)]">{[doc.tipo, fmtTamanho(doc.tamanho), `Anexado em ${dataBR(doc.criadoEm)}`].filter(Boolean).join(" · ")}</div>
                      </div>
                      <a href={doc.url} target="_blank" rel="noreferrer" download className="inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)]"><Download className="h-4 w-4" /> Baixar</a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Timeline GERAL da Receita (escopo=geral) — eventos de negócio da Receita
              consolidada (criação/edição/redistribuição/cancelamento/arquivamento).
              Eventos individuais de pagamento vivem no ParticipanteContaView. */}
          {tab === "timeline" && (
          <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Histórico de movimentações</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Timeline geral desta Receita. A timeline individual de cada participante está na conta do participante.</p>
            {timelineGeral == null ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> carregando…</div>
            ) : timelineGeral.length === 0 ? (
              <div className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">Sem eventos de negócio registrados nesta Receita.</div>
            ) : (
            <div className="mt-4">{timelineGeral.map((h: any, i: number) => {
              const Icon = h.tipo === "OBRIGACAO_CRIADA" ? UserPlus : (String(h.tipo).startsWith("PAGAMENTO") ? ArrowDownCircle : Receipt)
              const cor = String(h.tipo).startsWith("PAGAMENTO") ? "text-[var(--success)]" : "text-[var(--text-secondary)]"
              const ultimo = i === timelineGeral.length - 1
              return (
                <div key={h.id ?? i} className="flex gap-4">
                  <div className="w-16 shrink-0 pt-0.5 text-right text-[11px] leading-tight text-[var(--text-muted)]">{dataBR(h.data)}<br />{horaBR(h.data)}</div>
                  <div className="flex flex-col items-center"><div className={`flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-hover)] ${cor}`}><Icon className="h-4 w-4" /></div>{!ultimo && <div className="w-px flex-1 bg-[var(--border-default)]" />}</div>
                  <div className={`flex-1 ${ultimo ? "" : "pb-6"}`}>
                    <div className="flex items-start justify-between gap-2"><div className="font-medium text-[var(--text-primary)]">{h.titulo}</div>{h.ator && <span className="shrink-0 text-xs text-[var(--info)]">{h.ator}</span>}</div>
                    <div className="mt-0.5 text-sm text-[var(--text-secondary)]">{h.descricao}</div>
                  </div>
                </div>
              )
            })}</div>
            )}
          </div>
          )}

          {/* Observações */}
          {tab === "observacoes" && (
            <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
              <div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-[var(--text-primary)]">Observações</h2></div>
              <div className="mt-4 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-4">
                <div className="whitespace-pre-wrap text-sm text-[var(--text-secondary)]">{d.observacao ?? "—"}</div>
              </div>
              <div className="mt-2 text-xs text-[var(--text-muted)]">Notas internas</div>
            </div>
          )}
        </div>
      </div>

      {/* ── CONTA INDIVIDUAL DO PARTICIPANTE (visão completa: resumo/parcelas/cobranças/
           pagamentos/timeline individual/documentos/observações/histórico + ações) ── */}
      {drawerPart && (
        <ParticipanteContaView
          obrigacaoId={drawerPart.obrigacaoId}
          nome={drawerPart.nome}
          onClose={() => setDrawerPart(null)}
          onRecarregar={carregar}
        />
      )}

      {/* ── MODAIS ── */}
      {/* Etapa 3: pagamento parametrizado por DIREÇÃO. A_PAGAR (custo) = obrigação única
          via RegistrarPagamentoModal (sem escopo/participantes). A_RECEBER (receita) = fluxo
          por escopo (DefinirEscopoDrawer → RegistrarPagamentoView). */}
      {receberOpen && d && (isCusto ? (
        <RegistrarPagamentoModal
          obrigacaoId={d.obrigacaoId}
          moeda={d.moeda ?? "BRL"}
          saldo={d.saldoBrl}
          natureza="CUSTO"
          onClose={() => setReceberOpen(false)}
          onDone={() => { setReceberOpen(false); carregar() }}
        />
      ) : (
        <DefinirEscopoDrawer
          receitaRef={String(d.obrigacaoId)}
          onClose={() => setReceberOpen(false)}
          onEscolher={(e) => { setReceberEscopo(e); setReceberOpen(false) }}
        />
      ))}
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
          natureza={isCusto ? "CUSTO" : "RECEITA"}
          onClose={() => setAcaoModal(null)}
          onDone={() => { setAcaoModal(null); carregar() }}
        />
      )}
      {cancelamentoOpen && d && (
        <CancelamentoAvancadoModal
          receitaRef={String(d.obrigacaoId)}
          natureza={isCusto ? "CUSTO" : "RECEITA"}
          participantes={(d.participantes ?? []).map((p: any) => ({ obrigacaoId: p.obrigacaoId, nome: p.nome }))}
          onClose={() => setCancelamentoOpen(false)}
          onDone={() => { setCancelamentoOpen(false); carregar() }}
        />
      )}
      {duplicarOpen && d && (
        <DuplicarReceitaModal
          receitaRef={String(d.obrigacaoId)}
          natureza={isCusto ? "CUSTO" : "RECEITA"}
          onClose={() => setDuplicarOpen(false)}
          onDone={(obrigacaoIdNovo) => { setDuplicarOpen(false); router.push(`/financeiro/v3/receita/${obrigacaoIdNovo}`) }}
        />
      )}
      {excluirOpen && d && (
        <ExcluirReceitaModal
          receitaRef={String(d.obrigacaoId)}
          natureza={isCusto ? "CUSTO" : "RECEITA"}
          onClose={() => setExcluirOpen(false)}
          onDone={() => { setExcluirOpen(false); onVoltar() }}
        />
      )}
      {editarReceitaOpen && d && (
        <EditarReceitaView
          obrigacaoId={d.obrigacaoId}
          receitaRef={String(d.obrigacaoId)}
          natureza={isCusto ? "CUSTO" : "RECEITA"}
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
      <button onClick={() => setOpen(o => !o)} title="Ações do pagamento" className="rounded-[var(--radius-sm)] border border-[var(--border-default)] p-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><MoreVertical className="h-4 w-4" /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-50 w-52 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-popover)] py-1 shadow-[var(--shadow-surface)]">
            <button onClick={() => { setOpen(false); onTimeline() }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><Clock className="h-4 w-4 text-[var(--text-muted)]" /> Ver movimentações</button>
            <button onClick={() => { setOpen(false); copiar() }} disabled={!ref} title={ref ? "" : "Sem referência"} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-40">{copiado ? <CheckCircle2 className="h-4 w-4 text-[var(--success)]" /> : <Copy className="h-4 w-4 text-[var(--text-muted)]" />} Copiar referência</button>
            <div className="my-1 border-t border-[var(--border-default)]" />
            <button onClick={() => { setOpen(false); onEstornar() }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--danger)] hover:bg-[var(--surface-hover)]"><RotateCcw className="h-4 w-4" /> Estornar (total ou parcial)</button>
          </div>
        </>
      )}
    </div>
  )
}


function Info({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return <div><div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">{rotulo}</div><div className="text-sm">{children}</div></div>
}
function SubCard({ rotulo, valor, cor, linhas }: { rotulo: string; valor: string; cor?: string; linhas?: string[] }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4">
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">{rotulo}</div>
      <div className={`mt-1.5 text-xl font-semibold ${cor ?? "text-[var(--text-primary)]"}`}>{valor}</div>
      {linhas?.map((l, i) => <div key={i} className="mt-1 text-xs text-[var(--text-muted)]">{l}</div>)}
    </div>
  )
}
