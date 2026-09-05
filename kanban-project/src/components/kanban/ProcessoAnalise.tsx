// src/components/kanban/ProcessoAnalise.tsx
"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useApi } from "@/src/lib/dados"
import {
  Loader2, Sparkles, CheckCircle2, AlertTriangle, ArrowRight, Check, X,
  FileText, Scale, Landmark, Search, Download, Eye, MoreVertical, ChevronDown,
  ExternalLink, Link2,
} from "lucide-react"

interface Divergencia {
  id: number
  pessoaNome: string
  geracao: number | null
  linhaReta: boolean
  documentoId: number | null
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
  decididoEm?: string | null
}

interface Analise {
  id: number
  status: string
  currentStep: string
  documentosAnalisados: number
  totalDocumentos: number
  camposComparados: number
  decisaoJuridica: string | null
  startedAt?: string | null
  completedAt?: string | null
  divergencias: Divergencia[]
}

interface DocV2 {
  id: number
  tipo: string
  titulo: string
  status: string
  dataStatus: string
  analysisStatus: string
  structuredData: Record<string, unknown> | null
  dataEmissao: string | null
  arquivoUrl: string | null
  arquivoNome: string | null
  arquivoMimeType: string | null
}
interface PessoaV2 { id: number; nome: string; documentos: DocV2[] }
interface AnaliseV2Resp { pessoas: PessoaV2[]; kpis: { pessoas: number; totalDocs: number; revisados: number; pendentesRevisao: number }; readiness: { ready: boolean } }

interface Props {
  processoId: number
  onConcluido?: () => void
  readOnly?: boolean
}

type Aba = "documentos" | "divergencias" | "sugeridas" | "log"
type Via = "administrativa" | "judicial"

const DECISOES: Array<[string, string]> = [
  ["pendente", "Pendente"],
  ["aceita", "Aceitar variação"],
  ["ressalva", "Marcar ressalva"],
  ["apoio_solicitado", "Solicitar apoio"],
  ["retificacao", "Enviar para retificação"],
  ["ignorada", "Ignorar"],
]
const SEV_LABEL: Record<string, string> = { baixa: "Leve", media: "Média", critica: "Alta" }
const SEV_STYLE: Record<string, string> = {
  baixa: "bg-[var(--accent-primary)]/12 text-[var(--accent-text)]",
  media: "bg-[var(--accent-primary)]/12 text-[var(--accent-text)]",
  critica: "bg-[var(--surface-secondary)] text-red-700",
}
const SEV_DOT: Record<string, string> = { baixa: "bg-amber-600", media: "bg-[var(--accent-primary)]", critica: "bg-[var(--surface-secondary)]" }

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("authToken")}` })
const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() })
const ini = (nome: string) => {
  const p = nome.trim().split(/\s+/)
  return ((p[0]?.[0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase()
}
const fmtDia = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—")
const fmtDiaHora = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR") : "—")

export function ProcessoAnalise({ processoId, onConcluido, readOnly = false }: Props) {
  const [running, setRunning] = useState(false)
  const [concluding, setConcluding] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<string | null>(null)
  const [drawerDiv, setDrawerDiv] = useState<Divergencia | null>(null)
  const [aba, setAba] = useState<Aba>("documentos")
  const [docSelecionado, setDocSelecionado] = useState<number | null>(null)
  const [via, setVia] = useState<Via>("administrativa")
  const [busca, setBusca] = useState("")
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "com" | "sem">("todos")
  const [filtroPessoa, setFiltroPessoa] = useState("todas")
  const [filtroTipo, setFiltroTipo] = useState("todos")

  const consulta = useApi<{ analise?: Analise | null }>(`/api/processos/${processoId}/analise`)
  const analise = consulta.dados?.analise ?? null
  const consultaV2 = useApi<AnaliseV2Resp>(`/api/processos/${processoId}/analise-v2`)
  const pessoasV2Raw = consultaV2.dados?.pessoas
  const pessoasV2 = useMemo(() => pessoasV2Raw ?? [], [pessoasV2Raw])
  const loading = consulta.carregando

  const setAnalise = (proxima: Analise | null | ((anterior: Analise | null) => Analise | null)) => {
    const valor = typeof proxima === "function" ? (proxima as (a: Analise | null) => Analise | null)(analise) : proxima
    void consulta.recarregar({ analise: valor })
  }

  const rodar = async () => {
    setRunning(true); setErro(null); setResultado(null)
    try {
      // "Analisar automaticamente" roda o motor v2 (comparação com dados estruturados
      // por documento); ele grava nas MESMAS tabelas que esta tela lê pelo v1.
      const res = await fetch(`/api/processos/${processoId}/analise-v2`, { method: "POST", headers: authHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erro ao rodar análise")
      setAnalise(data.analise)
      await Promise.all([consultaV2.recarregar(), consulta.recarregar()])
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
        method: "PATCH", headers: jsonHeaders(),
        body: JSON.stringify({ decisao, ...(notas !== undefined ? { notas } : {}) }),
      })
      const data = await res.json()
      if (res.ok && data.analise) setAnalise(data.analise)
    } catch {
      consulta.recarregar()
    }
  }

  /**
   * Concluir grava a decisão jurídica (rota canônica, inalterada) e, se saiu "com
   * retificação", ABRE os pedidos pela mesma porta que a Retificação de Registros usa
   * (`abrirPacoteDeRetificacao`) — nunca cria RetificacaoPacote por conta própria.
   * A via escolhida aqui só decide o AGRUPAMENTO: judicial junta tudo num pedido só
   * (um processo cobre todos os documentos); administrativa abre um pedido POR
   * DOCUMENTO (execução individual, junto ao órgão de cada um).
   */
  const concluir = async () => {
    if (readOnly) return
    setConcluding(true); setErro(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/analise/concluir`, { method: "POST", headers: authHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erro ao concluir")

      if (data.decisao === "com_retificacao") {
        const paraRetificar: Divergencia[] = (data.analise?.divergencias ?? analise?.divergencias ?? [])
          .filter((d: Divergencia) => d.status === "retificacao")

        const grupos: number[][] = via === "judicial"
          ? [paraRetificar.map((d) => d.id)]
          : Object.values(
              paraRetificar.reduce((acc: Record<string, number[]>, d) => {
                const chave = String(d.documentoId ?? d.id)
                ;(acc[chave] ||= []).push(d.id)
                return acc
              }, {}),
            )

        for (const divergenciaIds of grupos) {
          if (!divergenciaIds.length) continue
          const r = await fetch(`/api/processos/${processoId}/retificacoes`, {
            method: "POST", headers: jsonHeaders(),
            body: JSON.stringify({ tipo: via, divergenciaIds }),
          })
          if (!r.ok) {
            const j = await r.json().catch(() => ({}))
            // Não bloqueia a conclusão (que já valeu) — só avisa: quem abre os
            // pedidos manualmente na tela de Retificação continua podendo.
            setErro((prev) => prev ?? (j.mensagem || "Análise concluída, mas houve erro ao abrir algum pedido de retificação. Abra manualmente em Retificação de Registros."))
          }
        }
      }

      const destino = data.proximaFase === "RETIFICACAO_REGISTROS" ? "Retificação de registros" : "Tradução juramentada"
      setResultado(`Análise concluída (${data.decisao === "com_retificacao" ? "com" : "sem"} retificação). Processo movido para ${destino}.`)
      onConcluido?.()
      consulta.recarregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao concluir")
    } finally {
      setConcluding(false)
    }
  }

  const divsRaw = analise?.divergencias
  const divs = useMemo(() => divsRaw ?? [], [divsRaw])
  const pend = divs.filter((d) => d.status === "pendente" || d.status === "apoio_solicitado").length
  const crit = divs.filter((d) => d.severidade === "critica" && (d.status === "pendente" || d.status === "retificacao")).length
  const sugeridas = divs.filter((d) => d.status === "retificacao")
  const podeConcluir = !!analise && pend === 0 && analise.status !== "concluida"

  const todosDocs = useMemo(
    () => pessoasV2.flatMap((p) => p.documentos.map((d) => ({ ...d, pessoaNome: p.nome }))),
    [pessoasV2],
  )
  const semDivergencia = todosDocs.filter((d) => !divs.some((v) => v.documentoId === d.id)).length

  const pessoasUnicas = useMemo(() => [...new Set(todosDocs.map((d) => d.pessoaNome))].sort(), [todosDocs])
  const tiposUnicos = useMemo(() => [...new Set(todosDocs.map((d) => d.tipo))].sort(), [todosDocs])

  const docsFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return todosDocs.filter((d) => {
      const n = divs.filter((v) => v.documentoId === d.id).length
      if (filtroStatus === "com" && n === 0) return false
      if (filtroStatus === "sem" && n > 0) return false
      if (filtroPessoa !== "todas" && d.pessoaNome !== filtroPessoa) return false
      if (filtroTipo !== "todos" && d.tipo !== filtroTipo) return false
      if (termo && !`${d.titulo} ${d.pessoaNome} ${d.tipo}`.toLowerCase().includes(termo)) return false
      return true
    })
  }, [todosDocs, divs, busca, filtroStatus, filtroPessoa, filtroTipo])

  const exportarCsv = () => {
    const linhas = [
      ["Documento", "Pessoa", "Tipo", "Data de emissão", "Divergências"],
      ...docsFiltrados.map((d) => [
        d.titulo, d.pessoaNome, d.tipo, fmtDia(d.dataEmissao),
        String(divs.filter((v) => v.documentoId === d.id).length),
      ]),
    ]
    const csv = linhas.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\n")
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = `analise-documental-processo-${processoId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const resumoPorPessoa = useMemo(() => {
    const mapa = new Map<string, { pessoa: string; documentos: number; divergencias: number; comRetificacao: number }>()
    for (const p of pessoasV2) mapa.set(p.nome, { pessoa: p.nome, documentos: p.documentos.length, divergencias: 0, comRetificacao: 0 })
    for (const d of divs) {
      const linha = mapa.get(d.pessoaNome) ?? { pessoa: d.pessoaNome, documentos: 0, divergencias: 0, comRetificacao: 0 }
      linha.divergencias += 1
      if (d.status === "retificacao") linha.comRetificacao += 1
      mapa.set(d.pessoaNome, linha)
    }
    return [...mapa.values()]
  }, [pessoasV2, divs])

  const log = useMemo(() => {
    const linhas: Array<{ quando: string | null; texto: string; documentoId: number | null }> = []
    if (analise?.startedAt) linhas.push({ quando: analise.startedAt, texto: "Análise iniciada.", documentoId: null })
    for (const d of divs) {
      if (d.decididoEm) {
        const label = DECISOES.find(([v]) => v === d.status)?.[1] ?? d.status
        linhas.push({ quando: d.decididoEm, texto: `${d.campoLabel} de ${d.pessoaNome} (${d.documentoTitulo}) — ${label}.`, documentoId: d.documentoId })
      }
    }
    if (analise?.completedAt) {
      linhas.push({ quando: analise.completedAt, texto: `Análise concluída ${analise.decisaoJuridica === "com_retificacao" ? "com retificação" : "sem retificação"}.`, documentoId: null })
    }
    return linhas.sort((a, b) => new Date(a.quando ?? 0).getTime() - new Date(b.quando ?? 0).getTime())
  }, [analise, divs])

  const docAtivo = todosDocs.find((d) => d.id === docSelecionado) ?? null
  const divsDoDocAtivo = docAtivo ? divs.filter((d) => d.documentoId === docAtivo.id) : []

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-[var(--text-muted)]" /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--action-primary)]/15 text-[var(--action-primary)]">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white/95">Análise Documental</h2>
            <p className="text-sm text-[var(--text-secondary)]">Compare documentos, identifique divergências e defina as retificações necessárias.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {analise && <RelatorioDropdown />}
          {!readOnly && analise?.status !== "concluida" && (
            <button onClick={rodar} disabled={running} className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-[var(--action-primary-ink)] bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)] rounded-md inline-flex items-center gap-2 disabled:opacity-50">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Analisar automaticamente
            </button>
          )}
        </div>
      </div>

      {!analise ? (
        <div className="rounded-xl border border-dashed border-[var(--border-default)] p-8 text-center text-sm text-[var(--text-secondary)]">
          A análise ainda não foi rodada. Clique em <b>Analisar automaticamente</b> para comparar a árvore com os documentos e apontar as divergências.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <Stat label="Documentos analisados" value={`${analise.documentosAnalisados} de ${analise.totalDocumentos || todosDocs.length}`} />
            <Stat label="Divergências identificadas" value={divs.length} danger={divs.length > 0} />
            <Stat label="Retificações sugeridas" value={sugeridas.length} />
            <Stat label="Sem divergências" value={semDivergencia} />
            <StatSituacao status={analise.status} completedAt={analise.completedAt} />
          </div>

          <div className="flex items-center gap-1 border-b border-[var(--border-default)]">
            {([
              ["documentos", `Documentos (${todosDocs.length || analise.totalDocumentos})`],
              ["divergencias", `Divergências (${divs.length})`],
              ["sugeridas", `Retificações sugeridas (${sugeridas.length})`],
              ["log", "Log da análise"],
            ] as Array<[Aba, string]>).map(([k, label]) => (
              <button key={k} onClick={() => setAba(k)}
                className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${aba === k ? "border-[var(--action-primary)] text-white/95" : "border-transparent text-[var(--text-secondary)] hover:text-white/80"}`}>
                {label}
              </button>
            ))}
          </div>

          {erro && <div className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-sm text-red-700">{erro}</div>}
          {resultado && <div className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-sm text-green-800 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />{resultado}</div>}

          {aba === "documentos" && todosDocs.length > 0 && (
            <BarraBuscaFiltro
              busca={busca} onBusca={setBusca}
              status={filtroStatus} onStatus={setFiltroStatus}
              pessoa={filtroPessoa} onPessoa={setFiltroPessoa} pessoas={pessoasUnicas}
              tipo={filtroTipo} onTipo={setFiltroTipo} tipos={tiposUnicos}
              onExportar={exportarCsv}
            />
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 items-start">
            <div className="rounded-xl border border-[var(--border-default)] overflow-hidden">
              {aba === "documentos" && (
                todosDocs.length === 0 ? (
                  <Vazio texto="Nenhum documento elegível para análise nesta linha reta." />
                ) : docsFiltrados.length === 0 ? (
                  <Vazio texto="Nenhum documento encontrado para esse filtro." />
                ) : (
                  <TabelaDocumentos docs={docsFiltrados} divs={divs} selecionado={docSelecionado} onSelecionar={setDocSelecionado} onAbrir={(u) => window.open(u, "_blank")} />
                )
              )}

              {aba === "divergencias" && (
                divs.length === 0
                  ? <Vazio texto="Nenhuma divergência encontrada — o processo pode seguir sem retificação." />
                  : <TabelaDivergencias divs={divs} onDecidir={decidir} onVerDetalhes={setDrawerDiv} readOnly={readOnly || analise.status === "concluida"} />
              )}

              {aba === "sugeridas" && (
                sugeridas.length === 0
                  ? <Vazio texto="Nenhuma retificação sugerida até agora." />
                  : <ListaSugeridas divs={sugeridas} onDecidir={decidir} readOnly={readOnly || analise.status === "concluida"} />
              )}

              {aba === "log" && (
                log.length === 0
                  ? <Vazio texto="Sem eventos registrados ainda." />
                  : <ul className="divide-y divide-white/10">
                      {log.map((l, i) => (
                        <li key={i} className="px-4 py-2.5 text-xs text-white/80 flex items-baseline gap-3">
                          <span className="text-[var(--text-muted)] whitespace-nowrap">{fmtDiaHora(l.quando)}</span>
                          <span>{l.texto}</span>
                        </li>
                      ))}
                    </ul>
              )}
            </div>

            <PainelDocumento
              doc={docAtivo}
              divergencias={divsDoDocAtivo}
              historico={docAtivo ? log.filter((l) => l.documentoId === docAtivo.id) : []}
              onVerDetalhes={setDrawerDiv}
            />
          </div>

          {analise.status !== "concluida" && !readOnly && (
            <div className="rounded-xl border border-[var(--border-default)] p-4 space-y-3">
              <div>
                <div className="text-sm font-semibold text-white/95">Conclusão da análise</div>
                <p className="text-xs text-white/68 mt-0.5">
                  {pend > 0
                    ? <span className="inline-flex items-center gap-1.5 text-[var(--accent-text)]"><AlertTriangle className="w-4 h-4" />Faltam {pend} decisão(ões) antes de concluir.</span>
                    : sugeridas.length > 0
                      ? "Foram identificadas divergências que exigem retificação. Escolha a via que será usada nos pedidos de retificação."
                      : "Nenhuma divergência exige retificação. O processo seguirá direto para a próxima fase."}
                </p>
              </div>

              {sugeridas.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <OpcaoVia
                    ativo={via === "administrativa"} onClick={() => setVia("administrativa")}
                    icone={<Landmark className="w-4 h-4" />} titulo="Via Administrativa"
                    descricao="Um pedido por documento, cada um junto ao órgão competente."
                  />
                  <OpcaoVia
                    ativo={via === "judicial"} onClick={() => setVia("judicial")}
                    icone={<Scale className="w-4 h-4" />} titulo="Via Judicial"
                    descricao="Um único pedido, cobrindo todos os documentos com retificação."
                  />
                </div>
              )}

              <div className="flex justify-end">
                <button onClick={concluir} disabled={!podeConcluir || concluding} className="px-4 py-2 text-sm font-semibold text-[var(--text-primary)] bg-[var(--app-background)] hover:bg-[var(--surface-secondary)] rounded-md inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                  {concluding ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Salvar definição e concluir análise
                </button>
              </div>
            </div>
          )}

          {analise.status === "concluida" && (
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4 text-sm text-green-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />Análise concluída {analise.decisaoJuridica === "com_retificacao" ? "com retificação" : "sem retificação"}.
            </div>
          )}

          <ResumoPorPessoa linhas={resumoPorPessoa} />
        </>
      )}

      {drawerDiv && (
        <DivergenciaDrawer
          div={drawerDiv}
          readOnly={readOnly || analise?.status === "concluida"}
          onClose={() => setDrawerDiv(null)}
          onSalvar={async (decisao, notas) => { await decidir(drawerDiv.id, decisao, notas); setDrawerDiv(null) }}
        />
      )}
    </div>
  )
}

function Stat({ label, value, danger }: { label: string; value: number | string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-2">
      <div className={`text-xl font-bold ${danger ? "text-red-700" : "text-white/95"}`}>{value}</div>
      <div className="text-[11px] text-[var(--text-secondary)]">{label}</div>
    </div>
  )
}

function StatSituacao({ status, completedAt }: { status: string; completedAt?: string | null }) {
  const concluida = status === "concluida"
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-2 col-span-2 sm:col-span-1">
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${concluida ? "bg-[var(--surface-secondary)] text-green-800" : "bg-[var(--surface-tertiary)] text-white/80"}`}>
        {concluida ? "Concluída" : "Em andamento"}
      </span>
      {concluida && <div className="text-[11px] text-[var(--text-secondary)] mt-1">em {fmtDia(completedAt)}</div>}
    </div>
  )
}

function Vazio({ texto }: { texto: string }) {
  return <div className="p-8 text-center text-sm text-[var(--text-secondary)]">{texto}</div>
}

function BarraBuscaFiltro({ busca, onBusca, status, onStatus, pessoa, onPessoa, pessoas, tipo, onTipo, tipos, onExportar }: {
  busca: string; onBusca: (v: string) => void
  status: "todos" | "com" | "sem"; onStatus: (v: "todos" | "com" | "sem") => void
  pessoa: string; onPessoa: (v: string) => void; pessoas: string[]
  tipo: string; onTipo: (v: string) => void; tipos: string[]
  onExportar: () => void
}) {
  const sel = "text-xs border border-[var(--border-default)] rounded-md px-2 py-2 bg-[var(--surface-popover)] text-white/80 focus:outline-none"
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
        <input value={busca} onChange={(e) => onBusca(e.target.value)} placeholder="Buscar documento, pessoa, tipo..."
          className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-popover)] pl-8 pr-3 py-2 text-xs text-white/90 placeholder-[var(--text-muted)] focus:outline-none" />
      </div>
      <select value={status} onChange={(e) => onStatus(e.target.value as "todos" | "com" | "sem")} className={sel}>
        <option value="todos">Todos os status</option>
        <option value="com">Com divergências</option>
        <option value="sem">Sem divergências</option>
      </select>
      <select value={pessoa} onChange={(e) => onPessoa(e.target.value)} className={sel}>
        <option value="todas">Todas as pessoas</option>
        {pessoas.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <select value={tipo} onChange={(e) => onTipo(e.target.value)} className={sel}>
        <option value="todos">Todos os tipos</option>
        {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <button onClick={onExportar} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-2 text-xs font-semibold text-white/80 hover:bg-[var(--surface-hover)]">
        <Download className="w-3.5 h-3.5" /> Exportar
      </button>
    </div>
  )
}

function RelatorioDropdown() {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false) }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setAberto((v) => !v)} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-2 text-sm font-semibold text-white/80 hover:bg-[var(--surface-hover)]">
        <FileText className="w-4 h-4" /> Relatório da análise <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {aberto && (
        <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-[var(--border-default)] bg-[var(--surface-popover)] shadow-[var(--elev-2)] p-1">
          {["Resumo em PDF", "Planilha de divergências", "Linha do tempo"].map((op) => (
            <div key={op} title="Ainda não disponível — sem gerador de relatório cadastrado."
              className="px-3 py-2 text-xs text-[var(--text-muted)] rounded cursor-not-allowed">{op}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function TabelaDocumentos({ docs, divs, selecionado, onSelecionar, onAbrir }: {
  docs: Array<DocV2 & { pessoaNome: string }>; divs: Divergencia[]
  selecionado: number | null; onSelecionar: (id: number) => void; onAbrir: (url: string) => void
}) {
  const [menuAberto, setMenuAberto] = useState<number | null>(null)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] bg-[var(--surface-secondary)]">
            {["Documento", "Pessoa", "Tipo", "Data", "Status da análise", "Divergências"].map((h) => <th key={h} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{h}</th>)}
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {docs.map((d) => {
            const n = divs.filter((v) => v.documentoId === d.id).length
            return (
              <tr key={d.id} onClick={() => onSelecionar(d.id)}
                className={`cursor-pointer hover:bg-[var(--surface-secondary)] ${selecionado === d.id ? "bg-[var(--surface-secondary)]" : ""}`}>
                <td className="px-3 py-2.5 flex items-center gap-2 text-white/95 font-medium"><FileText className="w-4 h-4 text-[var(--text-muted)]" />{d.titulo}</td>
                <td className="px-3 py-2.5 text-white/80">{d.pessoaNome}</td>
                <td className="px-3 py-2.5 text-white/68">{d.tipo}</td>
                <td className="px-3 py-2.5 text-white/68 whitespace-nowrap">{fmtDia(d.dataEmissao)}</td>
                <td className="px-3 py-2.5">
                  {n > 0
                    ? <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--surface-secondary)] text-red-700">Com divergências</span>
                    : <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--surface-secondary)] text-green-800">Sem divergências</span>}
                </td>
                <td className="px-3 py-2.5 text-white/95">{n}</td>
                <td className="px-3 py-2.5 text-right relative" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => onSelecionar(d.id)} className="text-[var(--text-muted)] hover:text-white/80 p-1" title="Ver detalhes"><Eye className="w-4 h-4" /></button>
                  <button onClick={() => setMenuAberto((v) => (v === d.id ? null : d.id))} className="text-[var(--text-muted)] hover:text-white/80 p-1" title="Mais ações"><MoreVertical className="w-4 h-4" /></button>
                  {menuAberto === d.id && (
                    <div className="absolute right-3 top-full z-10 w-44 rounded-md border border-[var(--border-default)] bg-[var(--surface-popover)] shadow-[var(--elev-2)] p-1 text-left">
                      <button onClick={() => { onSelecionar(d.id); setMenuAberto(null) }} className="w-full text-left px-3 py-2 text-xs text-white/80 rounded hover:bg-[var(--surface-hover)]">Ver detalhes</button>
                      <button disabled={!d.arquivoUrl} onClick={() => { if (d.arquivoUrl) onAbrir(d.arquivoUrl); setMenuAberto(null) }}
                        title={d.arquivoUrl ? undefined : "Sem arquivo anexado a este documento"}
                        className="w-full text-left px-3 py-2 text-xs text-white/80 rounded hover:bg-[var(--surface-hover)] disabled:text-[var(--text-muted)] disabled:cursor-not-allowed">Abrir documento</button>
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TabelaDivergencias({ divs, onDecidir, onVerDetalhes, readOnly }: {
  divs: Divergencia[]; onDecidir: (id: number, decisao: string) => void
  onVerDetalhes: (d: Divergencia) => void; readOnly: boolean
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] bg-[var(--surface-secondary)]">
            {["Pessoa", "Documento", "Campo", "Valor na árvore", "Valor no documento", "Gravidade", "Sugestão", "Decisão"].map((h) => (
              <th key={h} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
            ))}
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {divs.map((d) => (
            <tr key={d.id} className="hover:bg-[var(--surface-secondary)] align-top">
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-[var(--surface-tertiary)] text-white/68 text-[11px] font-bold flex items-center justify-center flex-shrink-0">{ini(d.pessoaNome)}</span>
                  <div className="min-w-0"><div className="font-semibold text-white/95">{d.pessoaNome}</div><div className="text-[11px] text-[var(--text-secondary)]">{d.geracao != null ? `Linhagem ${d.geracao}` : "—"} · {d.linhaReta ? "Linha reta" : "Apoio"}</div></div>
                </div>
              </td>
              <td className="px-3 py-2.5"><div className="font-medium text-white/95">{d.documentoTitulo}</div></td>
              <td className="px-3 py-2.5 text-white/80 whitespace-nowrap">{d.campoLabel}</td>
              <td className="px-3 py-2.5 text-white/95">{d.valorArvore || "—"}</td>
              <td className="px-3 py-2.5 text-white/95">{d.valorDocumento || "—"}</td>
              <td className="px-3 py-2.5"><span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${SEV_STYLE[d.severidade] || "bg-[var(--surface-tertiary)] text-white/80"}`}><span className={`w-1.5 h-1.5 rounded-full ${SEV_DOT[d.severidade] || "bg-[var(--surface-secondary)]"}`} />{SEV_LABEL[d.severidade] || d.severidade}</span></td>
              <td className="px-3 py-2.5 text-xs text-white/68 max-w-[200px]">{d.sugestaoIA || "—"}</td>
              <td className="px-3 py-2.5">
                <select value={d.status} disabled={readOnly} onChange={(e) => onDecidir(d.id, e.target.value)} className={`text-xs border rounded-md px-2 py-1.5 bg-[var(--surface-popover)] focus:outline-none disabled:opacity-50 ${d.status === "retificacao" ? "border-[var(--border-default)] text-red-700" : d.status === "aceita" ? "border-[var(--border-default)] text-green-800" : d.status === "pendente" ? "border-[var(--border-default)] text-white/68" : "border-[var(--accent-primary)]/30 text-[var(--accent-text)]"}`}>
                  {DECISOES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </td>
              <td className="px-3 py-2.5 text-right">
                <button onClick={() => onVerDetalhes(d)} className="text-[var(--text-muted)] hover:text-white/80 p-1" title="Ver detalhes"><ArrowRight className="w-4 h-4" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ListaSugeridas({ divs, onDecidir, readOnly }: { divs: Divergencia[]; onDecidir: (id: number, decisao: string) => void; readOnly: boolean }) {
  return (
    <ul className="divide-y divide-white/10">
      {divs.map((d) => (
        <li key={d.id} className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-white/95"><b>{d.campoLabel}</b> — {d.valorDocumento ?? "—"} → {d.valorArvore ?? "—"}</div>
            <div className="text-xs text-[var(--text-secondary)]">{d.pessoaNome} · {d.documentoTitulo} · <span className={SEV_STYLE[d.severidade]}>{SEV_LABEL[d.severidade] || d.severidade}</span></div>
            {d.sugestaoIA && <div className="text-xs text-white/68 mt-1">{d.sugestaoIA}</div>}
          </div>
          {!readOnly && (
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => onDecidir(d.id, "aceita")} className="px-2.5 py-1.5 text-xs rounded-md border border-[var(--border-default)] text-white/80 hover:bg-[var(--surface-hover)]">Não retificar</button>
              <button onClick={() => onDecidir(d.id, "retificacao")} className="px-2.5 py-1.5 text-xs rounded-md border border-[var(--border-default)] bg-[var(--surface-secondary)] text-red-700 font-semibold">Manter retificação</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

type AbaDoc = "visualizacao" | "dados" | "divergencias" | "historico"

function PainelDocumento({ doc, divergencias, historico, onVerDetalhes }: {
  doc: (DocV2 & { pessoaNome: string }) | null
  divergencias: Divergencia[]
  historico: Array<{ quando: string | null; texto: string }>
  onVerDetalhes: (d: Divergencia) => void
}) {
  const [abaDoc, setAbaDoc] = useState<AbaDoc>("visualizacao")

  if (!doc) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-default)] p-6 text-center text-xs text-[var(--text-muted)]">
        Selecione um documento na aba "Documentos" para ver os detalhes.
      </div>
    )
  }
  const dados = doc.structuredData && typeof doc.structuredData === "object" ? Object.entries(doc.structuredData as Record<string, unknown>) : []
  const ehImagem = doc.arquivoMimeType?.startsWith("image/")
  const ehPdf = doc.arquivoMimeType === "application/pdf"

  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-popover)] overflow-hidden">
      <div className="flex items-start justify-between gap-2 p-4 pb-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white/95 truncate">{doc.titulo}</div>
            <div className="text-[11px] text-[var(--text-secondary)]">{doc.pessoaNome}</div>
          </div>
        </div>
        {doc.arquivoUrl && (
          <a href={doc.arquivoUrl} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent-text)] hover:underline flex-shrink-0">
            <ExternalLink className="w-3.5 h-3.5" /> Abrir documento
          </a>
        )}
      </div>

      <div className="flex items-center gap-1 px-4 mt-3 border-b border-[var(--border-default)] overflow-x-auto">
        {([
          ["visualizacao", "Visualização"], ["dados", "Dados extraídos"],
          ["divergencias", `Divergências (${divergencias.length})`], ["historico", "Histórico"],
        ] as Array<[AbaDoc, string]>).map(([k, l]) => (
          <button key={k} onClick={() => setAbaDoc(k)}
            className={`whitespace-nowrap px-2 py-2 text-[11px] font-semibold border-b-2 -mb-px ${abaDoc === k ? "border-[var(--action-primary)] text-white/95" : "border-transparent text-[var(--text-secondary)] hover:text-white/80"}`}>
            {l}
          </button>
        ))}
      </div>

      <div className="p-4 space-y-3">
        {abaDoc === "visualizacao" && (
          ehImagem && doc.arquivoUrl ? (
            <img src={doc.arquivoUrl} alt={doc.titulo} className="w-full rounded-lg border border-[var(--border-default)]" />
          ) : ehPdf && doc.arquivoUrl ? (
            <iframe src={doc.arquivoUrl} className="w-full h-[360px] rounded-lg border border-[var(--border-default)]" title={doc.titulo} />
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--border-default)] p-8 text-center text-xs text-[var(--text-muted)]">
              Sem arquivo anexado a este documento.
            </div>
          )
        )}

        {abaDoc === "dados" && (
          dados.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">Nenhum dado estruturado extraído ainda.</p>
          ) : (
            <div className="space-y-1">
              {dados.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 border-b border-white/10 pb-1 text-xs">
                  <span className="text-[var(--text-secondary)]">{k}</span>
                  <span className="text-white/90 text-right">{v == null || v === "" ? "—" : String(v)}</span>
                </div>
              ))}
            </div>
          )
        )}

        {abaDoc === "divergencias" && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-xs font-semibold text-[var(--text-secondary)]">Divergências identificadas ({divergencias.length})</div>
              <button
                disabled={divergencias.length === 0}
                onClick={() => divergencias[0] && onVerDetalhes(divergencias[0])}
                title={divergencias.length === 0 ? "Nenhuma divergência para vincular neste documento" : undefined}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent-text)] hover:underline disabled:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:no-underline">
                <Link2 className="w-3.5 h-3.5" /> Vincular/Editar
              </button>
            </div>
            {divergencias.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">Nenhuma.</p>
            ) : (
              <ul className="space-y-1.5">
                {divergencias.map((d, i) => (
                  <li key={d.id} className="rounded-lg border border-[var(--border-default)] px-2.5 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white/90">{i + 1}. {d.campoLabel}</div>
                        <div className="text-[11px] text-[var(--text-secondary)]">No documento: <span className="text-white/80">{d.valorDocumento || "—"}</span></div>
                        <div className="text-[11px] text-[var(--text-secondary)]">Esperado: <span className="text-white/80">{d.valorArvore || "—"}</span></div>
                      </div>
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 ${SEV_STYLE[d.severidade] || "bg-[var(--surface-tertiary)] text-white/80"}`}>{SEV_LABEL[d.severidade] || d.severidade}</span>
                    </div>
                    <button onClick={() => onVerDetalhes(d)} className="mt-1 text-[11px] text-[var(--accent-text)] hover:underline">Ver detalhes</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {abaDoc === "historico" && (
          historico.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">Sem eventos registrados para este documento.</p>
          ) : (
            <ul className="space-y-2">
              {historico.map((h, i) => (
                <li key={i} className="text-xs text-white/80">
                  <span className="text-[var(--text-muted)]">{fmtDiaHora(h.quando)}</span> — {h.texto}
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  )
}

function OpcaoVia({ ativo, onClick, icone, titulo, descricao }: {
  ativo: boolean; onClick: () => void; icone: React.ReactNode; titulo: string; descricao: string
}) {
  return (
    <button onClick={onClick} className={`text-left rounded-lg border p-3 transition-colors ${ativo ? "border-[var(--action-primary)] bg-[var(--surface-secondary)]" : "border-[var(--border-default)] hover:bg-[var(--surface-hover)]"}`}>
      <div className="flex items-center gap-2 text-sm font-semibold text-white/95">
        <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${ativo ? "border-[var(--action-primary)]" : "border-[var(--border-default)]"}`}>
          {ativo && <span className="w-2 h-2 rounded-full bg-[var(--action-primary)]" />}
        </span>
        {icone} {titulo}
      </div>
      <p className="text-xs text-[var(--text-secondary)] mt-1 ml-6">{descricao}</p>
    </button>
  )
}

function ResumoPorPessoa({ linhas }: { linhas: Array<{ pessoa: string; documentos: number; divergencias: number; comRetificacao: number }> }) {
  if (linhas.length === 0) return null
  return (
    <div className="rounded-xl border border-[var(--border-default)] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[var(--border-default)] text-sm font-semibold text-white/95">Resumo por pessoa</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] bg-[var(--surface-secondary)]">
              {["Pessoa", "Documentos", "Divergências", "Situação"].map((h) => <th key={h} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {linhas.map((l) => (
              <tr key={l.pessoa}>
                <td className="px-3 py-2.5 text-white/95 font-medium">{l.pessoa}</td>
                <td className="px-3 py-2.5 text-white/80">{l.documentos}</td>
                <td className="px-3 py-2.5 text-white/80">{l.divergencias}</td>
                <td className="px-3 py-2.5">
                  {l.divergencias === 0
                    ? <span className="text-xs text-green-800">Sem divergências</span>
                    : l.comRetificacao > 0
                      ? <span className="text-xs text-red-700">Com retificações</span>
                      : <span className="text-xs text-[var(--text-secondary)]">Em decisão</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
      <div className="absolute inset-0 bg-[var(--overlay-modal)]" onClick={onClose} />
      <div className="relative w-full max-w-md bg-[var(--surface-popover)] h-full shadow-[var(--elev-3)] overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-default)]">
          <div>
            <div className="text-sm font-bold text-white/95">Detalhe da divergência</div>
            <div className="text-xs text-[var(--text-secondary)]">{div.documentoTitulo}</div>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-white/80 p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4 flex-1">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-[var(--surface-tertiary)] text-white/68 text-xs font-bold flex items-center justify-center">{ini(div.pessoaNome)}</span>
            <div>
              <div className="font-semibold text-white/95 text-sm">{div.pessoaNome}</div>
              <div className="text-[11px] text-[var(--text-secondary)]">{div.geracao != null ? `Linhagem ${div.geracao}` : "—"} · {div.linhaReta ? "Linha reta" : "Apoio"}</div>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border-default)] divide-y divide-white/10 text-sm">
            <div className="flex justify-between px-3 py-2"><span className="text-[var(--text-secondary)]">Campo</span><span className="font-medium text-white/95">{div.campoLabel}</span></div>
            <div className="flex justify-between px-3 py-2"><span className="text-[var(--text-secondary)]">Valor na árvore</span><span className="font-medium text-white/95">{div.valorArvore || "—"}</span></div>
            <div className="flex justify-between px-3 py-2"><span className="text-[var(--text-secondary)]">Valor no documento</span><span className="font-medium text-white/95">{div.valorDocumento || "—"}</span></div>
            <div className="flex justify-between px-3 py-2 items-center"><span className="text-[var(--text-secondary)]">Gravidade</span>
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${SEV_STYLE[div.severidade] || "bg-[var(--surface-tertiary)] text-white/80"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${SEV_DOT[div.severidade] || "bg-[var(--surface-secondary)]"}`} />{SEV_LABEL[div.severidade] || div.severidade}
              </span>
            </div>
          </div>

          {(div.sugestaoIA || div.motivoIA || div.impacto) && (
            <div className="rounded-lg bg-[var(--surface-secondary)] border border-[var(--border-default)] p-3 text-sm">
              <div className="text-xs font-semibold text-[var(--text-secondary)] mb-1">Sugestão</div>
              {div.sugestaoIA && <div className="text-white/80">{div.sugestaoIA}</div>}
              {div.motivoIA && <div className="text-white/68 text-xs mt-1">{div.motivoIA}</div>}
              {div.impacto && <div className="text-white/68 text-xs mt-1">Impacto: {div.impacto}</div>}
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-white/80">Decisão</label>
            <select value={decisao} onChange={(e) => setDecisao(e.target.value)} disabled={readOnly}
              className="mt-1 w-full text-sm border border-[var(--border-default)] rounded-md px-2 py-2 bg-[var(--surface-popover)] disabled:bg-[var(--surface-secondary)] disabled:text-[var(--text-secondary)]">
              {DECISOES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-white/80">Notas</label>
            <textarea value={notas} onChange={(e) => setNotas(e.target.value)} disabled={readOnly} rows={4}
              placeholder="Registre o motivo da decisão."
              className="mt-1 w-full text-sm border border-[var(--border-default)] rounded-md px-3 py-2 disabled:bg-[var(--surface-secondary)]" />
          </div>
        </div>

        {!readOnly && (
          <div className="bg-[var(--surface-popover)] border-t border-[var(--border-default)] px-5 py-3 flex justify-end gap-2">
            <button onClick={onClose} className="px-3 py-2 text-sm text-white/68 hover:bg-[var(--surface-secondary)] rounded-md">Cancelar</button>
            <button onClick={salvar} disabled={salvando} className="px-4 py-2 text-sm font-semibold text-[var(--action-primary-ink)] bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)] rounded-md inline-flex items-center gap-2 disabled:opacity-50">
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar decisão
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
