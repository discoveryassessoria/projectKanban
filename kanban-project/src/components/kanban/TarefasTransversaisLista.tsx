// src/components/kanban/TarefasTransversaisLista.tsx
// Lista/gestão das Tarefas Transversais DENTRO do processo (Central Operacional):
// ver, concluir (com resultado) e cancelar — sem sair do processo.
"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, ArrowLeftRight, ChevronDown, ChevronRight, Check, X } from "lucide-react"

const authHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") : ""}`,
})

interface TransversalRow {
  id: number
  titulo: string
  statusTarefa: string
  faseReferenciaCode: string | null
  acaoStepKey: string | null
  necessidadeId: number | null
  motivo: string | null
  resultadoEsperado: string | null
  resultadoObtido: string | null
  dataPrazo: string | null
  responsavel?: { id: number; nome: string } | null
}

const STATUS_LABEL: Record<string, { txt: string; cls: string }> = {
  NAO_INICIADA: { txt: "Pendente", cls: "bg-gray-100 text-gray-600" },
  EM_ANDAMENTO: { txt: "Em andamento", cls: "bg-blue-100 text-blue-700" },
  AGUARDANDO_TERCEIRO: { txt: "Aguardando terceiro", cls: "bg-amber-100 text-amber-700" },
  CONCLUIDO_RECEBIDO: { txt: "Concluída", cls: "bg-green-100 text-green-700" },
  CANCELADA: { txt: "Cancelada", cls: "bg-gray-100 text-gray-400" },
}

export function TarefasTransversaisLista({ processoId, refreshKey, readOnly, onChanged }: { processoId: number; refreshKey?: number; readOnly?: boolean; onChanged?: () => void }) {
  const [rows, setRows] = useState<TransversalRow[]>([])
  const [aberto, setAberto] = useState(true)
  const [concluindo, setConcluindo] = useState<number | null>(null)
  const [resultado, setResultado] = useState("")
  const [busy, setBusy] = useState(false)

  const carregar = useCallback(() => {
    fetch(`/api/processos/${processoId}/tarefas-transversais`, { headers: authHeaders() })
      .then((r) => r.json()).then((j) => setRows(j.tarefas ?? [])).catch(() => {})
  }, [processoId])
  useEffect(() => { carregar() }, [carregar, refreshKey])

  const concluir = useCallback(async (id: number, resolveuNecessidade: boolean) => {
    setBusy(true)
    try {
      await fetch(`/api/tarefas-transversais/${id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ acao: "concluir", resultadoObtido: resultado.trim() || null, resolveuNecessidade }) })
      setConcluindo(null); setResultado(""); carregar(); onChanged?.()
    } finally { setBusy(false) }
  }, [resultado, carregar, onChanged])

  const cancelar = useCallback(async (id: number) => {
    setBusy(true)
    try { await fetch(`/api/tarefas-transversais/${id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ acao: "cancelar" }) }); carregar(); onChanged?.() }
    finally { setBusy(false) }
  }, [carregar, onChanged])

  if (rows.length === 0) return null
  const abertas = rows.filter((r) => !["CONCLUIDO_RECEBIDO", "CANCELADA"].includes(r.statusTarefa)).length

  return (
    <div className="mb-4 rounded-2xl border border-violet-200 bg-violet-50/40">
      <button onClick={() => setAberto((v) => !v)} className="w-full flex items-center justify-between px-4 py-3">
        <span className="flex items-center gap-2 text-[13px] font-extrabold text-violet-800">
          <ArrowLeftRight className="w-4 h-4" /> Tarefas transversais
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-200 text-violet-700">{rows.length}{abertas > 0 ? ` · ${abertas} aberta(s)` : ""}</span>
        </span>
        {aberto ? <ChevronDown className="w-4 h-4 text-violet-500" /> : <ChevronRight className="w-4 h-4 text-violet-500" />}
      </button>
      {aberto && (
        <div className="px-4 pb-3 space-y-2">
          {rows.map((t) => {
            const st = STATUS_LABEL[t.statusTarefa] ?? { txt: t.statusTarefa, cls: "bg-gray-100 text-gray-600" }
            const encerrada = ["CONCLUIDO_RECEBIDO", "CANCELADA"].includes(t.statusTarefa)
            return (
              <div key={t.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-gray-800">{t.titulo}</div>
                    <div className="text-[11.5px] text-gray-500 mt-0.5">
                      Ref: {t.faseReferenciaCode ?? "—"} · Ação: {t.acaoStepKey ?? "—"}{t.responsavel ? ` · ${t.responsavel.nome}` : ""}{t.dataPrazo ? ` · prazo ${new Date(t.dataPrazo).toLocaleDateString("pt-BR")}` : ""}
                    </div>
                    {t.resultadoEsperado && <div className="text-[11.5px] text-gray-400 mt-0.5">Esperado: {t.resultadoEsperado}</div>}
                    {t.resultadoObtido && <div className="text-[11.5px] text-gray-500 mt-0.5">Obtido: {t.resultadoObtido}</div>}
                  </div>
                  <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full uppercase whitespace-nowrap ${st.cls}`}>{st.txt}</span>
                </div>

                {!readOnly && !encerrada && (
                  concluindo === t.id ? (
                    <div className="mt-2 space-y-2">
                      <input value={resultado} onChange={(e) => setResultado(e.target.value)} placeholder="Resultado obtido (o que a ação trouxe)" className="w-full text-[12.5px] rounded-md border border-gray-200 px-2.5 py-1.5 focus:outline-none focus:border-blue-400" />
                      <div className="flex items-center gap-2">
                        <button disabled={busy} onClick={() => void concluir(t.id, true)} className="inline-flex items-center gap-1 text-[12px] font-bold px-2.5 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-500 disabled:opacity-50"><Check className="w-3.5 h-3.5" /> Resolveu a necessidade</button>
                        <button disabled={busy} onClick={() => void concluir(t.id, false)} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">Concluir sem resolver</button>
                        <button disabled={busy} onClick={() => { setConcluindo(null); setResultado("") }} className="text-[12px] text-gray-400 hover:text-gray-600">cancelar</button>
                      </div>
                      <p className="text-[10.5px] text-gray-400">Resolveu → necessidade vira ATENDIDA e a fase reavalia (motores oficiais). Sem resolver → necessidade continua pendente.</p>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={() => { setConcluindo(t.id); setResultado("") }} className="text-[12px] font-semibold text-blue-600 hover:text-blue-800">Concluir</button>
                      <span className="text-gray-300">·</span>
                      <button onClick={() => void cancelar(t.id)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-gray-500 hover:text-red-600"><X className="w-3 h-3" /> Cancelar</button>
                    </div>
                  )
                )}
              </div>
            )
          })}
          {busy && <div className="flex items-center gap-2 text-[11.5px] text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> processando…</div>}
        </div>
      )}
    </div>
  )
}
