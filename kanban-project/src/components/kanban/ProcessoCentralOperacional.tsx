// src/components/kanban/ProcessoCentralOperacional.tsx

"use client"

import { useState, useEffect, useCallback } from "react"
import { RefreshCw, Loader2 } from "lucide-react"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import type { ProcessoWithStatus, Processo } from "@/src/types/kanban"
import { DocumentoOperationalDrawer } from "./DocumentoOperationalDrawer"
import { InitOperationModal } from "./InitOperationModal"
import { WorkflowMacroTrilha, MacroSidebar, PROCESS_PHASES } from "./WorkflowMacroTrilha"
import { PainelDaFase, type FasePersonRow, type FaseStep, type FaseKpi } from "./PainelDaFase"
import { ProcessoAnalise } from "./ProcessoAnalise"

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

interface CentralOpData {
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
    pessoaNome: string
    docType: string
    docTypeLabel: string
    status: string
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
  }>
  queueTitle: string
  schemaCapabilities: {
    hasResponsavel: boolean
    hasPrazoOperacao: boolean
    hasMotivoBloqueio: boolean
    hasUltimaMovimentacao: boolean
  }
}

interface ProcessoCentralOperacionalProps {
  processo: ProcessoWithStatus | Processo
}

// ============================================================
// Mapeia o data da rota central-operacional -> props do PainelDaFase
// ============================================================

function statusParaCls(statusLabel: string): string {
  const s = statusLabel.toLowerCase()
  if (s.includes("recebid") || s.includes("entregue") || s.includes("validad")) return "recebido"
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

  // --- 7 contadores (derivados do status genérico) ---
  const total = matrix.total
  const validados = matrix.completed
  const solicitados = queue.filter((q) => /solicit/i.test(q.status)).length
  const aguardando = queue.filter((q) => /busca/i.test(q.status)).length
  const recebidos = validados
  const conferidos = 0
  const divergentes = queue.filter((q) => /invál|inval|não enc|nao enc/i.test(q.status)).length

  const kpis: FaseKpi[] = [
    { label: "Obrigatórios", value: total },
    { label: "Validados", value: validados, tone: "ok" },
    { label: "Solicitados", value: solicitados, tone: "busca" },
    { label: "Aguardando", value: aguardando, tone: "busca" },
    { label: "Recebidos", value: recebidos },
    { label: "Conferidos", value: conferidos },
    { label: "Divergentes", value: divergentes, tone: "late" },
  ]

  // --- 5 etapas (inferidas do estado geral) ---
  const algumSolicitado = solicitados > 0 || recebidos > 0
  const algumRecebido = recebidos > 0
  const stepDefs = [
    { title: "Solicitar certidão", done: algumSolicitado },
    { title: "Aguardar retorno", done: algumRecebido },
    { title: "Receber certidão", done: algumRecebido },
    { title: "Conferir certidão", done: false },
    { title: "Validar certidão", done: validados >= total && total > 0 },
  ]
  let achouAtiva = false
  const steps: FaseStep[] = stepDefs.map((s) => {
    if (s.done) return { title: s.title, status: "concluida" as const }
    if (!achouAtiva) { achouAtiva = true; return { title: s.title, status: "em_andamento" as const } }
    return { title: s.title, status: "bloqueada" as const }
  })

  // --- tabela por pessoa ---
  const porPessoa = new Map<string, FasePersonRow>()
  const ord = (g: number) => (g === 99 ? 100 : g)

  for (const q of queue) {
    const key = q.pessoaNome
    if (!porPessoa.has(key)) {
      const iniciais = q.pessoaNome.split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase()
      const isLinha = q.isLinhaReta
      porPessoa.set(key, {
        pessoaId: q.docId,
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
          ? { txt: "Solicitar certidão", cls: "crit", semResp: true }
          : { txt: q.proximoPasso === "normal" ? "Solicitar certidão" : (q.proximoPasso || "—") },
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
      ? `Emissão documental concluída — todos os documentos validados.`
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
}: ProcessoCentralOperacionalProps) {
  const { pode } = usePermissoes()
  const [data, setData] = useState<CentralOpData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [drawerDocId, setDrawerDocId] = useState<number | null>(null)
  const [initModalDocId, setInitModalDocId] = useState<number | null>(null)

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

  useEffect(() => {
    carregar()
  }, [carregar])

  // Loading inicial
  if (loading && !data) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  // Erro fatal
  if (erro && !data) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          ⚠ {erro}
        </div>
      </div>
    )
  }

  if (!data) return null

  // ====== CÁLCULOS (ordem importa: declarar ANTES de usar) ======
  const faseAtualNome = processo.status?.nome || "Genealogia"
  const idxAtual = PROCESS_PHASES.indexOf(faseAtualNome as (typeof PROCESS_PHASES)[number])
  const fasesConcluidas = idxAtual > 0 ? PROCESS_PHASES.slice(0, idxAtual) : []
  const progressoPorFase: Record<string, number> = {}
  PROCESS_PHASES.forEach((ph, i) => {
    if (i < idxAtual) progressoPorFase[ph] = 100
    else if (i === idxAtual) progressoPorFase[ph] = data.matrix?.percentage ?? 0
    else progressoPorFase[ph] = 0
  })

  const painel = mapearPainel(data, faseAtualNome)
  const meta = FASE_META[faseAtualNome] || { sub: "", tabs: ["Resumo"] }

  // Detecta a fase de Análise Documental (tolerante a acento/caixa)
  const ehAnalise = faseAtualNome
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .includes("analise documental")

  return (
    <div className="h-full overflow-y-auto bg-gray-50/30">
      <div className="px-6 py-5">

        {/* ===== TRILHA DE FASES (topo, largura cheia) ===== */}
        <WorkflowMacroTrilha
          currentPhase={faseAtualNome}
          completedPhases={fasesConcluidas}
          phaseProgress={progressoPorFase}
        />

        {ehAnalise ? (
          /* ===== PAINEL DE ANÁLISE DOCUMENTAL ===== */
          <ProcessoAnalise processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : (
        <>
        {/* ===== Header da Central + Atualizar ===== */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900 tracking-tight">Central Operacional</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Fila de produção documental · todas as tarefas ativas do processo
            </p>
          </div>
          <button
            onClick={() => carregar(true)}
            disabled={refreshing}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {refreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Atualizar
          </button>
        </div>

        {/* ===== GRID: painel da fase + sidebar ===== */}
        <div className="grid gap-4 items-start" style={{ gridTemplateColumns: "minmax(0,1fr) 290px" }}>
          <div className="min-w-0">
            <PainelDaFase
              faseNome={faseAtualNome}
              faseSub={meta.sub}
              faseTabs={meta.tabs}
              steps={painel.steps}
              kpis={painel.kpis}
              progressoPct={painel.pct}
              progressoConcluidos={painel.validados}
              progressoTotal={painel.total}
              progressoTexto={painel.progressoTexto}
              linhaPrincipal={painel.linhaPrincipal}
              foraDaLinha={painel.foraDaLinha}
              onAbrirOperacao={(docId) => setDrawerDocId(docId)}
            />

            <DocumentoOperationalDrawer
              documentoId={drawerDocId}
              isOpen={drawerDocId !== null}
              onClose={() => setDrawerDocId(null)}
              onSave={() => carregar(true)}
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

          {/* ===== SIDEBAR (coluna direita) ===== */}
          <MacroSidebar
            currentPhase={faseAtualNome}
            completedPhases={fasesConcluidas}
            phaseProgress={progressoPorFase}
          />
        </div>
        </>
        )}
      </div>
    </div>
  )
}