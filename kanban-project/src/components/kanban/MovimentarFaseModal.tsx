// src/components/kanban/MovimentarFaseModal.tsx
//
// MODAL DE MOVIMENTAÇÃO MANUAL DE FASE — Administrador Master.
//
// É a única porta da interface para `POST /api/processos/[id]/phase/move`. Usada
// tanto pelo drag-and-drop do Kanban quanto pela ação "Movimentar fase" do menu do
// processo — mesmo modal, mesmo endpoint, mesma validação.
//
// O card NÃO se move antes da resposta do servidor. O fluxo é:
//   soltar → abrir este modal → confirmar → chamar a API → sucesso → mover.
// Cancelar não chama API nenhuma e devolve o card para a coluna de origem.
//
// O catálogo de motivos e a lista de fases vêm do SERVIDOR (GET da mesma rota).
// Nada aqui é cadastrado no frontend.

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, ArrowRight, Loader2, X } from "lucide-react"

interface MotivoMovimentacao {
  codigo: string
  label: string
  descricao: string
}

interface FaseDoMacro {
  phaseKey: string
  label: string
  ordem: number
  conditional: boolean
  atual: boolean
}

interface ContextoMovimentacao {
  success: true
  processo: { id: number; nome: string; codigo: string | null }
  faseAtual: string | null
  faseAtualLabel: string | null
  fases: FaseDoMacro[]
  motivos: MotivoMovimentacao[]
  justificativa: { min: number; max: number }
}

export interface MovimentarFaseModalProps {
  processoId: number
  /** Destino pré-selecionado (o drop do Kanban já sabe qual é). */
  faseAlvoInicial?: string | null
  /** KANBAN_DRAG_DROP quando veio do arraste; menu quando veio da ação. */
  origem: "KANBAN_DRAG_DROP" | "MENU_PROCESSO"
  onCancelar: () => void
  /** Só é chamado depois que o SERVIDOR confirmou a movimentação. */
  onMovido: (r: { faseAtual: string; faseAtualLabel: string; message: string }) => void
}

export function MovimentarFaseModal({
  processoId,
  faseAlvoInicial,
  origem,
  onCancelar,
  onMovido,
}: MovimentarFaseModalProps) {
  const [ctx, setCtx] = useState<ContextoMovimentacao | null>(null)
  const [carregandoCtx, setCarregandoCtx] = useState(true)
  const [faseAlvo, setFaseAlvo] = useState(faseAlvoInicial ?? "")
  const [motivoCodigo, setMotivoCodigo] = useState("")
  const [justificativa, setJustificativa] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // TRAVA DE ENVIO DUPLO: um clique duplo (ou duas abas) não pode virar duas
  // movimentações. O ref fecha a porta antes de qualquer await.
  const enviandoRef = useRef(false)

  const token = () => (typeof window !== "undefined" ? localStorage.getItem("authToken") : null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const res = await fetch(`/api/processos/${processoId}/phase/move`, {
          headers: { Authorization: `Bearer ${token()}` },
        })
        const d = await res.json().catch(() => ({}))
        if (!vivo) return
        if (!res.ok) { setErro(d?.message || "Não foi possível carregar o contexto da movimentação."); return }
        setCtx(d as ContextoMovimentacao)
      } catch {
        if (vivo) setErro("Falha de rede ao carregar o contexto da movimentação.")
      } finally {
        if (vivo) setCarregandoCtx(false)
      }
    })()
    return () => { vivo = false }
  }, [processoId])

  const confirmar = useCallback(async () => {
    if (enviandoRef.current) return
    enviandoRef.current = true
    setEnviando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/phase/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        // userId NÃO vai no corpo: quem assina é o token.
        body: JSON.stringify({ faseAlvo, motivoCodigo, justificativa, origem }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d?.success !== true) {
        // A mensagem REAL do servidor. O genérico só entra se o servidor não disse nada.
        setErro(d?.message || "Não foi possível mover o processo. Tente novamente.")
        return
      }
      onMovido({ faseAtual: d.faseAtual, faseAtualLabel: d.faseAtualLabel, message: d.message })
    } catch {
      setErro("Falha de rede ao mover o processo. O processo continua na fase de origem.")
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }, [processoId, faseAlvo, motivoCodigo, justificativa, origem, onMovido])

  const min = ctx?.justificativa.min ?? 10
  const max = ctx?.justificativa.max ?? 500
  const justificativaLimpa = justificativa.replace(/\s+/g, " ").trim()
  const destino = ctx?.fases.find((f) => f.phaseKey === faseAlvo) ?? null
  const podeConfirmar =
    !enviando && !!faseAlvo && !!motivoCodigo &&
    justificativaLimpa.length >= min && justificativaLimpa.length <= max &&
    faseAlvo !== ctx?.faseAtual

  const corpo = (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/60 px-4" onClick={enviando ? undefined : onCancelar}>
      <div
        className="w-full max-w-[560px] max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#1b2027] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Confirmar movimentação manual"
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-white/10">
          <div>
            <h2 className="text-[16px] font-extrabold text-white/95">Confirmar movimentação manual</h2>
            <p className="text-[12px] text-white/55 mt-0.5">
              {ctx?.processo ? `${ctx.processo.codigo ? ctx.processo.codigo + " · " : ""}${ctx.processo.nome}` : "Carregando processo…"}
            </p>
          </div>
          <button
            onClick={onCancelar}
            disabled={enviando}
            className="w-8 h-8 rounded-lg grid place-items-center text-white/55 hover:text-white hover:bg-white/10 disabled:opacity-40"
            aria-label="Cancelar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {carregandoCtx ? (
            <div className="flex items-center justify-center py-10 text-white/40">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <>
              {/* ORIGEM → DESTINO */}
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#15191f] px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">De</div>
                  <div className="text-[13px] font-bold text-white/95 truncate">{ctx?.faseAtualLabel ?? "—"}</div>
                </div>
                <ArrowRight className="w-4 h-4 text-white/40 flex-none" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Para</div>
                  <div className="text-[13px] font-bold text-[#7dd3fc] truncate">{destino?.label ?? "Selecione a fase"}</div>
                </div>
              </div>

              {/* DESTINO — do macro DESTE processo (o drop já preenche) */}
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wider text-white/40">Fase de destino</span>
                <select
                  value={faseAlvo}
                  onChange={(e) => setFaseAlvo(e.target.value)}
                  disabled={enviando}
                  className="mt-1 w-full text-[13px] rounded-lg border border-white/10 bg-[#15191f] text-white/95 px-3 py-2 focus:outline-none focus:border-[#7dd3fc]/50"
                >
                  <option value="">Selecione…</option>
                  {(ctx?.fases ?? []).filter((f) => !f.atual).map((f) => (
                    <option key={f.phaseKey} value={f.phaseKey}>
                      {f.label}{f.conditional ? " (condicional)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              {/* AVISOS — o que esta ação faz e o que ela NÃO faz */}
              <div className="rounded-xl border border-[#d2a948]/30 bg-[#d2a948]/10 px-4 py-3 space-y-1.5">
                <div className="flex items-center gap-2 text-[12px] font-bold text-[#d2a948]">
                  <AlertTriangle className="w-3.5 h-3.5 flex-none" /> Esta ação não passa pelo fluxo automático
                </div>
                <p className="text-[11.5px] text-[#d2a948]/90 leading-relaxed">
                  Esta movimentação altera apenas a fase operacional do processo. Tarefas e
                  obrigações das demais fases permanecerão pendentes até serem concluídas.
                </p>
                <ul className="text-[11.5px] text-[#d2a948]/90 leading-relaxed list-disc pl-5">
                  <li>Não conclui as tarefas da fase atual, nem marca a fase como concluída.</li>
                  <li>Não conclui, cancela nem dispensa tarefas de nenhuma outra fase — inclusive das fases atravessadas.</li>
                  <li>Todo o histórico é preservado: tarefas, passos e ciclos anteriores continuam existindo.</li>
                  <li>A fase de destino recebe um novo ciclo, e a movimentação fica registrada com o seu usuário.</li>
                  {destino?.conditional && (
                    <li className="font-semibold">
                      A fase de destino é CONDICIONAL: a abertura será registrada como administrativa, sem alterar a decisão da análise documental.
                    </li>
                  )}
                </ul>
              </div>

              {/* MOTIVO — catálogo do servidor, nunca texto livre estrutural */}
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wider text-white/40">Motivo *</span>
                <select
                  value={motivoCodigo}
                  onChange={(e) => setMotivoCodigo(e.target.value)}
                  disabled={enviando}
                  className="mt-1 w-full text-[13px] rounded-lg border border-white/10 bg-[#15191f] text-white/95 px-3 py-2 focus:outline-none focus:border-[#7dd3fc]/50"
                >
                  <option value="">Selecione o motivo…</option>
                  {(ctx?.motivos ?? []).map((m) => (
                    <option key={m.codigo} value={m.codigo}>{m.label}</option>
                  ))}
                </select>
                {motivoCodigo && (
                  <span className="text-[11px] text-white/40 block mt-1">
                    {ctx?.motivos.find((m) => m.codigo === motivoCodigo)?.descricao}
                  </span>
                )}
              </label>

              {/* JUSTIFICATIVA */}
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wider text-white/40">
                  Justificativa * <span className="normal-case font-semibold text-white/25">({justificativaLimpa.length}/{max}, mínimo {min})</span>
                </span>
                <textarea
                  value={justificativa}
                  onChange={(e) => setJustificativa(e.target.value.slice(0, max + 50))}
                  disabled={enviando}
                  rows={3}
                  placeholder="Explique por que este processo está sendo reposicionado."
                  className="mt-1 w-full text-[13px] rounded-lg border border-white/10 bg-[#15191f] text-white/95 px-3 py-2 resize-y focus:outline-none focus:border-[#7dd3fc]/50"
                />
              </label>

              {erro && (
                <div className="rounded-lg border border-[#f87171]/40 bg-[#f87171]/10 px-3 py-2.5 text-[12.5px] text-[#f87171]">
                  {erro}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
          <button
            onClick={onCancelar}
            disabled={enviando}
            className="text-[12.5px] font-semibold px-4 py-2 rounded-lg border border-white/10 text-white/80 hover:bg-white/5 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={!podeConfirmar}
            className="inline-flex items-center gap-2 text-[12.5px] font-bold px-4 py-2 rounded-lg bg-[#2563eb] text-white hover:bg-[#1d4ed8] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {enviando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {enviando ? "Movendo…" : "Confirmar movimentação"}
          </button>
        </div>
      </div>
    </div>
  )

  if (typeof document === "undefined") return null
  return createPortal(corpo, document.body)
}
