import React, { useId } from "react"

interface BoardIconProps {
  className?: string
  filled?: boolean
}

/**
 * TAREFAS E PROJETOS — colunas dentro de um quadro.
 *
 * Mesma gramática dos demais ícones do menu (quadrado 18×18, raio 3, traço
 * 1.8, versão preenchida por máscara): o que muda de item para item é o
 * desenho de dentro, nunca a moldura. Duas colunas de alturas diferentes
 * dizem "trabalho distribuído em estados" sem depender de rótulo.
 */
export function BoardIcon({ className = "h-5 w-5", filled = false }: BoardIconProps) {
  const maskId = useId()
  const colunaEsquerda = "M9 8v8"
  const colunaDireita = "M15 8v4"

  if (filled) {
    return (
      <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width="24" height="24" fill="white" />
            <path d={colunaEsquerda} fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" />
            <path d={colunaDireita} fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" />
          </mask>
        </defs>
        {/* Borda externa */}
        <rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
        {/* Preenchimento com máscara */}
        <rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor" mask={`url(#${maskId})`} />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      {/* Quadrado com bordas arredondadas */}
      <rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      {/* Colunas */}
      <path d={colunaEsquerda} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d={colunaDireita} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
