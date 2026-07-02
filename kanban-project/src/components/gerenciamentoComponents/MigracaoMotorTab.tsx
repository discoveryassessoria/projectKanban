"use client"

import { useEffect, useState, useCallback } from "react"

interface Tipo { id: number; name: string; countryLabel: string }
interface PaisStat { pais: string; total: number; conectados: number }

const PAIS_LABEL: Record<string, string> = { PORTUGAL: "Portugal", ESPANHA: "Espanha", ALEMANHA: "Alemanha", ITALIA: "Itália" }

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-white/60"
const opt = "bg-zinc-900"

export default function MigracaoMotorTab() {
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [conectados, setConectados] = useState(0)
  const [porPais, setPorPais] = useState<PaisStat[]>([])
  const [tipos, setTipos] = useState<Tipo[]>([])

  const [pais, setPais] = useState("all")
  const [tipoId, setTipoId] = useState<number | "">("")
  const [overwrite, setOverwrite] = useState(false)
  const [preview, setPreview] = useState<number | null>(null)

  const [confirmando, setConfirmando] = useState(false)
  const [confirmandoDesc, setConfirmandoDesc] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState("")
  const [erro, setErro] = useState("")

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 3500) }

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gerenciamento/migracao-motor", { headers: authHeaders() })
      if (res.ok) {
        const d = await res.json()
        setTotal(d.total || 0); setConectados(d.conectados || 0)
        setPorPais(d.porPais || []); setTipos(d.tipos || [])
      }
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // recalcula a prévia quando muda país/overwrite
  const calcPreview = useCallback(async (p: string, ow: boolean) => {
    const res = await fetch("/api/gerenciamento/migracao-motor", { method: "POST", headers: authHeaders(), body: JSON.stringify({ action: "preview", pais: p, overwrite: ow }) })
    if (res.ok) { const d = await res.json(); setPreview(d.count ?? null) }
  }, [])
  useEffect(() => { if (!loading) calcPreview(pais, overwrite) }, [pais, overwrite, loading, calcPreview])

  async function conectar() {
    if (tipoId === "") { setErro("Escolha um tipo de processo."); return }
    setBusy(true); setErro(""); setConfirmando(false)
    try {
      const res = await fetch("/api/gerenciamento/migracao-motor", { method: "POST", headers: authHeaders(), body: JSON.stringify({ action: "connect", pais, tipoProcessoId: tipoId, overwrite }) })
      const d = await res.json().catch(() => ({}))
      if (res.ok) { showFlash(`${d.count} processo(s) conectado(s).`); load(); calcPreview(pais, overwrite) }
      else setErro(d.error || "Erro ao conectar.")
    } finally { setBusy(false) }
  }

  async function desconectar() {
    setBusy(true); setErro(""); setConfirmandoDesc(false)
    try {
      const res = await fetch("/api/gerenciamento/migracao-motor", { method: "POST", headers: authHeaders(), body: JSON.stringify({ action: "disconnect", pais }) })
      const d = await res.json().catch(() => ({}))
      if (res.ok) { showFlash(`${d.count} processo(s) desconectado(s).`); load(); calcPreview(pais, overwrite) }
      else setErro(d.error || "Erro ao desconectar.")
    } finally { setBusy(false) }
  }

  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>

  const paisNome = pais === "all" ? "todos os países" : (PAIS_LABEL[pais] || pais)

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-green-400/20 bg-green-500/15 px-4 py-2.5 text-sm text-green-200">{flash}</div>}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
        <h2 className="text-lg font-semibold text-white">Conectar Processos ao Motor</h2>
        <p className="mt-1 text-sm text-white/60">Liga vários processos a um Tipo do motor de uma vez. Só preenche um campo — <span className="text-green-300/80">nada é apagado e dá pra desconectar.</span></p>

        {/* números atuais */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
            <div className="text-2xl font-bold text-white">{total}</div>
            <div className="text-xs text-white/50">processos</div>
          </div>
          <div className="rounded-xl border border-green-400/20 bg-green-500/10 p-3 text-center">
            <div className="text-2xl font-bold text-green-300">{conectados}</div>
            <div className="text-xs text-white/50">conectados</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
            <div className="text-2xl font-bold text-white/70">{total - conectados}</div>
            <div className="text-xs text-white/50">sem conexão</div>
          </div>
        </div>

        {/* por país */}
        <div className="mt-3 space-y-1">
          {porPais.filter(p => p.total > 0).map(p => (
            <div key={p.pais} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/5 px-3 py-1.5 text-sm">
              <span className="text-white/80">{PAIS_LABEL[p.pais] || p.pais}</span>
              <span className="text-white/50">{p.conectados} de {p.total} conectados</span>
            </div>
          ))}
        </div>
      </div>

      {/* ação de conectar */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>País</label>
            <select value={pais} onChange={e => { setPais(e.target.value); setConfirmando(false); setConfirmandoDesc(false) }} className={inputCls}>
              <option value="all" className={opt}>Todos os países</option>
              {Object.entries(PAIS_LABEL).map(([v, l]) => <option key={v} value={v} className={opt}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Conectar ao tipo</label>
            <select value={tipoId} onChange={e => setTipoId(e.target.value === "" ? "" : Number(e.target.value))} className={inputCls}>
              <option value="" className={opt}>— escolha —</option>
              {tipos.map(t => <option key={t.id} value={t.id} className={opt}>{t.name} ({t.countryLabel})</option>)}
            </select>
          </div>
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm text-white/70">
          <input type="checkbox" checked={overwrite} onChange={e => { setOverwrite(e.target.checked); setConfirmando(false) }} className="h-4 w-4 rounded border-white/20 bg-white/5" />
          Reconectar também os que já estão conectados (troca o tipo)
        </label>

        <div className="mt-3 rounded-lg border border-sky-400/20 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">
          Vai conectar <b>{preview ?? "…"}</b> processo(s) de <b>{paisNome}</b>.
        </div>

        {!confirmando ? (
          <button disabled={busy || tipoId === "" || (preview ?? 0) === 0} onClick={() => setConfirmando(true)} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">Conectar {preview ?? 0} processo(s)</button>
        ) : (
          <div className="mt-3 rounded-xl border border-blue-400/30 bg-blue-500/10 p-4">
            <div className="text-sm text-blue-100">Conectar <b>{preview}</b> processo(s) de <b>{paisNome}</b> ao tipo escolhido?</div>
            <div className="mt-3 flex gap-2">
              <button disabled={busy} onClick={conectar} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">{busy ? "Conectando…" : "Sim, conectar"}</button>
              <button disabled={busy} onClick={() => setConfirmando(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/5">Cancelar</button>
            </div>
          </div>
        )}

        {erro && <div className="mt-3 text-sm text-red-300">{erro}</div>}

        {/* desconectar */}
        <div className="mt-5 border-t border-white/10 pt-4">
          {!confirmandoDesc ? (
            <button onClick={() => setConfirmandoDesc(true)} className="text-xs text-white/40 underline hover:text-white/70">Desconectar todos de {paisNome}</button>
          ) : (
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
              <div className="text-sm text-amber-100">Desconectar <b>todos</b> os processos de <b>{paisNome}</b> do motor? (Não apaga nada, só desliga o vínculo.)</div>
              <div className="mt-3 flex gap-2">
                <button disabled={busy} onClick={desconectar} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50">{busy ? "Desconectando…" : "Sim, desconectar"}</button>
                <button disabled={busy} onClick={() => setConfirmandoDesc(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/5">Cancelar</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}