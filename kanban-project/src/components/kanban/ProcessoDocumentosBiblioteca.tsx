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

import { rotuloGrupoPessoa } from "@/src/lib/documentos/rotulo-grupo-pessoa"
import { useState } from "react"
import { FileText, Filter, Search, CheckCircle2, Clock, ChevronDown, Ban } from "lucide-react"
import type { EncerramentoDoDocumento } from "@/src/lib/process-stage/estrutura-operacional-core"
import { dataHoraSP } from "@/lib/operacional/historico-filtros"
import { PlanilhaDocumentalView, type BlocoDaPlanilha, type LinhaDaPlanilha } from "@/src/components/financeiro/v3/PlanilhaDocumentalView"

// ============================================================
// TIPOS
// ============================================================

type CellStatus = "validada" | "recebida" | "pendente" | "nao_aplica"
type FinalStatus = "pronta_protocolo" | "pendente" | "aguardando" | "cancelada" | "nao_exigida"

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
  /** Cancelada / não exigida: quem, quando e por quê. `null` = ativa. */
  encerramento?: EncerramentoDoDocumento | null
  arquivoUrl: string | null
  arquivoNome: string | null
  arquivoMimeType: string | null
  /** Dados registrais — mesmos campos editados na Central Operacional (só leitura aqui). */
  registro: {
    descricao: string | null
    dataEvento: string | null
    dataRegistro: string | null
    paisRegistro: string | null
    estadoRegistro: string | null
    cidadeRegistro: string | null
    cartorio: string | null
    livro: string | null
    folha: string | null
    termo: string | null
    numeroRegistro: string | null
  }
}

export interface BibPersonGroup {
  personId: number
  personName: string
  role: string
  lineage: "Linha reta" | "Fora da linha"
  generation: number | string
  /** `totalDocuments` = requeridas (só as ativas); canceladas e não exigidas ficam à parte e fora da conta. */
  stats: { totalDocuments: number; readyForProtocol: number; pending: number; cancelled: number; notRequired: number }
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
  /** "Reabrir" da certidão cancelada (porta canônica). Ausente ⇒ só "Ver motivo". Devolve a mensagem de erro, ou null. */
  onReabrirCertidao?: (tarefaId: number, motivo: string) => Promise<string | null>
  /** O processo — para a «Planilha documental» (a mesma de Financeiro → Custos, SEM valores). Ausente ⇒ o seletor de visão não aparece. */
  processoId?: number
}

type Vista = "lista" | "painel" | "planilha"
const VISTAS: ReadonlyArray<readonly [Vista, string]> = [["lista", "Lista"], ["painel", "Painel"], ["planilha", "Planilha documental"]]

const FILTERS = [
  "Todos", "Linha reta", "Fora da linha", "Pendentes",
  "Prontos para protocolo", "Com tradução", "Com apostila", "Sem apostila", "Retificadas",
] as const

const FINAL_LABEL: Record<FinalStatus, string> = {
  pronta_protocolo: "Pronto para protocolo",
  pendente: "Pendente",
  aguardando: "Aguardando",
  cancelada: "Cancelada",
  nao_exigida: "Não exigida",
}

/** Filtro de STATUS: o padrão MOSTRA as canceladas (cancelar nunca esconde); "Só ativas" as tira; "Cancelada" lista só elas. */
const STATUS_FILTROS = [
  ["todos", "Todos os status (incl. canceladas)"], ["ativas", "Só ativas"], ["cancelada", "Cancelada"], ["nao_exigida", "Não exigida"],
] as const
type StatusFiltro = (typeof STATUS_FILTROS)[number][0]
const ehEncerrada = (it: BibDocItem) => it.finalStatus === "cancelada" || it.finalStatus === "nao_exigida"

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function ProcessoDocumentosBiblioteca({
  kpis,
  linhaPrincipal,
  foraDaLinha,
  onAbrirDetalhes,
  onReabrirCertidao,
  processoId,
}: ProcessoDocumentosBibliotecaProps) {
  const [vista, setVista] = useState<Vista>("lista")
  const [filtro, setFiltro] = useState<string>("Todos")
  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>("todos")
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
    if (statusFiltro === "ativas" && ehEncerrada(it)) return false
    if (statusFiltro === "cancelada" && it.finalStatus !== "cancelada") return false
    if (statusFiltro === "nao_exigida" && it.finalStatus !== "nao_exigida") return false
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

  // A PLANILHA OBEDECE AOS MESMOS FILTROS DA LISTA. Linha com documento: o mesmo `matchFilter` do item (e a linhagem do grupo dele). Linha sem
  // documento (o registro que falta): só os filtros que não dependem de status do documento — linhagem, busca e «ativas».
  const linhagemDoDocumento = new Map<number, string>()
  const itemPorId = new Map<number, BibDocItem>()
  for (const g of [...linhaPrincipal, ...foraDaLinha]) for (const d of g.documents) { itemPorId.set(d.id, d); linhagemDoDocumento.set(d.id, g.lineage) }
  const filtrarLinhaDaPlanilha = (b: BlocoDaPlanilha, l: LinhaDaPlanilha): boolean => {
    const item = l.documentoId ? itemPorId.get(l.documentoId) : undefined
    if (item) return matchFilter(item, linhagemDoDocumento.get(item.id) ?? (b.linhagemPrincipal ? "Linha reta" : "Fora da linha"))
    const lineage = b.linhagemPrincipal ? "Linha reta" : "Fora da linha"
    if (statusFiltro === "cancelada" || statusFiltro === "nao_exigida") return false
    if (filtro === "Linha reta") return lineage === "Linha reta" && sobBusca(b, l)
    if (filtro === "Fora da linha") return lineage !== "Linha reta" && sobBusca(b, l)
    return filtro === "Todos" && sobBusca(b, l)
  }
  const sobBusca = (b: BlocoDaPlanilha, l: LinhaDaPlanilha) => !busca || `${b.nome} ${l.tipoRegistro ?? ""}`.toLowerCase().includes(busca.toLowerCase())

  return (
    <div className="h-full overflow-y-auto bg-[var(--surface-popover)]">
      {/* ABAIXO DE lg: 1 coluna (a barra de 300px cai para baixo do conteúdo
          principal, em vez de espremer os dois lado a lado numa tela
          estreita) — mandato "modernização visual", 19/09/2026. */}
      <div className="grid grid-cols-1 items-start gap-[18px] p-6 lg:[grid-template-columns:minmax(0,1fr)_300px]">
        {/* ============== COLUNA PRINCIPAL ============== */}
        <div className="min-w-0">
          {/* Título */}
          <div className="flex items-center gap-3 mb-[18px]">
            <div className="w-10 h-10 text-[var(--text-secondary)]">
              <FileText className="w-[30px] h-[30px]" strokeWidth={1.7} />
            </div>
            <div>
              <h2 className="text-[21px] font-extrabold text-white/95">Documentos</h2>
              <span className="text-[13px] text-[var(--text-secondary)]">Biblioteca documental consolidada do processo.</span>
            </div>
            {processoId != null && (
              <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-[var(--border-strong)]" role="group" aria-label="Visão dos documentos">
                {VISTAS.map(([v, rotulo]) => (
                  <button key={v} onClick={() => setVista(v)} aria-pressed={vista === v}
                    className={`px-3.5 py-2 text-[12.5px] font-semibold ${vista === v ? "bg-[var(--accent-primary)] text-[var(--accent-ink)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}>{rotulo}</button>
                ))}
              </div>
            )}
          </div>

          {/* 8 KPIs — 2 colunas em mobile, cresce até 8 num desktop largo */}
          <div className="grid grid-cols-2 gap-2.5 mb-[18px] sm:grid-cols-4 xl:grid-cols-8">
            {kpiCards.map(([label, val, ic, tone], i) => (
              <div key={i} className="bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-xl p-[13px]">
                <span className="text-[10.5px] text-[var(--text-secondary)] block leading-tight min-h-[28px]">{label}</span>
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
              <button className="inline-flex items-center gap-1.5 border border-[var(--border-default)] bg-[var(--surface-popover)] rounded-lg px-3 py-2 text-[12.5px] font-semibold text-[var(--text-secondary)]">
                <Filter className="w-3.5 h-3.5" /> Filtros
              </button>
              {FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFiltro(f)}
                  className={`border rounded-lg px-[13px] py-2 text-[12.5px] font-semibold cursor-pointer transition-colors ${
                    f === filtro
                      ? "bg-[var(--surface-secondary)] border-[var(--border-default)] text-[var(--text-secondary)]"
                      : "border-[var(--border-default)] bg-[var(--surface-popover)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <select
              aria-label="Filtrar por status"
              value={statusFiltro}
              onChange={(e) => setStatusFiltro(e.target.value as StatusFiltro)}
              className="border border-[var(--border-default)] bg-[var(--surface-popover)] rounded-lg px-3 py-2 text-[12.5px] font-semibold text-[var(--text-secondary)]"
            >
              {STATUS_FILTROS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
            <div className="flex items-center gap-2 border border-[var(--border-default)] bg-[var(--surface-popover)] rounded-lg px-[13px] py-2 min-w-[280px] flex-1 max-w-[340px]">
              <Search className="w-[15px] h-[15px] text-[var(--text-muted)]" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por pessoa ou documento..."
                className="border-none outline-none text-[13px] w-full bg-transparent text-white/95"
              />
            </div>
          </div>

          {/* PLANILHA DOCUMENTAL — a mesma de Custos, sem valores, respeitando os filtros acima. */}
          {vista === "planilha" && processoId != null && (
            <PlanilhaDocumentalView processoId={processoId} semValores filtrarLinha={filtrarLinhaDaPlanilha} />
          )}

          {/* PAINEL — uma visão por pessoa, a partir dos mesmos números da lista. */}
          {vista === "painel" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 mb-6">
              {[...linhaPrincipal, ...foraDaLinha]
                .filter((g) => g.documents.some((d) => matchFilter(d, g.lineage)))
                .map((g) => (
                  <div key={g.personId} className="bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-xl p-3.5" data-testid="painel-pessoa">
                    <div className="flex items-baseline justify-between gap-2">
                      <b className="text-[13px] font-extrabold text-white/95">{g.personName}</b>
                      <span className="text-[11px] text-[var(--text-muted)]">{g.lineage === "Linha reta" ? `Geração ${g.generation}` : g.role}</span>
                    </div>
                    <div className="mt-2 text-[12px] text-[var(--text-secondary)]">
                      {g.stats.readyForProtocol} de {g.stats.totalDocuments} prontas para protocolo · {g.stats.pending} pendente{g.stats.pending === 1 ? "" : "s"}
                      {g.stats.cancelled + g.stats.notRequired > 0 ? ` · ${g.stats.cancelled + g.stats.notRequired} cancelada/não exigida` : ""}
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* Seção LINHA PRINCIPAL */}
          {vista === "lista" && <>
          <div className="mb-6">
            <div className="border-l-[3px] border-[var(--border-default)] pl-3 mb-3.5">
              <b className="text-[13px] font-extrabold text-white/95 tracking-wide">LINHA PRINCIPAL · TRANSMISSÃO DE CIDADANIA</b>
              <span className="block text-[12px] text-[var(--text-secondary)] mt-0.5">Pessoas da linha reta ordenadas por geração</span>
            </div>
            {linhaPrincipal.length === 0 ? (
              <div className="p-[18px] text-center text-[var(--text-muted)] text-[13px]">Nenhuma pessoa nesta seção.</div>
            ) : (
              linhaPrincipal.map((g) => (
                <PersonGroup key={g.personId} g={g} matchFilter={matchFilter} onAbrirDetalhes={onAbrirDetalhes} onReabrirCertidao={onReabrirCertidao} />
              ))
            )}
          </div>

          {/* Seção FORA DA LINHAGEM */}
          <div className="mb-6">
            <div className="border-l-[3px] border-[var(--border-strong)] pl-3 mb-3.5">
              <b className="text-[13px] font-extrabold text-white/95 tracking-wide">FORA DA LINHAGEM · CÔNJUGES / APOIO</b>
              <span className="block text-[12px] text-[var(--text-secondary)] mt-0.5">Pessoas fora da linha reta ou documentos de apoio</span>
            </div>
            {foraDaLinha.length === 0 ? (
              <div className="p-[18px] text-center text-[var(--text-muted)] text-[13px]">Nenhuma pessoa nesta seção.</div>
            ) : (
              foraDaLinha.map((g) => (
                <PersonGroup key={g.personId} g={g} matchFilter={matchFilter} onAbrirDetalhes={onAbrirDetalhes} onReabrirCertidao={onReabrirCertidao} />
              ))
            )}
          </div>
          </>}
        </div>

        {/* ============== COLUNA LATERAL ============== */}
        <div className="flex flex-col gap-3.5">
          {/* Resumo da biblioteca (donut) */}
          <div className="bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-xl p-[15px]">
            <h3 className="text-[13.5px] font-extrabold text-white/95 mb-3">Resumo da biblioteca</h3>
            <Donut kpis={kpis} />
          </div>

          {/* Legenda */}
          <div className="bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-xl p-[15px]">
            <h3 className="text-[13.5px] font-extrabold text-white/95 mb-3">Legenda de status</h3>
            <Legenda />
          </div>

          {/* Informações */}
          <div className="bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-xl p-[15px]">
            <h3 className="text-[13.5px] font-extrabold text-white/95 mb-3">⚠ Informações</h3>
            <p className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed mb-2">
              A biblioteca mostra apenas certidões, certidões retificadas, traduções juramentadas e apostilas de Haia.
            </p>
            <p className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed">
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
  onReabrirCertidao,
}: {
  g: BibPersonGroup
  matchFilter: (it: BibDocItem, lineage: string) => boolean
  onAbrirDetalhes: (docId: number) => void
  onReabrirCertidao?: (tarefaId: number, motivo: string) => Promise<string | null>
}) {
  const [aberto, setAberto] = useState(true)
  const docs = g.documents.filter((it) => matchFilter(it, g.lineage))
  // Some da tela SÓ quando é o filtro/busca escondendo os documentos dela.
  // Quando ela não tem nenhum documento aplicável (tudo dispensado/cancelado),
  // ela continua no roster — pessoa vem da árvore, doc não condiciona exibição
  // (achado real: Edithe sumia da seção "Fora da linhagem" depois de dispensada).
  if (g.documents.length > 0 && docs.length === 0) return null

  const ini = (g.personName || "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()
  const subtituloPessoa = rotuloGrupoPessoa({ lineage: g.lineage, generation: g.generation, role: g.role })

  return (
    <div className="bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-2xl mb-3 overflow-hidden">
      {/* Cabeçalho da pessoa */}
      <div
        className="flex items-center gap-3.5 px-[18px] py-4 cursor-pointer"
        onClick={() => setAberto(!aberto)}
      >
        <span className="w-[38px] h-[38px] rounded-full bg-[var(--surface-tertiary)] text-[var(--text-secondary)] grid place-items-center text-[13px] font-bold flex-none">
          {ini}
        </span>
        <div className="flex-1 min-w-0">
          <b className="text-[14.5px] text-white/95">{g.personName}</b>
          <span className="block text-[12px] text-[var(--text-secondary)] mt-px">{subtituloPessoa}</span>
        </div>
        <div className="flex gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-secondary)] bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-lg px-[11px] py-1.5">
            <FileText className="w-3.5 h-3.5" /> {g.stats.totalDocuments} requerida{g.stats.totalDocuments === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-green-800 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-lg px-[11px] py-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> {g.stats.readyForProtocol} pronto{g.stats.readyForProtocol === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--accent-text)] bg-[var(--accent-primary)]/12 border border-[var(--accent-primary)]/30 rounded-lg px-[11px] py-1.5">
            <Clock className="w-3.5 h-3.5" /> {g.stats.pending} pendentes
          </span>
          {g.stats.cancelled > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-red-700 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-lg px-[11px] py-1.5">
              <Ban className="w-3.5 h-3.5" /> {g.stats.cancelled} cancelada{g.stats.cancelled === 1 ? "" : "s"}
            </span>
          )}
          {g.stats.notRequired > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-secondary)] bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-lg px-[11px] py-1.5">
              <Ban className="w-3.5 h-3.5" /> {g.stats.notRequired} não exigida{g.stats.notRequired === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <ChevronDown className={`w-[18px] h-[18px] text-[var(--text-muted)] transition-transform ${aberto ? "" : "-rotate-90"}`} />
      </div>

      {/* Corpo (tabela) */}
      {aberto && (
        <div className="border-t border-[var(--border-default)]">
          {docs.length === 0 ? (
            <div className="px-[18px] py-4 text-[12.5px] text-[var(--text-muted)]">
              Nenhum documento aplicável — exigência dispensada.
            </div>
          ) : (
            // 8 colunas não cabem numa tela estreita sem cortar dado — rolagem
            // horizontal PRÓPRIA desta tabela (nunca a página inteira), com a
            // largura mínima preservando as proporções originais das colunas.
            <div className="overflow-x-auto">
              <div className="min-w-[900px]">
                {/* Cabeçalho de colunas */}
                <div
                  className="grid gap-2.5 items-center px-[18px] py-[13px] bg-[var(--surface-secondary)] text-[var(--text-muted)] text-[10px] font-bold tracking-wider"
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
                  ehEncerrada(it)
                    ? <DocRowEncerrada key={it.id} it={it} onAbrirDetalhes={onAbrirDetalhes} onReabrirCertidao={onReabrirCertidao} />
                    : <DocRow key={it.id} it={it} onAbrirDetalhes={onAbrirDetalhes} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Certidão CANCELADA / NÃO EXIGIDA: continua na lista da pessoa, esmaecida, no fim, com quem/quando/por quê.
 * "Ver motivo" sempre; "Reabrir" só para cancelamento humano de tarefa ainda cancelada e com a permissão da porta —
 * para NÃO EXIGIDA a árvore decide, e o painel diz por quê.
 */
function DocRowEncerrada({ it, onAbrirDetalhes, onReabrirCertidao }: {
  it: BibDocItem; onAbrirDetalhes: (docId: number) => void; onReabrirCertidao?: (tarefaId: number, motivo: string) => Promise<string | null>
}) {
  const [motivoAberto, setMotivoAberto] = useState(false)
  const [reabrindo, setReabrindo] = useState(false)
  const [justificativa, setJustificativa] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const e = it.encerramento ?? null
  const naoExigida = it.finalStatus === "nao_exigida"
  const quando = e?.quandoRotulo ?? null
  const resumo = naoExigida
    ? `Não exigida${e?.motivo ? `: ${e.motivo}` : " pela árvore"}`
    : `Cancelada${quando ? ` ${quando}` : ""}${e?.porNome ? ` por ${e.porNome}` : ""}${e?.motivo ? ` · ${e.motivo}` : ""}`
  const tarefaReabrivel = !naoExigida && e?.tarefaReabrivelId != null && onReabrirCertidao ? e.tarefaReabrivelId : null
  const confirmar = async () => {
    if (tarefaReabrivel == null || !onReabrirCertidao) return
    setEnviando(true); setErro(null)
    const m = await onReabrirCertidao(tarefaReabrivel, justificativa.trim())
    setEnviando(false)
    if (m) setErro(m); else { setReabrindo(false); setJustificativa("") }
  }
  return (
    <div className="border-t border-[var(--border-default)] bg-[var(--surface-secondary)]/40" data-encerrada={naoExigida ? "nao_exigida" : "cancelada"}>
      <div className="grid gap-2.5 items-center px-[18px] py-[13px] text-[12.5px] text-[var(--text-muted)]" style={{ gridTemplateColumns: "1.6fr .9fr 1fr 1.1fr 1fr 1fr 1.1fr .9fr" }}>
        <span className="flex items-center gap-2.5 min-w-0">
          <span className="w-5 h-5 flex-none"><Ban className="w-5 h-5" /></span>
          <span className="min-w-0">
            <b className="text-[13px] block line-through decoration-[var(--border-strong)]">{it.documentType}</b>
            <small className="text-[11px] block truncate" title={resumo}>{resumo}</small>
          </span>
        </span>
        <span className="text-[12px]">{it.documentFormat}</span>
        <span>—</span><span>—</span><span>—</span><span>—</span>
        <span>
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--surface-tertiary)] text-[var(--text-secondary)] whitespace-nowrap">{FINAL_LABEL[it.finalStatus]}</span>
        </span>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
          <button type="button" onClick={() => setMotivoAberto((v) => !v)} aria-expanded={motivoAberto} className="font-semibold text-[var(--accent-text)] hover:underline">Ver motivo</button>
          {tarefaReabrivel != null && !reabrindo && <button type="button" onClick={() => setReabrindo(true)} className="font-semibold text-[var(--accent-text)] hover:underline">Reabrir</button>}
          <button type="button" onClick={() => onAbrirDetalhes(it.id)} className="font-semibold text-[var(--text-secondary)] hover:underline">Detalhes</button>
        </span>
      </div>
      {motivoAberto && (
        <div className="mx-[18px] mb-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3.5 py-2.5 text-[12.5px] text-[var(--text-primary)]">
          <div><span className="text-[var(--text-secondary)]">{naoExigida ? "Situação:" : "Decisão:"}</span> {naoExigida ? "não exigida pela árvore" : "cancelada"}{e?.porNome ? ` por ${e.porNome}` : naoExigida ? " (a árvore mudou)" : ""}{e?.quando ? ` em ${dataHoraSP(e.quando)}` : ""}</div>
          {e?.motivo && <div><span className="text-[var(--text-secondary)]">Motivo:</span> {e.motivo}</div>}
          {e?.justificativa && <div><span className="text-[var(--text-secondary)]">Justificativa:</span> “{e.justificativa}”</div>}
          {!e && <div className="text-[var(--text-secondary)]">Nenhuma fonte guardou quem, quando e por quê.</div>}
          {naoExigida && e?.observacao && <div className="mt-1 text-[var(--text-secondary)]">{e.observacao}</div>}
          {!naoExigida && tarefaReabrivel == null && <div className="mt-1 text-[var(--text-secondary)]">Reabrir depende da permissão de editar tarefas e de a tarefa continuar cancelada.</div>}
        </div>
      )}
      {reabrindo && tarefaReabrivel != null && (
        <div className="mx-[18px] mb-3 flex flex-col gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] p-3">
          <label htmlFor={`reabrir-doc-${it.id}`} className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Por que reabrir? (fica no histórico)</label>
          <textarea id={`reabrir-doc-${it.id}`} value={justificativa} onChange={(ev) => setJustificativa(ev.target.value)} rows={2} maxLength={300}
            className="w-full resize-none rounded-lg border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]" />
          {erro && <div role="alert" className="text-[12.5px] text-[var(--danger-text)]">{erro}</div>}
          <div className="flex gap-2">
            <button type="button" disabled={enviando || justificativa.trim().length < 5} onClick={() => void confirmar()} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-tertiary)] px-3 py-1.5 text-[12px] font-bold disabled:opacity-50">{enviando ? "Reabrindo…" : "Confirmar reabertura"}</button>
            <button type="button" disabled={enviando} onClick={() => { setReabrindo(false); setErro(null) }} className="rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-[12px]">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}

function DocRow({ it, onAbrirDetalhes }: { it: BibDocItem; onAbrirDetalhes: (docId: number) => void }) {
  const finalCls =
    it.finalStatus === "pronta_protocolo" ? "text-green-800"
    : "text-[var(--accent-text)]"

  return (
    <div
      className="grid gap-2.5 items-center px-[18px] py-[13px] border-t border-[var(--border-default)] text-[12.5px]"
      style={{ gridTemplateColumns: "1.6fr .9fr 1fr 1.1fr 1fr 1fr 1.1fr .9fr" }}
    >
      {/* Documento */}
      <span className="flex items-center gap-2.5">
        <span className="w-5 h-5 text-[var(--text-muted)] flex-none">
          <FileText className="w-5 h-5" />
        </span>
        <span>
          <b className="text-[13px] text-white/95 block">{it.documentType}</b>
          <small className="text-[11px] text-[var(--text-muted)]">{it.personName}</small>
        </span>
      </span>

      {/* Tipo */}
      <span className="text-[12px] text-[var(--text-secondary)]">{it.documentFormat}</span>

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
          className="border border-[var(--border-default)] bg-[var(--surface-popover)] rounded-lg px-[13px] py-[7px] text-[12px] font-semibold text-white/95 cursor-pointer hover:border-[var(--border-default)] hover:text-[var(--text-secondary)] transition-colors"
        >
          Abrir detalhes
        </button>
      </span>
    </div>
  )
}

function StatusCell({ st, date }: { st: CellStatus; date?: string | null }) {
  if (st === "nao_aplica") return <span className="text-[11.5px] text-[var(--text-muted)]">Não se aplica</span>

  const cls =
    st === "validada" ? "text-green-800"
    : st === "recebida" ? "text-[var(--text-secondary)]"
    : "text-[var(--accent-text)]"
  const txt =
    st === "validada" ? "Validada"
    : st === "recebida" ? "Recebida"
    : "Pendente"

  if (st === "pendente" && !date) {
    return <span className="text-[var(--text-muted)]">—</span>
  }

  return (
    <span>
      <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold ${cls}`}>
        <span className="w-[7px] h-[7px] rounded-full bg-current" />
        {txt}
      </span>
      {date && <small className="block text-[10.5px] text-[var(--text-muted)] mt-px ml-3">{date}</small>}
    </span>
  )
}

// ---- Donut do resumo ----
function Donut({ kpis }: { kpis: BibKpis }) {
  const total = kpis.obrig || 1
  const segs: Array<[string, number, string]> = [
    ["Prontos para protocolo", kpis.pronto, "#16a34a"],
    ["Com tradução", kpis.trad, "#2875b7"],
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
          <span className="text-[10px] text-[var(--text-muted)]">Total</span>
        </div>
      </div>
      <div className="flex flex-col gap-[7px]">
        {segs.map((s, i) => {
          const pct = Math.round((s[1] / total) * 100)
          return (
            <div key={i} className="flex items-center gap-[7px] text-[11.5px] text-[var(--text-secondary)]">
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
    ["bg-[var(--surface-secondary)]", "Validada", "Documento validado e aprovado"],
    ["bg-[var(--surface-secondary)]", "Recebida", "Documento recebido, aguardando validação"],
    ["bg-[var(--accent-primary)]/120", "Pendente", "Documento ainda não recebido"],
    ["bg-[var(--surface-secondary)]", "Não se aplica", "Não aplicável para este documento"],
    ["bg-[var(--surface-secondary)]", "Pronto para protocolo", "Certidão + Análise Documental + Tradução + Apostila concluídas"],
    ["bg-[var(--accent-primary)]/120", "Aguardando", "Certidão recebida, aguardando Análise Documental ou outra etapa"],
    ["bg-[var(--surface-secondary)]", "Cancelada / Não exigida", "Continua na pasta, esmaecida, e não conta nas exigidas"],
  ]
  return (
    <div className="flex flex-col gap-[11px]">
      {items.map(([dot, title, desc], i) => (
        <div key={i} className="flex gap-2.5 items-start">
          <span className={`w-[13px] h-[13px] rounded-full flex-none mt-0.5 ${dot}`} />
          <div>
            <b className="text-[12px] text-white/95 block">{title}</b>
            <span className="text-[11px] text-[var(--text-muted)]">{desc}</span>
          </div>
        </div>
      ))}
    </div>
  )
}