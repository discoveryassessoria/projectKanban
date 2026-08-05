"use client"

// src/components/arvore/inteligencia/paleta-comandos.tsx
// ============================================================================
// BUSCA POR COMANDO (⌘K) — tela NOVA, sobreposta; a árvore não muda.
//
// Numa árvore com centenas de pessoas, achar alguém arrastando o canvas é
// inviável. Esta paleta pesquisa pelo índice que o motor já monta — nome,
// sobrenome, locais, cartório, datas — e leva direto à pessoa.
//
// Por que ela não altera o layout: é um overlay `fixed` que só existe enquanto
// está aberta, e o que ela faz ao escolher é NAVEGAR (centralizar/selecionar),
// não redesenhar. Fechada, não há nenhum nó a mais na árvore.
//
// O resultado mostra POR QUE casou ("Cartório: Bianchi") em vez de só o nome:
// numa família com cinco "Maria Silva", o motivo é o que distingue.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react"
import { Search, CornerDownLeft } from "lucide-react"
import { buscar, type ItemIndice, type ResultadoBusca } from "@/src/lib/genealogia/motor/busca"

interface Props {
  indice: ItemIndice[]
  aberto: boolean
  onFechar: () => void
  onEscolher: (pessoaId: number) => void
}

export function PaletaComandos({ indice, aberto, onFechar, onEscolher }: Props) {
  const [termo, setTermo] = useState("")
  const [ativo, setAtivo] = useState(0)
  const campoRef = useRef<HTMLInputElement>(null)

  const resultados: ResultadoBusca[] = useMemo(
    () => (termo.trim().length >= 1 ? buscar(indice, termo, 12) : []),
    [indice, termo],
  )

  // Foco no campo assim que abre — mexer no DOM é efeito, e este roda na
  // montagem do conteúdo, que é exatamente quando a paleta aparece.
  useEffect(() => {
    if (aberto) campoRef.current?.focus()
  }, [aberto])

  // O destaque pertence ao termo: digitar outra coisa volta ao primeiro item.
  const ativoEfetivo = ativo < resultados.length ? ativo : 0

  if (!aberto) return null

  const escolher = (pessoaId: number) => {
    onEscolher(pessoaId)
    onFechar()
    setTermo("")
  }

  const teclado = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onFechar(); return }
    if (!resultados.length) return
    if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((i) => (i + 1) % resultados.length) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((i) => (i - 1 + resultados.length) % resultados.length) }
    else if (e.key === "Enter") { e.preventDefault(); escolher(resultados[ativoEfetivo].pessoaId) }
  }

  return (
    <>
      <div className="fixed inset-0 z-[10003] bg-black/20" onClick={onFechar} />
      <div
        role="dialog"
        aria-label="Buscar pessoa na árvore"
        // Cor própria na raiz — ver comentário equivalente em tree-onboarding.tsx.
        className="fixed left-1/2 top-[15%] z-[10004] w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-gray-200 bg-white text-gray-900 shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-gray-100 px-4">
          <Search className="h-4 w-4 shrink-0 text-gray-400" />
          <input
            ref={campoRef}
            value={termo}
            onChange={(e) => { setTermo(e.target.value); setAtivo(0) }}
            onKeyDown={teclado}
            placeholder="Buscar por nome, local, cartório…"
            className="w-full bg-transparent py-3.5 text-sm text-gray-900 outline-none placeholder:text-gray-400"
          />
          <kbd className="hidden shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-400 sm:block">esc</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {termo.trim() && resultados.length === 0 && (
            <p className="px-4 py-8 text-center text-[13px] text-gray-400">
              Ninguém encontrado para “{termo}”.
            </p>
          )}
          {!termo.trim() && (
            <p className="px-4 py-8 text-center text-[13px] text-gray-400">
              {indice.length} pessoa(s) nesta árvore. Digite para buscar.
            </p>
          )}
          {resultados.map((r, i) => (
            <button
              key={r.pessoaId}
              onMouseEnter={() => setAtivo(i)}
              onClick={() => escolher(r.pessoaId)}
              className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition ${
                i === ativoEfetivo ? "bg-gray-50" : ""
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-900">{r.nome}</span>
                <span className="block truncate text-[12px] text-gray-500">
                  {r.subtitulo}
                  {r.motivo ? ` · ${r.motivo}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {r.naLinha && (
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">
                    linha
                  </span>
                )}
                {i === ativoEfetivo && <CornerDownLeft className="h-3.5 w-3.5 text-gray-300" />}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
