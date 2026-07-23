// src/components/financeiro/v3/ProcessoFinanceiroShell.tsx
// ============================================================================
// FINANCEIRO DO PROCESSO — shell único (dentro do processo). Subtabs: Visão
// Geral / Receitas / Custos / Extrato / Timeline. Consome o backend financeiro
// já existente, filtrado pelo processo aberto. Sem módulo global, sem termos
// técnicos na interface.
// ============================================================================
"use client"

import { useEffect, useMemo, useState } from "react"
import { ReceitasTab } from "./ReceitasTab"
import { VisaoGeral } from "@/src/components/financeiro/subabas/VisaoGeral"
import { FileText, X } from "lucide-react"

const fmt = (v: number, m = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency: m }).format(v || 0)
const dataBR = (s?: string | null) => s ? new Date(s).toLocaleDateString("pt-BR") : "—"
const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }
const SUBTABS: [string, string][] = [["visao", "Visão Geral"], ["receitas", "Receitas"], ["custos", "Custos"], ["extrato", "Extrato"], ["timeline", "Timeline"]]

export function ProcessoFinanceiroShell({ processoId }: { processoId: number }) {
  const [t, setT] = useState("visao")
  const [fxEur, setFxEur] = useState(5.5)
  useEffect(() => { fetch("/api/cambio").then((r) => r.json()).then((d) => setFxEur(Number(d?.eur) || 5.5)).catch(() => {}) }, [])
  return (
    <div className="text-neutral-200">
      <div className="mb-5 flex flex-wrap gap-6 border-b border-neutral-800">
        {SUBTABS.map(([id, label]) => (
          <button key={id} onClick={() => setT(id)} className={`-mb-px border-b-2 px-1 pb-3 pt-1 text-sm ${t === id ? "border-amber-400 font-medium text-amber-400" : "border-transparent text-neutral-400 hover:text-neutral-200"}`}>{label}</button>
        ))}
      </div>
      {t === "visao" && <VisaoGeral processoId={processoId} fxHoje={fxEur} onIrPara={(a) => setT(a)} />}
      {t === "receitas" && <ReceitasTab processoId={processoId} />}
      {t === "custos" && <CustosTab processoId={processoId} />}
      {t === "extrato" && <Movimentacoes processoId={processoId} modo="extrato" />}
      {t === "timeline" && <Movimentacoes processoId={processoId} modo="timeline" />}
    </div>
  )
}

// Custos — lista do processo (obrigações de natureza CUSTO).
function CustosTab({ processoId }: { processoId: number }) {
  const [obrs, setObrs] = useState<any[] | null>(null)
  const [novo, setNovo] = useState(false)
  const carregar = () => { fetch(`/api/financeiro/v3/obrigacoes?processoId=${processoId}&natureza=CUSTO`, { headers: authHeaders() }).then((r) => r.json()).then((j) => setObrs(j.obrigacoes ?? [])).catch(() => setObrs([])) }
  useEffect(() => { carregar() }, [processoId])
  if (!obrs) return <div className="py-8 text-sm text-neutral-500">carregando…</div>
  const totais = { contratado: obrs.reduce((s, o) => s + o.valorContratado, 0), saldo: obrs.reduce((s, o) => s + o.saldo, 0), pago: obrs.reduce((s, o) => s + o.recebido, 0) }
  return (
    <div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[["Total contratado", fmt(totais.contratado)], ["Pago", fmt(totais.pago)], ["Saldo a pagar", fmt(totais.saldo)], ["Custos", String(obrs.length)]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-neutral-800 bg-[#0f1114] p-4"><div className="text-xs text-neutral-400">{k}</div><div className="mt-1 text-xl font-bold text-white">{v}</div></div>
        ))}
      </div>
      <div className="mt-5 rounded-xl border border-neutral-800 bg-[#0f1114]">
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3"><span className="text-sm font-medium text-amber-400">Custos ({obrs.length})</span><button onClick={() => setNovo(true)} className="rounded-lg bg-amber-500/90 px-3.5 py-2 text-sm font-medium text-neutral-950 hover:bg-amber-400">+ Novo Custo</button></div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-neutral-500">{["Custo", "Valor contratado", "Pago", "Saldo", "Vencimento", "Status", "Ações"].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{obrs.map((o) => (
            <tr key={o.obrigacaoId} className="border-t border-neutral-800/60"><td className="px-5 py-4 text-neutral-100"><div>{o.descricao ?? o.codigoOperacional ?? `#${o.obrigacaoId}`}</div>{o.codigoOperacional && <div className="text-xs text-neutral-500">{o.codigoOperacional}</div>}</td><td className="px-5">{fmt(o.valorContratado, o.moeda)}</td><td className="px-5 text-emerald-400">{fmt(o.recebido, o.moeda)}</td><td className="px-5 text-sky-400">{fmt(o.saldo, o.moeda)}</td><td className="px-5 text-neutral-300">—</td><td className="px-5"><span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-400">{o.status}</span></td><td className="px-5 text-neutral-500">⋮</td></tr>
          ))}{obrs.length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-neutral-500">Nenhum custo neste processo.</td></tr>}</tbody>
        </table>
      </div>
      {novo && <NovoCustoModal processoId={processoId} onClose={() => setNovo(false)} onCriado={() => { setNovo(false); carregar() }} />}
    </div>
  )
}

// Modal de lançamento manual de Custo — item vem do Catálogo Mestre (Gerenciamento).
function NovoCustoModal({ processoId, onClose, onCriado }: { processoId: number; onClose: () => void; onCriado: () => void }) {
  const [itens, setItens] = useState<any[] | null>(null)
  const [itemId, setItemId] = useState<string>("")
  const [descricao, setDescricao] = useState("")
  const [valor, setValor] = useState("")
  const [moeda, setMoeda] = useState("BRL")
  const [vencimento, setVencimento] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => { fetch(`/api/financeiro/v3/itens-catalogo`, { headers: authHeaders() }).then((r) => r.json()).then((j) => setItens(j.itens ?? [])).catch(() => setItens([])) }, [])

  async function salvar() {
    setErro(null)
    const v = Number(String(valor).replace(",", "."))
    if (!itemId) { setErro("Selecione um item do Catálogo Mestre."); return }
    if (!isFinite(v) || v <= 0) { setErro("Informe um valor maior que zero."); return }
    setSalvando(true)
    try {
      const res = await fetch(`/api/financeiro/v3/custos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ processoId, itemCatalogoId: Number(itemId), descricao: descricao.trim() || undefined, valor: v, moeda, vencimento: vencimento || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) { setErro(j?.erro || j?.motivo || `Falha ao salvar (HTTP ${res.status}).`); return }
      onCriado()
    } catch {
      setErro("Erro de conexão ao salvar.")
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-[#0f1114] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-base font-semibold text-white">Novo Custo</h3><button onClick={onClose} className="text-neutral-500 hover:text-neutral-300"><X className="h-4 w-4" /></button></div>
        <div className="mt-4 space-y-3">
          <label className="block text-xs text-neutral-400">Item (Catálogo Mestre)
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-800 bg-[#0a0b0d] px-3 py-2 text-sm text-neutral-100 outline-none">
              <option value="">{itens == null ? "carregando…" : "Selecione um item…"}</option>
              {(itens ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}{i.categoria ? ` · ${i.categoria}` : ""}</option>)}
            </select>
          </label>
          <label className="block text-xs text-neutral-400">Descrição (opcional)
            <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Padrão: nome do item" className="mt-1 w-full rounded-lg border border-neutral-800 bg-[#0a0b0d] px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600" />
          </label>
          <div className="flex gap-3">
            <label className="block flex-1 text-xs text-neutral-400">Valor
              <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" className="mt-1 w-full rounded-lg border border-neutral-800 bg-[#0a0b0d] px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600" />
            </label>
            <label className="block w-28 text-xs text-neutral-400">Moeda
              <select value={moeda} onChange={(e) => setMoeda(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-800 bg-[#0a0b0d] px-3 py-2 text-sm text-neutral-100 outline-none">
                {["BRL", "EUR", "USD"].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-xs text-neutral-400">Vencimento (opcional)
            <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-800 bg-[#0a0b0d] px-3 py-2 text-sm text-neutral-100 outline-none" />
          </label>
          {erro && <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">{erro}</div>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-neutral-700 bg-neutral-900 px-3.5 py-2 text-sm text-neutral-300 hover:border-neutral-600">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="rounded-lg bg-amber-500/90 px-3.5 py-2 text-sm font-medium text-neutral-950 hover:bg-amber-400 disabled:opacity-50">{salvando ? "Salvando…" : "Lançar custo"}</button>
        </div>
      </div>
    </div>
  )
}

// Extrato / Timeline — movimentações do processo (todas as ocorrências do Ledger).
function Movimentacoes({ processoId, modo }: { processoId: number; modo: "extrato" | "timeline" }) {
  const [pos, setPos] = useState<any>(null)
  useEffect(() => { fetch(`/api/financeiro/v3/processo/${processoId}`, { headers: authHeaders() }).then((r) => r.json()).then((j) => setPos(j.posicao)).catch(() => setPos({ obrigacoes: [] })) }, [processoId])
  const eventos = useMemo(() => {
    const out: any[] = []
    for (const o of pos?.obrigacoes ?? []) for (const t of o.timeline ?? []) out.push({ ...t, obrigacao: o.codigoOperacional })
    return out.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
  }, [pos])
  if (!pos) return <div className="py-8 text-sm text-neutral-500">carregando…</div>
  const ENTRADA = new Set(["PAGAMENTO", "PAGAMENTO_PARCIAL", "JUROS", "MULTA"])
  return (
    <div className="rounded-xl border border-neutral-800 bg-[#0f1114] p-5">
      <div className="mb-3 text-sm font-semibold text-neutral-200">{modo === "extrato" ? "Extrato do processo" : "Timeline financeira"}</div>
      {eventos.length === 0 ? <div className="text-sm text-neutral-500">Sem movimentações.</div> : modo === "extrato" ? (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-neutral-500">{["Data", "Descrição", "Origem", "Valor", "Status", ""].map((h) => <th key={h} className="py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>{eventos.map((e, i) => (
            <tr key={i} className="border-t border-neutral-800/60"><td className="py-2.5 text-neutral-300">{dataBR(e.data)}</td><td className="text-neutral-200">{e.tipo}</td><td className="text-neutral-400">{e.obrigacao ?? "—"}</td><td className={ENTRADA.has(e.tipo) ? "text-emerald-400" : "text-neutral-200"}>{ENTRADA.has(e.tipo) ? "+" : ""}{fmt(e.valor, e.moeda)}</td><td className="text-neutral-400">{e.status}</td><td>{e.comprovanteUrl && <a href={e.comprovanteUrl} target="_blank" rel="noreferrer" className="text-xs text-sky-400">comprovante</a>}</td></tr>
          ))}</tbody>
        </table>
      ) : (
        <div className="space-y-4">{eventos.map((e, i) => (
          <div key={i} className="flex gap-3">
            <div className="w-16 shrink-0 text-right text-[11px] text-neutral-500">{dataBR(e.data)}</div>
            <div className="flex flex-col items-center"><div className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-800 text-emerald-400"><FileText className="h-3.5 w-3.5" /></div>{i < eventos.length - 1 && <div className="mt-1 w-px flex-1 bg-neutral-800" />}</div>
            <div className="flex-1 pb-2"><div className="text-sm font-medium text-neutral-100">{e.tipo} <span className="text-xs text-neutral-500">· {e.obrigacao}</span></div><div className="text-sm text-neutral-400">{fmt(e.valor, e.moeda)}</div></div>
          </div>
        ))}</div>
      )}
    </div>
  )
}
