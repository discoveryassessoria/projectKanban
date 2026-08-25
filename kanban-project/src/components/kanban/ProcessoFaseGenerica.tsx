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
        <h2 className="text-lg font-bold text-white/95">Central Operacional · {fase.label}</h2>
        <p className="text-sm text-white/55">Conclua as etapas abaixo e avance o processo para a próxima fase.</p>
      </div>

      {resultado && <div className="bg-[#4ade80]/12 border border-[#4ade80]/30 rounded-lg px-4 py-3 text-sm text-[#4ade80] flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />{resultado}</div>}
      {erro && <div className="bg-[#f87171]/12 border border-[#f87171]/30 rounded-lg px-4 py-3 text-sm text-[#f87171]">{erro}</div>}

      <div className="rounded-xl border border-white/10 divide-y divide-white/10 overflow-hidden">
        {steps.map((s, i) => {
          const ok = done.has(s.stepKey)
          return (
            <button key={s.stepKey} onClick={() => toggle(s.stepKey)} disabled={!!resultado}
              className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-[#20262e] disabled:hover:bg-[var(--surface-popover)]">
              <span className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${ok ? "bg-[#4ade80] text-white" : "border-2 border-white/15 text-transparent"}`}>
                <Check className="w-4 h-4" />
              </span>
              <span>
                <span className={`block text-sm font-medium ${ok ? "text-white/40 line-through" : "text-white/95"}`}>{i + 1}. {s.title}</span>
                <span className="block text-xs text-white/55">{s.description}</span>
              </span>
            </button>
          )
        })}
      </div>

      {next ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-4">
          <div className="text-xs text-white/68">{todasFeitas ? "Tudo pronto — pode avançar." : `Marque as ${steps.length} etapas para concluir a fase.`}</div>
          <button onClick={concluir} disabled={!todasFeitas || salvando || !!resultado}
            className="px-4 py-2 text-sm font-semibold text-[#fff] bg-[var(--app-background)] hover:bg-[#20262e] rounded-md inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Concluir fase
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-[#4ade80]/30 bg-[#4ade80]/12 p-4 text-sm text-[#4ade80] flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Esta é a última fase do processo.</div>
      )}
    </div>
  )
}