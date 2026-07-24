// src/components/kanban/ProcessoDocumentosBiblioteca.tsx
//
// Aba "Documentos" — Biblioteca documental consolidada, clone fiel do mockup
// discovery-central-operacional-v2.html (subDocumentos / libDonut / libLegend /
// renderPersonDocumentGroup / renderDocumentRowInsidePerson).
//
// Layout: grid [conteúdo | 300px lateral]
//   - Título "Documentos" + 8 KPIs no topo
//   - Toolbar (Filtros + chips + busca)
//   - Seção LINHA PRINCIPAL e FORA DA LINHAGEM, cada pessoa é um card expansível
//     com tabela de 8 colunas (Documento/Tipo/Certidão/Cert.retificada/Tradução/
//     Apostila/Status final/Ações)
//   - Lateral: Resumo da biblioteca (donut), Legenda de status, Informações
//
// CASCA fiel. Recebe os dados via props (mapeados da rota /documentos no
// componente pai). Colunas que o backend ainda não fornece (tradução, apostila,
// cert. retificada) aparecem "não se aplica"/"pendente" até alinhar.

"use client"

import { useState } from "react"
import { FileText, Filter, Search, CheckCircle2, Clock, ChevronDown } from "lucide-react"

// ============================================================
// TIPOS
// ============================================================

type CellStatus = "validada" | "recebida" | "pendente" | "nao_aplica"
type FinalStatus = "pronta_protocolo" | "pendente" | "aguardando"

export interface BibDocItem {
  id: number
  documentType: string        // "Certidão de Nascimento"
  documentFormat: string      // "Inteiro teor"
  personName: string
  certificate: { status: CellStatus; date?: string | null }
  retifiedCertificate: { status: CellStatus; date?: string | null }
  translation: { status: CellStatus; date?: string | null }
  apostille: { status: CellStatus; date?: string | null }
  finalStatus: FinalStatus
}

export interface BibPersonGroup {
  personId: number
  personName: string
  role: string
  lineage: "Linha reta" | "Fora da linha"
  generation: number | string
  stats: { totalDocuments: number; readyForProtocol: number; pending: number }
  documents: BibDocItem[]
}

export interface BibKpis {
  pessoas: number
  obrig: number
  certRec: number
  certRetif: number
  trad: number
  apost: number
  pronto: number
  pend: number
}

export interface ProcessoDocumentosBibliotecaProps {
  kpis: BibKpis
  linhaPrincipal: BibPersonGroup[]
  foraDaLinha: BibPersonGroup[]
  onAbrirDetalhes: (docId: number) => void
}

const FILTERS = [
  "Todos", "Linha reta", "Fora da linha", "Pendentes",
  "Prontos para protocolo", "Com tradução", "Com apostila", "Sem apostila", "Retificadas",
] as const

const FINAL_LABEL: Record<FinalStatus, string> = {
  pronta_protocolo: "Pronto para protocolo",
  pendente: "Pendente",
  aguardando: "Aguardando",
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function ProcessoDocumentosBiblioteca({
  kpis,
  linhaPrincipal,
  foraDaLinha,
  onAbrirDetalhes,
}: ProcessoDocumentosBibliotecaProps) {
  const [filtro, setFiltro] = useState<string>("Todos")
  const [busca, setBusca] = useState("")

  const kpiCards: Array<[string, number, string, string]> = [
    ["Pessoas com documentos", kpis.pessoas, "👥", ""],
    ["Certidões obrigatórias", kpis.obrig, "📄", ""],
    ["Certidões recebidas", kpis.certRec, "✅", "g"],
    ["Certidões retificadas", kpis.certRetif, "📝", "o"],
    ["Traduções recebidas", kpis.trad, "📄", "b"],
    ["Apostilas recebidas", kpis.apost, "🏛️", "p"],
    ["Prontos para protocolo", kpis.pronto, "✅", "g"],
    ["Pendentes", kpis.pend, "⏳", "o"],
  ]

  const matchFilter = (it: BibDocItem, lineage: string): boolean => {
    if (filtro === "Linha reta" && lineage !== "Linha reta") return false
    if (filtro === "Fora da linha" && lineage === "Linha reta") return false
    if (filtro === "Pendentes" && it.finalStatus !== "pendente") return false
    if (filtro === "Prontos para protocolo" && it.finalStatus !== "pronta_protocolo") return false
    if (filtro === "Com tradução" && !(it.translation.status === "recebida" || it.translation.status === "validada")) return false
    if (filtro === "Com apostila" && !(it.apostille.status === "recebida" || it.apostille.status === "validada")) return false
    if (filtro === "Sem apostila" && (it.apostille.status === "recebida" || it.apostille.status === "validada")) return false
    if (filtro === "Retificadas" && it.retifiedCertificate.status !== "validada") return false
    if (busca) {
      const q = busca.toLowerCase()
      if (!`${it.personName} ${it.documentType} ${it.documentFormat}`.toLowerCase().includes(q)) return false
    }
    return true
  }

  return (
    <div className="h-full overflow-y-auto bg-[#15191f]">
      <div
        className="grid gap-[18px] items-start p-6"
        style={{ gridTemplateColumns: "minmax(0,1fr) 300px" }}
      >
        {/* ============== COLUNA PRINCIPAL ============== */}
        <div className="min-w-0">
          {/* Título */}
          <div className="flex items-center gap-3 mb-[18px]">
            <div className="w-10 h-10 text-white/55">
              <FileText className="w-[30px] h-[30px]" strokeWidth={1.7} />
            </div>
            <div>
              <h2 className="text-[21px] font-extrabold text-white/95">Documentos</h2>
              <span className="text-[13px] text-white/55">Biblioteca documental consolidada do processo.</span>
            </div>
          </div>

          {/* 8 KPIs */}
          <div className="grid gap-2.5 mb-[18px]" style={{ gridTemplateColumns: "repeat(8, 1fr)" }}>
            {kpiCards.map(([label, val, ic, tone], i) => (
              <div key={i} className="bg-[#1b2027] border border-white/10 rounded-xl p-[13px]">
                <span className="text-[10.5px] text-white/55 block leading-tight min-h-[28px]">{label}</span>
                <div className="flex items-center justify-between mt-1.5">
                  <b className="text-[23px] font-extrabold text-white/95">{val}</b>
                  <span className="text-[15px] opacity-85">{ic}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Toolbar: filtros + busca */}
          <div className="flex items-center justify-between gap-3.5 mb-5 flex-wrap">
            <div className="flex items-center gap-[7px] flex-wrap">
              <button className="inline-flex items-center gap-1.5 border border-white/10 bg-[#1b2027] rounded-lg px-3 py-2 text-[12.5px] font-semibold text-white/55">
                <Filter className="w-3.5 h-3.5" /> Filtros
              </button>
              {FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFiltro(f)}
                  className={`border rounded-lg px-[13px] py-2 text-[12.5px] font-semibold cursor-pointer transition-colors ${
                    f === filtro
                      ? "bg-[#7dd3fc]/12 border-[#7dd3fc] text-[#7dd3fc]"
                      : "border-white/10 bg-[#1b2027] text-white/55 hover:border-white/20"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 border border-white/10 bg-[#1b2027] rounded-lg px-[13px] py-2 min-w-[280px] flex-1 max-w-[340px]">
              <Search className="w-[15px] h-[15px] text-white/40" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por pessoa ou documento..."
                className="border-none outline-none text-[13px] w-full bg-transparent text-white/95"
              />
            </div>
          </div>

          {/* Seção LINHA PRINCIPAL */}
          <div className="mb-6">
            <div className="border-l-[3px] border-[#7dd3fc] pl-3 mb-3.5">
              <b className="text-[13px] font-extrabold text-white/95 tracking-wide">LINHA PRINCIPAL · TRANSMISSÃO DE CIDADANIA</b>
              <span className="block text-[12px] text-white/55 mt-0.5">Pessoas da linha reta ordenadas por geração</span>
            </div>
            {linhaPrincipal.length === 0 ? (
              <div className="p-[18px] text-center text-white/40 text-[13px]">Nenhuma pessoa nesta seção.</div>
            ) : (
              linhaPrincipal.map((g) => (
                <PersonGroup key={g.personId} g={g} matchFilter={matchFilter} onAbrirDetalhes={onAbrirDetalhes} />
              ))
            )}
          </div>

          {/* Seção FORA DA LINHAGEM */}
          <div className="mb-6">
            <div className="border-l-[3px] border-white/20 pl-3 mb-3.5">
              <b className="text-[13px] font-extrabold text-white/95 tracking-wide">FORA DA LINHAGEM · CÔNJUGES / APOIO</b>
              <span className="block text-[12px] text-white/55 mt-0.5">Pessoas fora da linha reta ou documentos de apoio</span>
            </div>
            {foraDaLinha.length === 0 ? (
              <div className="p-[18px] text-center text-white/40 text-[13px]">Nenhuma pessoa nesta seção.</div>
            ) : (
              foraDaLinha.map((g) => (
                <PersonGroup key={g.personId} g={g} matchFilter={matchFilter} onAbrirDetalhes={onAbrirDetalhes} />
              ))
            )}
          </div>
        </div>

        {/* ============== COLUNA LATERAL ============== */}
        <div className="flex flex-col gap-3.5">
          {/* Resumo da biblioteca (donut) */}
          <div className="bg-[#1b2027] border border-white/10 rounded-xl p-[15px]">
            <h3 className="text-[13.5px] font-extrabold text-white/95 mb-3">Resumo da biblioteca</h3>
            <Donut kpis={kpis} />
          </div>

          {/* Legenda */}
          <div className="bg-[#1b2027] border border-white/10 rounded-xl p-[15px]">
            <h3 className="text-[13.5px] font-extrabold text-white/95 mb-3">Legenda de status</h3>
            <Legenda />
          </div>

          {/* Informações */}
          <div className="bg-[#1b2027] border border-white/10 rounded-xl p-[15px]">
            <h3 className="text-[13.5px] font-extrabold text-white/95 mb-3">⚠ Informações</h3>
            <p className="text-[11.5px] text-white/55 leading-relaxed mb-2">
              A biblioteca mostra apenas certidões, certidões retificadas, traduções juramentadas e apostilas de Haia.
            </p>
            <p className="text-[11.5px] text-white/55 leading-relaxed">
              Documentos jurídicos e operacionais ficam dentro das fases que os geraram.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// SUBCOMPONENTES
// ============================================================

function PersonGroup({
  g,
  matchFilter,
  onAbrirDetalhes,
}: {
  g: BibPersonGroup
  matchFilter: (it: BibDocItem, lineage: string) => boolean
  onAbrirDetalhes: (docId: number) => void
}) {
  const [aberto, setAberto] = useState(true)
  const docs = g.documents.filter((it) => matchFilter(it, g.lineage))
  if (docs.length === 0) return null

  const ini = (g.personName || "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()
  const genTxt = g.lineage === "Linha reta" ? `Geração ${g.generation}` : "Fora da linha"

  return (
    <div className="bg-[#1b2027] border border-white/10 rounded-2xl mb-3 overflow-hidden">
      {/* Cabeçalho da pessoa */}
      <div
        className="flex items-center gap-3.5 px-[18px] py-4 cursor-pointer"
        onClick={() => setAberto(!aberto)}
      >
        <span className="w-[38px] h-[38px] rounded-full bg-[#252c35] text-white/55 grid place-items-center text-[13px] font-bold flex-none">
          {ini}
        </span>
        <div className="flex-1 min-w-0">
          <b className="text-[14.5px] text-white/95">
            {g.personName}
            {g.lineage !== "Linha reta" && <span className="font-medium text-white/55"> ({g.role})</span>}
          </b>
          <span className="block text-[12px] text-white/55 mt-px">{genTxt} · {g.lineage} · {g.role}</span>
        </div>
        <div className="flex gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white/55 bg-[#20262e] border border-white/10 rounded-lg px-[11px] py-1.5">
            <FileText className="w-3.5 h-3.5" /> {g.stats.totalDocuments} documentos
          </span>
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#4ade80] bg-[#4ade80]/12 border border-[#4ade80]/30 rounded-lg px-[11px] py-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> {g.stats.readyForProtocol} pronto{g.stats.readyForProtocol === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#d2a948] bg-[#d2a948]/12 border border-[#d2a948]/30 rounded-lg px-[11px] py-1.5">
            <Clock className="w-3.5 h-3.5" /> {g.stats.pending} pendentes
          </span>
        </div>
        <ChevronDown className={`w-[18px] h-[18px] text-white/40 transition-transform ${aberto ? "" : "-rotate-90"}`} />
      </div>

      {/* Corpo (tabela) */}
      {aberto && (
        <div className="border-t border-white/10">
          {/* Cabeçalho de colunas */}
          <div
            className="grid gap-2.5 items-center px-[18px] py-[13px] bg-[#20262e] text-white/40 text-[10px] font-bold tracking-wider"
            style={{ gridTemplateColumns: "1.6fr .9fr 1fr 1.1fr 1fr 1fr 1.1fr .9fr" }}
          >
            <span>DOCUMENTO</span>
            <span>TIPO</span>
            <span>CERTIDÃO</span>
            <span>CERT. RETIFICADA</span>
            <span>TRADUÇÃO</span>
            <span>APOSTILA</span>
            <span>STATUS FINAL</span>
            <span>AÇÕES</span>
          </div>
          {docs.map((it) => (
            <DocRow key={it.id} it={it} onAbrirDetalhes={onAbrirDetalhes} />
          ))}
        </div>
      )}
    </div>
  )
}

function DocRow({ it, onAbrirDetalhes }: { it: BibDocItem; onAbrirDetalhes: (docId: number) => void }) {
  const finalCls =
    it.finalStatus === "pronta_protocolo" ? "text-[#4ade80]"
    : "text-[#d2a948]"

  return (
    <div
      className="grid gap-2.5 items-center px-[18px] py-[13px] border-t border-white/10 text-[12.5px]"
      style={{ gridTemplateColumns: "1.6fr .9fr 1fr 1.1fr 1fr 1fr 1.1fr .9fr" }}
    >
      {/* Documento */}
      <span className="flex items-center gap-2.5">
        <span className="w-5 h-5 text-white/40 flex-none">
          <FileText className="w-5 h-5" />
        </span>
        <span>
          <b className="text-[13px] text-white/95 block">{it.documentType}</b>
          <small className="text-[11px] text-white/40">{it.personName}</small>
        </span>
      </span>

      {/* Tipo */}
      <span className="text-[12px] text-white/55">{it.documentFormat}</span>

      {/* Certidão / Cert. retificada / Tradução / Apostila */}
      <StatusCell st={it.certificate.status} date={it.certificate.date} />
      <StatusCell st={it.retifiedCertificate.status} date={it.retifiedCertificate.date} />
      <StatusCell st={it.translation.status} date={it.translation.date} />
      <StatusCell st={it.apostille.status} date={it.apostille.date} />

      {/* Status final */}
      <span className={`text-[12px] font-bold ${finalCls}`}>{FINAL_LABEL[it.finalStatus]}</span>

      {/* Ações */}
      <span>
        <button
          onClick={() => onAbrirDetalhes(it.id)}
          className="border border-white/10 bg-[#1b2027] rounded-lg px-[13px] py-[7px] text-[12px] font-semibold text-white/95 cursor-pointer hover:border-[#7dd3fc] hover:text-[#7dd3fc] transition-colors"
        >
          Abrir detalhes
        </button>
      </span>
    </div>
  )
}

function StatusCell({ st, date }: { st: CellStatus; date?: string | null }) {
  if (st === "nao_aplica") return <span className="text-[11.5px] text-white/40">Não se aplica</span>

  const cls =
    st === "validada" ? "text-[#4ade80]"
    : st === "recebida" ? "text-[#7dd3fc]"
    : "text-[#d2a948]"
  const txt =
    st === "validada" ? "Validada"
    : st === "recebida" ? "Recebida"
    : "Pendente"

  if (st === "pendente" && !date) {
    return <span className="text-white/40">—</span>
  }

  return (
    <span>
      <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold ${cls}`}>
        <span className="w-[7px] h-[7px] rounded-full bg-current" />
        {txt}
      </span>
      {date && <small className="block text-[10.5px] text-white/40 mt-px ml-3">{date}</small>}
    </span>
  )
}

// ---- Donut do resumo ----
function Donut({ kpis }: { kpis: BibKpis }) {
  const total = kpis.obrig || 1
  const segs: Array<[string, number, string]> = [
    ["Prontos para protocolo", kpis.pronto, "#16a34a"],
    ["Com tradução", kpis.trad, "#2563eb"],
    ["Com apostila", kpis.apost, "#7c3aed"],
    ["Pendentes", kpis.pend, "#f59e0b"],
  ]
  const r = 42
  const c = 2 * Math.PI * r
  let acc = 0
  const circles = segs.map((s, i) => {
    const frac = s[1] / total
    const len = c * frac
    const el = (
      <circle
        key={i}
        cx="55" cy="55" r={r}
        fill="none" stroke={s[2]} strokeWidth="11"
        strokeDasharray={`${len} ${c - len}`}
        strokeDashoffset={-acc}
        transform="rotate(-90 55 55)"
      />
    )
    acc += len
    return el
  })

  return (
    <div className="flex flex-col gap-3.5">
      <div className="relative w-[110px] h-[110px] mx-auto">
        <svg viewBox="0 0 110 110" width="110" height="110">
          <circle cx="55" cy="55" r={r} fill="none" stroke="#eef1f6" strokeWidth="11" />
          {circles}
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <b className="text-[20px] font-extrabold text-white/95 block">{kpis.obrig}</b>
          <span className="text-[10px] text-white/40">Total</span>
        </div>
      </div>
      <div className="flex flex-col gap-[7px]">
        {segs.map((s, i) => {
          const pct = Math.round((s[1] / total) * 100)
          return (
            <div key={i} className="flex items-center gap-[7px] text-[11.5px] text-white/55">
              <span className="w-[9px] h-[9px] rounded-[3px] flex-none" style={{ background: s[2] }} />
              {s[0]}
              <b className="ml-auto text-white/95 text-[11.5px]">{s[1]} ({pct}%)</b>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---- Legenda de status ----
function Legenda() {
  const items: Array<[string, string, string]> = [
    ["bg-[#4ade80]", "Validada", "Documento validado e aprovado"],
    ["bg-[#7dd3fc]", "Recebida", "Documento recebido, aguardando validação"],
    ["bg-[#d2a948]/120", "Pendente", "Documento ainda não recebido"],
    ["bg-white/20", "Não se aplica", "Não aplicável para este documento"],
    ["bg-[#4ade80]", "Pronto para protocolo", "Certidão + Tradução + Apostila concluídas"],
    ["bg-[#d2a948]/120", "Aguardando", "Etapa pendente para conclusão"],
  ]
  return (
    <div className="flex flex-col gap-[11px]">
      {items.map(([dot, title, desc], i) => (
        <div key={i} className="flex gap-2.5 items-start">
          <span className={`w-[13px] h-[13px] rounded-full flex-none mt-0.5 ${dot}`} />
          <div>
            <b className="text-[12px] text-white/95 block">{title}</b>
            <span className="text-[11px] text-white/40">{desc}</span>
          </div>
        </div>
      ))}
    </div>
  )
}