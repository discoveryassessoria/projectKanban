// src/components/kanban/ProcessoFaseFinal.tsx
"use client"

import { useState, useEffect, useCallback, type ReactNode } from "react"
import { Loader2, ArrowRight, FileText, Check, X, Upload, Flag } from "lucide-react"
import { FINAL_CFG, type FaseKey } from "@/src/lib/process-stage/final-engine"

interface FinalStep { id: string; title: string; status: string; doneAt: string | null }
interface Fase {
  id: number
  faseKey: FaseKey
  status: string
  currentStep: string
  workflow: FinalStep[]
  data: Record<string, string>
}
interface Props {
  processoId: number
  onConcluido?: () => void
}

const EC = "w-full text-sm border border-white/10 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#7dd3fc]/25 focus:border-[#7dd3fc]/50"
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("authToken")}` })
const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() })

export function ProcessoFaseFinal({ processoId, onConcluido }: Props) {
  const [fase, setFase] = useState<Fase | null>(null)
  const [faseKey, setFaseKey] = useState<FaseKey | null>(null)
  const [progress, setProgress] = useState(0)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [modalStep, setModalStep] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [modalErro, setModalErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/processos/${processoId}/fase-final`, { headers: authHeaders() })
      const data = await res.json()
      setFase(data.fase ?? null)
      setFaseKey(data.faseKey ?? null)
      setProgress(data.progress ?? 0)
    } catch {
      setErro("Erro ao carregar a fase.")
    } finally {
      setLoading(false)
    }
  }, [processoId])

  useEffect(() => { carregar() }, [carregar])

  const postEtapa = async (stepId: string, payload: Record<string, unknown>) => {
    setPosting(true); setModalErro(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/fase-final/etapas/${stepId}`, {
        method: "POST", headers: jsonHeaders(), body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Não foi possível concluir a etapa.")
      setModalStep(null)
      if (data.recordedOnly) {
        setAviso("Decisão registrada — a fase aguarda deferimento para concluir.")
      } else if (data.completePhase) {
        setAviso(data.advanced ? "Fase concluída — processo movido para a próxima coluna." : "Processo finalizado e arquivado.")
        onConcluido?.()
      }
      await carregar()
    } catch (e) {
      setModalErro(e instanceof Error ? e.message : "Erro ao concluir a etapa.")
    } finally {
      setPosting(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div>
  }
  if (!fase || !faseKey) {
    return <div className="rounded-xl border border-dashed border-white/15 p-8 text-center text-sm text-white/55">Este processo não está numa fase final.</div>
  }

  const cfg = FINAL_CFG[faseKey]
  const concluida = fase.status === "concluida"
  const done = fase.workflow.filter((s) => s.status === "concluida").length
  const activeStep = fase.workflow.find((s) => s.status === "pendente" || s.status === "em_andamento")
  const d = fase.data || {}

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white/95">Central Operacional · {cfg.phaseName}</h2>
          <p className="text-sm text-white/55">Objetivo: {cfg.obj}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="rounded-lg border border-white/10 bg-[#1b2027] px-3 py-2 text-center">
            <div className="text-lg font-bold text-white/95">{done} / {cfg.steps.length}</div>
            <div className="text-[11px] text-white/55 whitespace-nowrap">Etapas</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-[#1b2027] px-3 py-2 text-center">
            <div className="text-lg font-bold text-white/95">{progress}%</div>
            <div className="text-[11px] text-white/55 whitespace-nowrap">Progresso</div>
          </div>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
            concluida ? "bg-[#4ade80]/12 text-[#4ade80]" : "bg-sky-500/15 text-sky-300"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${concluida ? "bg-[#4ade80]" : "bg-sky-400"}`} />
            {concluida ? "Concluída" : "Em andamento"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,300px] gap-4">
        <div className="space-y-4">
          {/* Barra das 3 etapas */}
          <div className="rounded-xl border border-white/10 bg-[#1b2027] p-4">
            <div className="flex items-start">
              {fase.workflow.map((s, i) => {
                const isDone = s.status === "concluida"
                const active = s.status === "pendente" || s.status === "em_andamento"
                return (
                  <div key={s.id} className={`flex items-start ${i < fase.workflow.length - 1 ? "flex-1" : ""}`}>
                    <button type="button" disabled={!active} onClick={() => active && setModalStep(s.id)}
                      className={`flex flex-col items-center text-center w-[120px] shrink-0 ${active ? "cursor-pointer" : "cursor-default"}`}>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                        isDone ? "bg-[#4ade80] text-white" : active ? "bg-[#2563eb] text-white" : "bg-[#252c35] text-white/55"}`}>
                        {isDone ? <Check className="w-4 h-4" /> : i + 1}
                      </div>
                      <div className="mt-1.5 text-[11px] font-medium text-white/80 leading-tight">{s.title}</div>
                      <div className={`text-[10px] ${isDone ? "text-[#4ade80]" : active ? "text-[#7dd3fc]" : "text-white/40"}`}>
                        {isDone ? "Concluído" : active ? "Em andamento" : "Pendente"}
                      </div>
                    </button>
                    {i < fase.workflow.length - 1 && <div className={`flex-1 h-0.5 mt-3.5 ${isDone ? "bg-[#4ade80]" : "bg-[#252c35]"}`} />}
                  </div>
                )
              })}
            </div>
            {!concluida && activeStep && (
              <div className="mt-3 pt-3 border-t border-white/10 flex justify-end">
                <button onClick={() => setModalStep(activeStep.id)}
                  className="px-3 py-2 text-sm font-semibold text-white bg-[#2563eb] hover:bg-[#1d4ed8] rounded-md inline-flex items-center gap-2">
                  {activeStep.title} <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Contexto */}
          <div className="rounded-xl border border-white/10 bg-[#20262e] p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#20262e] flex items-center justify-center text-lg flex-shrink-0">{cfg.icon}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white/95">{cfg.ctxTitle}</div>
              <p className="text-xs text-white/68 mt-0.5">{cfg.ctxText}</p>
            </div>
          </div>

          {/* Lista de etapas */}
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
              <span className="text-sm font-semibold text-white/95">Etapas da fase</span>
              <span className="text-xs font-semibold text-white/55 bg-[#252c35] rounded-full px-2 py-0.5">{cfg.steps.length}</span>
            </div>
            <div className="divide-y divide-white/10">
              {fase.workflow.map((s, i) => {
                const isDone = s.status === "concluida"
                const active = s.status === "pendente" || s.status === "em_andamento"
                const meta = isDone ? `Concluída${s.doneAt ? " em " + s.doneAt : ""}` : active ? cfg.steps[i].desc : "Bloqueada · conclua a anterior"
                return (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                      isDone ? "bg-[#4ade80]/15 text-[#4ade80]" : active ? "bg-[#2563eb] text-white" : "bg-[#252c35] text-white/40"}`}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white/95">{s.title}</div>
                      <div className="text-[11px] text-white/55">{meta}</div>
                    </div>
                    {active && <button onClick={() => setModalStep(s.id)} className="text-xs font-semibold text-white bg-[#20262e] hover:bg-[#252c35] border border-white/10 rounded-md px-2.5 py-1.5">Abrir etapa</button>}
                    {isDone && <span className="text-green-500"><Check className="w-4 h-4" /></span>}
                    {!isDone && !active && <span className="text-white/40">🔒</span>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Coluna direita */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-[#1b2027] p-4">
            <h3 className="text-sm font-semibold text-white/95 mb-2.5">Ações rápidas</h3>
            <button onClick={() => activeStep ? setModalStep(activeStep.id) : setAviso("Todas as etapas concluídas.")}
              className="w-full text-left text-sm text-white/80 hover:bg-[#20262e] border border-white/10 rounded-lg px-3 py-2 inline-flex items-center gap-2">
              <ArrowRight className="w-4 h-4 text-white/40" /> Abrir etapa atual
            </button>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#1b2027] p-4">
            <h3 className="text-sm font-semibold text-white/95 mb-2.5">Resumo</h3>
            <div className="space-y-1.5 text-xs">
              <Res k="Progresso" v={`${progress}%`} />
              <Res k="Etapas concluídas" v={`${done} / ${cfg.steps.length}`} />
              <Res k="Status" v={concluida ? "Concluída" : "Em andamento"} />
              {d.fnNum && <Res k="Nº do protocolo" v={d.fnNum} />}
              {d.fnOrgao && <Res k="Órgão" v={d.fnOrgao} />}
              {d.fnData && <Res k="Data" v={d.fnData} />}
              {d.lastDecision && <Res k="Última decisão" v={d.lastDecision} />}
            </div>
          </div>
        </aside>
      </div>

      {erro && <div className="bg-[#f87171]/12 border border-[#f87171]/30 rounded-lg px-4 py-3 text-sm text-[#f87171]">{erro}</div>}
      {aviso && <div className="bg-sky-500/12 border border-sky-500/25 rounded-lg px-4 py-3 text-sm text-sky-300">{aviso}</div>}

      {modalStep && (
        <EtapaModal key={modalStep} stepId={modalStep} faseKey={faseKey} fase={fase}
          posting={posting} erro={modalErro}
          onClose={() => { setModalStep(null); setModalErro(null) }}
          onSubmit={(payload) => postEtapa(modalStep, payload)} />
      )}
    </div>
  )
}

function Res({ k, v }: { k: string; v: string }) {
  return <div className="flex items-center justify-between"><span className="text-white/55">{k}</span><b className="text-white/95">{v}</b></div>
}

// ============================================================
// MODAL DAS ETAPAS (espelha openFinalStepModal ~3202)
// ============================================================
function EtapaModal({ stepId, faseKey, fase, posting, erro, onClose, onSubmit }: {
  stepId: string
  faseKey: FaseKey
  fase: Fase
  posting: boolean
  erro: string | null
  onClose: () => void
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const cfg = FINAL_CFG[faseKey]
  const sdef = cfg.steps.find((s) => s.id === stepId)!
  const n = cfg.steps.findIndex((s) => s.id === stepId) + 1
  const isLast = n === cfg.steps.length
  const d = fase.data || {}

  const [fnNum, setFnNum] = useState(d.fnNum || "")
  const [fnData, setFnData] = useState("")
  const [fnOrgao, setFnOrgao] = useState(d.fnOrgao || "")
  const [fnCanal, setFnCanal] = useState("")
  const [fnF1, setFnF1] = useState("")
  const [chk, setChk] = useState(false)
  const [decision, setDecision] = useState("")

  const has = (v: string) => v.trim().length > 0
  const podeSalvar =
    stepId === "montar_dossie_final" ? chk
      : stepId === "agendar_protocolo" ? has(fnOrgao) && has(fnData)
        : stepId === "protocolar_pedido" ? has(fnNum) && has(fnData)
          : stepId === "registrar_protocolo" ? has(fnNum)
            : stepId === "acompanhar_andamento" ? true
              : stepId === "receber_decisao" ? !!decision
                : stepId === "confirmar_deferimento" ? true
                  : stepId === "entregar_documentacao" ? has(fnData)
                    : stepId === "encerrar_processo" ? chk
                      : false

  const submit = () => onSubmit({ fnNum, fnData, fnOrgao, fnCanal, fnF1, chkOk: chk, decision })

  const cta = stepId === "receber_decisao" ? "Registrar decisão"
    : isLast ? (faseKey === "finalizado" ? "Concluir e arquivar" : "Concluir fase") : "Concluir etapa"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[#1b2027] rounded-xl shadow-xl max-h-[85vh] flex flex-col">
        <div className={`flex items-start justify-between px-5 py-4 border-b ${isLast ? "border-white/10" : "border-white/10"}`}>
          <div>
            <div className={`text-[11px] font-semibold uppercase tracking-wider ${isLast ? "text-[#f87171]" : "text-[#7dd3fc]"}`}>Etapa {n} de {cfg.steps.length} · {cfg.phaseName}</div>
            <h3 className="text-base font-bold text-white/95 mt-0.5">{sdef.title}</h3>
            <p className="text-xs text-white/55 mt-0.5">{sdef.desc}</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {stepId === "montar_dossie_final" && (
            <>
              <div className="rounded-lg border border-white/10 bg-[#20262e] px-3 py-2.5 text-xs text-white/68 flex items-center gap-2">
                <FileText className="w-4 h-4 text-white/40" /> Reúna todos os documentos apostilados e traduzidos do processo num dossiê único.
              </div>
              <Field label="Observações do dossiê"><textarea className={EC} rows={2} value={fnF1} onChange={(e) => setFnF1(e.target.value)} /></Field>
              <Chk on={chk} onClick={() => setChk((v) => !v)}>Confirmo que o dossiê está completo e legível</Chk>
            </>
          )}

          {stepId === "agendar_protocolo" && (
            <>
              <Field label="Órgão de destino" required><input className={EC} value={fnOrgao} onChange={(e) => setFnOrgao(e.target.value)} placeholder="ex: Consulado da Itália / Comune / Tribunal" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Canal"><Select value={fnCanal} onChange={setFnCanal} opts={["Presencial", "Portal eletrônico", "Correios", "Procurador"]} /></Field>
                <Field label="Data agendada" required><input className={EC} value={fnData} onChange={(e) => setFnData(e.target.value)} placeholder="dd/mm/aaaa" /></Field>
              </div>
              <Field label="Observações"><textarea className={EC} rows={2} value={fnF1} onChange={(e) => setFnF1(e.target.value)} /></Field>
            </>
          )}

          {stepId === "protocolar_pedido" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nº do protocolo" required><input className={EC} value={fnNum} onChange={(e) => setFnNum(e.target.value)} placeholder="ex: 2025/0001234" /></Field>
                <Field label="Data do protocolo" required><input className={EC} value={fnData} onChange={(e) => setFnData(e.target.value)} placeholder="dd/mm/aaaa" /></Field>
              </div>
              <FakeUpload label="Anexar comprovante" />
            </>
          )}

          {stepId === "registrar_protocolo" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nº do protocolo" required><input className={EC} value={fnNum} onChange={(e) => setFnNum(e.target.value)} /></Field>
                <Field label="Data de entrada"><input className={EC} value={fnData} onChange={(e) => setFnData(e.target.value)} placeholder="dd/mm/aaaa" /></Field>
              </div>
              <Field label="Órgão"><input className={EC} value={fnOrgao} onChange={(e) => setFnOrgao(e.target.value)} /></Field>
            </>
          )}

          {stepId === "acompanhar_andamento" && (
            <>
              <Sec>Registrar movimentação</Sec>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Data"><input className={EC} value={fnData} onChange={(e) => setFnData(e.target.value)} placeholder="dd/mm/aaaa" /></Field>
                <Field label="Tipo"><Select value={fnCanal} onChange={setFnCanal} opts={["Contato", "Exigência", "Andamento", "Audiência"]} /></Field>
              </div>
              <Field label="Descrição"><textarea className={EC} rows={2} value={fnF1} onChange={(e) => setFnF1(e.target.value)} placeholder="Ex: órgão solicitou documento adicional." /></Field>
              <div className="text-[11px] text-white/55">Conclua quando o acompanhamento estiver em dia e a decisão for aguardada.</div>
            </>
          )}

          {stepId === "receber_decisao" && (
            <>
              <Sec>Resultado da decisão</Sec>
              <div className="space-y-2">
                {([["deferido", "✓ Deferido", "Reconhecimento concedido · segue para Finalizado"],
                  ["exigencia", "! Exigência", "Órgão pediu complementação · fase não conclui"],
                  ["indeferido", "✕ Indeferido", "Pedido negado · fase não conclui"]] as const).map(([v, l, sub]) => (
                  <button key={v} type="button" onClick={() => setDecision(v)}
                    className={`w-full text-left border rounded-lg px-3 py-2.5 ${decision === v ? (v === "deferido" ? "border-[#4ade80]/25 bg-[#4ade80]/12" : "border-[#2563eb] bg-[#20262e]") : "border-white/10"}`}>
                    <div className="text-sm font-semibold text-white/95">{l}</div>
                    <div className="text-[11px] text-white/55">{sub}</div>
                  </button>
                ))}
              </div>
              <Field label="Observações da decisão"><textarea className={EC} rows={2} value={fnF1} onChange={(e) => setFnF1(e.target.value)} /></Field>
            </>
          )}

          {stepId === "confirmar_deferimento" && (
            <>
              <div className="rounded-lg border border-[#4ade80]/30 bg-[#4ade80]/12 px-3 py-2.5 text-sm text-[#4ade80]">🏛️ Reconhecimento deferido. Confirme para prosseguir com a entrega ao cliente.</div>
              <Field label="Nº / referência do reconhecimento"><input className={EC} value={fnNum} onChange={(e) => setFnNum(e.target.value)} /></Field>
            </>
          )}

          {stepId === "entregar_documentacao" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Data da entrega" required><input className={EC} value={fnData} onChange={(e) => setFnData(e.target.value)} placeholder="dd/mm/aaaa" /></Field>
                <Field label="Forma de entrega"><Select value={fnCanal} onChange={setFnCanal} opts={["Presencial", "Correios", "Digital"]} /></Field>
              </div>
              <Chk on={chk} onClick={() => setChk((v) => !v)}>Cliente recebeu toda a documentação final</Chk>
            </>
          )}

          {stepId === "encerrar_processo" && (
            <>
              <div className="rounded-lg border border-white/10 bg-[#20262e] px-3 py-2.5 text-sm text-white/80">📦 Ao encerrar, o processo é arquivado como <b>Finalizado</b> e sai do fluxo operacional.</div>
              <Field label="Parecer de encerramento"><textarea className={EC} rows={2} value={fnF1} onChange={(e) => setFnF1(e.target.value)} /></Field>
              <Chk on={chk} onClick={() => setChk((v) => !v)}>Confirmo o encerramento e arquivamento do processo</Chk>
            </>
          )}

          {erro && <div className="bg-[#f87171]/12 border border-[#f87171]/30 rounded-lg px-3 py-2 text-sm text-[#f87171]">{erro}</div>}
        </div>

        <div className="border-t border-white/10 px-5 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm text-white/68 hover:bg-[#20262e] rounded-md">Cancelar</button>
          <button onClick={submit} disabled={!podeSalvar || posting}
            className="px-4 py-2 text-sm font-semibold text-white bg-[#2563eb] hover:bg-[#1d4ed8] rounded-md inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : isLast && faseKey === "finalizado" ? <Flag className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            {cta}
          </button>
        </div>
      </div>
    </div>
  )
}

function Sec({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wider text-white/55">{children}</div>
}
function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-white/80 flex items-center gap-1.5 mb-1">
        {label}{required && <span className="text-[10px] font-bold text-[#f87171] bg-[#f87171]/12 rounded px-1.5 py-0.5">Obrigatório</span>}
      </label>
      {children}
    </div>
  )
}
function Select({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts: string[] }) {
  return (
    <select className={EC} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Selecione…</option>
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}
function Chk({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full flex items-center gap-2 border rounded-lg px-3 py-2 text-sm text-left ${on ? "border-[#4ade80]/25 bg-[#4ade80]/12 text-[#4ade80]" : "border-white/10 text-white/80"}`}>
      <span className={`w-4 h-4 rounded flex items-center justify-center ${on ? "bg-[#4ade80] text-white" : "border border-white/15"}`}>{on && <Check className="w-3 h-3" />}</span>
      {children}
    </button>
  )
}
function FakeUpload({ label }: { label: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button type="button" onClick={() => setOk(true)}
      className={`w-full inline-flex items-center gap-2 text-sm font-semibold rounded-md border px-3 py-2.5 ${ok ? "border-[#4ade80]/25 bg-[#4ade80]/12 text-[#4ade80]" : "border-white/10 text-white/80"}`}>
      {ok ? <Check className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
      {ok ? "comprovante_protocolo.pdf · anexado" : label}
    </button>
  )
}