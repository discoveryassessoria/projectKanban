// src/components/kanban/DocumentoBibliotecaDrawer.tsx
//
// Drawer CLARO de detalhes do documento — porte fiel do mockup
// discovery-central-operacional-v2.html
// (openDocumentLibraryDrawer / renderDocumentLibraryDrawer /
//  renderDocumentDrawerOverview).
//
// É o "espelho" da aba Documentos: SOMENTE LEITURA.
// NÃO confundir com o DocumentoOperationalDrawer (escuro), que é da
// Central Operacional. Este aqui é claro, 560px, fundo branco.

"use client"

import { useState, useEffect } from "react"
import { FileText, X, ExternalLink, Download, ChevronDown, ArrowRight, Clock } from "lucide-react"
import type { BibDocItem } from "./ProcessoDocumentosBiblioteca"

type CellStatus = "validada" | "recebida" | "pendente" | "nao_aplica"

type Tab =
  | "Visão geral" | "Certidão" | "Cert. retificada"
  | "Tradução" | "Apostila" | "Dados registrais" | "Histórico"

const TABS: Tab[] = [
  "Visão geral", "Certidão", "Cert. retificada",
  "Tradução", "Apostila", "Dados registrais", "Histórico",
]

const CELL_LABEL: Record<CellStatus, string> = {
  validada: "Validada",
  recebida: "Recebida",
  pendente: "Pendente",
  nao_aplica: "Não se aplica",
}

const CELL_DOT: Record<CellStatus, string> = {
  validada: "bg-[#4ade80]",
  recebida: "bg-[#7dd3fc]",
  pendente: "bg-[#d2a948]/15",
  nao_aplica: "bg-white/20",
}

export interface DocumentoBibliotecaContext {
  lineage?: string
  role?: string
  generation?: number | string
}

interface Props {
  item: BibDocItem | null
  context?: DocumentoBibliotecaContext
  isOpen: boolean
  onClose: () => void
}

// ============================================================
// DRAWER
// ============================================================

/**
 * Casca fina: o conteúdo só existe aberto, e a sua identidade é o documento. Trocar
 * de documento ou reabrir monta de novo — é o que substitui o efeito que voltava a
 * aba para "Visão geral" "ao abrir".
 */
export function DocumentoBibliotecaDrawer({ item, context, isOpen, onClose }: Props) {
  if (!isOpen || !item) return null
  return <ConteudoDrawer key={item.id} item={item} context={context} isOpen={isOpen} onClose={onClose} />
}

function ConteudoDrawer({ item, context, onClose }: Props) {
  // Cada abertura começa na primeira aba porque o componente é novo.
  const [tab, setTab] = useState<Tab>("Visão geral")
  if (!item) return null

  const badge =
    item.finalStatus === "pronta_protocolo"
      ? { txt: "Pronto", cls: "bg-[#4ade80]/12 text-[#4ade80] border-[#4ade80]/30" }
      : item.finalStatus === "aguardando"
      ? { txt: "Aguardando", cls: "bg-[#d2a948]/12 text-[#d2a948] border-[#d2a948]/30" }
      : { txt: "Pendente", cls: "bg-[#d2a948]/12 text-[#d2a948] border-[#d2a948]/30" }

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Painel claro */}
      <div className="fixed top-0 right-0 h-full w-[560px] max-w-[94vw] bg-[#1b2027] text-white/95 z-50 shadow-2xl flex flex-col">
        {/* ---- Cabeçalho ---- */}
        <div className="px-6 pt-5 pb-4 border-b border-white/10">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#252c35] grid place-items-center text-white/55 flex-none">
              <FileText className="w-[22px] h-[22px]" strokeWidth={1.7} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5">
                <h3 className="text-[18px] font-extrabold text-white/95 truncate">{item.documentType}</h3>
                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border flex-none ${badge.cls}`}>
                  {badge.txt}
                </span>
              </div>
              <div className="text-[12.5px] text-white/55 mt-0.5 truncate">
                {item.personName} · {item.documentFormat}
                {context?.lineage ? ` · ${context.lineage}` : ""}
              </div>
            </div>
            <button onClick={onClose} className="text-white/40 hover:text-white/80 flex-none">
              <X className="w-[22px] h-[22px]" />
            </button>
          </div>

          {/* Ações (arquivos ainda não conectados ao backend) */}
          <div className="flex items-center gap-2.5 mt-4 flex-wrap">
            <button
              disabled
              title="Arquivo ainda não disponível"
              className="inline-flex items-center gap-2 border border-white/10 bg-[#1b2027] rounded-lg px-3.5 py-2 text-[12.5px] font-semibold text-white/80 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <ExternalLink className="w-[15px] h-[15px]" /> Abrir arquivo principal
            </button>
            <button
              disabled
              title="Arquivo ainda não disponível"
              className="inline-flex items-center gap-2 border border-white/10 bg-[#1b2027] rounded-lg px-3.5 py-2 text-[12.5px] font-semibold text-white/80 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Download className="w-[15px] h-[15px]" /> Baixar todos os arquivos
            </button>
            <button className="inline-flex items-center gap-1.5 border border-white/10 bg-[#1b2027] rounded-lg px-3.5 py-2 text-[12.5px] font-semibold text-white/80 hover:border-white/20">
              Mais ações <ChevronDown className="w-[15px] h-[15px]" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-5 mt-4 -mb-px overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`whitespace-nowrap text-[12.5px] font-semibold pb-2.5 border-b-2 transition-colors ${
                  t === tab
                    ? "border-[#7dd3fc] text-[#7dd3fc]"
                    : "border-transparent text-white/55 hover:text-white/80"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* ---- Conteúdo ---- */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === "Visão geral" && (
            <Overview item={item} context={context} onGoToDados={() => setTab("Dados registrais")} />
          )}
          {tab === "Certidão" && <FileTab title="Certidão" status={item.certificate.status} />}
          {tab === "Cert. retificada" && (
            <FileTab
              title="Certidão retificada"
              status={item.retifiedCertificate.status}
              emptyMsg="Certidão retificada não se aplica a este documento."
            />
          )}
          {tab === "Tradução" && <FileTab title="Tradução juramentada" status={item.translation.status} />}
          {tab === "Apostila" && <FileTab title="Apostila de Haia" status={item.apostille.status} />}
          {tab === "Dados registrais" && (
            <PlaceholderTab
              title="Dados registrais"
              msg="Os dados registrais (cartório · livro/folha/termo/nº) são preenchidos na Central Operacional e ainda não são expostos por aqui."
            />
          )}
          {tab === "Histórico" && (
            <PlaceholderTab title="Histórico" msg="Sem movimentações registradas para este documento." />
          )}
        </div>
      </div>
    </>
  )
}

// ============================================================
// VISÃO GERAL
// ============================================================

function Overview({
  item,
  context,
  onGoToDados,
}: {
  item: BibDocItem
  context?: DocumentoBibliotecaContext
  onGoToDados: () => void
}) {
  // Stepper: Certidão → Cert. retificada → Tradução → Apostila → Status final
  const nodes: Array<{ label: string; tone: "ok" | "na" | "pend"; statusLabel: string }> = [
    toneNode("Certidão", item.certificate.status),
    toneNode("Cert. retificada", item.retifiedCertificate.status),
    toneNode("Tradução", item.translation.status),
    toneNode("Apostila", item.apostille.status),
    {
      label: "Status final",
      tone: item.finalStatus === "pronta_protocolo" ? "ok" : "pend",
      statusLabel: item.finalStatus === "pronta_protocolo" ? "Pronto" : "Pendente",
    },
  ]

  const nextAction =
    item.finalStatus === "pronta_protocolo"
      ? "Documento pronto para protocolo."
      : item.certificate.status === "pendente"
      ? "Iniciar a emissão da certidão na fase Emissão documental."
      : "Aguardando próximas etapas (tradução / apostila)."

  const info: Array<[string, string]> = [
    ["Pessoa", item.personName],
    ["Tipo", item.documentFormat],
  ]
  if (context?.lineage) info.push(["Linha", context.lineage])
  if (context?.role) info.push(["Papel", context.role])
  if (context?.generation !== undefined && context.generation !== "—") {
    info.push(["Geração", String(context.generation)])
  }
  info.push(["Fase de origem", "Emissão documental"])

  return (
    <div className="flex flex-col gap-5">
      {/* Resumo / stepper */}
      <div>
        <div className="text-[11px] font-bold text-white/40 tracking-wider mb-4">RESUMO DO DOCUMENTO</div>
        <div className="flex items-start">
          {nodes.map((n, i) => (
            <div key={n.label} className="flex-1 flex flex-col items-center relative">
              {i > 0 && (
                <div className="absolute top-[13px] left-[-50%] right-1/2 h-0.5 bg-[#252c35]" />
              )}
              <span
                className={`relative z-10 w-[26px] h-[26px] rounded-full border-2 grid place-items-center bg-[#1b2027] ${
                  n.tone === "ok"
                    ? "border-[#4ade80]/30"
                    : n.tone === "na"
                    ? "border-white/15"
                    : "border-[#d2a948]/30"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    n.tone === "ok" ? "bg-[#4ade80]" : n.tone === "na" ? "bg-white/20" : "bg-[#d2a948]/15"
                  }`}
                />
              </span>
              <span className="text-[10.5px] text-white/68 text-center leading-tight mt-1.5 px-0.5">{n.label}</span>
              <span className="text-[9.5px] text-white/40 mt-0.5">{n.statusLabel}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Informações principais + Arquivos disponíveis */}
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-white/10 rounded-xl p-4">
          <div className="text-[12px] font-bold text-white/95 mb-2.5">Informações principais</div>
          <div className="flex flex-col gap-2">
            {info.map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-3 text-[12px]">
                <span className="text-white/55 flex-none">{k}</span>
                <span className="font-semibold text-white/95 text-right">{v}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-white/10 rounded-xl p-4">
          <div className="text-[12px] font-bold text-white/95 mb-2.5">Arquivos disponíveis</div>
          <div className="flex flex-col gap-2.5">
            <FileLine
              label="Certidão original"
              available={item.certificate.status !== "pendente" && item.certificate.status !== "nao_aplica"}
            />
            <FileLine
              label="Tradução juramentada"
              available={item.translation.status === "validada" || item.translation.status === "recebida"}
            />
            <FileLine
              label="Apostila"
              available={item.apostille.status === "validada" || item.apostille.status === "recebida"}
            />
          </div>
        </div>
      </div>

      {/* Próxima ação sugerida */}
      <div className="flex items-start gap-3 border border-[#7dd3fc]/30 bg-[#7dd3fc]/12/50 rounded-xl p-4">
        <Clock className="w-[18px] h-[18px] text-[#7dd3fc] flex-none mt-0.5" />
        <div>
          <b className="text-[12.5px] text-white/95 block">Próxima ação sugerida</b>
          <span className="text-[12px] text-white/68">{nextAction}</span>
        </div>
      </div>

      <button
        onClick={onGoToDados}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#7dd3fc] hover:text-[#7dd3fc] self-start"
      >
        Ver dados registrais completos <ArrowRight className="w-[14px] h-[14px]" />
      </button>
    </div>
  )
}

function toneNode(label: string, st: CellStatus) {
  const tone: "ok" | "na" | "pend" =
    st === "validada" || st === "recebida" ? "ok" : st === "nao_aplica" ? "na" : "pend"
  return { label, tone, statusLabel: CELL_LABEL[st] }
}

// ============================================================
// ABAS DE ARQUIVO (Certidão / Cert. retificada / Tradução / Apostila)
// ============================================================

function FileTab({ title, status, emptyMsg }: { title: string; status: CellStatus; emptyMsg?: string }) {
  if (status === "nao_aplica") {
    return (
      <div className="text-[12.5px] text-white/40 py-8 text-center">
        {emptyMsg || `${title} não se aplica a este documento.`}
      </div>
    )
  }

  const available = status === "validada" || status === "recebida"

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[12.5px]">
        <span className={`w-[8px] h-[8px] rounded-full ${CELL_DOT[status]}`} />
        <span className="font-semibold text-white/95">{title}</span>
        <span className="text-white/55">— {CELL_LABEL[status]}</span>
      </div>
      <div className="border border-dashed border-white/10 rounded-xl p-8 text-center text-[12px] text-white/40">
        {available
          ? "Arquivo recebido. (visualização / download ainda não conectados ao backend)"
          : "Arquivo ainda não disponível."}
      </div>
    </div>
  )
}

function FileLine({ label, available }: { label: string; available: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[12px]">
      <span className="font-semibold text-white/95">{label}</span>
      <span className={available ? "text-[#4ade80] text-[11px] font-semibold flex-none" : "text-white/40 text-[11px] flex-none"}>
        {available ? "Disponível" : "Ainda não disponível"}
      </span>
    </div>
  )
}

// ============================================================
// ABAS-PLACEHOLDER (Dados registrais / Histórico)
// ============================================================

function PlaceholderTab({ title, msg }: { title: string; msg: string }) {
  return (
    <div className="flex flex-col gap-2 py-8 text-center">
      <div className="text-[13px] font-bold text-white/95">{title}</div>
      <p className="text-[12px] text-white/40 max-w-[380px] mx-auto leading-relaxed">{msg}</p>
    </div>
  )
}