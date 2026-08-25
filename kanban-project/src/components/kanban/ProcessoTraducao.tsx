// src/components/kanban/ProcessoTraducao.tsx
"use client"

import { useState, useEffect, useCallback, type ReactNode } from "react"
import {
  Loader2, FolderOpen, Users, CheckCircle2, AlertTriangle, Check, X, Upload,
} from "lucide-react"
import { useApi } from "@/src/lib/dados"

interface TrDoc {
  id: number
  documentoId: number
  pessoaNome: string
  documentoTitulo: string
  origem: string
  status: string
  translatedFile: string | null
  conferenceResult: string | null
  validationDecision: string | null
}
interface TrStep {
  id: string
  title: string
  status: string // bloqueada | pendente | em_andamento | concluida
  doneAt: string | null
}
interface Pasta {
  id: number
  status: string
  currentStep: string
  sourceLanguage: string
  targetLanguage: string
  translatorName: string | null
  translatorEmail: string | null
  cost: string | null
  expectedDate: string | null
  sentAt: string | null
  receivedAt: string | null
  validatedAt: string | null
  workflow: TrStep[]
  documentos: TrDoc[]
}

interface Props {
  processoId: number
  onConcluido?: () => void
}

// 6 etapas (TR_STEPS / TR_SHORT do mockup)
const TR_STEP_IDS = [
  "montar_pasta_traducao", "enviar_tradutor_juramentado", "aguardar_retorno_tradutor",
  "receber_traducoes", "conferir_traducoes", "validar_pasta_traduzida",
]
const TR_SHORT = [
  "Montar pasta", "Enviar ao tradutor", "Aguardar retorno",
  "Receber traduções", "Conferir traduções", "Validar pasta",
]
const TR_DOC_LABEL: Record<string, string> = {
  pendente: "Pendente",
  incluido_na_pasta: "Incluído na pasta",
  enviado: "Enviado",
  traducao_recebida: "Tradução recebida",
  conferido: "Conferido",
  validado: "Validado",
  correcao_solicitada: "Correção solicitada",
  bloqueado: "Bloqueado",
}
const PILL: Record<string, string> = {
  validado: "bg-[#4ade80]/12 text-[#4ade80]",
  bloqueado: "bg-[#f87171]/12 text-[#f87171]",
  correcao_solicitada: "bg-[#f87171]/12 text-[#f87171]",
  pendente: "bg-[#252c35] text-white/68",
}
const PILL_DOT: Record<string, string> = {
  validado: "bg-[#4ade80]",
  bloqueado: "bg-[#f87171]",
  correcao_solicitada: "bg-[#f87171]",
  pendente: "bg-[var(--surface-secondary)]",
}
const pillCls = (s: string) => PILL[s] || "bg-[#d2a948]/12 text-[#d2a948]"
const pillDot = (s: string) => PILL_DOT[s] || "bg-amber-400"

// classe base dos inputs/textarea (substitui a antiga classe "ec" do mockup)
const EC = "w-full text-sm border border-[var(--border-default)] rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#7dd3fc]/25 focus:border-[#7dd3fc]/50"

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("authToken")}` })
const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() })
const ini = (nome: string) => {
  const p = nome.trim().split(/\s+/)
  return ((p[0]?.[0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase()
}
const fmtDate = (v: string | null) => {
  if (!v) return "—"
  const d = new Date(v)
  return isNaN(d.getTime()) ? v : d.toLocaleDateString("pt-BR")
}

const colTrad = (it: TrDoc) =>
  it.translatedFile ? "Recebida" : it.status === "enviado" ? "Aguardando" : "Pendente"
const colConf = (it: TrDoc) =>
  it.conferenceResult
    ? it.conferenceResult === "aprovar" ? "Aprovado"
      : it.conferenceResult === "ressalva" ? "Ressalva" : it.conferenceResult
    : "—"
const PROX: Record<string, string> = {
  pendente: "Montar pasta",
  incluido_na_pasta: "Enviar ao tradutor",
  enviado: "Aguardar retorno",
  traducao_recebida: "Conferir tradução",
  conferido: "Validar pasta",
  validado: "Validado",
}

export function ProcessoTraducao({ processoId, onConcluido }: Props) {
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [modalStep, setModalStep] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [modalErro, setModalErro] = useState<string | null>(null)

  // Consulta em cache (src/lib/dados): loading e erro vêm da camada, e a
  // revalidação pós-ação é o mesmo `carregar()` de antes.
  const { dados, carregando: loading, erro: erroCarregar, recarregar: carregar } =
    useApi<{ pasta?: Pasta | null; progress?: number }>(`/api/processos/${processoId}/traducao`)
  const pasta = dados?.pasta ?? null
  const progress = dados?.progress ?? 0

  const postEtapa = async (stepId: string, payload: Record<string, unknown>) => {
    setPosting(true); setModalErro(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/traducao/etapas/${stepId}`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Não foi possível concluir a etapa.")
      setModalStep(null)
      if (data.completePhase) {
        setAviso("Tradução juramentada concluída — processo movido para Apostilamento.")
        onConcluido?.()
      } else if (data.rejected) {
        setAviso("Correção/bloqueio registrado — a pasta voltou para a etapa de envio.")
      }
      await carregar()
    } catch (e) {
      setModalErro(e instanceof Error ? e.message : "Erro ao concluir a etapa.")
    } finally {
      setPosting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-white/40" />
      </div>
    )
  }

  if (!pasta) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-default)] p-8 text-center text-sm text-white/55">
        Este processo ainda não está na fase de Tradução juramentada.
      </div>
    )
  }

  const docs = pasta.documentos
  const by = (s: string) => docs.filter((d) => d.status === s).length
  const k = {
    total: docs.length,
    enviados: by("enviado"),
    aguard: by("enviado"),
    receb: by("traducao_recebida"),
    conf: by("conferido"),
    valid: by("validado"),
    corr: by("correcao_solicitada"),
    bloq: by("bloqueado"),
  }
  const kpis: Array<[string, number, string]> = [
    ["📄", k.total, "Documentos na pasta"],
    ["📤", k.enviados, "Enviados ao tradutor"],
    ["⏳", k.aguard, "Aguardando retorno"],
    ["📥", k.receb, "Traduções recebidas"],
    ["🔍", k.conf, "Conferidos"],
    ["✅", k.valid, "Validados"],
    ["↺", k.corr, "Correção solicitada"],
    ["🔒", k.bloq, "Bloqueados"],
  ]

  const concluida = pasta.status === "concluida"
  const activeStep = pasta.workflow.find((s) => s.status === "pendente" || s.status === "em_andamento")

  return (
    <div className="space-y-4">
      {/* Cabeçalho + stats */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white/95">Central Operacional · Tradução juramentada</h2>
          <p className="text-sm text-white/55">
            Envie a pasta documental ao tradutor juramentado, acompanhe o retorno e valide as traduções.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Stat label="Documentos validados" value={`${k.valid} / ${k.total}`} ok={k.valid > 0} />
          <Stat label="Progresso da fase" value={`${progress}%`} />
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
            concluida ? "bg-[#4ade80]/12 text-[#4ade80]" : "bg-sky-500/15 text-sky-300"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${concluida ? "bg-[#4ade80]" : "bg-sky-400"}`} />
            {concluida ? "Concluída" : "Em andamento"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,300px] gap-4">
        {/* Coluna principal */}
        <div className="space-y-4">
          {/* Barra das 6 etapas (etapa atual é clicável) */}
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-popover)] p-4">
            <div className="flex items-start">
              {pasta.workflow.map((s, i) => {
                const done = s.status === "concluida"
                const active = s.status === "pendente" || s.status === "em_andamento"
                return (
                  <div key={s.id} className={`flex items-start ${i < pasta.workflow.length - 1 ? "flex-1" : ""}`}>
                    <button
                      type="button"
                      disabled={!active}
                      onClick={() => active && setModalStep(s.id)}
                      className={`flex flex-col items-center text-center w-[92px] shrink-0 ${active ? "cursor-pointer" : "cursor-default"}`}
                    >
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                        done ? "bg-[#4ade80] text-white"
                          : active ? "bg-[#2563eb] text-white"
                            : "bg-[#252c35] text-white/55"}`}>
                        {done ? <Check className="w-4 h-4" /> : i + 1}
                      </div>
                      <div className="mt-1.5 text-[11px] font-medium text-white/80 leading-tight">{TR_SHORT[i]}</div>
                      <div className={`text-[10px] ${
                        done ? "text-[#4ade80]" : active ? "text-[#7dd3fc]" : "text-white/40"}`}>
                        {done ? "Concluído" : active ? "Em andamento" : "Pendente"}
                      </div>
                    </button>
                    {i < pasta.workflow.length - 1 && (
                      <div className={`flex-1 h-0.5 mt-3.5 ${done ? "bg-[#4ade80]" : "bg-[#252c35]"}`} />
                    )}
                  </div>
                )
              })}
            </div>

            {!concluida && activeStep && (
              <div className="mt-3 pt-3 border-t border-[var(--border-default)] flex justify-end">
                <button
                  onClick={() => setModalStep(activeStep.id)}
                  className="px-3 py-2 text-sm font-semibold text-[#fff] bg-[#2563eb] hover:bg-[#1d4ed8] rounded-md inline-flex items-center gap-2"
                >
                  {activeStep.title}
                </button>
              </div>
            )}
          </div>

          {/* Card de contexto da pasta */}
          <div className="rounded-xl border border-[var(--border-default)] bg-[#20262e] p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#20262e] text-white/80 flex items-center justify-center flex-shrink-0">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white/95">Pasta de tradução do processo</div>
              <p className="text-xs text-white/68 mt-0.5">
                Todos os documentos finais que precisam de tradução juramentada são enviados juntos nesta fase.
                A fase só conclui quando a pasta inteira estiver traduzida, conferida e validada.
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-xs text-white/55">
                <span>Origem: <b className="text-white/95">{pasta.sourceLanguage}</b></span>
                <span>Destino: <b className="text-white/95">{pasta.targetLanguage}</b></span>
                <span>Tradutor: <b className="text-white/95">{pasta.translatorName || "—"}</b></span>
                <span>Prazo: <b className="text-white/95">{fmtDate(pasta.expectedDate)}</b></span>
                <span>Custo: <b className="text-white/95">{pasta.cost || "—"}</b></span>
              </div>
            </div>
          </div>

          {/* 8 KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {kpis.map(([ic, val, lbl]) => (
              <div key={lbl} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-2.5">
                <div className="text-base leading-none">{ic}</div>
                <div className="text-xl font-bold text-white/95 mt-1">{val}</div>
                <div className="text-[11px] text-white/55">{lbl}</div>
              </div>
            ))}
          </div>

          {/* Tabela de documentos da pasta */}
          <div className="rounded-xl border border-[var(--border-default)] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--border-default)] flex items-center gap-2">
              <span className="text-sm font-semibold text-white/95">Documentos da pasta de tradução</span>
              <span className="text-xs font-semibold text-white/55 bg-[#252c35] rounded-full px-2 py-0.5">{docs.length}</span>
            </div>
            {docs.length === 0 ? (
              <div className="p-8 text-center text-sm text-white/55">Nenhum documento final para tradução.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-white/55 bg-[#20262e]">
                      {["Pessoa","Documento","Origem","Status","Tradução","Conferência","Próxima ação"].map((h) => (
                        <th key={h} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {docs.map((it) => (
                      <tr key={it.id} className="hover:bg-[#20262e] align-top">
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="w-7 h-7 rounded-full bg-[#252c35] text-white/68 text-[11px] font-bold flex items-center justify-center flex-shrink-0">{ini(it.pessoaNome)}</span>
                            <div className="font-semibold text-white/95">{it.pessoaNome}</div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-white/95">{it.documentoTitulo}</div>
                          <div className="text-[11px] text-white/55">Inteiro teor</div>
                        </td>
                        <td className="px-3 py-2.5 text-white/68">{it.origem}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${pillCls(it.status)}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${pillDot(it.status)}`} />
                            {TR_DOC_LABEL[it.status] || it.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-white/80">{colTrad(it)}</td>
                        <td className="px-3 py-2.5 text-white/80">{colConf(it)}</td>
                        <td className="px-3 py-2.5 text-white/68">{PROX[it.status] || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Coluna direita */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-popover)] p-4">
            <h3 className="text-sm font-semibold text-white/95 mb-2.5">Ações rápidas</h3>
            <div className="space-y-2">
              <button
                onClick={() => activeStep ? setModalStep(activeStep.id) : setAviso("A fase já está concluída.")}
                className="w-full text-left text-sm text-white/80 hover:bg-[#20262e] border border-[var(--border-default)] rounded-lg px-3 py-2 inline-flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-white/40" /> Abrir etapa atual
              </button>
              <button
                onClick={() => setAviso("Lista de tradutores juramentados — em breve.")}
                className="w-full text-left text-sm text-white/80 hover:bg-[#20262e] border border-[var(--border-default)] rounded-lg px-3 py-2 inline-flex items-center gap-2">
                <Users className="w-4 h-4 text-white/40" /> Tradutores juramentados
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-popover)] p-4">
            <h3 className="text-sm font-semibold text-white/95 mb-2.5">Alertas</h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2 text-[#d2a948] bg-[#d2a948]/12 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 shrink-0" /> {k.total - k.valid} documento(s) de tradução pendente(s)
              </div>
              {k.corr > 0 && (
                <div className="flex items-center gap-2 text-[#d2a948] bg-[#d2a948]/12 border border-[#d2a948]/25 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {k.corr} correção(ões) solicitada(s)
                </div>
              )}
              <div className="flex items-center gap-2 text-[#4ade80] bg-[#4ade80]/12 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" /> {k.valid} validado(s)
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-popover)] p-4">
            <h3 className="text-sm font-semibold text-white/95 mb-2.5">Últimas movimentações</h3>
            <div className="text-xs text-white/40">Sem movimentações.</div>
          </div>
        </aside>
      </div>

      {erro && <div className="bg-[#f87171]/12 border border-[#f87171]/30 rounded-lg px-4 py-3 text-sm text-[#f87171]">{erro}</div>}
      {aviso && <div className="bg-sky-500/12 border border-sky-500/25 rounded-lg px-4 py-3 text-sm text-sky-300">{aviso}</div>}

      {modalStep && (
        <EtapaModal
          key={modalStep}
          stepId={modalStep}
          pasta={pasta}
          posting={posting}
          erro={modalErro}
          onClose={() => { setModalStep(null); setModalErro(null) }}
          onSubmit={(payload) => postEtapa(modalStep, payload)}
        />
      )}
    </div>
  )
}

function Stat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-2 text-center">
      <div className={`text-lg font-bold ${ok ? "text-[#4ade80]" : "text-white/95"}`}>{value}</div>
      <div className="text-[11px] text-white/55 whitespace-nowrap">{label}</div>
    </div>
  )
}

// ============================================================
// MODAIS DAS ETAPAS (espelham trStepMontar/Enviar/Aguardar/Receber/Conferir/Validar)
// ============================================================

const MONTAR_CHK: Array<[string, string]> = [
  ["inc", "Todos os documentos finais estão incluídos"],
  ["inv", "Não existem documentos inválidos"],
  ["ret", "Versões retificadas substituíram as antigas"],
  ["leg", "Arquivos estão legíveis"],
]
const ENVIO_METODOS: Array<[string, string]> = [
  ["email", "E-mail"], ["whats", "WhatsApp"], ["drive", "Drive/link"],
  ["sistema", "Sistema do tradutor"], ["presencial", "Presencial"], ["outro", "Outro"],
]
const CONF_CHK = ["Nome do titular", "Datas", "Locais", "Filiação", "Dados registrais", "Carimbo/assinatura", "Legível", "Sem divergência crítica"]
const CONF_RES: Array<[string, string, string]> = [
  ["aprovar", "Aprovado", "ok"],
  ["ressalva", "Ressalva", ""],
  ["correcao_solicitada", "Solicitar correção", "warn"],
  ["divergencia_critica", "Divergência crítica", "crit"],
]
const VALIDAR_DECS: Array<[string, string, string]> = [
  ["aprovar", "Aprovar pasta traduzida", "Todas as traduções servem · fase conclui"],
  ["aprovar_ressalvas", "Aprovar com ressalvas", "Serve com observações registradas"],
  ["solicitar_correcao", "Solicitar correção ao tradutor", "Volta ao tradutor · fase não conclui"],
  ["bloquear", "Bloquear fase", "Pausa a fase para análise"],
]

function EtapaModal({ stepId, pasta, posting, erro, onClose, onSubmit }: {
  stepId: string
  pasta: Pasta
  posting: boolean
  erro: string | null
  onClose: () => void
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const docs = pasta.documentos
  const num = TR_STEP_IDS.indexOf(stepId) + 1

  const [srcLang, setSrcLang] = useState(pasta.sourceLanguage)
  const [tgtLang, setTgtLang] = useState(pasta.targetLanguage)
  const [obs, setObs] = useState("")
  const [montarChk, setMontarChk] = useState<Record<string, boolean>>({})

  const [trName, setTrName] = useState(pasta.translatorName || "")
  const [trEmail, setTrEmail] = useState(pasta.translatorEmail || "")
  const [trWa, setTrWa] = useState("")
  const [sentAt, setSentAt] = useState("")
  const [expectedDate, setExpectedDate] = useState("")
  const [cost, setCost] = useState("")
  const [metodo, setMetodo] = useState("")

  const [receivedAt, setReceivedAt] = useState("")
  const [custoFinal, setCustoFinal] = useState("")
  const [files, setFiles] = useState<Record<number, string>>({})

  const [confRes, setConfRes] = useState<Record<number, string>>({})
  const [confChk, setConfChk] = useState<Record<string, boolean>>({})

  const [decision, setDecision] = useState("")
  const [valObs, setValObs] = useState("")

  const title = TR_SHORT[num - 1]

  const montarOk = docs.length > 0 && !!srcLang && !!tgtLang && MONTAR_CHK.every(([k]) => montarChk[k])
  const enviarOk = !!trName.trim() && !!sentAt.trim() && !!expectedDate.trim() && !!metodo
  const receberOk = !!receivedAt.trim() && docs.every((d) => files[d.documentoId])
  const conferirOk = docs.every((d) => {
    const r = confRes[d.documentoId]
    return r && r !== "correcao_solicitada" && r !== "divergencia_critica"
  })
  const validarOk = !!decision

  const podeSalvar =
    stepId === "montar_pasta_traducao" ? montarOk
      : stepId === "enviar_tradutor_juramentado" ? enviarOk
        : stepId === "aguardar_retorno_tradutor" ? true
          : stepId === "receber_traducoes" ? receberOk
            : stepId === "conferir_traducoes" ? conferirOk
              : stepId === "validar_pasta_traduzida" ? validarOk
                : false

  const submit = () => {
    if (stepId === "montar_pasta_traducao")
      return onSubmit({ sourceLanguage: srcLang, targetLanguage: tgtLang, checklistOk: true, obs })
    if (stepId === "enviar_tradutor_juramentado")
      return onSubmit({ translatorName: trName.trim(), email: trEmail, whatsapp: trWa, sentAt: sentAt.trim(), expectedDate: expectedDate.trim(), cost, sendMethod: metodo })
    if (stepId === "aguardar_retorno_tradutor")
      return onSubmit({})
    if (stepId === "receber_traducoes")
      return onSubmit({ receivedAt: receivedAt.trim(), files, custoFinal, obs })
    if (stepId === "conferir_traducoes")
      return onSubmit({ results: confRes })
    if (stepId === "validar_pasta_traduzida")
      return onSubmit({ decision, obs: valObs })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[var(--overlay-modal)]" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[var(--surface-popover)] rounded-xl shadow-xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-[var(--border-default)]">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#7dd3fc]">Etapa {num} de 6 · Workflow da Tradução</div>
            <h3 className="text-base font-bold text-white/95 mt-0.5">{title}</h3>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 p-1"><X className="w-5 h-5" /></button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* 1) Montar pasta */}
          {stepId === "montar_pasta_traducao" && (
            <>
              <Sec>Documentos incluídos ({docs.length})</Sec>
              <div className="space-y-2">
                {docs.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 border border-[var(--border-default)] rounded-lg px-3 py-2">
                    <span className="text-base">📄</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white/95">{d.documentoTitulo}</div>
                      <div className="text-[11px] text-white/55">{d.pessoaNome} · {d.origem}</div>
                    </div>
                    <span className="text-[11px] text-white/55">{TR_DOC_LABEL[d.status] || d.status}</span>
                  </div>
                ))}
                {docs.length === 0 && <div className="text-sm text-white/55">Nenhum documento na pasta.</div>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Idioma de origem"><input className={EC} value={srcLang} onChange={(e) => setSrcLang(e.target.value)} /></Field>
                <Field label="Idioma de destino"><input className={EC} value={tgtLang} onChange={(e) => setTgtLang(e.target.value)} /></Field>
              </div>
              <Field label="Observações para o tradutor">
                <textarea className={EC} rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Notas, prioridades, termos técnicos..." />
              </Field>
              <Sec>Checklist</Sec>
              <div className="space-y-2">
                {MONTAR_CHK.map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setMontarChk((p) => ({ ...p, [key]: !p[key] }))}
                    className={`w-full flex items-center gap-2 border rounded-lg px-3 py-2 text-sm text-left ${montarChk[key] ? "border-[#4ade80]/25 bg-[#4ade80]/12 text-[#4ade80]" : "border-[var(--border-default)] text-white/80"}`}>
                    <span className={`w-4 h-4 rounded flex items-center justify-center ${montarChk[key] ? "bg-[#4ade80] text-white" : "border border-[var(--border-default)]"}`}>
                      {montarChk[key] && <Check className="w-3 h-3" />}
                    </span>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* 2) Enviar ao tradutor */}
          {stepId === "enviar_tradutor_juramentado" && (
            <>
              <Sec>Tradutor</Sec>
              <Field label="Nome do tradutor juramentado" required>
                <input className={EC} value={trName} onChange={(e) => setTrName(e.target.value)} placeholder="Nome completo" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="E-mail"><input className={EC} value={trEmail} onChange={(e) => setTrEmail(e.target.value)} /></Field>
                <Field label="WhatsApp"><input className={EC} value={trWa} onChange={(e) => setTrWa(e.target.value)} /></Field>
              </div>
              <Sec>Envio</Sec>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Data de envio" required><input className={EC} value={sentAt} onChange={(e) => setSentAt(e.target.value)} placeholder="dd/mm/aaaa" /></Field>
                <Field label="Prazo esperado" required><input className={EC} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} placeholder="dd/mm/aaaa" /></Field>
              </div>
              <Field label="Custo estimado"><input className={EC} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="R$" /></Field>
              <Field label="Forma de envio" required>
                <div className="flex flex-wrap gap-2">
                  {ENVIO_METODOS.map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setMetodo(v)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md border ${metodo === v ? "border-[#2563eb] bg-[#20262e] text-white" : "border-[var(--border-default)] text-white/80"}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </Field>
            </>
          )}

          {/* 3) Aguardar retorno */}
          {stepId === "aguardar_retorno_tradutor" && (
            <>
              <div className="rounded-lg border border-[var(--border-default)] bg-[#20262e] p-3">
                <div className="text-xs font-semibold text-white/80 mb-2">📨 Resumo do envio</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Cell k="Tradutor" v={pasta.translatorName || "—"} />
                  <Cell k="Enviado em" v={fmtDate(pasta.sentAt)} />
                  <Cell k="Prazo" v={fmtDate(pasta.expectedDate)} />
                  <Cell k="Custo" v={pasta.cost || "—"} />
                </div>
              </div>
              <p className="text-sm text-white/68">Acompanhe o prazo com o tradutor. Confirme quando a tradução tiver retorno para liberar a próxima etapa.</p>
            </>
          )}

          {/* 4) Receber traduções */}
          {stepId === "receber_traducoes" && (
            <>
              <Sec>Traduções por documento ({docs.length})</Sec>
              <div className="space-y-2">
                {docs.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3 border border-[var(--border-default)] rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white/95">{d.documentoTitulo}</div>
                      <div className="text-[11px] text-white/55">{d.pessoaNome}</div>
                    </div>
                    <button type="button" onClick={() => setFiles((p) => ({ ...p, [d.documentoId]: `traducao_${d.documentoId}.pdf` }))}
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-md border px-3 py-1.5 ${files[d.documentoId] ? "border-[#4ade80]/25 bg-[#4ade80]/12 text-[#4ade80]" : "border-[var(--border-default)] text-white/80"}`}>
                      {files[d.documentoId] ? <Check className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
                      {files[d.documentoId] ? "Anexada" : "Anexar tradução"}
                    </button>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Data de recebimento" required><input className={EC} value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} placeholder="dd/mm/aaaa" /></Field>
                <Field label="Custo final"><input className={EC} value={custoFinal} onChange={(e) => setCustoFinal(e.target.value)} placeholder="R$" /></Field>
              </div>
              <Field label="Observações"><textarea className={EC} rows={2} value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
            </>
          )}

          {/* 5) Conferir traduções */}
          {stepId === "conferir_traducoes" && (
            <div className="space-y-3">
              {docs.map((d) => (
                <div key={d.id} className="border border-[var(--border-default)] rounded-lg p-3">
                  <div className="flex items-baseline gap-2 mb-2">
                    <b className="text-sm text-white/95">{d.documentoTitulo}</b>
                    <small className="text-[11px] text-white/55">{d.pessoaNome}</small>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {CONF_CHK.map((c, ci) => {
                      const key = `${d.documentoId}-${ci}`
                      const on = confChk[key]
                      return (
                        <button key={ci} type="button" onClick={() => setConfChk((p) => ({ ...p, [key]: !p[key] }))}
                          className={`inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-md border px-2 py-1 ${on ? "border-[#4ade80]/25 bg-[#4ade80]/12 text-[#4ade80]" : "border-[var(--border-default)] text-white/68"}`}>
                          <span className={`w-3.5 h-3.5 rounded flex items-center justify-center ${on ? "bg-[#4ade80] text-white" : "border border-[var(--border-default)]"}`}>{on && <Check className="w-2.5 h-2.5" />}</span>
                          {c}
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {CONF_RES.map(([v, l, tone]) => {
                      const sel = confRes[d.documentoId] === v
                      const selCls = !sel ? "border-[var(--border-default)] text-white/80"
                        : tone === "ok" ? "border-[#4ade80]/25 bg-[#4ade80]/12 text-[#4ade80]"
                          : tone === "warn" ? "border-[#d2a948]/25 bg-[#d2a948]/12 text-[#d2a948]"
                            : tone === "crit" ? "border-[#f87171]/25 bg-[#f87171]/12 text-[#f87171]"
                              : "border-[#2563eb] bg-[#20262e] text-white"
                      return (
                        <button key={v} type="button" onClick={() => setConfRes((p) => ({ ...p, [d.documentoId]: v }))}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-md border ${selCls}`}>{l}</button>
                      )
                    })}
                  </div>
                </div>
              ))}
              {docs.length === 0 && <div className="text-sm text-white/55">Nenhum documento para conferir.</div>}
            </div>
          )}

          {/* 6) Validar pasta */}
          {stepId === "validar_pasta_traduzida" && (
            <>
              <div className="grid grid-cols-5 gap-2 text-center">
                <Resumo n={docs.length} l="Documentos" />
                <Resumo n={docs.filter((d) => d.status === "conferido").length} l="Conferidos" />
                <Resumo n={docs.filter((d) => d.conferenceResult === "ressalva").length} l="Ressalvas" />
                <Resumo n={0} l="Correções" />
                <Resumo n={0} l="Críticas" />
              </div>
              <Sec>Decisão final</Sec>
              <div className="space-y-2">
                {VALIDAR_DECS.map(([v, l, sub]) => (
                  <button key={v} type="button" onClick={() => setDecision(v)}
                    className={`w-full text-left border rounded-lg px-3 py-2.5 ${decision === v ? "border-[#2563eb] bg-[#20262e]" : "border-[var(--border-default)]"}`}>
                    <div className="text-sm font-semibold text-white/95">{l}</div>
                    <div className="text-[11px] text-white/55">{sub}</div>
                  </button>
                ))}
              </div>
              <Field label="Parecer final (opcional)"><textarea className={EC} rows={2} value={valObs} onChange={(e) => setValObs(e.target.value)} /></Field>
            </>
          )}

          {erro && <div className="bg-[#f87171]/12 border border-[#f87171]/30 rounded-lg px-3 py-2 text-sm text-[#f87171]">{erro}</div>}
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--border-default)] px-5 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm text-white/68 hover:bg-[#20262e] rounded-md">Cancelar</button>
          <button onClick={submit} disabled={!podeSalvar || posting}
            className="px-4 py-2 text-sm font-semibold text-[#fff] bg-[#2563eb] hover:bg-[#1d4ed8] rounded-md inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {stepId === "validar_pasta_traduzida" ? "Confirmar decisão" : "Concluir etapa"}
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
function Cell({ k, v }: { k: string; v: string }) {
  return <div><div className="text-[10px] uppercase text-white/40">{k}</div><div className="font-semibold text-white/95">{v}</div></div>
}
function Resumo({ n, l }: { n: number; l: string }) {
  return <div className="rounded-lg border border-[var(--border-default)] py-2"><div className="text-lg font-bold text-white/95">{n}</div><div className="text-[10px] text-white/55">{l}</div></div>
}