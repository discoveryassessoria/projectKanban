// src/components/financeiro/v3/EditarDistribuicaoView.tsx
// ============================================================================
// EDITAR DISTRIBUIÇÃO FINANCEIRA (#85). Overlay full-screen aberto de Receita →
// Participantes Financeiros → "Editar distribuição". Edita SÓ como o TOTAL da
// Receita consolidada se divide entre participantes (não cria nova Receita nem muda
// estrutura). Trabalha em moeda-base (total invariante); BRL informativo. Discovery DS.
// ============================================================================
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { LAYER } from "@/src/lib/ui/layers"
import { ratearBrlPorBase } from "@/lib/financeiro/dominio/cambio"
import {
  Loader2, CheckCircle2, AlertTriangle, Info as InfoIcon, Trash2, UserPlus, Users, Scale, Percent, Coins, Sparkles,
} from "lucide-react"
import { authHeaders } from "@/src/lib/financeiro/http"
import { fmtBrl as brl } from "@/src/lib/financeiro/formato"
import { fmtMoeda as money } from "@/src/lib/financeiro/formato"

const iniciais = (n?: string | null) => (n ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?"
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : Number(v) || 0 }
const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

type Metodo = "HERDADA" | "IGUAL" | "PERCENTUAL" | "VALOR"
interface Row {
  key: string
  obrigacaoId: number | null
  requerenteId: number | null
  nome: string
  papel: string
  recebidoBase: number
  recebidoBrl: number
  valorHerdadoBase: number
  temPagamento: boolean
  temCobranca: boolean
  isMenor: boolean
  podeRemover: boolean
  novo: boolean
  incluido: boolean
  valorBase: number
}
const inputCls = "w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] text-right outline-none focus:border-[var(--info)]"

export default function EditarDistribuicaoView({ obrigacaoId, receitaRef, onClose, onDone }: {
  obrigacaoId: number; receitaRef: string; onClose: () => void; onDone?: () => void
}) {
  const [dist, setDist] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [metodo, setMetodo] = useState<Metodo>("PERCENTUAL")
  const [rows, setRows] = useState<Row[]>([])
  const [estrategia, setEstrategia] = useState<"ATUALIZAR_ABERTAS" | "REGERAR_NAO_PAGAS" | "AJUSTE_COMPENSATORIO">("ATUALIZAR_ABERTAS")
  const [motivo, setMotivo] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [erroSave, setErroSave] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const totalBase: number = dist?.totalBase ?? 0
  const moedaBase: string = dist?.moedaBase ?? "BRL"
  const cotacao: number | null = dist?.cotacao ?? null
  // SSOT do total em BRL (soma dos BRL congelados por participante), NUNCA recomputado
  // de uma taxa arredondada. `cotacao` (precisão total) só semeia base a partir de BRL editado.
  const totalBrl: number = dist?.totalBrl ?? (cotacao ? cent(totalBase * cotacao) : totalBase)

  useEffect(() => {
    let vivo = true
    const orig = document.body.style.overflow; document.body.style.overflow = "hidden"
    ;(async () => {
      try {
        const r = await fetch(`/api/financeiro/v3/receita/${receitaRef}/redistribuir`, { headers: authHeaders() }).then((x) => x.json())
        if (!vivo) return
        if (!r?.ok || !r?.distribuicao) { setErro(r?.erro ?? "Não foi possível carregar a distribuição."); return }
        setDist(r.distribuicao)
        setRows(r.distribuicao.participantes.map((p: any): Row => ({
          key: `o:${p.obrigacaoId}`, obrigacaoId: p.obrigacaoId, requerenteId: p.requerenteId, nome: p.nome, papel: p.papel,
          recebidoBase: p.recebidoBase, recebidoBrl: p.recebidoBrl, valorHerdadoBase: p.valorHerdadoBase,
          temPagamento: p.temPagamento, temCobranca: p.temCobranca, isMenor: p.isMenor, podeRemover: p.podeRemover,
          novo: false, incluido: true, valorBase: p.valorBase,
        })))
      } catch { if (vivo) setErro("Falha ao carregar.") } finally { if (vivo) setLoading(false) }
    })()
    return () => { vivo = false; document.body.style.overflow = orig }
  }, [receitaRef])

  // ── aplicar método ────────────────────────────────────────────────────────
  const aplicarMetodo = useCallback((m: Metodo, base: Row[]): Row[] => {
    const inc = base.filter((r) => r.incluido)
    if (!inc.length || totalBase <= 0) return base
    if (m === "HERDADA") {
      const somaHer = inc.reduce((s, r) => s + r.valorHerdadoBase, 0)
      return base.map((r) => r.incluido ? { ...r, valorBase: cent(somaHer > 0 ? r.valorHerdadoBase : totalBase / inc.length) } : { ...r, valorBase: 0 })
    }
    if (m === "IGUAL") {
      const q = cent(totalBase / inc.length)
      let resto = cent(totalBase - q * inc.length); let first = true
      return base.map((r) => { if (!r.incluido) return { ...r, valorBase: 0 }; const v = first ? cent(q + resto) : q; first = false; return { ...r, valorBase: v } })
    }
    return base // PERCENTUAL/VALOR mantêm os valores atuais como semente
  }, [totalBase])

  const trocarMetodo = (m: Metodo) => { setMetodo(m); setRows((rs) => aplicarMetodo(m, rs)) }
  const setValor = (key: string, valorBase: number) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, valorBase: cent(valorBase) } : r)))
  const setPct = (key: string, pct: number) => setValor(key, (pct / 100) * totalBase)
  // No modo VALOR edita-se o BRL; grava o canônico em base: valorBase = brl / cotacao (ou brl se sem cotação).
  const setBrl = (key: string, brlVal: number) => setValor(key, cotacao ? brlVal / cotacao : brlVal)
  const removerRow = (key: string) => setRows((rs) => { const r = rs.find((x) => x.key === key); if (!r) return rs; return r.novo ? rs.filter((x) => x.key !== key) : rs.map((x) => (x.key === key ? { ...x, incluido: false, valorBase: 0 } : x)) })
  const reincluir = (key: string) => setRows((rs) => rs.map((x) => (x.key === key ? { ...x, incluido: true } : x)))
  const adicionar = (d: any) => setRows((rs) => rs.some((r) => r.requerenteId === d.requerenteId) ? rs : [...rs, {
    key: `n:${d.requerenteId}`, obrigacaoId: null, requerenteId: d.requerenteId, nome: d.nome, papel: "Adicional",
    recebidoBase: 0, recebidoBrl: 0, valorHerdadoBase: 0, temPagamento: false, temCobranca: false, isMenor: d.isMenor, podeRemover: !d.isMenor, novo: true, incluido: true, valorBase: 0,
  }])

  // ── cálculos ──────────────────────────────────────────────────────────────
  // Memorizado: é dependência das validações abaixo (precisa de identidade estável).
  const incluidos = useMemo(() => rows.filter((r) => r.incluido), [rows])
  const totalDistribuido = cent(incluidos.reduce((s, r) => s + r.valorBase, 0))
  const diferenca = cent(totalDistribuido - totalBase)
  const soma100 = Math.abs(diferenca) < 0.01
  const pctDe = (v: number) => (totalBase > 0 ? cent((v / totalBase) * 100) : 0)
  const somaPct = cent(incluidos.reduce((s, r) => s + pctDe(r.valorBase), 0))
  // BRL = PARTIÇÃO EXATA do SSOT (totalBrl): rateio por base com resíduo determinístico,
  // logo a soma dos BRL das linhas é SEMPRE = totalBrl. O fechamento é governado pela BASE
  // (soma == totalBase); o BRL nunca diverge por arredondamento de taxa.
  const alvoBrl = cent(totalBrl)
  // Memorizado: alimenta o total em BRL, que é dependência das validações.
  const brlAlocList = useMemo(() => ratearBrlPorBase(incluidos.map((r) => r.valorBase), alvoBrl), [incluidos, alvoBrl])
  const brlAloc = new Map<string, number>(incluidos.map((r, i) => [r.key, brlAlocList[i]]))
  const brlDeRow = (r: Row) => (r.incluido ? brlAloc.get(r.key) ?? 0 : 0)
  const totalDistribuidoBrl = cent(brlAlocList.reduce((s, v) => s + v, 0))
  const fechaBrl = soma100 // BRL é partição exata do total; fechamento vem da base
  const disponiveisRestantes = (dist?.disponiveis ?? []).filter((d: any) => !rows.some((r) => r.requerenteId === d.requerenteId))

  // Sem useMemo manual: `incluidos` é derivado de `rows` a cada render e a lista
  // de pendências é barata. A memoização manual aqui impedia o React Compiler de
  // otimizar o componente INTEIRO — trocar uma memo de string por nada é lucro.
  const pendencias = (() => {
    const p: string[] = []
    if (!incluidos.length) p.push("Inclua ao menos um participante.")
    if (!soma100) p.push(`A distribuição soma ${money(totalDistribuido, moedaBase)}, deve ser ${money(totalBase, moedaBase)} (100%).`)
    if (soma100 && !fechaBrl) p.push(`Total em BRL de ${brl(totalDistribuidoBrl)} deve fechar em ${brl(alvoBrl)}.`)
    for (const r of incluidos) if (r.valorBase < r.recebidoBase - 0.005) p.push(`${r.nome}: valor abaixo do já recebido (${money(r.recebidoBase, moedaBase)}).`)
    for (const r of incluidos) if (r.valorBase < 0) p.push(`${r.nome}: valor negativo.`)
    return [...new Set(p)]
  })()
  const valido = pendencias.length === 0 && !!dist

  const salvar = async () => {
    if (!valido || salvando) return
    setSalvando(true); setErroSave(null)
    try {
      const participantes = rows.map((r) => ({ obrigacaoId: r.obrigacaoId, requerenteId: r.requerenteId, incluido: r.incluido, valorBase: r.incluido ? r.valorBase : 0 }))
      const r = await fetch(`/api/financeiro/v3/receita/${receitaRef}/redistribuir`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ metodo, estrategia, motivo: motivo || null, participantes }),
      }).then((x) => x.json())
      if (!r?.ok) { setErroSave(r?.erro ?? "Falha ao salvar."); setSalvando(false); return }
      setOk(true); setTimeout(() => { onDone?.(); onClose() }, 700)
    } catch { setErroSave("Erro de rede ao salvar."); setSalvando(false) }
  }

  const METODOS: { v: Metodo; lb: string; desc: string; Ic: any }[] = [
    { v: "HERDADA", lb: "Herdada da regra financeira", desc: "Restaura a divisão calculada pela regra da fase.", Ic: Sparkles },
    { v: "IGUAL", lb: "Divisão igual", desc: "Distribui o total igualmente entre os incluídos.", Ic: Scale },
    { v: "PERCENTUAL", lb: "Percentual personalizado", desc: "Você define o % de cada participante.", Ic: Percent },
    { v: "VALOR", lb: "Valor personalizado em BRL", desc: "Você define o valor em BRL de cada participante; o % e a referência EUR são recalculados.", Ic: Coins },
  ]

  if (typeof document === "undefined") return null
  return createPortal((
    <div className="fixed inset-0 overflow-y-auto bg-[var(--surface-overlay)]" style={{ zIndex: LAYER.aboveProcess }}>
      <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <span>Financeiro</span><span>›</span><span>Receitas</span><span>›</span><span className="text-[var(--text-secondary)]">{dist?.codigo ?? receitaRef}</span><span>›</span><span className="text-[var(--text-secondary)]">Editar distribuição</span>
            </div>
            <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Editar distribuição financeira</h1>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">Altere como o total desta Receita é dividido entre os participantes. A Receita e o total não mudam.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">Cancelar</button>
            <button onClick={salvar} disabled={!valido || salvando || ok} title={valido ? "" : pendencias[0]} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--info)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-50">
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Salvar
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center text-[var(--text-muted)]"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando distribuição…</div>
        ) : erro ? (
          <div className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-4 text-sm text-[var(--danger)]">{erro}</div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
            <div className="space-y-5">
              {/* Receita */}
              <section className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Receita</div><div className="text-sm font-medium text-[var(--text-primary)]">{dist?.descricao ?? "—"} <span className="ml-1 rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">{dist?.codigo}</span></div></div>
                  <div className="text-right"><div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Total a distribuir</div><div className="text-lg font-semibold text-[var(--text-primary)]">{money(totalBase, moedaBase)}</div>{cotacao && <div className="text-[11px] text-[var(--text-muted)]">{brl(alvoBrl)} · câmbio {cotacao.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</div>}</div>
                </div>
              </section>

              {/* Método */}
              <section className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
                <h2 className="mb-3 text-sm font-semibold text-[var(--text-secondary)]">Método de distribuição</h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {METODOS.map(({ v, lb, desc, Ic }) => (
                    <button key={v} onClick={() => trocarMetodo(v)} className={`flex items-start gap-2.5 rounded-[var(--radius-sm)] border p-3 text-left ${metodo === v ? "border-[color-mix(in_srgb,var(--info)_60%,transparent)] bg-[color-mix(in_srgb,var(--info)_10%,transparent)]" : "border-[var(--border-default)] hover:bg-[var(--surface-hover)]"}`}>
                      <Ic className={`mt-0.5 h-4 w-4 shrink-0 ${metodo === v ? "text-[var(--info)]" : "text-[var(--text-muted)]"}`} />
                      <div><div className="text-sm font-medium text-[var(--text-primary)]">{lb}</div><div className="text-[11px] text-[var(--text-muted)]">{desc}</div></div>
                    </button>
                  ))}
                </div>
              </section>

              {/* Tabela */}
              <section className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
                <h2 className="mb-3 text-sm font-semibold text-[var(--text-secondary)]">Distribuição entre participantes</h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                      <th className="px-2 py-2 font-medium">Participante</th><th className="px-2 py-2 text-right font-medium">Participação %</th><th className="px-2 py-2 text-right font-medium">{metodo === "VALOR" ? `Referência ${moedaBase}` : `Valor (${moedaBase})`}</th><th className="px-2 py-2 text-right font-medium">{metodo === "VALOR" ? "Valor BRL" : "BRL"}</th><th className="px-2 py-2 text-right font-medium">Recebido</th><th className="px-2 py-2"></th>
                    </tr></thead>
                    <tbody>
                      {rows.map((r) => {
                        const pct = pctDe(r.valorBase)
                        const brlRow = brlDeRow(r)
                        const editPct = metodo === "PERCENTUAL", editVal = metodo === "VALOR"
                        return (
                          <tr key={r.key} className={`border-t border-[var(--border-default)] ${r.incluido ? "" : "opacity-40"}`}>
                            <td className="px-2 py-2">
                              <div className="flex items-center gap-2">
                                <span className="grid h-7 w-7 place-items-center rounded-full bg-[color-mix(in_srgb,var(--text-secondary)_20%,transparent)] text-[11px] font-semibold text-[var(--text-secondary)]">{iniciais(r.nome)}</span>
                                <div><div className="text-sm text-[var(--text-primary)]">{r.nome}</div><div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">{r.papel}{r.novo && <span className="rounded bg-[color-mix(in_srgb,var(--success)_15%,transparent)] px-1 text-[var(--success)]">novo</span>}{r.isMenor && <span className="rounded bg-[color-mix(in_srgb,var(--accent-primary)_15%,transparent)] px-1 text-[var(--accent-primary)]">menor</span>}{r.temPagamento && <span className="rounded bg-[color-mix(in_srgb,var(--info)_15%,transparent)] px-1 text-[var(--info)]">pago</span>}</div></div>
                              </div>
                            </td>
                            <td className="px-2 py-2 text-right">{editPct && r.incluido ? <input inputMode="decimal" value={pct === 0 ? "" : String(pct)} onChange={(e) => setPct(r.key, num(e.target.value))} placeholder="0" className={`${inputCls} w-24`} /> : <span className="text-[var(--text-secondary)]">{pct.toFixed(2)}%</span>}</td>
                            <td className="px-2 py-2 text-right"><span className={editVal ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"}>{money(r.valorBase, moedaBase)}</span></td>
                            <td className="px-2 py-2 text-right">{editVal && r.incluido ? <input inputMode="decimal" value={brlRow === 0 ? "" : String(brlRow)} onChange={(e) => setBrl(r.key, num(e.target.value))} placeholder="0,00" className={`${inputCls} w-32`} /> : <span className="text-[var(--text-muted)]">{brl(brlDeRow(r))}</span>}</td>
                            <td className="px-2 py-2 text-right text-[var(--success)]">{r.recebidoBase > 0 ? money(r.recebidoBase, moedaBase) : "—"}</td>
                            <td className="px-2 py-2 text-center">
                              {r.incluido
                                ? <button onClick={() => removerRow(r.key)} disabled={!r.podeRemover} title={r.podeRemover ? "Remover da distribuição" : r.isMenor ? "Menor de idade não pode ser removido" : "Possui pagamento — não pode ser removido"} className="text-[var(--text-muted)] hover:text-[var(--danger)] disabled:opacity-25"><Trash2 className="h-4 w-4" /></button>
                                : <button onClick={() => reincluir(r.key)} className="text-[11px] text-[var(--info)] hover:underline">incluir</button>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-[var(--border-strong)]">
                        <td className="px-2 py-2.5"><span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">{soma100 ? <CheckCircle2 className="h-4 w-4 text-[var(--success)]" /> : <AlertTriangle className="h-4 w-4 text-[var(--danger)]" />} Total da distribuição</span></td>
                        <td className={`px-2 py-2.5 text-right font-semibold ${Math.abs(somaPct - 100) < 0.05 ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{somaPct.toFixed(2)}%</td>
                        <td className={`px-2 py-2.5 text-right font-semibold ${soma100 ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{money(totalDistribuido, moedaBase)}</td>
                        <td className={`px-2 py-2.5 text-right font-semibold ${soma100 && fechaBrl ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{brl(totalDistribuidoBrl)}</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {!soma100 && <p className="mt-2 text-xs text-[var(--danger)]">Diferença de {money(Math.abs(diferenca), moedaBase)} — ajuste para fechar em {money(totalBase, moedaBase)}.</p>}
                {soma100 && !fechaBrl && <p className="mt-2 text-xs text-[var(--danger)]">Total em BRL {brl(totalDistribuidoBrl)} — ajuste para fechar exatamente em {brl(alvoBrl)}.</p>}
                {metodo === "VALOR" && <p className="mt-2 text-xs text-[var(--text-muted)]">Edite o <span className="text-[var(--text-secondary)]">Valor BRL</span> de cada participante; o % e a referência {moedaBase} são recalculados. Fechamento em BRL: {brl(alvoBrl)}.</p>}
              </section>

              {/* Disponíveis */}
              {disponiveisRestantes.length > 0 && (
                <section className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
                  <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-[var(--text-secondary)]"><Users className="h-4 w-4" /> Participantes disponíveis do processo</h2>
                  <p className="mb-3 text-xs text-[var(--text-muted)]">Requerentes do processo que ainda não participam desta Receita.</p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]"><th className="px-2 py-2 font-medium">Nome</th><th className="px-2 py-2 font-medium">Vínculo</th><th className="px-2 py-2 font-medium">Idade</th><th className="px-2 py-2 font-medium">Status</th><th className="px-2 py-2 text-right"></th></tr></thead>
                      <tbody>{disponiveisRestantes.map((d: any) => (
                        <tr key={d.requerenteId} className="border-t border-[var(--border-default)]">
                          <td className="px-2 py-2 text-[var(--text-primary)]">{d.nome}</td>
                          <td className="px-2 py-2 text-[var(--text-secondary)]">{d.vinculo}</td>
                          <td className="px-2 py-2 text-[var(--text-secondary)]">{d.idade ?? "—"}{d.isMenor && <span className="ml-1 rounded bg-[color-mix(in_srgb,var(--accent-primary)_15%,transparent)] px-1 text-[10px] text-[var(--accent-primary)]">menor</span>}</td>
                          <td className="px-2 py-2 text-[var(--text-muted)]">Fora da distribuição</td>
                          <td className="px-2 py-2 text-right"><button onClick={() => adicionar(d)} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--info)] hover:bg-[var(--surface-hover)]"><UserPlus className="h-3.5 w-3.5" /> Adicionar</button></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>

            {/* sidebar */}
            <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
              <section className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
                <h2 className="mb-3 text-sm font-semibold text-[var(--text-secondary)]">Resumo da distribuição</h2>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between"><dt className="text-[var(--text-muted)]">Total da Receita</dt><dd className="text-[var(--text-primary)]">{money(totalBase, moedaBase)}</dd></div>
                  <div className="flex justify-between"><dt className="text-[var(--text-muted)]">Distribuído</dt><dd className={soma100 ? "text-[var(--success)]" : "text-[var(--danger)]"}>{money(totalDistribuido, moedaBase)}</dd></div>
                  <div className="flex justify-between"><dt className="text-[var(--text-muted)]">Diferença</dt><dd className={soma100 ? "text-[var(--text-secondary)]" : "text-[var(--danger)]"}>{money(diferenca, moedaBase)}</dd></div>
                  <div className="flex justify-between"><dt className="text-[var(--text-muted)]">Participantes</dt><dd className="text-[var(--text-primary)]">{incluidos.length}</dd></div>
                  <div className="flex items-center justify-between pt-1"><dt className="text-[var(--text-muted)]">Situação</dt><dd><span className={`rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold ${soma100 ? "bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-[var(--success)]" : "bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] text-[var(--danger)]"}`}>{soma100 ? "Fecha em 100%" : "Não fecha"}</span></dd></div>
                </dl>
              </section>

              <section className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
                <h2 className="mb-2 text-sm font-semibold text-[var(--text-secondary)]">Impacto da alteração</h2>
                <ul className="space-y-2 text-xs text-[var(--text-secondary)]">
                  <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--success)]" /><span>A Receita e o total não mudam — só a divisão.</span></li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--success)]" /><span>Pagamentos já recebidos são preservados.</span></li>
                  <li className="flex items-start gap-2"><InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--info)]" /><span>Cobranças em aberto seguem a estratégia escolhida.</span></li>
                  {rows.some((r) => r.novo) && <li className="flex items-start gap-2"><UserPlus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" /><span>{rows.filter((r) => r.novo).length} participante(s) serão adicionados.</span></li>}
                </ul>
              </section>

              <section className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
                <h2 className="mb-2 text-sm font-semibold text-[var(--text-secondary)]">Estratégia de aplicação</h2>
                <div className="space-y-2">
                  {([["ATUALIZAR_ABERTAS", "Atualizar cobranças em aberto", "Reescala as parcelas pendentes ao novo valor."], ["REGERAR_NAO_PAGAS", "Regerar parcelas não pagas", "Recria o cronograma pendente pelo novo saldo."], ["AJUSTE_COMPENSATORIO", "Gerar ajuste compensatório", "Preserva as parcelas e lança a diferença."]] as const).map(([v, lb, desc]) => (
                    <label key={v} className={`flex cursor-pointer items-start gap-2 rounded-[var(--radius-sm)] border p-2.5 ${estrategia === v ? "border-[color-mix(in_srgb,var(--info)_50%,transparent)] bg-[color-mix(in_srgb,var(--info)_10%,transparent)]" : "border-[var(--border-default)]"}`}>
                      <input type="radio" checked={estrategia === v} onChange={() => setEstrategia(v)} className="mt-0.5 accent-[var(--info)]" />
                      <div><div className="text-xs font-medium text-[var(--text-primary)]">{lb}</div><div className="text-[11px] text-[var(--text-muted)]">{desc}</div></div>
                    </label>
                  ))}
                </div>
                <textarea value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 300))} rows={2} placeholder="Motivo (auditoria)…" className="mt-3 w-full resize-none rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--info)]" />
              </section>

              {erroSave && <div className="rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-3 text-xs text-[var(--danger)]">{erroSave}</div>}
              {!valido && !loading && <div className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-3 text-xs text-[var(--text-muted)]"><p className="mb-1 font-medium text-[var(--text-secondary)]">Pendências:</p><ul className="list-inside list-disc space-y-0.5">{pendencias.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
            </div>
          </div>
        )}
      </div>
    </div>
  ), document.body)
}
