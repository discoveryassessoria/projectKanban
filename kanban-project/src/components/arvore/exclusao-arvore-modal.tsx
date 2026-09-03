"use client"

// src/components/arvore/exclusao-arvore-modal.tsx
// ============================================================================
// EXCLUSÃO DA ÁRVORE INTEIRA — mesma disciplina da remoção de UMA pessoa
// (`remocao-pessoa-modal.tsx`), só que somada para toda a árvore, e com a
// mesma barreira de "exclusão definitiva" que o resto do sistema usa para
// ações irreversíveis de alto raio (frase de confirmação digitada).
//
// Nada aqui é calculado no cliente: o plano vem de
// `GET /api/arvore/[id]/plano-exclusao`, e o `DELETE` RECALCULA o mesmo plano
// dentro da execução — o que a tela mostra é preview, nunca autorização.
// ============================================================================

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, Loader2, Shield, Trash2, X } from "lucide-react"
import { LAYER } from "@/src/lib/ui/layers"

const FRASE_CONFIRMACAO = "EXCLUIR DEFINITIVAMENTE"

export interface RemoviveisArvoreUI {
  vinculoArvore: number
  vinculoProcesso: number
  unioes: number
  necessidades: number
  documentos: number
  passos: number
  tarefas: number
  participantesFinanceiros: number
  receitasPrevistas: number
  custosPrevistos: number
  obrigacoesPrevistas: number
  distribuicoes: number
}

export interface PessoaImpedidaUI {
  pessoaId: number
  pessoaNome: string
  fatosProtegidos: { tipo: string; quantidade: number; descricao: string }[]
}

export interface PlanoExclusaoArvoreUI {
  arvoreId: number
  arvoreNome: string
  totalPessoas: number
  removiveis: RemoviveisArvoreUI
  impedidas: PessoaImpedidaUI[]
  podeExcluir: boolean
}

const ROTULO: Record<string, string> = {
  vinculoArvore: "pessoa na árvore",
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

export function ExclusaoArvoreModal({
  arvoreId,
  onFechar,
  onExcluida,
  carregarPlano,
  executar,
}: {
  arvoreId: number
  onFechar: () => void
  onExcluida: () => void
  carregarPlano: (arvoreId: number) => Promise<PlanoExclusaoArvoreUI | null>
  executar: (arvoreId: number, confirmacao: string) => Promise<void>
}) {
  const [plano, setPlano] = useState<PlanoExclusaoArvoreUI | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [frase, setFrase] = useState("")
  const [executando, setExecutando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    carregarPlano(arvoreId)
      .then((p) => {
        if (cancelado) return
        if (p) setPlano(p)
        else setErro("Não foi possível montar o plano de exclusão.")
      })
      .catch(() => { if (!cancelado) setErro("Não foi possível montar o plano de exclusão.") })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [arvoreId, carregarPlano])

  if (typeof document === "undefined") return null

  const sairao = plano ? Object.entries(plano.removiveis).filter(([, n]) => n > 0) : []
  const fraseOk = frase.trim() === FRASE_CONFIRMACAO

  const confirmar = async () => {
    if (!fraseOk) return
    setExecutando(true)
    setErro(null)
    try {
      await executar(arvoreId, frase.trim())
      onExcluida()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível excluir a árvore.")
    } finally {
      setExecutando(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: LAYER.aboveProcessCritical }}>
      <div className="absolute inset-0 bg-[var(--overlay-modal)]" onClick={executando ? undefined : onFechar} />

      <div className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl bg-[var(--surface-primary)] shadow-[var(--elev-3)] border border-[var(--border-default)]">
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-[var(--border-default)] bg-[var(--surface-primary)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-red-700">Excluir árvore inteira</h2>
            <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
              {plano ? plano.arvoreNome : "Verificando o que depende desta árvore…"}
            </p>
          </div>
          <button
            onClick={onFechar}
            disabled={executando}
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
              Verificando dependências de {arvoreId ? "toda a árvore" : "a árvore"}…
            </div>
          )}

          {!carregando && erro && !plano && (
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2.5 text-sm text-red-700">
              {erro}
            </div>
          )}

          {!carregando && plano && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--text-secondary)]">
                Esta ação apaga <b>{plano.totalPessoas}</b> {plural(plano.totalPessoas, "pessoa")} da árvore e tudo
                o que foi derivado delas nos processos. É <b>irreversível</b>.
              </p>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  Serão removidos
                </h3>
                {sairao.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--text-secondary)]">
                    Árvore sem pessoas — nada além do registro da árvore em si.
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

              {plano.impedidas.length > 0 && (
                <section className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-3">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
                    <Shield className="h-3.5 w-3.5" />
                    Impede a exclusão
                  </h3>
                  <ul className="mt-2 space-y-1.5">
                    {plano.impedidas.map((p) => (
                      <li key={p.pessoaId} className="text-sm text-amber-900">
                        <span className="font-medium">{p.pessoaNome}</span>
                        {" — "}
                        {p.fatosProtegidos.map((f) => f.descricao).join(", ")}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-amber-800">
                    Histórico não se apaga. Enquanto qualquer pessoa da árvore tiver fato protegido, a
                    árvore inteira não pode ser excluída — remova (ou desative) essas pessoas primeiro,
                    uma a uma, pela árvore.
                  </p>
                </section>
              )}

              {plano.podeExcluir && (
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-3 space-y-2">
                  <div className="flex items-start gap-2 text-sm text-red-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>Esta ação é irreversível. Para confirmar, digite exatamente:</span>
                  </div>
                  <div className="text-sm font-mono font-bold text-red-700">{FRASE_CONFIRMACAO}</div>
                  <input
                    value={frase}
                    onChange={(e) => setFrase(e.target.value)}
                    placeholder={FRASE_CONFIRMACAO}
                    disabled={executando}
                    className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm outline-none focus:border-red-400 disabled:opacity-60"
                  />
                </div>
              )}

              {erro && (
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2.5 text-sm text-red-700">
                  {erro}
                </div>
              )}
            </div>
          )}
        </div>

        {!carregando && plano && (
          <div className="sticky bottom-0 flex flex-col gap-2 border-t border-[var(--border-default)] bg-[var(--surface-primary)] px-5 py-4">
            {plano.podeExcluir && (
              <button
                onClick={() => void confirmar()}
                disabled={executando || !fraseOk}
                className="flex items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-medium text-[var(--action-primary-ink)] transition-colors hover:bg-red-800 disabled:opacity-40"
              >
                {executando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Excluir árvore definitivamente
              </button>
            )}
            <button
              onClick={onFechar}
              disabled={executando}
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
