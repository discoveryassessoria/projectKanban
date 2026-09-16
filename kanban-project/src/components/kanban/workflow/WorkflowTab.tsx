// src/components/kanban/workflow/WorkflowTab.tsx
"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useApi } from "@/src/lib/dados"
import {
  Check,
  Circle,
  Play,
  Loader2,
  ChevronRight,
  Lock,
} from "lucide-react"
import { CentralDaEtapaDrawer } from "./CentralDaEtapaDrawer"
import { WorkflowControls } from "../WorkflowControls"
import { OperacoesAntecipadasInline, type OpAntecipadaInline, type ResultadoAvaliacaoUI } from "./OperacaoAntecipadaPainel"
import { OperacaoAntecipadaModal } from "../OperacaoAntecipadaModal"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import type { SubtarefaProjetada } from "./useConfiguracaoDaEtapa"

// ============================================================
// HELPER — pega userId logado do localStorage (mesmo padrão do
// DocumentoOperationalDrawer / CentralDaEtapaDrawer)
// ============================================================

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

// ============================================================
// TIPOS
// ============================================================

type StatusStep =
  | "nao_iniciada"
  | "bloqueada"
  | "em_andamento"
  | "aguardando_terceiro"
  | "atrasada"
  | "concluida"
  | "cancelada"

interface UserRef {
  id: number
  nome: string
  email: string
}

interface WorkflowStep {
  id: number
  ordem: number
  stepKey: string
  title: string
  description: string | null
  status: StatusStep
  weight: number
  ownerKey: string | null
  assigneeId: number | null
  assignee: UserRef | null
  startedAt: string | null
  dueAt: string | null
  completedAt: string | null
  completedById: number | null
  completedBy: UserRef | null
  motivoBloqueio: string | null
  notes: string | null
  slaDays: number
  trackingCode: string | null
  externalProtocol: string | null
  /** Vem JUNTO nesta mesma resposta agora — nunca mais uma segunda chamada
   *  separada só para saber se o passo tem subtarefas (ver montarWorkflowV2). */
  subtarefas?: SubtarefaProjetada[]
}

interface Workflow {
  id: number
  documentoId: number
  templateCode: string
  templateName: string
  status: string
  progress: number
  startedAt: string
  completedAt: string | null
  steps: WorkflowStep[]
}

/**
 * Contexto para a OPERAÇÃO ANTECIPADA deste documento. Ela pertence ao ALVO (a
 * necessidade documental), e o alvo só é conhecido por quem abriu o documento —
 * por isso chega de fora, por ID, nunca resolvido por texto aqui dentro.
 *
 * Ausente ⇒ a aba não exibe operação antecipada (ex.: documento sem necessidade).
 */
export interface ContextoAntecipada {
  processoId: number
  necessidadeId: number | null
  pessoaId: number | null
  faseAtivaCode: string | null
  usuarios: Array<{ id: number; nome: string; publicCode?: string | null }>
  /** Abre a operação-ALVO da antecipada na tela oficial (o mesmo drawer). */
  onAbrirOperacaoAlvo?: (documentoId: number, necessidadeId: number | null, objetivo: string | null) => void
  readOnly?: boolean
}

interface WorkflowTabProps {
  documentoId: number
  onChange?: () => void
  contextoAntecipada?: ContextoAntecipada
  /**
   * Responsabilidade pertence à TAREFA (contrato canônico), não ao passo — o
   * `assignee` do passo é só "quem costuma executar" (ver comentário em
   * `StepCard`). É contra ESTE id que o botão "Iniciar" de cada passo é
   * travado: sem tarefa atribuída a este usuário, não há o que iniciar aqui.
   */
  tarefaResponsavelId?: number | null
  tarefaResponsavelNome?: string | null
  /**
   * A INSTÂNCIA DA FASE sendo exibida (ativa ou "Somente leitura" de uma fase
   * passada) — mesmo contrato do `faseInstanciaId` do DocumentoOperationalDrawer.
   * Sem isto, esta aba (que busca por conta própria, em `/documentos/[id]/workflow`)
   * sempre mostrava "onde o trabalho está agora", mesmo consultando uma fase
   * passada — a causa real do drawer mostrando Emissão Documental dentro da
   * consulta de Genealogia (achado real, 16/09/2026).
   */
  faseInstanciaId?: number | null
}

// ============================================================
// HELPERS
// ============================================================

const LOCK_STEP_PREFIX = "Aguardando outros documentos do processo"

const OWNERS_MAP: Record<string, string> = {
  equipe_documental: "Equipe Documental",
  daniela_brait: "Daniela Brait",
  marco_rovatti: "Marco Rovatti",
  sistema: "Sistema",
}

const ownerName = (key: string | null): string => {
  if (!key) return "—"
  return OWNERS_MAP[key] || key
}

const ownerColor = (key: string | null): string => {
  if (!key) return "#4e6879"
  if (key.includes("daniela")) return "#ec4899"
  if (key.includes("marco")) return "#4f91c5"
  if (key.includes("equipe")) return "#10b981"
  return "#4e6879"
}

const fmtDateTime = (iso: string | null): string => {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

const fmtSla = (dueAt: string | null) => {
  if (!dueAt) return { label: "no prazo", cls: "text-green-800 bg-[var(--surface-secondary)]" }
  const diff = (new Date(dueAt).getTime() - Date.now()) / 86400000
  if (diff < -5) return { label: `${Math.abs(Math.floor(diff))}d crítico`, cls: "text-red-700 bg-[var(--surface-secondary)]" }
  if (diff < 0) return { label: `${Math.abs(Math.floor(diff))}d atrasado`, cls: "text-amber-800 bg-[var(--surface-secondary)]" }
  if (diff < 1) return { label: "vence hoje", cls: "text-amber-800 bg-[var(--surface-secondary)]" }
  return { label: `${Math.ceil(diff)} dia(s)`, cls: "text-green-800 bg-[var(--surface-secondary)]" }
}

const STATUS_LABEL: Record<StatusStep, string> = {
  nao_iniciada: "Não iniciada",
  bloqueada: "Bloqueada",
  em_andamento: "Em execução",
  aguardando_terceiro: "Aguardando terceiro",
  atrasada: "Atrasada",
  concluida: "Concluída",
  cancelada: "Cancelada",
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function WorkflowTab({
  documentoId,
  onChange,
  contextoAntecipada,
  tarefaResponsavelId = null,
  tarefaResponsavelNome = null,
  faseInstanciaId = null,
}: WorkflowTabProps) {
  // fase atual não tem Workflow Interno configurado (nunca cai no de outra fase)

  const { isAdmin, pode } = usePermissoes()
  const currentUserId = getUserId()
  // A MESMA regra que o servidor aplica em `carregarPassoAutorizado`, só que
  // antes do clique: sem tarefa atribuída a alguém, ou atribuída a outra
  // pessoa, "Iniciar" não é uma ação real — é um convite a um 403.
  const podeIniciarEtapas =
    isAdmin || (tarefaResponsavelId != null && tarefaResponsavelId === currentUserId)

  // ✅ NOVO: stepId aberto na Central da Etapa (drawer empilhado)
  const [centralStepId, setCentralStepId] = useState<number | null>(null)
  // QUAL SUBTAREFA foi clicada — quando o passo se decompõe em subtarefas, é
  // ela (não "a primeira pendente") que decide qual editor abre. Achado real:
  // 15/09/2026 — clicar em "2. Aguardar retorno do cartório" abria sempre o
  // editor de "Solicitar certidão" porque nada identificava QUAL das 4 linhas
  // foi clicada; a Central da Etapa recebia só o stepId (o mesmo para as 4).
  const [centralSubtarefaKey, setCentralSubtarefaKey] = useState<string | null>(null)

  // OPERAÇÃO ANTECIPADA deste ALVO. Vive AQUI, no modal do documento — nunca na
  // listagem principal da Central, que é índice e não executor.
  const necId = contextoAntecipada?.necessidadeId ?? null
  const opsReq = useApi<{ operacoes?: OpAntecipadaInline[] }>(
    contextoAntecipada ? `/api/processos/${contextoAntecipada.processoId}/operacoes-antecipadas` : null,
  )
  // Filtra pela NECESSIDADE deste documento: a operação antecipada de outro alvo não
  // é assunto desta tela.
  const opsDoAlvo = (opsReq.dados?.operacoes ?? []).filter((o) => necId != null && o.necessidadeId === necId)
  const [criandoAntecipada, setCriandoAntecipada] = useState(false)

  // O PASSO ATUAL APARECE SEM NINGUÉM PROCURAR.
  //
  // O painel abre listando o workflow inteiro, e num documento de cinco etapas
  // isso ainda cabe na tela; num de doze, não. Quem clicou em "Continuar" quer
  // continuar de ONDE ESTÁ — não ler o histórico até achar o cartão azul.
  const passoAtual = useRef<HTMLDivElement | null>(null)

  const avaliarAntecipada = useCallback(
    async (id: number, resultado: ResultadoAvaliacaoUI, resultadoObtido: string, resultadoDados?: Record<string, unknown>) => {
      await fetch(`/api/operacoes-antecipadas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("authToken")}` },
        body: JSON.stringify({ resultado, resultadoObtido: resultadoObtido || null, resultadoDados: resultadoDados ?? null }),
      })
      await opsReq.recarregar()
      onChange?.()
    },
    [opsReq, onChange],
  )

  // -- Carrega o workflow
  // Leitura pela camada oficial: o token e o tratamento de erro deixam de ser
  // montados aqui à mão. A mensagem exibida continua a mesma de antes.
  const consulta = useApi<{ workflow?: Workflow | null; semWorkflowInterno?: boolean }>(
    `/api/documentos/${documentoId}/workflow${faseInstanciaId != null ? `?workflowInstanceId=${faseInstanciaId}` : ""}`,
  )
  const workflow = consulta.dados?.workflow ?? null
  const semWorkflowInterno = consulta.dados?.semWorkflowInterno === true
  const loading = consulta.carregando
  const erro = consulta.erro ? "Erro ao carregar workflow." : null
  const carregar = consulta.recarregar

  // O foco só existe DEPOIS que a lista chegou: no primeiro render ainda é o
  // esqueleto de carregamento, e não há cartão nenhum para trazer à vista.
  useEffect(() => {
    if (!workflow) return
    passoAtual.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [workflow])

  // "Iniciar operação" manual foi removido do fluxo: o backend materializa a operação
  // da fase atual automaticamente ao carregar o workflow (garantirOperacaoDocumentoV2).

  // -- Render

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--text-secondary)]" />
      </div>
    )
  }

  if (erro) {
    return (
      <div className="px-1 py-6">
        <div className="bg-[var(--surface-secondary)] border border-red-800 rounded-lg px-4 py-3 text-sm text-red-700">
          ⚠ {erro}
        </div>
      </div>
    )
  }

  // -- Sem workflow (o backend já materializa automaticamente ao abrir; se ainda assim
  //    não há workflow, é porque a FASE ATUAL não tem Workflow Interno configurado —
  //    mensagem controlada, NUNCA workflow de outra fase, sem "Iniciar operação").
  if (!workflow) {
    if (semWorkflowInterno) {
      return (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="w-12 h-12 rounded-full bg-[var(--text-muted)] border border-[var(--border-default)] flex items-center justify-center mb-4">
            <Circle className="w-5 h-5 text-[var(--text-secondary)]" />
          </div>
          <h4 className="text-white font-semibold text-sm mb-1.5">Sem Workflow Interno</h4>
          <p className="text-xs text-[var(--text-secondary)] max-w-xs">
            Não existe Workflow Interno configurado para esta fase.
          </p>
        </div>
      )
    }
    // Estado transitório/edge (materialização não retornou workflow por outro motivo):
    // recarregar, sem reiniciar operação nem usar fallback de outra fase.
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <div className="w-12 h-12 rounded-full bg-[var(--text-muted)] border border-[var(--border-default)] flex items-center justify-center mb-4">
          <Circle className="w-5 h-5 text-[var(--text-secondary)]" />
        </div>
        <h4 className="text-white font-semibold text-sm mb-1.5">Não foi possível carregar as etapas</h4>
        <p className="text-xs text-[var(--text-secondary)] max-w-xs mb-5">
          Recarregue para tentar montar a operação desta fase.
        </p>
        <button
          onClick={() => { void carregar() }}
          className="px-4 py-2 bg-[var(--action-primary)] hover:bg-[var(--action-primary)] text-[var(--action-primary-ink)] text-xs font-semibold rounded-md inline-flex items-center gap-1.5"
        >
          ↻ Recarregar
        </button>
      </div>
    )
  }

  // -- Render do workflow
  const totalWeightSteps = workflow.steps.reduce((s, x) => s + x.weight, 0)
  const doneWeightSteps = workflow.steps
    .filter((x) => x.status === "concluida")
    .reduce((s, x) => s + x.weight, 0)
  const doneCountSteps = workflow.steps.filter((s) => s.status === "concluida").length

  // QUANDO O PASSO TEM SUBTAREFAS, "ETAPAS" SÃO ELAS — não o Step único que as
  // contém. Achado real: 15/09/2026 — "1 etapas · 0/25 pontos" para um passo
  // com 4 subtarefas cadastradas escondia o que de fato existe pra fazer.
  // Vêm no PRÓPRIO `workflow.steps[0].subtarefas` agora — mesma resposta,
  // sem segunda chamada e sem janela de corrida onde ainda não se sabe se
  // tem subtarefa.
  const subtarefasDoTopo = workflow.steps[0]?.subtarefas ?? []
  const temSubtarefasNoTopo = subtarefasDoTopo.length > 0
  const etapasTotal = temSubtarefasNoTopo ? subtarefasDoTopo.length : workflow.steps.length
  const etapasConcluidas = temSubtarefasNoTopo
    ? subtarefasDoTopo.filter((s) => s.concluida).length
    : doneCountSteps
  const totalWeight = totalWeightSteps
  const doneWeight = temSubtarefasNoTopo
    ? Math.round((totalWeightSteps * etapasConcluidas) / etapasTotal)
    : doneWeightSteps
  const pctExibido = temSubtarefasNoTopo
    ? Math.round((100 * etapasConcluidas) / etapasTotal)
    : workflow.progress

  return (
    <div className="space-y-4">

      {/* ============== HEADER — progresso + ações (pausar/cancelar/invalidar) num
          card só. Era dois cards empilhados dizendo a mesma coisa (achado real,
          16/09/2026): este aqui (etapas/pontos) e o WorkflowControls do drawer
          (título/%/iniciado em/botões). Fundidos num único componente. ============== */}
      <WorkflowControls
        documentoId={workflow.documentoId}
        workflow={{ id: workflow.id, status: workflow.status, progress: pctExibido, startedAt: workflow.startedAt }}
        onChange={() => { void carregar() }}
        podeBloquear={pode("tarefas.bloquear")}
        podeExcluir={pode("tarefas.excluir")}
        titulo={workflow.templateName}
        etapasTotal={etapasTotal}
        etapasConcluidas={etapasConcluidas}
        pontosFeitos={doneWeight}
        pontosTotal={totalWeight}
      />

      {/* ============== LISTA DE STEPS ==============
          TODOS os passos do workflow deste documento, na ordem publicada. O filtro
          que escondia "bloqueada sem motivo" e "não iniciada" saiu: com a execução
          concentrada aqui, esconder os passos futuros deixava o operador sem ver o
          caminho do documento — e a Central, que era onde ele via, virou índice. */}
      <div className="space-y-2">
        {workflow.steps.map((step) => (
          <StepOuSubtarefas
            key={step.id}
            step={step}
            onOpenCentral={(subtarefaKey) => {
              setCentralStepId(step.id)
              setCentralSubtarefaKey(subtarefaKey ?? null)
            }}
            refDoAtual={(el) => { if (el) passoAtual.current = el }}
            podeIniciar={podeIniciarEtapas}
            tarefaResponsavelNome={tarefaResponsavelNome}
            isAdmin={isAdmin}
            onRecarregar={carregar}
          />
        ))}
      </div>

      {/* ============== OPERAÇÃO ANTECIPADA ==============
          Capacidade nativa preservada INTEIRA (criar, listar, avaliar, abrir). Ela
          pertence ao ALVO deste documento e só existe aqui dentro. */}
      {contextoAntecipada && necId != null && (
        <div className="border border-[var(--border-default)] rounded-lg bg-[var(--surface-secondary)]/[0.05] px-3 py-3">
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <b className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--text-secondary)]">
              Operação antecipada
            </b>
            {!contextoAntecipada.readOnly && (
              <button
                type="button"
                onClick={() => setCriandoAntecipada(true)}
                className="text-[11px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-secondary)] underline decoration-dotted underline-offset-2"
              >
                + nova operação antecipada
              </button>
            )}
          </div>
          {opsDoAlvo.length === 0 ? (
            <div className="text-[11.5px] text-[var(--text-muted)]">
              Nenhuma operação antecipada para este documento.
            </div>
          ) : (
            <OperacoesAntecipadasInline
              ops={opsDoAlvo}
              readOnly={contextoAntecipada.readOnly}
              onAvaliar={contextoAntecipada.readOnly ? undefined : avaliarAntecipada}
              onAbrir={
                contextoAntecipada.onAbrirOperacaoAlvo
                  ? (op) => contextoAntecipada.onAbrirOperacaoAlvo!(op.operacao.uiRef.id ?? 0, op.necessidadeId, op.objetivo)
                  : undefined
              }
            />
          )}
        </div>
      )}

      {criandoAntecipada && contextoAntecipada && necId != null && (
        <OperacaoAntecipadaModal
          processoId={contextoAntecipada.processoId}
          necessidadeId={necId}
          necessidadeLabel={workflow.templateName}
          pessoaId={contextoAntecipada.pessoaId}
          faseAtivaCode={contextoAntecipada.faseAtivaCode}
          usuarios={contextoAntecipada.usuarios}
          onClose={() => setCriandoAntecipada(false)}
          onCreated={() => { setCriandoAntecipada(false); void opsReq.recarregar(); onChange?.() }}
        />
      )}

      {/* ============== CENTRAL DA ETAPA (drawer empilhado) ============== */}
      <CentralDaEtapaDrawer
        documentoId={documentoId}
        stepId={centralStepId}
        subtarefaKey={centralSubtarefaKey}
        isOpen={centralStepId !== null}
        onClose={() => {
          setCentralStepId(null)
          setCentralSubtarefaKey(null)
        }}
        onUpdate={() => {
          carregar()
          onChange?.()
        }}
      />

    </div>
  )
}

// ============================================================
// STEP QUE SE DECOMPÕE EM SUBTAREFAS — mostra AS SUBTAREFAS, não o passo.
// ============================================================
//
// Achado real (15/09/2026, testando o processo Teste): a arquitetura final da
// Emissão Documental é 1 Tarefa → 1 Passo → 4 subtarefas ("enviar
// requerimento", "aguardar retorno", "receber certidão", "conferir e
// validar"). Cadastradas assim no Gerenciamento — mas esta lista mostrava só
// o PASSO ("1. Solicitar certidão"), escondendo as 4 subtarefas dentro de um
// card só. O operador via progresso, mas não via O QUE estava concluído e o
// que faltava sem abrir a Central da Etapa e adivinhar. Sem subtarefas
// cadastradas (passo anterior à consolidação), cai no StepCard de sempre.

function StepOuSubtarefas({
  step, onOpenCentral, refDoAtual, podeIniciar, tarefaResponsavelNome, isAdmin, onRecarregar,
}: {
  step: WorkflowStep
  onOpenCentral: (subtarefaKey?: string) => void
  refDoAtual?: (el: HTMLDivElement | null) => void
  podeIniciar: boolean
  tarefaResponsavelNome?: string | null
  isAdmin: boolean
  onRecarregar: () => void
}) {
  // SEM FETCH PRÓPRIO — `step.subtarefas` já chega pronto na MESMA resposta
  // de `/api/documentos/[id]/workflow` (ver montarWorkflowV2). Antes disto
  // havia uma segunda chamada aqui (`useConfiguracaoDaEtapa`), e a corrida
  // entre ela e o primeiro paint fazia a lista de subtarefas sumir por alguns
  // segundos em processos novos — parecia bug, era só uma resposta que ainda
  // não tinha voltado. Sem segunda chamada, sem corrida.
  const subtarefas = step.subtarefas ?? []

  // Achado real (16/09/2026): esconder as subtarefas de um passo CONCLUÍDO
  // (o `!isActive` original) deixava "ver o que aconteceu" impossível sem
  // adivinhar — o passo virava uma linha cinza sem nada clicável, mesmo tendo
  // 4 subtarefas com autor/data/resultado cada uma. `isActive` continua
  // decidindo o VISUAL (card rico vs. linha compacta), nunca se as subtarefas
  // aparecem: história concluída é história, não silêncio.
  if (subtarefas.length === 0) {
    return (
      <StepCard
        step={step} onOpenCentral={onOpenCentral} refDoAtual={refDoAtual}
        podeIniciar={podeIniciar} tarefaResponsavelNome={tarefaResponsavelNome}
      />
    )
  }

  return (
    <div ref={refDoAtual} className="space-y-1.5">
      {subtarefas.map((s, i) => (
        <SubtarefaRow
          key={s.key}
          subtarefa={s}
          ordem={i + 1}
          onOpenCentral={onOpenCentral}
          podeIniciar={podeIniciar}
          tarefaResponsavelNome={tarefaResponsavelNome}
          isAdmin={isAdmin}
          stepInstanceId={step.id}
          onRecarregar={onRecarregar}
        />
      ))}
    </div>
  )
}

const SUBTAREFA_STATUS_LABEL: Record<string, string> = {
  PENDENTE: "Pendente",
  DISPONIVEL: "Disponível",
  EM_ANDAMENTO: "Em execução",
  AGUARDANDO_EXTERNO: "Aguardando terceiro",
  BLOQUEADO: "Bloqueada",
  CONCLUIDO: "Concluída",
  CANCELADO: "Cancelada",
  INVALIDADO: "Invalidada",
  FALHOU: "Falhou",
}

function SubtarefaRow({
  subtarefa, ordem, onOpenCentral, podeIniciar, tarefaResponsavelNome, isAdmin, stepInstanceId, onRecarregar,
}: {
  subtarefa: {
    key: string; label: string; descricao: string | null; concluida: boolean; disponivel: boolean
    status: string; bloqueioTexto: string | null; slaDays: number | null
  }
  ordem: number
  onOpenCentral: (subtarefaKey?: string) => void
  podeIniciar: boolean
  tarefaResponsavelNome?: string | null
  isAdmin: boolean
  stepInstanceId: number
  onRecarregar: () => void
}) {
  const s = subtarefa
  // MODO CONCLUÍDA — compacto, mesmo padrão visual do StepCard concluído, mas
  // clicável: "concluída" é história, não é motivo pra esconder o que
  // aconteceu. Decisão do usuário (16/09/2026): todo mundo vê e abre em modo
  // leitura; só o admin reabre (RegruaReabrirSubtarefa, botão à parte).
  if (s.concluida) {
    return (
      <div className="bg-[var(--surface-secondary)]/30 border border-green-900/60 rounded-md px-3 py-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => onOpenCentral(s.key)}
          className="flex-1 min-w-0 flex items-center gap-3 text-left"
        >
          <div className="w-6 h-6 rounded-full bg-[var(--action-primary)] flex items-center justify-center flex-shrink-0">
            <Check className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="flex-1 min-w-0 text-[12.5px] font-semibold text-green-800 hover:underline">{ordem}. {s.label}</div>
        </button>
        {isAdmin && (
          <BotaoReabrirSubtarefa
            stepInstanceId={stepInstanceId}
            subtaskKey={s.key}
            label={s.label}
            onReaberto={onRecarregar}
          />
        )}
      </div>
    )
  }

  // AGUARDANDO TERCEIRO NÃO É BLOQUEIO — é o padrão da subtarefa ao ficar
  // corrente (`esperaExternaAoLiberar`), mas ela continua `disponivel`: o
  // operador precisa poder abrir "Receber certidão" JUSTAMENTE enquanto ela
  // diz "aguardando terceiro", para registrar que a certidão chegou. Só quem
  // trava de verdade é a DEPENDÊNCIA pendente (`!s.disponivel`).
  const esperandoTerceiro = s.status === "AGUARDANDO_EXTERNO"
  const bloqueadaPorDependencia = !s.disponivel
  const podeAgir = s.disponivel && podeIniciar
  const cardBorderCls = esperandoTerceiro ? "border-amber-900/60" : "border-[var(--border-default)]"
  const statusBadgeCls = esperandoTerceiro
    ? "bg-[var(--surface-secondary)] text-amber-800 border-amber-800"
    : "bg-[var(--surface-secondary)] text-[var(--text-secondary)] border-[var(--border-default)]"

  // MODO ATIVO/BLOQUEADA — MESMO layout rico do StepCard (número + título,
  // badge, descrição, "executa · SLA", botão "Iniciar →"), só que por
  // SUBTAREFA em vez de por passo. Achado real: 15/09/2026 — a versão
  // resumida escondia justamente a riqueza que o StepCard sempre teve.
  return (
    <div className={`bg-[var(--surface-primary)] border ${cardBorderCls} rounded-md overflow-hidden ${bloqueadaPorDependencia ? "opacity-60" : ""}`}>
      <div className="px-3 py-3 flex items-start gap-3">
        <div className="w-6 h-6 rounded-full bg-[var(--surface-secondary)] flex items-center justify-center flex-shrink-0 mt-0.5">
          {s.disponivel ? <Play className="w-3 h-3 text-white fill-white ml-0.5" /> : <Lock className="w-3 h-3 text-[var(--text-secondary)]" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[12.5px] font-semibold text-white">{ordem}. {s.label}</div>
            <span className={`text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${statusBadgeCls}`}>
              {SUBTAREFA_STATUS_LABEL[s.status] ?? s.status}
            </span>
          </div>
          {s.descricao && (
            <div className="text-[11px] text-[var(--text-secondary)] mt-1">{s.descricao}</div>
          )}
          {bloqueadaPorDependencia ? (
            <div className="mt-2 text-[11px] text-[var(--text-secondary)]">Aguardando subtarefa anterior</div>
          ) : !tarefaResponsavelNome ? null : (
            <>
              <div className="flex items-center gap-2 flex-wrap text-[11px] text-[var(--text-secondary)] mt-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-pink-500" />
                  <span className="text-[var(--text-secondary)]">executa</span>
                  {tarefaResponsavelNome}
                </span>
                {s.slaDays != null && (
                  <>
                    <span className="text-[var(--text-secondary)]">·</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="text-[var(--text-secondary)]">SLA</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-green-800 bg-[var(--surface-secondary)]">
                        {s.slaDays} dia(s)
                      </span>
                    </span>
                  </>
                )}
              </div>
              {s.bloqueioTexto && (
                <div className="mt-2 px-2.5 py-2 bg-amber-950/40 border border-amber-900/50 rounded text-[11.5px] text-amber-800">
                  {s.bloqueioTexto}
                </div>
              )}
            </>
          )}
        </div>
        {podeAgir ? (
          <button
            onClick={() => onOpenCentral(s.key)}
            className="px-2.5 py-1.5 text-[10.5px] font-semibold bg-[var(--action-primary)] hover:bg-[var(--action-primary)] text-[var(--action-primary-ink)] rounded transition-colors whitespace-nowrap"
          >
            Iniciar →
          </button>
        ) : s.disponivel ? (
          <span
            title="A tarefa precisa estar atribuída a você para iniciar esta subtarefa"
            className="px-2.5 py-1.5 text-[10.5px] font-semibold text-[var(--text-secondary)] bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded whitespace-nowrap"
          >
            {tarefaResponsavelNome ? `Atribuído a ${tarefaResponsavelNome}` : "Sem responsável"}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * REABRIR SUBTAREFA — SÓ ADMIN.
 *
 * Sem plano/modal cheio (diferente de `ReabrirEtapaModal`, que reabre o PASSO
 * inteiro e por isso precisa mostrar dependentes/outras unidades): reabrir UMA
 * subtarefa nunca alcança outra subtarefa do mesmo passo nem outro passo — o
 * único efeito colateral possível é o PASSO voltar a ficar aberto quando ele
 * já estava CONCLUÍDO, e a API já avisa isso na resposta (`passoReaberto`).
 */
function BotaoReabrirSubtarefa({
  stepInstanceId, subtaskKey, label, onReaberto,
}: {
  stepInstanceId: number
  subtaskKey: string
  label: string
  onReaberto: () => void
}) {
  const [enviando, setEnviando] = useState(false)

  const reabrir = async () => {
    const justificativa = window.prompt(
      `Reabrir "${label}"? Explique o motivo (mínimo 5 caracteres) — isso vira uma nova tentativa, o que já aconteceu continua no histórico.`,
    )
    if (justificativa == null) return
    if (justificativa.trim().length < 5) {
      alert("Justificativa muito curta — explique o motivo com pelo menos 5 caracteres.")
      return
    }
    setEnviando(true)
    try {
      const token = localStorage.getItem("token") ?? localStorage.getItem("authToken")
      const res = await fetch(
        `/api/workflow-step-instances/${stepInstanceId}/subtarefas/${encodeURIComponent(subtaskKey)}/reabrir`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ justificativa: justificativa.trim() }),
        },
      )
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) {
        alert(j.mensagem ?? "Não foi possível reabrir esta subtarefa.")
        return
      }
      onReaberto()
    } catch {
      alert("Falha de rede ao reabrir a subtarefa.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <button
      type="button"
      onClick={reabrir}
      disabled={enviando}
      className="shrink-0 text-[10.5px] font-semibold text-[var(--accent-text)] hover:underline disabled:opacity-50"
      title="Reabrir esta subtarefa (admin)"
    >
      {enviando ? "Reabrindo…" : "Reabrir"}
    </button>
  )
}

// ============================================================
// STEP CARD — 3 modos: DONE / ACTIVE / FUTURE
// (Editor inline removido — toda interação vai pra Central da Etapa)
// ============================================================

function StepCard({
  step,
  onOpenCentral,
  refDoAtual,
  podeIniciar,
  tarefaResponsavelNome,
}: {
  step: WorkflowStep
  onOpenCentral: () => void
  /** Recebe o nó do passo ATIVO para que ele apareça sem ninguém procurar. */
  refDoAtual?: (el: HTMLDivElement | null) => void
  /**
   * Se a TAREFA (não o passo) está atribuída ao usuário logado. Sem isso, o
   * passo é mostrado, mas "Iniciar" não é oferecido — abrir a Central da
   * Etapa sem poder agir nela só levava a um 403 depois do clique.
   */
  podeIniciar: boolean
  tarefaResponsavelNome?: string | null
}) {
  const isDone = step.status === "concluida"
  const isActive =
    step.status === "em_andamento" ||
    step.status === "aguardando_terceiro" ||
    step.status === "atrasada" ||
    (step.status === "bloqueada" && step.motivoBloqueio !== null)
  const isFuture = !isDone && !isActive

  // ============================================================
  // MODO DONE — compacto
  // ============================================================
  if (isDone) {
    const completedByName = step.completedBy?.nome || ownerName(step.ownerKey)
    return (
      <div
        onClick={onOpenCentral}
        className="bg-[var(--surface-secondary)]/30 border border-green-900/60 rounded-md px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-[var(--surface-secondary)]/50 transition-colors"
      >
        <div className="w-6 h-6 rounded-full bg-[var(--action-primary)] flex items-center justify-center flex-shrink-0">
          <Check className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold text-green-800">
            {step.ordem}. {step.title}
          </div>
          <div className="text-[10.5px] text-green-800/80 mt-0.5">
            concluída por <strong>{completedByName}</strong> em {fmtDateTime(step.completedAt)} · peso {step.weight}%
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-green-500/70 flex-shrink-0" />
      </div>
    )
  }

  // ============================================================
  // MODO FUTURE — recolhido
  // ============================================================
  if (isFuture) {
    return (
      <div className="bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-md px-3 py-2.5 flex items-center gap-3 opacity-60">
        <div className="w-6 h-6 rounded-full bg-[var(--text-muted)] border border-[var(--border-default)] flex items-center justify-center flex-shrink-0">
          <Lock className="w-3 h-3 text-[var(--text-secondary)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold text-[var(--text-secondary)]">
            {step.ordem}. {step.title}
          </div>
          <div className="text-[10.5px] text-[var(--text-secondary)] mt-0.5">
            {ownerName(step.ownerKey)} · peso {step.weight}% · aguarda liberação
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-[var(--text-secondary)] flex-shrink-0" />
      </div>
    )
  }

  // ============================================================
  // MODO ACTIVE — expandido (3 sub-modos visuais)
  // ============================================================
  const sla = fmtSla(step.dueAt)
  const isBloqueada = step.status === "bloqueada"
  const isLockStepWait =
    isBloqueada && step.motivoBloqueio?.startsWith(LOCK_STEP_PREFIX)
  const isBloqueioManual = isBloqueada && !isLockStepWait

  // Cor da borda do card
  const cardBorderCls = isLockStepWait
    ? "border-amber-900/60"
    : isBloqueioManual
    ? "border-red-900/60"
    : "border-[var(--border-default)]"

  // Círculo com ícone
  const circleCls = isLockStepWait
    ? "bg-[var(--surface-secondary)]"
    : isBloqueioManual
    ? "bg-[var(--surface-secondary)]"
    : "bg-[var(--surface-secondary)]"

  // Badge de status (texto e cor)
  const statusBadgeCls = isLockStepWait
    ? "bg-[var(--surface-secondary)] text-amber-800 border-amber-800"
    : isBloqueioManual
    ? "bg-[var(--surface-secondary)] text-red-700 border-red-800"
    : step.status === "aguardando_terceiro"
    ? "bg-[var(--surface-secondary)] text-amber-800 border-amber-800"
    : step.status === "atrasada"
    ? "bg-[var(--surface-secondary)] text-amber-800 border-amber-800"
    : "bg-[var(--surface-secondary)] text-[var(--text-secondary)] border-[var(--border-default)]"

  const statusLabel = isLockStepWait
    ? "Aguardando docs"
    : STATUS_LABEL[step.status]

  // `ownerName(null)` devolve "—" (placeholder visual) — truthy, mas não é um
  // responsável de verdade. O gate de exibição precisa saber a diferença
  // (achado real, 16/09/2026: a linha "executa — · SLA" continuava aparecendo).
  const temResponsavel = !!step.assignee?.nome || !!step.ownerKey
  const responsibleName = step.assignee?.nome || ownerName(step.ownerKey)
  const dotColor = ownerColor(step.ownerKey)

  return (
    <div className={`bg-[var(--surface-primary)] border ${cardBorderCls} rounded-md overflow-hidden`}>

      {/* Cabeçalho do step ativo */}
      <div ref={refDoAtual} className="px-3 py-3 flex items-start gap-3">
        <div className={`w-6 h-6 rounded-full ${circleCls} flex items-center justify-center flex-shrink-0 mt-0.5`}>
          {isBloqueada ? (
            <Lock className="w-3 h-3 text-white" />
          ) : (
            <Play className="w-3 h-3 text-white fill-white ml-0.5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[12.5px] font-semibold text-white">
              {step.ordem}. {step.title}
            </div>
            <span className={`text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${statusBadgeCls}`}>
              {statusLabel}
            </span>
          </div>
          {step.description && (
            <div className="text-[11px] text-[var(--text-secondary)] mt-1">{step.description}</div>
          )}

          {/* Meta compacta — esconde se for lock-step wait (responsável/SLA não fazem
              sentido) ou se ainda não há responsável (nada pra dizer "executa"). */}
          {!isLockStepWait && temResponsavel && (
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-[var(--text-secondary)] mt-2">
              {/* QUEM EXECUTA ESTA ETAPA — não "o responsável".
                  O responsável pelo trabalho é o da TAREFA, e ele aparece uma
                  vez só, no topo do painel. Um nome solto aqui era lido como
                  "dono do documento" e disputava com aquele: a mesma certidão
                  parecia ter dois donos conforme onde se olhasse. */}
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />
                <span className="text-[var(--text-secondary)]">executa</span>
                {responsibleName}
              </span>
              <span className="text-[var(--text-secondary)]">·</span>
              <span className="inline-flex items-center gap-1">
                <span className="text-[var(--text-secondary)]">SLA</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${sla.cls}`}>
                  {sla.label}
                </span>
              </span>
              {step.dueAt && (
                <>
                  <span className="text-[var(--text-secondary)]">·</span>
                  <span className="font-mono text-[10.5px] text-[var(--text-secondary)]">{fmtDateTime(step.dueAt)}</span>
                </>
              )}
            </div>
          )}

          {/* Banner LOCK-STEP — amigável, âmbar */}
          {isLockStepWait && (
            <div className="mt-2 px-2.5 py-2 bg-amber-950/40 border border-amber-900/50 rounded text-[11.5px] text-amber-800 flex items-start gap-2">
              <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-800" />
              <div>
                <strong className="font-semibold">Aguardando outros documentos chegarem nesta etapa.</strong>
                <div className="text-[10.5px] text-amber-800/80 mt-0.5">
                  Libera automaticamente quando todos os documentos do processo concluírem a etapa anterior.
                </div>
              </div>
            </div>
          )}

          {/* Banner BLOQUEIO MANUAL — vermelho, como antes */}
          {isBloqueioManual && step.motivoBloqueio && (
            <div className="mt-2 px-2 py-1.5 bg-red-950/50 border border-red-900 rounded text-[11px] text-red-700">
              Bloqueado: <strong>{step.motivoBloqueio}</strong>
            </div>
          )}

          {/* Notas */}
          {step.notes && (
            <div className="mt-2 px-2 py-1.5 bg-[var(--surface-secondary)] rounded text-[11px] text-[var(--text-secondary)] italic">
              {step.notes}
            </div>
          )}
        </div>

        {/* Botão que abre a Central da Etapa — o rótulo é sempre "Iniciar" (o
            que a pessoa faz ao clicar: entrar na etapa e trabalhar nela),
            independente do estado. Esconde no lock-step wait (não há ação útil).
            Sem a TAREFA atribuída a este usuário, "Iniciar" nem abre: o
            servidor já barra a ação (403 em `carregarPassoAutorizado`) — deixar
            o botão e a janela abertos só escondia isso até o clique errado. */}
        {!isLockStepWait && (
          podeIniciar ? (
            <button
              onClick={onOpenCentral}
              className="px-2.5 py-1.5 text-[10.5px] font-semibold bg-[var(--action-primary)] hover:bg-[var(--action-primary)] text-[var(--action-primary-ink)] rounded transition-colors whitespace-nowrap"
            >
              Iniciar →
            </button>
          ) : (
            <span
              title="A tarefa precisa estar atribuída a você para iniciar esta etapa"
              className="px-2.5 py-1.5 text-[10.5px] font-semibold text-[var(--text-secondary)] bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded whitespace-nowrap"
            >
              {tarefaResponsavelNome ? `Atribuído a ${tarefaResponsavelNome}` : "Sem responsável"}
            </span>
          )
        )}
      </div>

    </div>
  )
}