// src/components/kanban/TarefaTransversalModal.tsx
// Modal DISCRETO p/ criar uma Tarefa Transversal: ação antecipada de OUTRA fase para
// resolver a necessidade atual, sem avançar o processo. Ação = catálogo (sem texto livre).
"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, ArrowLeftRight, X } from "lucide-react"

const authHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") : ""}`,
})

interface Acao { stepKey: string; title: string }
interface FaseAcoes { faseCode: string; faseLabel: string; acoes: Acao[] }

interface Props {
  processoId: number
  necessidadeId: number
  necessidadeLabel?: string
  pessoaId?: number | null
  faseAtivaCode?: string | null
  usuarios?: Array<{ id: number; nome: string }>
  onClose: () => void
  onCreated: () => void
}

export function TarefaTransversalModal({ processoId, necessidadeId, necessidadeLabel, pessoaId, faseAtivaCode, usuarios, onClose, onCreated }: Props) {
  const [fases, setFases] = useState<FaseAcoes[]>([])
  const [faseRef, setFaseRef] = useState<string>("")
  const [acaoStepKey, setAcaoStepKey] = useState<string>("")
  const [motivo, setMotivo] = useState("")
  const [resultadoEsperado, setResultadoEsperado] = useState("")
  const [responsavelId, setResponsavelId] = useState<string>("")
  const [prazo, setPrazo] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/tarefas-transversais/acoes", { headers: authHeaders() })
      .then((r) => r.json())
      .then((j) => {
        // não oferece a própria fase ativa como "referência" (é antecipar de OUTRA fase)
        const lista = (j.fases ?? []).filter((f: FaseAcoes) => f.faseCode !== faseAtivaCode)
        setFases(lista)
      })
      .catch(() => setErro("Não foi possível carregar as ações de catálogo."))
  }, [faseAtivaCode])

  const acoesDaFase = fases.find((f) => f.faseCode === faseRef)?.acoes ?? []

  const criar = useCallback(async () => {
    if (!faseRef || !acaoStepKey) { setErro("Selecione a fase de referência e a ação."); return }
    setEnviando(true); setErro(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/tarefas-transversais`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({
          necessidadeOrigemId: necessidadeId, faseReferenciaCode: faseRef, acaoStepKey,
          pessoaId: pessoaId ?? undefined, motivo: motivo.trim() || undefined,
          resultadoEsperado: resultadoEsperado.trim() || undefined,
          responsavelId: responsavelId ? Number(responsavelId) : undefined,
          prazo: prazo || undefined,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(j?.error || `Falha (HTTP ${res.status}).`); return }
      onCreated()
    } catch { setErro("Falha de rede ao criar a tarefa transversal.") }
    finally { setEnviando(false) }
  }, [processoId, necessidadeId, faseRef, acaoStepKey, pessoaId, motivo, resultadoEsperado, responsavelId, prazo, onCreated])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => !enviando && onClose()}>
      <div className="max-w-lg w-full rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
          <h3 className="text-[15px] font-extrabold text-gray-900 flex items-center gap-2"><ArrowLeftRight className="w-4 h-4 text-gray-500" /> Criar tarefa transversal</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-4.5 h-4.5" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-[12px] text-gray-500 leading-relaxed">Ação antecipada de outra fase para resolver esta necessidade — <b>sem avançar o processo</b>.</p>
          {necessidadeLabel && (
            <div className="text-[12.5px]"><span className="text-gray-400">Necessidade:</span> <span className="font-semibold text-gray-800">{necessidadeLabel}</span></div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Fase de referência</span>
              <select value={faseRef} onChange={(e) => { setFaseRef(e.target.value); setAcaoStepKey("") }} className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 bg-white focus:outline-none focus:border-blue-400">
                <option value="">Selecionar…</option>
                {fases.map((f) => <option key={f.faseCode} value={f.faseCode}>{f.faseLabel}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Ação antecipada</span>
              <select value={acaoStepKey} onChange={(e) => setAcaoStepKey(e.target.value)} disabled={!faseRef} className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 bg-white focus:outline-none focus:border-blue-400 disabled:bg-gray-50">
                <option value="">Selecionar…</option>
                {acoesDaFase.map((a) => <option key={a.stepKey} value={a.stepKey}>{a.title}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Motivo da antecipação</span>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Ex.: obter os dados do registro de nascimento pela certidão de casamento" className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 focus:outline-none focus:border-blue-400" />
          </label>
          <label className="block">
            <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Resultado esperado</span>
            <input value={resultadoEsperado} onChange={(e) => setResultadoEsperado(e.target.value)} placeholder="O que se espera obter" className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 focus:outline-none focus:border-blue-400" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Responsável</span>
              <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 bg-white focus:outline-none focus:border-blue-400">
                <option value="">—</option>
                {(usuarios ?? []).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Prazo</span>
              <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 focus:outline-none focus:border-blue-400" />
            </label>
          </div>
          {erro && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[12.5px] text-red-700">{erro}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button disabled={enviando} onClick={onClose} className="px-3.5 py-2 text-[12.5px] font-semibold rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 disabled:opacity-50">Cancelar</button>
          <button disabled={enviando || !faseRef || !acaoStepKey} onClick={() => void criar()} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[12.5px] font-bold rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">
            {enviando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowLeftRight className="w-3.5 h-3.5" />} Criar tarefa transversal
          </button>
        </div>
      </div>
    </div>
  )
}
