// src/components/financeiro/lancamento-extra-form.tsx
// ============================================================================
// LANÇAMENTO FINANCEIRO EXTRA (Motor V3 · Fase 2) — formulário 100% pela UI.
// Cobre: natureza, valor/moeda, descrição, vencimento, vínculo fase/processo,
// seleção de requerentes, distribuição igual/percentual/valor/único, pagamento
// imediato ou cobrança futura, pagador requerente/externo, comprovante,
// observação e CONFIRMAÇÃO VISUAL da distribuição antes de salvar.
// ============================================================================
"use client"

import { useMemo, useState } from "react"
import { X, Plus, Trash2 } from "lucide-react"
import { authToken } from "@/src/lib/financeiro/http"
import { fmtMoeda as fmt } from "@/src/lib/financeiro/formato"

const OURO = 'var(--accent-primary)'
const OURO_TINTA = 'var(--accent-text)'
const NATUREZAS = ["RECEITA_EXTRA", "DESCONTO", "JUROS", "MULTA", "REEMBOLSO", "CREDITO", "AJUSTE"]
const MOEDAS = ["BRL", "EUR", "USD"]
const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

interface Req { pessoaId: string; percentual: string; valor: string }

// Prévia client-side da distribuição (espelha resolverDistribuicao: centavos na última cota).
function preverCotas(total: number, modo: string, reqs: Req[]): { pessoaId: string; valor: number }[] {
  const inc = reqs.filter((r) => r.pessoaId.trim())
  if (!inc.length || !(total > 0)) return []
  const totalCent = Math.round(cent(total) * 100)
  let base: number[] = []
  if (modo === "IGUAL") { const q = Math.floor(totalCent / inc.length); base = inc.map(() => q) }
  else if (modo === "PERCENTUAL") base = inc.map((r) => Math.round((totalCent * Number(r.percentual || 0)) / 100))
  else base = inc.map((r) => Math.round(cent(Number(r.valor || 0)) * 100)) // VALOR
  const soma = base.reduce((s, v) => s + v, 0)
  if (base.length) base[base.length - 1] += totalCent - soma // resíduo na última
  return inc.map((r, i) => ({ pessoaId: r.pessoaId, valor: base[i] / 100 }))
}

export function LancamentoExtraForm({ processoIdInicial, onClose, onDone }: { processoIdInicial?: number; onClose: () => void; onDone: () => void }) {
  const [natureza, setNatureza] = useState("RECEITA_EXTRA")
  const [valor, setValor] = useState("")
  const [moeda, setMoeda] = useState("BRL")
  const [descricao, setDescricao] = useState("")
  const [processoId, setProcessoId] = useState(processoIdInicial ? String(processoIdInicial) : "")
  const [faseId, setFaseId] = useState("")
  const [modo, setModo] = useState("IGUAL")
  const [reqs, setReqs] = useState<Req[]>([{ pessoaId: "", percentual: "", valor: "" }])
  const [imediato, setImediato] = useState(false)
  const [vencimento, setVencimento] = useState("")
  const [pagadorTipo, setPagadorTipo] = useState("REQUERENTE")
  const [pagadorPessoa, setPagadorPessoa] = useState("")
  const [pagadorExterno, setPagadorExterno] = useState("")
  const [comprovante, setComprovante] = useState("")
  const [observacao, setObservacao] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const total = cent(Number(valor))
  const cotas = useMemo(() => preverCotas(total, modo, reqs), [total, modo, reqs])
  const somaCotas = cent(cotas.reduce((s, c) => s + c.valor, 0))
  const distConfere = cotas.length === 0 || Math.abs(somaCotas - total) < 0.005

  const setReq = (i: number, patch: Partial<Req>) => setReqs((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const addReq = () => setReqs((rs) => [...rs, { pessoaId: "", percentual: "", valor: "" }])
  const delReq = (i: number) => setReqs((rs) => rs.filter((_, j) => j !== i))
  const atribuirUnico = () => { setModo("IGUAL"); setReqs((rs) => [rs[0] ?? { pessoaId: "", percentual: "", valor: "" }]) }

  const enviar = async () => {
    setSalvando(true); setErro(null)
    const participantes = reqs.filter((r) => r.pessoaId.trim()).map((r) => ({
      pessoaId: Number(r.pessoaId),
      ...(modo === "PERCENTUAL" ? { percentual: Number(r.percentual || 0) } : {}),
      ...(modo === "VALOR" ? { valor: cent(Number(r.valor || 0)) } : {}),
    }))
    const body: Record<string, unknown> = {
      natureza, valor: total, moeda, descricao: descricao || null,
      processoId: processoId ? Number(processoId) : null, faseId: faseId ? Number(faseId) : null,
      vencimento: !imediato && vencimento ? vencimento : null,
      distribuicao: participantes.length ? { modo, participantes } : null,
    }
    if (imediato) {
      body.pagamento = {
        pagador: pagadorTipo === "EXTERNO"
          ? { tipo: "EXTERNO", parteExterna: { nome: pagadorExterno || "Externo" } }
          : (pagadorPessoa ? { tipo: pagadorTipo, pessoaId: Number(pagadorPessoa) } : null),
        comprovanteUrl: comprovante || null,
        observacao: observacao || null,
      }
    }
    try {
      const t = authToken()
      const r = await fetch("/api/financeiro/v3/lancamentos-extras", { method: "POST", headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(body) })
      const d = await r.json()
      if (r.ok && d.ok) onDone()
      else setErro(d.erro || d.motivo || "Falha ao criar lançamento extra.")
    } catch { setErro("Falha de rede.") }
    finally { setSalvando(false) }
  }

  const inp = "mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
  const lbl = "block text-xs text-[var(--text-muted)]"

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--overlay-modal)] p-4">
      <div className="my-8 w-full max-w-2xl rounded-xl border border-neutral-700 bg-neutral-950 p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold" style={{ color: OURO_TINTA }}>Novo lançamento extra</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-[var(--text-muted)]"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={lbl}>Natureza
            <select value={natureza} onChange={(e) => setNatureza(e.target.value)} className={inp}>{NATUREZAS.map((n) => <option key={n}>{n}</option>)}</select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className={`${lbl} col-span-2`}>Valor
              <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" className={inp} placeholder="0,00" />
            </label>
            <label className={lbl}>Moeda
              <select value={moeda} onChange={(e) => setMoeda(e.target.value)} className={inp}>{MOEDAS.map((m) => <option key={m}>{m}</option>)}</select>
            </label>
          </div>
          <label className={`${lbl} sm:col-span-2`}>Descrição
            <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={inp} placeholder="Ex.: taxa consular adicional" />
          </label>
          <label className={lbl}>Processo (id)
            <input value={processoId} onChange={(e) => setProcessoId(e.target.value)} inputMode="numeric" className={inp} />
          </label>
          <label className={lbl}>Fase (id, opcional)
            <input value={faseId} onChange={(e) => setFaseId(e.target.value)} inputMode="numeric" className={inp} />
          </label>
        </div>

        {/* Requerentes + distribuição */}
        <div className="mt-5 rounded-lg border border-neutral-800 bg-[var(--surface-secondary)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--text-muted)]">Requerentes e distribuição</span>
            <div className="flex gap-2">
              <select value={modo} onChange={(e) => setModo(e.target.value)} className="rounded border border-neutral-700 bg-neutral-900 p-1.5 text-xs text-neutral-100">
                <option value="IGUAL">Igual</option><option value="PERCENTUAL">Percentual</option><option value="VALOR">Valor</option>
              </select>
              <button onClick={atribuirUnico} className="rounded border border-neutral-700 px-2 py-1 text-xs text-[var(--text-muted)] hover:border-neutral-500">Único requerente</button>
            </div>
          </div>
          {reqs.map((r, i) => (
            <div key={i} className="mb-2 flex items-center gap-2">
              <input value={r.pessoaId} onChange={(e) => setReq(i, { pessoaId: e.target.value })} inputMode="numeric" placeholder="pessoaId" className="w-28 rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100" />
              {modo === "PERCENTUAL" && <input value={r.percentual} onChange={(e) => setReq(i, { percentual: e.target.value })} inputMode="decimal" placeholder="%" className="w-20 rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100" />}
              {modo === "VALOR" && <input value={r.valor} onChange={(e) => setReq(i, { valor: e.target.value })} inputMode="decimal" placeholder="valor" className="w-28 rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100" />}
              <button onClick={() => delReq(i)} className="text-neutral-600 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <button onClick={addReq} className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-muted)]"><Plus className="h-3.5 w-3.5" /> adicionar requerente</button>

          {/* CONFIRMAÇÃO VISUAL DA DISTRIBUIÇÃO */}
          {cotas.length > 0 && (
            <div className="mt-4 rounded border border-neutral-800 bg-neutral-950 p-3">
              <div className="mb-2 text-xs uppercase tracking-wider text-neutral-500">Prévia da distribuição</div>
              {cotas.map((c) => (
                <div key={c.pessoaId} className="flex justify-between py-0.5 text-sm"><span className="text-[var(--text-muted)]">pessoa #{c.pessoaId}</span><span>{fmt(c.valor, moeda)}</span></div>
              ))}
              <div className={`mt-2 flex justify-between border-t border-neutral-800 pt-2 text-sm ${distConfere ? "text-green-700" : "text-red-700"}`}>
                <span>Soma das cotas</span><span>{fmt(somaCotas, moeda)} {distConfere ? "✓" : `≠ ${fmt(total, moeda)}`}</span>
              </div>
            </div>
          )}
        </div>

        {/* Pagamento imediato x cobrança futura */}
        <div className="mt-5 rounded-lg border border-neutral-800 bg-[var(--surface-secondary)] p-4">
          <div className="mb-3 flex gap-2">
            <button onClick={() => setImediato(false)} className={`rounded px-3 py-1.5 text-xs ${!imediato ? "text-neutral-950" : "border border-neutral-700 text-[var(--text-muted)]"}`} style={!imediato ? { backgroundColor: OURO } : {}}>Cobrança futura</button>
            <button onClick={() => setImediato(true)} className={`rounded px-3 py-1.5 text-xs ${imediato ? "text-neutral-950" : "border border-neutral-700 text-[var(--text-muted)]"}`} style={imediato ? { backgroundColor: OURO } : {}}>Pagamento imediato</button>
          </div>
          {!imediato ? (
            <label className={lbl}>Vencimento
              <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className={`${inp} max-w-xs`} />
            </label>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={lbl}>Pagador
                <select value={pagadorTipo} onChange={(e) => setPagadorTipo(e.target.value)} className={inp}>{["REQUERENTE", "EMPRESA", "TERCEIRO", "EXTERNO"].map((t) => <option key={t}>{t}</option>)}</select>
              </label>
              {pagadorTipo === "EXTERNO"
                ? <label className={lbl}>Nome do pagador externo<input value={pagadorExterno} onChange={(e) => setPagadorExterno(e.target.value)} className={inp} /></label>
                : <label className={lbl}>Pessoa pagadora (id)<input value={pagadorPessoa} onChange={(e) => setPagadorPessoa(e.target.value)} inputMode="numeric" className={inp} /></label>}
              <label className={`${lbl} sm:col-span-2`}>Comprovante (URL)
                <input value={comprovante} onChange={(e) => setComprovante(e.target.value)} className={inp} placeholder="https://…" />
              </label>
              <label className={`${lbl} sm:col-span-2`}>Observação
                <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} className={inp} rows={2} />
              </label>
            </div>
          )}
        </div>

        {erro && <div className="mt-4 text-sm text-red-700">{erro}</div>}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-[var(--text-muted)] hover:border-neutral-500">Cancelar</button>
          <button onClick={enviar} disabled={salvando || !(total > 0) || !distConfere} className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-40" style={{ backgroundColor: OURO }}>
            {salvando ? "Salvando…" : imediato ? "Criar e pagar" : "Criar cobrança"}
          </button>
        </div>
      </div>
    </div>
  )
}
