// src/components/kanban/WorkflowV2Panel.tsx
// CP-4G — UI MÍNIMA do runtime v2, integrada à Central Operacional existente
// (NÃO é uma segunda central). Somente leitura + ações canônicas (simular/avançar/
// forçar), respeitando permissões. Não altera fase na simulação. Mostra diagnóstico
// quando o runtime v2 está desligado.
"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { usePermissoes } from "@/src/hooks/use-permissoes"

interface Props {
  processoId: number
}

interface OperationalView {
  runtime: "legacy" | "v2"
  killSwitchGlobal: boolean
  faseAtual: string
  ciclo: number | null
  workflow: { instanceId: number | null; workflowVersion: number | null; macroVersion: number | null; status: string | null } | null
  passos: Array<{ id: number; stepKey: string; ordem: number; tipo: string; status: string; obrigatorio: boolean; responsavelId: number | null; prioridade: string | null; prazo: string | null; bloqueadoManual: boolean; necessidadeId: number | null; documentoId: number | null }>
  tarefas: Array<{ id: number; titulo: string; statusTarefa: string; responsavelId: number | null; prioridade: string; dataPrazo: string | null; stepInstanceId: number | null }>
  necessidades: Array<{ id: number; status: string; obrigatoriedade: string }>
  documentos: Array<{ id: number; tipo: string | null; status: string }>
  pendencias: { blocking: Array<{ code: string; message: string }>; warnings: Array<{ code: string; message: string }>; canAdvance: boolean; policy: string }
  versoes: { macro: number | null; interno: number | null }
  source: string
  warnings: string[]
}

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return { "Content-Type": "application/json", Authorization: `Bearer ${t ?? ""}` }
}

export function WorkflowV2Panel({ processoId }: Props) {
  const { pode } = usePermissoes()
  const [view, setView] = useState<OperationalView | null>(null)
  const [loading, setLoading] = useState(true)
  const [acao, setAcao] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/processos/${processoId}/operational-workflow`, { headers: authHeaders() })
      if (res.ok) setView(await res.json())
      else setView(null)
    } finally {
      setLoading(false)
    }
  }, [processoId])

  useEffect(() => { carregar() }, [carregar])

  const chamar = useCallback(async (path: string, body?: Record<string, unknown>) => {
    setAcao(path); setMsg(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/${path}`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify(body ?? {}),
      })
      const data = await res.json().catch(() => ({}))
      setMsg(`${res.status} — ${data.resultado ?? data.message ?? data.error ?? "ok"}`)
      await carregar()
    } finally {
      setAcao(null)
    }
  }, [processoId, carregar])

  const simular = () => chamar("advance/simulate")
  const avancar = () => chamar("advance")
  const forcar = () => {
    const justificativa = window.prompt("Justificativa do avanço forçado:")
    if (!justificativa) return
    const motivoCodigo = window.prompt("Código de motivo:") ?? ""
    chamar("advance/force", { justificativa, motivoCodigo })
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando runtime do workflow…
      </div>
    )
  }
  if (!view) return null

  const v2 = view.source === "v2"

  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-800">Runtime do Workflow</span>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${view.runtime === "v2" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
            {view.runtime.toUpperCase()}
          </span>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">source: {view.source}</span>
        </div>
        <button onClick={carregar} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
          <RefreshCw className="h-3 w-3" /> atualizar
        </button>
      </div>

      {!view.killSwitchGlobal && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠️ Runtime v2 desligado globalmente (kill switch OFF). Ações v2 não são efetivadas.
        </div>
      )}
      {view.warnings.map((w, i) => (
        <div key={i} className="mb-2 rounded border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600">{w}</div>
      ))}

      <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-gray-600 sm:grid-cols-4">
        <div><span className="text-gray-400">Fase:</span> {view.faseAtual || "—"}</div>
        <div><span className="text-gray-400">Ciclo:</span> {view.ciclo ?? "—"}</div>
        <div><span className="text-gray-400">Versão macro:</span> {view.versoes.macro ?? "—"}</div>
        <div><span className="text-gray-400">Versão interno:</span> {view.versoes.interno ?? "—"}</div>
      </div>

      {/* Passos */}
      {view.passos.length > 0 && (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-gray-400">
              <tr><th className="py-1">#</th><th>Passo</th><th>Tipo</th><th>Status</th><th>Obrig.</th></tr>
            </thead>
            <tbody>
              {view.passos.map((p) => (
                <tr key={p.id} className="border-t border-gray-100">
                  <td className="py-1">{p.ordem}</td>
                  <td>{p.stepKey}{p.bloqueadoManual && <span className="ml-1 text-red-500">🔒</span>}</td>
                  <td>{p.tipo}</td>
                  <td>{p.status}</td>
                  <td>{p.obrigatorio ? "sim" : "não"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tarefas vinculadas */}
      {view.tarefas.length > 0 && (
        <div className="mb-3 text-xs text-gray-600">
          <span className="text-gray-400">Tarefas:</span> {view.tarefas.length} — {view.tarefas.filter((t) => t.stepInstanceId != null).length} vinculadas a passo
        </div>
      )}

      {/* Pendências */}
      <div className="mb-3">
        <div className="text-xs font-medium text-gray-700">Pendências ({view.pendencias.policy})</div>
        {view.pendencias.blocking.length === 0 && view.pendencias.warnings.length === 0 && (
          <div className="text-xs text-green-600">Sem pendências.</div>
        )}
        {view.pendencias.blocking.map((b, i) => (
          <div key={`b${i}`} className="text-xs text-red-600">🔴 {b.code}: {b.message}</div>
        ))}
        {view.pendencias.warnings.map((w, i) => (
          <div key={`w${i}`} className="text-xs text-amber-600">🟡 {w.code}: {w.message}</div>
        ))}
      </div>

      {/* Ações canônicas */}
      <div className="flex flex-wrap items-center gap-2">
        {pode("workflow.avancar") && (
          <>
            <button onClick={simular} disabled={acao != null} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50">
              Simular avanço
            </button>
            <button onClick={avancar} disabled={acao != null || !v2} className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50">
              Avançar
            </button>
          </>
        )}
        {pode("workflow.forcarAvanco") && (
          <button onClick={forcar} disabled={acao != null || !v2} className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50">
            Forçar avanço
          </button>
        )}
        {acao && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
        {msg && <span className="text-xs text-gray-500">{msg}</span>}
      </div>
      {!v2 && (
        <div className="mt-2 text-xs text-gray-400">Avançar/forçar exigem runtime v2 efetivo (processo v2 + kill switch ON).</div>
      )}
    </div>
  )
}
