// src/components/kanban/HistoricalPhasePanel.tsx
//
// Corpo da Central Operacional em modo VIEW (consulta). NÃO é uma Central paralela:
// é reaproveitado dentro da MESMA Central (mesma casca: trilha + resumo + header),
// apenas trocando o corpo quando a fase SELECIONADA não é a fase ATIVA.
//
// • Fase concluída/materializada → renderiza a PROJEÇÃO HISTÓRICA (somente leitura)
//   vinda de /api/processos/[id]/phases/[instanceId]/projection — dados materializados
//   do ciclo, imutáveis. Nada é recalculado ao vivo.
// • Fase futura (sem instância) → renderiza a DEFINIÇÃO prevista do workflow (catálogo),
//   claramente marcada "ainda não iniciada". NUNCA materializa nada.
//
// A única ação de escrita aqui é "Retornar processo para esta fase", executada
// EXCLUSIVAMENTE pela rota oficial /phase/return → PhaseAdvanceService.returnPhase.

"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Loader2, Eye, Lock, RotateCcw, ArrowLeft, CheckCircle2, Clock, AlertTriangle,
  FileText, ListChecks, History, Gavel, ShieldCheck, Ban,
} from "lucide-react"
import { FASES } from "@/src/lib/process-stage/fases-catalog"
import type { FaseCode } from "@prisma/client"

// ── Espelho do JSON de /phases (item) e da projeção histórica ────────────────
export interface PhaseMeta {
  phaseKey: string
  faseCode: FaseCode | null
  label: string
  ordem: number
  state: "ACTIVE" | "COMPLETED" | "FUTURE"
  materialized: boolean
  workflowInstanceId: number | null
  ciclo: number | null
  status: string | null
}

interface HistStep {
  id: number; stepKey: string; ordem: number; tipo: string; status: string
  obrigatorio: boolean; responsavelId: number | null; prazo: string | null
  bloqueadoManual: boolean; motivo: string | null; completedAt: string | null
}
interface HistDoc { stepInstanceId: number; stepKey: string; documentoId: number; tipo: string | null; stepStatus: string }
interface HistNeed { stepInstanceId: number; stepKey: string; necessidadeId: number; itemCatalogoId: number | null; stepStatus: string }
interface HistEvent { id: number; tipo: string; entityType: string; criadoEm: string }
interface HistDecision { id: number; resultado: string; faseAtual: string; fasePretendida: string | null; justificativa: string | null; motivoCodigo: string | null; forcado: boolean; criadoEm: string }
interface HistBlock { stepInstanceId: number; stepKey: string; status: string; bloqueadoManual: boolean; motivo: string | null; blockedAt: string | null }
interface HistAudit { id: number; acao: string; entidade: string; descricao: string; usuario: { id: number; nome: string } | null; criadoEm: string }

interface HistProjection {
  phase: { label: string; state: string; cycle: number; startedAt: string | null; completedAt: string | null; supersededAt: string | null }
  progress: { percentage: number; completedWeight: number; totalWeight: number }
  workflow: { steps: HistStep[] }
  documents: HistDoc[]
  needs: HistNeed[]
  events: HistEvent[]
  decisions: HistDecision[]
  blocks: HistBlock[]
  audit: HistAudit[]
  unavailable: string[]
}

interface Props {
  processoId: number
  phaseMeta: PhaseMeta
  podeRetornar: boolean
  onVoltarAtiva: () => void
  /** Chamado após retorno oficial bem-sucedido (para a cascata de invalidação). */
  onRetornou: () => void
}

const fmt = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"

const authHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") : ""}`,
})

export function HistoricalPhasePanel({ processoId, phaseMeta, podeRetornar, onVoltarAtiva, onRetornou }: Props) {
  const [proj, setProj] = useState<HistProjection | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const materializada = phaseMeta.materialized && phaseMeta.workflowInstanceId != null

  useEffect(() => {
    let vivo = true
    if (!materializada) { setProj(null); setErro(null); setLoading(false); return }
    setLoading(true); setErro(null)
    fetch(`/api/processos/${processoId}/phases/${phaseMeta.workflowInstanceId}/projection`, { headers: authHeaders() })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as HistProjection
      })
      .then((j) => { if (vivo) setProj(j) })
      .catch(() => { if (vivo) setErro("Não foi possível carregar a projeção histórica desta fase.") })
      .finally(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [processoId, phaseMeta.workflowInstanceId, materializada])

  // Subtítulo do modo consulta.
  const subtitulo =
    phaseMeta.state === "COMPLETED" ? `Fase concluída${phaseMeta.ciclo ? ` · Ciclo ${phaseMeta.ciclo}` : ""}`
    : phaseMeta.state === "FUTURE" ? "Fase futura · ainda não iniciada"
    : materializada ? `Consulta${phaseMeta.ciclo ? ` · Ciclo ${phaseMeta.ciclo}` : ""}` : "Consulta"

  return (
    <div>
      {/* ===== Cabeçalho do modo consulta (mesma casca visual) ===== */}
      <div className="bg-white border border-gray-200 rounded-t-2xl px-5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-[19px] font-extrabold text-gray-900">Consulta — {phaseMeta.label}</h2>
            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold px-3 py-1 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">
              <Eye className="w-3.5 h-3.5" /> Somente leitura
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onVoltarAtiva}
              className="inline-flex items-center gap-1.5 border-[1.5px] border-gray-200 bg-white text-gray-700 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg hover:border-blue-500 hover:text-blue-600 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Voltar à fase ativa
            </button>
            {podeRetornar && phaseMeta.state === "COMPLETED" && (
              <RetornarAcao processoId={processoId} phaseMeta={phaseMeta} onRetornou={onRetornou} />
            )}
          </div>
        </div>
        <div className="text-[13px] text-gray-500 mt-1.5 flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" /> {subtitulo}
        </div>
      </div>

      <div className="bg-white border border-gray-200 border-t-0 rounded-b-2xl px-5 py-5 space-y-5">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : erro ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">⚠ {erro}</div>
        ) : !materializada ? (
          <DefinicaoPrevista faseCode={phaseMeta.faseCode} />
        ) : proj ? (
          <ProjecaoHistorica proj={proj} />
        ) : null}
      </div>
    </div>
  )
}

// ============================================================
// Fase futura: definição PREVISTA (catálogo) — não iniciada. Sem materialização.
// ============================================================
function DefinicaoPrevista({ faseCode }: { faseCode: FaseCode | null }) {
  const def = faseCode ? FASES[faseCode] : null
  const passos = def ? (def.steps.length > 0 ? def.steps.map((s) => ({ title: s.title, description: s.description })) : (def.processSteps ?? []).map((s) => ({ title: s.title, description: s.description }))) : []
  return (
    <div>
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 mb-5">
        <div className="text-[13px] font-bold text-blue-800 mb-1 flex items-center gap-1.5"><Clock className="w-4 h-4" /> Fase ainda não iniciada</div>
        <div className="text-[12.5px] text-blue-700 leading-relaxed">
          Esta fase ainda não foi materializada. Abaixo está a <b>definição prevista</b> do Workflow Interno —
          nenhum dado operacional foi criado ao abrir esta consulta.
        </div>
      </div>
      <Secao icon={<ListChecks className="w-4 h-4" />} titulo="Workflow Interno (previsto)">
        {passos.length === 0 ? (
          <Vazio texto="Sem definição de passos no catálogo para esta fase." />
        ) : (
          <ol className="space-y-2">
            {passos.map((p, i) => (
              <li key={i} className="flex gap-3 items-start border border-gray-100 rounded-lg px-3 py-2">
                <span className="w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold bg-gray-100 text-gray-500 flex-none">{i + 1}</span>
                <div>
                  <div className="text-[13px] font-bold text-gray-800">{p.title}</div>
                  <div className="text-[12px] text-gray-500">{p.description}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Secao>
    </div>
  )
}

// ============================================================
// Fase materializada: projeção histórica (todas as seções exigidas)
// ============================================================
function ProjecaoHistorica({ proj }: { proj: HistProjection }) {
  return (
    <>
      {proj.unavailable.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-[12px] text-gray-500 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> Alguns dados históricos não estão disponíveis para esta fase: {proj.unavailable.join(", ")}.
        </div>
      )}

      {/* Progresso (materializado, não recalculado) */}
      <div className="bg-white border border-gray-200 rounded-xl px-5 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[13px] font-semibold text-gray-500 mb-1">Progresso da fase (no encerramento do ciclo)</div>
            <div className="text-[28px] font-extrabold text-gray-900 leading-none">{proj.progress.percentage}%</div>
          </div>
          <div className="text-[13px] text-gray-500">{proj.progress.completedWeight} de {proj.progress.totalWeight} passos concluídos</div>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-3">
          <div className="h-full bg-blue-600" style={{ width: `${proj.progress.percentage}%` }} />
        </div>
        <div className="text-[11.5px] text-gray-400 mt-2">Iniciada: {fmt(proj.phase.startedAt)} · Concluída: {fmt(proj.phase.completedAt)}{proj.phase.supersededAt ? ` · Supersedida: ${fmt(proj.phase.supersededAt)}` : ""}</div>
      </div>

      {/* Workflow Interno */}
      <Secao icon={<ListChecks className="w-4 h-4" />} titulo={`Workflow Interno (${proj.workflow.steps.length})`}>
        {proj.workflow.steps.length === 0 ? <Vazio texto="Sem passos materializados." /> : (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            {proj.workflow.steps.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 last:border-b-0">
                <StatusPasso status={s.status} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-gray-800 truncate">{s.stepKey}</div>
                  <div className="text-[11.5px] text-gray-400">{s.tipo}{s.obrigatorio ? " · obrigatório" : " · opcional"}{s.prazo ? ` · prazo ${fmt(s.prazo)}` : ""}</div>
                </div>
                <span className="text-[11px] font-bold text-gray-500 uppercase">{s.status}</span>
              </div>
            ))}
          </div>
        )}
      </Secao>

      {/* Documentos + Necessidades (lado a lado) */}
      <div className="grid gap-5 md:grid-cols-2">
        <Secao icon={<FileText className="w-4 h-4" />} titulo={`Documentos (${proj.documents.length})`}>
          {proj.documents.length === 0 ? <Vazio texto="Sem documentos vinculados a esta fase." /> : (
            <ul className="space-y-1.5">
              {proj.documents.map((d) => (
                <li key={d.stepInstanceId} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2 text-[12.5px]">
                  <span className="text-gray-700 truncate">{d.tipo ?? `Documento #${d.documentoId}`}</span>
                  <span className="text-[10.5px] font-bold text-gray-500 uppercase whitespace-nowrap">{d.stepStatus}</span>
                </li>
              ))}
            </ul>
          )}
        </Secao>
        <Secao icon={<ListChecks className="w-4 h-4" />} titulo={`Necessidades (${proj.needs.length})`}>
          {proj.needs.length === 0 ? <Vazio texto="Sem necessidades vinculadas a esta fase." /> : (
            <ul className="space-y-1.5">
              {proj.needs.map((n) => (
                <li key={n.stepInstanceId} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2 text-[12.5px]">
                  <span className="text-gray-700 truncate">Necessidade #{n.necessidadeId}{n.itemCatalogoId ? ` · item ${n.itemCatalogoId}` : ""}</span>
                  <span className="text-[10.5px] font-bold text-gray-500 uppercase whitespace-nowrap">{n.stepStatus}</span>
                </li>
              ))}
            </ul>
          )}
        </Secao>
      </div>

      {/* Bloqueios registrados */}
      <Secao icon={<Ban className="w-4 h-4" />} titulo={`Bloqueios registrados (${proj.blocks.length})`}>
        {proj.blocks.length === 0 ? <Vazio texto="Nenhum bloqueio registrado neste ciclo." /> : (
          <ul className="space-y-1.5">
            {proj.blocks.map((b) => (
              <li key={b.stepInstanceId} className="border border-red-100 bg-red-50/50 rounded-lg px-3 py-2 text-[12.5px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-red-700">{b.stepKey}</span>
                  <span className="text-[10.5px] font-bold text-red-500 uppercase">{b.status}{b.bloqueadoManual ? " · manual" : ""}</span>
                </div>
                {b.motivo && <div className="text-[11.5px] text-gray-500 mt-0.5">{b.motivo}</div>}
                {b.blockedAt && <div className="text-[11px] text-gray-400 mt-0.5">em {fmt(b.blockedAt)}</div>}
              </li>
            ))}
          </ul>
        )}
      </Secao>

      {/* Eventos + Decisões */}
      <div className="grid gap-5 md:grid-cols-2">
        <Secao icon={<History className="w-4 h-4" />} titulo={`Eventos (${proj.events.length})`}>
          {proj.events.length === 0 ? <Vazio texto="Sem eventos neste ciclo." /> : (
            <ul className="space-y-1 max-h-72 overflow-y-auto">
              {proj.events.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 text-[12px] border-b border-gray-50 py-1.5">
                  <span className="font-semibold text-gray-700">{e.tipo}</span>
                  <span className="text-gray-400 whitespace-nowrap">{fmt(e.criadoEm)}</span>
                </li>
              ))}
            </ul>
          )}
        </Secao>
        <Secao icon={<Gavel className="w-4 h-4" />} titulo={`Decisões / Histórico (${proj.decisions.length})`}>
          {proj.decisions.length === 0 ? <Vazio texto="Sem decisões de fase neste ciclo." /> : (
            <ul className="space-y-1.5 max-h-72 overflow-y-auto">
              {proj.decisions.map((d) => (
                <li key={d.id} className="border border-gray-100 rounded-lg px-3 py-2 text-[12px]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-gray-800">{d.resultado}{d.forcado ? " (forçado)" : ""}</span>
                    <span className="text-gray-400 whitespace-nowrap">{fmt(d.criadoEm)}</span>
                  </div>
                  <div className="text-gray-500">{d.faseAtual}{d.fasePretendida ? ` → ${d.fasePretendida}` : ""}</div>
                  {d.justificativa && <div className="text-gray-500 mt-0.5 italic">“{d.justificativa}”{d.motivoCodigo ? ` · ${d.motivoCodigo}` : ""}</div>}
                </li>
              ))}
            </ul>
          )}
        </Secao>
      </div>

      {/* Auditoria */}
      <Secao icon={<ShieldCheck className="w-4 h-4" />} titulo={`Auditoria (${proj.audit.length})`}>
        {proj.audit.length === 0 ? <Vazio texto="Sem registros de auditoria na janela deste ciclo." /> : (
          <ul className="space-y-1 max-h-72 overflow-y-auto">
            {proj.audit.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 text-[12px] border-b border-gray-50 py-1.5">
                <div className="min-w-0">
                  <span className="font-semibold text-gray-700">{a.acao}</span>
                  <span className="text-gray-500"> — {a.descricao}</span>
                  {a.usuario && <span className="text-gray-400"> · {a.usuario.nome}</span>}
                </div>
                <span className="text-gray-400 whitespace-nowrap">{fmt(a.criadoEm)}</span>
              </li>
            ))}
          </ul>
        )}
      </Secao>
    </>
  )
}

// ============================================================
// Ação: Retornar processo para esta fase (via rota oficial /phase/return)
// ============================================================
function RetornarAcao({ processoId, phaseMeta, onRetornou }: { processoId: number; phaseMeta: PhaseMeta; onRetornou: () => void }) {
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
        body: JSON.stringify({ faseAlvo: phaseMeta.phaseKey, justificativa: justificativa.trim(), motivoCodigo: motivoCodigo.trim() }),
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
  }, [processoId, phaseMeta.phaseKey, justificativa, motivoCodigo, onRetornou])

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-1.5 bg-gray-900 text-white text-[12.5px] font-bold px-3.5 py-2 rounded-lg hover:bg-gray-800 transition-colors"
      >
        <RotateCcw className="w-3.5 h-3.5" /> Retornar processo para esta fase
      </button>

      {aberto && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => !enviando && setAberto(false)}>
          <div className="max-w-md w-full rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <RotateCcw className="w-5 h-5 text-gray-700" />
              <h3 className="text-[16px] font-extrabold text-gray-900">Retornar processo para esta fase</h3>
            </div>
            <p className="text-[13px] text-gray-600 leading-relaxed mb-4">
              O processo retornará para <b>{phaseMeta.label}</b>. A fase será iniciada em um <b>novo ciclo</b>.
              As fases posteriores deixarão de ser o caminho ativo, mas <b>todo o histórico será preservado</b>. Deseja continuar?
            </p>

            <label className="block text-[12px] font-semibold text-gray-600 mb-1">Justificativa</label>
            <textarea
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              rows={3}
              className="w-full text-[13px] rounded-lg border border-gray-200 px-3 py-2 mb-3 focus:outline-none focus:border-blue-400"
              placeholder="Por que o processo precisa voltar a esta fase?"
            />
            <label className="block text-[12px] font-semibold text-gray-600 mb-1">Código de motivo</label>
            <input
              value={motivoCodigo}
              onChange={(e) => setMotivoCodigo(e.target.value)}
              className="w-full text-[13px] rounded-lg border border-gray-200 px-3 py-2 mb-3 focus:outline-none focus:border-blue-400"
              placeholder="Ex.: DOC_NAO_LOCALIZADO"
            />

            {erro && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[12.5px] text-red-700 mb-3">{erro}</div>}

            <div className="flex justify-end gap-2">
              <button disabled={enviando} onClick={() => setAberto(false)} className="px-3.5 py-2 text-[12.5px] font-semibold rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 disabled:opacity-50">Cancelar</button>
              <button disabled={enviando} onClick={() => void enviar()} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[12.5px] font-bold rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">
                {enviando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Confirmar retorno
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Subcomponentes visuais ───────────────────────────────────────────────────
function Secao({ icon, titulo, children }: { icon: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[13px] font-extrabold text-gray-800 flex items-center gap-1.5 mb-2.5">
        <span className="text-gray-400">{icon}</span> {titulo}
      </h4>
      {children}
    </div>
  )
}

function Vazio({ texto }: { texto: string }) {
  return <div className="text-[12.5px] text-gray-400 border border-dashed border-gray-200 rounded-lg px-4 py-3">{texto}</div>
}

function StatusPasso({ status }: { status: string }) {
  const done = ["CONCLUIDO", "EXECUTADO", "DISPENSADO"].includes(status)
  const blocked = status === "BLOQUEADO"
  return (
    <span className={`w-6 h-6 rounded-full grid place-items-center flex-none ${done ? "bg-green-100 text-green-600" : blocked ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-400"}`}>
      {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : blocked ? <Ban className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
    </span>
  )
}
