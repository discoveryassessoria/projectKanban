// src/components/kanban/ProcessoCentralOperacional.tsx

"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Loader2, Eye, ArrowLeft } from "lucide-react"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { useAmbiente } from "@/src/contexts/ambiente-context"
import type { ProcessoWithStatus, Processo, OperationalProjection } from "@/src/types/kanban"
import { DocumentoOperationalDrawer } from "./DocumentoOperationalDrawer"
import { InitOperationModal } from "./InitOperationModal"
import { WorkflowMacroTrilha, ResumoDoProcesso, PROCESS_PHASES } from "./WorkflowMacroTrilha"
import { PainelDaFase, type FasePersonRow, type FaseStep, type FaseKpi } from "./PainelDaFase"
import { ProcessoAnalise } from "./ProcessoAnalise"
import { ProcessoTraducao } from "./ProcessoTraducao"
import { ProcessoFaseGenerica } from "./ProcessoFaseGenerica"
import { ProcessoApostilamento } from "./ProcessoApostilamento"
import { ProcessoFaseFinal } from "./ProcessoFaseFinal"
import { ProcessoRetificacao } from "./ProcessoRetificacao"
import { ProcessoEmissaoRetificada } from "./ProcessoEmissaoRetificada"
import { RetornarFaseButton } from "./RetornarFaseButton"
import { OperacaoAntecipadaModal } from "./OperacaoAntecipadaModal"
import { TarefaTransversalModal } from "./TarefaTransversalModal"
import type { FaseCode } from "@prisma/client"

// Metadados de uma fase materializada (espelho de /api/processos/[id]/phases).
// Operação Antecipada vinculada a uma necessidade (exibida inline no documento).
export interface OpAntecipada {
  id: number
  publicCode: string | null
  necessidadeId: number | null
  status: string
  operationType: string
  targetOperationId: number | null
  originPhaseCode: string | null
  targetPhaseCode: string | null
  objetivo: string | null
  resultadoObtido: string | null
  targetTipoDocumentoId?: number | null
  responsavel?: { id: number; nome: string | null } | null
  operacao: { statusRaw: string; statusLabel: string; concluida: boolean; uiRef: { kind: string; id: number | null; necessidadeId?: number | null } }
  aguardandoAvaliacao: boolean
  vinculavel: boolean
  encerrada: boolean
}

export interface PhaseMeta {
  phaseKey: string
  faseCode: FaseCode | null
  label: string
  ordem: number
  state: "ACTIVE" | "COMPLETED" | "FUTURE"
  materialized: boolean
  workflowInstanceId: number | null
  ciclo: number | null
  status: string | null
}
import { FASES, phaseKeyToFaseCode, faseCodeToPhaseKey } from "@/src/lib/process-stage/fases-catalog"

// Mapa label → phaseKey (a trilha emite o LABEL exato do catálogo).
const LABEL_TO_PHASEKEY: Record<string, string> = Object.fromEntries(
  Object.values(FASES).map((f) => [f.label, f.phaseKey]),
)

// ============================================================
// TIPOS (espelho do endpoint)
// ============================================================

interface MatrixByPerson {
  pessoaId: number
  nome: string
  generation: number
  completed: number
  total: number
  percentage: number
}

interface MatrixMissing {
  docId: number
  pessoaId: number
  pessoaNome: string
  docType: string
  status: string
  generation: number
}

// ✅ NOVO: espelho do bloco faseProgress da rota (estado REAL dos passos).
interface FaseProgress {
  faseCode: string | null
  kind: "documento" | "processo"
  steps: Array<{
    ordem: number
    stepKey: string
    title: string
    status: "concluida" | "em_andamento" | "bloqueada"
    concluidos: number
    total: number
  }>
  docsNaFase: number
  counts: {
    solicitados: number
    aguardando: number
    recebidos: number
    conferidos: number
    validados: number
  }
}

interface CentralOpData {
  // Modo + contexto da fase consultada (Central unificada). ausente ⇒ ACTIVE (retrocompat).
  mode?: "ACTIVE" | "PAST_READ_ONLY"
  phaseContext?: { faseCode: string | null; faseMacroKey: string | null; workflowInstanceId: number | null; ciclo: number | null }
  // Projeção operacional oficial (fonte única do percentual/estado da fase).
  projection?: OperationalProjection | null
  matrix: {
    percentage: number
    completed: number
    total: number
    directPeopleCount: number
    missingCount: number
    nameVariationsCount: number
    byPerson: MatrixByPerson[]
    missing: MatrixMissing[]
  }
  cards: {
    all: number
    pending: number
    overdue: number
    critical: number
    waiting: number
    blocked: number
    noOwner: number
    followup: number
    stale: number
  }
  queue: Array<{
    docId: number
    pessoaId?: number
    pessoaNome: string
    docType: string
    docTypeLabel: string
    status: string
    statusRaw: string
    responsavelNome: string | null
    prazo: string | null
    diasParaPrazo: number | null
    motivoBloqueio: string | null
    ultimaMovimentacao: string | null
    isCritical: boolean
    isOverdue: boolean
    isBlocked: boolean
    noOwner: boolean
    proximoPasso: string | null
    generation: number
    isLinhaReta: boolean
    necessidadeId?: number | null
    responsavelId?: number | null
  }>
  queueTitle: string
  faseProgress?: FaseProgress // ✅ NOVO (opcional: fallback cobre ausência)
  // LEGADO_INATIVO (desativação Genealogia): flag+mensagem de reestruturação.
  genealogiaReestruturacao?: boolean
  mensagemReestruturacao?: string | null
  schemaCapabilities: {
    hasResponsavel: boolean
    hasPrazoOperacao: boolean
    hasMotivoBloqueio: boolean
    hasUltimaMovimentacao: boolean
  }
}

interface ProcessoCentralOperacionalProps {
  processo: ProcessoWithStatus | Processo
  /** Chamado quando a fase ATIVA do processo muda aqui (ex.: retorno de fase),
   *  para o container (modal) invalidar Header/Drawer/Kanban. */
  onProcessoMudou?: () => void
}

// ============================================================
// Mapeia o data da rota central-operacional -> props do PainelDaFase
// ============================================================

function statusParaCls(statusLabel: string): string {
  const s = statusLabel.toLowerCase()
  // Genealogia V2: "Registro localizado" = concluído (verde, conta no progresso).
  if (s.includes("recebid") || s.includes("entregue") || s.includes("validad") || s.includes("localizado")) return "recebido"
  if (s.includes("a localizar")) return "pendente"
  if (s.includes("solicit")) return "solicitado"
  if (s.includes("busca")) return "em_busca"
  if (s.includes("invál") || s.includes("inval") || s.includes("não enc") || s.includes("nao enc")) return "bloqueado"
  if (s.includes("pendente")) return "pendente"
  return "pendente"
}

function abreviar(tipo: string): string {
  if (tipo.includes("NASCIMENTO")) return "Nasc."
  if (tipo.includes("CASAMENTO")) return "Cas."
  if (tipo.includes("OBITO")) return "Óbito"
  return "Doc."
}

function mapearPainel(data: CentralOpData, faseNome: string) {
  const queue = data.queue
  const matrix = data.matrix
  const fp = data.faseProgress

  const total = matrix.total
  const validados = matrix.completed
  const divergentes = queue.filter((q) => ["INVALIDO", "NAO_ENCONTRADO"].includes(q.statusRaw)).length

  // ============================================================
  // KPIs + 5 passos
  // ============================================================
  let kpis: FaseKpi[]
  let steps: FaseStep[]

  if (fp && fp.steps.length > 0) {
    // ✅ CAMINHO REAL: números e passos vêm do estado gravado nos WorkflowSteps
    // (fp), não mais do status do documento. Aqui é que "0 Recebidos com doc
    // recebido" e o "passo ativo errado" são corrigidos.
    const c = fp.counts
    kpis = [
      { label: "Obrigatórios", value: total },
      { label: "Validados", value: c.validados, tone: "ok" },
      { label: "Solicitados", value: c.solicitados, tone: "busca" },
      { label: "Aguardando", value: c.aguardando, tone: "busca" },
      { label: "Recebidos", value: c.recebidos },
      { label: "Conferidos", value: c.conferidos },
      { label: "Divergentes", value: divergentes, tone: "late" },
    ]
    steps = fp.steps.map((s) => ({ title: s.title, status: s.status }))
  } else {
    // FALLBACK — só entra se a rota ainda não devolveu faseProgress (ex.: janela
    // de deploy). Mantém o comportamento antigo (inferido do status do doc) pra
    // nunca ficar pior do que estava. No fluxo normal, o caminho real acima é o
    // que roda.
    const solicitados = queue.filter((q) => q.statusRaw === "SOLICITADO").length
    const aguardando = queue.filter((q) => q.statusRaw === "EM_BUSCA").length
    kpis = [
      { label: "Obrigatórios", value: total },
      { label: "Validados", value: validados, tone: "ok" },
      { label: "Solicitados", value: solicitados, tone: "busca" },
      { label: "Aguardando", value: aguardando, tone: "busca" },
      { label: "Recebidos", value: validados },
      { label: "Conferidos", value: 0 },
      { label: "Divergentes", value: divergentes, tone: "late" },
    ]
    const algumSolicitado = solicitados > 0 || validados > 0
    const algumRecebido = validados > 0
    const stepDefs = [
      { title: "Solicitar certidão", done: algumSolicitado },
      { title: "Aguardar retorno", done: algumRecebido },
      { title: "Receber certidão", done: algumRecebido },
      { title: "Conferir certidão", done: false },
      { title: "Validar certidão", done: validados >= total && total > 0 },
    ]
    let achouAtiva = false
    steps = stepDefs.map((s) => {
      if (s.done) return { title: s.title, status: "concluida" as const }
      if (!achouAtiva) { achouAtiva = true; return { title: s.title, status: "em_andamento" as const } }
      return { title: s.title, status: "bloqueada" as const }
    })
  }

  // ============================================================
  // tabela por pessoa (inalterada: mostra o status de cada documento)
  // ============================================================
  // P6 — chave por pessoaId REAL (não por nome; homônimos não colapsam). Fallback ao nome
  // só quando o back não enviou pessoaId (compat).
  const porPessoa = new Map<string | number, FasePersonRow>()
  const ord = (g: number) => (g === 99 ? 100 : g)

  for (const q of queue) {
    const key: string | number = q.pessoaId != null && q.pessoaId > 0 ? q.pessoaId : q.pessoaNome
    if (!porPessoa.has(key)) {
      const iniciais = q.pessoaNome.split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase()
      const isLinha = q.isLinhaReta
      porPessoa.set(key, {
        pessoaId: q.pessoaId ?? q.docId,
        nome: q.pessoaNome,
        iniciais,
        papel: isLinha ? "Linha reta" : "Apoio",
        geracao: isLinha ? `G${q.generation}` : "—",
        isLinha,
        transmissao: isLinha
          ? { state: "OK", label: "OK", sub: "Transmissão comprovada" }
          : { state: "FORA", label: "Fora da linha", sub: "Sem impacto na transmissão" },
        docsResumo: [],
        validados: 0,
        total: 0,
        responsavel: q.responsavelNome,
        proximaAcao: q.noOwner
          ? { txt: "Solicitar certidão", cls: "crit", semResp: true, sub: "Aguardando solicitação" }
          : { txt: q.proximoPasso === "normal" ? "Solicitar certidão" : (q.proximoPasso || "—"), sub: "Aguardando solicitação" },
        docs: [],
      })
    }
    const row = porPessoa.get(key)!
    const cls = statusParaCls(q.status)
    row.docsResumo.push({ abbr: abreviar(q.docType), statusLabel: q.status, statusCls: cls })
    row.total += 1
    if (cls === "recebido") row.validados += 1
    row.docs.push({
      id: q.docId,
      necessidadeId: q.necessidadeId ?? null,
      responsavelId: q.responsavelId ?? null,
      tipoLabel: q.docTypeLabel,
      subtitulo: "Inteiro teor",
      statusLabel: q.status.toUpperCase(),
      statusCls: cls,
      responsavel: q.responsavelNome,
      sla: q.diasParaPrazo != null ? `${q.diasParaPrazo} dias` : null,
      proximaAcao: q.proximoPasso === "normal" ? "Solicitar certidão" : q.proximoPasso,
      emissaoConcluida: cls === "recebido",
    })
  }

  const todas = Array.from(porPessoa.values())
  const linhaPrincipal = todas
    .filter((p) => p.isLinha)
    .sort((a, b) => ord(parseInt(a.geracao.replace("G", "")) || 99) - ord(parseInt(b.geracao.replace("G", "")) || 99))
  const foraDaLinha = todas.filter((p) => !p.isLinha)

  const pct = matrix.percentage
  const progressoTexto =
    validados >= total && total > 0
      ? `${faseNome} concluída — todos os documentos validados.`
      : `Solicite, receba, confira e valide cada certidão. Falta${total - validados === 1 ? "" : "m"} ${total - validados} documento${total - validados === 1 ? "" : "s"} para concluir a ${faseNome}.`

  return { kpis, steps, linhaPrincipal, foraDaLinha, pct, validados, total, progressoTexto }
}

const FASE_META: Record<string, { sub: string; tabs: string[] }> = {
  "Genealogia": { sub: "Crie a árvore, defina a linha reta e localize os documentos obrigatórios.", tabs: ["Resumo", "Árvore", "Linha reta", "Documentos gerados", "Busca documental", "Histórico"] },
  "Emissão documental": { sub: "Solicite, receba, confira e valide as certidões nos cartórios.", tabs: ["Resumo", "Documentos", "Solicitações", "Recebimentos", "Validações", "Histórico"] },
  "Análise Documental": { sub: "Compare a árvore com os documentos, avalie divergências e decida o caminho.", tabs: ["Resumo", "Divergências", "Documentos comparados", "IA & Revisão", "Decisões", "Pareceres", "Histórico"] },
  "Retificação de registros": { sub: "Execute a retificação judicial ou administrativa dos registros divergentes.", tabs: ["Resumo", "Pacotes de retificação", "Judicial / Administrativo", "Anexos", "Decisões", "Histórico"] },
  "Emissão documental retificada": { sub: "Emita novamente apenas os documentos impactados pela retificação.", tabs: ["Resumo", "Averbações", "Certidões retificadas", "Solicitações", "Validações", "Histórico"] },
  "Tradução juramentada": { sub: "Traduza a pasta documental por tradutor juramentado e valide as traduções.", tabs: ["Resumo", "Documentos", "Traduções", "Validações", "IA & Revisão", "Decisões", "Histórico"] },
  "Apostilamento": { sub: "Apostile (Haia) os documentos finais e valide a pasta apostilada.", tabs: ["Resumo", "Pasta de apostilamento", "Documentos apostilados", "Conferência", "Validações", "Histórico"] },
  "Aguardando protocolo": { sub: "Reúna o dossiê final e protocole o pedido no órgão de destino.", tabs: ["Resumo", "Pasta final", "Previsão", "Movimentações", "Protocolo", "Histórico"] },
  "Protocolado": { sub: "Acompanhe o pedido protocolado e registre a decisão do órgão.", tabs: ["Resumo", "Dados do protocolo", "Exigências", "Movimentações", "Decisões", "Histórico"] },
  "Finalizado": { sub: "Confirme o reconhecimento, entregue ao cliente e arquive o processo.", tabs: ["Resumo", "Resultado final", "Entregáveis", "Auditoria", "Arquivos finais", "Histórico"] },
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function ProcessoCentralOperacional({
  processo,
  onProcessoMudou,
}: ProcessoCentralOperacionalProps) {
  const { pode } = usePermissoes()

  // Ambiente visual: abrir/estar num processo é a FONTE mais confiável do país.
  // Mantém o país ao navegar entre as abas do processo (Central/Documentos/Árvore/
  // Financeiro do Processo). Só decora o fundo — não altera layout/dados.
  const { entrarNoProcesso } = useAmbiente()
  useEffect(() => {
    const p = processo as { id: number; pais?: string | null; codigo?: string | null; nome?: string | null; faseAtualKey?: string | null }
    entrarNoProcesso({ processoId: p.id, pais: p.pais ?? null, codigo: p.codigo ?? null, familia: p.nome ?? null, fase: p.faseAtualKey ?? null })
  }, [processo, entrarNoProcesso])
  const [data, setData] = useState<CentralOpData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [drawerDocId, setDrawerDocId] = useState<number | null>(null)
  const [initModalDocId, setInitModalDocId] = useState<number | null>(null)
  const [abrindoOperacao, setAbrindoOperacao] = useState(false)
  const [erroOperacao, setErroOperacao] = useState<string | null>(null)

  // NAVEGAÇÃO ENTRE FASES (OPERATE|VIEW). activePhaseKey = fase OPERADA (do processo);
  // selectedPhaseKey = fase CONSULTADA (clique na trilha). Independentes: consultar
  // NUNCA altera a fase ativa. selectedPhaseKey=null ⇒ segue a ativa (modo OPERATE).
  const [phases, setPhases] = useState<PhaseMeta[]>([])
  const [selectedPhaseKey, setSelectedPhaseKey] = useState<string | null>(null)

  // CENTRAL UNIFICADA (OPERATE|PAST_READ_ONLY): ao consultar uma fase PASSADA, a MESMA
  // Central carrega os DADOS VIVOS daquela fase (instância/ciclo) num fetch paralelo. O
  // corpo renderiza `viewData ?? data` — mesmo layout, só leitura. `data` (fase ATIVA)
  // segue intacto para a trilha/resumo. Nunca snapshot; sempre dados reais da instância.
  const [viewData, setViewData] = useState<CentralOpData | null>(null)
  const [viewLoading, setViewLoading] = useState(false)
  const [viewErro, setViewErro] = useState<string | null>(null)

  // Operação Antecipada: contexto (necessidade) para o modal de criação + lista por necessidade.
  const [novaOperacaoCtx, setNovaOperacaoCtx] = useState<{ necessidadeId?: number | null; pessoaId?: number | null; label?: string } | null>(null)
  // Tarefa Transversal (funcionalidade oficial e SEPARADA da Operação Antecipada).
  const [novaTransversalCtx, setNovaTransversalCtx] = useState<{ necessidadeId?: number | null; pessoaId?: number | null; label?: string } | null>(null)
  const [operacoes, setOperacoes] = useState<OpAntecipada[]>([])
  // Banner "executada antecipadamente para atender…" exibido na tela oficial (drawer) reusada.
  const [bannerAntecipada, setBannerAntecipada] = useState<string | null>(null)

  // TROCA DE CONTEXTO NO AVANÇO DE FASE: quando a fase da Central muda (avanço/retorno),
  // qualquer drawer aberto está exibindo o contexto da fase ANTIGA (ex.: o passo
  // localizar_registro da Genealogia). Fecha tudo — a Central já re-renderiza com a
  // fase nova e o drawer reabre no contexto da fase atual. Sem estado residual.
  const faseCodeRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const fc = data?.faseProgress?.faseCode
    if (fc === undefined) return // ainda carregando
    if (faseCodeRef.current !== undefined && faseCodeRef.current !== fc) {
      setDrawerDocId(null)
      setInitModalDocId(null)
      setAbrindoOperacao(false)
      setErroOperacao(null)
    }
    faseCodeRef.current = fc
  }, [data?.faseProgress?.faseCode])

  // Abre a operação. Se já há Documento (docId>0) abre direto; se for uma
  // necessidade da Genealogia V2 ainda sem Documento (docId=0), garante o
  // registro operacional no back e abre com o id real — em vez de abrir o
  // drawer com id inválido (backdrop vazio, tela travada). O loading SEMPRE
  // termina (finally) e o erro é sempre visível/fechável (nunca backdrop órfão).
  const abrirOperacao = useCallback(
    async (docId: number, necessidadeId?: number | null) => {
      if (docId && docId > 0) { setDrawerDocId(docId); return }
      if (!necessidadeId) { setErroOperacao("Operação sem documento associado. Recarregue a fase e tente novamente."); return }
      setAbrindoOperacao(true)
      setErroOperacao(null)
      // Timeout defensivo: o loading SEMPRE termina, mesmo se o servidor pendurar.
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15000)
      try {
        const res = await fetch(`/api/processos/${processo.id}/genealogia/operacao`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // MESMA autenticação usada por toda a app (Bearer authToken). Sem isso
            // o endpoint responde 401 para o usuário logado e a operação nunca abre.
            Authorization: `Bearer ${localStorage.getItem("authToken")}`,
          },
          body: JSON.stringify({ necessidadeId }),
          signal: ctrl.signal,
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok || !json?.documentoId) {
          setErroOperacao(json?.error || `Não foi possível abrir a operação (HTTP ${res.status}).`)
          return
        }
        setDrawerDocId(json.documentoId)
      } catch (e) {
        setErroOperacao(
          (e as Error)?.name === "AbortError"
            ? "A abertura da operação excedeu 15 segundos. Tente novamente."
            : "Falha de rede ao abrir a operação."
        )
      } finally {
        clearTimeout(timer)
        setAbrindoOperacao(false)
      }
    },
    [processo.id]
  )

  // Lista de funcionários para os seletores "Delegar" (carrega uma vez).
  const [usuarios, setUsuarios] = useState<Array<{ id: number; nome: string; publicCode?: string | null }>>([])
  useEffect(() => {
    fetch("/api/usuarios", { headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` } })
      .then((r) => r.json())
      .then((d) => setUsuarios((d.usuarios || d || []).map((u: { id: number; nome: string; publicCode?: string | null }) => ({ id: u.id, nome: u.nome, publicCode: u.publicCode ?? null }))))
      .catch(() => {})
  }, [])

  // Delega o passo localizar_registro de uma necessidade (fila) SEM abrir a operação
  // nem criar Documento. Grava o responsável direto no passo.
  const delegar = useCallback(
    async (necessidadeId: number, responsavelId: number | null) => {
      try {
        const res = await fetch(`/api/processos/${processo.id}/genealogia/delegar`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("authToken")}`,
          },
          body: JSON.stringify({ necessidadeId, responsavelId }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setErroOperacao(j?.error || `Não foi possível delegar (HTTP ${res.status}).`)
          return
        }
        carregar(true)
      } catch {
        setErroOperacao("Falha de rede ao delegar.")
      }
    },
    [processo.id]
  )

  const getUserId = (): number | null => {
    try {
      const stored = localStorage.getItem("user")
      if (stored) {
        const u = JSON.parse(stored)
        return u.id ?? null
      }
    } catch {}
    return null
  }

  const carregar = useCallback(
    async (modoSilencioso = false) => {
      if (!modoSilencioso) setLoading(true)
      else setRefreshing(true)
      setErro(null)

      try {
        const userId = getUserId()
        const params = new URLSearchParams({ queue: "all", sort: "priority" })
        if (userId) params.set("userId", String(userId))

        const res = await fetch(
          `/api/processos/${processo.id}/central-operacional?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("authToken")}`,
            },
          }
        )

        if (res.status === 404) {
          setErro("Endpoint /api/processos/[id]/central-operacional ainda não existe.")
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const json: CentralOpData = await res.json()
        setData(json)
      } catch (e) {
        console.warn("[ProcessoCentralOperacional] falha:", e)
        setErro("Erro ao carregar Central Operacional.")
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [processo.id]
  )

  // Lista de fases materializadas (para clicabilidade + navegação por instância).
  // Leitura pura; NUNCA materializa. Recarregada junto com a Central.
  const carregarFases = useCallback(async () => {
    try {
      const res = await fetch(`/api/processos/${processo.id}/phases`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
      })
      if (res.ok) {
        const j = await res.json()
        setPhases((j.phases ?? []) as PhaseMeta[])
      }
    } catch { /* silencioso: a trilha degrada para não-clicável */ }
  }, [processo.id])

  useEffect(() => { carregarFases() }, [carregarFases])

  // Operações antecipadas do processo — exibidas INLINE dentro do documento/necessidade a que
  // pertencem. Recarregadas junto com a Central.
  const carregarOperacoes = useCallback(async () => {
    try {
      const res = await fetch(`/api/processos/${processo.id}/operacoes-antecipadas`, { headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` } })
      if (res.ok) { const j = await res.json(); setOperacoes((j.operacoes ?? []) as OpAntecipada[]) }
    } catch { /* silencioso */ }
  }, [processo.id])
  useEffect(() => { carregarOperacoes() }, [carregarOperacoes])

  const operacoesPorNec = new Map<number, OpAntecipada[]>()
  for (const o of operacoes) {
    if (o.necessidadeId == null) continue
    const arr = operacoesPorNec.get(o.necessidadeId) ?? []
    arr.push(o); operacoesPorNec.set(o.necessidadeId, arr)
  }

  const avaliarOperacao = useCallback(async (id: number, resultado: "SIM" | "PARCIAL" | "NAO" | "CANCELAR", resultadoObtido: string, resultadoDados?: Record<string, unknown>) => {
    await fetch(`/api/operacoes-antecipadas/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("authToken")}` }, body: JSON.stringify({ resultado, resultadoObtido: resultadoObtido || null, resultadoDados: resultadoDados ?? null }) })
    await carregarOperacoes(); carregar(true)
  }, [carregarOperacoes])

  // "Abrir operação" da antecipada: reusa a MESMA tela oficial (drawer) + banner de contexto.
  const abrirOperacaoAntecipada = useCallback((op: OpAntecipada) => {
    setBannerAntecipada(op.objetivo ? `Executada antecipadamente para atender: ${op.objetivo}` : "Operação executada antecipadamente")
    void abrirOperacao(op.operacao.uiRef.id ?? 0, op.necessidadeId)
  }, [abrirOperacao])

  // Carrega a fase PASSADA consultada (dados VIVOS, escopados por instância/ciclo) na
  // MESMA rota da Central, com ?faseCode&instanceId&ciclo. selectedPhaseKey só é != null
  // quando a fase selecionada NÃO é a ativa (onSelectPhase zera ao clicar na ativa).
  const carregarView = useCallback(async (signal?: AbortSignal) => {
    if (!selectedPhaseKey) { setViewData(null); setViewErro(null); setViewLoading(false); return }
    const faseCode = phaseKeyToFaseCode(selectedPhaseKey)
    if (!faseCode) { setViewData(null); return }
    const meta = phases.find((p) => p.phaseKey === selectedPhaseKey)
    setViewLoading(true); setViewErro(null)
    try {
      const userId = getUserId()
      const params = new URLSearchParams({ queue: "all", sort: "priority", faseCode })
      if (userId) params.set("userId", String(userId))
      if (meta?.workflowInstanceId != null) params.set("instanceId", String(meta.workflowInstanceId))
      if (meta?.ciclo != null) params.set("ciclo", String(meta.ciclo))
      const res = await fetch(`/api/processos/${processo.id}/central-operacional?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
        signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: CentralOpData = await res.json()
      if (signal?.aborted) return // troca de fase mais recente venceu — descarta resposta antiga
      setViewData(json)
    } catch (e) {
      // Requisição SUPERADA (fase trocou antes de resolver): ignora silenciosamente —
      // NUNCA sobrescreve os dados/erro da consulta atual com uma resposta obsoleta.
      if (signal?.aborted || (e as Error)?.name === "AbortError") return
      console.warn("[ProcessoCentralOperacional] falha ao consultar fase:", e)
      setViewErro("Não foi possível carregar os dados desta fase.")
      setViewData(null)
    } finally {
      if (!signal?.aborted) setViewLoading(false)
    }
  }, [processo.id, selectedPhaseKey, phases])

  // Cada troca de fase ABORTA a consulta anterior — só a mais recente sobrevive (sem
  // vazamento de dados de uma fase na outra por resposta fora de ordem).
  useEffect(() => {
    const ctrl = new AbortController()
    carregarView(ctrl.signal)
    return () => ctrl.abort()
  }, [carregarView])

  // Otimista: marca o doc recém-mexido como "Atualizando…" na fila enquanto
  // a Central recarrega em 2º plano — evita a sensação de "concluí e nada mudou".
  const marcarAtualizando = useCallback((docId: number | null) => {
    if (docId == null) return
    setData((prev) =>
      prev
        ? {
            ...prev,
            queue: prev.queue.map((q) =>
              q.docId === docId ? { ...q, proximoPasso: "Atualizando…" } : q,
            ),
          }
        : prev,
    )
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  // Loading inicial
  if (loading && !data) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-white/40" />
      </div>
    )
  }

  // Erro fatal
  if (erro && !data) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="bg-[#d2a948]/12 border border-[#d2a948]/30 rounded-lg px-4 py-3 text-sm text-[#d2a948]">
          ⚠ {erro}
        </div>
      </div>
    )
  }

  if (!data) return null

  // ====== CÁLCULOS (ordem importa: declarar ANTES de usar) ======
  // FONTE DA FASE = a resposta FRESCA da rota (data.faseProgress.faseCode), que lê
  // processo.faseAtualKey do banco a cada fetch. O prop `processo` é estático e NÃO
  // reflete o avanço — usá-lo mantinha a Central presa na Genealogia após avançar.
  // Fallback ao prop só cobre o 1º render antes de `data` chegar.
  // FASE ATIVA (trilha + resumo) — SEMPRE de `data`. Consultar fase passada NUNCA altera.
  const faseCodeAtiva = (data?.faseProgress?.faseCode ?? undefined) as FaseCode | undefined
  const faseKeyAtiva =
    faseCodeAtiva ??
    phaseKeyToFaseCode((processo as { faseAtualKey?: string | null }).faseAtualKey) ??
    undefined
  const faseAtivaNome = (faseKeyAtiva ? FASES[faseKeyAtiva]?.label : undefined) ?? "Genealogia"
  const idxAtual = PROCESS_PHASES.indexOf(faseAtivaNome as (typeof PROCESS_PHASES)[number])
  const fasesConcluidas = idxAtual > 0 ? PROCESS_PHASES.slice(0, idxAtual) : []
  // Percentual da fase ATIVA = projeção oficial (mesmo % do Kanban/Header). Fases
  // concluídas = 100, futuras = 0. Nenhum recálculo local.
  const pctFaseAtual = data.projection?.progress.percentage ?? data.matrix?.percentage ?? 0
  const progressoPorFase: Record<string, number> = {}
  PROCESS_PHASES.forEach((ph, i) => {
    if (i < idxAtual) progressoPorFase[ph] = 100
    else if (i === idxAtual) progressoPorFase[ph] = pctFaseAtual
    else progressoPorFase[ph] = 0
  })
  const activePhaseKey = faseKeyAtiva ? faseCodeToPhaseKey(faseKeyAtiva) : null

  // FASE CONSULTADA (corpo) — `viewData` (passada) ou `data` (ativa). MESMO layout;
  // PAST_READ_ONLY só bloqueia mutações. Dados VIVOS da instância/ciclo (nunca snapshot).
  // isView = INTENÇÃO (fase selecionada ≠ ativa), NÃO "viewData chegou". Assim, durante o
  // loading/erro do fetch da fase passada a Central JÁ está em modo consulta (readOnly +
  // spinner/erro) — nunca expõe o painel EDITÁVEL da fase ativa por engano.
  const isView = !!selectedPhaseKey && selectedPhaseKey !== activePhaseKey
  const bodyData = (isView ? viewData : data) ?? data
  const readOnly = isView || bodyData.mode === "PAST_READ_ONLY"
  const faseCodeData = (bodyData?.faseProgress?.faseCode ?? undefined) as FaseCode | undefined
  const faseKey =
    faseCodeData ??
    (selectedPhaseKey ? phaseKeyToFaseCode(selectedPhaseKey) ?? undefined : undefined) ??
    faseKeyAtiva ??
    undefined
  const faseAtualNome =
    (faseKey ? FASES[faseKey]?.label : undefined) ??
    "Genealogia"

  const painel = mapearPainel(bodyData, faseAtualNome)
  const meta = FASE_META[faseAtualNome] || { sub: "", tabs: ["Resumo"] }

  // Detecta a fase de Análise Documental (tolerante a acento/caixa)
  const ehAnalise = faseAtualNome
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .includes("analise documental")

  const ehTraducao = faseAtualNome
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .includes("traducao juramentada")

  const ehApostilamento = faseAtualNome
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .includes("apostilamento")

  const ehFaseFinal = ["aguardando protocolo", "protocolado", "finalizado"].some((nome) =>
    faseAtualNome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(nome)
  )

  // Fases por-processo (checklist + avançar). Mapeia nome → faseCode (tolerante a acento/caixa).
  const FASE_CODE_POR_NOME: Record<string, FaseCode> = {
    "retificacao de registros": "RETIFICACAO_REGISTROS",
    "emissao documental retificada": "EMISSAO_DOCUMENTAL_RETIFICADA",
    "traducao juramentada": "TRADUCAO_JURAMENTADA",
    "apostilamento": "APOSTILAMENTO",
    "aguardando protocolo": "AGUARDANDO_PROTOCOLO",
    "protocolado": "PROTOCOLADO",
    "finalizado": "FINALIZADO",
  }
  const faseNorm = faseAtualNome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
  const faseCodeGenerica: FaseCode | undefined = FASE_CODE_POR_NOME[faseNorm]
  const ehRetificacao = faseNorm.includes("retificacao de registros")
  const ehEmissaoRetificada = faseNorm.includes("emissao documental retificada")

  // ====== TRILHA: realce da fase selecionada + metadados do modo consulta ======
  // (activePhaseKey/isView/readOnly j\u00e1 declarados acima). selectedKey = fase real\u00e7ada.
  const selectedKey = selectedPhaseKey ?? activePhaseKey
  const selectedFaseCode = selectedKey ? phaseKeyToFaseCode(selectedKey) : null
  const selectedLabel = selectedFaseCode ? FASES[selectedFaseCode].label : undefined
  const selectedPhaseMeta: PhaseMeta | null =
    (isView && selectedKey)
      ? (phases.find((p) => p.phaseKey === selectedKey) ?? {
          // Fallback quando a rota /phases ainda n\u00e3o respondeu: metadados m\u00ednimos.
          phaseKey: selectedKey, faseCode: selectedFaseCode, label: selectedLabel ?? selectedKey,
          ordem: selectedFaseCode ? FASES[selectedFaseCode].ordem : 0,
          state: (selectedFaseCode && faseKeyAtiva && FASES[selectedFaseCode].ordem < FASES[faseKeyAtiva].ordem
            ? "COMPLETED" : "FUTURE") as PhaseMeta["state"],
          materialized: false, workflowInstanceId: null, ciclo: null, status: null,
        })
      : null

  const onSelectPhase = (label: string) => {
    const pk = LABEL_TO_PHASEKEY[label]
    if (!pk) return
    // Selecionar a fase ativa volta para OPERATE; qualquer outra entra em consulta (VIEW).
    setSelectedPhaseKey(pk === activePhaseKey ? null : pk)
  }

  return (
    <div className="h-full overflow-y-auto bg-[#15191f]">
      <div className="px-6 py-5">

        {/* ===== TOPO: Trilha de fases + Resumo do processo (lado a lado) ===== */}
        <div className="flex flex-col gap-4 mb-4">
          <div className="min-w-0">
            <WorkflowMacroTrilha
              currentPhase={faseAtivaNome}
              completedPhases={fasesConcluidas}
              phaseProgress={progressoPorFase}
              selectedPhase={selectedLabel}
              onSelectPhase={onSelectPhase}
            />
          </div>
          <ResumoDoProcesso
            currentPhase={faseAtivaNome}
            completedPhases={fasesConcluidas}
            phaseProgress={progressoPorFase}
          />
        </div>

        {/* Botões "Nova tarefa transversal" / "Nova operação antecipada" removidos da barra
            da Central Operacional (a pedido). A operação antecipada segue acessível por
            necessidade/pessoa dentro do painel da fase. */}


        {/* ===== Cabeçalho do MODO CONSULTA (fase passada) — MESMA casca, só leitura ===== */}
        {isView && (
          <div className="mb-4 flex items-start justify-between gap-4 flex-wrap bg-[#d2a948]/12 border border-[#d2a948]/30 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold px-3 py-1 rounded-full bg-[#d2a948]/15 text-[#d2a948]">
                <Eye className="w-3.5 h-3.5" /> Somente leitura
              </span>
              <span className="text-[13px] font-semibold text-white/80">
                {selectedPhaseMeta?.state === "FUTURE" ? "Fase futura · ainda não iniciada"
                  : `Fase concluída${selectedPhaseMeta?.ciclo ? ` · Ciclo ${selectedPhaseMeta.ciclo}` : ""}`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedPhaseKey(null)}
                className="inline-flex items-center gap-1.5 border-[1.5px] border-white/10 bg-[#1b2027] text-white/80 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg hover:border-white/20 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Voltar à fase ativa
              </button>
              {pode("workflow.retornarFase") && selectedPhaseMeta?.state === "COMPLETED" && selectedKey && (
                <RetornarFaseButton
                  processoId={processo.id}
                  faseKey={selectedKey}
                  faseLabel={selectedLabel ?? selectedKey}
                  onRetornou={() => {
                    setSelectedPhaseKey(null)
                    carregar(true)
                    carregarFases()
                    onProcessoMudou?.()
                  }}
                />
              )}
            </div>
          </div>
        )}

        {/* CONSULTA (fase passada): sempre o corpo GENÉRICO da Central com dados VIVOS e
            ESCOPADOS da instância (bodyData). Os painéis bespoke por-fase buscam a fase
            ATIVA (não escopam) — por isso só aparecem no modo ACTIVE, garantindo que
            NENHUM dado da fase ativa vaze na consulta de fase passada. */}
        {isView && !viewData ? (
          // Consultando fase passada e os dados ainda NÃO chegaram (loading/erro): mostra
          // spinner/erro — NUNCA o corpo, que cairia nos dados da fase ativa.
          viewErro
            ? <div className="bg-[#d2a948]/12 border border-[#d2a948]/30 rounded-lg px-4 py-3 text-sm text-[#d2a948]">⚠ {viewErro}</div>
            : <div className="flex items-center justify-center py-16 text-white/40"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : !isView && ehAnalise ? (
          <ProcessoAnalise processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : !isView && ehTraducao ? (
          <ProcessoTraducao processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : !isView && ehApostilamento ? (
          <ProcessoApostilamento processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : !isView && ehRetificacao ? (
          <ProcessoRetificacao processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : !isView && ehEmissaoRetificada ? (
          <ProcessoEmissaoRetificada processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : !isView && ehFaseFinal ? (
          <ProcessoFaseFinal processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : !isView && faseCodeGenerica ? (
          <ProcessoFaseGenerica processoId={processo.id} faseCode={faseCodeGenerica} onConcluido={() => carregar(true)} />
        ) : (
        <>
        {/* ===== Header da Central ===== */}
        <div className="mb-4">
          <h3 className="text-lg font-bold text-white/95 tracking-tight">Central Operacional</h3>
          <p className="text-xs text-white/55 mt-0.5">
            Fila de produção documental · todas as tarefas ativas do processo
          </p>
        </div>

        {/* ===== Central Operacional (largura cheia, sem sidebar) ===== */}
        <div className="min-w-0">
          <PainelDaFase
            faseNome={faseAtualNome}
            faseSub={bodyData.genealogiaReestruturacao ? "" : meta.sub}
            faseTabs={meta.tabs}
            steps={painel.steps}
            kpis={painel.kpis}
            progressoPct={painel.pct}
            progressoConcluidos={painel.validados}
            progressoTotal={painel.total}
            progressoTexto={painel.progressoTexto}
            linhaPrincipal={painel.linhaPrincipal}
            foraDaLinha={painel.foraDaLinha}
            readOnly={readOnly}
            onAbrirOperacao={readOnly ? undefined : (docId, necessidadeId) => { setBannerAntecipada(null); void abrirOperacao(docId, necessidadeId) }}
            usuarios={usuarios}
            onDelegar={readOnly ? undefined : (necessidadeId, responsavelId) => { void delegar(necessidadeId, responsavelId) }}
            onNovaOperacao={readOnly ? undefined : (necessidadeId, pessoaIdNec, label) => setNovaOperacaoCtx({ necessidadeId, pessoaId: pessoaIdNec, label })}
            operacoesPorNec={operacoesPorNec}
            onAvaliarOperacao={readOnly ? undefined : avaliarOperacao}
            onAbrirOperacaoAntecipada={readOnly ? undefined : abrirOperacaoAntecipada}
            modoReestruturacao={!!bodyData.genealogiaReestruturacao}
            avisoReestruturacao={bodyData.mensagemReestruturacao ?? undefined}
          />

          {abrindoOperacao && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20">
              <div className="rounded-md bg-[#1b2027] px-4 py-2 text-sm text-white/80 shadow">Abrindo operação…</div>
            </div>
          )}

          {erroOperacao && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30" onClick={() => setErroOperacao(null)}>
              <div className="max-w-sm rounded-lg bg-[#1b2027] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="text-sm font-semibold text-white/95 mb-1">Não foi possível abrir a operação</div>
                <div className="text-sm text-white/68 mb-4">{erroOperacao}</div>
                <div className="flex justify-end">
                  <button onClick={() => setErroOperacao(null)} className="px-3 py-1.5 text-sm font-medium rounded-md bg-[#252c35] hover:bg-[#252c35] text-white/95">Fechar</button>
                </div>
              </div>
            </div>
          )}

          <DocumentoOperationalDrawer
            // key inclui a FASE ATUAL + doc: ao trocar de fase (ou documento) o drawer
            // é DESMONTADO e REMONTADO — zera estado interno (doc/workflow/aba/loading),
            // sem herdar nada da fase anterior.
            key={`${faseCodeData ?? "?"}-${drawerDocId ?? "none"}`}
            documentoId={drawerDocId}
            isOpen={drawerDocId !== null}
            bannerAntecipada={bannerAntecipada}
            onClose={() => { setDrawerDocId(null); setBannerAntecipada(null) }}
            onSave={() => {
              marcarAtualizando(drawerDocId)
              carregarOperacoes()
              carregar(true)
            }}
          />

          <InitOperationModal
            documentoId={initModalDocId}
            isOpen={initModalDocId !== null}
            onClose={() => setInitModalDocId(null)}
            onSuccess={() => {
              setInitModalDocId(null)
              carregar(true)
            }}
          />
        </div>
        </>
        )}

        {novaOperacaoCtx && (
          <OperacaoAntecipadaModal
            processoId={processo.id}
            necessidadeId={novaOperacaoCtx.necessidadeId}
            necessidadeLabel={novaOperacaoCtx.label}
            pessoaId={novaOperacaoCtx.pessoaId}
            faseAtivaCode={faseKeyAtiva ? String(faseKeyAtiva) : null}
            usuarios={usuarios}
            onClose={() => setNovaOperacaoCtx(null)}
            onCreated={() => { setNovaOperacaoCtx(null); carregarOperacoes(); carregar(true) }}
          />
        )}

        {novaTransversalCtx && (
          <TarefaTransversalModal
            processoId={processo.id}
            necessidadeId={novaTransversalCtx.necessidadeId}
            necessidadeLabel={novaTransversalCtx.label}
            pessoaId={novaTransversalCtx.pessoaId}
            usuarios={usuarios}
            onClose={() => setNovaTransversalCtx(null)}
            onCreated={() => { setNovaTransversalCtx(null); carregar(true) }}
          />
        )}
      </div>
    </div>
  )
}