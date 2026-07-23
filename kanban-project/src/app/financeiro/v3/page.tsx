// src/app/financeiro/v3/page.tsx
// ============================================================================
// FINANCEIRO V3 — hub definitivo (Motor Financeiro V3). Telas derivadas do
// Ledger (fonte da verdade), atrás de feature flags. A posição detalhada, as
// ocorrências, os lançamentos extras e a timeline vivem em /financeiro/posicao-v3
// (linkados a partir de Obrigações). Legado permanece só como fallback.
// ============================================================================
"use client"

import { useCallback, useEffect, useState } from "react"
import { HeaderBar } from "@/src/components/header-bar"
import { Loader2, LayoutDashboard, ListChecks, Banknote, AlertTriangle, ScrollText, Scissors, ExternalLink } from "lucide-react"

const OURO = "#C6A15B"
const fmt = (v: number, m = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency: m }).format(v || 0)
const authHeaders = (extra?: Record<string, string>): Record<string, string> => {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return { ...(extra ?? {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}
const getJSON = async (url: string) => { const r = await fetch(url, { headers: authHeaders() }); return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) } }
const postJSON = async (url: string, body: unknown) => { const r = await fetch(url, { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body) }); return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) } }

type Aba = "visao" | "obrigacoes" | "conciliacao" | "divergencias" | "auditoria" | "corte"
const ABAS: { id: Aba; nome: string; icon: typeof LayoutDashboard; flag?: string }[] = [
  { id: "visao", nome: "Visão geral", icon: LayoutDashboard },
  { id: "obrigacoes", nome: "Obrigações", icon: ListChecks },
  { id: "conciliacao", nome: "Conciliação", icon: Banknote, flag: "conciliacao" },
  { id: "divergencias", nome: "Divergências", icon: AlertTriangle },
  { id: "auditoria", nome: "Auditoria", icon: ScrollText },
  { id: "corte", nome: "Data de corte", icon: Scissors, flag: "dataCorte" },
]

export default function FinanceiroV3Hub() {
  const [flags, setFlags] = useState<Record<string, boolean> | null>(null)
  const [aba, setAba] = useState<Aba>("visao")
  useEffect(() => { getJSON("/api/financeiro/v3/flags").then((r) => setFlags(r.data.flags ?? {})).catch(() => setFlags({})) }, [])

  const ligado = flags?.posicaoRead
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <HeaderBar title="Financeiro V3" subtitle="Motor Financeiro · Ledger" />
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-2 flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold" style={{ color: OURO }}>Financeiro V3</h1>
          <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-[11px] uppercase tracking-wider text-neutral-400">Ledger · fonte da verdade</span>
        </div>
        <p className="mb-6 text-sm text-neutral-400">Telas definitivas derivadas do Ledger. O financeiro legado permanece como fallback de leitura.</p>

        {flags && !ligado && (
          <div className="mb-6 rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-300">
            Financeiro V3 não habilitado para este ambiente/usuário — usando o financeiro legado como fallback.
          </div>
        )}

        <div className="mb-6 flex flex-wrap gap-1 border-b border-neutral-800">
          {ABAS.filter((a) => !a.flag || flags?.[a.flag]).map((a) => {
            const Icon = a.icon
            return (
              <button key={a.id} onClick={() => setAba(a.id)}
                className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm ${aba === a.id ? "text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-300"}`}
                style={aba === a.id ? { borderColor: OURO } : {}}>
                <Icon className="h-4 w-4" /> {a.nome}
              </button>
            )
          })}
        </div>

        {!ligado ? null : (
          <>
            {aba === "visao" && <VisaoGeral />}
            {aba === "obrigacoes" && <Obrigacoes />}
            {aba === "conciliacao" && <Conciliacao />}
            {aba === "divergencias" && <Divergencias />}
            {aba === "auditoria" && <Auditoria />}
            {aba === "corte" && <DataCorte />}
          </>
        )}
      </div>
    </div>
  )
}

function Card({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5"><div className="mb-3 text-sm font-semibold text-neutral-300">{titulo}</div>{children}</div>
}
function Carregando() { return <div className="flex items-center gap-2 py-8 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> carregando…</div> }

// ── Visão geral ──
function VisaoGeral() {
  const [r, setR] = useState<any>(null)
  useEffect(() => { getJSON("/api/financeiro/v3/resumo").then((x) => setR(x.data.resumo)) }, [])
  if (!r) return <Carregando />
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        {[["A receber (saldo)", fmt(r.aReceber.saldo)], ["Recebido", fmt(r.aReceber.recebido)], ["Contratado", fmt(r.aReceber.contratado)], ["Obrigações", String(r.obrigacoes)]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4"><div className="text-xs text-neutral-500">{k}</div><div className="mt-1 text-xl font-semibold" style={{ color: OURO }}>{v}</div></div>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card titulo="Por status">{Object.entries(r.porStatus).map(([k, v]) => <div key={k} className="flex justify-between py-0.5 text-sm"><span className="text-neutral-400">{k}</span><span>{String(v)}</span></div>)}</Card>
        <Card titulo="Por natureza">{Object.entries(r.porNatureza).map(([k, v]) => <div key={k} className="flex justify-between py-0.5 text-sm"><span className="text-neutral-400">{k}</span><span>{String(v)}</span></div>)}</Card>
        <Card titulo="Saúde do Ledger">
          <div className="flex justify-between py-0.5 text-sm"><span className="text-neutral-400">Divergências</span><span className={r.divergencias ? "text-red-400" : "text-emerald-400"}>{r.divergencias || "0 ✓"}</span></div>
          {Object.entries(r.conciliacao || {}).map(([k, v]) => <div key={k} className="flex justify-between py-0.5 text-sm"><span className="text-neutral-400">Extrato {k}</span><span>{String(v)}</span></div>)}
        </Card>
      </div>
    </div>
  )
}

// ── Obrigações ──
function Obrigacoes() {
  const [obrs, setObrs] = useState<any[] | null>(null)
  useEffect(() => { getJSON("/api/financeiro/v3/obrigacoes").then((x) => setObrs(x.data.obrigacoes ?? [])) }, [])
  if (!obrs) return <Carregando />
  return (
    <Card titulo={`Obrigações (${obrs.length})`}>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-2">Código</th><th className="pb-2">Natureza</th><th className="pb-2">Status</th><th className="pb-2">Processo</th><th className="pb-2">Contratado</th><th className="pb-2">Saldo</th><th className="pb-2"></th></tr></thead>
        <tbody>{obrs.map((o) => (
          <tr key={o.obrigacaoId} className="border-t border-neutral-800">
            <td className="py-2">{o.codigoOperacional ?? `#${o.obrigacaoId}`}{o.temAbertura && <span className="ml-1 text-[10px] text-emerald-500">◆corte</span>}</td>
            <td>{o.natureza}</td><td>{o.status}</td><td>{o.processoId ?? "—"}</td><td>{fmt(o.valorContratado, o.moeda)}</td>
            <td style={{ color: o.saldo <= 0.005 ? "#5FB878" : undefined }}>{fmt(o.saldo, o.moeda)}</td>
            <td>{o.codigoOperacional && <a href={`/financeiro/posicao-v3`} className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200">abrir <ExternalLink className="h-3 w-3" /></a>}</td>
          </tr>
        ))}{obrs.length === 0 && <tr><td colSpan={7} className="py-4 text-neutral-500">Nenhuma obrigação.</td></tr>}</tbody>
      </table>
    </Card>
  )
}

// ── Conciliação bancária ──
function Conciliacao() {
  const [d, setD] = useState<any>(null)
  const [linha, setLinha] = useState({ data: "", valorBruto: "", identificadorTransacao: "" })
  const [msg, setMsg] = useState<string | null>(null)
  const carregar = useCallback(() => getJSON("/api/financeiro/v3/conciliacao").then((x) => setD(x.data)), [])
  useEffect(() => { carregar() }, [carregar])
  const importar = async () => {
    setMsg(null)
    const r = await postJSON("/api/financeiro/v3/conciliacao", { importar: [{ data: linha.data || new Date().toISOString(), valorBruto: Number(linha.valorBruto), identificadorTransacao: linha.identificadorTransacao || null }], conciliar: true, aplicar: true })
    if (r.ok) { setMsg("Linha importada e conciliada."); setLinha({ data: "", valorBruto: "", identificadorTransacao: "" }); carregar() } else setMsg(r.data.erro || r.data.motivo || "Falha.")
  }
  if (!d) return <Carregando />
  return (
    <div className="space-y-4">
      <Card titulo="Importar linha de extrato + conciliar">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-neutral-400">Data<input type="date" value={linha.data} onChange={(e) => setLinha({ ...linha, data: e.target.value })} className="mt-1 block rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100" /></label>
          <label className="text-xs text-neutral-400">Valor bruto<input value={linha.valorBruto} onChange={(e) => setLinha({ ...linha, valorBruto: e.target.value })} inputMode="decimal" className="mt-1 block w-32 rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100" /></label>
          <label className="text-xs text-neutral-400">Identificador<input value={linha.identificadorTransacao} onChange={(e) => setLinha({ ...linha, identificadorTransacao: e.target.value })} className="mt-1 block w-40 rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100" /></label>
          <button onClick={importar} disabled={!linha.valorBruto} className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-40" style={{ backgroundColor: OURO }}>Importar</button>
        </div>
        {msg && <div className="mt-2 text-xs text-neutral-400">{msg}</div>}
        <div className="mt-3 flex gap-3 text-xs text-neutral-500">{Object.entries(d.resumo || {}).map(([k, v]) => <span key={k}>{k}: {String(v)}</span>)}</div>
      </Card>
      <Card titulo={`Extrato (${d.linhas?.length ?? 0})`}>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-2">Data</th><th className="pb-2">Líquido</th><th className="pb-2">Identificador</th><th className="pb-2">Status</th><th className="pb-2">Divergência</th></tr></thead>
          <tbody>{(d.linhas ?? []).map((l: any) => (
            <tr key={l.id} className="border-t border-neutral-800"><td className="py-2">{new Date(l.data).toLocaleDateString("pt-BR")}</td><td>{fmt(Number(l.valorLiquido), l.moeda)}</td><td className="text-neutral-400">{l.identificadorTransacao ?? "—"}</td>
              <td className={l.status === "CONCILIADO" ? "text-emerald-400" : l.status === "DIVERGENTE" ? "text-red-400" : "text-neutral-400"}>{l.status}</td><td className="text-xs text-neutral-500">{l.divergencia ?? "—"}</td></tr>
          ))}{(d.linhas ?? []).length === 0 && <tr><td colSpan={5} className="py-4 text-neutral-500">Sem linhas de extrato.</td></tr>}</tbody>
        </table>
      </Card>
    </div>
  )
}

// ── Divergências ──
function Divergencias() {
  const [d, setD] = useState<any[] | null>(null)
  useEffect(() => { getJSON("/api/financeiro/v3/divergencias").then((x) => setD(x.data.divergencias ?? [])) }, [])
  if (!d) return <Carregando />
  return (
    <Card titulo={`Divergências projeção × replay (${d.length})`}>
      {d.length === 0 ? <div className="flex items-center gap-2 text-sm text-emerald-400"><span>✓</span> Projeções consistentes com o Ledger — nenhuma divergência.</div> : (
        <table className="w-full text-sm"><thead><tr className="text-left text-xs text-neutral-500"><th className="pb-2">Obrigação</th><th className="pb-2">Projeção</th><th className="pb-2">Replay</th><th className="pb-2">Δ</th></tr></thead>
          <tbody>{d.map((x) => <tr key={x.obrigacaoId} className="border-t border-neutral-800"><td className="py-2">{x.codigoOperacional ?? `#${x.obrigacaoId}`}</td><td>{fmt(x.saldoProjecao)}</td><td>{fmt(x.saldoReplay)}</td><td className="text-red-400">{fmt(x.delta)}</td></tr>)}</tbody>
        </table>
      )}
    </Card>
  )
}

// ── Auditoria ──
function Auditoria() {
  const [d, setD] = useState<any[] | null>(null)
  useEffect(() => { getJSON("/api/financeiro/v3/auditoria").then((x) => setD(x.data.auditoria ?? [])) }, [])
  if (!d) return <Carregando />
  return (
    <Card titulo={`Auditoria financeira V3 (${d.length})`}>
      <div className="space-y-2">{d.map((l) => (
        <div key={l.id} className="border-b border-neutral-800 py-2 text-sm last:border-0">
          <span className="font-medium">{l.acao}</span> <span className="text-xs text-neutral-500">· {l.entidade} · {new Date(l.criadoEm).toLocaleString("pt-BR")} · usuário {l.usuarioId ?? "—"}</span>
          <div className="text-xs text-neutral-400">{l.descricao}</div>
        </div>
      ))}{d.length === 0 && <div className="text-sm text-neutral-500">Sem eventos de auditoria.</div>}</div>
    </Card>
  )
}

// ── Data de corte (admin) ──
function DataCorte() {
  const [estado, setEstado] = useState<any>(null)
  const [dataCorte, setDataCorte] = useState("")
  const [dry, setDry] = useState<any>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const carregar = useCallback(() => getJSON("/api/financeiro/v3/data-corte").then((x) => setEstado(x.data)), [])
  useEffect(() => { carregar() }, [carregar])
  const rodar = async (executar: boolean) => {
    setMsg(null)
    const body: any = { dataCorte }
    if (executar) { body.executar = true; body.confirmacao = "EXECUTAR CORTE" }
    const r = await postJSON("/api/financeiro/v3/data-corte", body)
    if (r.ok) { setDry(r.data.resumo); if (executar) { setMsg("Corte executado."); carregar() } } else setMsg(r.data.erro || r.data.motivo || "Falha.")
  }
  const rollback = async () => {
    setMsg(null)
    const r = await postJSON("/api/financeiro/v3/data-corte", { rollback: true, executar: true, confirmacao: "REVERTER CORTE" })
    if (r.ok) { setMsg(`Rollback: ${r.data.resumo.revertidas} revertida(s).`); carregar() } else setMsg(r.data.erro || "Falha.")
  }
  if (!estado) return <Carregando />
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-4 text-sm text-amber-200">
        Ação sensível (grava aberturas/estornos no Ledger). Rode em <b>dry-run</b> primeiro; a execução real exige confirmação. Rollback é estorno append-only (não apaga histórico).
      </div>
      <Card titulo="Estado das aberturas">
        <div className="flex gap-4 text-sm"><span>Total: {estado.totalAberturas}</span><span className="text-emerald-400">Ativas: {estado.ativas}</span><span className="text-neutral-500">Revertidas: {estado.revertidas}</span></div>
      </Card>
      <Card titulo="Aplicar data de corte">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-neutral-400">Data de corte<input type="date" value={dataCorte} onChange={(e) => setDataCorte(e.target.value)} className="mt-1 block rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100" /></label>
          <button onClick={() => rodar(false)} disabled={!dataCorte} className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:border-neutral-500 disabled:opacity-40">Dry-run</button>
          <button onClick={() => rodar(true)} disabled={!dataCorte || !dry} className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-40" style={{ backgroundColor: OURO }}>Executar (confirmado)</button>
          <button onClick={rollback} className="rounded-lg border border-red-800/60 px-4 py-2 text-sm text-red-300 hover:border-red-600">Rollback</button>
        </div>
        {msg && <div className="mt-2 text-xs text-neutral-300">{msg}</div>}
        {dry && (
          <div className="mt-4 rounded border border-neutral-800 bg-neutral-950 p-3 text-sm">
            <div className="mb-2 text-xs uppercase tracking-wider text-neutral-500">Prévia {dry.dryRun ? "(dry-run)" : "(executado)"}</div>
            <div className="flex flex-wrap gap-4 text-neutral-300"><span>Total: {dry.totalObrigacoes}</span><span>Aplicáveis: {dry.aplicaveis}</span><span>Aplicadas: {dry.aplicadas}</span><span>Saldo abertura: {fmt(dry.saldoTotalAbertura)}</span><span className={dry.divergencias.length ? "text-red-400" : "text-emerald-400"}>Divergências: {dry.divergencias.length}</span></div>
            <div className="mt-2 space-y-1">{dry.itens.filter((i: any) => i.acao !== "NENHUMA").map((i: any) => <div key={i.obrigacaoId} className="text-xs text-neutral-400">#{i.obrigacaoId} · {i.acao} · recebido {fmt(i.recebidoLegado)} → alvo {fmt(i.saldoAlvo)}</div>)}</div>
          </div>
        )}
      </Card>
    </div>
  )
}
