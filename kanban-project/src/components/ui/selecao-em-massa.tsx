"use client"

// src/components/ui/selecao-em-massa.tsx
//
// SELEÇÃO MÚLTIPLA E AÇÃO EM MASSA — um componente só, para todas as listas.
//
// ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
// Apagar 30 registros um a um são 30 cliques, 30 confirmações e 30 chances de
// errar a linha. A operação pediu seleção múltipla "em todas as telas" — e a
// forma errada de atender seria copiar checkbox e barra de ação tela a tela, que
// é como um produto ganha cinco comportamentos diferentes para o mesmo gesto.
//
// ─── AS DUAS REGRAS QUE ESTE COMPONENTE CARREGA ─────────────────────────────
// 1. A EXCLUSÃO EM MASSA NÃO INVENTA PODER. Ela chama a MESMA porta de exclusão
//    de uma linha, uma vez por item. É por isso que a proteção que já existe —
//    "não excluo o que está em uso" — continua valendo, e o resultado volta
//    honesto: "12 excluídos, 3 recusados porque estão em uso", com o motivo de
//    cada recusa. Um endpoint de lote próprio teria que reimplementar a guarda,
//    e no dia em que divergisse, apagaria o que a tela de uma linha recusava.
// 2. UMA CONFIRMAÇÃO, COM A CONTAGEM. Não N confirmações — isso treina o
//    operador a clicar "sim" sem ler, que é o oposto de proteger.
//
// A seleção é por ID e vive na tela; ela se limpa sozinha quando o filtro muda,
// senão o operador apagaria linhas que não está mais vendo.

import { useCallback, useEffect, useMemo, useState } from "react"

export interface ResultadoEmMassa {
  excluidos: number
  recusados: { id: number | string; motivo: string }[]
}

/** Estado da seleção. `chaveDoContexto` limpa a seleção quando o filtro muda. */
export function useSelecaoEmMassa<T extends number | string>(
  idsVisiveis: T[],
  chaveDoContexto?: string,
) {
  const [selecionados, setSelecionados] = useState<Set<T>>(new Set())

  // Filtro mudou = outra lista. Manter a seleção aqui seria apagar o que não
  // está mais na tela — o operador confirmaria uma contagem e aconteceria outra.
  useEffect(() => { setSelecionados(new Set()) }, [chaveDoContexto])

  // Item que saiu da lista sai da seleção: mesma razão.
  useEffect(() => {
    setSelecionados((atual) => {
      if (atual.size === 0) return atual
      const visiveis = new Set(idsVisiveis)
      const filtrado = new Set([...atual].filter((id) => visiveis.has(id)))
      return filtrado.size === atual.size ? atual : filtrado
    })
  }, [idsVisiveis])

  const alternar = useCallback((id: T) => {
    setSelecionados((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(id)) proximo.delete(id)
      else proximo.add(id)
      return proximo
    })
  }, [])

  const todosMarcados = idsVisiveis.length > 0 && idsVisiveis.every((id) => selecionados.has(id))
  const algumMarcado = selecionados.size > 0 && !todosMarcados

  const alternarTodos = useCallback(() => {
    setSelecionados((atual) => (idsVisiveis.every((id) => atual.has(id)) ? new Set<T>() : new Set(idsVisiveis)))
  }, [idsVisiveis])

  const limpar = useCallback(() => setSelecionados(new Set()), [])

  return useMemo(
    () => ({ selecionados, alternar, alternarTodos, limpar, todosMarcados, algumMarcado, quantidade: selecionados.size }),
    [selecionados, alternar, alternarTodos, limpar, todosMarcados, algumMarcado],
  )
}

/**
 * Executa a ação item a item, com concorrência limitada, e AGREGA o resultado.
 *
 * Concorrência limitada de propósito: 30 DELETEs simultâneos disputam conexão do
 * banco com quem está operando o sistema no mesmo momento.
 */
export async function executarEmMassa<T extends number | string>(
  ids: T[],
  acao: (id: T) => Promise<{ ok: boolean; motivo?: string }>,
  concorrencia = 4,
): Promise<ResultadoEmMassa> {
  const fila = [...ids]
  const recusados: { id: T; motivo: string }[] = []
  let excluidos = 0

  async function trabalhador() {
    for (;;) {
      const id = fila.shift()
      if (id === undefined) return
      try {
        const r = await acao(id)
        if (r.ok) excluidos++
        else recusados.push({ id, motivo: r.motivo || "Recusado." })
      } catch (e) {
        recusados.push({ id, motivo: e instanceof Error ? e.message : "Falha inesperada." })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concorrencia, Math.max(ids.length, 1)) }, trabalhador))
  return { excluidos, recusados }
}

/** A caixa de uma linha. Para no clique para não abrir/editar a linha junto. */
export function CaixaDeSelecao({
  marcada, onAlternar, rotulo,
}: { marcada: boolean; onAlternar: () => void; rotulo: string }) {
  return (
    <input
      type="checkbox"
      checked={marcada}
      aria-label={rotulo}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => { e.stopPropagation(); onAlternar() }}
      className="h-4 w-4 cursor-pointer accent-[var(--action-primary)]"
    />
  )
}

/** A caixa do cabeçalho — marca/desmarca tudo o que está VISÍVEL (nunca o que o filtro escondeu). */
export function CaixaDeSelecaoTodos({
  todosMarcados, algumMarcado, onAlternar,
}: { todosMarcados: boolean; algumMarcado: boolean; onAlternar: () => void }) {
  return (
    <input
      type="checkbox"
      checked={todosMarcados}
      ref={(el) => { if (el) el.indeterminate = algumMarcado }}
      aria-label="Selecionar todos os itens visíveis"
      onChange={onAlternar}
      className="h-4 w-4 cursor-pointer accent-[var(--action-primary)]"
    />
  )
}

/**
 * A barra que aparece com a seleção. Não é modal: ela informa, dá a ação e some.
 * Fica presa ao topo da lista para não sumir no scroll de uma lista longa.
 */
export function BarraDeSelecao({
  quantidade, substantivo, genero = "m", onLimpar, onExcluir, excluindo, acoesExtras,
}: {
  quantidade: number
  /** "organização"/"organizações" — a barra fala do que a tela lista. */
  substantivo: [string, string]
  /** Gênero do substantivo, para o particípio concordar ("selecionadas"). */
  genero?: "f" | "m"
  onLimpar: () => void
  onExcluir?: () => void
  excluindo?: boolean
  acoesExtras?: React.ReactNode
}) {
  if (quantidade === 0) return null
  const [singular, plural] = substantivo
  const vogal = genero === "f" ? "a" : "o"
  return (
    <div className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-secondary)] px-4 py-2.5 shadow-[var(--elev-2)]">
      <span className="text-sm font-semibold text-[var(--text-primary)]">
        {quantidade} {quantidade === 1 ? singular : plural} selecionad{vogal}{quantidade === 1 ? "" : "s"}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {acoesExtras}
        <button
          type="button"
          onClick={onLimpar}
          disabled={excluindo}
          className="rounded-md px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
        >
          Limpar seleção
        </button>
        {onExcluir && (
          <button
            type="button"
            onClick={onExcluir}
            disabled={excluindo}
            className="rounded-md px-3 py-1.5 text-sm font-semibold text-[var(--danger-solid-ink)] disabled:opacity-60"
            style={{ backgroundColor: "var(--danger-solid)" }}
          >
            {excluindo ? "Excluindo…" : `Excluir ${quantidade === 1 ? singular : plural}`}
          </button>
        )}
      </div>
    </div>
  )
}

/** O relatório do que aconteceu. Recusa NÃO é erro do sistema: é a guarda funcionando. */
export function ResumoEmMassa({
  resultado, substantivo, genero = "m", rotuloDoItem, onFechar,
}: {
  resultado: ResultadoEmMassa | null
  substantivo: [string, string]
  genero?: "f" | "m"
  rotuloDoItem?: (id: number | string) => string
  onFechar: () => void
}) {
  if (!resultado) return null
  const [singular, plural] = substantivo
  const vogal = genero === "f" ? "a" : "o"
  const houveRecusa = resultado.recusados.length > 0
  return (
    <div
      className="mb-3 rounded-lg border px-4 py-3 text-sm"
      style={{
        borderColor: houveRecusa ? "var(--warning)" : "var(--success)",
        backgroundColor: houveRecusa ? "var(--warning-tile)" : "var(--success-tile)",
        color: "var(--text-primary)",
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold">
            {resultado.excluidos} {resultado.excluidos === 1 ? singular : plural} excluíd{vogal}{resultado.excluidos === 1 ? "" : "s"}
            {houveRecusa && ` · ${resultado.recusados.length} recusad${vogal}${resultado.recusados.length === 1 ? "" : "s"}`}
          </p>
          {houveRecusa && (
            <ul className="mt-1.5 space-y-0.5 text-[13px]">
              {resultado.recusados.slice(0, 8).map((r) => (
                <li key={String(r.id)}>
                  <span className="font-medium">{rotuloDoItem?.(r.id) ?? `#${r.id}`}</span> — {r.motivo}
                </li>
              ))}
              {resultado.recusados.length > 8 && (
                <li className="opacity-80">…e mais {resultado.recusados.length - 8}.</li>
              )}
            </ul>
          )}
        </div>
        <button type="button" onClick={onFechar} className="shrink-0 text-[13px] underline">Fechar</button>
      </div>
    </div>
  )
}
