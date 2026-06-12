// src/components/kanban/ProcessoApostilamento.tsx
"use client"

import { useState, useEffect, useCallback, type ReactNode } from "react"
import {
  Loader2, FolderOpen, Users, CheckCircle2, AlertTriangle, Check, X, Upload,
} from "lucide-react"

interface ApDoc {
  id: number
  documentoId: number
  pessoaNome: string
  documentoTitulo: string
  origem: string
  status: string
  apostilledFile: string | null
  apostilleNumber: string | null
  apostilleDate: string | null
  issuingAuthority: string | null
  conferenceResult: string | null
  validationDecision: string | null
}
interface ApStep {
  id: string
  title: string
  status: string
  doneAt: string | null
}
interface Pasta {
  id: number
  status: string
  currentStep: string
  destinationCountry: string | null
  apostilleType: string | null
  authorityName: string | null
  attendant: string | null
  cost: string | null
  trackingCode: string | null
  expectedDate: string | null
  sentAt: string | null
  receivedAt: string | null
  validatedAt: string | null
  workflow: ApStep[]
  documentos: ApDoc[]
}

interface Props {
  processoId: number
  onConcluido?: () => void
}

const AP_STEP_IDS = [
  "montar_pasta_apostilamento", "enviar_para_apostilamento", "aguardar_retorno_apostilamento",
  "receber_documentos_apostilados", "conferir_apostilas", "validar_pasta_apostilada",
]
const AP_SHORT = [
  "Montar pasta", "Enviar p/ apostilamento", "Aguardar retorno",
  "Receber apostilados", "Conferir apostilas", "Validar pasta",
]
const AP_DOC_LABEL: Record<string, string> = {
  pendente: "Pendente",
  incluido_na_pasta: "Incluído na pasta",
  enviado: "Enviado",
  apostila_recebida: "Apostila recebida",
  conferido: "Conferido",
  validado: "Validado",
  correcao_solicitada: "Correção solicitada",
  bloqueado: "Bloqueado",
}
const PILL: Record<string, string> = {
  validado: "bg-green-50 text-green-700",
  bloqueado: "bg-red-50 text-red-700",
  correcao_solicitada: "bg-red-50 text-red-700",
  pendente: "bg-gray-100 text-gray-600",
}
const PILL_DOT: Record<string, string> = {
  validado: "bg-green-500",
  bloqueado: "bg-red-500",
  correcao_solicitada: "bg-red-500",
  pendente: "bg-gray-400",
}
const pillCls = (s: string) => PILL[s] || "bg-amber-50 text-amber-700"
const pillDot = (s: string) => PILL_DOT[s] || "bg-amber-400"

const EC = "w-full text-sm border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-300"

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
const TIPO_LABEL: Record<string, string> = { fisico: "Físico", digital: "Digital", ambos: "Ambos" }

const colApostila = (it: ApDoc) =>
  it.apostilledFile ? "Recebida" : it.status === "enviado" ? "Aguardando" : "Pendente"
const colConf = (it: ApDoc) =>
  it.conferenceResult
    ? it.conferenceResult === "aprovar" ? "Aprovado"
      : it.conferenceResult === "ressalva" ? "Ressalva" : it.conferenceResult
    : "—"
const PROX: Record<string, string> = {
  pendente: "Montar pasta",
  incluido_na_pasta: "Enviar p/ apostilamento",
  enviado: "Aguardar retorno",
  apostila_recebida: "Conferir apostila",
  conferido: "Validar pasta",
  validado: "Validado",
}

export function ProcessoApostilamento({ processoId, onConcluido }: Props) {
  const [pasta, setPasta] = useState<Pasta | null>(null)
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
      const res = await fetch(`/api/processos/${processoId}/apostilamento`, { headers: authHeaders() })
      const data = await res.json()
      setPasta(data.pasta ?? null)
      setProgress(data.progress ?? 0)
    } catch {
      setErro("Erro ao carregar a pasta de apostilamento.")
    } finally {
      setLoading(false)
    }
  }, [processoId])

  useEffect(() => { carregar() }, [carregar])

  const postEtapa = async (stepId: string, payload: Record<string, unknown>) => {
    setPosting(true); setModalErro(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/apostilamento/etapas/${stepId}`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Não foi possível concluir a etapa.")
      setModalStep(null)
      if (data.completePhase) {
        setAviso("Apostilamento concluído — processo movido para Aguardando protocolo.")
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
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!pasta) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
        Este processo ainda não está na fase de Apostilamento.
      </div>
    )
  }

  const docs = pasta.documentos
  const by = (s: string) => docs.filter((d) => d.status === s).length
  const k = {
    total: docs.length,
    enviados: by("enviado"),
    aguard: by("enviado"),
    receb: by("apostila_recebida"),
    conf: by("conferido"),
    valid: by("validado"),
    corr: by("correcao_solicitada"),
    bloq: by("bloqueado"),
  }
  const kpis: Array<[string, number, string]> = [
    ["📄", k.total, "Documentos na pasta"],
    ["📤", k.enviados, "Enviados p/ apostilar"],
    ["⏳", k.aguard, "Aguardando retorno"],
    ["📥", k.receb, "Apostilas recebidas"],
    ["🔍", k.conf, "Conferidos"],
    ["✅", k.valid, "Validados"],
    ["↺", k.corr, "Correção solicitada"],
    ["🔒", k.bloq, "Bloqueados"],
  ]

  const concluida = pasta.status === "concluida"
  const activeStep = pasta.workflow.find((s) => s.status === "pendente" || s.status === "em_andamento")

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Central Operacional · Apostilamento</h2>
          <p className="text-sm text-gray-500">
            Envie os documentos finais para Apostila de Haia, acompanhe o retorno e valide as apostilas.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Stat label="Documentos validados" value={`${k.valid} / ${k.total}`} ok={k.valid > 0} />
          <Stat label="Progresso da fase" value={`${progress}%`} />
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
            concluida ? "bg-green-50 text-green-700" : "bg-indigo-50 text-indigo-700"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${concluida ? "bg-green-500" : "bg-indigo-500"}`} />
            {concluida ? "Concluída" : "Em andamento"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,300px] gap-4">
        <div className="space-y-4">
          {/* Barra das 6 etapas */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
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
                      className={`flex flex-col items-center text-center w-[96px] shrink-0 ${active ? "cursor-pointer" : "cursor-default"}`}
                    >
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                        done ? "bg-green-500 text-white"
                          : active ? "bg-indigo-600 text-white ring-2 ring-indigo-200"
                            : "bg-gray-200 text-gray-500"}`}>
                        {done ? <Check className="w-4 h-4" /> : i + 1}
                      </div>
                      <div className="mt-1.5 text-[11px] font-medium text-gray-700 leading-tight">{AP_SHORT[i]}</div>
                      <div className={`text-[10px] ${
                        done ? "text-green-600" : active ? "text-indigo-600" : "text-gray-400"}`}>
                        {done ? "Concluído" : active ? "Em andamento" : "Pendente"}
                      </div>
                    </button>
                    {i < pasta.workflow.length - 1 && (
                      <div className={`flex-1 h-0.5 mt-3.5 ${done ? "bg-green-400" : "bg-gray-200"}`} />
                    )}
                  </div>
                )
              })}
            </div>

            {!concluida && activeStep && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end">
                <button
                  onClick={() => setModalStep(activeStep.id)}
                  className="px-3 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md inline-flex items-center gap-2"
                >
                  {activeStep.title}
                </button>
              </div>
            )}
          </div>

          {/* Card de contexto */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900">Pasta de apostilamento do processo</div>
              <p className="text-xs text-gray-600 mt-0.5">
                Todos os documentos finais (traduzidos e válidos) são enviados juntos para Apostila de Haia.
                A fase só conclui quando a pasta inteira estiver apostilada, conferida e validada.
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-xs text-gray-500">
                <span>País destino: <b className="text-gray-800">{pasta.destinationCountry || "—"}</b></span>
                <span>Tipo: <b className="text-gray-800">{pasta.apostilleType ? (TIPO_LABEL[pasta.apostilleType] || pasta.apostilleType) : "—"}</b></span>
                <span>Autoridade: <b className="text-gray-800">{pasta.authorityName || "—"}</b></span>
                <span>Prazo: <b className="text-gray-800">{fmtDate(pasta.expectedDate)}</b></span>
                <span>Custo: <b className="text-gray-800">{pasta.cost || "—"}</b></span>
              </div>
            </div>
          </div>

          {/* 8 KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {kpis.map(([ic, val, lbl]) => (
              <div key={lbl} className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                <div className="text-base leading-none">{ic}</div>
                <div className="text-xl font-bold text-gray-900 mt-1">{val}</div>
                <div className="text-[11px] text-gray-500">{lbl}</div>
              </div>
            ))}
          </div>

          {/* Tabela */}
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">Documentos da pasta de apostilamento</span>
              <span className="text-xs font-semibold text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">{docs.length}</span>
            </div>
            {docs.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">Nenhum documento final para apostilamento.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50">
                      {["Pessoa","Documento","Origem","Status","Apostila","Conferência","Próxima ação"].map((h) => (
                        <th key={h} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {docs.map((it) => (
                      <tr key={it.id} className="hover:bg-gray-50 align-top">
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="w-7 h-7 rounded-full bg-gray-200 text-gray-600 text-[11px] font-bold flex items-center justify-center flex-shrink-0">{ini(it.pessoaNome)}</span>
                            <div className="font-semibold text-gray-900">{it.pessoaNome}</div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-gray-900">{it.documentoTitulo}</div>
                          {it.apostilleNumber && <div className="text-[11px] text-gray-500">Apostila {it.apostilleNumber}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600">{it.origem}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${pillCls(it.status)}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${pillDot(it.status)}`} />
                            {AP_DOC_LABEL[it.status] || it.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-700">{colApostila(it)}</td>
                        <td className="px-3 py-2.5 text-gray-700">{colConf(it)}</td>
                        <td className="px-3 py-2.5 text-gray-600">{PROX[it.status] || "—"}</td>
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
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2.5">Ações rápidas</h3>
            <div className="space-y-2">
              <button
                onClick={() => activeStep ? setModalStep(activeStep.id) : setAviso("A fase já está concluída.")}
                className="w-full text-left text-sm text-gray-700 hover:bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 inline-flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-gray-400" /> Abrir etapa atual
              </button>
              <button
                onClick={() => setAviso("Cartórios / autoridades de apostilamento — em breve.")}
                className="w-full text-left text-sm text-gray-700 hover:bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 inline-flex items-center gap-2">
                <Users className="w-4 h-4 text-gray-400" /> Cartórios / autoridades
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2.5">Alertas</h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2 text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 shrink-0" /> {k.total - k.valid} documento(s) de apostila pendente(s)
              </div>
              {k.corr > 0 && (
                <div className="flex items-center gap-2 text-orange-700 bg-orange-50 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {k.corr} correção(ões) solicitada(s)
                </div>
              )}
              <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" /> {k.valid} validado(s)
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2.5">Últimas movimentações</h3>
            <div className="text-xs text-gray-400">Sem movimentações.</div>
          </div>
        </aside>
      </div>

      {erro && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{erro}</div>}
      {aviso && <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 text-sm text-indigo-700">{aviso}</div>}

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
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-center">
      <div className={`text-lg font-bold ${ok ? "text-green-600" : "text-gray-900"}`}>{value}</div>
      <div className="text-[11px] text-gray-500 whitespace-nowrap">{label}</div>
    </div>
  )
}

// ============================================================
// MODAIS DAS ETAPAS (espelham apStepMontar/Enviar/Aguardar/Receber/Conferir/Validar)
// ============================================================

const TIPO_APOSTILA: Array<[string, string]> = [["fisico", "Físico"], ["digital", "Digital"], ["ambos", "Ambos"]]
const MONTAR_CHK: Array<[string, string]> = [
  ["inc", "Todos os documentos finais estão incluídos"],
  ["inv", "Não existem documentos inválidos"],
  ["trad", "Traduções juramentadas incluídas quando necessárias"],
  ["ret", "Versões retificadas substituíram as antigas"],
  ["leg", "Arquivos estão legíveis"],
]
const CANAIS: Array<[string, string]> = [
  ["balcao", "Balcão"], ["email", "E-mail"], ["whats", "WhatsApp"], ["correios", "Correios"],
  ["motoboy", "Motoboy"], ["portal", "Portal eletrônico"], ["parceiro", "Parceiro"], ["outro", "Outro"],
]
const CONF_CHK = [
  "Apostila presente", "Apostila legível", "Apostila pertence ao documento", "Nome do titular confere",
  "Dados conferem", "Autoridade emissora correta", "Data da apostila", "Carimbo/QR code presente", "Sem divergência crítica",
]
const CONF_RES: Array<[string, string, string]> = [
  ["aprovar", "Aprovado", "ok"],
  ["ressalva", "Ressalva", ""],
  ["correcao_solicitada", "Solicitar correção", "warn"],
  ["divergencia_critica", "Divergência crítica", "crit"],
]
const VALIDAR_DECS: Array<[string, string, string]> = [
  ["aprovar", "Aprovar pasta apostilada", "Todos os apostilados servem · fase conclui"],
  ["aprovar_ressalvas", "Aprovar com ressalvas", "Serve com observações registradas"],
  ["solicitar_correcao", "Solicitar correção", "Volta ao cartório · fase não conclui"],
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
  const num = AP_STEP_IDS.indexOf(stepId) + 1

  // montar
  const [destino, setDestino] = useState(pasta.destinationCountry || "")
  const [tipo, setTipo] = useState(pasta.apostilleType || "")
  const [obs, setObs] = useState("")
  const [montarChk, setMontarChk] = useState<Record<string, boolean>>({})

  // enviar
  const [authorityName, setAuthorityName] = useState(pasta.authorityName || "")
  const [attendant, setAttendant] = useState(pasta.attendant || "")
  const [canal, setCanal] = useState("")
  const [sentAt, setSentAt] = useState("")
  const [expectedDate, setExpectedDate] = useState("")
  const [cost, setCost] = useState("")
  const [trackingCode, setTrackingCode] = useState("")

  // receber
  const [receivedAt, setReceivedAt] = useState("")
  const [custoFinal, setCustoFinal] = useState("")
  const [files, setFiles] = useState<Record<number, string>>({})
  const [nums, setNums] = useState<Record<number, string>>({})
  const [dates, setDates] = useState<Record<number, string>>({})

  // conferir
  const [confRes, setConfRes] = useState<Record<number, string>>({})
  const [confChk, setConfChk] = useState<Record<string, boolean>>({})

  // validar
  const [decision, setDecision] = useState("")
  const [valObs, setValObs] = useState("")

  const title = AP_SHORT[num - 1]

  const montarOk = docs.length > 0 && !!destino.trim() && !!tipo && MONTAR_CHK.every(([key]) => montarChk[key])
  const enviarOk = !!authorityName.trim() && !!sentAt.trim() && !!expectedDate.trim() && !!canal
  const receberOk = !!receivedAt.trim() && docs.every((d) => files[d.documentoId])
  const conferirOk = docs.every((d) => {
    const r = confRes[d.documentoId]
    return r && r !== "correcao_solicitada" && r !== "divergencia_critica"
  })
  const validarOk = !!decision

  const podeSalvar =
    stepId === "montar_pasta_apostilamento" ? montarOk
      : stepId === "enviar_para_apostilamento" ? enviarOk
        : stepId === "aguardar_retorno_apostilamento" ? true
          : stepId === "receber_documentos_apostilados" ? receberOk
            : stepId === "conferir_apostilas" ? conferirOk
              : stepId === "validar_pasta_apostilada" ? validarOk
                : false

  const submit = () => {
    if (stepId === "montar_pasta_apostilamento")
      return onSubmit({ destinationCountry: destino.trim(), apostilleType: tipo, checklistOk: true, obs })
    if (stepId === "enviar_para_apostilamento")
      return onSubmit({ authorityName: authorityName.trim(), attendant, sendMethod: canal, sentAt: sentAt.trim(), expectedDate: expectedDate.trim(), cost, trackingCode })
    if (stepId === "aguardar_retorno_apostilamento")
      return onSubmit({})
    if (stepId === "receber_documentos_apostilados")
      return onSubmit({ receivedAt: receivedAt.trim(), files, apostilleNumbers: nums, apostilleDates: dates, custoFinal, obs })
    if (stepId === "conferir_apostilas")
      return onSubmit({ results: confRes })
    if (stepId === "validar_pasta_apostilada")
      return onSubmit({ decision, obs: valObs })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-xl shadow-xl max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">Etapa {num} de 6 · Workflow do Apostilamento</div>
            <h3 className="text-base font-bold text-gray-900 mt-0.5">{title}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* 1) Montar */}
          {stepId === "montar_pasta_apostilamento" && (
            <>
              <Sec>Documentos incluídos ({docs.length})</Sec>
              <div className="space-y-2">
                {docs.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 border border-gray-200 rounded-lg px-3 py-2">
                    <span className="text-base">📄</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">{d.documentoTitulo}</div>
                      <div className="text-[11px] text-gray-500">{d.pessoaNome} · {d.origem}</div>
                    </div>
                    <span className="text-[11px] text-gray-500">{AP_DOC_LABEL[d.status] || d.status}</span>
                  </div>
                ))}
                {docs.length === 0 && <div className="text-sm text-gray-500">Nenhum documento na pasta.</div>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="País de destino" required><input className={EC} value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="ex: Itália" /></Field>
                <Field label="Tipo de apostilamento" required>
                  <div className="flex gap-2">
                    {TIPO_APOSTILA.map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setTipo(v)}
                        className={`flex-1 px-3 py-2 text-xs font-semibold rounded-md border ${tipo === v ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-200 text-gray-700"}`}>{l}</button>
                    ))}
                  </div>
                </Field>
              </div>
              <Field label="Observações para o cartório/autoridade">
                <textarea className={EC} rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
              </Field>
              <Sec>Checklist</Sec>
              <div className="space-y-2">
                {MONTAR_CHK.map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setMontarChk((p) => ({ ...p, [key]: !p[key] }))}
                    className={`w-full flex items-center gap-2 border rounded-lg px-3 py-2 text-sm text-left ${montarChk[key] ? "border-green-300 bg-green-50 text-green-700" : "border-gray-200 text-gray-700"}`}>
                    <span className={`w-4 h-4 rounded flex items-center justify-center ${montarChk[key] ? "bg-green-500 text-white" : "border border-gray-300"}`}>
                      {montarChk[key] && <Check className="w-3 h-3" />}
                    </span>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* 2) Enviar */}
          {stepId === "enviar_para_apostilamento" && (
            <>
              <Sec>Autoridade / cartório</Sec>
              <Field label="Cartório / autoridade responsável" required>
                <input className={EC} value={authorityName} onChange={(e) => setAuthorityName(e.target.value)} placeholder="ex: Cartório de Notas / TJSP" />
              </Field>
              <Field label="Atendente / responsável externo">
                <input className={EC} value={attendant} onChange={(e) => setAttendant(e.target.value)} />
              </Field>
              <Field label="Canal de envio" required>
                <div className="flex flex-wrap gap-2">
                  {CANAIS.map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setCanal(v)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md border ${canal === v ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-200 text-gray-700"}`}>{l}</button>
                  ))}
                </div>
              </Field>
              <Sec>Envio</Sec>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Data de envio" required><input className={EC} value={sentAt} onChange={(e) => setSentAt(e.target.value)} placeholder="dd/mm/aaaa" /></Field>
                <Field label="Prazo esperado" required><input className={EC} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} placeholder="dd/mm/aaaa" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Custo estimado"><input className={EC} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="R$" /></Field>
                <Field label="Código de rastreio"><input className={EC} value={trackingCode} onChange={(e) => setTrackingCode(e.target.value)} placeholder="ex: BR123456789BR" /></Field>
              </div>
            </>
          )}

          {/* 3) Aguardar */}
          {stepId === "aguardar_retorno_apostilamento" && (
            <>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs font-semibold text-gray-700 mb-2">🏛️ Resumo do envio</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Cell k="Autoridade" v={pasta.authorityName || "—"} />
                  <Cell k="Enviado em" v={fmtDate(pasta.sentAt)} />
                  <Cell k="Prazo" v={fmtDate(pasta.expectedDate)} />
                  <Cell k="Rastreio" v={pasta.trackingCode || "—"} />
                </div>
              </div>
              <p className="text-sm text-gray-600">Acompanhe o prazo com o cartório/autoridade. Confirme quando os documentos apostilados tiverem retorno.</p>
            </>
          )}

          {/* 4) Receber */}
          {stepId === "receber_documentos_apostilados" && (
            <>
              <Sec>Documentos apostilados ({docs.length})</Sec>
              <div className="space-y-2">
                {docs.map((d) => (
                  <div key={d.id} className="border border-gray-200 rounded-lg px-3 py-2 space-y-2">
                    <div className="text-sm font-medium text-gray-900">{d.documentoTitulo}</div>
                    <div className="text-[11px] text-gray-500">{d.pessoaNome}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input className="text-xs border border-gray-200 rounded-md px-2 py-1.5 w-32" placeholder="Nº da apostila"
                        value={nums[d.documentoId] || ""} onChange={(e) => setNums((p) => ({ ...p, [d.documentoId]: e.target.value }))} />
                      <input className="text-xs border border-gray-200 rounded-md px-2 py-1.5 w-28" placeholder="Data"
                        value={dates[d.documentoId] || ""} onChange={(e) => setDates((p) => ({ ...p, [d.documentoId]: e.target.value }))} />
                      <button type="button" onClick={() => setFiles((p) => ({ ...p, [d.documentoId]: `apostilado_${d.documentoId}.pdf` }))}
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-md border px-3 py-1.5 ${files[d.documentoId] ? "border-green-300 bg-green-50 text-green-700" : "border-gray-200 text-gray-700"}`}>
                        {files[d.documentoId] ? <Check className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
                        {files[d.documentoId] ? "Anexado" : "Anexar"}
                      </button>
                    </div>
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

          {/* 5) Conferir */}
          {stepId === "conferir_apostilas" && (
            <div className="space-y-3">
              {docs.map((d) => (
                <div key={d.id} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-baseline gap-2 mb-2">
                    <b className="text-sm text-gray-900">{d.documentoTitulo}</b>
                    <small className="text-[11px] text-gray-500">{d.pessoaNome}{d.apostilleNumber ? ` · Apostila ${d.apostilleNumber}` : ""}</small>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {CONF_CHK.map((c, ci) => {
                      const key = `${d.documentoId}-${ci}`
                      const on = confChk[key]
                      return (
                        <button key={ci} type="button" onClick={() => setConfChk((p) => ({ ...p, [key]: !p[key] }))}
                          className={`inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-md border px-2 py-1 ${on ? "border-green-300 bg-green-50 text-green-700" : "border-gray-200 text-gray-600"}`}>
                          <span className={`w-3.5 h-3.5 rounded flex items-center justify-center ${on ? "bg-green-500 text-white" : "border border-gray-300"}`}>{on && <Check className="w-2.5 h-2.5" />}</span>
                          {c}
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {CONF_RES.map(([v, l, tone]) => {
                      const sel = confRes[d.documentoId] === v
                      const selCls = !sel ? "border-gray-200 text-gray-700"
                        : tone === "ok" ? "border-green-400 bg-green-50 text-green-700"
                          : tone === "warn" ? "border-amber-400 bg-amber-50 text-amber-700"
                            : tone === "crit" ? "border-red-400 bg-red-50 text-red-700"
                              : "border-indigo-400 bg-indigo-50 text-indigo-700"
                      return (
                        <button key={v} type="button" onClick={() => setConfRes((p) => ({ ...p, [d.documentoId]: v }))}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-md border ${selCls}`}>{l}</button>
                      )
                    })}
                  </div>
                </div>
              ))}
              {docs.length === 0 && <div className="text-sm text-gray-500">Nenhum documento para conferir.</div>}
            </div>
          )}

          {/* 6) Validar */}
          {stepId === "validar_pasta_apostilada" && (
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
                    className={`w-full text-left border rounded-lg px-3 py-2.5 ${decision === v ? "border-indigo-500 bg-indigo-50" : "border-gray-200"}`}>
                    <div className="text-sm font-semibold text-gray-900">{l}</div>
                    <div className="text-[11px] text-gray-500">{sub}</div>
                  </button>
                ))}
              </div>
              <Field label="Parecer final (opcional)"><textarea className={EC} rows={2} value={valObs} onChange={(e) => setValObs(e.target.value)} /></Field>
            </>
          )}

          {erro && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{erro}</div>}
        </div>

        <div className="border-t border-gray-100 px-5 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-md">Cancelar</button>
          <button onClick={submit} disabled={!podeSalvar || posting}
            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {stepId === "validar_pasta_apostilada" ? "Confirmar decisão" : "Concluir etapa"}
          </button>
        </div>
      </div>
    </div>
  )
}

function Sec({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{children}</div>
}
function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5 mb-1">
        {label}{required && <span className="text-[10px] font-bold text-red-500 bg-red-50 rounded px-1.5 py-0.5">Obrigatório</span>}
      </label>
      {children}
    </div>
  )
}
function Cell({ k, v }: { k: string; v: string }) {
  return <div><div className="text-[10px] uppercase text-gray-400">{k}</div><div className="font-semibold text-gray-800">{v}</div></div>
}
function Resumo({ n, l }: { n: number; l: string }) {
  return <div className="rounded-lg border border-gray-200 py-2"><div className="text-lg font-bold text-gray-900">{n}</div><div className="text-[10px] text-gray-500">{l}</div></div>
}