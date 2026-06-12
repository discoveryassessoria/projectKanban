// src/components/kanban/ProcessoAnalise.tsx
"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, Sparkles, CheckCircle2, AlertTriangle, ArrowRight, Check, X } from "lucide-react"

interface Divergencia {
  id: number
  pessoaNome: string
  geracao: number | null
  linhaReta: boolean
  documentoTitulo: string
  dataDocumento: string | null
  campo: string
  campoLabel: string
  valorArvore: string | null
  valorDocumento: string | null
  severidade: string
  sugestaoIA: string | null
  motivoIA?: string | null
  impacto?: string | null
  notas?: string | null
  status: string
}

interface Analise {
  id: number
  status: string
  currentStep: string
  documentosAnalisados: number
  camposComparados: number
  decisaoJuridica: string | null
  divergencias: Divergencia[]
}

interface Props {
  processoId: number
  onConcluido?: () => void
}

const DECISOES: Array<[string, string]> = [
  ["pendente", "Pendente"],
  ["aceita", "Aceitar variação"],
  ["ressalva", "Marcar ressalva"],
  ["apoio_solicitado", "Solicitar apoio"],
  ["retificacao", "Enviar para retificação"],
  ["ignorada", "Ignorar"],
]
const SEV_LABEL: Record<string, string> = { baixa: "Leve", media: "Média", critica: "Crítica" }
const SEV_STYLE: Record<string, string> = {
  baixa: "bg-amber-50 text-amber-700",
  media: "bg-orange-50 text-orange-700",
  critica: "bg-red-50 text-red-700",
}
const SEV_DOT: Record<string, string> = { baixa: "bg-amber-400", media: "bg-orange-500", critica: "bg-red-500" }

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("authToken")}` })
const ini = (nome: string) => {
  const p = nome.trim().split(/\s+/)
  return ((p[0]?.[0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase()
}

export function ProcessoAnalise({ processoId, onConcluido }: Props) {
  const [analise, setAnalise] = useState<Analise | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [concluding, setConcluding] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<string | null>(null)
  const [drawerDiv, setDrawerDiv] = useState<Divergencia | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/processos/${processoId}/analise`, { headers: authHeaders() })
      const data = await res.json()
      setAnalise(data.analise ?? null)
    } catch {
      setErro("Erro ao carregar a análise.")
    } finally {
      setLoading(false)
    }
  }, [processoId])

  useEffect(() => { carregar() }, [carregar])

  const rodar = async () => {
    setRunning(true); setErro(null); setResultado(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/analise`, { method: "POST", headers: authHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erro ao rodar análise")
      setAnalise(data.analise)
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao rodar análise")
    } finally {
      setRunning(false)
    }
  }

  const decidir = async (divId: number, decisao: string, notas?: string) => {
    setAnalise((prev) => prev ? { ...prev, divergencias: prev.divergencias.map((d) => d.id === divId ? { ...d, status: decisao, ...(notas !== undefined ? { notas } : {}) } : d) } : prev)
    try {
      const res = await fetch(`/api/processos/${processoId}/analise/divergencias/${divId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ decisao, ...(notas !== undefined ? { notas } : {}) }),
      })
      const data = await res.json()
      if (res.ok && data.analise) setAnalise(data.analise)
    } catch {
      carregar()
    }
  }

  const concluir = async () => {
    setConcluding(true); setErro(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/analise/concluir`, { method: "POST", headers: authHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erro ao concluir")
      const destino = data.proximaFase === "RETIFICACAO_REGISTROS" ? "Retificação de registros" : "Tradução juramentada"
      setResultado(`Análise concluída (${data.decisao === "com_retificacao" ? "com" : "sem"} retificação). Processo movido para ${destino}.`)
      onConcluido?.()
      carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao concluir")
    } finally {
      setConcluding(false)
    }
  }

  const divs = analise?.divergencias ?? []
  const pend = divs.filter((d) => d.status === "pendente" || d.status === "apoio_solicitado").length
  const crit = divs.filter((d) => d.severidade === "critica" && (d.status === "pendente" || d.status === "retificacao")).length
  const ress = divs.filter((d) => d.status === "ressalva").length
  const aprov = divs.filter((d) => d.status === "aceita" || d.status === "ignorada").length
  const podeConcluir = !!analise && pend === 0 && analise.status !== "concluida"

  const etapas: Array<{ label: string; st: "concluida" | "em_andamento" | "pendente" }> = [
    { label: "Documentos recebidos", st: analise ? "concluida" : "em_andamento" },
    { label: "Comparação IA", st: analise ? "concluida" : "pendente" },
    { label: "Revisão humana", st: !analise ? "pendente" : pend > 0 ? "em_andamento" : "concluida" },
    { label: "Decisão jurídica", st: analise?.status === "concluida" ? "concluida" : analise && pend === 0 ? "em_andamento" : "pendente" },
    { label: "Análise concluída", st: analise?.status === "concluida" ? "concluida" : "pendente" },
  ]

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Central Operacional · Análise Documental</h2>
        <p className="text-sm text-gray-500">Confira os documentos, detecte divergências e decida o próximo passo.</p>
      </div>

      {analise && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <Stat label="Documentos" value={analise.documentosAnalisados} />
            <Stat label="Campos comparados" value={analise.camposComparados} />
            <Stat label="Divergências" value={divs.length} />
            <Stat label="Críticas abertas" value={crit} danger={crit > 0} />
            <Stat label="Ressalvas" value={ress} />
            <Stat label="Aprovados" value={aprov} />
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
            {analise.status === "concluida" ? "Análise concluída" : "Em análise"}
          </span>
        </div>
      )}

      {analise && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-start">
            {etapas.map((e, i) => (
              <div key={e.label} className={`flex items-start ${i < etapas.length - 1 ? "flex-1" : ""}`}>
                <div className="flex flex-col items-center text-center w-[88px] shrink-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    e.st === "concluida" ? "bg-green-500 text-white"
                    : e.st === "em_andamento" ? "bg-indigo-600 text-white"
                    : "bg-gray-200 text-gray-500"}`}>
                    {e.st === "concluida" ? <Check className="w-4 h-4" /> : i + 1}
                  </div>
                  <div className="mt-1.5 text-[11px] font-medium text-gray-700 leading-tight">{e.label}</div>
                  <div className={`text-[10px] ${
                    e.st === "concluida" ? "text-green-600"
                    : e.st === "em_andamento" ? "text-indigo-600"
                    : "text-gray-400"}`}>
                    {e.st === "concluida" ? "Concluído" : e.st === "em_andamento" ? "Em andamento" : "Pendente"}
                  </div>
                </div>
                {i < etapas.length - 1 && (
                  <div className={`flex-1 h-0.5 mt-3.5 ${e.st === "concluida" ? "bg-green-400" : "bg-gray-200"}`} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0"><Sparkles className="w-5 h-5" /></div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900">Assistente de Divergências</div>
          <p className="text-xs text-gray-600 mt-0.5">Compara os dados da árvore com os dados das certidões e aponta possíveis divergências. A decisão final é sua.</p>
        </div>
        <button onClick={rodar} disabled={running} className="px-3 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md inline-flex items-center gap-2 disabled:opacity-50 flex-shrink-0">
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Rodar análise IA
        </button>
      </div>

      {erro && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{erro}</div>}
      {resultado && <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />{resultado}</div>}

      {!analise ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">A análise ainda não foi rodada. Clique em <b>Rodar análise IA</b>.</div>
      ) : divs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">Nenhuma divergência encontrada — o processo pode seguir sem retificação.</div>
      ) : (
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">Divergências encontradas</span>
            <span className="text-xs font-semibold text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">{divs.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50">
                  {["Pessoa","Documento","Campo","Valor na árvore","Valor no documento","Gravidade","Sugestão IA","Decisão"].map((h) => (
                    <th key={h} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
                  ))}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {divs.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50 align-top">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-gray-200 text-gray-600 text-[11px] font-bold flex items-center justify-center flex-shrink-0">{ini(d.pessoaNome)}</span>
                        <div className="min-w-0"><div className="font-semibold text-gray-900">{d.pessoaNome}</div><div className="text-[11px] text-gray-500">{d.geracao != null ? `G${d.geracao}` : "—"} · {d.linhaReta ? "Linha reta" : "Apoio"}</div></div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><div className="font-medium text-gray-900">{d.documentoTitulo}</div><div className="text-[11px] text-gray-500">{d.dataDocumento ? `Recebido em ${d.dataDocumento}` : "—"}</div></td>
                    <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{d.campoLabel}</td>
                    <td className="px-3 py-2.5 text-gray-900">{d.valorArvore || "—"}</td>
                    <td className="px-3 py-2.5 text-gray-900">{d.valorDocumento || "—"}</td>
                    <td className="px-3 py-2.5"><span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${SEV_STYLE[d.severidade] || "bg-gray-100 text-gray-700"}`}><span className={`w-1.5 h-1.5 rounded-full ${SEV_DOT[d.severidade] || "bg-gray-400"}`} />{SEV_LABEL[d.severidade] || d.severidade}</span></td>
                    <td className="px-3 py-2.5 text-xs text-gray-600 max-w-[200px]">{d.sugestaoIA || "—"}</td>
                    <td className="px-3 py-2.5">
                      <select value={d.status} onChange={(e) => decidir(d.id, e.target.value)} className={`text-xs border rounded-md px-2 py-1.5 bg-white focus:outline-none ${d.status === "retificacao" ? "border-red-300 text-red-700" : d.status === "aceita" ? "border-green-300 text-green-700" : d.status === "pendente" ? "border-gray-200 text-gray-600" : "border-amber-300 text-amber-700"}`}>
                        {DECISOES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button onClick={() => setDrawerDiv(d)} className="text-gray-400 hover:text-indigo-600 p-1" title="Ver detalhes"><ArrowRight className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {analise && analise.status !== "concluida" && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-600">
            {pend > 0
              ? <span className="inline-flex items-center gap-1.5 text-amber-700"><AlertTriangle className="w-4 h-4" />Faltam {pend} decisão(ões) antes de concluir.</span>
              : <>O destino depende das decisões: alguma marcada <b>“Enviar para retificação”</b> → Retificação; nenhuma → Tradução.</>}
          </div>
          <button onClick={concluir} disabled={!podeConcluir || concluding} className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0">
            {concluding ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Concluir análise
          </button>
        </div>
      )}

      {analise?.status === "concluida" && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Análise concluída {analise.decisaoJuridica === "com_retificacao" ? "com retificação" : "sem retificação"}.</div>
      )}

      {drawerDiv && (
        <DivergenciaDrawer
          div={drawerDiv}
          readOnly={analise?.status === "concluida"}
          onClose={() => setDrawerDiv(null)}
          onSalvar={async (decisao, notas) => { await decidir(drawerDiv.id, decisao, notas); setDrawerDiv(null) }}
        />
      )}
    </div>
  )
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className={`text-xl font-bold ${danger ? "text-red-600" : "text-gray-900"}`}>{value}</div>
      <div className="text-[11px] text-gray-500">{label}</div>
    </div>
  )
}

function DivergenciaDrawer({ div, readOnly, onClose, onSalvar }: {
  div: Divergencia
  readOnly: boolean
  onClose: () => void
  onSalvar: (decisao: string, notas: string) => Promise<void>
}) {
  const [decisao, setDecisao] = useState(div.status)
  const [notas, setNotas] = useState(div.notas || "")
  const [salvando, setSalvando] = useState(false)

  const salvar = async () => {
    setSalvando(true)
    try { await onSalvar(decisao, notas) } finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full shadow-xl overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <div className="text-sm font-bold text-gray-900">Detalhe da divergência</div>
            <div className="text-xs text-gray-500">{div.documentoTitulo}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4 flex-1">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-gray-200 text-gray-600 text-xs font-bold flex items-center justify-center">{ini(div.pessoaNome)}</span>
            <div>
              <div className="font-semibold text-gray-900 text-sm">{div.pessoaNome}</div>
              <div className="text-[11px] text-gray-500">{div.geracao != null ? `G${div.geracao}` : "—"} · {div.linhaReta ? "Linha reta" : "Apoio"}</div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
            <div className="flex justify-between px-3 py-2"><span className="text-gray-500">Campo</span><span className="font-medium text-gray-900">{div.campoLabel}</span></div>
            <div className="flex justify-between px-3 py-2"><span className="text-gray-500">Valor na árvore</span><span className="font-medium text-gray-900">{div.valorArvore || "—"}</span></div>
            <div className="flex justify-between px-3 py-2"><span className="text-gray-500">Valor no documento</span><span className="font-medium text-gray-900">{div.valorDocumento || "—"}</span></div>
            <div className="flex justify-between px-3 py-2 items-center"><span className="text-gray-500">Gravidade</span>
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${SEV_STYLE[div.severidade] || "bg-gray-100 text-gray-700"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${SEV_DOT[div.severidade] || "bg-gray-400"}`} />{SEV_LABEL[div.severidade] || div.severidade}
              </span>
            </div>
          </div>

          {(div.sugestaoIA || div.motivoIA || div.impacto) && (
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3 text-sm">
              <div className="text-xs font-semibold text-indigo-700 mb-1">Sugestão da IA</div>
              {div.sugestaoIA && <div className="text-gray-700">{div.sugestaoIA}</div>}
              {div.motivoIA && <div className="text-gray-600 text-xs mt-1">{div.motivoIA}</div>}
              {div.impacto && <div className="text-gray-600 text-xs mt-1">Impacto: {div.impacto}</div>}
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-gray-700">Decisão</label>
            <select value={decisao} onChange={(e) => setDecisao(e.target.value)} disabled={readOnly}
              className="mt-1 w-full text-sm border border-gray-200 rounded-md px-2 py-2 bg-white disabled:bg-gray-50 disabled:text-gray-500">
              {DECISOES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700">Notas</label>
            <textarea value={notas} onChange={(e) => setNotas(e.target.value)} disabled={readOnly} rows={4}
              placeholder="Registre o motivo da decisão."
              className="mt-1 w-full text-sm border border-gray-200 rounded-md px-3 py-2 disabled:bg-gray-50" />
          </div>
        </div>

        {!readOnly && (
          <div className="bg-white border-t border-gray-100 px-5 py-3 flex justify-end gap-2">
            <button onClick={onClose} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-md">Cancelar</button>
            <button onClick={salvar} disabled={salvando} className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md inline-flex items-center gap-2 disabled:opacity-50">
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar decisão
            </button>
          </div>
        )}
      </div>
    </div>
  )
}