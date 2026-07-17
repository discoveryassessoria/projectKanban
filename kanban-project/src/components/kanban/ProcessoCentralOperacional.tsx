// src/components/kanban/ProcessoCentralOperacional.tsx

"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2 } from "lucide-react"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import type { ProcessoWithStatus, Processo } from "@/src/types/kanban"
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
import type { FaseCode } from "@prisma/client"
import { FASES, phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"

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
  const faseKey = phaseKeyToFaseCode((processo as { faseAtualKey?: string | null }).faseAtualKey) ?? undefined
  const faseAtualNome =
    (faseKey ? FASES[faseKey]?.label : undefined) ??
    "Genealogia"
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

  return (
    <div className="h-full overflow-y-auto bg-gray-50/30">
      <div className="px-6 py-5">

        {/* ===== TOPO: Trilha de fases + Resumo do processo (lado a lado) ===== */}
        <div
          className="grid gap-4 items-stretch mb-4"
          style={{ gridTemplateColumns: "minmax(0,1fr) 290px" }}
        >
          <div className="min-w-0">
            <WorkflowMacroTrilha
              currentPhase={faseAtualNome}
              completedPhases={fasesConcluidas}
              phaseProgress={progressoPorFase}
            />
          </div>
          <ResumoDoProcesso
            currentPhase={faseAtualNome}
            completedPhases={fasesConcluidas}
            phaseProgress={progressoPorFase}
          />
        </div>

        {ehAnalise ? (
          <ProcessoAnalise processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : ehTraducao ? (
          <ProcessoTraducao processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : ehApostilamento ? (
          <ProcessoApostilamento processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : ehRetificacao ? (
          <ProcessoRetificacao processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : ehEmissaoRetificada ? (
          <ProcessoEmissaoRetificada processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : ehFaseFinal ? (
          <ProcessoFaseFinal processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : faseCodeGenerica ? (
          <ProcessoFaseGenerica processoId={processo.id} faseCode={faseCodeGenerica} onConcluido={() => carregar(true)} />
        ) : (
        <>
        {/* ===== Header da Central ===== */}
        <div className="mb-4">
          <h3 className="text-lg font-bold text-gray-900 tracking-tight">Central Operacional</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Fila de produção documental · todas as tarefas ativas do processo
          </p>
        </div>

        {/* ===== Central Operacional (largura cheia, sem sidebar) ===== */}
        <div className="min-w-0">
          <PainelDaFase
            faseNome={faseAtualNome}
            faseSub={data.genealogiaReestruturacao ? "" : meta.sub}
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
            modoReestruturacao={!!data.genealogiaReestruturacao}
            avisoReestruturacao={data.mensagemReestruturacao ?? undefined}
          />

          <DocumentoOperationalDrawer
            documentoId={drawerDocId}
            isOpen={drawerDocId !== null}
            onClose={() => setDrawerDocId(null)}
            onSave={() => {
              marcarAtualizando(drawerDocId)
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
      </div>
    </div>
  )
}