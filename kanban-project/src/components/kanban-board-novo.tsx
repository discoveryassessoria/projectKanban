// ESTE ARQUIVO VAI EM: src/components/kanban-board-novo.tsx
//
// BOARD MOTOR-NATIVE (5/jul):
// - Colunas = FASES do Workflow Macro do TIPO selecionado (vêm por prop)
// - Arrastar card = mover de FASE (PUT /api/processos/[id]/fase)
// - "+ Novo processo" único no topo (nasce na 1ª fase do tipo, ligado ao motor)
// - SEM criar/editar/excluir coluna (colunas são do Gerenciamento)

"use client"

import type React from "react"
import { createPortal } from "react-dom"
import { useState, useEffect, useMemo } from "react"
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from "@dnd-kit/core"
import { snapCenterToCursor } from "@dnd-kit/modifiers"
import { Button } from "@/components/ui/button"
import { FileText, FileX, PenLine, Plus, ShieldCheck, Stamp, Users } from "lucide-react"
import { KanbanColumn } from "./kanban/kanban-column"
import { KanbanCard } from "./kanban/kanban-card"
import { ProcessoDetailsModal } from "./kanban/atividade-details-modal"
import { MovimentarFaseModal } from "./kanban/MovimentarFaseModal"
import {
  corDoPais,
  type PaisKanban,
  type TipoKanban,
  type Processo,
  type Contratante,
  type Requerente,
} from "@/src/types/kanban"
import { usePermissoes } from "@/src/hooks/use-permissoes"

// Identidade ESTÁVEL para a ausência de dados. `?? []` criava um array novo a
// cada render, e qualquer useMemo que dependesse dele recomputava sempre —
// era a memoização se anulando sozinha. Congelado: ninguém pode mutá-lo.

/**
 * Cor da COLUNA por posição no fluxo.
 *
 * A fase não guarda cor no cadastro — e inventar um campo de cor no motor para
 * resolver um problema de tela seria dado de negócio nascido de decoração. A
 * sequência é determinística pela ORDEM do workflow, então a mesma fase recebe
 * sempre a mesma cor, e a leitura da esquerda para a direita fica estável.
 *
 * A rampa é MONOCROMÁTICA em azul: o degrau significa POSIÇÃO NO FLUXO, não
 * categoria. Seis matizes diferentes (roxo/verde/âmbar/vermelho) faziam a fase
 * parecer um estado semântico que ela não é — e vermelho numa coluna competia
 * com vermelho de atraso, que significa de verdade.
 */
const COR_DA_COLUNA = [
  "#174d76", // azul profundo
  "#1f6aaa",
  "#2875b7", // azul active
  "#3d84bd",
  "#4f91c5", // azul médio
  "#6ba6d1",
] as const
const corDaColuna = (i: number) => COR_DA_COLUNA[i % COR_DA_COLUNA.length]

/** Ícone da coluna, pela mesma posição — idem: apresentação, não cadastro. */
const ICONE_DA_COLUNA = [Users, FileText, ShieldCheck, PenLine, FileX, Stamp] as const
const iconeDaColuna = (i: number) => ICONE_DA_COLUNA[i % ICONE_DA_COLUNA.length]

const SEM_FASES: any[] = Object.freeze([]) as unknown as any[]

interface KanbanBoardProps {
  pais: PaisKanban
  tipo: TipoKanban                    // tipo selecionado — as fases dele são as colunas
  processos: Processo[]
  contratantes?: Contratante[]
  requerentes?: Requerente[]
  onRefresh: () => void
  initialProcessoId?: number | null
  initialTab?: string | null
  initialPessoaId?: number | null
  initialSidebarTab?: string | null
  initialAtividadeId?: number | null
  initialTaskId?: number | null
  /** O contexto do deep-link acabou — a URL pode voltar a ser só `/kanban`. */
  onModalClosed?: () => void
}

// Helper para extrair ID numérico de IDs prefixados ("card-12" -> 12)
const extractId = (id: string | number): number => {
  if (typeof id === 'number') return id
  const match = id.match(/\d+$/)
  return match ? parseInt(match[0]) : 0
}

const isCardId = (id: string | number): boolean =>
  typeof id === 'string' && id.startsWith('card-')

const isColumnId = (id: string | number): boolean =>
  typeof id === 'string' && id.startsWith('column-')

// "column-analise_documental" -> "analise_documental"
const faseFromColumnId = (id: string | number): string | null =>
  isColumnId(id) ? String(id).slice('column-'.length) : null

export function KanbanBoard({
  pais,
  tipo,
  processos: processosFromProps,
  contratantes = [],
  requerentes = [],
  onRefresh,
  initialProcessoId = null,
  initialTab = null,
  initialPessoaId = null,
  initialSidebarTab = null,
  onModalClosed,
  initialAtividadeId = null,
  initialTaskId = null,
}: KanbanBoardProps) {
  // A lista local existe para o drag-and-drop responder na hora, antes de o servidor
  // confirmar. Ela é um RASCUNHO sobre a prop: enquanto a prop for a mesma, vale o
  // arranjo local; quando o pai traz dados novos, o rascunho é descartado — que é o
  // que o efeito de sincronia fazia, só que um render depois.
  const [rascunhoProcessos, setRascunhoProcessos] = useState<{ base: Processo[]; lista: Processo[] } | null>(null)
  const localProcessos = rascunhoProcessos?.base === processosFromProps ? rascunhoProcessos.lista : processosFromProps
  const setLocalProcessos = (proximos: Processo[] | ((anteriores: Processo[]) => Processo[])) => {
    const lista = typeof proximos === 'function' ? proximos(localProcessos) : proximos
    setRascunhoProcessos({ base: processosFromProps, lista })
  }

  const [activeProcesso, setActiveProcesso] = useState<Processo | null>(null)
  const [selectedProcesso, setSelectedProcesso] = useState<Processo | null>(null)
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)
  const [modalInitialTab, setModalInitialTab] = useState<string | undefined>(undefined)
  const [modalInitialPessoaId, setModalInitialPessoaId] = useState<number | undefined>(undefined)
  const [modalInitialSidebarTab, setModalInitialSidebarTab] = useState<string | undefined>(undefined)
  const [modalInitialAtividadeId, setModalInitialAtividadeId] = useState<number | undefined>(undefined)
  const { pode } = usePermissoes()

  // Modal "Novo processo" (nasce na 1ª fase do tipo, ligado ao motor)
  const [criarModal, setCriarModal] = useState(false)
  const [criarNome, setCriarNome] = useState("")
  const [salvandoCriar, setSalvandoCriar] = useState(false)
  const [erroCriar, setErroCriar] = useState<string | null>(null)
  // Idempotência da criação: 1 chave por abertura do modal. Retry/duplo clique/
  // timeout com a MESMA chave ⇒ o backend devolve o MESMO processo (sem duplicar).
  const [criarIdemKey, setCriarIdemKey] = useState<string>("")


  const corPais = corDoPais(pais.countryKey)

  // Fases visíveis (colunas) — já vêm ordenadas do config
  const fases = tipo?.fases ?? SEM_FASES

  // Sensores
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    })
  )

  // Abertura por deep-link. Antes isto copiava SETE valores para o estado dentro de um
  // efeito, guardado por um flag `initialParamsProcessed` que outro efeito zerava
  // quando o link mudava. O modal só aparecia um render depois de a lista chegar.
  //
  // Agora é derivação: enquanto o link não foi dispensado (fechar o modal dispensa),
  // ele determina o processo aberto e as abas iniciais. Uma abertura MANUAL vence,
  // porque quem clicou quis outra coisa.
  const linkDeepId = initialProcessoId ?? null
  const [linkDispensado, setLinkDispensado] = useState<number | null>(null)
  const processoDoLink = linkDeepId !== null && linkDispensado !== linkDeepId
    ? localProcessos.find(p => p.id === linkDeepId) ?? null
    : null
  const aberturaPorLink = processoDoLink !== null && selectedProcesso === null

  const processoDoModal = aberturaPorLink ? processoDoLink : selectedProcesso
  const modalAberto = aberturaPorLink || isDetailsModalOpen
  const abaInicialDoModal = aberturaPorLink ? (initialTab || undefined) : modalInitialTab
  const pessoaInicialDoModal = aberturaPorLink ? (initialPessoaId || undefined) : modalInitialPessoaId
  const sidebarInicialDoModal = aberturaPorLink ? (initialSidebarTab || undefined) : modalInitialSidebarTab
  const atividadeInicialDoModal = aberturaPorLink ? (initialAtividadeId || undefined) : modalInitialAtividadeId
  const taskInicialDoModal = aberturaPorLink ? (initialTaskId || undefined) : undefined

  // Processos agrupados por fase (A-Z dentro da fase)
  const processosByFase = useMemo(() => {
    const map = new Map<string, Processo[]>()
    for (const fase of fases) {
      map.set(
        fase.phaseKey,
        localProcessos
          .filter(p => p.faseAtualKey === fase.phaseKey)
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      )
    }
    return map
  }, [localProcessos, fases])

  const handleProcessoClick = (processo: Processo) => {
    setSelectedProcesso(processo)
    setModalInitialTab(undefined)
    setModalInitialPessoaId(undefined)
    setModalInitialSidebarTab(undefined)
    setIsDetailsModalOpen(true)
    setModalInitialAtividadeId(undefined)
  }

  const handleProcessoSave = () => onRefresh()

  const handleModalClose = () => {
    // Fechar também DISPENSA o deep-link: sem isso, o link reabriria o modal no render
    // seguinte, que é exatamente o que o flag `initialParamsProcessed` evitava antes.
    if (linkDeepId !== null) { setLinkDispensado(linkDeepId); onModalClosed?.() }
    setIsDetailsModalOpen(false)
    setModalInitialTab(undefined)
    setModalInitialPessoaId(undefined)
    setModalInitialSidebarTab(undefined)
    setModalInitialAtividadeId(undefined)
    onRefresh()
  }

  // ✅ Criar processo — nasce na 1ª fase, já ligado ao motor
  const abrirCriar = () => {
    setCriarNome("")
    setErroCriar(null)
    setCriarIdemKey(crypto.randomUUID())
    setCriarModal(true)
  }

  const confirmarCriarProcesso = async () => {
    if (!criarNome.trim()) { setErroCriar("Informe o nome do processo."); return }

    setSalvandoCriar(true); setErroCriar(null)
    try {
      const response = await fetch('/api/processos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem("authToken")}`,
          'Idempotency-Key': criarIdemKey || crypto.randomUUID(),
        },
        body: JSON.stringify({
          nome: criarNome.trim(),
          pais: pais.countryKey,
          tipoProcessoMotorId: tipo.id,
        })
      })

      if (!response.ok) {
        const d = await response.json().catch(() => ({}))
        throw new Error(d.error || "Falha ao criar novo processo")
      }
      setCriarModal(false)
      onRefresh()
    } catch (error: any) {
      console.error(error)
      setErroCriar(error.message || "Não foi possível adicionar o processo.")
    } finally {
      setSalvandoCriar(false)
    }
  }

  // Drag handlers
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const activeId = extractId(active.id)
    const processo = localProcessos.find((p) => p.id === activeId)
    setActiveProcesso(processo || null)
  }

  // MOVIMENTAÇÃO MANUAL pendente de confirmação. O card NÃO se move aqui: ele só
  // muda de coluna depois que o SERVIDOR confirmar. Enquanto isso, o board continua
  // exibindo a fase real.
  const [movimentacao, setMovimentacao] = useState<{ processoId: number; faseAlvo: string } | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // Quem pode reposicionar o processo em QUALQUER fase (Administrador Master).
  // Permissão OFICIAL — nunca `tipo === 'admin'`, nome, e-mail ou flag do cliente.
  const podeMoverManual = pode('processos.moverFaseManual')
  // Quem pode apenas solicitar o AVANÇO normal (fase seguinte, com o gate).
  const podeAvancar = pode('workflow.avancar')
  const podeArrastar = podeMoverManual || podeAvancar

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event

    setActiveProcesso(null)
    if (!over) return

    const activeId = extractId(active.id)
    const processo = localProcessos.find((p) => p.id === activeId)
    if (!processo) return

    // Fase de destino
    let targetFaseKey: string | null = null
    if (over.data.current?.faseKey) {
      targetFaseKey = over.data.current.faseKey
    } else if (isColumnId(over.id)) {
      targetFaseKey = faseFromColumnId(over.id)
    } else if (isCardId(over.id)) {
      const overProcessoId = extractId(over.id)
      const overProcesso = localProcessos.find((p) => p.id === overProcessoId)
      if (overProcesso) targetFaseKey = overProcesso.faseAtualKey ?? null
    }

    // Mesma fase ou indefinida: não faz nada
    if (!targetFaseKey || processo.faseAtualKey === targetFaseKey) return

    // ADMINISTRADOR MASTER: qualquer fase — anterior, posterior ou intermediária.
    // O drop NÃO move o card: abre o modal, que exige motivo e justificativa e só
    // então chama o endpoint oficial. Cancelar deixa tudo como estava.
    if (podeMoverManual) {
      setMovimentacao({ processoId: activeId, faseAlvo: targetFaseKey })
      return
    }

    // 🔒 Sem nenhuma das permissões o card nem arrasta (useSortable desabilitado);
    // esta guarda cobre o caminho residual.
    if (!podeAvancar) {
      setAviso("As fases avançam automaticamente conforme os documentos são validados. Você não tem permissão para mover o processo de fase manualmente.")
      return
    }

    // FLUXO NORMAL (inalterado): arrastar é uma SOLICITAÇÃO de avanço para a próxima
    // fase, validada pelo gate no servidor.
    const previousProcessos = [...localProcessos]
    setLocalProcessos(prev =>
      prev.map(p => p.id === activeId ? { ...p, faseAtualKey: targetFaseKey! } : p)
    )

    try {
      const response = await fetch(`/api/processos/${activeId}/fase`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify({ faseAtualKey: targetFaseKey }),
      })
      if (!response.ok) {
        const d = await response.json().catch(() => ({}))
        // A mensagem REAL do servidor. O genérico é fallback, não o padrão.
        throw new Error(d.message || d.error || "Não foi possível mover o processo.")
      }
      onRefresh()
    } catch (error) {
      console.error("[kanban] avanço de fase recusado:", error)
      setLocalProcessos(previousProcessos)
      setAviso((error as Error)?.message || "Não foi possível mover o processo. Tente novamente.")
    }
  }

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            {pais.flag && <span className="text-xl">{pais.flag}</span>}
            Processos - {pais.countryLabel}
            <span className="text-sm font-normal text-[var(--text-secondary)]">· {tipo.name}</span>
          </h3>
          <p className="text-sm text-white/70">
            Arraste e solte os processos entre as fases
          </p>
        </div>
        {pode('processos.criar') && (
          <Button
            onClick={abrirCriar}
            className="bg-[var(--action-primary)] hover:bg-[var(--action-primary)] text-[var(--action-primary-ink)]"
          >
            <Plus className="mr-1.5 h-4 w-4" /> Novo processo
          </Button>
        )}
      </div>

      {fases.length === 0 ? (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-6 text-center text-sm text-amber-800">
          Este tipo de processo ainda não tem fases configuradas.
          Monte o workflow em Gerenciamento → Workflows e Fases → Workflow Macro.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          collisionDetection={pointerWithin}
        >
          <div className="relative w-full max-w-full">
            <div
              className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-sm pb-3 scrollbar-thin scrollbar-thumb-white/30 scrollbar-track-white/10"
              style={{
                overflowX: 'auto',
                overflowY: 'hidden',
                maxWidth: '100%'
              }}
            >
              <div className="flex h-[calc(100vh-280px)] min-h-[500px]" style={{ width: 'max-content' }}>
                {fases.map((fase, index) => (
                  <div
                    key={fase.phaseKey}
                    className="flex-shrink-0 w-[260px] h-full"
                  >
                    <KanbanColumn
                      faseKey={fase.phaseKey}
                      title={fase.label}
                      processos={processosByFase.get(fase.phaseKey) || []}
                      headerColor={corDaColuna(index)}
                      Icone={iconeDaColuna(index)}
                      nacionalidade={tipo?.name ?? undefined}
                      isLast={index === fases.length - 1}
                      onProcessoClick={handleProcessoClick}
                      podeArrastar={podeArrastar}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DragOverlay
            modifiers={[snapCenterToCursor]}
            dropAnimation={{
              duration: 200,
              easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
            }}
          >
            {activeProcesso ? (
              <div style={{ transform: 'rotate(2deg) scale(1.02)', opacity: 0.95 }}>
                <KanbanCard processo={activeProcesso} isDragging />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* MODAL: Novo processo — em portal pro body (senão fica preso no painel com blur) */}
      {criarModal && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-auto rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-[var(--elev-3)]">
            <div className="flex items-center justify-between border-b border-[var(--border-default)] px-6 py-4">
              <h3 className="text-lg font-semibold text-white">Novo processo</h3>
              <button onClick={() => setCriarModal(false)} className="text-[var(--text-muted)] transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">Nome *</label>
                <input
                  autoFocus
                  value={criarNome}
                  onChange={(e) => setCriarNome(e.target.value)}
                  placeholder="Nome do processo"
                  className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
                  onKeyDown={(e) => { if (e.key === 'Enter') confirmarCriarProcesso() }}
                />
              </div>

              <p className="text-xs text-[var(--text-muted)]">
                Tipo: <span className="text-white/70">{tipo.name}</span> — o processo nasce na primeira fase
                {fases[0] ? ` (${fases[0].label})` : ""} e já entra no motor.
              </p>

              {erroCriar && (
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 text-sm text-red-700">{erroCriar}</div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-6 py-4">
              <button onClick={() => setCriarModal(false)} className="rounded-lg px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-white">Cancelar</button>
              <button
                onClick={confirmarCriarProcesso}
                disabled={salvandoCriar}
                className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary)] disabled:opacity-50"
              >
                {salvandoCriar ? "Criando..." : "Criar processo"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <ProcessoDetailsModal
        processo={processoDoModal as any}
        isOpen={modalAberto}
        onClose={handleModalClose}
        onSave={handleProcessoSave}
        initialTab={abaInicialDoModal}
        initialPessoaId={pessoaInicialDoModal}
        initialSidebarTab={sidebarInicialDoModal}
        initialAtividadeId={atividadeInicialDoModal}
        initialTaskId={taskInicialDoModal}
      />

      {/* MOVIMENTAÇÃO MANUAL — o card só troca de coluna DEPOIS que o servidor
          confirma. Cancelar não chama API e não altera nada. */}
      {movimentacao && (
        <MovimentarFaseModal
          processoId={movimentacao.processoId}
          faseAlvoInicial={movimentacao.faseAlvo}
          origem="KANBAN_DRAG_DROP"
          onCancelar={() => setMovimentacao(null)}
          onMovido={(r) => {
            setMovimentacao(null)
            // Atualização local imediata + revalidação oficial: o servidor é a
            // fonte da verdade, mas o operador não fica olhando o card parado.
            setLocalProcessos((prev) =>
              prev.map((p) => (p.id === movimentacao.processoId ? { ...p, faseAtualKey: r.faseAtual } : p)),
            )
            onRefresh()
            setAviso(r.message)
          }}
        />
      )}

      {aviso && (
        <div className="fixed inset-0 z-[10060] flex items-center justify-center bg-[var(--overlay-modal)] px-4" onClick={() => setAviso(null)}>
          <div className="max-w-sm rounded-xl border border-[var(--border-default)] bg-[var(--surface-popover)] p-5 shadow-[var(--elev-3)]" onClick={(e) => e.stopPropagation()}>
            <div className="text-[13px] text-white/90 leading-relaxed">{aviso}</div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setAviso(null)}
                className="text-[12.5px] font-bold px-3.5 py-1.5 rounded-lg bg-[var(--surface-tertiary)] text-white/95 hover:bg-[var(--surface-tertiary)]"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}