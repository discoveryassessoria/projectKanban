"use client"
// src/components/torre/AtalhoAbrirProcessoParaAtribuir.tsx
// ============================================================================
// ATRIBUIÇÃO SÓ NA PÁGINA DO PROCESSO (07/10/2026). Fora de /torre/processo/[id] e do lote da Torre, a tela não atribui: mostra o responsável ATUAL e este atalho.
// O servidor também recusa a atribuição que não vem da página (`lib/operacional/atribuicao-origem.ts`), então nenhum botão aqui pode «fingir» atribuir.
// ============================================================================
import Link from "next/link"

export function AtalhoAbrirProcessoParaAtribuir({ processoId, className = "" }: { processoId: number | null | undefined; className?: string }) {
  if (processoId == null) return <span className="text-[11px] text-[var(--text-muted)]" data-testid="sem-processo-para-atribuir">Sem processo para atribuir</span>
  return (
    <Link href={`/torre/processo/${processoId}`} data-testid="abrir-processo-para-atribuir" title="A atribuição de responsável é feita na página do processo"
      className={`text-[12px] text-[var(--accent-text)] underline-offset-2 hover:underline ${className}`}>
      Abrir processo para atribuir
    </Link>
  )
}

/** O responsável atual, em texto — «Sem responsável» quando ninguém. */
export const textoDoResponsavelAtual = (nome: string | null | undefined): string => (nome && nome.trim() ? nome : "Sem responsável")
