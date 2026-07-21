"use client"

// src/components/kanban/TarefaTransversalModal.tsx
//
// TAREFA TRANSVERSAL (funcionalidade OFICIAL e SEPARADA da Operação Antecipada).
// Orquestra um OBJETIVO transversal referenciando uma OPERAÇÃO OFICIAL de outra
// fase (via faseReferenciaCode + acaoStepKey) para resolver uma NECESSIDADE do
// processo — SEM possuir workflow próprio. Não cria lançamento; não avança fase.
// Reutiliza as rotas oficiais: /api/tarefas-transversais/acoes e
// /api/processos/[id]/tarefas-transversais (POST).

import { useState, useEffect, useCallback } from "react"
import { Loader2, ArrowLeftRight, X } from "lucide-react"

const authHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") : ""}`,
})

interface NecOpt { id: number; label: string; pessoaId: number | null }
interface AcaoOpt { stepKey: string; title: string }
interface FaseAcoes { faseCode: string; faseLabel: string; acoes: AcaoOpt[] }

interface Props {
  processoId: number
  necessidadeId?: number | null
  necessidadeLabel?: string
  pessoaId?: number | null
  usuarios?: Array<{ id: number; nome: string; publicCode?: string | null }>
  onClose: () => void
  onCreated: () => void
}

export function TarefaTransversalModal({ processoId, necessidadeId, necessidadeLabel, pessoaId, usuarios, onClose, onCreated }: Props) {
  const [necessidades, setNecessidades] = useState<NecOpt[]>([])
  const [fases, setFases] = useState<FaseAcoes[]>([])
  const [necSel, setNecSel] = useState<string>(necessidadeId ? String(necessidadeId) : "")
  const [faseRef, setFaseRef] = useState<string>("")
  const [acaoStepKey, setAcaoStepKey] = useState<string>("")
  const [objetivo, setObjetivo] = useState("")
  const [resultadoEsperado, setResultadoEsperado] = useState("")
  const [responsavelId, setResponsavelId] = useState<string>("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Fases + ações oficiais elegíveis (catálogo). O front decide não oferecer a fase atual.
  useEffect(() => {
    fetch("/api/tarefas-transversais/acoes", { headers: authHeaders() })
      .then((r) => r.json())
      .then((j) => setFases((j.fases ?? []) as FaseAcoes[]))
      .catch(() => setErro("Não foi possível carregar as ações oficiais."))
  }, [])

  // Necessidades do processo (quando não veio pré-selecionada).
  useEffect(() => {
    if (necessidadeId) return
    fetch(`/api/processos/${processoId}/necessidades`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((j) => {
        const lista: NecOpt[] = (j.necessidades ?? [])
          .filter((n: { status: string }) => n.status !== "DISPENSADA")
          .map((n: { id: number; pessoaId: number | null; itemCatalogo?: { name?: string; code?: string }; status: string }) => ({
            id: n.id, pessoaId: n.pessoaId ?? null,
            label: `${n.itemCatalogo?.name ?? n.itemCatalogo?.code ?? "Necessidade"} #${n.id} · ${n.status}`,
          }))
        setNecessidades(lista)
      })
      .catch(() => {})
  }, [processoId, necessidadeId])

  const acoesDaFase = fases.find((f) => f.faseCode === faseRef)?.acoes ?? []
  const necIdFinal = necessidadeId ?? (necSel ? Number(necSel) : null)
  const pessoaIdFinal = pessoaId ?? necessidades.find((n) => String(n.id) === necSel)?.pessoaId ?? null

  const criar = useCallback(async () => {
    if (!necIdFinal) { setErro("Selecione a necessidade a atender."); return }
    if (!faseRef) { setErro("Selecione a fase da operação oficial referenciada."); return }
    if (!acaoStepKey) { setErro("Selecione a ação oficial referenciada."); return }
    setEnviando(true); setErro(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/tarefas-transversais`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({
          necessidadeOrigemId: necIdFinal,
          faseReferenciaCode: faseRef,
          acaoStepKey,
          pessoaId: pessoaIdFinal ?? undefined,
          motivo: objetivo.trim() || undefined,
          resultadoEsperado: resultadoEsperado.trim() || undefined,
          responsavelId: responsavelId ? Number(responsavelId) : undefined,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(j?.error || `Falha (HTTP ${res.status}).`); return }
      onCreated()
    } catch { setErro("Falha de rede ao criar a tarefa transversal.") }
    finally { setEnviando(false) }
  }, [processoId, necIdFinal, pessoaIdFinal, faseRef, acaoStepKey, objetivo, resultadoEsperado, responsavelId, onCreated])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => !enviando && onClose()}>
      <div className="max-w-lg w-full rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
          <h3 className="text-[15px] font-extrabold text-gray-900 flex items-center gap-2"><ArrowLeftRight className="w-4 h-4 text-amber-500" /> Nova tarefa transversal</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-4.5 h-4.5" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-[12px] text-gray-500 leading-relaxed">Orquestra um objetivo transversal referenciando uma <b>operação oficial</b> de outra fase — sem workflow próprio e sem avançar o processo.</p>

          {necessidadeId && necessidadeLabel ? (
            <div className="text-[12.5px]"><span className="text-gray-400">Necessidade:</span> <span className="font-semibold text-gray-800">{necessidadeLabel}</span></div>
          ) : (
            <label className="block">
              <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Necessidade a atender</span>
              <select value={necSel} onChange={(e) => setNecSel(e.target.value)} className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 bg-white focus:outline-none focus:border-amber-400">
                <option value="">— selecione —</option>
                {necessidades.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
            </label>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Fase da operação oficial</span>
              <select value={faseRef} onChange={(e) => { setFaseRef(e.target.value); setAcaoStepKey("") }} className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 bg-white focus:outline-none focus:border-amber-400">
                <option value="">— selecione —</option>
                {fases.map((f) => <option key={f.faseCode} value={f.faseCode}>{f.faseLabel}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Ação oficial referenciada</span>
              <select value={acaoStepKey} onChange={(e) => setAcaoStepKey(e.target.value)} disabled={!faseRef} className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 bg-white focus:outline-none focus:border-amber-400 disabled:opacity-50">
                <option value="">— selecione —</option>
                {acoesDaFase.map((a) => <option key={a.stepKey} value={a.stepKey}>{a.title}</option>)}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Objetivo</span>
            <input value={objetivo} onChange={(e) => setObjetivo(e.target.value)} placeholder="Ex.: antecipar tradução da certidão" className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 bg-white focus:outline-none focus:border-amber-400" />
          </label>
          <label className="block">
            <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Resultado esperado (opcional)</span>
            <input value={resultadoEsperado} onChange={(e) => setResultadoEsperado(e.target.value)} className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 bg-white focus:outline-none focus:border-amber-400" />
          </label>
          {usuarios && usuarios.length > 0 && (
            <label className="block">
              <span className="block text-[11.5px] font-semibold text-gray-600 mb-1">Responsável (opcional)</span>
              <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 bg-white focus:outline-none focus:border-amber-400">
                <option value="">— sem responsável —</option>
                {usuarios.map((u) => <option key={u.id} value={u.id}>{u.publicCode ? u.publicCode + " — " : ""}{u.nome}</option>)}
              </select>
            </label>
          )}

          {erro && <div className="text-[12px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{erro}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-4">
          <button onClick={onClose} disabled={enviando} className="text-[13px] font-semibold px-3.5 py-2 rounded-lg text-gray-600 hover:bg-gray-100">Cancelar</button>
          <button onClick={criar} disabled={enviando} className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60">
            {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowLeftRight className="w-4 h-4" />} Criar tarefa transversal
          </button>
        </div>
      </div>
    </div>
  )
}
