"use client"

// src/components/arvore/remocao-pessoa-modal.tsx
// ============================================================================
// CONFIRMAÇÃO DE REMOÇÃO — mostra o que sai e o que fica ANTES de agir.
//
// A confirmação anterior era um botão que virava "Confirmar?". Ele não dizia
// que junto da pessoa iam 16 tarefas e uma receita de R$ 2.800 — nem que um
// pagamento já recebido torna a exclusão definitiva impossível.
//
// Nada aqui é calculado no cliente. O plano vem do domínio
// (`GET /api/pessoas/[id]/plano-remocao`), inclusive as frases: a tela exibe,
// não interpreta. Quando o servidor executa, ele RECALCULA o plano dentro da
// transação — o que está na tela é preview, nunca autorização.
// ============================================================================

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, Loader2, Shield, Trash2, X } from "lucide-react"
import { LAYER } from "@/src/lib/ui/layers"

export interface FatoProtegidoUI {
  tipo: string
  quantidade: number
  descricao: string
}

export interface PlanoRemocaoUI {
  pessoaId: number
  pessoaNome: string
  processoIds: number[]
  requerenteNome: string | null
  removiveis: Record<string, number>
  fatosProtegidos: FatoProtegidoUI[]
  bloqueios: string[]
  podeHardDelete: boolean
  podeDesativar: boolean
  modoSugerido: "HARD" | "DESATIVAR"
}

/** Rótulo de cada contagem. O domínio conta; a tela nomeia. */
const ROTULO: Record<string, string> = {
  vinculoArvore: "vínculo com a árvore",
  vinculoProcesso: "vínculo com o processo",
  unioes: "união/casamento",
  necessidades: "necessidade documental",
  documentos: "documento operacional",
  passos: "passo de workflow",
  tarefas: "tarefa",
  participantesFinanceiros: "participante financeiro",
  receitasPrevistas: "receita prevista",
  custosPrevistos: "custo previsto",
  obrigacoesPrevistas: "obrigação prevista",
  distribuicoes: "distribuição financeira",
}

const plural = (n: number, rotulo: string) => (n === 1 ? rotulo : `${rotulo}s`)

/**
 * Montado só quando há pessoa a remover (o pai usa `key={pessoaId}`), então o
 * estado inicial JÁ é "carregando" e o efeito não precisa reiniciar nada de
 * forma síncrona — ele apenas resolve a busca.
 */
export function RemocaoPessoaModal({
  pessoaId,
  onFechar,
  onConfirmar,
  carregarPlano,
}: {
  pessoaId: number
  onFechar: () => void
  onConfirmar: (modo: "HARD" | "DESATIVAR") => Promise<void>
  carregarPlano: (id: number) => Promise<PlanoRemocaoUI | null>
}) {
  const [plano, setPlano] = useState<PlanoRemocaoUI | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [executando, setExecutando] = useState<"HARD" | "DESATIVAR" | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    carregarPlano(pessoaId)
      .then((p) => {
        if (cancelado) return
        if (p) setPlano(p)
        else setErro("Não foi possível montar o plano de remoção.")
      })
      .catch(() => { if (!cancelado) setErro("Não foi possível montar o plano de remoção.") })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [pessoaId, carregarPlano])

  if (typeof document === "undefined") return null

  const sairao = plano
    ? Object.entries(plano.removiveis).filter(([, n]) => n > 0)
    : []

  const executar = async (modo: "HARD" | "DESATIVAR") => {
    setExecutando(modo)
    setErro(null)
    try {
      await onConfirmar(modo)
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível concluir a remoção.")
    } finally {
      setExecutando(null)
    }
  }

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: LAYER.aboveProcessCritical }}>
      <div className="absolute inset-0 bg-[var(--overlay-modal)]" onClick={executando ? undefined : onFechar} />

      <div className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl bg-[var(--surface-primary)] shadow-[var(--elev-3)] border border-[var(--border-default)]">
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-[var(--border-default)] bg-[var(--surface-primary)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-secondary)]">Remover da árvore</h2>
            <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
              {plano ? plano.pessoaNome : "Verificando o que depende desta pessoa…"}
            </p>
          </div>
          <button
            onClick={onFechar}
            disabled={!!executando}
            className="rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-secondary)] disabled:opacity-40"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          {carregando && (
            <div className="flex items-center gap-2 py-8 text-sm text-[var(--text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Verificando dependências…
            </div>
          )}

          {!carregando && erro && (
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2.5 text-sm text-red-700">
              {erro}
            </div>
          )}

          {!carregando && plano && (
            <div className="space-y-4">
              {/* ── SERÃO REMOVIDOS ────────────────────────────────────── */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  Serão removidos
                </h3>
                {sairao.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--text-secondary)]">
                    Nada além do vínculo — esta pessoa ainda não gerou dados no processo.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {sairao.map(([chave, n]) => (
                      <li key={chave} className="flex items-baseline gap-2 text-sm text-[var(--text-secondary)]">
                        <span className="min-w-[2rem] text-right font-medium tabular-nums text-[var(--text-secondary)]">{n}</span>
                        <span>{plural(n, ROTULO[chave] ?? chave)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* ── SERÃO PRESERVADOS ──────────────────────────────────── */}
              {plano.fatosProtegidos.length > 0 && (
                <section className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-3">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
                    <Shield className="h-3.5 w-3.5" />
                    Serão preservados
                  </h3>
                  <ul className="mt-2 space-y-1">
                    {plano.fatosProtegidos.map((f) => (
                      <li key={f.tipo} className="text-sm text-amber-900">{f.descricao}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-amber-700">
                    Histórico não se apaga. Por isso a exclusão definitiva está indisponível:
                    esta pessoa sai da operação ativa e o registro permanece.
                  </p>
                </section>
              )}

              {plano.requerenteNome && (
                <p className="text-xs text-[var(--text-secondary)]">
                  O cadastro de cliente <span className="font-medium text-[var(--text-secondary)]">{plano.requerenteNome}</span> não
                  é apagado — ele pode existir em outros processos.
                </p>
              )}

              {plano.bloqueios.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2.5 text-sm text-red-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{plano.bloqueios.join(" · ")}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── AÇÕES ─────────────────────────────────────────────────────── */}
        {!carregando && plano && (
          <div className="sticky bottom-0 flex flex-col gap-2 border-t border-[var(--border-default)] bg-[var(--surface-primary)] px-5 py-4">
            {plano.podeHardDelete ? (
              <button
                onClick={() => executar("HARD")}
                disabled={!!executando}
                className="flex items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-medium text-[var(--action-primary-ink)] transition-colors hover:bg-red-800 disabled:opacity-60"
              >
                {executando === "HARD" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Excluir definitivamente
              </button>
            ) : (
              <button
                onClick={() => executar("DESATIVAR")}
                disabled={!!executando || !plano.podeDesativar}
                className="flex items-center justify-center gap-2 rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-medium text-[var(--action-primary-ink)] transition-colors hover:bg-amber-800 disabled:opacity-60"
              >
                {executando === "DESATIVAR" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                Remover da árvore e preservar histórico
              </button>
            )}
            <button
              onClick={onFechar}
              disabled={!!executando}
              className="rounded-lg px-4 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] disabled:opacity-40"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
