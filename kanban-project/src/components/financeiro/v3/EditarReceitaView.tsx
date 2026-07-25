// src/components/financeiro/v3/EditarReceitaView.tsx
// ============================================================================
// EDITAR RECEITA (Financeiro V3). Overlay full-screen aberto de Receita → "Editar
// receita". Edita a PRÓPRIA Receita consolidada: título, descrição, serviço,
// referência contratual, moeda-base, valor-base (EUR), regra de câmbio, origem e
// observações. NÃO edita a distribuição entre participantes (fluxo separado).
// Ao mudar valor-base/câmbio, chama a prévia (POST ?preview=1) e mostra o impacto
// nas cobranças abertas antes de salvar. Nunca altera pagamento confirmado.
// Discovery Design System (dark).
// ============================================================================
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  Loader2, CheckCircle2, AlertTriangle, Info as InfoIcon, ShieldCheck, Coins, Receipt, ArrowRight,
} from "lucide-react"
import { parseTaxaCambio } from "@/lib/financeiro/dominio/cambio"

const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0)
const money = (v: number, m: string) => { try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: m || "BRL" }).format(v || 0) } catch { return `${(v || 0).toFixed(2)} ${m}` } }
const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : Number(v) || 0 }
const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100
const dataBR = (s?: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—")

type FxRule = "FIXO" | "VARIAVEL"
interface Cambio { fxRule: FxRule; fxEstimado: number | null; fxFixo: number | null; fxData: string | null; valorBrlFixo: number | null; cotacaoEfetiva: number | null }
interface Receita {
  ref: string; obrigacaoIdRef: number; receitaIdRep: number | null; codigo: string | null; processoId: number | null
  titulo: string | null; descricaoDetalhada: string | null; referenciaContratual: string | null
  tipoServicoId: number | null; servicoNome: string | null; itemMestreNome: string | null; origem: string | null; observacoes: string | null
  moedaBase: string; valorBaseTotal: number; cambio: Cambio
  temPagamentoConfirmado: boolean; cobrancasAbertas: number; recebidoTotalBrl: number; valorContratadoBrlTotal: number
  participantes: { obrigacaoId: number; receitaId: number | null; nome: string; valorBase: number; recebidoBase: number; recebidoBrl: number }[]
  servicosDisponiveis: { id: number; nome: string }[]; moedasDisponiveis: string[]
}
interface Previa {
  ok: boolean; bloqueios: string[]; temPagamentoConfirmado: boolean; moedaBase: string; mudaValor: boolean; mudaCambio: boolean
  valorBaseTotalAntigo: number; valorBaseTotalNovo: number; cotacaoEfetivaAntiga: number | null; cotacaoEfetivaNova: number | null
  valorContratadoBrlAntigo: number; valorContratadoBrlNovo: number; recebidoTotalBrl: number
  cobrancasAfetadas: { parcelaId: number; receitaId: number | null; numero: number; vencimento: string | null; valorBaseAntigo: number; valorBaseNovo: number; valorBrlNovo: number }[]
}

const inputCls = "w-full rounded-lg border border-white/10 bg-[#20262e] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#2563eb]/60"
const labelCls = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-white/50"

export default function EditarReceitaView({ obrigacaoId, receitaRef, onClose, onDone }: {
  obrigacaoId: number; receitaRef: string; onClose: () => void; onDone?: () => void
}) {
  const [rec, setRec] = useState<Receita | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // campos editáveis
  const [titulo, setTitulo] = useState("")
  const [descricao, setDescricao] = useState("")
  const [referencia, setReferencia] = useState("")
  const [observacoes, setObservacoes] = useState("")
  const [moeda, setMoeda] = useState("EUR")
  const [valorBase, setValorBase] = useState<string>("")
  const [fxRule, setFxRule] = useState<FxRule>("VARIAVEL")
  const [fxFixo, setFxFixo] = useState<string>("")
  const [fxEstimado, setFxEstimado] = useState<string>("")
  const [fxData, setFxData] = useState<string>("")
  const [valorBrlFixo, setValorBrlFixo] = useState<string>("")

  const [estrategia, setEstrategia] = useState<"ATUALIZAR_ABERTAS" | "AJUSTE_COMPENSATORIO">("ATUALIZAR_ABERTAS")
  const [justificativa, setJustificativa] = useState("")
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erroSave, setErroSave] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── carregar estado ──
  useEffect(() => {
    let vivo = true
    const orig = document.body.style.overflow; document.body.style.overflow = "hidden"
    ;(async () => {
      try {
        const r = await fetch(`/api/financeiro/v3/receita/${receitaRef}/editar`, { headers: authHeaders() }).then((x) => x.json())
        if (!vivo) return
        if (!r?.ok || !r?.receita) { setErro(r?.erro ?? "Não foi possível carregar a Receita."); return }
        const d: Receita = r.receita
        setRec(d)
        setTitulo(d.titulo ?? "")
        setDescricao(d.descricaoDetalhada ?? "")
        setReferencia(d.referenciaContratual ?? "")
        setObservacoes(d.observacoes ?? "")
        setMoeda(d.moedaBase ?? "EUR")
        setValorBase(String(cent(d.valorBaseTotal)))
        setFxRule(d.cambio.fxRule ?? "VARIAVEL")
        setFxFixo(d.cambio.fxFixo != null ? String(d.cambio.fxFixo) : "")
        setFxEstimado(d.cambio.fxEstimado != null ? String(d.cambio.fxEstimado) : "")
        setFxData(d.cambio.fxData ? d.cambio.fxData.slice(0, 10) : "")
        setValorBrlFixo(d.cambio.valorBrlFixo != null ? String(d.cambio.valorBrlFixo) : "")
      } catch { if (vivo) setErro("Falha ao carregar.") } finally { if (vivo) setLoading(false) }
    })()
    return () => { vivo = false; document.body.style.overflow = orig }
  }, [receitaRef])

  const podeEditarValor = !!rec // valor sempre editável; guarda de "abaixo do recebido" é no preview/save
  const moedaEditavel = !(rec?.temPagamentoConfirmado ?? false) // trocar moeda-base só sem pagamento confirmado

  // patch atual (financeiro) p/ preview
  const patchFinanceiro = useMemo(() => ({
    moeda,
    valorBaseTotal: valorBase === "" ? null : cent(num(valorBase)),
    cambio: {
      fxRule,
      fxFixo: fxFixo === "" ? null : parseTaxaCambio(fxFixo),
      fxEstimado: fxEstimado === "" ? null : parseTaxaCambio(fxEstimado),
      fxData: fxData || null,
      valorBrlFixo: valorBrlFixo === "" ? null : num(valorBrlFixo),
    },
  }), [moeda, valorBase, fxRule, fxFixo, fxEstimado, fxData, valorBrlFixo])

  // detecta mudança financeira vs estado original
  const mudouFinanceiro = useMemo(() => {
    if (!rec) return false
    if (moeda !== rec.moedaBase) return true
    if (cent(num(valorBase)) !== cent(rec.valorBaseTotal)) return true
    if (fxRule !== rec.cambio.fxRule) return true
    if ((fxFixo === "" ? null : parseTaxaCambio(fxFixo)) !== rec.cambio.fxFixo) return true
    if ((fxEstimado === "" ? null : parseTaxaCambio(fxEstimado)) !== rec.cambio.fxEstimado) return true
    if ((fxData || null) !== (rec.cambio.fxData ? rec.cambio.fxData.slice(0, 10) : null)) return true
    if ((valorBrlFixo === "" ? null : num(valorBrlFixo)) !== rec.cambio.valorBrlFixo) return true
    return false
  }, [rec, moeda, valorBase, fxRule, fxFixo, fxEstimado, fxData, valorBrlFixo])

  // preview com debounce quando muda o financeiro
  const rodarPreview = useCallback(async () => {
    setPreviewing(true)
    try {
      const r = await fetch(`/api/financeiro/v3/receita/${receitaRef}/editar?preview=1`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(patchFinanceiro),
      }).then((x) => x.json())
      if (r?.ok && r?.previa) setPrevia(r.previa)
      else setPrevia(null)
    } catch { setPrevia(null) } finally { setPreviewing(false) }
  }, [receitaRef, patchFinanceiro])

  useEffect(() => {
    if (!rec) return
    if (!mudouFinanceiro) { setPrevia(null); return }
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { rodarPreview() }, 450)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [rec, mudouFinanceiro, rodarPreview])

  const bloqueado = (previa?.bloqueios?.length ?? 0) > 0
  const mudouTextual = useMemo(() => {
    if (!rec) return false
    return titulo !== (rec.titulo ?? "") || descricao !== (rec.descricaoDetalhada ?? "") || referencia !== (rec.referenciaContratual ?? "")
      || observacoes !== (rec.observacoes ?? "")
  }, [rec, titulo, descricao, referencia, observacoes])

  const temMudanca = mudouTextual || mudouFinanceiro
  const valido = !!rec && temMudanca && !bloqueado && !previewing

  const salvar = async () => {
    if (!valido || salvando) return
    setSalvando(true); setErroSave(null)
    try {
      const body: Record<string, unknown> = {
        titulo, descricaoDetalhada: descricao, referenciaContratual: referencia,
        observacoes,
        estrategia, justificativa: justificativa || null,
      }
      if (mudouFinanceiro) {
        body.moeda = moeda
        body.valorBaseTotal = valorBase === "" ? null : cent(num(valorBase))
        body.cambio = patchFinanceiro.cambio
      }
      const r = await fetch(`/api/financeiro/v3/receita/${receitaRef}/editar`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      }).then((x) => x.json())
      if (!r?.ok) { setErroSave(r?.erro ?? "Falha ao salvar."); setSalvando(false); return }
      setOk(true); setTimeout(() => { onDone?.(); onClose() }, 700)
    } catch { setErroSave("Erro de rede ao salvar."); setSalvando(false) }
  }

  const cotacaoEfetiva = previa?.cotacaoEfetivaNova ?? rec?.cambio.cotacaoEfetiva ?? null
  const brlTotal = previa && mudouFinanceiro ? previa.valorContratadoBrlNovo : rec?.valorContratadoBrlTotal ?? 0

  if (typeof document === "undefined") return null
  return createPortal((
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#0d1117]">
      <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6">
        {/* header */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-white/40">
              <span>Financeiro</span><span>›</span><span>Receitas</span><span>›</span>
              <span className="text-white/70">{rec?.codigo ?? receitaRef}</span><span>›</span><span className="text-white/70">Editar receita</span>
            </div>
            <h1 className="text-2xl font-semibold text-white">Editar receita</h1>
            <p className="mt-0.5 text-sm text-white/50">Altere os dados desta Receita. A divisão entre participantes é editada em “Editar distribuição”.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/5">Cancelar</button>
            <button onClick={salvar} disabled={!valido || salvando || ok} title={valido ? "" : bloqueado ? previa?.bloqueios[0] : !temMudanca ? "Nenhuma alteração" : ""} className="inline-flex items-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d4fd7] disabled:cursor-not-allowed disabled:opacity-50">
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Salvar
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center text-white/40"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando receita…</div>
        ) : erro ? (
          <div className="rounded-xl border border-[#f87171]/30 bg-[#f87171]/10 p-4 text-sm text-[#f87171]">{erro}</div>
        ) : rec ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
            {/* coluna principal */}
            <div className="space-y-5">
              {/* Dados cadastrais */}
              <section className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
                <h2 className="mb-4 flex items-center gap-1.5 text-sm font-semibold text-white/80"><Receipt className="h-4 w-4" /> Dados da receita</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Título</label>
                    <input value={titulo} onChange={(e) => setTitulo(e.target.value.slice(0, 200))} placeholder="Título da receita" className={inputCls} />
                    <p className="mt-1 text-[11px] text-white/35">Propaga a todos os participantes preservando o sufixo de cada um.</p>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Descrição</label>
                    <textarea value={descricao} onChange={(e) => setDescricao(e.target.value.slice(0, 500))} rows={2} placeholder="Descrição detalhada (opcional)" className={`${inputCls} resize-none`} />
                  </div>
                  <div>
                    <label className={labelCls}>Item do Cadastro Mestre</label>
                    <div className={`${inputCls} flex items-center justify-between`}>
                      <span className={rec.itemMestreNome ? "text-white" : "text-[#d2a948]"}>{rec.itemMestreNome ?? rec.servicoNome ?? "Item mestre não reconciliado"}</span>
                      <span className="text-[10px] text-white/35">Definido pelo Cadastro Mestre</span>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Referência contratual</label>
                    <input value={referencia} onChange={(e) => setReferencia(e.target.value.slice(0, 120))} placeholder="Nº do contrato / proposta" className={inputCls} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Observações</label>
                    <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value.slice(0, 500))} rows={2} placeholder="Observações internas (opcional)" className={`${inputCls} resize-none`} />
                  </div>
                </div>
              </section>

              {/* Valor-base + câmbio */}
              <section className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
                <h2 className="mb-4 flex items-center gap-1.5 text-sm font-semibold text-white/80"><Coins className="h-4 w-4" /> Valor-base e câmbio</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Moeda-base</label>
                    <select value={moeda} disabled={!moedaEditavel} onChange={(e) => setMoeda(e.target.value)} className={`${inputCls} disabled:opacity-50`}>
                      {rec.moedasDisponiveis.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    {!moedaEditavel && <p className="mt-1 text-[11px] text-[#d2a948]">Há pagamento confirmado — moeda-base travada.</p>}
                  </div>
                  <div>
                    <label className={labelCls}>Valor-base total ({moeda})</label>
                    <input inputMode="decimal" value={valorBase} disabled={!podeEditarValor} onChange={(e) => setValorBase(e.target.value)} placeholder="0,00" className={`${inputCls} text-right`} />
                  </div>
                  <div>
                    <label className={labelCls}>Regra de câmbio</label>
                    <div className="flex gap-2">
                      {(["VARIAVEL", "FIXO"] as FxRule[]).map((r) => (
                        <button key={r} onClick={() => setFxRule(r)} disabled={moeda === "BRL"} className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium disabled:opacity-40 ${fxRule === r ? "border-[#2563eb]/60 bg-[#2563eb]/10 text-white" : "border-white/10 text-white/60 hover:bg-white/5"}`}>{r === "FIXO" ? "Fixo" : "Variável"}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>{fxRule === "FIXO" ? "Cotação fixa (BRL/" + moeda + ")" : "Cotação estimada (BRL/" + moeda + ")"}</label>
                    <input inputMode="decimal" value={fxRule === "FIXO" ? fxFixo : fxEstimado} disabled={moeda === "BRL"} onChange={(e) => (fxRule === "FIXO" ? setFxFixo(e.target.value) : setFxEstimado(e.target.value))} placeholder="0,0000" className={`${inputCls} text-right disabled:opacity-40`} />
                  </div>
                  {fxRule === "FIXO" && (
                    <>
                      <div>
                        <label className={labelCls}>Data de fixação</label>
                        <input type="date" value={fxData} disabled={moeda === "BRL"} onChange={(e) => setFxData(e.target.value)} className={`${inputCls} disabled:opacity-40`} />
                      </div>
                      <div>
                        <label className={labelCls}>Valor BRL travado (total)</label>
                        <input inputMode="decimal" value={valorBrlFixo} disabled={moeda === "BRL"} onChange={(e) => setValorBrlFixo(e.target.value)} placeholder="0,00" className={`${inputCls} text-right disabled:opacity-40`} />
                        <p className="mt-1 text-[11px] text-white/35">Se informado, prevalece sobre a cotação. Rateado entre os participantes.</p>
                      </div>
                    </>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg bg-[#161b21] px-4 py-3 text-sm">
                  <div><span className="text-white/40">Valor-base:</span> <span className="font-medium text-white">{money(cent(num(valorBase)), moeda)}</span></div>
                  <div><span className="text-white/40">Cotação efetiva:</span> <span className="font-medium text-white">{cotacaoEfetiva != null ? cotacaoEfetiva.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : "—"}</span></div>
                  <div><span className="text-white/40">Total BRL:</span> <span className="font-medium text-[#7dd3fc]">{brl(brlTotal)}</span></div>
                  {previewing && <span className="inline-flex items-center gap-1 text-xs text-white/40"><Loader2 className="h-3 w-3 animate-spin" /> calculando…</span>}
                </div>
              </section>

              {/* Impacto (só quando muda financeiro) */}
              {mudouFinanceiro && previa && (
                <section className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
                  <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-white/80"><ArrowRight className="h-4 w-4" /> Impacto da alteração</h2>
                  <p className="mb-3 text-xs text-white/45">Prévia calculada pelo motor. Nada é gravado até você salvar.</p>

                  <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-[#161b21] p-3"><div className="text-[11px] uppercase tracking-wide text-white/40">Valor-base</div><div className="text-sm text-white">{money(previa.valorBaseTotalAntigo, rec.moedaBase)} → <span className="font-semibold text-white">{money(previa.valorBaseTotalNovo, previa.moedaBase)}</span></div></div>
                    <div className="rounded-lg bg-[#161b21] p-3"><div className="text-[11px] uppercase tracking-wide text-white/40">Total BRL</div><div className="text-sm text-white">{brl(previa.valorContratadoBrlAntigo)} → <span className="font-semibold text-[#7dd3fc]">{brl(previa.valorContratadoBrlNovo)}</span></div></div>
                    <div className="rounded-lg bg-[#161b21] p-3"><div className="text-[11px] uppercase tracking-wide text-white/40">Já recebido (BRL)</div><div className="text-sm font-semibold text-[#4ade80]">{brl(previa.recebidoTotalBrl)}</div></div>
                  </div>

                  {previa.temPagamentoConfirmado && (
                    <div className="mb-3 flex items-start gap-2 rounded-lg border border-[#7dd3fc]/25 bg-[#7dd3fc]/10 p-3 text-xs text-[#7dd3fc]">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span>Existe pagamento confirmado. Os pagamentos NÃO serão alterados — só as cobranças em aberto seguem a estratégia escolhida.</span>
                    </div>
                  )}

                  {previa.cobrancasAfetadas.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] text-sm">
                        <thead><tr className="text-left text-[11px] uppercase tracking-wide text-white/40">
                          <th className="px-2 py-2 font-medium">Cobrança</th><th className="px-2 py-2 font-medium">Vencimento</th><th className="px-2 py-2 text-right font-medium">Valor atual</th><th className="px-2 py-2 text-right font-medium">Novo valor</th><th className="px-2 py-2 text-right font-medium">Novo BRL</th>
                        </tr></thead>
                        <tbody>
                          {previa.cobrancasAfetadas.map((c) => (
                            <tr key={c.parcelaId} className="border-t border-white/5">
                              <td className="px-2 py-2 text-white/80">Parcela {c.numero}</td>
                              <td className="px-2 py-2 text-white/60">{dataBR(c.vencimento)}</td>
                              <td className="px-2 py-2 text-right text-white/50">{money(c.valorBaseAntigo, previa.moedaBase)}</td>
                              <td className="px-2 py-2 text-right font-medium text-white">{money(c.valorBaseNovo, previa.moedaBase)}</td>
                              <td className="px-2 py-2 text-right text-[#7dd3fc]">{brl(c.valorBrlNovo)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-2 text-[11px] text-white/40">{previa.cobrancasAfetadas.length} cobrança(s) em aberto seriam ajustadas com a estratégia “Atualizar abertas”.</p>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 rounded-lg border border-white/10 bg-[#161b21] p-3 text-xs text-white/50">
                      <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#7dd3fc]" /><span>Sem cobranças em aberto para reescalar. A diferença é registrada como ajuste no razão (Ledger).</span>
                    </div>
                  )}

                  {previa.bloqueios.length > 0 && (
                    <div className="mt-3 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 p-3 text-xs text-[#f87171]">
                      <p className="mb-1 flex items-center gap-1.5 font-medium"><AlertTriangle className="h-3.5 w-3.5" /> Não é possível salvar:</p>
                      <ul className="list-inside list-disc space-y-0.5">{previa.bloqueios.map((b, i) => <li key={i}>{b}</li>)}</ul>
                    </div>
                  )}
                </section>
              )}
            </div>

            {/* sidebar */}
            <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
              <section className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
                <h2 className="mb-3 text-sm font-semibold text-white/80">Situação atual</h2>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between"><dt className="text-white/50">Código</dt><dd className="text-white">{rec.codigo ?? "—"}</dd></div>
                  <div className="flex justify-between"><dt className="text-white/50">Participantes</dt><dd className="text-white">{rec.participantes.length}</dd></div>
                  <div className="flex justify-between"><dt className="text-white/50">Valor contratado (BRL)</dt><dd className="text-white">{brl(rec.valorContratadoBrlTotal)}</dd></div>
                  <div className="flex justify-between"><dt className="text-white/50">Recebido (BRL)</dt><dd className="text-[#4ade80]">{brl(rec.recebidoTotalBrl)}</dd></div>
                  <div className="flex justify-between"><dt className="text-white/50">Cobranças abertas</dt><dd className="text-white">{rec.cobrancasAbertas}</dd></div>
                  <div className="flex items-center justify-between pt-1"><dt className="text-white/50">Pagamento confirmado</dt><dd><span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${rec.temPagamentoConfirmado ? "bg-[#7dd3fc]/15 text-[#7dd3fc]" : "bg-white/10 text-white/50"}`}>{rec.temPagamentoConfirmado ? "Sim" : "Não"}</span></dd></div>
                </dl>
              </section>

              {mudouFinanceiro && (
                <section className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
                  <h2 className="mb-2 text-sm font-semibold text-white/80">Estratégia de aplicação</h2>
                  <p className="mb-3 text-[11px] text-white/45">Como aplicar a mudança de valor/câmbio às cobranças em aberto.</p>
                  <div className="space-y-2">
                    {([["ATUALIZAR_ABERTAS", "Atualizar cobranças em aberto", "Reescala as parcelas pendentes ao novo valor."], ["AJUSTE_COMPENSATORIO", "Ajuste compensatório", "Preserva as parcelas e lança a diferença no razão."]] as const).map(([v, lb, desc]) => (
                      <label key={v} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 ${estrategia === v ? "border-[#2563eb]/50 bg-[#2563eb]/10" : "border-white/10"}`}>
                        <input type="radio" checked={estrategia === v} onChange={() => setEstrategia(v)} className="mt-0.5 accent-[#2563eb]" />
                        <div><div className="text-xs font-medium text-white">{lb}</div><div className="text-[11px] text-white/45">{desc}</div></div>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              <section className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
                <h2 className="mb-2 text-sm font-semibold text-white/80">Justificativa (auditoria)</h2>
                <textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value.slice(0, 300))} rows={3} placeholder="Motivo desta edição…" className="w-full resize-none rounded-lg border border-white/10 bg-[#20262e] px-3 py-2 text-sm text-white outline-none focus:border-[#2563eb]/60" />
                <p className="mt-2 text-[11px] text-white/40">Registrada em cada Receita afetada (estado anterior → novo).</p>
              </section>

              {erroSave && <div className="rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 p-3 text-xs text-[#f87171]">{erroSave}</div>}
              {!temMudanca && <div className="rounded-lg border border-white/10 bg-[#161b21] p-3 text-xs text-white/50">Nenhuma alteração ainda. Edite um campo para habilitar o salvamento.</div>}
              {ok && <div className="rounded-lg border border-[#4ade80]/30 bg-[#4ade80]/10 p-3 text-xs text-[#4ade80]">Receita atualizada.</div>}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  ), document.body)
}
