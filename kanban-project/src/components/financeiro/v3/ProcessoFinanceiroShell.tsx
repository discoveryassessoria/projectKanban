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
import { FileText } from "lucide-react"

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
  useEffect(() => { fetch(`/api/financeiro/v3/obrigacoes?processoId=${processoId}&natureza=CUSTO`, { headers: authHeaders() }).then((r) => r.json()).then((j) => setObrs(j.obrigacoes ?? [])).catch(() => setObrs([])) }, [processoId])
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
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3"><span className="text-sm font-medium text-amber-400">Custos ({obrs.length})</span><button className="rounded-lg bg-amber-500/90 px-3.5 py-2 text-sm font-medium text-neutral-950">+ Novo Custo</button></div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-neutral-500">{["Custo", "Valor contratado", "Pago", "Saldo", "Vencimento", "Status", "Ações"].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{obrs.map((o) => (
            <tr key={o.obrigacaoId} className="border-t border-neutral-800/60"><td className="px-5 py-4 text-neutral-100">{o.codigoOperacional ?? `#${o.obrigacaoId}`}</td><td className="px-5">{fmt(o.valorContratado, o.moeda)}</td><td className="px-5 text-emerald-400">{fmt(o.recebido, o.moeda)}</td><td className="px-5 text-sky-400">{fmt(o.saldo, o.moeda)}</td><td className="px-5 text-neutral-300">—</td><td className="px-5"><span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-400">{o.status}</span></td><td className="px-5 text-neutral-500">⋮</td></tr>
          ))}{obrs.length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-neutral-500">Nenhum custo neste processo.</td></tr>}</tbody>
        </table>
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
