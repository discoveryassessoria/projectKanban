"use client"

// src/components/arvore/vincular-conjuge-modal.tsx
// ============================================================================
// VINCULAR CÔNJUGE — casar duas pessoas que JÁ existem na árvore (casal sem filho
// cadastrado), com data e local do casamento no vínculo.
//
// O modal não escreve nada sozinho: `executar` é a função da tela, que roda o
// comando `comandoVincularConjuges` pela rota oficial (POST /api/unioes → a união,
// o estado civil e a reavaliação documental na MESMA transação, §37). Erro do
// servidor aparece AQUI, dentro do modal, sem fechá-lo. (Esc fecha pela captura
// global da árvore.)
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, Heart, Loader2, X } from "lucide-react"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { LAYER } from "@/src/lib/ui/layers"
import type { PessoaArvore } from "./types"
import { nomeCompleto, type DadosDoVinculoConjugal } from "@/src/lib/genealogia/vinculos-edicao"

export function VincularConjugeModal({
  pessoa,
  candidatos,
  outraPessoaIdInicial,
  onFechar,
  executar,
}: {
  pessoa: PessoaArvore
  /** Pessoas da MESMA árvore que podem ser o cônjuge (já sem a própria pessoa e sem quem já é cônjuge dela). */
  candidatos: PessoaArvore[]
  outraPessoaIdInicial: number | null
  onFechar: () => void
  /** Devolve `null` quando deu certo, ou a mensagem do servidor. */
  executar: (dados: DadosDoVinculoConjugal) => Promise<string | null>
}) {
  const [conjugeId, setConjugeId] = useState<number | "">(
    outraPessoaIdInicial != null && candidatos.some((c) => c.id === outraPessoaIdInicial) ? outraPessoaIdInicial : "",
  )
  const [data, setData] = useState("")
  const [local, setLocal] = useState("")
  const [executando, setExecutando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const seletorRef = useRef<HTMLSelectElement>(null)

  useEffect(() => { seletorRef.current?.focus() }, [])

  const ordenados = useMemo(
    () => [...candidatos].sort((a, b) => nomeCompleto(a).localeCompare(nomeCompleto(b), "pt-BR")),
    [candidatos],
  )

  if (typeof document === "undefined") return null

  const escolhida = ordenados.find((c) => c.id === conjugeId) ?? null

  const confirmar = async () => {
    if (!escolhida || executando) return
    setExecutando(true)
    setErro(null)
    const msg = await executar({
      pessoa1Id: pessoa.id,
      pessoa2Id: escolhida.id,
      pessoa1Nome: nomeCompleto(pessoa),
      pessoa2Nome: nomeCompleto(escolhida),
      dataCasamento: data ? new Date(data).toISOString() : null,
      localCasamento: local.trim() || null,
    })
    setExecutando(false)
    if (msg) setErro(msg)
  }

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: LAYER.aboveProcessDrawer }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="vincular-conjuge-titulo"
    >
      <div className="absolute inset-0 bg-[var(--overlay-modal)]" onClick={executando ? undefined : onFechar} />
      <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] shadow-[var(--elev-3)]">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-default)] px-5 py-4">
          <h2 id="vincular-conjuge-titulo" className="text-base font-semibold text-[var(--text-primary)]">
            Vincular cônjuge de {nomeCompleto(pessoa)}
          </h2>
          <button
            type="button"
            onClick={onFechar}
            disabled={executando}
            aria-label="Fechar"
            className="rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4 text-sm text-[var(--text-secondary)]">
          <p className="text-xs leading-snug">
            Une duas pessoas que já estão na árvore. Não é preciso ter filho cadastrado. A certidão de
            casamento passa a ser exigida conforme a regra documental, e o casamento pode ser desfeito depois (Ctrl+Z).
          </p>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide">Cônjuge</span>
            <select
              ref={seletorRef}
              value={conjugeId}
              onChange={(e) => setConjugeId(e.target.value ? Number(e.target.value) : "")}
              disabled={executando}
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="">Selecione…</option>
              {ordenados.map((c) => (
                <option key={c.id} value={c.id}>{nomeCompleto(c)}</option>
              ))}
            </select>
            {ordenados.length === 0 && (
              <span className="mt-1 block text-xs">Não há outra pessoa na árvore para vincular.</span>
            )}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide">Data do casamento</span>
              <DatePickerField value={data} onChange={setData} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide">Local do casamento</span>
              <input
                type="text"
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                disabled={executando}
                placeholder="Cidade - Estado"
                maxLength={100}
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </label>
          </div>

          {erro && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2.5 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{erro}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-[var(--border-default)] px-5 py-4">
          <button
            type="button"
            onClick={() => void confirmar()}
            disabled={executando || !escolhida}
            className="flex items-center justify-center gap-2 rounded-lg bg-[var(--action-primary)] px-4 py-2.5 text-sm font-medium text-[var(--action-primary-ink)] transition-colors hover:bg-[var(--action-primary-hover)] disabled:opacity-40"
          >
            {executando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className="h-4 w-4" />}
            Vincular cônjuges
          </button>
          <button
            type="button"
            onClick={onFechar}
            disabled={executando}
            className="rounded-lg px-4 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] disabled:opacity-40"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
