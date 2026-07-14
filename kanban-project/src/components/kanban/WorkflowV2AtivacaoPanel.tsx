// src/components/kanban/WorkflowV2AtivacaoPanel.tsx
// CP-4G — UI administrativa de ativação controlada do runtime v2 por processo.
// Mostra runtime atual, kill switch, pré-requisitos (critérios), dry-run e
// unresolvedCount. Botão de ativação só habilita quando TODOS os critérios passam
// (incl. kill switch ON). Exige justificativa. Não ativa automaticamente.
"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, ShieldCheck } from "lucide-react"
import { usePermissoes } from "@/src/hooks/use-permissoes"

interface Props { processoId: number }

interface Prep {
  faseAtual: string
  runtimeAtual: "legacy" | "v2"
  killSwitchGlobal: boolean
  unresolvedCount: number
  breakdown: Record<string, number>
  avaliacao: {
    criterios: Array<{ chave: string; ok: boolean; detalhe: string }>
    elegivel: boolean
    podeAtivarEfetivo: boolean
    bloqueios: string[]
  }
}

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return { "Content-Type": "application/json", Authorization: `Bearer ${t ?? ""}` }
}

export function WorkflowV2AtivacaoPanel({ processoId }: Props) {
  const { pode } = usePermissoes()
  const [prep, setPrep] = useState<Prep | null>(null)
  const [loading, setLoading] = useState(true)
  const [ativando, setAtivando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/processos/${processoId}/workflow-runtime`, { headers: authHeaders() })
      if (res.ok) setPrep(await res.json())
      else setPrep(null)
    } finally {
      setLoading(false)
    }
  }, [processoId])

  useEffect(() => {
    if (pode("workflow.ativarV2")) carregar()
    else setLoading(false)
    // `pode` fora das deps DE PROPÓSITO: sua identidade muda a cada render
    // (usePermissoes) e reincluí-la causava refetch em LOOP de /workflow-runtime
    // (que roda o backfill dry-run no servidor) → flicker. Reavalia por processoId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregar])

  const ativar = useCallback(async () => {
    const justificativa = window.prompt("Justificativa da ativação do runtime v2:")
    if (!justificativa) return
    setAtivando(true); setMsg(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/workflow-runtime`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify({ justificativa }),
      })
      const data = await res.json().catch(() => ({}))
      setMsg(`${res.status} — ${data.motivo ?? data.error ?? "ok"}`)
      await carregar()
    } finally {
      setAtivando(false)
    }
  }, [processoId, carregar])

  if (!pode("workflow.ativarV2")) return null
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Verificando pré-requisitos de ativação…
      </div>
    )
  }
  if (!prep) return null

  return (
    <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50/40 p-4 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-indigo-600" />
        <span className="font-semibold text-gray-800">Ativação controlada do runtime v2</span>
        <span className={`rounded px-2 py-0.5 text-xs ${prep.killSwitchGlobal ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"}`}>
          kill switch {prep.killSwitchGlobal ? "ON" : "OFF"}
        </span>
      </div>

      <div className="mb-2 text-xs text-gray-600">
        Runtime atual: <b>{prep.runtimeAtual}</b> · Fase: {prep.faseAtual || "—"} · unresolvedCount: <b>{prep.unresolvedCount}</b>
      </div>

      <ul className="mb-3 space-y-1">
        {prep.avaliacao.criterios.map((c) => (
          <li key={c.chave} className="flex items-center gap-2 text-xs">
            <span>{c.ok ? "✅" : "❌"}</span>
            <span className="text-gray-500">{c.chave}</span>
            <span className="text-gray-400">— {c.detalhe}</span>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <button
          onClick={ativar}
          disabled={!prep.avaliacao.podeAtivarEfetivo || ativando}
          className="rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          title={prep.avaliacao.podeAtivarEfetivo ? "Ativar runtime v2" : "Critérios não satisfeitos (ou kill switch OFF)"}
        >
          Ativar runtime v2
        </button>
        {ativando && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
        {msg && <span className="text-xs text-gray-500">{msg}</span>}
      </div>
      {!prep.avaliacao.podeAtivarEfetivo && (
        <div className="mt-2 text-xs text-gray-400">
          Ativação efetiva requer todos os critérios + kill switch ON. Bloqueios: {prep.avaliacao.bloqueios.join(", ") || "—"}.
        </div>
      )}
    </div>
  )
}
