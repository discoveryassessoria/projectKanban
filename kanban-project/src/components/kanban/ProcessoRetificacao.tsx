// src/components/kanban/ProcessoRetificacao.tsx
//
// Fase RETIFICAÇÃO DE REGISTROS — portada fiel do mockup Operacional_bom.html
// (initRetificationPhase / renderRetificationCentral / drawer / stepEstrategia,
// stepDossie, stepProtocolar, stepAcompanhar, stepReceberDecisao, stepValidar).
//
// Trabalha por PACOTES (PR-001...). Cada pacote tem 6 etapas (RET_STEPS), pode ser
// judicial ou administrativo, e a fase só conclui quando TODOS os pacotes estão
// validados → o backend move o card p/ "Emissão documental retificada".
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ PONTO DE CALIBRAÇÃO COM O BACKEND (engine + 3 rotas JÁ existem):           │
// │  • GET    /api/processos/[id]/retificacao            → { packages, kpis,   │
// │           progress }  — o de-para do shape está em `mapPacote()` abaixo.   │
// │  • POST   /api/processos/[id]/retificacao/pacotes    → body { tipo }       │
// │  • POST   .../retificacao/pacotes/[pkgId]/etapas/[stepId] → body = payload  │
// │           de cada etapa (ver montaPayload* nos modais).                    │
// │ Se algum campo vier vazio na tela OU o engine recusar um payload, ajuste   │
// │ SÓ `mapPacote()` e os `payload` dos modais — a UI não muda.                │
// └─────────────────────────────────────────────────────────────────────────┘

"use client"

import { useState, useEffect, useCallback, type ReactNode } from "react"
import {
  Loader2, Scale, Building2, FileText, AlertTriangle, Check, X, Plus,
  ArrowRight, Eye, Download, Trash2, Upload, Paperclip,
} from "lucide-react"

// ============================================================
// CONSTANTES (literais do mockup)
// ============================================================

// RET_STEPS
const RET_STEPS: Array<[string, string]> = [
  ["definir_estrategia", "Definir estratégia"],
  ["montar_dossie", "Montar dossiê"],
  ["protocolar", "Protocolar retificação"],
  ["acompanhar", "Acompanhar andamento"],
  ["receber_decisao", "Receber decisão / averbação"],
  ["validar_registros", "Validar registros corrigidos"],
]
const RET_SHORT = RET_STEPS.map((s) => s[1])

// RET_STATUS
const RET_STATUS: Record<string, string> = {
  em_preparacao: "Em preparação",
  protocolado: "Protocolado",
  em_exigencia: "Em exigência",
  decisao_recebida: "Decisão recebida",
  validado: "Validado",
  bloqueado: "Bloqueado",
}

const PRIORIDADES = ["Alta", "Média", "Baixa"]

// stepDossie — checklist (cosmético, 7 itens)
const DOSSIE_ITENS = [
  "Documentos base da retificação",
  "Certidões divergentes",
  "Certidões corretas / de apoio",
  "Traduções (se houver)",
  "Documento de identidade",
  "Procuração (se houver)",
  "Parecer interno",
]

// stepAcompanhar — tipos de movimentação
const MOV_TIPOS_JUD = ["despacho", "decisão interlocutória", "sentença", "manifestação", "exigência", "juntada", "audiência", "recurso", "mandado"]
const MOV_TIPOS_ADM = ["exigência do cartório", "nota devolutiva", "retorno por e-mail", "retorno por WhatsApp", "análise interna", "aguardando oficial", "aprovado", "indeferido"]

// stepReceberDecisao — resultados
const RES_JUD: Array<[string, string]> = [
  ["procedente", "Procedente"],
  ["parcial", "Parcialmente procedente"],
  ["improcedente", "Improcedente"],
  ["acordo", "Acordo / homologação"],
  ["extinto", "Extinto sem julgamento"],
]
const RES_ADM: Array<[string, string]> = [
  ["aprovado", "Aprovado"],
  ["aprovado_ressalva", "Aprovado com ressalva"],
  ["indeferido", "Indeferido"],
  ["exigencia", "Exigência pendente"],
  ["reenviar", "Reenviar pedido"],
]

// stepValidar — checklist + status por campo + decisão
const VALIDAR_CHECKS = [
  "Campo corrigido corretamente", "Nome / sobrenome conferido", "Datas conferidas",
  "Filiação conferida", "Averbação visível", "Documento apto para nova emissão", "Sem nova divergência crítica",
]
const VALIDAR_CAMPO_STATUS: Array<[string, string]> = [
  ["corrigido", "Corrigido"], ["parcial", "Parcial"], ["nao", "Não corrigido"], ["nova", "Nova divergência"],
]
const VALIDAR_DECISOES: Array<[string, string]> = [
  ["validar", "Validar pacote"],
  ["ressalva", "Validar com ressalvas"],
  ["reabrir", "Reabrir retificação"],
  ["nova_analise", "Enviar para nova análise"],
]

// stepProtocolar (adm) — canais
const CANAIS_ADM = ["Balcão", "E-mail", "CRC", "E-cartório", "WhatsApp", "Correios", "Outro"]

const SEV_LABEL: Record<string, string> = { baixa: "Leve", media: "Média", critica: "Crítica" }

// ============================================================
// TIPOS (normalizados — espelham o model RetificacaoPacote)
// ============================================================

interface RetStep { id: string; title: string; status: string; doneAt: string | null }
interface RetMovement { id: string; data: string; tipo: string; desc: string; resp: string; prox: string; exigenciaAberta?: boolean }
interface RetDecision { id: string; tipo: string; resultado: string; resTxt?: string; data: string; desc?: string; impacto?: string }
interface RetAttachment { id: string; nome: string; cat: string; data: string; por: string; obs?: string }
interface RetDivergencia { id: number; fieldLabel: string; treeValue: string; documentValue: string; severity: string; personName: string; documentTitle: string }

interface Pacote {
  id: string | number
  num: string
  tipo: "judicial" | "administrativa"
  status: string
  proxAcao: string
  motivo: string
  prioridade: string
  criadoEm: string
  ultimaMov: string
  divCount: number
  docCount: number
  respInterno: string
  respExterno: { nome: string; info: string }
  // judicial
  processo?: string
  tribunal?: string
  vara?: string
  comarca?: string
  advogado?: string
  oab?: string
  statusProc?: string
  // administrativa
  cartorio?: string
  canal?: string
  protocolo?: string
  dataProtocolo?: string
  atendente?: string
  prazo?: string
  statusAdm?: string
  // json
  workflow: RetStep[]
  movements: RetMovement[]
  decisions: RetDecision[]
  attachments: RetAttachment[]
  divergencias: RetDivergencia[]
}

interface RetKpis {
  total: number; jud: number; adm: number; proto: number; exig: number; dec: number; valid: number; bloq: number
}
interface RetData { packages: Pacote[]; kpis: RetKpis; progress: number }

interface Props {
  processoId: number
  onConcluido?: () => void
}

// ============================================================
// HELPERS
// ============================================================

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("authToken")}` })
const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() })
const EC = "w-full text-sm border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-300"

const ini = (nome: string) => {
  const p = (nome || "").trim().split(/\s+/)
  return ((p[0]?.[0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "—"
}

// ---- mapeamento defensivo do retorno do GET (AJUSTE conforme o route.ts real) ----
function mapStep(raw: Record<string, unknown>): RetStep {
  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? ""),
    status: String(raw.status ?? "bloqueada"),
    doneAt: (raw.doneAt as string) ?? null,
  }
}
function mapPacote(raw: Record<string, any>): Pacote {
  const re = raw.respExterno || {}
  return {
    id: raw.id,
    num: raw.num ?? "PR-000",
    tipo: raw.tipo === "administrativa" ? "administrativa" : "judicial",
    status: raw.status ?? "em_preparacao",
    proxAcao: raw.proxAcao ?? "Definir estratégia",
    motivo: raw.motivo ?? "",
    prioridade: raw.prioridade ?? "Média",
    criadoEm: raw.criadoEm ?? "",
    ultimaMov: raw.ultimaMov ?? "",
    divCount: raw.divCount ?? (Array.isArray(raw.divergenceIds) ? raw.divergenceIds.length : 0),
    docCount: raw.docCount ?? (Array.isArray(raw.affectedDocIds) ? raw.affectedDocIds.length : 0),
    respInterno: raw.respInterno ?? "—",
    respExterno: { nome: re.nome ?? "—", info: re.info ?? "" },
    processo: raw.processo ?? raw.processoNum ?? "",
    tribunal: raw.tribunal ?? "",
    vara: raw.vara ?? "",
    comarca: raw.comarca ?? "",
    advogado: raw.advogado ?? "",
    oab: raw.oab ?? "",
    statusProc: raw.statusProc ?? "",
    cartorio: raw.cartorio ?? "",
    canal: raw.canal ?? "",
    protocolo: raw.protocolo ?? "",
    dataProtocolo: raw.dataProtocolo ?? "",
    atendente: raw.atendente ?? "",
    prazo: raw.prazo ?? "",
    statusAdm: raw.statusAdm ?? "",
    workflow: Array.isArray(raw.workflow) ? raw.workflow.map(mapStep) : [],
    movements: Array.isArray(raw.movements) ? raw.movements : [],
    decisions: Array.isArray(raw.decisions) ? raw.decisions : [],
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    divergencias: Array.isArray(raw.divergencias) ? raw.divergencias : [],
  }
}

const pkgProgress = (pk: Pacote) =>
  Math.round((pk.workflow.filter((s) => s.status === "concluida").length / 6) * 100)
const pkgStepCur = (pk: Pacote) =>
  pk.workflow.find((s) => s.status === "pendente" || s.status === "em_andamento")

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function ProcessoRetificacao({ processoId, onConcluido }: Props) {
  const [data, setData] = useState<RetData | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | number | null>(null)
  const [drawerTab, setDrawerTab] = useState("Operação")
  const [modal, setModal] = useState<{ pkgId: string | number; stepId: string } | null>(null)
  const [tipoModal, setTipoModal] = useState(false) // modal "novo pacote"
  const [posting, setPosting] = useState(false)
  const [modalErro, setModalErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/processos/${processoId}/retificacao`, { headers: authHeaders() })
      const json = await res.json()
      const packages = Array.isArray(json.packages) ? json.packages.map(mapPacote) : []
      setData({
        packages,
        kpis: json.kpis ?? calcKpis(packages),
        progress: json.progress ?? calcProgress(packages),
      })
    } catch {
      setErro("Erro ao carregar a fase de Retificação.")
    } finally {
      setLoading(false)
    }
  }, [processoId])

  useEffect(() => { carregar() }, [carregar])

  const criarPacote = async (tipo: "judicial" | "administrativa") => {
    setTipoModal(false)
    setPosting(true); setErro(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/retificacao/pacotes`, {
        method: "POST", headers: jsonHeaders(), body: JSON.stringify({ tipo }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Não foi possível criar o pacote.")
      await carregar()
      if (json.pacote?.id ?? json.id) setFocusId(json.pacote?.id ?? json.id)
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao criar pacote.")
    } finally {
      setPosting(false)
    }
  }

  const aplicarEtapa = async (pkgId: string | number, stepId: string, payload: Record<string, unknown>) => {
    setPosting(true); setModalErro(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/retificacao/pacotes/${pkgId}/etapas/${stepId}`, {
        method: "POST", headers: jsonHeaders(), body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Não foi possível concluir a etapa.")
      setModal(null)
      if (json.completePhase) {
        setAviso("Retificação concluída — processo movido para Emissão documental retificada.")
        onConcluido?.()
      } else if (json.recordedOnly) {
        setAviso("Registro feito — a etapa não conclui o pacote (reabertura / nova análise).")
      }
      await carregar()
    } catch (e) {
      setModalErro(e instanceof Error ? e.message : "Erro ao concluir a etapa.")
    } finally {
      setPosting(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
  }
  if (!data) {
    return <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">Este processo não está na fase de Retificação de registros.</div>
  }

  const ps = data.packages
  const k = data.kpis
  const pct = data.progress
  const foco = ps.find((p) => p.id === focusId) || ps[0] || null
  const drawerPkg = focusId != null ? ps.find((p) => p.id === focusId) : null

  const kpiList: Array<[ReactNode, number, string, string]> = [
    [<Scale key="i" className="w-4 h-4" />, k.total, "Pacotes de retificação", "Total"],
    ["⚖️", k.jud, "Judicial", "Pacotes"],
    ["🏛️", k.adm, "Administrativa", "Pacotes"],
    ["📨", k.proto, "Protocolados", "Pacotes"],
    ["⏳", k.exig, "Em exigência", "Pacotes"],
    ["📡", k.dec, "Decisões recebidas", "Pacotes"],
    ["✅", k.valid, "Validados", "Pacotes"],
    ["🔒", k.bloq, "Bloqueados", "Pacotes"],
  ]

  return (
    <div className="space-y-4">
      {/* Cabeçalho + progresso */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Central Operacional · Retificação de registros</h2>
          <p className="text-sm text-gray-500">
            Objetivo: executar a retificação judicial ou administrativa para corrigir as divergências críticas.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <div className="text-sm font-bold text-gray-900">{k.valid} / {k.total} pacotes concluídos</div>
            <div className="text-[11px] text-gray-500">Status da fase</div>
          </div>
          <Donut pct={pct} color="#2563EB" size={56} />
          <div className="text-right">
            <div className="text-lg font-bold text-gray-900">{pct}%</div>
            <div className="text-[11px] text-gray-500">Progresso</div>
          </div>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
            pct >= 100 ? "bg-green-50 text-green-700" : "bg-indigo-50 text-indigo-700"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${pct >= 100 ? "bg-green-500" : "bg-indigo-500"}`} />
            {pct >= 100 ? "Concluída" : "Em andamento"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,300px] gap-4 items-start">
        {/* Coluna principal */}
        <div className="space-y-4 min-w-0">
          {/* Barra das 6 etapas do pacote em foco */}
          {foco && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-[11px] text-gray-500 mb-2">
                Workflow do pacote <b className="text-gray-700">{foco.num}</b>
              </div>
              <div className="flex items-start">
                {foco.workflow.map((s, i) => {
                  const done = s.status === "concluida"
                  const active = s.status === "em_andamento" || s.status === "pendente"
                  return (
                    <div key={s.id} className={`flex items-start ${i < foco.workflow.length - 1 ? "flex-1" : ""}`}>
                      <div className="flex flex-col items-center text-center w-[96px] shrink-0">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                          done ? "bg-green-500 text-white" : active ? "bg-indigo-600 text-white" : "bg-gray-200 text-gray-500"}`}>
                          {done ? <Check className="w-4 h-4" /> : i + 1}
                        </div>
                        <div className="mt-1.5 text-[11px] font-medium text-gray-700 leading-tight">{RET_SHORT[i]}</div>
                        <div className={`text-[10px] ${done ? "text-green-600" : active ? "text-indigo-600" : "text-gray-400"}`}>
                          {done ? "Concluída" : active ? "Em andamento" : "Pendente"}
                        </div>
                      </div>
                      {i < foco.workflow.length - 1 && <div className={`flex-1 h-0.5 mt-3.5 ${done ? "bg-green-400" : "bg-gray-200"}`} />}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 8 KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {kpiList.map(([ic, val, lbl, sub], i) => (
              <div key={i} className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                <div className="text-base leading-none">{ic}</div>
                <div className="text-xl font-bold text-gray-900 mt-1">{val}</div>
                <div className="text-[11px] text-gray-700 leading-tight">{lbl}</div>
                <div className="text-[10px] text-gray-400">{sub}</div>
              </div>
            ))}
          </div>

          {/* Alerta */}
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
            <span className="text-lg leading-none">⚠️</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-amber-900">Atenção</div>
              <p className="text-xs text-amber-800 mt-0.5">
                Existem divergências críticas que dependem da conclusão da retificação para o processo poder avançar.
              </p>
            </div>
          </div>

          {/* Tabela de pacotes */}
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">Pacotes de retificação</span>
              <span className="text-xs font-semibold text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">{ps.length}</span>
            </div>
            {ps.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">
                Nenhum pacote ainda. Crie um pacote de retificação para começar.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50">
                      {["Pacote", "Tipo", "Div.", "Docs", "Protocolo / Processo", "Status", "Responsável", "Próxima ação", ""].map((h, i) => (
                        <th key={i} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {ps.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50 align-top cursor-pointer" onClick={() => { setFocusId(p.id); setDrawerTab("Operação") }}>
                        <td className="px-3 py-2.5"><div className="font-bold text-gray-900">{p.num}</div><div className="text-[11px] text-gray-500">Criado em {p.criadoEm || "—"}</div></td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${p.tipo === "judicial" ? "text-violet-700" : "text-green-700"}`}>
                            {p.tipo === "judicial" ? <Scale className="w-3.5 h-3.5" /> : <Building2 className="w-3.5 h-3.5" />}
                            {p.tipo === "judicial" ? "Judicial" : "Administrativa"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-900">{p.divCount}</td>
                        <td className="px-3 py-2.5 text-gray-900">{p.docCount}</td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-gray-900">{p.tipo === "judicial" ? (p.processo || "—") : (p.protocolo || "—")}</div>
                          <div className="text-[11px] text-gray-400">{p.tipo === "judicial" ? `${p.tribunal || ""} ${p.vara ? "· " + p.vara : ""}` : (p.cartorio || "")}</div>
                        </td>
                        <td className="px-3 py-2.5"><RetPill status={p.status} /><div className="text-[10px] text-gray-400 mt-0.5">{p.ultimaMov || ""}</div></td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="w-7 h-7 rounded-full bg-gray-200 text-gray-600 text-[11px] font-bold flex items-center justify-center flex-shrink-0">{ini(p.respExterno.nome)}</span>
                            <div className="min-w-0"><div className="font-semibold text-gray-900 truncate">{p.respExterno.nome}</div><div className="text-[11px] text-gray-500 truncate">{p.respExterno.info}</div></div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-gray-600">{p.proxAcao}</td>
                        <td className="px-3 py-2.5 text-right"><button className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded-md px-2.5 py-1.5" onClick={(e) => { e.stopPropagation(); setFocusId(p.id); setDrawerTab("Operação") }}>Abrir</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-4 py-3 border-t border-gray-100">
              <button onClick={() => setTipoModal(true)} className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-800">
                <Plus className="w-4 h-4" /> Novo pacote de retificação
              </button>
            </div>
          </div>
        </div>

        {/* Coluna direita */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2.5">Ações rápidas</h3>
            <div className="space-y-2">
              <QBtn icon={<Plus className="w-4 h-4 text-gray-400" />} onClick={() => setTipoModal(true)}>Novo pacote de retificação</QBtn>
              <QBtn icon={<FileText className="w-4 h-4 text-gray-400" />} onClick={() => setAviso("Modelo de petição judicial — em breve.")}>Modelo de petição judicial</QBtn>
              <QBtn icon={<FileText className="w-4 h-4 text-gray-400" />} onClick={() => setAviso("Modelo de requerimento administrativo — em breve.")}>Modelo de requerimento administrativo</QBtn>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2.5">Pacotes em destaque</h3>
            <div className="space-y-2">
              {ps.slice(0, 2).map((p) => (
                <button key={p.id} onClick={() => { setFocusId(p.id); setDrawerTab("Operação") }} className="w-full text-left flex items-start gap-2 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${p.tipo === "judicial" ? "bg-violet-100 text-violet-700" : "bg-green-100 text-green-700"}`}>
                    {p.tipo === "judicial" ? <Scale className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <b className="text-xs text-gray-900">{p.num} · {p.tipo === "judicial" ? "Judicial" : "Administrativa"}</b>
                      <RetPill status={p.status} small />
                    </div>
                    <div className="text-[11px] text-gray-500 truncate">{p.tipo === "judicial" ? `Processo: ${p.processo || "—"}` : `Protocolo: ${p.protocolo || "—"}`}</div>
                    <div className="text-[11px] text-gray-400">{p.divCount} divergência(s) · {p.docCount} doc.</div>
                  </div>
                </button>
              ))}
              {ps.length === 0 && <div className="text-xs text-gray-400">Sem pacotes.</div>}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2.5">Alertas</h3>
            <div className="space-y-2 text-xs">
              {k.exig > 0 && <div className="flex items-center gap-2 text-orange-700 bg-orange-50 rounded-lg px-3 py-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {k.exig} pacote(s) em exigência</div>}
              <div className="flex items-center gap-2 text-amber-700 bg-amber-50 rounded-lg px-3 py-2"><AlertTriangle className="w-4 h-4 shrink-0" /> Divergências críticas aguardando correção</div>
              <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-lg px-3 py-2"><Check className="w-4 h-4 shrink-0" /> {k.valid} pacote(s) validado(s)</div>
            </div>
          </div>
        </aside>
      </div>

      {erro && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{erro}</div>}
      {aviso && <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 text-sm text-indigo-700">{aviso}</div>}

      {/* Modal "novo pacote" — escolha do tipo */}
      {tipoModal && (
        <ModalShell onClose={() => setTipoModal(false)} title="Novo pacote de retificação" sub="Escolha o tipo de retificação" maxW="max-w-md">
          <div className="grid grid-cols-1 gap-3">
            <button onClick={() => criarPacote("judicial")} className="flex items-center gap-3 border border-gray-200 rounded-lg px-4 py-3 text-left hover:border-violet-400 hover:bg-violet-50">
              <span className="w-9 h-9 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center"><Scale className="w-5 h-5" /></span>
              <div><b className="block text-sm text-gray-900">Judicial</b><span className="text-xs text-gray-500">Processo judicial de retificação</span></div>
            </button>
            <button onClick={() => criarPacote("administrativa")} className="flex items-center gap-3 border border-gray-200 rounded-lg px-4 py-3 text-left hover:border-green-400 hover:bg-green-50">
              <span className="w-9 h-9 rounded-lg bg-green-100 text-green-700 flex items-center justify-center"><Building2 className="w-5 h-5" /></span>
              <div><b className="block text-sm text-gray-900">Administrativa</b><span className="text-xs text-gray-500">Retificação em cartório / via administrativa</span></div>
            </button>
          </div>
        </ModalShell>
      )}

      {/* Drawer do pacote */}
      {drawerPkg && (
        <PacoteDrawer
          pk={drawerPkg}
          tab={drawerTab}
          onTab={setDrawerTab}
          onClose={() => setFocusId(null)}
          onAbrirEtapa={(stepId) => setModal({ pkgId: drawerPkg.id, stepId })}
        />
      )}

      {/* Modais das etapas */}
      {modal && drawerPkg && (
        <EtapaModal
          key={modal.stepId}
          stepId={modal.stepId}
          pk={drawerPkg}
          posting={posting}
          erro={modalErro}
          onClose={() => { setModal(null); setModalErro(null) }}
          onSubmit={(payload) => aplicarEtapa(modal.pkgId, modal.stepId, payload)}
        />
      )}
    </div>
  )
}

// ============================================================
// KPIs / progresso — fallback client-side se o GET não trouxer
// ============================================================
function calcKpis(ps: Pacote[]): RetKpis {
  return {
    total: ps.length,
    jud: ps.filter((p) => p.tipo === "judicial").length,
    adm: ps.filter((p) => p.tipo === "administrativa").length,
    proto: ps.filter((p) => ["protocolado", "em_exigencia", "decisao_recebida", "validado"].includes(p.status)).length,
    exig: ps.filter((p) => p.status === "em_exigencia").length,
    dec: ps.filter((p) => p.status === "decisao_recebida" || p.status === "validado").length,
    valid: ps.filter((p) => p.status === "validado").length,
    bloq: ps.filter((p) => p.status === "bloqueado").length,
  }
}
function calcProgress(ps: Pacote[]): number {
  if (!ps.length) return 0
  return Math.round(ps.reduce((a, p) => a + pkgProgress(p), 0) / ps.length)
}

// ============================================================
// SUBCOMPONENTES DE UI
// ============================================================

function Donut({ pct, color, size = 62 }: { pct: number; color: string; size?: number }) {
  const r = size / 2 - 6
  const c = 2 * Math.PI * r
  const off = c * (1 - pct / 100)
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={6} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  )
}

function RetPill({ status, small }: { status: string; small?: boolean }) {
  const map: Record<string, string> = {
    em_preparacao: "bg-gray-100 text-gray-600",
    protocolado: "bg-violet-50 text-violet-700",
    em_exigencia: "bg-amber-50 text-amber-700",
    decisao_recebida: "bg-blue-50 text-blue-700",
    validado: "bg-green-50 text-green-700",
    bloqueado: "bg-red-50 text-red-700",
  }
  return (
    <span className={`inline-flex items-center rounded-full font-semibold ${small ? "text-[10px] px-2 py-0.5" : "text-xs px-2 py-0.5"} ${map[status] || "bg-gray-100 text-gray-600"}`}>
      {RET_STATUS[status] || status}
    </span>
  )
}

function QBtn({ icon, onClick, children }: { icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="w-full text-left text-sm text-gray-700 hover:bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 inline-flex items-center gap-2">
      {icon} {children}
    </button>
  )
}

// ============================================================
// DRAWER DO PACOTE (9 abas, fiel ao mockup)
// ============================================================

const DRAWER_TABS = ["Operação", "Workflow", "Divergências", "Documentos", "Anexos", "Protocolo / Processo", "Movimentações", "Decisões", "Histórico"]

function PacoteDrawer({ pk, tab, onTab, onClose, onAbrirEtapa }: {
  pk: Pacote
  tab: string
  onTab: (t: string) => void
  onClose: () => void
  onAbrirEtapa: (stepId: string) => void
}) {
  const jud = pk.tipo === "judicial"
  const prog = pkgProgress(pk)
  const cur = pkgStepCur(pk)
  const concluidas = pk.workflow.filter((s) => s.status === "concluida").length

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white h-full shadow-xl overflow-y-auto flex flex-col">
        {/* Header */}
        <div className={`px-5 py-4 ${jud ? "bg-violet-50" : "bg-green-50"}`}>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 float-right p-1"><X className="w-5 h-5" /></button>
          <div className={`text-[11px] font-semibold uppercase tracking-wider ${jud ? "text-violet-700" : "text-green-700"}`}>Retificação {jud ? "judicial" : "administrativa"}</div>
          <h3 className="text-base font-bold text-gray-900 mt-0.5">Pacote de retificação {pk.num}</h3>
          <div className="text-xs text-gray-500">{pk.divCount} divergência(s) · {pk.docCount} documento(s) afetado(s)</div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <MetaCell k="Status"><RetPill status={pk.status} /></MetaCell>
            <MetaCell k="Resp. interno"><b className="text-gray-800 text-xs">{pk.respInterno}</b></MetaCell>
            <MetaCell k="Resp. externo"><b className="text-gray-800 text-xs">{pk.respExterno.nome}</b></MetaCell>
            <MetaCell k="Próxima ação"><b className="text-gray-800 text-xs">{pk.proxAcao}</b></MetaCell>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-100 px-3 flex gap-1 overflow-x-auto">
          {DRAWER_TABS.map((t) => (
            <button key={t} onClick={() => onTab(t)} className={`px-2.5 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 ${t === tab ? "border-indigo-600 text-indigo-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>{t}</button>
          ))}
        </div>

        {/* Body */}
        <div className="p-5 flex-1">
          {tab === "Operação" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div><b className="text-sm text-gray-900">Workflow do pacote</b><div className="text-[11px] text-gray-500">{concluidas}/6 etapas concluídas</div></div>
                <b className="text-sm text-gray-900">{prog}%</b>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: `${prog}%` }} /></div>
              {pk.status === "validado" ? (
                <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
                  <div className="w-9 h-9 mx-auto rounded-full bg-green-500 text-white flex items-center justify-center mb-2"><Check className="w-5 h-5" /></div>
                  <h4 className="text-sm font-bold text-gray-900">Pacote validado</h4>
                  <p className="text-xs text-gray-600">Registros corrigidos validados. Documentos afetados marcados para nova emissão.</p>
                </div>
              ) : cur ? (
                <div className="rounded-lg border border-gray-200 p-4 text-center">
                  <div className="w-9 h-9 mx-auto rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center mb-2 font-bold">{pk.workflow.findIndex((s) => s.id === cur.id) + 1}</div>
                  <h4 className="text-sm font-bold text-gray-900">{cur.title}</h4>
                  <p className="text-xs text-gray-600 mb-3">Etapa atual do pacote. Abra para registrar dados e concluir.</p>
                  <button onClick={() => onAbrirEtapa(cur.id)} className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md inline-flex items-center gap-2">Abrir etapa <ArrowRight className="w-4 h-4" /></button>
                </div>
              ) : null}
            </div>
          )}

          {tab === "Workflow" && (
            <div className="space-y-2">
              {pk.workflow.map((s, i) => {
                const done = s.status === "concluida"
                const active = s.status === "em_andamento" || s.status === "pendente"
                return (
                  <div key={s.id} className="flex items-center gap-3 border border-gray-200 rounded-lg px-3 py-2.5">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${done ? "bg-green-100 text-green-700" : active ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-400"}`}>{done ? "✓" : i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">{s.title}</div>
                      <div className="text-[11px] text-gray-500">{done ? `concluída${s.doneAt ? " · " + s.doneAt : ""}` : active ? (s.status === "em_andamento" ? "em andamento" : "pendente · clique para abrir") : "bloqueada"}</div>
                    </div>
                    {active && <button onClick={() => onAbrirEtapa(s.id)} className="text-xs font-semibold text-indigo-600 border border-indigo-200 rounded-md px-2.5 py-1.5">Abrir</button>}
                  </div>
                )
              })}
            </div>
          )}

          {tab === "Divergências" && (
            pk.divergencias.length ? (
              <div className="space-y-2">
                {pk.divergencias.map((d) => (
                  <div key={d.id} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <b className="text-sm text-gray-900">{d.fieldLabel}</b>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${d.severity === "critica" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{SEV_LABEL[d.severity] || d.severity}</span>
                    </div>
                    <div className="flex flex-col gap-0.5 text-xs text-gray-600">
                      <span>Árvore: <b className="text-gray-900">{d.treeValue}</b></span>
                      <span>Documento: <b className="text-gray-900">{d.documentValue}</b></span>
                    </div>
                    <div className="text-[11px] text-gray-400 mt-1">{d.personName} · {d.documentTitle}</div>
                  </div>
                ))}
              </div>
            ) : <Meta>{pk.divCount} divergência(s) incluída(s) neste pacote.</Meta>
          )}

          {tab === "Documentos" && <Meta>{pk.docCount} documento(s) afetado(s) — serão marcados para nova emissão ao validar o pacote.</Meta>}

          {tab === "Anexos" && (
            pk.attachments.length ? (
              <div className="space-y-2">
                {pk.attachments.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 border border-gray-200 rounded-lg px-3 py-2">
                    <Paperclip className="w-4 h-4 text-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0"><b className="text-sm text-gray-900 block truncate">{a.nome}</b><small className="text-[11px] text-gray-500">{a.cat} · {a.data} · {a.por}</small></div>
                    <div className="flex items-center gap-1 text-gray-400">
                      <button title="Ver" className="hover:text-indigo-600 p-1"><Eye className="w-4 h-4" /></button>
                      <button title="Baixar" className="hover:text-indigo-600 p-1"><Download className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            ) : <Meta>Sem anexos ainda.</Meta>
          )}

          {tab === "Protocolo / Processo" && (
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
              {jud ? (
                <>
                  <FieldRow k="Número do processo" v={pk.processo} />
                  <FieldRow k="Tribunal / comarca" v={`${pk.tribunal || "—"} · ${pk.comarca || "—"}`} />
                  <FieldRow k="Vara" v={pk.vara} />
                  <FieldRow k="Advogado" v={`${pk.advogado || "—"} ${pk.oab ? "· " + pk.oab : ""}`} />
                  <FieldRow k="Status processual" v={pk.statusProc} />
                </>
              ) : (
                <>
                  <FieldRow k="Cartório / órgão" v={pk.cartorio} />
                  <FieldRow k="Canal" v={pk.canal} />
                  <FieldRow k="Protocolo" v={pk.protocolo} />
                  <FieldRow k="Data do protocolo" v={pk.dataProtocolo} />
                  <FieldRow k="Atendente" v={pk.atendente} />
                  <FieldRow k="Status administrativo" v={pk.statusAdm} />
                </>
              )}
            </div>
          )}

          {tab === "Movimentações" && (
            pk.movements.length ? (
              <div className="space-y-3">
                {pk.movements.map((m) => (
                  <div key={m.id} className={`border-l-2 pl-3 ${m.exigenciaAberta ? "border-amber-400" : "border-gray-200"}`}>
                    <div className="flex items-center justify-between gap-2"><b className="text-sm text-gray-900">{m.tipo}</b><small className="text-[11px] text-gray-500">{m.data}</small></div>
                    <p className="text-xs text-gray-600">{m.desc}</p>
                    <small className="text-[11px] text-gray-400">Por {m.resp}{m.prox ? " · Próxima: " + m.prox : ""}</small>
                  </div>
                ))}
              </div>
            ) : <Meta>Sem movimentações.</Meta>
          )}

          {tab === "Decisões" && (
            pk.decisions.length ? (
              <div className="space-y-2">
                {pk.decisions.map((d) => (
                  <div key={d.id} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2 mb-1"><b className="text-sm text-gray-900">{d.tipo}</b><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${d.resultado === "procedente" || d.resultado === "aprovado" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>{d.resTxt || d.resultado}</span></div>
                    {d.desc && <p className="text-xs text-gray-600">{d.desc}</p>}
                    <small className="text-[11px] text-gray-400">{d.data}{d.impacto ? " · " + d.impacto : ""}</small>
                  </div>
                ))}
              </div>
            ) : <Meta>Nenhuma decisão registrada.</Meta>
          )}

          {tab === "Histórico" && <Meta>Histórico do pacote — registrado no histórico geral do processo.</Meta>}
        </div>
      </div>
    </div>
  )
}

function MetaCell({ k, children }: { k: string; children: ReactNode }) {
  return <div><div className="text-[10px] uppercase text-gray-400">{k}</div><div>{children}</div></div>
}
function FieldRow({ k, v }: { k: string; v?: string }) {
  return <div className="flex justify-between px-3 py-2"><span className="text-gray-500">{k}</span><span className="font-medium text-gray-900 text-right">{v || "—"}</span></div>
}
function Meta({ children }: { children: ReactNode }) {
  return <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5 text-xs text-gray-600">{children}</div>
}

// ============================================================
// MODAIS DAS ETAPAS
// (espelham stepEstrategia / stepDossie / stepProtocolar /
//  stepAcompanhar / stepReceberDecisao / stepValidar)
// ============================================================

function EtapaModal({ stepId, pk, posting, erro, onClose, onSubmit }: {
  stepId: string
  pk: Pacote
  posting: boolean
  erro: string | null
  onClose: () => void
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const jud = pk.tipo === "judicial"
  const num = RET_STEPS.findIndex((s) => s[0] === stepId) + 1
  const title = RET_SHORT[num - 1]

  // estratégia
  const [tipo, setTipo] = useState<"judicial" | "administrativa">(pk.tipo)
  const [motivo, setMotivo] = useState(pk.motivo || "")
  const [respInterno, setRespInterno] = useState(pk.respInterno && pk.respInterno !== "—" ? pk.respInterno : "")
  const [respExterno, setRespExterno] = useState(pk.respExterno.nome && pk.respExterno.nome !== "—" ? pk.respExterno.nome : "")
  const [prioridade, setPrioridade] = useState(pk.prioridade || "Média")

  // dossiê
  const [dossieChk, setDossieChk] = useState<Record<number, boolean>>({})
  const [dossieObs, setDossieObs] = useState("")

  // protocolar
  const [p1, setP1] = useState(jud ? (pk.processo || "") : (pk.cartorio || ""))
  const [p2, setP2] = useState(jud ? (pk.tribunal || "") : (pk.canal || "Balcão"))
  const [p3, setP3] = useState(jud ? (pk.vara || "") : (pk.protocolo || ""))
  const [p4, setP4] = useState(jud ? (pk.advogado || "") : (pk.atendente || ""))
  const [p5, setP5] = useState("")
  const [protoFile, setProtoFile] = useState(false)

  // acompanhar (movimentação)
  const [movData, setMovData] = useState("")
  const [movTipo, setMovTipo] = useState((jud ? MOV_TIPOS_JUD : MOV_TIPOS_ADM)[0])
  const [movDesc, setMovDesc] = useState("")
  const [movResp, setMovResp] = useState(pk.respInterno && pk.respInterno !== "—" ? pk.respInterno : "")
  const [movProx, setMovProx] = useState("")

  // receber decisão
  const [resultado, setResultado] = useState((jud ? RES_JUD : RES_ADM)[0][0])
  const [decData, setDecData] = useState("")
  const [decCart, setDecCart] = useState("")
  const [decObs, setDecObs] = useState("")
  const [decFile, setDecFile] = useState(false)

  // validar
  const [campoStatus, setCampoStatus] = useState<Record<number, string>>({})
  const [campoVal, setCampoVal] = useState<Record<number, string>>({})
  const [valChk, setValChk] = useState<Record<number, boolean>>({})
  const [valDec, setValDec] = useState("validar")

  // ---- gates ----
  const podeSalvar =
    stepId === "definir_estrategia" ? !!motivo.trim()
      : stepId === "montar_dossie" ? true
        : stepId === "protocolar" ? !!p1.trim() && protoFile
          : stepId === "acompanhar" ? !!movDesc.trim()
            : stepId === "receber_decisao" ? !!resultado && decFile
              : stepId === "validar_registros" ? !!valDec
                : false

  // ---- payloads (calibrar campos com o engine se necessário) ----
  const submit = () => {
    if (stepId === "definir_estrategia")
      return onSubmit({ tipo, motivo, respInterno, respExterno: { nome: respExterno || "—", info: "" }, prioridade, proxAcao: "Montar dossiê" })
    if (stepId === "montar_dossie")
      return onSubmit({ checklist: Object.keys(dossieChk).filter((k) => dossieChk[+k]), obs: dossieObs, proxAcao: "Protocolar retificação" })
    if (stepId === "protocolar")
      return onSubmit(jud
        ? { processo: p1, tribunal: p2, vara: p3, advogado: p4, dataProtocolo: p5, statusProc: "Distribuído", anexo: true, proxAcao: "Acompanhar andamento" }
        : { cartorio: p1, canal: p2, protocolo: p3, atendente: p4, dataProtocolo: p5, statusAdm: "Protocolado", anexo: true, proxAcao: "Acompanhar andamento" })
    if (stepId === "acompanhar")
      return onSubmit({ movData: movData, movTipo, movDesc, movResp, movProx, proxAcao: "Receber decisão / averbação" })
    if (stepId === "receber_decisao")
      return onSubmit({ resultado, data: decData, cartorio: decCart, obs: decObs, anexo: true, proxAcao: "Validar registros corrigidos" })
    if (stepId === "validar_registros")
      return onSubmit({ decisao: valDec, campos: { status: campoStatus, valores: campoVal }, checklist: Object.keys(valChk).filter((k) => valChk[+k]) })
  }

  return (
    <ModalShell onClose={onClose} eyebrow={`Etapa ${num} de 6 · Workflow da Retificação`} title={`${title} · ${pk.num}`} maxW="max-w-lg">
      <div className="space-y-4">
        {/* 1) Definir estratégia */}
        {stepId === "definir_estrategia" && (
          <>
            <Field label="Tipo de retificação">
              <div className="flex gap-2">
                {(["judicial", "administrativa"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setTipo(t)} className={`flex-1 px-3 py-2 text-xs font-semibold rounded-md border ${tipo === t ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-200 text-gray-700"}`}>{t === "judicial" ? "Judicial" : "Administrativa"}</button>
                ))}
              </div>
            </Field>
            <Field label="Motivo da retificação" required><textarea className={EC} rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Responsável interno"><input className={EC} value={respInterno} onChange={(e) => setRespInterno(e.target.value)} /></Field>
              <Field label="Responsável externo"><input className={EC} value={respExterno} onChange={(e) => setRespExterno(e.target.value)} placeholder="Advogado / cartório" /></Field>
            </div>
            <Field label="Prioridade">
              <select className={EC} value={prioridade} onChange={(e) => setPrioridade(e.target.value)}>
                {PRIORIDADES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
          </>
        )}

        {/* 2) Montar dossiê */}
        {stepId === "montar_dossie" && (
          <>
            <Sec>Documentos que sustentam a retificação</Sec>
            <div className="space-y-2">
              {DOSSIE_ITENS.map((it, i) => (
                <button key={i} type="button" onClick={() => setDossieChk((p) => ({ ...p, [i]: !p[i] }))} className={`w-full flex items-center gap-2 border rounded-lg px-3 py-2 text-sm text-left ${dossieChk[i] ? "border-green-300 bg-green-50 text-green-700" : "border-gray-200 text-gray-700"}`}>
                  <span className={`w-4 h-4 rounded flex items-center justify-center ${dossieChk[i] ? "bg-green-500 text-white" : "border border-gray-300"}`}>{dossieChk[i] && <Check className="w-3 h-3" />}</span>{it}
                </button>
              ))}
            </div>
            <Field label="Observações"><textarea className={EC} rows={2} value={dossieObs} onChange={(e) => setDossieObs(e.target.value)} placeholder="Notas sobre o dossiê montado..." /></Field>
          </>
        )}

        {/* 3) Protocolar */}
        {stepId === "protocolar" && (
          <>
            {jud ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Número do processo"><input className={EC} value={p1} onChange={(e) => setP1(e.target.value)} placeholder="100XXXX-00.2026.8.26.0000" /></Field>
                  <Field label="Tribunal / comarca"><input className={EC} value={p2} onChange={(e) => setP2(e.target.value)} placeholder="TJSP · São Paulo" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Vara"><input className={EC} value={p3} onChange={(e) => setP3(e.target.value)} placeholder="2ª Vara Cível" /></Field>
                  <Field label="Advogado / OAB"><input className={EC} value={p4} onChange={(e) => setP4(e.target.value)} placeholder="Adv. · OAB/SP 000.000" /></Field>
                </div>
                <Field label="Data do protocolo"><input className={EC} value={p5} onChange={(e) => setP5(e.target.value)} placeholder="dd/mm/aaaa" /></Field>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Cartório / órgão"><input className={EC} value={p1} onChange={(e) => setP1(e.target.value)} placeholder="Cartório de Registro Civil X" /></Field>
                  <Field label="Canal"><select className={EC} value={p2} onChange={(e) => setP2(e.target.value)}>{CANAIS_ADM.map((c) => <option key={c}>{c}</option>)}</select></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nº do protocolo"><input className={EC} value={p3} onChange={(e) => setP3(e.target.value)} placeholder="CART-2026-00000" /></Field>
                  <Field label="Atendente"><input className={EC} value={p4} onChange={(e) => setP4(e.target.value)} placeholder="Responsável externo" /></Field>
                </div>
                <Field label="Data do protocolo"><input className={EC} value={p5} onChange={(e) => setP5(e.target.value)} placeholder="dd/mm/aaaa" /></Field>
              </>
            )}
            <Field label="Anexo do protocolo" required>
              <FakeFile ok={protoFile} onClick={() => setProtoFile(true)} label={jud ? "Anexar petição inicial / protocolo" : "Anexar requerimento / comprovante"} okLabel="protocolo.pdf · anexado" />
            </Field>
          </>
        )}

        {/* 4) Acompanhar (movimentação) */}
        {stepId === "acompanhar" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Data"><input className={EC} value={movData} onChange={(e) => setMovData(e.target.value)} placeholder="dd/mm/aaaa" /></Field>
              <Field label="Tipo"><select className={EC} value={movTipo} onChange={(e) => setMovTipo(e.target.value)}>{(jud ? MOV_TIPOS_JUD : MOV_TIPOS_ADM).map((t) => <option key={t}>{t}</option>)}</select></Field>
            </div>
            <Field label="Descrição" required><textarea className={EC} rows={2} value={movDesc} onChange={(e) => setMovDesc(e.target.value)} placeholder="O que aconteceu nesta movimentação..." /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Responsável"><input className={EC} value={movResp} onChange={(e) => setMovResp(e.target.value)} /></Field>
              <Field label="Próxima ação"><input className={EC} value={movProx} onChange={(e) => setMovProx(e.target.value)} placeholder="ex: aguardar decisão" /></Field>
            </div>
            <div className="text-[11px] text-gray-500">Ao concluir, o pacote avança para <b>Receber decisão / averbação</b>.</div>
          </>
        )}

        {/* 5) Receber decisão / averbação */}
        {stepId === "receber_decisao" && (
          <>
            <Field label={`Resultado ${jud ? "judicial" : "administrativo"}`}>
              <select className={EC} value={resultado} onChange={(e) => setResultado(e.target.value)}>
                {(jud ? RES_JUD : RES_ADM).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Data da decisão"><input className={EC} value={decData} onChange={(e) => setDecData(e.target.value)} placeholder="dd/mm/aaaa" /></Field>
              <Field label={jud ? "Cartórios que devem averbar" : "Cartório que averbou"}><input className={EC} value={decCart} onChange={(e) => setDecCart(e.target.value)} placeholder="Cartório X" /></Field>
            </div>
            <Field label="Observação"><textarea className={EC} rows={2} value={decObs} onChange={(e) => setDecObs(e.target.value)} /></Field>
            <Field label={`Anexo da ${jud ? "sentença / mandado" : "averbação"}`} required>
              <FakeFile ok={decFile} onClick={() => setDecFile(true)} label={jud ? "Anexar sentença / mandado de averbação" : "Anexar termo de averbação"} okLabel={jud ? "sentenca.pdf · anexado" : "termo_averbacao.pdf · anexado"} />
            </Field>
          </>
        )}

        {/* 6) Validar registros corrigidos */}
        {stepId === "validar_registros" && (
          <>
            {pk.divergencias.length > 0 && (
              <>
                <Sec>Conferência por campo</Sec>
                <div className="space-y-2">
                  {pk.divergencias.map((d, i) => (
                    <div key={d.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
                      <b className="text-sm text-gray-900">{d.fieldLabel}</b>
                      <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                        <span>Antigo: <b className="text-gray-700">{d.documentValue}</b></span>
                        <span>Esperado: <b className="text-gray-700">{d.treeValue}</b></span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input className="text-xs border border-gray-200 rounded-md px-2 py-1.5" placeholder="Encontrado" value={campoVal[i] ?? d.treeValue} onChange={(e) => setCampoVal((p) => ({ ...p, [i]: e.target.value }))} />
                        <select className="text-xs border border-gray-200 rounded-md px-2 py-1.5" value={campoStatus[i] ?? "corrigido"} onChange={(e) => setCampoStatus((p) => ({ ...p, [i]: e.target.value }))}>
                          {VALIDAR_CAMPO_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <Sec>Checklist</Sec>
            <div className="flex flex-wrap gap-1.5">
              {VALIDAR_CHECKS.map((c, i) => (
                <button key={i} type="button" onClick={() => setValChk((p) => ({ ...p, [i]: !p[i] }))} className={`inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-md border px-2 py-1 ${valChk[i] ? "border-green-300 bg-green-50 text-green-700" : "border-gray-200 text-gray-600"}`}>
                  <span className={`w-3.5 h-3.5 rounded flex items-center justify-center ${valChk[i] ? "bg-green-500 text-white" : "border border-gray-300"}`}>{valChk[i] && <Check className="w-2.5 h-2.5" />}</span>{c}
                </button>
              ))}
            </div>
            <Field label="Decisão final">
              <select className={EC} value={valDec} onChange={(e) => setValDec(e.target.value)}>
                {VALIDAR_DECISOES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            {(valDec === "reabrir" || valDec === "nova_analise") && (
              <div className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Essa opção apenas registra — não valida o pacote nem avança a fase.</div>
            )}
          </>
        )}

        {erro && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{erro}</div>}
      </div>

      <div className="border-t border-gray-100 px-5 py-3 -mx-5 -mb-5 mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-md">Cancelar</button>
        <button onClick={submit} disabled={!podeSalvar || posting} className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
          {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {stepId === "validar_registros" ? "Finalizar pacote" : stepId === "acompanhar" ? "Adicionar e avançar" : "Concluir etapa"}
        </button>
      </div>
    </ModalShell>
  )
}

// ============================================================
// SHELLS / CAMPOS
// ============================================================

function ModalShell({ children, onClose, title, sub, eyebrow, maxW = "max-w-lg" }: {
  children: ReactNode
  onClose: () => void
  title: string
  sub?: string
  eyebrow?: string
  maxW?: string
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={`relative w-full ${maxW} bg-white rounded-xl shadow-xl max-h-[85vh] flex flex-col`}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100">
          <div>
            {eyebrow && <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">{eyebrow}</div>}
            <h3 className="text-base font-bold text-gray-900 mt-0.5">{title}</h3>
            {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
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
function FakeFile({ ok, onClick, label, okLabel }: { ok: boolean; onClick: () => void; label: string; okLabel: string }) {
  return (
    <button type="button" onClick={onClick} className={`w-full inline-flex items-center gap-2 text-sm font-semibold rounded-md border px-3 py-2.5 ${ok ? "border-green-300 bg-green-50 text-green-700" : "border-gray-200 text-gray-700"}`}>
      {ok ? <Check className="w-4 h-4" /> : <Upload className="w-4 h-4" />}{ok ? okLabel : label}
    </button>
  )
}