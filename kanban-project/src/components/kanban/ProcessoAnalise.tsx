// src/components/kanban/ProcessoAnalise.tsx
"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { useApi, invalidar } from "@/src/lib/dados"
import { uploadFiles } from "@/src/lib/storage"
import { compararPorEventoDeVida } from "@/src/lib/documentos/ordem-evento-vida"
import {
  Loader2, Sparkles, CheckCircle2, AlertTriangle, ArrowRight, Check, X,
  FileText, Scale, Landmark, Search, Download, Eye, MoreVertical, ChevronDown,
  ExternalLink, Link2, Paperclip, Upload, Copy, ClipboardCheck, ScanText,
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

interface LinhaRelatorio {
  pessoa: string
  documento: string
  campo: string
  campoLabel?: string
  valorNoDocumento: string
  valorCorreto: string
  severidade?: string
  sugestao?: string
  decisao?: string
}

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
const DATA_STATUS_LABEL: Record<string, string> = {
  not_filled: "Não preenchido", ai_extracted: "Extraído automaticamente (não revisado)",
  manual_filled: "Rascunho salvo", reviewed: "Revisado",
}
const DATA_STATUS_STYLE: Record<string, string> = {
  not_filled: "bg-[var(--surface-tertiary)] text-white/68",
  ai_extracted: "bg-[var(--accent-primary)]/12 text-[var(--accent-text)]",
  manual_filled: "bg-[var(--accent-primary)]/12 text-[var(--accent-text)]",
  reviewed: "bg-[var(--surface-secondary)] text-green-800",
}

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("authToken")}` })
const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() })
const ini = (nome: string) => {
  const p = nome.trim().split(/\s+/)
  return ((p[0]?.[0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase()
}
const fmtDia = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—")
const fmtDiaHora = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR") : "—")

export function ProcessoAnalise({ processoId, onConcluido, readOnly = false }: Props) {
  const [extraindo, setExtraindo] = useState(false)
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
  const [modalAnexar, setModalAnexar] = useState(false)
  const [modalImportar, setModalImportar] = useState(false)

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

  /**
   * Extração automática (OCR + leitura de campo) ANTES da comparação: lê o arquivo
   * de cada documento (camada de texto do PDF, grátis; OCR externo se configurado),
   * reconhece nome/data/filiação/avós pelo boilerplate padrão do Registro Civil e
   * grava em structuredData com dataStatus="ai_extracted" — nunca "reviewed"
   * sozinha, confirmação humana continua obrigatória antes de virar canônico.
   */
  const extrair = async () => {
    if (readOnly) return
    setExtraindo(true); setErro(null); setResultado(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/analise-v2/extrair`, { method: "POST", headers: authHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erro ao extrair dados dos documentos")
      const r = data.resumo as { total: number; extraidos: number; pulados: number; semTexto: number; semCampos: number }
      setResultado(
        `Extração automática: ${r.extraidos} documento(s) com dados extraídos` +
          (r.semTexto > 0 ? `, ${r.semTexto} sem texto legível (arquivo escaneado sem OCR configurado, ou precisa de revisão manual)` : "") +
          (r.semCampos > 0 ? `, ${r.semCampos} com texto lido mas sem campo reconhecido` : "") +
          (r.pulados > 0 ? `, ${r.pulados} já preenchido(s) (não sobrescrito)` : "") + ".",
      )
      await Promise.all([consultaV2.recarregar(), invalidar(`/api/processos/${processoId}/`)])
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao extrair dados dos documentos")
    } finally {
      setExtraindo(false)
    }
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
      // As abas Documentos e Geral leem /documentos e /estatisticas — telas
      // DIFERENTES do SWR desta aqui, com cache próprio (revalidateOnFocus:
      // false + dedupingInterval de 30s). Sem isto, rodar a análise aqui não
      // avisava ninguém: quem já tinha aberto Documentos/Geral continuava
      // vendo o dado antigo até o cache expirar sozinho.
      await Promise.all([consultaV2.recarregar(), consulta.recarregar(), invalidar(`/api/processos/${processoId}/`)])
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao rodar análise")
    } finally {
      setRunning(false)
    }
  }

  /**
   * Grava um relatório já pronto (feito por um humano comparando certidões, dentro
   * ou fora do sistema) nas MESMAS tabelas do motor automático. Não decide nada
   * sozinho: cada linha já chega com o valor errado, o valor correto e a gravidade.
   */
  const importarRelatorio = async (linhas: LinhaRelatorio[]) => {
    const res = await fetch(`/api/processos/${processoId}/analise/importar`, {
      method: "POST", headers: jsonHeaders(),
      body: JSON.stringify({ linhas }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.mensagem || data.error || "Erro ao importar o relatório.")
    setAnalise(data.analise)
    setResultado(`Relatório importado: ${data.linhasImportadas} divergência(s) registrada(s).`)
    await Promise.all([consulta.recarregar(), invalidar(`/api/processos/${processoId}/`)])
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
      // Decidir uma divergência muda se ela conta como "aberta" pro gate de
      // pronto-para-protocolo/apto — biblioteca e Geral precisam saber.
      void invalidar(`/api/processos/${processoId}/`)
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
      // A CONCLUSÃO é o evento que vira "pronto para protocolo"/"apto" nas
      // outras abas (analiseConcluida). Sem invalidar aqui, o processo já
      // tinha avançado de fase de verdade e a tela de Documentos/Geral podia
      // continuar mostrando o estado de antes por até 30s (dedupingInterval)
      // ou indefinidamente, já que a política do projeto não revalida no foco.
      await Promise.all([consulta.recarregar(), invalidar(`/api/processos/${processoId}/`)])
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

  // Nasce, casa, morre — nunca a ordem crua do id do documento (fonte única:
  // ordem-evento-vida.ts). Sem isto, Antonio aparecia "Casamento" antes de
  // "Nascimento" só porque o registro de casamento tinha id menor.
  const todosDocs = useMemo(
    () => pessoasV2.flatMap((p) =>
      [...p.documentos]
        .sort((a, b) => compararPorEventoDeVida(a.titulo, b.titulo))
        .map((d) => ({ ...d, pessoaNome: p.nome })),
    ),
    [pessoasV2],
  )
  // "Sem divergências" só vale pra quem PASSOU pela comparação (analysisStatus
  // "ready") — documento nunca analisado não tem "zero divergência", tem "zero
  // verificação". Sem isto, todo documento nascia "sem divergências" antes de
  // qualquer análise ter rodado.
  const semDivergencia = todosDocs.filter((d) => d.analysisStatus === "ready" && !divs.some((v) => v.documentoId === d.id)).length
  const naoAnalisados = todosDocs.filter((d) => d.analysisStatus !== "ready").length

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
        <div className="flex flex-wrap items-center justify-end gap-2 flex-shrink-0">
          {analise && <RelatorioDropdown />}
          {!readOnly && (
            <>
              <button onClick={() => setModalAnexar(true)} className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-white/80 border border-[var(--border-default)] bg-[var(--surface-popover)] hover:bg-[var(--surface-hover)] rounded-md inline-flex items-center gap-2">
                <Paperclip className="w-4 h-4" /> Anexar certidão
              </button>
              <button onClick={() => setModalImportar(true)} className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-white/80 border border-[var(--border-default)] bg-[var(--surface-popover)] hover:bg-[var(--surface-hover)] rounded-md inline-flex items-center gap-2">
                <Upload className="w-4 h-4" /> Importar relatório
              </button>
              <button
                onClick={extrair} disabled={extraindo}
                title="Lê os documentos anexados (camada de texto do PDF, ou OCR se configurado) e preenche os dados automaticamente — ainda precisa de revisão humana antes de virar base de comparação"
                className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-white/80 border border-[var(--border-default)] bg-[var(--surface-popover)] hover:bg-[var(--surface-hover)] rounded-md inline-flex items-center gap-2 disabled:opacity-50"
              >
                {extraindo ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanText className="w-4 h-4" />} Extrair automaticamente
              </button>
            </>
          )}
          {!readOnly && analise?.status !== "concluida" && (
            <button onClick={rodar} disabled={running} className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-[var(--action-primary-ink)] bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)] rounded-md inline-flex items-center gap-2 disabled:opacity-50">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Analisar automaticamente
            </button>
          )}
        </div>
      </div>

      {erro && <div className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-sm text-red-700">{erro}</div>}
      {resultado && <div className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-sm text-green-800 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />{resultado}</div>}

      {!analise ? (
        <div className="rounded-xl border border-dashed border-[var(--border-default)] p-8 text-center text-sm text-[var(--text-secondary)]">
          A análise ainda não foi rodada. Clique em <b>Extrair automaticamente</b> pra ler os documentos e preencher os dados sozinho, depois em <b>Analisar automaticamente</b> para comparar; use <b>Anexar certidão</b> se ainda faltar certidão na aba Documentos, ou <b>Importar relatório</b> se a comparação já foi feita fora do sistema.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <Stat label="Documentos analisados" value={`${analise.documentosAnalisados} de ${analise.totalDocumentos || todosDocs.length}`} />
            <Stat label="Divergências identificadas" value={divs.length} danger={divs.length > 0} />
            <Stat label="Retificações sugeridas" value={sugeridas.length} />
            <Stat label="Sem divergências" value={semDivergencia} />
            <Stat label="Não analisados" value={naoAnalisados} danger={naoAnalisados > 0} />
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
              key={docAtivo?.id ?? "nenhum"}
              doc={docAtivo}
              divergencias={divsDoDocAtivo}
              historico={docAtivo ? log.filter((l) => l.documentoId === docAtivo.id) : []}
              processoId={processoId}
              readOnly={readOnly || analise.status === "concluida"}
              onVerDetalhes={setDrawerDiv}
              onSalvo={() => { void Promise.all([consultaV2.recarregar(), invalidar(`/api/processos/${processoId}/`)]) }}
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

      {modalAnexar && (
        <ModalAnexarCertidao
          pessoas={pessoasV2}
          onClose={() => setModalAnexar(false)}
          onSalvo={async () => { setModalAnexar(false); await consultaV2.recarregar() }}
          anexar={async (payload) => {
            const res = await fetch(`/api/processos/${processoId}/analise/documentos`, {
              method: "POST", headers: jsonHeaders(), body: JSON.stringify(payload),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.mensagem || data.error || "Erro ao anexar a certidão.")
          }}
        />
      )}

      {modalImportar && (
        <ModalImportarRelatorio
          onClose={() => setModalImportar(false)}
          onImportar={async (linhas) => { await importarRelatorio(linhas); setModalImportar(false) }}
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

const TIPOS_CERTIDAO: Array<[string, string]> = [
  ["CERTIDAO_NASCIMENTO", "Certidão de Nascimento"],
  ["CERTIDAO_NASCIMENTO_INTEIRO_TEOR", "Certidão de Nascimento (Inteiro Teor)"],
  ["CERTIDAO_CASAMENTO", "Certidão de Casamento"],
  ["CERTIDAO_CASAMENTO_INTEIRO_TEOR", "Certidão de Casamento (Inteiro Teor)"],
  ["CERTIDAO_OBITO", "Certidão de Óbito"],
  ["CERTIDAO_OBITO_INTEIRO_TEOR", "Certidão de Óbito (Inteiro Teor)"],
]

function ModalAnexarCertidao({ pessoas, onClose, onSalvo, anexar }: {
  pessoas: Array<{ id: number; nome: string }>
  onClose: () => void
  onSalvo: () => void
  anexar: (payload: { pessoaId: number; tipo: string; arquivoUrl: string; arquivoNome: string; arquivoMimeType: string }) => Promise<void>
}) {
  const [pessoaId, setPessoaId] = useState<number | "">("")
  const [tipo, setTipo] = useState("")
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [progresso, setProgresso] = useState(0)
  const [erro, setErro] = useState<string | null>(null)

  const salvar = async () => {
    if (!pessoaId || !tipo || !arquivo) { setErro("Escolha a pessoa, o tipo e o arquivo."); return }
    setEnviando(true); setErro(null)
    try {
      const [up] = await uploadFiles([arquivo], { prefix: "analise-documental", onProgress: (_f, p) => setProgresso(p) })
      await anexar({ pessoaId: Number(pessoaId), tipo, arquivoUrl: up.url, arquivoNome: up.name, arquivoMimeType: up.type })
      onSalvo()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao anexar a certidão.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--overlay-modal)] p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white/95">Anexar certidão</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-white/80 p-1"><X className="w-5 h-5" /></button>
        </div>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">O arquivo vira um documento da pessoa, disponível para comparação na Análise Documental.</p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Pessoa</label>
            <select value={pessoaId} onChange={(e) => setPessoaId(e.target.value ? Number(e.target.value) : "")}
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white">
              <option value="">Selecione…</option>
              {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Tipo de certidão</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white">
              <option value="">Selecione…</option>
              {TIPOS_CERTIDAO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Arquivo (PDF ou imagem)</label>
            <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp,application/pdf"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="w-full text-xs text-white/80 file:mr-2 file:rounded-md file:border-0 file:bg-[var(--surface-secondary)] file:px-2 file:py-1.5 file:text-xs file:text-white/80" />
            {enviando && (
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-[var(--surface-tertiary)] overflow-hidden">
                <div className="h-full bg-[var(--action-primary)] transition-all" style={{ width: `${progresso}%` }} />
              </div>
            )}
          </div>
        </div>

        {erro && <div className="mt-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2 text-xs text-red-700">{erro}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-[var(--border-default)] px-3 py-2 text-sm text-white/70 hover:bg-[var(--surface-hover)]">Cancelar</button>
          <button onClick={() => void salvar()} disabled={enviando}
            className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-white hover:bg-[var(--surface-hover)] disabled:opacity-40">
            {enviando ? "Enviando…" : "Anexar"}
          </button>
        </div>
      </div>
    </div>
  )
}

const MODELO_CSV = `pessoa;documento;campo;campoLabel;valorNoDocumento;valorCorreto;severidade;sugestao;decisao
Antonio Medina Olivares;Certidão de Casamento;dataNascimento;Data de nascimento;26/07/1910;25/06/1910;critica;Acta de Nacimiento espanhola prova 25/06/1910.;retificacao
`

const PROMPT_RELATORIO = `Vou te enviar certidões (nascimento, casamento, óbito) de uma mesma linhagem familiar, em imagem ou PDF. Leia cada uma com atenção e compare os dados entre elas — nome, data de nascimento, filiação (pai/mãe), naturalidade. Nunca invente nem complete o que não está escrito.

Quando um nome/data/filiação aparecer diferente entre documentos da mesma pessoa (ou entre um documento e os documentos dos descendentes que citam essa pessoa como pai/mãe/avô), aponte a divergência. Use como valor correto o documento mais próximo do fato: o registro de nascimento no país de origem, ou a averbação de retificação mais recente, tem mais autoridade que uma cópia ou tradução posterior.

Devolva a resposta SOMENTE como uma tabela, sem nenhum texto antes ou depois, separada por ponto e vírgula (;), com EXATAMENTE este cabeçalho e nesta ordem:

pessoa;documento;campo;campoLabel;valorNoDocumento;valorCorreto;severidade;sugestao;decisao

- pessoa: nome completo da pessoa, exatamente como está cadastrado na árvore do processo
- documento: título do documento com o erro (ex.: "Certidão de Nascimento", "Certidão de Casamento (IT)")
- campo: chave curta (ex.: dataNascimento, nomePai, nomeMae, sobrenome, localNascimento)
- campoLabel: nome do campo em português (ex.: "Data de nascimento")
- valorNoDocumento: o valor errado, como está escrito no documento
- valorCorreto: o valor correto, com base no documento de maior autoridade
- severidade: baixa, media ou critica
- sugestao: uma frase curta explicando a divergência e de onde veio a correção
- decisao: "retificacao" se precisa corrigir, "aceita" se é só variação aceitável (pode deixar em branco pra decidir depois na tela)`

function parseCsvRelatorio(texto: string): string[][] {
  const s = texto.replace(/^﻿/, "")
  const linhas: string[][] = []
  let campo = "", linha: string[] = [], dentroAspas = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (dentroAspas) {
      if (c === '"') { if (s[i + 1] === '"') { campo += '"'; i++ } else dentroAspas = false }
      else campo += c
    } else if (c === '"') dentroAspas = true
    else if (c === ";") { linha.push(campo); campo = "" }
    else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = "" }
    else if (c === "\r") { /* ignora */ }
    else campo += c
  }
  if (campo.length > 0 || linha.length > 0) { linha.push(campo); linhas.push(linha) }
  return linhas.filter((l) => l.some((c) => c.trim() !== ""))
}

function linhasDoCsv(texto: string): { linhas: LinhaRelatorio[]; erro: string | null } {
  const tabela = parseCsvRelatorio(texto)
  if (tabela.length < 2) return { linhas: [], erro: "O arquivo precisa ter o cabeçalho e ao menos uma linha de divergência." }
  const cabecalho = tabela[0].map((h) => h.trim().toLowerCase())
  const idx = (chave: string) => cabecalho.indexOf(chave)
  const obrigatorias = ["pessoa", "documento", "campo", "valornodocumento", "valorcorreto"]
  const faltando = obrigatorias.filter((c) => idx(c) === -1)
  if (faltando.length > 0) return { linhas: [], erro: `Cabeçalho sem as colunas: ${faltando.join(", ")}. Use o modelo.` }

  const linhas: LinhaRelatorio[] = tabela.slice(1).map((cols) => ({
    pessoa: (cols[idx("pessoa")] ?? "").trim(),
    documento: (cols[idx("documento")] ?? "").trim(),
    campo: (cols[idx("campo")] ?? "").trim(),
    campoLabel: idx("campolabel") >= 0 ? (cols[idx("campolabel")] ?? "").trim() : undefined,
    valorNoDocumento: (cols[idx("valornodocumento")] ?? "").trim(),
    valorCorreto: (cols[idx("valorcorreto")] ?? "").trim(),
    severidade: idx("severidade") >= 0 ? (cols[idx("severidade")] ?? "").trim().toLowerCase() : undefined,
    sugestao: idx("sugestao") >= 0 ? (cols[idx("sugestao")] ?? "").trim() : undefined,
    decisao: idx("decisao") >= 0 ? (cols[idx("decisao")] ?? "").trim().toLowerCase() : undefined,
  })).filter((l) => l.pessoa && l.campo)

  if (linhas.length === 0) return { linhas: [], erro: "Nenhuma linha válida encontrada (faltou pessoa ou campo)." }
  return { linhas, erro: null }
}

function ModalImportarRelatorio({ onClose, onImportar }: {
  onClose: () => void
  onImportar: (linhas: LinhaRelatorio[]) => Promise<void>
}) {
  const [copiado, setCopiado] = useState(false)
  const [linhas, setLinhas] = useState<LinhaRelatorio[]>([])
  const [erroArquivo, setErroArquivo] = useState<string | null>(null)
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null)
  const [importando, setImportando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const copiarPrompt = async () => {
    try { await navigator.clipboard.writeText(PROMPT_RELATORIO); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { /* silencioso */ }
  }

  const baixarModelo = () => {
    const blob = new Blob(["﻿" + MODELO_CSV], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = "modelo-relatorio-analise-documental.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  const onArquivo = async (file: File | null) => {
    setLinhas([]); setErroArquivo(null); setNomeArquivo(null)
    if (!file) return
    setNomeArquivo(file.name)
    const texto = await file.text()
    const r = linhasDoCsv(texto)
    if (r.erro) setErroArquivo(r.erro)
    else setLinhas(r.linhas)
  }

  const confirmar = async () => {
    setImportando(true); setErro(null)
    try { await onImportar(linhas) } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao importar.") } finally { setImportando(false) }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--overlay-modal)] p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white/95">Importar relatório de divergências</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-white/80 p-1"><X className="w-5 h-5" /></button>
        </div>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Compare as certidões fora do sistema (por exemplo, numa conversa com o Claude) e suba o resultado pronto — o sistema só formata e grava.
        </p>

        <div className="mt-4 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white/90">1. Copie este texto e cole numa conversa com o Claude, junto com as certidões</span>
            <button onClick={() => void copiarPrompt()} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent-text)] hover:underline">
              {copiado ? <ClipboardCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copiado ? "Copiado" : "Copiar"}
            </button>
          </div>
          <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-black/20 p-2 text-[11px] text-white/70">{PROMPT_RELATORIO}</pre>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
          <span className="text-xs font-semibold text-white/90">2. Se preferir montar na mão, baixe o modelo da planilha</span>
          <button onClick={baixarModelo} className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2.5 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-[var(--surface-hover)]">
            <Download className="w-3.5 h-3.5" /> Baixar modelo
          </button>
        </div>

        <div className="mt-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
          <span className="text-xs font-semibold text-white/90">3. Suba o relatório pronto (.csv)</span>
          <input type="file" accept=".csv,text/csv" onChange={(e) => void onArquivo(e.target.files?.[0] ?? null)}
            className="mt-2 w-full text-xs text-white/80 file:mr-2 file:rounded-md file:border-0 file:bg-[var(--surface-secondary)] file:px-2 file:py-1.5 file:text-xs file:text-white/80" />
          {nomeArquivo && !erroArquivo && (
            <p className="mt-2 text-[11px] text-white/68">{nomeArquivo} · {linhas.length} divergência(s) reconhecida(s)</p>
          )}
          {erroArquivo && <p className="mt-2 text-[11px] text-red-700">{erroArquivo}</p>}

          {linhas.length > 0 && (
            <div className="mt-2 max-h-52 overflow-auto rounded-md border border-[var(--border-default)]">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-[var(--surface-secondary)] text-[var(--text-secondary)]">
                    {["Pessoa", "Documento", "Campo", "No documento", "Correto", "Gravidade"].map((h) => (
                      <th key={h} className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {linhas.map((l, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5 text-white/90 whitespace-nowrap">{l.pessoa}</td>
                      <td className="px-2 py-1.5 text-white/80 whitespace-nowrap">{l.documento}</td>
                      <td className="px-2 py-1.5 text-white/68">{l.campoLabel || l.campo}</td>
                      <td className="px-2 py-1.5 text-white/68">{l.valorNoDocumento}</td>
                      <td className="px-2 py-1.5 text-white/68">{l.valorCorreto}</td>
                      <td className="px-2 py-1.5 text-white/68">{l.severidade || "media"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {erro && <div className="mt-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2 text-xs text-red-700">{erro}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-[var(--border-default)] px-3 py-2 text-sm text-white/70 hover:bg-[var(--surface-hover)]">Cancelar</button>
          <button onClick={() => void confirmar()} disabled={importando || linhas.length === 0}
            className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-white hover:bg-[var(--surface-hover)] disabled:opacity-40">
            {importando ? "Importando…" : `Importar ${linhas.length || ""} divergência(s)`}
          </button>
        </div>
      </div>
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
          {docs.map((d, i) => {
            const n = divs.filter((v) => v.documentoId === d.id).length
            // Bloco por pessoa: cabeçalho sutil sempre que o nome muda — a lista já
            // vem agrupada por pessoa (ordem de pessoasV2), então mudança de nome
            // sempre marca o INÍCIO de um bloco novo, nunca dois blocos da mesma
            // pessoa espalhados.
            const novoBloco = i === 0 || docs[i - 1].pessoaNome !== d.pessoaNome
            return (
              <Fragment key={d.id}>
                {novoBloco && (
                  <tr className="bg-[var(--surface-secondary)]/70">
                    <td colSpan={7} className="px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                      {d.pessoaNome}
                    </td>
                  </tr>
                )}
                <tr onClick={() => onSelecionar(d.id)}
                  className={`cursor-pointer hover:bg-[var(--surface-secondary)] ${selecionado === d.id ? "bg-[var(--surface-secondary)]" : ""}`}>
                  <td className="px-3 py-2.5 flex items-center gap-2 text-white/95 font-medium pl-6"><FileText className="w-4 h-4 text-[var(--text-muted)]" />{d.titulo}</td>
                  <td className="px-3 py-2.5 text-white/80">{d.pessoaNome}</td>
                  <td className="px-3 py-2.5 text-white/68">{d.tipo}</td>
                  <td className="px-3 py-2.5 text-white/68 whitespace-nowrap">{fmtDia(d.dataEmissao)}</td>
                  <td className="px-3 py-2.5">
                    {n > 0
                      ? <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--surface-secondary)] text-red-700">Com divergências</span>
                      : d.analysisStatus === "ready"
                        ? <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--surface-secondary)] text-green-800">Sem divergências</span>
                        : <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--surface-secondary)] text-[var(--text-secondary)]" title="Ainda não passou pela comparação da Análise Documental">Não analisado</span>}
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
              </Fragment>
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

// ============================================================
// REVISÃO DOS DADOS EXTRAÍDOS — a ponte que faltava entre "Extrair
// automaticamente" (grava ai_extracted) e "Analisar automaticamente" (só roda
// em cima de dataStatus="reviewed"). Sem uma tela onde um humano vê, corrige e
// CONFIRMA o que o OCR leu, a extração automática escreve dado que nunca é
// usado — a comparação nunca lê "ai_extracted", só "reviewed". Achado real:
// a extração funcionava perfeitamente e mesmo assim nada mudava, porque não
// existia como sair de "ai_extracted" pra "reviewed" pela tela.
// ============================================================

const ROTULO_GRUPO: Record<string, string> = {
  registered: "Registrado(a)", father: "Pai", mother: "Mãe",
  paternalGrandparents: "Avós paternos", maternalGrandparents: "Avós maternos",
  spouse1: "Noivo(a) 1", spouse2: "Noivo(a) 2",
  spouse1Parents: "Pais do(a) noivo(a) 1", spouse2Parents: "Pais do(a) noivo(a) 2",
  event: "Evento", deceased: "Falecido(a)", parents: "Pais", deathEvent: "Óbito/Evento",
}
const ROTULO_CAMPO: Record<string, string> = {
  fullName: "Nome completo", birthDate: "Data de nascimento", birthPlace: "Local de nascimento",
  nationality: "Nacionalidade", fatherFullName: "Nome do pai", motherFullName: "Nome da mãe",
  grandfatherName: "Nome do avô", grandmotherName: "Nome da avó",
  marriageDate: "Data do casamento", marriagePlace: "Local do casamento",
  deathDate: "Data do óbito", deathPlace: "Local do óbito", declaredAge: "Idade declarada",
  profession: "Profissão", previousCivilStatus: "Estado civil anterior", marriageCountry: "País",
}

interface CampoAchatado { caminho: string[]; rotulo: string; valor: string }

/** Tipo do evento pelo enum bruto do documento (mesma regra do extrator/servidor). */
function tipoEventoDoDoc(tipo: string): "nascimento" | "casamento" | "obito" {
  const t = (tipo || "").toUpperCase()
  if (t.includes("CASAMENTO")) return "casamento"
  if (t.includes("OBITO")) return "obito"
  return "nascimento"
}
// Template VAZIO por tipo — todo campo que a comparação (ad-v2-engine.ts) sabe
// ler, com valor em branco. Existe pra quando a extração automática não achou
// nada (texto ilegível, sem OCR configurado): sem isto, um documento que falhou
// na extração ficava sem NENHUM jeito de preencher os dados à mão nesta tela.
const TEMPLATE_VAZIO: Record<"nascimento" | "casamento" | "obito", Record<string, unknown>> = {
  nascimento: {
    registered: { fullName: "", birthDate: "", birthPlace: "", nationality: "" },
    father: { fullName: "" }, mother: { fullName: "" },
    paternalGrandparents: { grandfatherName: "", grandmotherName: "" },
    maternalGrandparents: { grandfatherName: "", grandmotherName: "" },
  },
  casamento: {
    spouse1: { fullName: "" }, spouse2: { fullName: "" },
    spouse1Parents: { fatherFullName: "", motherFullName: "" },
    spouse2Parents: { fatherFullName: "", motherFullName: "" },
    event: { marriageDate: "", marriagePlace: "" },
  },
  obito: {
    deceased: { fullName: "", birthPlace: "", nationality: "", declaredAge: "" },
    parents: { fatherFullName: "", motherFullName: "" },
    deathEvent: { deathDate: "", deathPlace: "" },
  },
}

/** Achata {birth:{registered:{fullName}}} em campos folha editáveis, com rótulo em português. */
function achatarStructuredData(obj: unknown, caminho: string[] = []): CampoAchatado[] {
  if (obj == null || typeof obj !== "object") return []
  const out: CampoAchatado[] = []
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const novoCaminho = [...caminho, k]
    if (v != null && typeof v === "object" && !Array.isArray(v)) {
      out.push(...achatarStructuredData(v, novoCaminho))
    } else {
      const grupoKey = caminho[caminho.length - 1]
      const rotuloGrupo = grupoKey ? (ROTULO_GRUPO[grupoKey] ?? "") : ""
      const rotuloCampo = ROTULO_CAMPO[k] ?? k
      out.push({ caminho: novoCaminho, rotulo: rotuloGrupo ? `${rotuloGrupo} — ${rotuloCampo}` : rotuloCampo, valor: v == null ? "" : String(v) })
    }
  }
  return out
}

/** Volta os campos achatados pro shape aninhado que structuredData espera. */
function reconstruirStructuredData(campos: CampoAchatado[]): Record<string, unknown> {
  const raiz: Record<string, unknown> = {}
  for (const c of campos) {
    let atual = raiz
    for (let i = 0; i < c.caminho.length - 1; i++) {
      const k = c.caminho[i]
      if (typeof atual[k] !== "object" || atual[k] == null) atual[k] = {}
      atual = atual[k] as Record<string, unknown>
    }
    atual[c.caminho[c.caminho.length - 1]] = c.valor.trim() || null
  }
  return raiz
}

function PainelDocumento({ doc, divergencias, historico, processoId, readOnly, onVerDetalhes, onSalvo }: {
  doc: (DocV2 & { pessoaNome: string }) | null
  divergencias: Divergencia[]
  historico: Array<{ quando: string | null; texto: string }>
  processoId: number
  readOnly: boolean
  onVerDetalhes: (d: Divergencia) => void
  onSalvo: () => void
}) {
  const [abaDoc, setAbaDoc] = useState<AbaDoc>("visualizacao")
  // Inicializado direto do doc (sem efeito) — o componente é remontado por
  // `key={doc.id}` no chamador sempre que a seleção muda, então o inicializador
  // já roda com o documento certo. Evita o cascading-render de sincronizar
  // estado num efeito só pra reagir à troca de prop.
  const [campos, setCampos] = useState<CampoAchatado[]>(() => (doc ? achatarStructuredData(doc.structuredData) : []))
  const [salvando, setSalvando] = useState<"rascunho" | "revisado" | null>(null)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)

  const salvar = async (dataStatus: "manual_filled" | "reviewed") => {
    if (!doc) return
    setSalvando(dataStatus === "reviewed" ? "revisado" : "rascunho")
    setErroSalvar(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/analise-v2/documentos/${doc.id}`, {
        method: "POST", headers: jsonHeaders(),
        body: JSON.stringify({ structuredData: reconstruirStructuredData(campos), dataStatus }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "Erro ao salvar os dados.")
      onSalvo()
    } catch (e) {
      setErroSalvar(e instanceof Error ? e.message : "Erro ao salvar os dados.")
    } finally {
      setSalvando(null)
    }
  }

  if (!doc) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-default)] p-6 text-center text-xs text-[var(--text-muted)]">
        Selecione um documento na aba "Documentos" para ver os detalhes.
      </div>
    )
  }
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
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${DATA_STATUS_STYLE[doc.dataStatus] || "bg-[var(--surface-tertiary)] text-white/68"}`}>
                {DATA_STATUS_LABEL[doc.dataStatus] || doc.dataStatus}
              </span>
              {doc.dataStatus !== "reviewed" && (
                <span className="text-[10px] text-[var(--text-muted)]">A Análise só compara documento marcado como revisado.</span>
              )}
            </div>

            {campos.length === 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-[var(--text-muted)]">Nenhum dado estruturado ainda — a extração automática não achou nada (ou ainda não rodou).</p>
                {!readOnly && (
                  <button
                    onClick={() => setCampos(achatarStructuredData(TEMPLATE_VAZIO[tipoEventoDoDoc(doc.tipo)]))}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-md border border-[var(--border-default)] text-white/80 hover:bg-[var(--surface-hover)]"
                  >
                    Preencher manualmente
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {campos.map((c, i) => (
                  <div key={c.caminho.join(".")} className="flex flex-col gap-1">
                    <label className="text-[11px] text-[var(--text-secondary)]">{c.rotulo}</label>
                    <input
                      value={c.valor}
                      disabled={readOnly}
                      onChange={(e) => setCampos((prev) => prev.map((p, j) => (j === i ? { ...p, valor: e.target.value } : p)))}
                      className="w-full px-2.5 py-1.5 text-xs rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] text-white/95 disabled:opacity-60"
                    />
                  </div>
                ))}
              </div>
            )}

            {erroSalvar && <p className="text-xs text-red-700">{erroSalvar}</p>}

            {!readOnly && campos.length > 0 && (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => salvar("manual_filled")}
                  disabled={salvando !== null}
                  className="px-2.5 py-1.5 text-xs font-semibold rounded-md border border-[var(--border-default)] text-white/80 hover:bg-[var(--surface-hover)] disabled:opacity-50"
                >
                  {salvando === "rascunho" ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : "Salvar rascunho"}
                </button>
                <button
                  onClick={() => salvar("reviewed")}
                  disabled={salvando !== null}
                  className="px-2.5 py-1.5 text-xs font-semibold rounded-md bg-[var(--action-primary)] text-[var(--action-primary-ink)] hover:bg-[var(--action-primary-hover)] disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {salvando === "revisado" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Salvar e marcar revisado
                </button>
              </div>
            )}
          </div>
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
