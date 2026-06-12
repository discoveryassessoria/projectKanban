"use client"

import { useState } from "react"
import { Loader2, Check, ArrowRight, CheckCircle2 } from "lucide-react"
import { getFase, getNextFase } from "@/src/lib/process-stage/fases-catalog"
import type { FaseCode } from "@prisma/client"

interface Props {
  processoId: number
  faseCode: FaseCode
  onConcluido?: () => void
}

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("authToken")}` })

export function ProcessoFaseGenerica({ processoId, faseCode, onConcluido }: Props) {
  const fase = getFase(faseCode)
  const steps = fase.processSteps ?? []
  const next = getNextFase(faseCode)

  const [done, setDone] = useState<Set<string>>(new Set())
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<string | null>(null)

  const toggle = (k: string) => setDone((prev) => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n
  })
  const todasFeitas = steps.length > 0 && steps.every((s) => done.has(s.stepKey))

  const concluir = async () => {
    setSalvando(true); setErro(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/avancar-fase`, { method: "POST", headers: authHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erro ao avançar")
      const destino = getFase(data.proximaFase as FaseCode)?.label ?? data.proximaFase
      setResultado(`Fase concluída. Processo movido para ${destino}.`)
      onConcluido?.()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao avançar")
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Central Operacional · {fase.label}</h2>
        <p className="text-sm text-gray-500">Conclua as etapas abaixo e avance o processo para a próxima fase.</p>
      </div>

      {resultado && <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />{resultado}</div>}
      {erro && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{erro}</div>}

      <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
        {steps.map((s, i) => {
          const ok = done.has(s.stepKey)
          return (
            <button key={s.stepKey} onClick={() => toggle(s.stepKey)} disabled={!!resultado}
              className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 disabled:hover:bg-white">
              <span className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${ok ? "bg-green-500 text-white" : "border-2 border-gray-300 text-transparent"}`}>
                <Check className="w-4 h-4" />
              </span>
              <span>
                <span className={`block text-sm font-medium ${ok ? "text-gray-400 line-through" : "text-gray-900"}`}>{i + 1}. {s.title}</span>
                <span className="block text-xs text-gray-500">{s.description}</span>
              </span>
            </button>
          )
        })}
      </div>

      {next ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-600">{todasFeitas ? "Tudo pronto — pode avançar." : `Marque as ${steps.length} etapas para concluir a fase.`}</div>
          <button onClick={concluir} disabled={!todasFeitas || salvando || !!resultado}
            className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Concluir fase
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Esta é a última fase do processo.</div>
      )}
    </div>
  )
}