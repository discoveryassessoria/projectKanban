// CRIAR EM: src/components/icons/management-icon.tsx
//
// Ícone "Gerenciamento" (sliders) no padrão dos outros ícones customizados.
// Recebe { className, filled }. filled=false → bolinhas VAZADAS (só contorno);
// filled=true (rota ativa) → bolinhas PREENCHIDAS de branco.
//
// As linhas dos trilhos PARAM na borda de cada círculo (não passam por dentro),
// por isso a bolinha fica realmente oca quando off.

import * as React from "react"

interface IconProps {
  className?: string
  filled?: boolean
}

export function ManagementIcon({ className, filled }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Trilho de cima: bolinha em x=9 (r=3) → segmentos param em 6 e 12 */}
      <line x1="4" y1="8" x2="6" y2="8" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <line x1="12" y1="8" x2="20" y2="8" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />

      {/* Trilho de baixo: bolinha em x=15 (r=3) → segmentos param em 12 e 18 */}
      <line x1="4" y1="16" x2="12" y2="16" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <line x1="18" y1="16" x2="20" y2="16" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />

      {/* Bolinhas — vazadas quando off, sólidas quando on */}
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth={2} fill={filled ? "currentColor" : "none"} />
      <circle cx="15" cy="16" r="3" stroke="currentColor" strokeWidth={2} fill={filled ? "currentColor" : "none"} />
    </svg>
  )
}