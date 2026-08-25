// src/components/kanban/RetornarFaseButton.tsx
//
// Ação "Retornar processo para esta fase" — usada no cabeçalho da Central em modo
// consulta (fase passada). Executa EXCLUSIVAMENTE o fluxo oficial de retorno
// (/api/processos/[id]/phase/return → PhaseAdvanceService.returnPhase): a fase passa a
// ser ATIVA (modo REOPENED), ações operacionais liberadas, dados reais editáveis,
// histórico/auditoria preservados. Nunca restaura snapshot.

"use client"

import { useState, useCallback } from "react"
import { Loader2, RotateCcw } from "lucide-react"

const authHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") : ""}`,
})

interface Props {
  processoId: number
  faseKey: string
  faseLabel: string
  onRetornou: () => void
}

export function RetornarFaseButton({ processoId, faseKey, faseLabel, onRetornou }: Props) {
  const [aberto, setAberto] = useState(false)
  const [justificativa, setJustificativa] = useState("")
  const [motivoCodigo, setMotivoCodigo] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const enviar = useCallback(async () => {
    if (!justificativa.trim() || !motivoCodigo.trim()) { setErro("Informe a justificativa e o código de motivo."); return }
    setEnviando(true); setErro(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/phase/return`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ faseAlvo: faseKey, justificativa: justificativa.trim(), motivoCodigo: motivoCodigo.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.success) {
        setErro(json?.message || json?.error || `Não foi possível retornar (HTTP ${res.status}).`)
        return
      }
      setAberto(false)
      onRetornou()
    } catch {
      setErro("Falha de rede ao retornar a fase.")
    } finally {
      setEnviando(false)
    }
  }, [processoId, faseKey, justificativa, motivoCodigo, onRetornou])

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-1.5 bg-[var(--app-background)] text-[#fff] text-[12.5px] font-bold px-3.5 py-2 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors"
      >
        <RotateCcw className="w-3.5 h-3.5" /> Retornar processo para esta fase
      </button>

      {aberto && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[var(--overlay-modal)] p-4" onClick={() => !enviando && setAberto(false)}>
          <div className="max-w-md w-full rounded-2xl bg-[var(--surface-popover)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <RotateCcw className="w-5 h-5 text-white/80" />
              <h3 className="text-[16px] font-extrabold text-white/95">Retornar processo para esta fase</h3>
            </div>
            <p className="text-[13px] text-white/68 leading-relaxed mb-4">
              O processo retornará para <b>{faseLabel}</b>, que voltará a ser a fase <b>ativa</b> (novo ciclo). As
              fases posteriores deixam de ser o caminho ativo, mas <b>todo o histórico é preservado</b>. Deseja continuar?
            </p>

            <label className="block text-[12px] font-semibold text-white/68 mb-1">Justificativa</label>
            <textarea
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              rows={3}
              className="w-full text-[13px] rounded-lg border border-[var(--border-default)] px-3 py-2 mb-3 focus:outline-none focus:border-blue-400"
              placeholder="Por que o processo precisa voltar a esta fase?"
            />
            <label className="block text-[12px] font-semibold text-white/68 mb-1">Código de motivo</label>
            <input
              value={motivoCodigo}
              onChange={(e) => setMotivoCodigo(e.target.value)}
              className="w-full text-[13px] rounded-lg border border-[var(--border-default)] px-3 py-2 mb-3 focus:outline-none focus:border-blue-400"
              placeholder="Ex.: DOC_NAO_LOCALIZADO"
            />

            {erro && <div className="bg-[#f87171]/12 border border-[#f87171]/30 rounded-lg px-3 py-2 text-[12.5px] text-[#f87171] mb-3">{erro}</div>}

            <div className="flex justify-end gap-2">
              <button disabled={enviando} onClick={() => setAberto(false)} className="px-3.5 py-2 text-[12.5px] font-semibold rounded-lg bg-[var(--surface-tertiary)] hover:bg-[var(--surface-tertiary)] text-white/95 disabled:opacity-50">Cancelar</button>
              <button disabled={enviando} onClick={() => void enviar()} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[12.5px] font-bold rounded-lg bg-[var(--app-background)] text-[#fff] hover:bg-[var(--surface-secondary)] disabled:opacity-50">
                {enviando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Confirmar retorno
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
