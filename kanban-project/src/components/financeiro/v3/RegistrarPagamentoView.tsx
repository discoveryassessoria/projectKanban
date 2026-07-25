// src/components/financeiro/v3/RegistrarPagamentoView.tsx
// ============================================================================
// REGISTRAR PAGAMENTO (Financeiro V3) — assistente de recebimento rico.
// Overlay full-screen aberto a partir de Receita → Cobranças → "Registrar
// pagamento". Múltiplas formas por baixa, pagador (interno/externo), ajustes,
// aplicação, tratamento de parcial/excedente, comprovantes. Só orquestra o motor
// V3 via /registrar-pagamento (não reimplementa nada). Discovery Design System.
// ============================================================================
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Plus, Trash2, Upload, Loader2, Info as InfoIcon, AlertTriangle, CheckCircle2,
  Landmark, CreditCard, Users, FileText, Eye, Building2, User as UserIcon, UsersRound,
} from "lucide-react"
import { uploadFiles } from "@/src/lib/storage"
import { calcularTaxas, type TaxaView } from "@/lib/financeiro/taxas-pagamento"
import { calcularRecebimento } from "@/lib/financeiro/dominio/calculo-recebimento"

const fmt = (v: number, m = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency: m }).format(v || 0)
const brl = (v: number) => fmt(v || 0, "BRL")
const eur = (v: number) => fmt(v || 0, "EUR")
const dataBR = (s?: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—")
const iniciais = (n?: string | null) => (n ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?"
const fmtTamanho = (b?: number | null) => { if (b == null) return ""; if (b < 1024) return `${b} B`; if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`; return `${(b / 1048576).toFixed(1)} MB` }
const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }
const hoje = () => new Date().toISOString().slice(0, 10)
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : Number(v) || 0 }

let _rid = 0
const novaLinha = () => ({ _id: ++_rid, formaPagamentoId: "" as number | "", valor: "" as string, contaKey: "" as string, dataRec: hoje(), dataComp: "", referencia: "", adquirenteId: "" as number | "", bandeiraId: "" as number | "", parcelas: 1 })

const statusCls = (s?: string | null) => {
  const S = (s ?? "").toUpperCase()
  if (S.includes("QUITAD")) return "bg-[#4ade80]/15 text-[#4ade80]"
  if (S.includes("VENCID")) return "bg-[#f87171]/15 text-[#f87171]"
  if (S.includes("PARCIAL")) return "bg-[#7dd3fc]/15 text-[#7dd3fc]"
  if (S.includes("EXCED")) return "bg-[#a78bfa]/15 text-[#a78bfa]"
  return "bg-[#d2a948]/15 text-[#d2a948]"
}

const inputCls = "w-full rounded-lg border border-white/10 bg-[#20262e] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#2563eb]/60"
const labelCls = "text-[11px] font-medium uppercase tracking-wide text-white/50"

type Linha = ReturnType<typeof novaLinha>

export default function RegistrarPagamentoView({ obrigacaoId, receitaRef, escopo, onTrocarEscopo, onClose, onDone }: {
  obrigacaoId: number; receitaRef: string
  escopo?: { tipo: string; tag: string; obrigacaoId: number; saldoBrl: number; participanteNome?: string } | null
  onTrocarEscopo?: () => void
  onClose: () => void; onDone?: () => void
}) {
  const [det, setDet] = useState<any>(null)
  const [participantes, setParticipantes] = useState<any[]>([])
  const [formasCad, setFormasCad] = useState<any[]>([])
  const [contasOpts, setContasOpts] = useState<any[]>([])
  const [creditoDisponivel, setCreditoDisponivel] = useState(0)
  const [adquirentes, setAdquirentes] = useState<any[]>([])
  const [bandeiras, setBandeiras] = useState<any[]>([])
  const [taxas, setTaxas] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // form state
  const [linhas, setLinhas] = useState<Linha[]>([novaLinha()])
  const [pagadorTipo, setPagadorTipo] = useState<"REQUERENTE" | "EMPRESA" | "TERCEIRO" | "EXTERNO">("REQUERENTE")
  const [pagadorPessoaId, setPagadorPessoaId] = useState<number | "">("")
  const [vinculo, setVinculo] = useState("Requerente")
  const [ext, setExt] = useState({ nome: "", documento: "", telefone: "", observacao: "" })
  const [ajustes, setAjustes] = useState({ desconto: "", juros: "", multa: "", acrescimo: "", creditoUtilizado: "" })
  const [politica, setPolitica] = useState<"NESTA" | "PROXIMAS" | "MAIS_ANTIGA" | "AUTOMATICA" | "MANUAL">("NESTA")
  const [alocManual, setAlocManual] = useState<Record<number, string>>({})
  const [alocGeralModo, setAlocGeralModo] = useState<"AUTOMATICA" | "MANUAL">("AUTOMATICA")
  const [alocGeralManual, setAlocGeralManual] = useState<Record<number, string>>({})
  const [parcialTrat, setParcialTrat] = useState<"MANTER" | "GERAR_COBRANCA" | "RENEGOCIAR">("MANTER")
  const [excedenteTrat, setExcedenteTrat] = useState<"CREDITO" | "ABATER_PROXIMAS" | "ADIANTAMENTO" | "DEVOLVER">("CREDITO")
  const [comprovantes, setComprovantes] = useState<{ arquivoUrl: string; arquivoNome: string; tamanho: number }[]>([])
  const [subindo, setSubindo] = useState(false)
  const [observacao, setObservacao] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erroSubmit, setErroSubmit] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── carregar dados ────────────────────────────────────────────────────────
  useEffect(() => {
    let vivo = true
    const orig = document.body.style.overflow; document.body.style.overflow = "hidden"
    ;(async () => {
      try {
        const [rDet, rCons, rCad] = await Promise.all([
          fetch(`/api/financeiro/v3/receita/${receitaRef}?obrigacao=${obrigacaoId}`, { headers: authHeaders() }).then((r) => r.json()).catch(() => null),
          fetch(`/api/financeiro/v3/receita/${receitaRef}`, { headers: authHeaders() }).then((r) => r.json()).catch(() => null),
          fetch(`/api/financeiro/cadastros-pagamento`, { headers: authHeaders() }).then((r) => r.json()).catch(() => null),
        ])
        if (!vivo) return
        const d = rDet?.receita ?? null
        setDet(d)
        const parts = rCons?.receita?.participantes ?? (d ? [{ obrigacaoId: d.obrigacaoId, pessoaId: d.responsavelFinanceiro?.requerenteId ?? null, nome: d.responsavel?.nome ?? "Participante", papel: d.responsavel?.papel ?? "" }] : [])
        setParticipantes(parts)
        // NUNCA pré-selecionar um participante como pagador (regra: pagador ≠ responsável da cobrança).
        setFormasCad(rCad?.formasPagamento ?? [])
        const contas = (rCad?.contas ?? []).map((c: any) => ({ key: `c:${c.id}`, id: c.id, tipo: "conta", label: c.nome, sub: [c.banco, [c.agencia, c.conta].filter(Boolean).join("/")].filter(Boolean).join(" · "), banco: c.banco ?? c.nome, agencia: c.agencia ?? null, numero: c.conta ?? null }))
        const cart = (rCad?.carteiras ?? []).map((c: any) => ({ key: `w:${c.id}`, id: c.id, tipo: "carteira", label: c.nome, sub: "Carteira", banco: c.nome, agencia: null, numero: null }))
        setContasOpts([...contas, ...cart])
        setAdquirentes(rCad?.adquirentes ?? [])
        setBandeiras(rCad?.bandeiras ?? [])
        setTaxas(rCad?.taxas ?? [])
        // crédito financeiro disponível (obrigação/pessoa) — limita "Crédito Utilizado"
        fetch(`/api/financeiro/creditos?obrigacaoId=${obrigacaoId}`, { headers: authHeaders() }).then((x) => x.json()).then((rc) => { if (vivo && rc?.saldoDisponivel != null) setCreditoDisponivel(Number(rc.saldoDisponivel)) }).catch(() => {})
        if (!d) setErro("Não foi possível carregar a cobrança.")
      } catch { if (vivo) setErro("Falha ao carregar.") } finally { if (vivo) setLoading(false) }
    })()
    return () => { vivo = false; document.body.style.overflow = orig }
  }, [receitaRef, obrigacaoId])

  // ── cálculos live ─────────────────────────────────────────────────────────
  const totalInformado = useMemo(() => linhas.reduce((s, l) => s + num(l.valor), 0), [linhas])
  const formaDe = (l: Linha) => formasCad.find((f) => f.id === Number(l.formaPagamentoId)) ?? null
  const ehCartao = (l: Linha) => !!formaDe(l)?.exigeAdquirente
  const bandeirasDe = (adqId: number | "") => bandeiras.filter((b) => !adqId || !b.adquirentesCompativeis?.length || b.adquirentesCompativeis.includes(Number(adqId)))
  const tarifaDe = (l: Linha): number => {
    const forma = formaDe(l)
    if (!forma?.exigeAdquirente || !l.adquirenteId) return 0
    const relevantes: TaxaView[] = taxas.filter((t) =>
      (t.formaPagamentoId == null || t.formaPagamentoId === forma.id) &&
      (t.adquirenteId == null || t.adquirenteId === Number(l.adquirenteId)) &&
      (t.bandeiraId == null || t.bandeiraId === Number(l.bandeiraId)))
    if (!relevantes.length) return 0
    return calcularTaxas(relevantes, { valorBruto: num(l.valor), nParcelas: Number(l.parcelas) || 1 }).valorTaxas
  }
  const totalTarifas = useMemo(() => linhas.reduce((s, l) => s + tarifaDe(l), 0), [linhas, taxas, formasCad, bandeiras])
  const desconto = num(ajustes.desconto), juros = num(ajustes.juros), multa = num(ajustes.multa), acrescimo = num(ajustes.acrescimo), creditoUtilizado = num(ajustes.creditoUtilizado)
  const acrescimos = juros + multa + acrescimo
  // Saldo do ESCOPO selecionado (cobrança/participante/geral). Sem escopo → saldo da obrigação.
  const saldoCobranca = escopo ? Number(escopo.saldoBrl ?? 0) : Number(det?.saldoBrl ?? 0)
  // FONTE ÚNICA de cálculo (mesma função revalidada no backend)
  const calc = calcularRecebimento({ saldoSelecionado: saldoCobranca, linhas: linhas.map((l) => ({ valor: num(l.valor) })), desconto, juros, multa, acrescimo, creditoUtilizado })
  const liquidoAReceber = calc.valorLiquidoDevido
  const recebido = calc.totalInformado
  const saldoRestante = calc.saldoRestante
  const excedente = calc.excedente
  const situacao = calc.situacao // INICIAL | PARCIAL | QUITADO | EXCEDENTE
  const temValor = situacao !== "INICIAL"
  const creditoGerado = excedente
  const parcelasManuais = (det?.parcelasDetalhe ?? []).filter((p: any) => (p.status ?? "").toUpperCase() !== "PAGA")
  const somaManual = Object.values(alocManual).reduce((s, v) => s + num(v), 0)
  const manualInvalido = politica === "MANUAL" && parcelasManuais.length > 0 && Math.abs(somaManual - recebido) >= 0.01
  // Pagamento GERAL: alocação por participante (automática = proporcional ao saldo / manual)
  const centR = (v: number) => Math.round((Number(v) || 0) * 100) / 100
  const ehGeral = escopo?.tipo === "GERAL"
  const alocacoesGeral = useMemo(() => {
    if (!ehGeral) return [] as { obrigacaoId: number; nome: string; saldoBrl: number; valor: number }[]
    const somaSaldo = participantes.reduce((s, p) => s + (p.saldoBrl || 0), 0)
    return participantes.map((p) => ({
      obrigacaoId: p.obrigacaoId, nome: p.nome, saldoBrl: p.saldoBrl || 0,
      valor: alocGeralModo === "AUTOMATICA"
        ? (somaSaldo > 0 ? centR(recebido * ((p.saldoBrl || 0) / somaSaldo)) : centR(recebido / Math.max(1, participantes.length)))
        : centR(num(alocGeralManual[p.obrigacaoId])),
    }))
  }, [ehGeral, participantes, alocGeralModo, alocGeralManual, recebido])
  const somaGeral = centR(alocacoesGeral.reduce((s, a) => s + a.valor, 0))
  const geralInvalido = ehGeral && recebido > 0 && Math.abs(somaGeral - recebido) >= 0.02

  const contaPrincipal = useMemo(() => contasOpts.find((c) => c.key === linhas[0]?.contaKey) ?? null, [contasOpts, linhas])
  const pagadorNome = pagadorTipo === "EXTERNO" ? (ext.nome || "Externo") : (participantes.find((p) => p.pessoaId === pagadorPessoaId)?.nome ?? (pagadorTipo === "EMPRESA" ? "Empresa" : pagadorTipo === "TERCEIRO" ? "Terceiro" : "—"))

  // ── validação ─────────────────────────────────────────────────────────────
  const pendencias = useMemo(() => {
    const p: string[] = []
    const comValor = linhas.filter((l) => num(l.valor) > 0)
    if (!comValor.length) p.push("Adicione ao menos uma forma de pagamento com valor.")
    for (const l of linhas) {
      if (num(l.valor) > 0 && !l.formaPagamentoId) p.push("Toda linha com valor precisa de uma forma de pagamento.")
      if (num(l.valor) > 0 && !l.contaKey) p.push("Toda linha com valor precisa de uma conta de destino.")
      if (num(l.valor) < 0) p.push("Valor não pode ser negativo.")
    }
    if (pagadorTipo === "EXTERNO" && !ext.nome.trim()) p.push("Informe o nome do pagador externo.")
    if (manualInvalido) p.push("Na seleção manual, a soma das alocações deve ser igual ao total informado.")
    if (creditoUtilizado > creditoDisponivel + 0.005) p.push(`Crédito utilizado (${brl(creditoUtilizado)}) excede o disponível (${brl(creditoDisponivel)}).`)
    if (geralInvalido) p.push("No pagamento geral, a soma das alocações deve ser igual ao total informado.")
    return [...new Set(p)]
  }, [linhas, pagadorTipo, ext.nome, manualInvalido, creditoUtilizado, creditoDisponivel, geralInvalido])
  const valido = pendencias.length === 0

  // ── ações ─────────────────────────────────────────────────────────────────
  const setLinha = (id: number, patch: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l._id === id ? { ...l, ...patch } : l)))
  const addLinha = () => setLinhas((ls) => [...ls, novaLinha()])
  const rmLinha = (id: number) => setLinhas((ls) => (ls.length > 1 ? ls.filter((l) => l._id !== id) : ls))

  const onFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return
    setSubindo(true)
    try {
      const enviados = await uploadFiles(Array.from(files), { prefix: "financeiro/comprovantes" })
      setComprovantes((c) => [...c, ...enviados.map((e) => ({ arquivoUrl: e.url, arquivoNome: e.name, tamanho: e.size }))])
    } catch { setErroSubmit("Falha no upload de comprovante.") } finally { setSubindo(false) }
  }, [])

  const origemRecurso = (forma: any): string => {
    const s = `${forma?.name ?? ""} ${forma?.type ?? ""} ${forma?.categoria ?? ""}`.toUpperCase()
    if (s.includes("PIX")) return "PIX"
    if (s.includes("CART") || s.includes("CARD")) return "CARTAO"
    if (s.includes("DINHEIRO") || s.includes("ESPÉCIE") || s.includes("ESPECIE")) return "OUTRO"
    return "CONTA"
  }

  const submit = async () => {
    if (!valido || enviando) return
    setEnviando(true); setErroSubmit(null)
    // Pagamento GERAL: aplica a alocação por participante (endpoint dedicado)
    if (ehGeral) {
      try {
        const forma1 = formasCad
        const formas = linhas.filter((l) => num(l.valor) > 0).map((l) => {
          const forma = forma1.find((f) => f.id === Number(l.formaPagamentoId)); const conta = contasOpts.find((c) => c.key === l.contaKey)
          return { formaPagamentoId: Number(l.formaPagamentoId) || null, formaLabel: forma?.name ?? null, valor: num(l.valor), contaId: conta?.id ?? null, contaTipo: conta?.tipo ?? null, contaLabel: conta?.label ?? null, contaBanco: conta?.banco ?? null, contaAgencia: conta?.agencia ?? null, contaNumero: conta?.numero ?? null, dataRecebimento: l.dataRec || null, dataCompensacao: l.dataComp || null, referencia: l.referencia || null, origemRecurso: forma ? origemRecurso(forma) : null }
        })
        const pagadorG = pagadorTipo === "EXTERNO" ? { tipo: "EXTERNO" as const, parteExterna: { nome: ext.nome, documento: ext.documento || null, telefone: ext.telefone || null, observacao: ext.observacao || null } } : { tipo: pagadorTipo, pessoaId: pagadorTipo === "REQUERENTE" ? (pagadorPessoaId || null) : null }
        const r = await fetch(`/api/financeiro/v3/receita/${receitaRef}/registrar-pagamento-geral`, {
          method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ alocacoes: alocacoesGeral.map((a) => ({ obrigacaoId: a.obrigacaoId, valor: a.valor })), formas, pagador: pagadorG, observacao: observacao || "[Pagamento geral da Receita]" }),
        }).then((x) => x.json())
        if (!r?.ok) { setErroSubmit(r?.erro ?? "Falha no pagamento geral."); setEnviando(false); return }
        setOk(true); setTimeout(() => { onDone?.(); onClose() }, 700); return
      } catch { setErroSubmit("Erro de rede no pagamento geral."); setEnviando(false); return }
    }
    try {
      const formas = linhas.filter((l) => num(l.valor) > 0).map((l) => {
        const forma = formasCad.find((f) => f.id === Number(l.formaPagamentoId))
        const conta = contasOpts.find((c) => c.key === l.contaKey)
        return {
          formaPagamentoId: Number(l.formaPagamentoId) || null, formaLabel: forma?.name ?? null, valor: num(l.valor),
          contaId: conta?.id ?? null, contaTipo: conta?.tipo ?? null, contaLabel: conta?.label ?? null,
          contaBanco: conta?.banco ?? null, contaAgencia: conta?.agencia ?? null, contaNumero: conta?.numero ?? null,
          dataRecebimento: l.dataRec || null, dataCompensacao: l.dataComp || null, referencia: l.referencia || null,
          origemRecurso: forma ? origemRecurso(forma) : null,
          tarifa: tarifaDe(l) || null,
          adquirenteLabel: adquirentes.find((a) => a.id === Number(l.adquirenteId))?.nome ?? null,
          bandeiraLabel: bandeiras.find((b) => b.id === Number(l.bandeiraId))?.nome ?? null,
        }
      })
      const pagador = pagadorTipo === "EXTERNO"
        ? { tipo: "EXTERNO" as const, parteExterna: { nome: ext.nome, documento: ext.documento || null, telefone: ext.telefone || null, observacao: ext.observacao || null } }
        : { tipo: pagadorTipo, pessoaId: pagadorTipo === "REQUERENTE" ? (pagadorPessoaId || null) : null }
      // adiantamento/crédito: sem cobrança → o valor vira crédito financeiro (excedente)
      const excTrat = escopo?.tipo === "ADIANTAMENTO" ? "ADIANTAMENTO" : escopo?.tipo === "CREDITO" ? "CREDITO" : situacao === "EXCEDENTE" ? excedenteTrat : null
      const body = {
        obrigacaoId, moeda: det?.moeda ?? "BRL", formas, pagador,
        ajustes: { desconto, juros, multa, acrescimo, creditoUtilizado },
        aplicacao: { politica, manual: politica === "MANUAL" ? parcelasManuais.map((p: any) => ({ parcelaId: p.id, valor: num(alocManual[p.id]) })).filter((x: any) => x.valor > 0) : undefined },
        excedenteTratamento: excTrat,
        parcialTratamento: situacao === "PARCIAL" ? parcialTrat : null,
        saldoSelecionado: saldoCobranca,
        totais: { totalInformado: recebido, saldoRestante, excedente },
        escopo: escopo?.tipo ?? null, escopoTag: escopo?.tag ?? null,
        comprovantes, observacao: [escopo?.tag ? `[${escopo.tag}]` : null, observacao || null].filter(Boolean).join(" ") || null,
      }
      const r = await fetch(`/api/financeiro/v3/receita/${receitaRef}/registrar-pagamento`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body),
      }).then((x) => x.json())
      if (!r?.ok) { setErroSubmit(r?.erro ?? "Falha ao registrar pagamento."); setEnviando(false); return }
      setOk(true)
      setTimeout(() => { onDone?.(); onClose() }, 700)
    } catch { setErroSubmit("Erro de rede ao registrar pagamento."); setEnviando(false) }
  }

  // ── UI ──────────────────────────────────────────────────────────────────
  const codigo = det?.codigo ?? receitaRef
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#0d1117]">
      <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6">
        {/* cabeçalho */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-white/40">
              <span>Financeiro</span><span>›</span><span>Receitas</span><span>›</span><span className="text-white/70">{codigo}</span><span>›</span><span>Cobranças</span><span>›</span><span className="text-white/70">Registrar pagamento</span>
            </div>
            <h1 className="text-2xl font-semibold text-white">Registrar pagamento</h1>
            <p className="mt-0.5 text-sm text-white/50">Registre um ou mais recebimentos para esta cobrança.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/5">Cancelar</button>
            <button onClick={submit} disabled={!valido || enviando || ok} title={valido ? "" : pendencias[0]} className="inline-flex items-center gap-2 rounded-lg bg-[#d2a948] px-4 py-2 text-sm font-semibold text-[#1b1508] hover:bg-[#e0b957] disabled:cursor-not-allowed disabled:opacity-50">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : ok ? <CheckCircle2 className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />} Registrar pagamento
            </button>
          </div>
        </div>

        {escopo && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#d2a948]/25 bg-[#d2a948]/5 px-4 py-2.5">
            <span className="text-sm text-white/80"><span className="text-white/50">Escopo:</span> <span className="font-medium text-[#e0b957]">{escopo.tag}</span></span>
            {onTrocarEscopo && <button onClick={onTrocarEscopo} className="rounded-lg border border-white/10 px-3 py-1 text-xs font-medium text-white/70 hover:bg-white/5">Trocar escopo</button>}
          </div>
        )}

        {loading ? (
          <div className="flex h-64 items-center justify-center text-white/40"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando cobrança…</div>
        ) : erro ? (
          <div className="rounded-xl border border-[#f87171]/30 bg-[#f87171]/10 p-4 text-sm text-[#f87171]">{erro}</div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
            {/* ── coluna principal ── */}
            <div className="space-y-5">
              {/* Resumo da Cobrança */}
              <section className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
                <h2 className="mb-4 text-sm font-semibold text-white/80">Resumo da Cobrança</h2>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Campo label="Receita"><div className="text-sm font-medium text-white">{det?.descricao ?? "—"}</div><span className="mt-1 inline-block rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">{codigo}</span></Campo>
                  <Campo label="Participante Financeiro"><div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-[#a78bfa]/20 text-[11px] font-semibold text-[#a78bfa]">{iniciais(det?.responsavel?.nome)}</span><span className="truncate text-sm text-white">{det?.responsavel?.nome ?? "—"}</span></div></Campo>
                  <Campo label="Vencimento"><div className="text-sm text-white">{dataBR(det?.proximoVencimento)}</div></Campo>
                  <Campo label="Status"><span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${statusCls(det?.statusLabel)}`}>{det?.statusLabel ?? "—"}</span></Campo>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4 border-t border-white/10 pt-4 sm:grid-cols-3 lg:grid-cols-6">
                  <Campo label="Valor Original (BRL)"><V>{brl(det?.valorContratadoBrl ?? 0)}</V></Campo>
                  <Campo label="Valor Recebido (BRL)"><V cls="text-[#4ade80]">{brl(det?.recebidoBrl ?? 0)}</V></Campo>
                  <Campo label="Saldo Atual (BRL)"><V cls="text-[#f87171]">{brl(saldoCobranca)}</V></Campo>
                  <Campo label="Valor Base (EUR)"><V>{eur(det?.valorBase ?? 0)}</V></Campo>
                  <Campo label="Valor Operacional (BRL)"><V>{brl(det?.valorContratadoBrl ?? 0)}</V></Campo>
                  <Campo label="Câmbio Aplicado"><V>{det?.cotacao ? Number(det.cotacao).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : "—"}</V><span className="text-[10px] text-white/40">{det?.tipoCambio ?? ""}</span></Campo>
                </div>
              </section>

              {/* 1. Composição do Pagamento */}
              <section className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div><h2 className="text-sm font-semibold text-white/80">1. Composição do Pagamento</h2><p className="text-xs text-white/45">Informe uma ou mais formas de pagamento utilizadas neste recebimento.</p></div>
                  <button onClick={addLinha} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/5"><Plus className="h-3.5 w-3.5" /> Adicionar forma de pagamento</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead><tr className="text-left text-[11px] uppercase tracking-wide text-white/40">
                      <th className="px-2 py-2 font-medium">Forma de Pagamento</th><th className="px-2 py-2 font-medium">Valor (BRL)</th><th className="px-2 py-2 font-medium">Conta de Destino</th><th className="px-2 py-2 font-medium">Data Recebimento</th><th className="px-2 py-2 font-medium">Data Compensação</th><th className="px-2 py-2 font-medium">Referência</th><th className="px-2 py-2"></th>
                    </tr></thead>
                    <tbody>
                      {linhas.map((l) => (
                        <tr key={l._id} className="border-t border-white/5">
                          <td className="px-2 py-1.5 align-top">
                            <select value={l.formaPagamentoId} onChange={(e) => setLinha(l._id, { formaPagamentoId: e.target.value ? Number(e.target.value) : "", adquirenteId: "", bandeiraId: "", parcelas: 1 })} className={inputCls}><option value="">Selecione…</option>{formasCad.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
                            {ehCartao(l) && (
                              <div className="mt-1.5 space-y-1.5 rounded-md border border-white/10 bg-[#161b21] p-2">
                                <div className="grid grid-cols-2 gap-1.5">
                                  <select value={l.adquirenteId} onChange={(e) => setLinha(l._id, { adquirenteId: e.target.value ? Number(e.target.value) : "", bandeiraId: "" })} className={`${inputCls} !py-1 text-xs`}><option value="">Adquirente…</option>{adquirentes.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}</select>
                                  <select value={l.bandeiraId} onChange={(e) => setLinha(l._id, { bandeiraId: e.target.value ? Number(e.target.value) : "" })} className={`${inputCls} !py-1 text-xs`} disabled={!l.adquirenteId}><option value="">Bandeira…</option>{bandeirasDe(l.adquirenteId).map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}</select>
                                </div>
                                {formaDe(l)?.permiteParcelas && (
                                  <select value={l.parcelas} onChange={(e) => setLinha(l._id, { parcelas: Number(e.target.value) })} className={`${inputCls} !py-1 text-xs`}>{Array.from({ length: Math.max(1, formaDe(l)?.maxParcelas ?? 12) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}x</option>)}</select>
                                )}
                                {l.adquirenteId ? (tarifaDe(l) > 0
                                  ? <p className="text-[10px] text-white/50">Taxa: <span className="text-[#d2a948]">{brl(tarifaDe(l))}</span> · líquido <span className="text-[#4ade80]">{brl(Math.max(0, num(l.valor) - tarifaDe(l)))}</span></p>
                                  : <p className="text-[10px] text-white/30">Sem taxa cadastrada para esta combinação.</p>) : null}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-1.5"><input inputMode="decimal" value={l.valor} onChange={(e) => setLinha(l._id, { valor: e.target.value })} placeholder="0,00" className={`${inputCls} w-28 text-right`} /></td>
                          <td className="px-2 py-1.5"><select value={l.contaKey} onChange={(e) => setLinha(l._id, { contaKey: e.target.value })} className={inputCls}><option value="">Selecione…</option>{contasOpts.map((c) => <option key={c.key} value={c.key}>{c.label}{c.sub ? ` — ${c.sub}` : ""}</option>)}</select></td>
                          <td className="px-2 py-1.5"><input type="date" value={l.dataRec} onChange={(e) => setLinha(l._id, { dataRec: e.target.value })} className={`${inputCls} w-36`} /></td>
                          <td className="px-2 py-1.5"><input type="date" value={l.dataComp} onChange={(e) => setLinha(l._id, { dataComp: e.target.value })} className={`${inputCls} w-36`} /></td>
                          <td className="px-2 py-1.5"><input value={l.referencia} onChange={(e) => setLinha(l._id, { referencia: e.target.value })} placeholder="—" className={inputCls} /></td>
                          <td className="px-2 py-1.5 text-center"><button onClick={() => rmLinha(l._id)} disabled={linhas.length === 1} className="text-white/30 hover:text-[#f87171] disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex items-center justify-between rounded-lg bg-[#161b21] px-4 py-2.5"><span className="flex items-center gap-1.5 text-xs text-white/50"><InfoIcon className="h-3.5 w-3.5" /> Total informado (BRL)</span><span className="text-base font-semibold text-white">{brl(totalInformado)}</span></div>
              </section>

              {/* 2. Pagador */}
              <section className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
                <h2 className="text-sm font-semibold text-white/80">2. Pagador</h2>
                <p className="mb-3 text-xs text-white/45">Selecione quem está realizando este pagamento.</p>
                <div className="mb-4 flex flex-wrap gap-2">
                  {([["REQUERENTE", "Participante Financeiro", UsersRound], ["EMPRESA", "Empresa", Building2], ["TERCEIRO", "Terceiro", UserIcon], ["EXTERNO", "Outro", UserIcon]] as const).map(([v, lb, Ic]) => (
                    <button key={v} onClick={() => setPagadorTipo(v)} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${pagadorTipo === v ? "border-[#d2a948]/60 bg-[#d2a948]/10 text-[#e0b957]" : "border-white/10 text-white/60 hover:bg-white/5"}`}><Ic className="h-3.5 w-3.5" /> {lb}</button>
                  ))}
                </div>
                {pagadorTipo === "REQUERENTE" ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div><label className={labelCls}>Participante Financeiro</label><select value={pagadorPessoaId} onChange={(e) => setPagadorPessoaId(e.target.value ? Number(e.target.value) : "")} className={`${inputCls} mt-1`}><option value="">Selecione…</option>{participantes.map((p, i) => <option key={i} value={p.pessoaId ?? ""}>{p.nome}</option>)}</select></div>
                    <div><label className={labelCls}>Vínculo</label><input value={vinculo} onChange={(e) => setVinculo(e.target.value)} className={`${inputCls} mt-1`} /></div>
                  </div>
                ) : pagadorTipo === "EXTERNO" ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div><label className={labelCls}>Nome *</label><input value={ext.nome} onChange={(e) => setExt({ ...ext, nome: e.target.value })} className={`${inputCls} mt-1`} /></div>
                    <div><label className={labelCls}>Documento</label><input value={ext.documento} onChange={(e) => setExt({ ...ext, documento: e.target.value })} className={`${inputCls} mt-1`} /></div>
                    <div><label className={labelCls}>Telefone</label><input value={ext.telefone} onChange={(e) => setExt({ ...ext, telefone: e.target.value })} className={`${inputCls} mt-1`} /></div>
                    <div><label className={labelCls}>Observação</label><input value={ext.observacao} onChange={(e) => setExt({ ...ext, observacao: e.target.value })} className={`${inputCls} mt-1`} /></div>
                  </div>
                ) : (
                  <p className="text-sm text-white/50">Pagamento realizado por {pagadorTipo === "EMPRESA" ? "empresa" : "terceiro"}.</p>
                )}
              </section>

              {/* 3. Ajustes Financeiros */}
              <section className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
                <h2 className="text-sm font-semibold text-white/80">3. Ajustes Financeiros</h2>
                <p className="mb-3 text-xs text-white/45">Informe ajustes que impactam o valor final deste recebimento.</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {([["desconto", "Desconto (BRL)"], ["juros", "Juros (BRL)"], ["multa", "Multa (BRL)"], ["acrescimo", "Acréscimo (BRL)"], ["creditoUtilizado", "Crédito Utilizado (BRL)"]] as const).map(([k, lb]) => (
                    <div key={k}><label className={labelCls}>{lb}</label><input inputMode="decimal" value={(ajustes as any)[k]} onChange={(e) => setAjustes({ ...ajustes, [k]: e.target.value })} placeholder="0,00" className={`${inputCls} mt-1 text-right`} /></div>
                  ))}
                  <div><label className={`${labelCls} flex items-center gap-1`}>Crédito Gerado (BRL) <InfoIcon className="h-3 w-3 text-white/30" /></label><div className="mt-1 rounded-lg border border-white/10 bg-[#161b21] px-3 py-2 text-right text-sm text-white/70">{brl(creditoGerado)}</div></div>
                </div>
                {creditoDisponivel > 0.005 && <p className="mt-2 text-[11px] text-white/45">Crédito financeiro disponível: <span className="text-[#4ade80]">{brl(creditoDisponivel)}</span> — informe em "Crédito Utilizado" para abater neste recebimento.</p>}
                {/* resumo matemático */}
                <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-[#161b21] px-4 py-3 text-center sm:grid-cols-6">
                  <Mini label="Valor Original">{brl(saldoCobranca)}</Mini>
                  <Mini label="− Descontos" cls="text-[#4ade80]">{brl(desconto)}</Mini>
                  <Mini label="+ Acréscimos" cls="text-[#d2a948]">{brl(acrescimos)}</Mini>
                  <Mini label="= Valor Líquido">{brl(liquidoAReceber)}</Mini>
                  <Mini label="Recebido" cls="text-[#7dd3fc]">{brl(recebido)}</Mini>
                  <Mini label="= Saldo Restante" cls={saldoRestante > 0.005 ? "text-[#f87171]" : "text-[#4ade80]"}>{brl(saldoRestante)}</Mini>
                </div>
                {situacao === "PARCIAL" && (
                  <div className="mt-3 rounded-lg border border-[#7dd3fc]/25 bg-[#7dd3fc]/5 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-sm text-[#7dd3fc]"><InfoIcon className="h-4 w-4" /> Pagamento parcial identificado. Saldo restante: {brl(saldoRestante)}. Como deseja tratar este saldo?</p>
                    <div className="flex flex-wrap gap-4">{([["MANTER", "Manter cobrança aberta"], ["GERAR_COBRANCA", "Gerar nova cobrança para o saldo"], ["RENEGOCIAR", "Renegociar posteriormente"]] as const).map(([v, lb]) => <Radio key={v} checked={parcialTrat === v} onChange={() => setParcialTrat(v)}>{lb}</Radio>)}</div>
                  </div>
                )}
                {situacao === "EXCEDENTE" && (
                  <div className="mt-3 rounded-lg border border-[#d2a948]/25 bg-[#d2a948]/5 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-sm text-[#e0b957]"><AlertTriangle className="h-4 w-4" /> Foi identificado um valor excedente de {brl(excedente)}.</p>
                    <div className="flex flex-wrap gap-4">{([["CREDITO", "Gerar crédito financeiro"], ["ABATER_PROXIMAS", "Abater nas próximas cobranças"], ["ADIANTAMENTO", "Manter como adiantamento"], ["DEVOLVER", "Devolver ao cliente"]] as const).map(([v, lb]) => <Radio key={v} checked={excedenteTrat === v} onChange={() => setExcedenteTrat(v)}>{lb}</Radio>)}</div>
                  </div>
                )}
              </section>

              {/* 4. Aplicação do Pagamento */}
              <section className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
                <h2 className="text-sm font-semibold text-white/80">4. Aplicação do Pagamento</h2>
                <p className="mb-3 text-xs text-white/45">{ehGeral ? "Pagamento geral: aloque o valor entre os participantes (nenhum é assumido)." : "Defina como este valor será aplicado."}</p>
                {ehGeral ? (
                  <div className="space-y-3">
                    <div className="flex gap-2">{(["AUTOMATICA", "MANUAL"] as const).map((mm) => (<button key={mm} onClick={() => setAlocGeralModo(mm)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${alocGeralModo === mm ? "border-[#d2a948]/60 bg-[#d2a948]/10 text-[#e0b957]" : "border-white/10 text-white/60 hover:bg-white/5"}`}>{mm === "AUTOMATICA" ? "Distribuição automática" : "Seleção manual"}</button>))}</div>
                    <div className="space-y-1.5 rounded-lg bg-[#161b21] p-3">
                      {alocacoesGeral.map((a) => (<div key={a.obrigacaoId} className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0 flex-1 truncate text-white/75">{a.nome} <span className="text-white/40">· saldo {brl(a.saldoBrl)}</span></span>{alocGeralModo === "MANUAL" ? <input inputMode="decimal" value={alocGeralManual[a.obrigacaoId] ?? ""} onChange={(e) => setAlocGeralManual((x) => ({ ...x, [a.obrigacaoId]: e.target.value }))} placeholder="0,00" className="w-28 rounded-lg border border-white/10 bg-[#20262e] px-2.5 py-1.5 text-right text-sm text-white outline-none focus:border-[#2563eb]/60" /> : <span className="text-white/85">{brl(a.valor)}</span>}</div>))}
                      <div className={`mt-1 flex items-center justify-between border-t border-white/10 pt-1.5 text-xs ${Math.abs(somaGeral - recebido) < 0.02 ? "text-[#4ade80]" : "text-[#f87171]"}`}><span>Alocado</span><span>{brl(somaGeral)} / {brl(recebido)}</span></div>
                    </div>
                    <p className="flex items-center gap-1.5 text-[11px] text-white/45"><InfoIcon className="h-3.5 w-3.5" /> Prévia: cada participante recebe a fração acima, aplicada na cobrança dele.</p>
                  </div>
                ) : (<>
                <div className="flex flex-wrap gap-2">
                  {([["NESTA", "Nesta cobrança"], ["PROXIMAS", "Próximas cobranças"], ["MAIS_ANTIGA", "Cobrança mais antiga"], ["AUTOMATICA", "Distribuição automática"], ["MANUAL", "Seleção manual"]] as const).map(([v, lb]) => (
                    <button key={v} onClick={() => setPolitica(v)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${politica === v ? "border-[#d2a948]/60 bg-[#d2a948]/10 text-[#e0b957]" : "border-white/10 text-white/60 hover:bg-white/5"}`}>{lb}</button>
                  ))}
                </div>
                {politica === "MANUAL" ? (
                  <div className="mt-3 rounded-lg bg-[#161b21] p-3">
                    <p className="mb-2 text-xs text-white/50">Distribua o valor entre as parcelas pendentes (a soma deve ser igual ao total informado):</p>
                    <div className="space-y-1.5">{parcelasManuais.map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate text-white/70">Parcela {p.numero}/{p.totalParcelas} · vence {dataBR(p.vencimento)} · saldo {brl(p.saldoBrl ?? 0)}</span>
                        <input inputMode="decimal" value={alocManual[p.id] ?? ""} onChange={(e) => setAlocManual((a) => ({ ...a, [p.id]: e.target.value }))} placeholder="0,00" className="w-28 rounded-lg border border-white/10 bg-[#20262e] px-2.5 py-1.5 text-right text-sm text-white outline-none focus:border-[#2563eb]/60" />
                      </div>
                    ))}{!parcelasManuais.length && <p className="text-xs text-white/40">Sem parcelas em aberto — o valor será aplicado ao saldo.</p>}</div>
                    {parcelasManuais.length > 0 && <div className={`mt-2 flex items-center justify-between text-xs ${Math.abs(somaManual - recebido) < 0.01 ? "text-[#4ade80]" : "text-[#f87171]"}`}><span>Alocado</span><span>{brl(somaManual)} / {brl(recebido)}</span></div>}
                  </div>
                ) : (
                  <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-[#161b21] px-3 py-2 text-xs text-white/45"><InfoIcon className="h-3.5 w-3.5" /> {politica === "NESTA" ? "O valor será aplicado prioritariamente nesta cobrança." : politica === "PROXIMAS" ? "O valor será direcionado às próximas cobranças." : politica === "MAIS_ANTIGA" ? "O valor quitará primeiro a cobrança mais antiga em aberto." : "O valor será distribuído proporcionalmente entre as parcelas em aberto."}</p>
                )}
                </>)}
              </section>

              {/* 5 + 6 */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <section className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
                  <h2 className="text-sm font-semibold text-white/80">5. Documentos e Comprovantes</h2>
                  <p className="mb-3 text-xs text-white/45">Anexe os comprovantes deste pagamento.</p>
                  <div onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files) }} className="cursor-pointer rounded-lg border border-dashed border-white/15 bg-[#161b21] px-4 py-6 text-center hover:border-white/25">
                    {subindo ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-white/40" /> : <Upload className="mx-auto h-5 w-5 text-white/40" />}
                    <p className="mt-2 text-xs text-white/50">Arraste arquivos aqui ou <span className="text-[#7dd3fc]">selecionar arquivos</span></p>
                    <p className="text-[10px] text-white/30">PDF, JPG, PNG ou DOCX até 20MB</p>
                    <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.docx" className="hidden" onChange={(e) => onFiles(e.target.files)} />
                  </div>
                  {comprovantes.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      <p className="text-[11px] uppercase tracking-wide text-white/40">Arquivos anexados ({comprovantes.length})</p>
                      {comprovantes.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-lg bg-[#161b21] px-3 py-2 text-sm">
                          <FileText className="h-4 w-4 shrink-0 text-white/40" />
                          <span className="min-w-0 flex-1 truncate text-white/80">{c.arquivoNome}</span>
                          <span className="text-[11px] text-white/40">{fmtTamanho(c.tamanho)}</span>
                          <a href={c.arquivoUrl} target="_blank" rel="noreferrer" className="text-white/40 hover:text-white/70"><Eye className="h-4 w-4" /></a>
                          <button onClick={() => setComprovantes((cs) => cs.filter((_, j) => j !== i))} className="text-white/40 hover:text-[#f87171]"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
                <section className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
                  <h2 className="text-sm font-semibold text-white/80">6. Observações</h2>
                  <p className="mb-3 text-xs text-white/45">Informações internas sobre este recebimento.</p>
                  <textarea value={observacao} onChange={(e) => setObservacao(e.target.value.slice(0, 1000))} rows={5} className={`${inputCls} resize-none`} placeholder="Notas internas…" />
                  <p className="mt-1 text-right text-[10px] text-white/30">{observacao.length}/1000</p>
                </section>
              </div>
            </div>

            {/* ── sidebar ── */}
            <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
              <section className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
                <h2 className="mb-3 text-sm font-semibold text-white/80">Resumo do Recebimento</h2>
                <dl className="space-y-2 text-sm">
                  <Row k="Valor da Cobrança">{brl(saldoCobranca)}</Row>
                  <Row k="Total Informado">{brl(totalInformado)}</Row>
                  <Row k="Descontos" cls="text-[#4ade80]">− {brl(desconto)}</Row>
                  <Row k="Juros" cls="text-[#d2a948]">+ {brl(juros)}</Row>
                  <Row k="Multas" cls="text-[#d2a948]">+ {brl(multa)}</Row>
                  <Row k="Acréscimos" cls="text-[#d2a948]">+ {brl(acrescimo)}</Row>
                  {totalTarifas > 0.005 && <Row k="Taxas (cartão)" cls="text-[#f87171]">− {brl(totalTarifas)}</Row>}
                  <div className="my-2 border-t border-white/10" />
                  {totalTarifas > 0.005 && <Row k="Líquido em caixa" cls="text-white/70">{brl(Math.max(0, totalInformado - totalTarifas))}</Row>}
                  <Row k="Valor Líquido Recebido" cls="font-semibold text-[#7dd3fc]">{brl(recebido)}</Row>
                  <Row k="Saldo Restante" cls={!temValor ? "text-white/70" : saldoRestante > 0.005 ? "text-[#f87171]" : "text-[#4ade80]"}>{brl(saldoRestante)}</Row>
                  <div className="flex items-center justify-between pt-1"><dt className="text-white/50">Situação Final</dt><dd><span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${temValor ? statusCls(situacao) : "bg-white/10 text-white/60"}`}>{situacao === "INICIAL" ? "Aguardando dados do recebimento" : situacao === "QUITADO" ? "Quitada" : situacao === "EXCEDENTE" ? "Excedente" : "Parcial"}</span></dd></div>
                </dl>
                <div className="mt-4 space-y-2 border-t border-white/10 pt-3 text-sm">
                  <Det icon={Landmark} k="Conta Destino (principal)">{contaPrincipal ? `${contaPrincipal.label}${contaPrincipal.sub ? " – " + contaPrincipal.sub : ""}` : "—"}</Det>
                  <Det icon={CreditCard} k="Formas de Pagamento">{linhas.filter((l) => l.formaPagamentoId).length} forma(s)</Det>
                  <Det icon={Users} k="Participante Financeiro">{det?.responsavel?.nome ?? "—"}</Det>
                  <Det icon={UserIcon} k="Pagador">{pagadorNome}</Det>
                  <Det icon={FileText} k="Comprovantes Anexados">{comprovantes.length} arquivo(s)</Det>
                </div>
              </section>

              <section className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
                <h2 className="mb-3 text-sm font-semibold text-white/80">Impacto Financeiro</h2>
                {!temValor ? (
                  <p className="flex items-start gap-2 text-xs text-white/45"><InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Preencha a composição do pagamento para visualizar o impacto.</p>
                ) : (
                <ul className="space-y-2 text-xs text-white/60">
                  {situacao === "PARCIAL" ? <Impact icon={InfoIcon} cls="text-[#7dd3fc]">Esta cobrança ficará com saldo de {brl(saldoRestante)}.</Impact> : <Impact icon={CheckCircle2} cls="text-[#4ade80]">Esta cobrança será quitada.</Impact>}
                  {situacao === "PARCIAL" && parcialTrat === "MANTER" && <Impact icon={InfoIcon} cls="text-white/50">Será mantida aberta para novos recebimentos.</Impact>}
                  {situacao === "PARCIAL" && parcialTrat === "GERAR_COBRANCA" && <Impact icon={InfoIcon} cls="text-white/50">Será criada uma nova cobrança para o saldo.</Impact>}
                  {situacao === "EXCEDENTE" && <Impact icon={AlertTriangle} cls="text-[#d2a948]">Excedente de {brl(excedente)} → {excedenteTrat === "CREDITO" ? "crédito financeiro" : excedenteTrat === "ABATER_PROXIMAS" ? "abater próximas" : excedenteTrat === "ADIANTAMENTO" ? "adiantamento" : "devolução"}.</Impact>}
                  <Impact icon={CheckCircle2} cls="text-[#4ade80]">Nenhum pagamento anterior será alterado.</Impact>
                </ul>
                )}
              </section>

              {erroSubmit && <div className="rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 p-3 text-xs text-[#f87171]">{erroSubmit}</div>}
              {!valido && <div className="rounded-lg border border-white/10 bg-[#161b21] p-3 text-xs text-white/50"><p className="mb-1 font-medium text-white/70">Pendências:</p><ul className="list-inside list-disc space-y-0.5">{pendencias.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── subcomponentes ──────────────────────────────────────────────────────────
function Campo({ label, children }: { label: string; children: React.ReactNode }) { return <div><div className={labelCls}>{label}</div><div className="mt-1">{children}</div></div> }
function V({ children, cls = "text-white" }: { children: React.ReactNode; cls?: string }) { return <div className={`text-sm font-semibold ${cls}`}>{children}</div> }
function Mini({ label, children, cls = "text-white" }: { label: string; children: React.ReactNode; cls?: string }) { return <div><div className="text-[10px] uppercase tracking-wide text-white/40">{label}</div><div className={`mt-0.5 text-sm font-semibold ${cls}`}>{children}</div></div> }
function Row({ k, children, cls = "text-white" }: { k: string; children: React.ReactNode; cls?: string }) { return <div className="flex items-center justify-between"><dt className="text-white/50">{k}</dt><dd className={cls}>{children}</dd></div> }
function Det({ icon: Ic, k, children }: { icon: any; k: string; children: React.ReactNode }) { return <div className="flex items-start gap-2"><Ic className="mt-0.5 h-4 w-4 shrink-0 text-white/40" /><div className="min-w-0"><div className="text-[11px] text-white/40">{k}</div><div className="truncate text-white/80">{children}</div></div></div> }
function Radio({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: React.ReactNode }) { return <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-white/70"><input type="radio" checked={checked} onChange={onChange} className="accent-[#2563eb]" /> {children}</label> }
function Impact({ icon: Ic, cls, children }: { icon: any; cls: string; children: React.ReactNode }) { return <li className="flex items-start gap-2"><Ic className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${cls}`} /><span>{children}</span></li> }
