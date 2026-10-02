"use client"

// src/components/arvore/menu-mais-arvore.tsx
// ============================================================================
// MENU "⋯" DA ÁRVORE — onde ficam as ações RARAS e IRREVERSÍVEIS.
//
// A lixeira vermelha vivia solta na barra de ferramentas, a um clique de
// distância de uma exclusão. Agora a barra só tem uma porta neutra ("Mais
// ações") e o item destrutivo mora dentro dela, sempre atrás de confirmação.
//
// Acessibilidade: botão com aria-label/aria-haspopup/aria-expanded; menu com
// role="menu"; setas ↑/↓ navegam, Home/End vão às pontas, Enter/Espaço ativam;
// Esc fecha (pelo dono único do Escape da árvore, ver EVENTO_FECHAR_CAMADA) e
// devolve o foco ao botão; clique fora fecha (useFecharFora).
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react"
import { MoreHorizontal, Trash2 } from "lucide-react"
import { useFecharFora, CLASSE_BOTAO_BARRA, EVENTO_FECHAR_CAMADA } from "./inteligencia/barra-linhagem"
import { LAYER } from "@/src/lib/ui/layers"

export interface ItemMenuArvore {
  chave: string
  rotulo: string
  /** Item destrutivo ganha a cor de perigo. */
  perigo?: boolean
  onSelecionar: () => void
}

export function MenuMaisArvore({ itens }: { itens: ItemMenuArvore[] }) {
  const [aberto, setAberto] = useState(false)
  const botaoRef = useRef<HTMLButtonElement>(null)
  const fechar = useCallback(() => {
    setAberto(false)
    botaoRef.current?.focus()
  }, [])
  const caixaRef = useFecharFora(aberto, () => setAberto(false))

  // Foco no primeiro item ao abrir — quem abre pelo teclado cai dentro do menu.
  useEffect(() => {
    if (!aberto) return
    const primeiro = caixaRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')
    primeiro?.focus()
  }, [aberto, caixaRef])

  // O Escape global fecha a camada por evento; devolver o foco ao botão aqui.
  useEffect(() => {
    if (!aberto) return
    const aoFechar = () => botaoRef.current?.focus()
    document.addEventListener(EVENTO_FECHAR_CAMADA, aoFechar)
    return () => document.removeEventListener(EVENTO_FECHAR_CAMADA, aoFechar)
  }, [aberto])

  if (itens.length === 0) return null

  const aoTeclar = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const botoes = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    const i = botoes.findIndex((b) => b === document.activeElement)
    if (e.key === "ArrowDown") { e.preventDefault(); botoes[(i + 1) % botoes.length]?.focus() }
    else if (e.key === "ArrowUp") { e.preventDefault(); botoes[(i - 1 + botoes.length) % botoes.length]?.focus() }
    else if (e.key === "Home") { e.preventDefault(); botoes[0]?.focus() }
    else if (e.key === "End") { e.preventDefault(); botoes[botoes.length - 1]?.focus() }
    else if (e.key === "Tab") { fechar() }
  }

  return (
    <div className="relative" ref={caixaRef}>
      <button
        ref={botaoRef}
        type="button"
        className={`${CLASSE_BOTAO_BARRA} !px-2`}
        onClick={() => setAberto((v) => !v)}
        title="Mais ações"
        aria-label="Mais ações da árvore"
        aria-haspopup="menu"
        aria-expanded={aberto}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {aberto && (
        <div
          role="menu"
          aria-label="Mais ações da árvore"
          onKeyDown={aoTeclar}
          className="absolute right-0 top-full mt-1 min-w-[14rem] overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] py-1 text-gray-900 shadow-[var(--elev-2)]"
          style={{ zIndex: LAYER.popover }}
        >
          {itens.map((item) => (
            <button
              key={item.chave}
              type="button"
              role="menuitem"
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-secondary)] focus:bg-[var(--surface-secondary)] focus:outline-none ${
                item.perigo ? "text-red-700" : "text-gray-900"
              }`}
              onClick={() => {
                setAberto(false)
                item.onSelecionar()
              }}
            >
              {item.perigo && <Trash2 className="h-4 w-4" aria-hidden="true" />}
              {item.rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
