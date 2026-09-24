// src/components/kanban/ProcessoApostilamento.tsx
"use client"

import { useState, Fragment, type ReactNode } from "react"
import {
  Loader2, FolderOpen, Check, X, Upload, ChevronDown, ChevronRight,
  Search, FileText, Send, History, ListChecks, CheckSquare,
} from "lucide-react"
import { useApi } from "@/src/lib/dados"

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
interface PessoaDoc {
  documentoId: number
  tipoLabel: string
  categoria: string
  apto: boolean
  origemLabel: string
  motivoNaoApto: string | null
  naPasta: boolean
  statusNaPasta: string | null
  statusNaPastaLabel: string | null
  conferenceResult: string | null
}
interface PessoaGrupo {
  pessoaId: number
  nome: string
  documentos: PessoaDoc[]
}
interface Totais {
  documentosNecessarios: number
  aptos: number
  bloqueados: number
  naPasta: number
  enviados: number
  recebidos: number
  conferidos: number
  validados: number
}
interface RespostaGet {
  pasta?: Pasta | null
  progress?: number
  paisDestino?: { label: string; flag: string | null } | null
  responsavel?: { id: number; nome: string } | null
  pessoas?: PessoaGrupo[]
  totais?: Totais
}

interface Props {
  processoId: number
  onConcluido?: () => void
}

// 6 etapas internas (motor) — a barra visual mostra 5 (ver ProcessoTraducao.tsx).
const VISUAL_STEPS = ["Montar pasta", "Enviar para apostilamento", "Receber apostilados", "Conferir apostilas", "Validar pasta"]
const VISUAL_INDEX: Record<string, number> = {
  montar_pasta_apostilamento: 0,
  enviar_para_apostilamento: 1,
  aguardar_retorno_apostilamento: 2,
  receber_documentos_apostilados: 2,
  conferir_apostilas: 3,
  validar_pasta_apostilada: 4,
}
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
const TIPO_LABEL: Record<string, string> = { fisico: "Físico", digital: "Digital", ambos: "Ambos", haia: "Apostila de Haia" }

const EC = "w-full text-sm border border-[var(--border-default)] rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:border-[var(--border-default)] focus:border-[var(--border-default)]"
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

export function ProcessoApostilamento({ processoId, onConcluido }: Props) {
  const [aba, setAba] = useState<"documentos" | "resumo" | "historico">("documentos")
  const [visao, setVisao] = useState<"pessoa" | "documento">("pessoa")
  const [busca, setBusca] = useState("")
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "apto" | "nao_apto" | "na_pasta">("todos")
  const [filtroPessoa, setFiltroPessoa] = useState<number | "todas">("todas")
  const [filtroTipo, setFiltroTipo] = useState("todos")
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())
  const [colapsadas, setColapsadas] = useState<Set<number>>(new Set())
  const [modalStep, setModalStep] = useState<string | null>(null)
  const [historicoAberto, setHistoricoAberto] = useState(false)
  const [posting, setPosting] = useState(false)
  const [modalErro, setModalErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erroAcao, setErroAcao] = useState<string | null>(null)

  const { dados, carregando: loading, recarregar: carregar } =
    useApi<RespostaGet>(`/api/processos/${processoId}/apostilamento`)
  const pasta = dados?.pasta ?? null
  const progress = dados?.progress ?? 0
  const pessoas = dados?.pessoas ?? []
  const totais = dados?.totais
  const paisDestino = dados?.paisDestino ?? null
  const responsavel = dados?.responsavel ?? null

  const postEtapa = async (stepId: string, payload: Record<string, unknown>) => {
    setPosting(true); setModalErro(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/apostilamento/etapas/${stepId}`, {
        method: "POST", headers: jsonHeaders(), body: JSON.stringify(payload),
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

  const mutarPasta = async (acao: "adicionar" | "remover", documentoIds: number[]) => {
    setErroAcao(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/apostilamento/pasta/documentos`, {
        method: "POST", headers: jsonHeaders(), body: JSON.stringify({ acao, documentoIds }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.mensagem || data.error || "Não foi possível atualizar a pasta.")
      setSelecionados(new Set())
      await carregar()
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : "Erro ao atualizar a pasta.")
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-[var(--text-muted)]" /></div>
  }
  if (!pasta) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-default)] p-8 text-center text-sm text-[var(--text-secondary)]">
        Este processo ainda não está na fase de Apostilamento.
      </div>
    )
  }

  const podeEditarPasta = pasta.currentStep === "montar_pasta_apostilamento"
  const visualIndex = VISUAL_INDEX[pasta.currentStep] ?? 0
  const concluida = pasta.status === "concluida"

  const todosDocs = pessoas.flatMap((p) => p.documentos.map((d) => ({ ...d, pessoaId: p.pessoaId, pessoaNome: p.nome })))
  const tiposDisponiveis = [...new Set(todosDocs.map((d) => d.tipoLabel))]

  const passaFiltro = (d: PessoaDoc & { pessoaId: number; pessoaNome: string }) => {
    if (busca && !d.tipoLabel.toLowerCase().includes(busca.toLowerCase()) && !d.pessoaNome.toLowerCase().includes(busca.toLowerCase())) return false
    if (filtroStatus === "apto" && !d.apto) return false
    if (filtroStatus === "nao_apto" && d.apto) return false
    if (filtroStatus === "na_pasta" && !d.naPasta) return false
    if (filtroPessoa !== "todas" && d.pessoaId !== filtroPessoa) return false
    if (filtroTipo !== "todos" && d.tipoLabel !== filtroTipo) return false
    return true
  }

  const pessoasFiltradas = pessoas
    .map((p) => ({ ...p, documentos: p.documentos.filter((d) => passaFiltro({ ...d, pessoaId: p.pessoaId, pessoaNome: p.nome })) }))
    .filter((p) => p.documentos.length > 0)

  const aptosVisiveis = pessoasFiltradas.flatMap((p) => p.documentos.filter((d) => d.apto && !d.naPasta))
  const naPastaSelecionaveis = pessoasFiltradas.flatMap((p) => p.documentos.filter((d) => d.naPasta && selecionados.has(d.documentoId)))
  const selecionadosAptos = [...selecionados].filter((id) => todosDocs.find((d) => d.documentoId === id)?.apto && !todosDocs.find((d) => d.documentoId === id)?.naPasta)

  const toggleSelecionado = (documentoId: number) => {
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (next.has(documentoId)) next.delete(documentoId); else next.add(documentoId)
      return next
    })
  }
  const selecionarTodosAptos = () => setSelecionados(new Set(aptosVisiveis.map((d) => d.documentoId)))
  const toggleColapsada = (pessoaId: number) => setColapsadas((prev) => {
    const next = new Set(prev)
    if (next.has(pessoaId)) next.delete(pessoaId); else next.add(pessoaId)
    return next
  })

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-popover)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-[var(--action-primary)]/15 text-[var(--action-primary)] flex items-center justify-center flex-shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white/95">Apostilamento</h2>
              <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                Monte a pasta com os documentos aptos, envie ao cartório/autoridade de apostilamento, acompanhe o retorno e valide as apostilas.
              </p>
            </div>
          </div>
          <AcoesDaFase onAtualizar={carregar} onHistorico={() => setHistoricoAberto(true)} />
        </div>

        <div className="mt-4 flex flex-wrap gap-6">
          <CampoContexto label="Responsável">
            {responsavel ? (
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-[var(--surface-tertiary)] text-white/80 text-[10px] font-bold flex items-center justify-center">{ini(responsavel.nome)}</span>
                <span className="text-sm font-semibold text-white/95">{responsavel.nome}</span>
              </div>
            ) : <span className="text-sm text-[var(--text-muted)]">—</span>}
          </CampoContexto>
          <CampoContexto label="Cartório / Autoridade">
            {pasta.authorityName
              ? <span className="text-sm font-semibold text-white/95">{pasta.authorityName}</span>
              : <button onClick={() => setModalStep("enviar_para_apostilamento")} className="text-sm font-semibold text-[var(--accent-text)] hover:underline">Selecionar</button>}
          </CampoContexto>
          <CampoContexto label="Tipo de apostilamento">
            <span className="text-sm font-semibold text-white/95">{pasta.apostilleType ? (TIPO_LABEL[pasta.apostilleType] || pasta.apostilleType) : "Apostila de Haia"}</span>
          </CampoContexto>
          <CampoContexto label="País de destino">
            <span className="text-sm font-semibold text-white/95">{paisDestino?.flag ? `${paisDestino.flag} ` : ""}{pasta.destinationCountry || paisDestino?.label || "—"}</span>
          </CampoContexto>
          <CampoContexto label="Prazo estimado">
            <span className="text-sm font-semibold text-white/95">{fmtDate(pasta.expectedDate)}</span>
            {podeEditarPasta && <button onClick={() => setModalStep("enviar_para_apostilamento")} className="ml-1.5 text-xs font-semibold text-[var(--accent-text)] hover:underline">Editar</button>}
          </CampoContexto>
          <CampoContexto label="Custo estimado">
            <span className="text-sm font-semibold text-white/95">{pasta.cost || "—"}</span>
          </CampoContexto>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi icon="📄" value={totais?.documentosNecessarios ?? 0} label="Documentos necessários" />
        <Kpi icon="✅" value={totais?.aptos ?? 0} label="Aptos para a pasta" tone="green" />
        <Kpi icon="📁" value={totais?.naPasta ?? 0} label="Na pasta atual" />
        <Kpi icon="⚠️" value={totais?.bloqueados ?? 0} label="Bloqueados" tone={((totais?.bloqueados ?? 0) > 0) ? "red" : undefined} />
        <Kpi icon="📤" value={totais?.enviados ?? 0} label="Enviados ao cartório" />
        <Kpi icon="📥" value={totais?.recebidos ?? 0} label="Apostilados recebidos" />
        <Kpi icon="🔍" value={totais?.conferidos ?? 0} label="Conferidos" />
        <Kpi icon="🏅" value={totais?.validados ?? 0} label="Validados" tone="green" />
      </div>

      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-popover)] p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start flex-1">
            {VISUAL_STEPS.map((title, i) => {
              const done = i < visualIndex || concluida
              const active = i === visualIndex && !concluida
              return (
                <div key={title} className={`flex items-start ${i < VISUAL_STEPS.length - 1 ? "flex-1" : ""}`}>
                  <button
                    type="button"
                    disabled={!active}
                    onClick={() => active && setModalStep(pasta.currentStep)}
                    className={`flex flex-col items-center text-center w-[110px] shrink-0 ${active ? "cursor-pointer" : "cursor-default"}`}
                  >
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                      done ? "bg-[var(--action-primary)] text-white"
                        : active ? "bg-[var(--action-primary)] text-white"
                          : "bg-[var(--surface-tertiary)] text-[var(--text-secondary)]"}`}>
                      {done ? <Check className="w-4 h-4" /> : i + 1}
                    </div>
                    <div className="mt-1.5 text-[11px] font-medium text-white/80 leading-tight">{title}</div>
                    <div className={`text-[10px] ${done ? "text-green-800" : active ? "text-[var(--accent-text)]" : "text-[var(--text-muted)]"}`}>
                      {done ? "Concluído" : active ? "Em andamento" : "Pendente"}
                    </div>
                  </button>
                  {i < VISUAL_STEPS.length - 1 && <div className={`flex-1 h-0.5 mt-3.5 ${done ? "bg-[var(--action-primary)]" : "bg-[var(--surface-tertiary)]"}`} />}
                </div>
              )
            })}
          </div>
          <button onClick={() => setHistoricoAberto(true)} className="flex-shrink-0 ml-3 px-3 py-2 text-xs font-semibold text-white/80 border border-[var(--border-default)] rounded-md hover:bg-[var(--surface-secondary)] inline-flex items-center gap-1.5">
            <History className="w-3.5 h-3.5" /> Ver histórico da fase
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4 flex items-start gap-3 flex-wrap">
        <div className="w-9 h-9 rounded-lg bg-[var(--surface-secondary)] text-white/80 flex items-center justify-center flex-shrink-0">
          <FolderOpen className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-[260px]">
          <div className="text-sm font-semibold text-white/95">Pasta de apostilamento do processo</div>
          <p className="text-xs text-white/68 mt-0.5">
            Todos os documentos aptos são reunidos e enviados juntos ao cartório/autoridade de apostilamento.
            A fase só conclui quando a pasta inteira estiver apostilada, conferida e validada.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-xs text-[var(--text-secondary)]">
            <span>Destino: <b className="text-white/95">{pasta.destinationCountry || paisDestino?.label || "—"}</b></span>
            <span>Tipo: <b className="text-white/95">{pasta.apostilleType ? (TIPO_LABEL[pasta.apostilleType] || pasta.apostilleType) : "Apostila de Haia"}</b></span>
            <span>Cartório: <b className="text-white/95">{pasta.authorityName || "—"}</b></span>
            <span>Prazo: <b className="text-white/95">{fmtDate(pasta.expectedDate)}</b></span>
            <span>Custo: <b className="text-white/95">{pasta.cost || "—"}</b></span>
          </div>
        </div>
        {podeEditarPasta && (
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-2">
              <div className="text-sm font-semibold text-white/95 inline-flex items-center gap-1.5"><FolderOpen className="w-3.5 h-3.5 text-[var(--action-primary)]" /> {totais?.naPasta ?? 0} documentos na pasta atual</div>
              <div className="text-[11px] text-[var(--text-secondary)]">{(totais?.naPasta ?? 0) > 0 ? "Pronta para envio ao cartório" : "Adicione documentos aptos"}</div>
            </div>
            <button
              onClick={() => setModalStep("enviar_para_apostilamento")}
              disabled={(totais?.naPasta ?? 0) === 0}
              className="px-4 py-2.5 text-sm font-semibold text-[var(--action-primary-ink)] bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)] disabled:opacity-40 disabled:cursor-not-allowed rounded-md inline-flex items-center gap-2">
              <Send className="w-4 h-4" /> Enviar pasta ao cartório
            </button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-popover)] overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 pt-3 border-b border-[var(--border-default)] flex-wrap">
          <div className="flex items-center gap-1">
            {([["documentos", "Documentos por pessoa"], ["resumo", "Resumo da pasta"], ["historico", "Histórico"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setAba(k)}
                className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px ${aba === k ? "border-[var(--action-primary)] text-white/95" : "border-transparent text-[var(--text-secondary)] hover:text-white/80"}`}>
                {label}{k === "resumo" && <span className="ml-1.5 text-xs font-semibold text-[var(--text-secondary)] bg-[var(--surface-tertiary)] rounded-full px-1.5">{totais?.naPasta ?? 0}</span>}
              </button>
            ))}
          </div>
          {aba === "documentos" && podeEditarPasta && (
            <div className="flex items-center gap-2 pb-2.5">
              <button onClick={selecionarTodosAptos} className="px-3 py-1.5 text-xs font-semibold text-white/80 border border-[var(--border-default)] rounded-md hover:bg-[var(--surface-secondary)] inline-flex items-center gap-1.5">
                <CheckSquare className="w-3.5 h-3.5" /> Selec. todos os aptos
              </button>
              <button onClick={() => selecionadosAptos.length > 0 && mutarPasta("adicionar", selecionadosAptos)} disabled={selecionadosAptos.length === 0}
                className="px-3 py-1.5 text-xs font-semibold text-[var(--action-primary-ink)] bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)] disabled:opacity-40 disabled:cursor-not-allowed rounded-md inline-flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5" /> Adicionar à pasta
              </button>
              <button onClick={() => naPastaSelecionaveis.length > 0 && mutarPasta("remover", naPastaSelecionaveis.map((d) => d.documentoId))} disabled={naPastaSelecionaveis.length === 0}
                className="px-3 py-1.5 text-xs font-semibold text-white/80 border border-[var(--border-default)] rounded-md hover:bg-[var(--surface-secondary)] disabled:opacity-40 disabled:cursor-not-allowed">
                Remover da pasta
              </button>
            </div>
          )}
        </div>

        {aba === "documentos" && (
          <>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--border-default)]">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa ou documento..."
                  className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] pl-8 pr-3 py-2 text-xs text-white/90 placeholder-[var(--text-muted)] focus:outline-none" />
              </div>
              <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as typeof filtroStatus)} className="text-xs border border-[var(--border-default)] rounded-md px-2 py-2 bg-[var(--surface-popover)] text-white/80">
                <option value="todos">Todos os status</option>
                <option value="apto">Apto</option>
                <option value="nao_apto">Não apto</option>
                <option value="na_pasta">Na pasta</option>
              </select>
              <select value={filtroPessoa} onChange={(e) => setFiltroPessoa(e.target.value === "todas" ? "todas" : Number(e.target.value))} className="text-xs border border-[var(--border-default)] rounded-md px-2 py-2 bg-[var(--surface-popover)] text-white/80">
                <option value="todas">Todas as pessoas</option>
                {pessoas.map((p) => <option key={p.pessoaId} value={p.pessoaId}>{p.nome}</option>)}
              </select>
              <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="text-xs border border-[var(--border-default)] rounded-md px-2 py-2 bg-[var(--surface-popover)] text-white/80">
                <option value="todos">Todos os tipos</option>
                {tiposDisponiveis.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button onClick={() => setVisao((v) => (v === "pessoa" ? "documento" : "pessoa"))} className="ml-auto px-3 py-2 text-xs font-semibold text-white/80 border border-[var(--border-default)] rounded-md hover:bg-[var(--surface-secondary)] inline-flex items-center gap-1.5">
                <ListChecks className="w-3.5 h-3.5" /> Visão por {visao === "pessoa" ? "documento" : "pessoa"}
              </button>
            </div>

            {erroAcao && <div className="mx-4 mt-3 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-xs text-red-700">{erroAcao}</div>}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] bg-[var(--surface-secondary)]">
                    <th className="w-8 px-3 py-2"></th>
                    <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">Pessoa</th>
                    <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">Documento</th>
                    <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">Origem</th>
                    <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">Apto para apostilar</th>
                    <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">Na pasta</th>
                    <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">Status da apostila</th>
                    <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">Conferência</th>
                    <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">Observações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {visao === "pessoa" ? pessoasFiltradas.map((p) => {
                    const colapsada = colapsadas.has(p.pessoaId)
                    const naPastaN = p.documentos.filter((d) => d.naPasta).length
                    const bloqueadosN = p.documentos.filter((d) => !d.apto).length
                    return (
                      <Fragment key={p.pessoaId}>
                        <tr className="bg-[var(--surface-secondary)]/40 hover:bg-[var(--surface-secondary)]">
                          <td className="px-3 py-2.5">
                            <button onClick={() => toggleColapsada(p.pessoaId)} className="text-[var(--text-muted)] hover:text-white/80">
                              {colapsada ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          </td>
                          <td colSpan={7} className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="w-7 h-7 rounded-full bg-[var(--surface-tertiary)] text-white/68 text-[11px] font-bold flex items-center justify-center flex-shrink-0">{ini(p.nome)}</span>
                              <div>
                                <div className="font-semibold text-white/95">{p.nome}</div>
                                <div className="text-[11px] text-[var(--text-secondary)]">{p.documentos.length} documento(s){bloqueadosN > 0 ? `, ${bloqueadosN} bloqueado(s)` : ""}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            <span className="text-[11px] font-semibold text-green-800 bg-[var(--surface-secondary)] rounded-full px-2 py-0.5 mr-1.5">{naPastaN} na pasta</span>
                            {bloqueadosN > 0 && <span className="text-[11px] font-semibold text-red-700 bg-[var(--surface-secondary)] rounded-full px-2 py-0.5">{bloqueadosN} bloqueado{bloqueadosN > 1 ? "s" : ""}</span>}
                          </td>
                        </tr>
                        {!colapsada && p.documentos.map((d) => (
                          <LinhaDocumento key={d.documentoId} d={d} podeEditarPasta={podeEditarPasta} selecionado={selecionados.has(d.documentoId)} onToggle={() => toggleSelecionado(d.documentoId)} labelStatus={AP_DOC_LABEL} />
                        ))}
                      </Fragment>
                    )
                  }) : (
                    todosDocs.filter(passaFiltro).map((d) => (
                      <LinhaDocumento key={d.documentoId} d={d} podeEditarPasta={podeEditarPasta} selecionado={selecionados.has(d.documentoId)} onToggle={() => toggleSelecionado(d.documentoId)} labelStatus={AP_DOC_LABEL} mostrarPessoa />
                    ))
                  )}
                  {pessoasFiltradas.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-[var(--text-secondary)]">Nenhum documento encontrado com estes filtros.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-default)] text-xs text-[var(--text-secondary)]">
              <span>{pessoas.length} pessoas · {totais?.documentosNecessarios ?? 0} documentos no total</span>
              <div className="flex items-center gap-3">
                <Legenda cor="bg-green-700" label="Apto" />
                <Legenda cor="bg-red-700" label="Não apto" />
                <Legenda cor="bg-[var(--surface-tertiary)]" label="Pendente" />
                <Legenda cor="bg-[var(--action-primary)]" label="Na pasta" />
              </div>
            </div>
          </>
        )}

        {aba === "resumo" && <ResumoDaPasta docs={pasta.documentos} labelStatus={AP_DOC_LABEL} />}
        {aba === "historico" && <HistoricoInline processoId={processoId} />}
      </div>

      {aviso && <div className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-lg px-4 py-3 text-sm text-[var(--text-secondary)]">{aviso}</div>}

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

      {historicoAberto && <HistoricoDrawer processoId={processoId} onClose={() => setHistoricoAberto(false)} />}
    </div>
  )
}

function CampoContexto({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-0.5">{label}</div>
      {children}
    </div>
  )
}

function Kpi({ icon, value, label, tone }: { icon: string; value: number; label: string; tone?: "green" | "red" }) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-2.5">
      <div className="text-base leading-none">{icon}</div>
      <div className={`text-xl font-bold mt-1 ${tone === "green" ? "text-green-800" : tone === "red" ? "text-red-700" : "text-white/95"}`}>{value}</div>
      <div className="text-[11px] text-[var(--text-secondary)]">{label}</div>
    </div>
  )
}

function Legenda({ cor, label }: { cor: string; label: string }) {
  return <span className="inline-flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${cor}`} />{label}</span>
}

function AcoesDaFase({ onAtualizar, onHistorico }: { onAtualizar: () => void; onHistorico: () => void }) {
  const [aberto, setAberto] = useState(false)
  return (
    <div className="relative flex-shrink-0">
      <button onClick={() => setAberto((v) => !v)} className="px-3 py-2 text-sm font-semibold text-white/80 border border-[var(--border-default)] rounded-md hover:bg-[var(--surface-secondary)] inline-flex items-center gap-1.5">
        Ações da fase <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div className="absolute right-0 mt-1 w-52 rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] shadow-[var(--elev-3)] z-20 py-1">
            <button onClick={() => { onAtualizar(); setAberto(false) }} className="w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-[var(--surface-secondary)]">Atualizar dados</button>
            <button onClick={() => { onHistorico(); setAberto(false) }} className="w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-[var(--surface-secondary)]">Ver histórico da fase</button>
          </div>
        </>
      )}
    </div>
  )
}

function LinhaDocumento({ d, podeEditarPasta, selecionado, onToggle, labelStatus, mostrarPessoa }: {
  d: PessoaDoc & { pessoaNome?: string }
  podeEditarPasta: boolean
  selecionado: boolean
  onToggle: () => void
  labelStatus: Record<string, string>
  mostrarPessoa?: boolean
}) {
  return (
    <tr className="hover:bg-[var(--surface-secondary)] align-top">
      <td className="px-3 py-2.5">
        {podeEditarPasta && (
          <input type="checkbox" checked={selecionado} onChange={onToggle} disabled={!d.apto && !d.naPasta}
            className="accent-[var(--action-primary)]" />
        )}
      </td>
      {mostrarPessoa ? (
        <td className="px-3 py-2.5 font-semibold text-white/95">{d.pessoaNome}</td>
      ) : (
        <td className="px-3 py-2.5" />
      )}
      <td className="px-3 py-2.5">
        <div className="font-medium text-white/95">{d.tipoLabel}</div>
        <div className="text-[11px] text-[var(--text-secondary)]">{d.categoria}</div>
      </td>
      <td className="px-3 py-2.5 text-white/68">{d.origemLabel}</td>
      <td className="px-3 py-2.5">
        {d.apto
          ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-800"><Check className="w-3.5 h-3.5" /> Apto</span>
          : <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700"><X className="w-3.5 h-3.5" /> Não apto</span>}
      </td>
      <td className="px-3 py-2.5">
        {d.naPasta
          ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-text)]"><Check className="w-3.5 h-3.5" /> Na pasta</span>
          : <span className="text-xs text-[var(--text-muted)]">Não incluído</span>}
      </td>
      <td className="px-3 py-2.5 text-white/80">{d.naPasta ? (labelStatus[d.statusNaPasta ?? ""] ?? d.statusNaPastaLabel ?? "—") : "—"}</td>
      <td className="px-3 py-2.5 text-white/80">{d.conferenceResult ?? "—"}</td>
      <td className="px-3 py-2.5 text-[var(--text-secondary)]">{!d.apto ? d.motivoNaoApto : "—"}</td>
    </tr>
  )
}

function ResumoDaPasta({ docs, labelStatus }: { docs: ApDoc[]; labelStatus: Record<string, string> }) {
  if (docs.length === 0) return <div className="p-8 text-center text-sm text-[var(--text-secondary)]">Nenhum documento na pasta ainda.</div>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] bg-[var(--surface-secondary)]">
            {["Pessoa", "Documento", "Origem", "Status"].map((h) => <th key={h} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {docs.map((d) => (
            <tr key={d.id} className="hover:bg-[var(--surface-secondary)]">
              <td className="px-3 py-2.5 font-semibold text-white/95">{d.pessoaNome}</td>
              <td className="px-3 py-2.5">{d.documentoTitulo}{d.apostilleNumber ? ` · Apostila ${d.apostilleNumber}` : ""}</td>
              <td className="px-3 py-2.5 text-white/68">{d.origem}</td>
              <td className="px-3 py-2.5">{labelStatus[d.status] ?? d.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface LogItem { id: string; acao: string; descricao: string; criadoEm: string; usuario: { nome: string } | null }

function HistoricoInline({ processoId }: { processoId: number }) {
  const { dados, carregando } = useApi<{ logs: LogItem[] }>(`/api/processos/${processoId}/logs?limite=100`)
  const logs = dados?.logs ?? []
  if (carregando) return <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[var(--text-muted)]" /></div>
  if (logs.length === 0) return <div className="p-8 text-center text-sm text-[var(--text-secondary)]">Sem movimentações registradas.</div>
  return (
    <div className="divide-y divide-white/10 max-h-[420px] overflow-y-auto">
      {logs.map((l) => (
        <div key={l.id} className="px-4 py-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white/90">{l.descricao}</span>
            <span className="text-[var(--text-muted)]">{new Date(l.criadoEm).toLocaleString("pt-BR")}</span>
          </div>
          {l.usuario && <div className="text-[var(--text-secondary)] mt-0.5">por {l.usuario.nome}</div>}
        </div>
      ))}
    </div>
  )
}

function HistoricoDrawer({ processoId, onClose }: { processoId: number; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-[var(--overlay-modal)]" onClick={onClose} />
      <div className="relative w-full max-w-md bg-[var(--surface-popover)] h-full shadow-[var(--elev-3)] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-default)]">
          <h3 className="text-base font-bold text-white/95">Histórico do processo</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-white/80 p-1"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <HistoricoInline processoId={processoId} />
        </div>
      </div>
    </div>
  )
}

// ============================================================
// MODAL DA ETAPA ATIVA (mesmo motor de sempre: applyStep no servidor)
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
  const num = VISUAL_INDEX[stepId] + 1

  const [destino, setDestino] = useState(pasta.destinationCountry || "")
  const [tipo, setTipo] = useState(pasta.apostilleType || "")
  const [obs, setObs] = useState("")
  const [montarChk, setMontarChk] = useState<Record<string, boolean>>({})

  const [authorityName, setAuthorityName] = useState(pasta.authorityName || "")
  const [attendant, setAttendant] = useState(pasta.attendant || "")
  const [canal, setCanal] = useState("")
  const [sentAt, setSentAt] = useState("")
  const [expectedDate, setExpectedDate] = useState("")
  const [cost, setCost] = useState(pasta.cost || "")
  const [trackingCode, setTrackingCode] = useState("")

  const [receivedAt, setReceivedAt] = useState("")
  const [custoFinal, setCustoFinal] = useState("")
  const [files, setFiles] = useState<Record<number, string>>({})
  const [nums, setNums] = useState<Record<number, string>>({})
  const [dates, setDates] = useState<Record<number, string>>({})

  const [confRes, setConfRes] = useState<Record<number, string>>({})
  const [confChk, setConfChk] = useState<Record<string, boolean>>({})

  const [decision, setDecision] = useState("")
  const [valObs, setValObs] = useState("")

  const title = VISUAL_STEPS[num - 1]

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
      <div className="absolute inset-0 bg-[var(--overlay-modal)]" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[var(--surface-popover)] rounded-xl shadow-[var(--elev-3)] max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between px-5 py-4 border-b border-[var(--border-default)]">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Etapa {num} de 5 · Workflow do Apostilamento</div>
            <h3 className="text-base font-bold text-white/95 mt-0.5">{title}</h3>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-white/80 p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {stepId === "montar_pasta_apostilamento" && (
            <>
              <Sec>Documentos incluídos ({docs.length})</Sec>
              <div className="space-y-2">
                {docs.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 border border-[var(--border-default)] rounded-lg px-3 py-2">
                    <span className="text-base">📄</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white/95">{d.documentoTitulo}</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">{d.pessoaNome} · {d.origem}</div>
                    </div>
                  </div>
                ))}
                {docs.length === 0 && <div className="text-sm text-[var(--text-secondary)]">Nenhum documento na pasta — adicione documentos aptos na aba &quot;Documentos por pessoa&quot; antes de enviar.</div>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="País de destino" required><input className={EC} value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="ex: Itália" /></Field>
                <Field label="Tipo de apostilamento" required>
                  <div className="flex gap-2">
                    {TIPO_APOSTILA.map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setTipo(v)}
                        className={`flex-1 px-3 py-2 text-xs font-semibold rounded-md border ${tipo === v ? "border-[var(--border-strong)] bg-[var(--surface-secondary)] text-white" : "border-[var(--border-default)] text-white/80"}`}>{l}</button>
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
                    className={`w-full flex items-center gap-2 border rounded-lg px-3 py-2 text-sm text-left ${montarChk[key] ? "border-[var(--border-default)] bg-[var(--surface-secondary)] text-green-800" : "border-[var(--border-default)] text-white/80"}`}>
                    <span className={`w-4 h-4 rounded flex items-center justify-center ${montarChk[key] ? "bg-[var(--surface-secondary)] text-white" : "border border-[var(--border-default)]"}`}>
                      {montarChk[key] && <Check className="w-3 h-3" />}
                    </span>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}

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
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md border ${canal === v ? "border-[var(--border-strong)] bg-[var(--surface-secondary)] text-white" : "border-[var(--border-default)] text-white/80"}`}>{l}</button>
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

          {stepId === "aguardar_retorno_apostilamento" && (
            <>
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3">
                <div className="text-xs font-semibold text-white/80 mb-2">🏛️ Resumo do envio</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Cell k="Autoridade" v={pasta.authorityName || "—"} />
                  <Cell k="Enviado em" v={fmtDate(pasta.sentAt)} />
                  <Cell k="Prazo" v={fmtDate(pasta.expectedDate)} />
                  <Cell k="Rastreio" v={pasta.trackingCode || "—"} />
                </div>
              </div>
              <p className="text-sm text-white/68">Acompanhe o prazo com o cartório/autoridade. Confirme quando os documentos apostilados tiverem retorno.</p>
            </>
          )}

          {stepId === "receber_documentos_apostilados" && (
            <>
              <Sec>Documentos apostilados ({docs.length})</Sec>
              <div className="space-y-2">
                {docs.map((d) => (
                  <div key={d.id} className="border border-[var(--border-default)] rounded-lg px-3 py-2 space-y-2">
                    <div className="text-sm font-medium text-white/95">{d.documentoTitulo}</div>
                    <div className="text-[11px] text-[var(--text-secondary)]">{d.pessoaNome}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input className="text-xs border border-[var(--border-default)] rounded-md px-2 py-1.5 w-32" placeholder="Nº da apostila"
                        value={nums[d.documentoId] || ""} onChange={(e) => setNums((p) => ({ ...p, [d.documentoId]: e.target.value }))} />
                      <input className="text-xs border border-[var(--border-default)] rounded-md px-2 py-1.5 w-28" placeholder="Data"
                        value={dates[d.documentoId] || ""} onChange={(e) => setDates((p) => ({ ...p, [d.documentoId]: e.target.value }))} />
                      <button type="button" onClick={() => setFiles((p) => ({ ...p, [d.documentoId]: `apostilado_${d.documentoId}.pdf` }))}
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-md border px-3 py-1.5 ${files[d.documentoId] ? "border-[var(--border-default)] bg-[var(--surface-secondary)] text-green-800" : "border-[var(--border-default)] text-white/80"}`}>
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

          {stepId === "conferir_apostilas" && (
            <div className="space-y-3">
              {docs.map((d) => (
                <div key={d.id} className="border border-[var(--border-default)] rounded-lg p-3">
                  <div className="flex items-baseline gap-2 mb-2">
                    <b className="text-sm text-white/95">{d.documentoTitulo}</b>
                    <small className="text-[11px] text-[var(--text-secondary)]">{d.pessoaNome}{d.apostilleNumber ? ` · Apostila ${d.apostilleNumber}` : ""}</small>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {CONF_CHK.map((c, ci) => {
                      const key = `${d.documentoId}-${ci}`
                      const on = confChk[key]
                      return (
                        <button key={ci} type="button" onClick={() => setConfChk((p) => ({ ...p, [key]: !p[key] }))}
                          className={`inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-md border px-2 py-1 ${on ? "border-[var(--border-default)] bg-[var(--surface-secondary)] text-green-800" : "border-[var(--border-default)] text-white/68"}`}>
                          <span className={`w-3.5 h-3.5 rounded flex items-center justify-center ${on ? "bg-[var(--surface-secondary)] text-white" : "border border-[var(--border-default)]"}`}>{on && <Check className="w-2.5 h-2.5" />}</span>
                          {c}
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {CONF_RES.map(([v, l, tone]) => {
                      const sel = confRes[d.documentoId] === v
                      const selCls = !sel ? "border-[var(--border-default)] text-white/80"
                        : tone === "ok" ? "border-[var(--border-default)] bg-[var(--surface-secondary)] text-green-800"
                          : tone === "warn" ? "border-[var(--accent-primary)]/25 bg-[var(--accent-primary)]/12 text-[var(--accent-text)]"
                            : tone === "crit" ? "border-[var(--border-default)] bg-[var(--surface-secondary)] text-red-700"
                              : "border-[var(--border-strong)] bg-[var(--surface-secondary)] text-white"
                      return (
                        <button key={v} type="button" onClick={() => setConfRes((p) => ({ ...p, [d.documentoId]: v }))}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-md border ${selCls}`}>{l}</button>
                      )
                    })}
                  </div>
                </div>
              ))}
              {docs.length === 0 && <div className="text-sm text-[var(--text-secondary)]">Nenhum documento para conferir.</div>}
            </div>
          )}

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
                    className={`w-full text-left border rounded-lg px-3 py-2.5 ${decision === v ? "border-[var(--border-strong)] bg-[var(--surface-secondary)]" : "border-[var(--border-default)]"}`}>
                    <div className="text-sm font-semibold text-white/95">{l}</div>
                    <div className="text-[11px] text-[var(--text-secondary)]">{sub}</div>
                  </button>
                ))}
              </div>
              <Field label="Parecer final (opcional)"><textarea className={EC} rows={2} value={valObs} onChange={(e) => setValObs(e.target.value)} /></Field>
            </>
          )}

          {erro && <div className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-sm text-red-700">{erro}</div>}
        </div>

        <div className="border-t border-[var(--border-default)] px-5 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm text-white/68 hover:bg-[var(--surface-secondary)] rounded-md">Cancelar</button>
          <button onClick={submit} disabled={!podeSalvar || posting}
            className="px-4 py-2 text-sm font-semibold text-[var(--action-primary-ink)] bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)] rounded-md inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {stepId === "validar_pasta_apostilada" ? "Confirmar decisão" : "Concluir etapa"}
          </button>
        </div>
      </div>
    </div>
  )
}

function Sec({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{children}</div>
}
function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-white/80 flex items-center gap-1.5 mb-1">
        {label}{required && <span className="text-[10px] font-bold text-red-700 bg-[var(--surface-secondary)] rounded px-1.5 py-0.5">Obrigatório</span>}
      </label>
      {children}
    </div>
  )
}
function Cell({ k, v }: { k: string; v: string }) {
  return <div><div className="text-[10px] uppercase text-[var(--text-muted)]">{k}</div><div className="font-semibold text-white/95">{v}</div></div>
}
function Resumo({ n, l }: { n: number; l: string }) {
  return <div className="rounded-lg border border-[var(--border-default)] py-2"><div className="text-lg font-bold text-white/95">{n}</div><div className="text-[10px] text-[var(--text-secondary)]">{l}</div></div>
}
