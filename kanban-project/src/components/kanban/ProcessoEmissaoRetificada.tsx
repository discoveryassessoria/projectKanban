// src/components/kanban/ProcessoEmissaoRetificada.tsx
//
// Fase EMISSÃO DOCUMENTAL RETIFICADA — portada fiel do mockup Operacional_bom.html
// (retifiedEmissionLayout / renderRetifiedEmissionCentral / drawer / reStepAverbacao,
// reStepSolicitar, reStepAguardar, reStepReceber, reStepConferir, reStepValidar).
//
// Fase POR DOCUMENTO: emite de novo só os documentos impactados pela retificação.
// Cada documento tem seu próprio workflow de 6 etapas (RE_STEPS). A fase só conclui
// quando TODAS as certidões retificadas forem validadas → backend move o card p/
// "Tradução juramentada".
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ PONTO DE CALIBRAÇÃO COM O BACKEND (engine + rotas AINDA NÃO existem — esta │
// │ fase é o padrão por-documento, igual Tradução/Apostilamento adaptado):     │
// │  • GET  /api/processos/[id]/emissao-retificada  → { documentos, progress } │
// │         (de-para do shape em `mapDoc()` abaixo).                            │
// │  • POST .../emissao-retificada/documentos/[docId]/etapas/[stepId]           │
// │         → body = payload de cada etapa (ver submit nos modais).             │
// │ Espelhe traducao/route.ts + traducao/etapas/[stepId]/route.ts (mesmo       │
// │ padrão). Ajuste SÓ `mapDoc()` e os payloads se o engine usar outros nomes. │
// └─────────────────────────────────────────────────────────────────────────┘

"use client"

import { useState, useEffect, useCallback, type ReactNode, useMemo } from "react"
import {
  Loader2, FileText, AlertTriangle, Check, X, ArrowRight, Upload,
  Eye, Download, CheckCircle2,
} from "lucide-react"
import { useApi } from "@/src/lib/dados"

// ============================================================
// CONSTANTES (literais do mockup)
// ============================================================

// RE_STEPS
const RE_STEPS: Array<[string, string]> = [
  ["enviar_pedido_averbacao", "Enviar pedido de averbação ao cartório"],
  ["solicitar_certidao_retificada", "Solicitar certidão retificada"],
  ["aguardar_retorno_cartorio_retificado", "Aguardar retorno do cartório"],
  ["receber_certidao_retificada", "Receber certidão retificada"],
  ["conferir_certidao_retificada", "Conferir certidão retificada"],
  ["validar_certidao_retificada", "Validar certidão retificada"],
]
// RE_SHORT
const RE_SHORT = ["Pedido de averbação", "Solicitar certidão retificada", "Aguardar retorno", "Receber certidão", "Conferir certidão", "Validar certidão"]
// RE_LABEL (status do documento → rótulo)
const RE_LABEL: Record<string, string> = {
  pendente_averbacao: "Pendente averbação",
  averbacao_enviada: "Averbação enviada",
  a_solicitar: "A solicitar",
  solicitada: "Solicitada",
  aguardando_retorno_concluido: "Retorno recebido",
  recebida: "Recebida",
  conferida: "Conferida",
  validada: "Validada",
  bloqueada: "Bloqueada",
  divergente: "Divergente",
  nova_via: "Nova via",
  reabrir_averbacao: "Reabrir averbação",
}
const DOCT: Record<string, string> = { nascimento: "Certidão de Nascimento", casamento: "Certidão de Casamento", obito: "Certidão de Óbito" }

// reStepAverbacao — canais
const CANAIS_AVERB: Array<[string, string]> = [
  ["balcao", "Balcão"], ["email", "E-mail"], ["crc", "CRC"], ["ecart", "E-cartório"],
  ["whats", "WhatsApp"], ["correios", "Correios"], ["adv", "Advogado/parceiro"], ["outro", "Outro"],
]
// reStepSolicitar — canais
const CANAIS_SOLIC: Array<[string, string]> = [
  ["crc", "CRC Nacional"], ["ecart", "E-cartório"], ["email", "E-mail"], ["whats", "WhatsApp"],
  ["balcao", "Balcão"], ["comune", "Comune italiana"], ["correios", "Correios"], ["consulado", "Consulado"],
]
// reStepReceber — tipo de mídia
const MIDIAS: Array<[string, string]> = [["fisico", "📄 Físico (papel original)"], ["digital", "💻 Digital (PDF eletrônico)"], ["ambos", "📄💻 Ambos"]]
// reStepConferir — checklist + resultados
const CONF_CHK: Array<[string, string]> = [
  ["averb", "Averbação aparece na certidão"], ["campo", "Campo divergente foi corrigido"], ["valor", "Valor correto está presente"],
  ["leg", "Documento legível"], ["min", "Dados mínimos presentes"], ["nova", "Sem nova divergência crítica"],
]
const CONF_RES: Array<[string, string, string, string]> = [
  ["aprovar", "Aprovar", "libera Validar", "ok"],
  ["divergente", "Divergente", "não libera", "warn"],
  ["nova_via", "Nova via", "volta solicitar", "neutral"],
]
// reStepValidar — decisões
const VAL_DECS: Array<[string, string, string, string]> = [
  ["aprovado", "✓ Aprovado", "Documento corrigido serve · status VALIDADO · workflow finaliza", "ok"],
  ["aprovado_ressalvas", "! Aprovado com ressalvas", "Serve com observações · workflow finaliza", ""],
  ["nova_via", "➤ Solicitar nova via", "Pedir nova certidão retificada · workflow volta", ""],
  ["reabrir_averbacao", "↺ Reabrir averbação", "Correção não aplicada · volta para averbação", ""],
]

// ============================================================
// TIPOS (normalizados)
// ============================================================

interface ReStep { id: string; title: string; status: string; doneAt: string | null }
interface ReCorrecao { campo: string; old: string; novo: string }
interface ReDoc {
  id: string | number
  documentoId: number
  pessoaNome: string
  pessoaGen: string
  pessoaPapel: string
  documentoTitulo: string       // DOCT[tipo]
  correcao: ReCorrecao
  status: string                // statusEmissaoRetificada
  nextAction: string
  workflow: ReStep[]
  averbacao: Record<string, string>
  solicitation: Record<string, string>
  conference: Record<string, unknown>
}
interface ReKpis { total: number; averb: number; solic: number; aguard: number; receb: number; conf: number; valid: number; bloq: number }
interface ReData { documentos: ReDoc[]; kpis: ReKpis; progress: number }

interface Props {
  processoId: number
  onConcluido?: () => void
}

// ============================================================
// HELPERS
// ============================================================

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("authToken")}` })
const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() })
const EC = "w-full text-sm border border-white/10 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#7dd3fc]/25 focus:border-[#7dd3fc]/50"
const ini = (nome: string) => {
  const p = (nome || "").trim().split(/\s+/)
  return ((p[0]?.[0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "—"
}

function mapStep(raw: Record<string, unknown>): ReStep {
  return { id: String(raw.id ?? ""), title: String(raw.title ?? ""), status: String(raw.status ?? "bloqueada"), doneAt: (raw.doneAt as string) ?? null }
}
function mapDoc(raw: Record<string, any>): ReDoc {
  const c = raw.correcao || {}
  return {
    id: raw.id,
    documentoId: raw.documentoId ?? raw.id,
    pessoaNome: raw.pessoaNome ?? "—",
    pessoaGen: raw.pessoaGen ?? "",
    pessoaPapel: raw.pessoaPapel ?? "",
    documentoTitulo: raw.documentoTitulo ?? DOCT[raw.tipo] ?? "Documento",
    correcao: { campo: c.campo ?? "—", old: c.old ?? "", novo: c.novo ?? "" },
    status: raw.status ?? raw.statusEmissaoRetificada ?? "pendente_averbacao",
    nextAction: raw.nextAction ?? "Enviar pedido de averbação ao cartório",
    workflow: Array.isArray(raw.workflow) ? raw.workflow.map(mapStep) : [],
    averbacao: raw.averbacao ?? {},
    solicitation: raw.solicitation ?? {},
    conference: raw.conference ?? {},
  }
}

const reProgress = (d: ReDoc) => Math.round((d.workflow.filter((s) => s.status === "concluida").length / 6) * 100)
const reCurStep = (d: ReDoc) => d.workflow.find((s) => s.status === "pendente" || s.status === "em_andamento")
const reDone = (d: ReDoc) => d.status === "validada"

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function ProcessoEmissaoRetificada({ processoId, onConcluido }: Props) {
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [drawerId, setDrawerId] = useState<string | number | null>(null)
  const [drawerTab, setDrawerTab] = useState("Workflow")
  const [modal, setModal] = useState<{ docId: string | number; stepId: string } | null>(null)
  const [posting, setPosting] = useState(false)
  const [modalErro, setModalErro] = useState<string | null>(null)

  // Consulta em cache (src/lib/dados).
  const { dados: bruto, carregando: loading, erro: erroCarregar, recarregar: carregar } =
    useApi<any>(`/api/processos/${processoId}/emissao-retificada`)
  // Transformação virou derivação memoizada da resposta em cache.
  const data: ReData | null = useMemo(() => {
    if (!bruto) return null
    const documentos = Array.isArray(bruto.documentos) ? bruto.documentos.map(mapDoc) : []
    return { documentos, kpis: bruto.kpis ?? calcKpis(documentos), progress: bruto.progress ?? calcProgress(documentos) } as ReData
  }, [bruto])

  const aplicarEtapa = async (docId: string | number, stepId: string, payload: Record<string, unknown>) => {
    setPosting(true); setModalErro(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/emissao-retificada/documentos/${docId}/etapas/${stepId}`, {
        method: "POST", headers: jsonHeaders(), body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Não foi possível concluir a etapa.")
      setModal(null)
      if (json.completePhase) {
        setAviso("Emissão documental retificada concluída — processo movido para Tradução juramentada.")
        onConcluido?.()
      } else if (json.rejected) {
        setAviso("Divergência/recusa registrada — o workflow do documento voltou para a etapa indicada.")
      }
      await carregar()
    } catch (e) {
      setModalErro(e instanceof Error ? e.message : "Erro ao concluir a etapa.")
    } finally {
      setPosting(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div>
  if (!data) return <div className="rounded-xl border border-dashed border-white/15 p-8 text-center text-sm text-white/55">Este processo não está na fase de Emissão documental retificada.</div>

  const docs = data.documentos
  const k = data.kpis
  const pct = data.progress
  const foco = docs.find((d) => d.status !== "validada") || docs[0] || null
  const drawerDoc = drawerId != null ? docs.find((d) => d.id === drawerId) : null

  const kpiList: Array<[string, number, string]> = [
    ["📄", k.total, "Documentos a reemitir"],
    ["📨", k.averb, "Averbações enviadas"],
    ["📋", k.solic, "Certidões solicitadas"],
    ["⏳", k.aguard, "Aguardando retorno"],
    ["📥", k.receb, "Recebidas"],
    ["🔍", k.conf, "Conferidas"],
    ["✅", k.valid, "Validadas"],
    ["🔒", k.bloq, "Bloqueadas"],
  ]

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-white/95">Central Operacional · Emissão documental retificada</h2>
          <p className="text-sm text-white/55">Objetivo: averbar a retificação no cartório e emitir a nova certidão corrigida.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Stat label="Documentos validados" value={`${k.valid} / ${k.total}`} ok={k.valid > 0} />
          <Stat label="Progresso da fase" value={`${pct}%`} />
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${pct >= 100 ? "bg-[#4ade80]/12 text-[#4ade80]" : "bg-sky-500/15 text-sky-300"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${pct >= 100 ? "bg-[#4ade80]" : "bg-sky-400"}`} />
            {pct >= 100 ? "Concluída" : "Em andamento"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,300px] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          {/* Barra das 6 etapas do documento em foco */}
          {foco && (
            <div className="rounded-xl border border-white/10 bg-[#1b2027] p-4">
              <div className="text-[11px] text-white/55 mb-2">Workflow de <b className="text-white/80">{foco.documentoTitulo}</b> · {foco.pessoaNome}</div>
              <div className="flex items-start">
                {foco.workflow.map((s, i) => {
                  const done = s.status === "concluida"
                  const active = s.status === "em_andamento" || s.status === "pendente"
                  return (
                    <div key={s.id} className={`flex items-start ${i < foco.workflow.length - 1 ? "flex-1" : ""}`}>
                      <div className="flex flex-col items-center text-center w-[100px] shrink-0">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${done ? "bg-[#4ade80] text-white" : active ? "bg-[#2563eb] text-white" : "bg-[#252c35] text-white/55"}`}>{done ? <Check className="w-4 h-4" /> : i + 1}</div>
                        <div className="mt-1.5 text-[11px] font-medium text-white/80 leading-tight">{RE_SHORT[i]}</div>
                        <div className={`text-[10px] ${done ? "text-[#4ade80]" : active ? "text-[#7dd3fc]" : "text-white/40"}`}>{done ? "Concluída" : active ? "Atual" : "Pendente"}</div>
                      </div>
                      {i < foco.workflow.length - 1 && <div className={`flex-1 h-0.5 mt-3.5 ${done ? "bg-[#4ade80]" : "bg-[#252c35]"}`} />}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Contexto */}
          <div className="rounded-xl border border-white/10 bg-[#20262e] p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#20262e] text-white/80 flex items-center justify-center flex-shrink-0"><FileText className="w-5 h-5" /></div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white/95">Documentos pós-retificação</div>
              <p className="text-xs text-white/68 mt-0.5">Esta fase emite novamente apenas os documentos impactados pela retificação de registros. A fase conclui quando todas as certidões retificadas forem validadas.</p>
            </div>
          </div>

          {/* 8 KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {kpiList.map(([ic, val, lbl], i) => (
              <div key={i} className="rounded-lg border border-white/10 bg-[#1b2027] px-3 py-2.5">
                <div className="text-base leading-none">{ic}</div>
                <div className="text-xl font-bold text-white/95 mt-1">{val}</div>
                <div className="text-[11px] text-white/55">{lbl}</div>
              </div>
            ))}
          </div>

          {/* Tabela de documentos */}
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
              <span className="text-sm font-semibold text-white/95">Documentos para emissão retificada</span>
              <span className="text-xs font-semibold text-white/55 bg-[#252c35] rounded-full px-2 py-0.5">{docs.length}</span>
            </div>
            {docs.length === 0 ? (
              <div className="p-8 text-center text-sm text-white/55">Nenhum documento impactado pela retificação.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-white/55 bg-[#20262e]">
                      {["Pessoa", "Documento", "Correção aplicada", "Status", "Próxima ação", ""].map((h, i) => <th key={i} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {docs.map((d) => (
                      <tr key={d.id} className="hover:bg-[#20262e] align-top cursor-pointer" onClick={() => { setDrawerId(d.id); setDrawerTab("Workflow") }}>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="w-7 h-7 rounded-full bg-[#252c35] text-white/68 text-[11px] font-bold flex items-center justify-center flex-shrink-0">{ini(d.pessoaNome)}</span>
                            <div className="min-w-0"><div className="font-semibold text-white/95">{d.pessoaNome}</div><div className="text-[11px] text-white/55">{d.pessoaGen}{d.pessoaPapel ? " · " + d.pessoaPapel : ""}</div></div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5"><div className="font-medium text-white/95">{d.documentoTitulo}</div><div className="text-[11px] text-white/55">Inteiro teor</div></td>
                        <td className="px-3 py-2.5">
                          <div className="text-[11px] text-white/55">{d.correcao.campo}</div>
                          <div className="text-xs"><s className="text-[#f87171]">{d.correcao.old}</s> → <b className="text-[#4ade80]">{d.correcao.novo}</b></div>
                        </td>
                        <td className="px-3 py-2.5"><RePill status={d.status} /></td>
                        <td className="px-3 py-2.5 text-white/68">{d.nextAction}</td>
                        <td className="px-3 py-2.5 text-right">
                          <button onClick={(e) => { e.stopPropagation(); setDrawerId(d.id); setDrawerTab(reDone(d) ? "Workflow" : "Operação") }} className={`text-xs font-semibold rounded-md px-2.5 py-1.5 border ${reDone(d) ? "border-[#4ade80]/30 text-[#4ade80]" : "border-white/10 bg-[#20262e] text-white hover:bg-[#252c35]"}`}>{reDone(d) ? "Ver workflow" : "Abrir operação"}</button>
                        </td>
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
          <div className="rounded-xl border border-white/10 bg-[#1b2027] p-4">
            <h3 className="text-sm font-semibold text-white/95 mb-2.5">Ações rápidas</h3>
            <div className="space-y-2">
              <QBtn icon={<FileText className="w-4 h-4 text-white/40" />} onClick={() => setAviso("Modelo de ofício de averbação — em breve.")}>Modelo de ofício de averbação</QBtn>
              <QBtn icon={<ArrowRight className="w-4 h-4 text-white/40" />} onClick={() => setAviso("Ver pacotes de retificação — abra a fase Retificação de registros.")}>Ver pacotes de retificação</QBtn>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#1b2027] p-4">
            <h3 className="text-sm font-semibold text-white/95 mb-2.5">Alertas</h3>
            <div className="space-y-2 text-xs">
              {k.bloq > 0 && <div className="flex items-center gap-2 text-[#d2a948] bg-[#d2a948]/12 border border-[#d2a948]/25 rounded-lg px-3 py-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {k.bloq} documento(s) com divergência pós-retificação</div>}
              <div className="flex items-center gap-2 text-[#d2a948] bg-[#d2a948]/12 rounded-lg px-3 py-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {k.total - k.valid} certidão(ões) retificada(s) pendente(s)</div>
              <div className="flex items-center gap-2 text-[#4ade80] bg-[#4ade80]/12 rounded-lg px-3 py-2"><CheckCircle2 className="w-4 h-4 shrink-0" /> {k.valid} validada(s)</div>
            </div>
          </div>
        </aside>
      </div>

      {erro && <div className="bg-[#f87171]/12 border border-[#f87171]/30 rounded-lg px-4 py-3 text-sm text-[#f87171]">{erro}</div>}
      {aviso && <div className="bg-sky-500/12 border border-sky-500/25 rounded-lg px-4 py-3 text-sm text-sky-300">{aviso}</div>}

      {/* Drawer do documento */}
      {drawerDoc && (
        <DocDrawer pk={drawerDoc} tab={drawerTab} onTab={setDrawerTab} onClose={() => setDrawerId(null)} onAbrirEtapa={(stepId) => setModal({ docId: drawerDoc.id, stepId })} />
      )}

      {/* Modais das etapas */}
      {modal && drawerDoc && (
        <EtapaModal key={modal.stepId} stepId={modal.stepId} doc={drawerDoc} posting={posting} erro={modalErro}
          onClose={() => { setModal(null); setModalErro(null) }} onSubmit={(payload) => aplicarEtapa(modal.docId, modal.stepId, payload)} />
      )}
    </div>
  )
}

// ============================================================
// KPIs / progresso — fallback client-side
// ============================================================
function calcKpis(docs: ReDoc[]): ReKpis {
  const by = (s: string) => docs.filter((d) => d.status === s).length
  return { total: docs.length, averb: by("averbacao_enviada"), solic: by("solicitada"), aguard: by("aguardando_retorno_concluido"), receb: by("recebida"), conf: by("conferida"), valid: by("validada"), bloq: by("divergente") + by("bloqueada") }
}
function calcProgress(docs: ReDoc[]): number {
  if (!docs.length) return 0
  return Math.round((docs.filter((d) => d.status === "validada").length / docs.length) * 100)
}

// ============================================================
// SUBCOMPONENTES
// ============================================================

function Stat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return <div className="rounded-lg border border-white/10 bg-[#1b2027] px-3 py-2 text-center"><div className={`text-lg font-bold ${ok ? "text-[#4ade80]" : "text-white/95"}`}>{value}</div><div className="text-[11px] text-white/55 whitespace-nowrap">{label}</div></div>
}
function QBtn({ icon, onClick, children }: { icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} className="w-full text-left text-sm text-white/80 hover:bg-[#20262e] border border-white/10 rounded-lg px-3 py-2 inline-flex items-center gap-2">{icon} {children}</button>
}
function RePill({ status }: { status: string }) {
  const map: Record<string, string> = {
    validada: "bg-[#4ade80]/12 text-[#4ade80]",
    divergente: "bg-[#f87171]/12 text-[#f87171]",
    bloqueada: "bg-[#f87171]/12 text-[#f87171]",
    pendente_averbacao: "bg-[#252c35] text-white/68",
    nova_via: "bg-[#252c35] text-white/68",
    reabrir_averbacao: "bg-[#d2a948]/12 text-[#d2a948]",
  }
  const dot: Record<string, string> = { validada: "bg-[#4ade80]", divergente: "bg-[#f87171]", bloqueada: "bg-[#f87171]" }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${map[status] || "bg-[#d2a948]/12 text-[#d2a948]"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot[status] || "bg-amber-400"}`} />{RE_LABEL[status] || status}
    </span>
  )
}

// ============================================================
// DRAWER DO DOCUMENTO (8 abas, fiel ao mockup)
// ============================================================

const DRAWER_TABS = ["Operação", "Workflow", "Averbação", "Solicitação", "Dados registrais", "Conferência", "Anexos", "Histórico"]

function DocDrawer({ pk, tab, onTab, onClose, onAbrirEtapa }: {
  pk: ReDoc
  tab: string
  onTab: (t: string) => void
  onClose: () => void
  onAbrirEtapa: (stepId: string) => void
}) {
  const prog = reProgress(pk)
  const cur = reCurStep(pk)
  const done = pk.workflow.filter((s) => s.status === "concluida").length
  const green = pk.status === "validada"

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[#1b2027] h-full shadow-xl overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10">
          <button onClick={onClose} className="text-white/40 hover:text-white/80 float-right p-1"><X className="w-5 h-5" /></button>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#7dd3fc]">Emissão documental retificada · {pk.pessoaNome}</div>
          <h3 className="text-base font-bold text-white/95 mt-0.5">{pk.documentoTitulo} retificada</h3>
          <div className="text-xs text-white/55">{pk.pessoaNome} · documento pós-retificação</div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <MetaCell k="Status"><span className={`inline-flex items-center gap-1 text-xs font-semibold ${green ? "text-[#4ade80]" : "text-[#d2a948]"}`}>● {RE_LABEL[pk.status] || pk.status}</span></MetaCell>
            <MetaCell k="Responsável"><b className="text-white/95 text-xs">Equipe Documental</b></MetaCell>
            <MetaCell k="Próxima ação"><b className="text-white/95 text-xs">{pk.nextAction}</b></MetaCell>
          </div>
          <div className="mt-3 h-1.5 bg-[#252c35] rounded-full overflow-hidden"><div className="h-full bg-[#7dd3fc]" style={{ width: `${prog}%` }} /></div>
          <div className="flex justify-between text-[11px] text-white/55 mt-1"><span>Progresso operacional</span><span>{prog}% · workflow retificado</span></div>
        </div>

        {/* Tabs */}
        <div className="border-b border-white/10 px-3 flex gap-1 overflow-x-auto">
          {DRAWER_TABS.map((t) => (
            <button key={t} onClick={() => onTab(t)} className={`px-2.5 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 ${t === tab ? "border-[#2563eb] text-white" : "border-transparent text-white/55 hover:text-white/80"}`}>{t}</button>
          ))}
        </div>

        {/* Body */}
        <div className="p-5 flex-1">
          {tab === "Operação" && (
            green ? (
              <div className="rounded-lg border border-[#4ade80]/30 bg-[#4ade80]/12 p-4 text-center">
                <div className="w-9 h-9 mx-auto rounded-full bg-[#4ade80] text-white flex items-center justify-center mb-2"><Check className="w-5 h-5" /></div>
                <h4 className="text-sm font-bold text-white/95">Certidão retificada validada</h4>
                <p className="text-xs text-white/68">Workflow concluído (100%). Documento corrigido e validado.</p>
              </div>
            ) : cur ? (
              <div className="rounded-lg border border-white/10 p-4 text-center">
                <div className="w-9 h-9 mx-auto rounded-full bg-[#20262e] text-white/80 flex items-center justify-center mb-2"><FileText className="w-5 h-5" /></div>
                <h4 className="text-sm font-bold text-white/95">{cur.title}</h4>
                <p className="text-xs text-white/68 mb-3">Etapa atual do workflow retificado. Abra para registrar e concluir.</p>
                <button onClick={() => onAbrirEtapa(cur.id)} className="px-4 py-2 text-sm font-semibold text-white bg-[#2563eb] hover:bg-[#1d4ed8] rounded-md inline-flex items-center gap-2">Abrir etapa <ArrowRight className="w-4 h-4" /></button>
              </div>
            ) : null
          )}

          {tab === "Workflow" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-1"><div><b className="text-sm text-white/95">Workflow Documental Retificado</b><div className="text-[11px] text-white/55">6 etapas · {done} concluída{done === 1 ? "" : "s"}</div></div><b className="text-sm text-white/95">{prog}%</b></div>
              {pk.workflow.map((s, i) => {
                const isDone = s.status === "concluida"
                const active = s.status === "em_andamento" || s.status === "pendente"
                const meta = isDone ? `concluída${s.doneAt ? " em " + s.doneAt : ""}` : active ? "etapa atual" : "bloqueada · conclua a anterior"
                return (
                  <div key={s.id} className="flex items-center gap-3 border border-white/10 rounded-lg px-3 py-2.5">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${isDone ? "bg-[#4ade80]/15 text-[#4ade80]" : active ? "bg-[#2563eb] text-white" : "bg-[#252c35] text-white/40"}`}>{isDone ? "✓" : i + 1}</span>
                    <div className="flex-1 min-w-0"><div className="text-sm font-medium text-white/95">{i + 1}. {s.title}</div><div className="text-[11px] text-white/55">{meta}</div></div>
                    {active && <button onClick={() => onAbrirEtapa(s.id)} className="text-xs font-semibold text-white bg-[#20262e] border border-white/10 hover:bg-[#252c35] rounded-md px-2.5 py-1.5">Central da etapa</button>}
                  </div>
                )
              })}
            </div>
          )}

          {tab === "Averbação" && (
            Object.keys(pk.averbacao).length ? (
              <div className="rounded-lg border border-white/10 divide-y divide-white/10 text-sm">
                <FieldRow k="Cartório" v={pk.averbacao.cartorio} />
                <FieldRow k="Canal" v={pk.averbacao.canal} />
                <FieldRow k="Protocolo" v={pk.averbacao.protocolo} />
                <FieldRow k="Enviado em" v={pk.averbacao.dataEnvio} />
              </div>
            ) : <Meta>Pedido de averbação ainda não enviado.</Meta>
          )}

          {tab === "Solicitação" && (
            Object.keys(pk.solicitation).length ? (
              <div className="rounded-lg border border-white/10 divide-y divide-white/10 text-sm">
                <FieldRow k="Canal" v={pk.solicitation.canal} />
                <FieldRow k="Protocolo" v={pk.solicitation.protocolo} />
                <FieldRow k="Prazo" v={pk.solicitation.prazo} />
                <FieldRow k="Custo" v={pk.solicitation.custo} />
              </div>
            ) : <Meta>Certidão retificada ainda não solicitada.</Meta>
          )}

          {tab === "Conferência" && (
            <>
              <div className="rounded-lg border border-white/10 bg-[#20262e] p-3 text-sm">
                <div className="text-[11px] font-semibold uppercase text-white/55 mb-1.5">Correção esperada</div>
                <div className="flex justify-between py-0.5"><span className="text-white/55">Campo</span><b className="text-white/95">{pk.correcao.campo}</b></div>
                <div className="flex justify-between py-0.5"><span className="text-white/55">Valor antigo</span><b className="text-[#f87171]">{pk.correcao.old}</b></div>
                <div className="flex justify-between py-0.5"><span className="text-white/55">Valor correto</span><b className="text-[#4ade80]">{pk.correcao.novo}</b></div>
              </div>
              <div className="mt-3"><Meta>{Object.keys(pk.conference).length ? "Conferência registrada." : "Conferência ainda não realizada."}</Meta></div>
            </>
          )}

          {(tab === "Dados registrais" || tab === "Anexos" || tab === "Histórico") && <Meta>{tab} — registrado no histórico do documento.</Meta>}
        </div>
      </div>
    </div>
  )
}

function MetaCell({ k, children }: { k: string; children: ReactNode }) {
  return <div><div className="text-[10px] uppercase text-white/40">{k}</div><div>{children}</div></div>
}
function FieldRow({ k, v }: { k: string; v?: string }) {
  return <div className="flex justify-between px-3 py-2"><span className="text-white/55">{k}</span><span className="font-medium text-white/95 text-right">{v || "—"}</span></div>
}
function Meta({ children }: { children: ReactNode }) {
  return <div className="rounded-lg bg-[#20262e] border border-white/10 px-3 py-2.5 text-xs text-white/68">{children}</div>
}

// ============================================================
// MODAIS DAS ETAPAS
// (espelham reStepAverbacao / reStepSolicitar / reStepAguardar /
//  reStepReceber / reStepConferir / reStepValidar)
// ============================================================

function EtapaModal({ stepId, doc, posting, erro, onClose, onSubmit }: {
  stepId: string
  doc: ReDoc
  posting: boolean
  erro: string | null
  onClose: () => void
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const num = RE_STEPS.findIndex((s) => s[0] === stepId) + 1
  const title = RE_STEPS[num - 1][1]
  const cor = doc.correcao
  const isLast = stepId === "validar_certidao_retificada"

  // averbação
  const [avCart, setAvCart] = useState("")
  const [avData, setAvData] = useState("")
  const [avCanal, setAvCanal] = useState("")
  const [avProto, setAvProto] = useState("")
  const [avFile, setAvFile] = useState(false)
  const [avResp, setAvResp] = useState("")
  const [avPrazo, setAvPrazo] = useState("")
  const [avObs, setAvObs] = useState("")

  // solicitar
  const [scCanal, setScCanal] = useState("")
  const [scProto, setScProto] = useState("")
  const [scFile, setScFile] = useState(false)
  const [scPrazo, setScPrazo] = useState("")
  const [scCusto, setScCusto] = useState("")
  const [scObs, setScObs] = useState("")

  // aguardar
  const [agData, setAgData] = useState("")
  const [agTipo, setAgTipo] = useState("Ligação")
  const [agDesc, setAgDesc] = useState("")

  // receber
  const [reFile, setReFile] = useState(false)
  const [reMidia, setReMidia] = useState("")
  const [reLoc, setReLoc] = useState("")
  const [reData, setReData] = useState("")
  const [reObs, setReObs] = useState("")

  // conferir
  const [cfChk, setCfChk] = useState<Record<string, boolean>>({})
  const [cfRes, setCfRes] = useState("")
  const [cfObs, setCfObs] = useState("")

  // validar
  const [vlDec, setVlDec] = useState("")
  const [vlObs, setVlObs] = useState("")

  const needLoc = reMidia === "fisico" || reMidia === "ambos"
  const podeSalvar =
    stepId === "enviar_pedido_averbacao" ? !!avCart.trim() && !!avData.trim() && !!avCanal && (!!avProto.trim() || avFile)
      : stepId === "solicitar_certidao_retificada" ? !!scCanal && !!scProto.trim() && scFile
        : stepId === "aguardar_retorno_cartorio_retificado" ? true
          : stepId === "receber_certidao_retificada" ? reFile && !!reMidia && (!needLoc || !!reLoc.trim())
            : stepId === "conferir_certidao_retificada" ? !!cfRes
              : stepId === "validar_certidao_retificada" ? !!vlDec
                : false

  const submit = () => {
    if (stepId === "enviar_pedido_averbacao")
      return onSubmit({ cartorio: avCart, canal: avCanal, dataEnvio: avData, protocolo: avProto, comprovante: avFile, resp: avResp, prazo: avPrazo, obs: avObs })
    if (stepId === "solicitar_certidao_retificada")
      return onSubmit({ canal: scCanal, protocolo: scProto, comprovante: scFile, prazo: scPrazo, custo: scCusto, obs: scObs })
    if (stepId === "aguardar_retorno_cartorio_retificado")
      return onSubmit({ contato: agDesc.trim() ? { data: agData, tipo: agTipo, desc: agDesc } : null })
    if (stepId === "receber_certidao_retificada")
      return onSubmit({ anexo: true, tipoMidia: reMidia, local: reLoc, data: reData, obs: reObs })
    if (stepId === "conferir_certidao_retificada")
      return onSubmit({ resultado: cfRes, checks: Object.keys(cfChk).filter((kk) => cfChk[kk]), obs: cfObs })
    if (stepId === "validar_certidao_retificada")
      return onSubmit({ decision: vlDec, obs: vlObs })
  }

  return (
    <ModalShell onClose={onClose} eyebrow={`Etapa ${num} de 6 · Workflow Retificado`} title={title} sub={`${doc.documentoTitulo} · ${doc.pessoaNome}`} danger={isLast} maxW="max-w-lg">
      <div className="space-y-4">
        {/* 1) Enviar pedido de averbação */}
        {stepId === "enviar_pedido_averbacao" && (
          <>
            <Sec>1. Cartório e canal</Sec>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cartório responsável" required><input className={EC} value={avCart} onChange={(e) => setAvCart(e.target.value)} placeholder="Cartório de Registro Civil" /></Field>
              <Field label="Data do envio" required><input className={EC} value={avData} onChange={(e) => setAvData(e.target.value)} placeholder="dd/mm/aaaa" /></Field>
            </div>
            <Field label="Canal de envio" required><Chips opts={CANAIS_AVERB} value={avCanal} onChange={setAvCanal} /></Field>
            <Sec>2. Comprovação</Sec>
            <Field label="Protocolo do pedido de averbação"><input className={EC} value={avProto} onChange={(e) => setAvProto(e.target.value)} placeholder="Protocolo (ou anexe comprovante)" /></Field>
            <Field label="Anexo (decisão / mandado / termo)"><FakeFile ok={avFile} onClick={() => setAvFile(true)} label="Anexar decisão / mandado de averbação" okLabel="mandado_averbacao.pdf · anexado" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Atendente / responsável externo"><input className={EC} value={avResp} onChange={(e) => setAvResp(e.target.value)} /></Field>
              <Field label="Prazo estimado p/ averbação"><input className={EC} value={avPrazo} onChange={(e) => setAvPrazo(e.target.value)} placeholder="ex: 15 dias" /></Field>
            </div>
            <Field label="Observação"><textarea className={EC} rows={2} value={avObs} onChange={(e) => setAvObs(e.target.value)} /></Field>
          </>
        )}

        {/* 2) Solicitar certidão retificada */}
        {stepId === "solicitar_certidao_retificada" && (
          <>
            <Sec>1. Canal de solicitação</Sec>
            <Chips opts={CANAIS_SOLIC} value={scCanal} onChange={setScCanal} />
            <Sec>2. Evidências</Sec>
            <Field label="Protocolo" required><input className={EC} value={scProto} onChange={(e) => setScProto(e.target.value)} placeholder="Protocolo da solicitação" /></Field>
            <Field label="Comprovante" required><FakeFile ok={scFile} onClick={() => setScFile(true)} label="Anexar comprovante da solicitação" okLabel="comprovante.pdf · anexado" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prazo esperado"><input className={EC} value={scPrazo} onChange={(e) => setScPrazo(e.target.value)} placeholder="ex: 30 dias" /></Field>
              <Field label="Custo cobrado"><input className={EC} value={scCusto} onChange={(e) => setScCusto(e.target.value)} placeholder="R$" /></Field>
            </div>
            <Field label="Observação"><textarea className={EC} rows={2} value={scObs} onChange={(e) => setScObs(e.target.value)} /></Field>
          </>
        )}

        {/* 3) Aguardar retorno */}
        {stepId === "aguardar_retorno_cartorio_retificado" && (
          <>
            <div className="rounded-lg border border-white/10 bg-[#20262e] p-3">
              <div className="text-xs font-semibold text-white/80 mb-2">✈️ Resumo da solicitação</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Cell k="Canal" v={doc.solicitation.canal || "—"} />
                <Cell k="Protocolo" v={doc.solicitation.protocolo || "—"} />
              </div>
            </div>
            <Sec>Registrar contato (opcional)</Sec>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Data"><input className={EC} value={agData} onChange={(e) => setAgData(e.target.value)} placeholder="dd/mm/aaaa" /></Field>
              <Field label="Tipo"><select className={EC} value={agTipo} onChange={(e) => setAgTipo(e.target.value)}>{["Ligação", "E-mail", "WhatsApp", "Presencial"].map((o) => <option key={o}>{o}</option>)}</select></Field>
            </div>
            <Field label="Descrição"><textarea className={EC} rows={2} value={agDesc} onChange={(e) => setAgDesc(e.target.value)} placeholder="Ex: cartório confirmou que averbação foi lançada." /></Field>
            <div className="text-[11px] text-white/55">Conclua quando o cartório confirmar o retorno.</div>
          </>
        )}

        {/* 4) Receber certidão retificada */}
        {stepId === "receber_certidao_retificada" && (
          <>
            <Sec>1. Anexo da certidão retificada</Sec>
            <Field label="Arquivo" required><FakeFile ok={reFile} onClick={() => setReFile(true)} label="Anexar certidão retificada recebida" okLabel="certidao_retificada.pdf · anexado" /></Field>
            <Sec>2. Tipo de mídia</Sec>
            <div className="space-y-2">
              {MIDIAS.map(([v, l]) => (
                <button key={v} type="button" onClick={() => setReMidia(v)} className={`w-full flex items-center gap-2 border rounded-lg px-3 py-2 text-sm text-left ${reMidia === v ? "border-[#2563eb] bg-[#20262e] text-white" : "border-white/10 text-white/80"}`}>
                  <span className={`w-3.5 h-3.5 rounded-full border ${reMidia === v ? "border-[#2563eb] bg-[#2563eb]" : "border-white/15"}`} />{l}
                </button>
              ))}
            </div>
            {needLoc && <Field label="📍 Localização física" required><input className={EC} value={reLoc} onChange={(e) => setReLoc(e.target.value)} placeholder="ex: Pasta 23 · Arquivo Discovery" /></Field>}
            <Field label="Data de recebimento"><input className={EC} value={reData} onChange={(e) => setReData(e.target.value)} placeholder="dd/mm/aaaa" /></Field>
            <Field label="Observação"><textarea className={EC} rows={2} value={reObs} onChange={(e) => setReObs(e.target.value)} /></Field>
          </>
        )}

        {/* 5) Conferir certidão retificada */}
        {stepId === "conferir_certidao_retificada" && (
          <>
            <div className="rounded-lg border border-white/10 bg-[#20262e] p-3 text-sm">
              <div className="text-[11px] font-semibold uppercase text-white/55 mb-1.5">Correção esperada</div>
              <div className="flex justify-between py-0.5"><span className="text-white/55">Campo</span><b className="text-white/95">{cor.campo}</b></div>
              <div className="flex justify-between py-0.5"><span className="text-white/55">Valor antigo</span><b className="text-[#f87171]">{cor.old}</b></div>
              <div className="flex justify-between py-0.5"><span className="text-white/55">Valor correto</span><b className="text-[#4ade80]">{cor.novo}</b></div>
            </div>
            <Field label="Nome do titular (como aparece no documento)"><input className={EC} placeholder={doc.pessoaNome} /></Field>
            <Sec>Checklist de conferência</Sec>
            <div className="flex flex-wrap gap-1.5">
              {CONF_CHK.map(([key, label]) => (
                <button key={key} type="button" onClick={() => setCfChk((p) => ({ ...p, [key]: !p[key] }))} className={`inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-md border px-2 py-1 ${cfChk[key] ? "border-[#4ade80]/25 bg-[#4ade80]/12 text-[#4ade80]" : "border-white/10 text-white/68"}`}>
                  <span className={`w-3.5 h-3.5 rounded flex items-center justify-center ${cfChk[key] ? "bg-[#4ade80] text-white" : "border border-white/15"}`}>{cfChk[key] && <Check className="w-2.5 h-2.5" />}</span>{label}
                </button>
              ))}
            </div>
            <Sec>Resultado</Sec>
            <div className="grid grid-cols-3 gap-2">
              {CONF_RES.map(([v, l, hint, tone]) => {
                const sel = cfRes === v
                const cls = !sel ? "border-white/10 text-white/80" : tone === "ok" ? "border-[#4ade80]/25 bg-[#4ade80]/12 text-[#4ade80]" : tone === "warn" ? "border-[#f87171]/25 bg-[#f87171]/12 text-[#f87171]" : "border-white/20 bg-[#20262e] text-white/80"
                return <button key={v} type="button" onClick={() => setCfRes(v)} className={`border rounded-lg px-2 py-2 text-center ${cls}`}><div className="text-xs font-semibold">{l}</div><div className="text-[10px] text-white/55">{hint}</div></button>
              })}
            </div>
            <Field label="Observação"><textarea className={EC} rows={2} value={cfObs} onChange={(e) => setCfObs(e.target.value)} /></Field>
          </>
        )}

        {/* 6) Validar certidão retificada */}
        {stepId === "validar_certidao_retificada" && (
          <>
            <div className="rounded-lg border border-white/10 bg-[#20262e] p-3 text-sm">
              <div className="text-[11px] font-semibold uppercase text-white/55 mb-1.5">Correção aplicada</div>
              <div className="flex justify-between py-0.5"><span className="text-white/55">{cor.campo}</span><b><s className="text-[#f87171]">{cor.old}</s> → <span className="text-[#4ade80]">{cor.novo}</span></b></div>
            </div>
            <Sec>Decisão final</Sec>
            <div className="space-y-2">
              {VAL_DECS.map(([v, l, sub, tone]) => (
                <button key={v} type="button" onClick={() => setVlDec(v)} className={`w-full text-left border rounded-lg px-3 py-2.5 ${vlDec === v ? (tone === "ok" ? "border-[#4ade80]/25 bg-[#4ade80]/12" : "border-[#2563eb] bg-[#20262e]") : "border-white/10"}`}>
                  <div className="text-sm font-semibold text-white/95">{l}</div><div className="text-[11px] text-white/55">{sub}</div>
                </button>
              ))}
            </div>
            <Field label="Parecer jurídico (opcional)"><textarea className={EC} rows={2} value={vlObs} onChange={(e) => setVlObs(e.target.value)} /></Field>
          </>
        )}

        {erro && <div className="bg-[#f87171]/12 border border-[#f87171]/30 rounded-lg px-3 py-2 text-sm text-[#f87171]">{erro}</div>}
      </div>

      <div className="border-t border-white/10 px-5 py-3 -mx-5 -mb-5 mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-2 text-sm text-white/68 hover:bg-[#20262e] rounded-md">Cancelar</button>
        <button onClick={submit} disabled={!podeSalvar || posting} className="px-4 py-2 text-sm font-semibold text-white bg-[#2563eb] hover:bg-[#1d4ed8] rounded-md inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
          {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {isLast ? "Confirmar · finalizar documento" : "Confirmar · concluir etapa"}
        </button>
      </div>
    </ModalShell>
  )
}

// ============================================================
// SHELLS / CAMPOS
// ============================================================

function ModalShell({ children, onClose, title, sub, eyebrow, danger, maxW = "max-w-lg" }: {
  children: ReactNode
  onClose: () => void
  title: string
  sub?: string
  eyebrow?: string
  danger?: boolean
  maxW?: string
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={`relative w-full ${maxW} bg-[#1b2027] rounded-xl shadow-xl max-h-[85vh] flex flex-col`}>
        <div className={`flex items-start justify-between px-5 py-4 border-b ${danger ? "border-white/10" : "border-white/10"}`}>
          <div>
            {eyebrow && <div className={`text-[11px] font-semibold uppercase tracking-wider ${danger ? "text-[#f87171]" : "text-[#7dd3fc]"}`}>{eyebrow}</div>}
            <h3 className="text-base font-bold text-white/95 mt-0.5">{title}</h3>
            {sub && <p className="text-xs text-white/55 mt-0.5">{sub}</p>}
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 p-1"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
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
      <label className="text-xs font-semibold text-white/80 flex items-center gap-1.5 mb-1">{label}{required && <span className="text-[10px] font-bold text-[#f87171] bg-[#f87171]/12 rounded px-1.5 py-0.5">Obrigatório</span>}</label>
      {children}
    </div>
  )
}
function Cell({ k, v }: { k: string; v: string }) {
  return <div><div className="text-[10px] uppercase text-white/40">{k}</div><div className="font-semibold text-white/95">{v}</div></div>
}
function Chips({ opts, value, onChange }: { opts: Array<[string, string]>; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {opts.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} className={`px-3 py-1.5 text-xs font-semibold rounded-md border ${value === v ? "border-[#2563eb] bg-[#20262e] text-white" : "border-white/10 text-white/80"}`}>{l}</button>
      ))}
    </div>
  )
}
function FakeFile({ ok, onClick, label, okLabel }: { ok: boolean; onClick: () => void; label: string; okLabel: string }) {
  return (
    <button type="button" onClick={onClick} className={`w-full inline-flex items-center gap-2 text-sm font-semibold rounded-md border px-3 py-2.5 ${ok ? "border-[#4ade80]/25 bg-[#4ade80]/12 text-[#4ade80]" : "border-white/10 text-white/80"}`}>
      {ok ? <Check className="w-4 h-4" /> : <Upload className="w-4 h-4" />}{ok ? okLabel : label}
    </button>
  )
}