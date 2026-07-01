"use client"

import { useEffect, useState, useCallback, useMemo, Fragment } from "react"

interface Log {
  id: number; acao: string; entidade: string; entidadeId: number | null
  descricao: string; detalhes: unknown; usuarioId: number | null
  usuarioNome: string | null; criadoEm: string
}

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const opt = "bg-zinc-900"

function fmt(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

export default function LogAuditoriaTab() {
  const [logs, setLogs] = useState<Log[]>([])
  const [loading, setLoading] = useState(true)
  const [fEntidade, setFEntidade] = useState("")
  const [fAcao, setFAcao] = useState("")
  const [busca, setBusca] = useState("")
  const [aberto, setAberto] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/gerenciamento/auditoria", { headers: authHeaders() })
      if (res.ok) setLogs((await res.json()).logs || [])
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const entidades = useMemo(() => Array.from(new Set(logs.map(l => l.entidade))).sort(), [logs])
  const acoes = useMemo(() => Array.from(new Set(logs.map(l => l.acao))).sort(), [logs])

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return logs.filter(l =>
      (!fEntidade || l.entidade === fEntidade) &&
      (!fAcao || l.acao === fAcao) &&
      (!q || l.descricao.toLowerCase().includes(q) || (l.usuarioNome || "").toLowerCase().includes(q))
    )
  }, [logs, fEntidade, fAcao, busca])

  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Logs / Auditoria</h2>
            <p className="mt-1 text-sm text-white/60">Registro das ações no sistema. Mostrando os {logs.length} mais recentes.</p>
          </div>
          <button onClick={load} className="flex-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10">Atualizar</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <select value={fEntidade} onChange={e => setFEntidade(e.target.value)} className={inputCls}>
            <option value="" className={opt}>Todas as entidades</option>
            {entidades.map(x => <option key={x} value={x} className={opt}>{x}</option>)}
          </select>
          <select value={fAcao} onChange={e => setFAcao(e.target.value)} className={inputCls}>
            <option value="" className={opt}>Todas as ações</option>
            {acoes.map(x => <option key={x} value={x} className={opt}>{x}</option>)}
          </select>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar na descrição ou usuário…" className={`${inputCls} min-w-[220px] flex-1`} />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-white/10 text-left text-xs text-white/50">
            <tr><th className="px-4 py-3 font-medium">Data/hora</th><th className="px-4 py-3 font-medium">Ação</th><th className="px-4 py-3 font-medium">Entidade</th><th className="px-4 py-3 font-medium">Descrição</th><th className="px-4 py-3 font-medium">Usuário</th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-white/40">Nenhum log encontrado.</td></tr>
            ) : filtered.map(l => (
              <Fragment key={l.id}>
                <tr className={`border-b border-white/5 last:border-0 ${l.detalhes ? "cursor-pointer hover:bg-white/5" : ""}`} onClick={() => l.detalhes && setAberto(aberto === l.id ? null : l.id)}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-white/60">{fmt(l.criadoEm)}</td>
                  <td className="px-4 py-2.5"><span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">{l.acao}</span></td>
                  <td className="px-4 py-2.5 text-white/70">{l.entidade}{l.entidadeId != null && <span className="text-white/40"> #{l.entidadeId}</span>}</td>
                  <td className="px-4 py-2.5 text-white">{l.descricao}{l.detalhes ? <span className="ml-1 text-[10px] text-white/40">(detalhes)</span> : null}</td>
                  <td className="px-4 py-2.5 text-white/70">{l.usuarioNome || (l.usuarioId != null ? `#${l.usuarioId}` : "sistema")}</td>
                </tr>
                {aberto === l.id && l.detalhes != null && (
                  <tr className="border-b border-white/5 bg-black/20">
                    <td colSpan={5} className="px-4 py-3">
                      <pre className="max-h-64 overflow-auto rounded-lg bg-black/40 p-3 text-[11px] text-white/70">{JSON.stringify(l.detalhes, null, 2)}</pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}