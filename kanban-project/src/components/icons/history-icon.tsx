// Ícone History customizado - seta encosta no arco
export function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Arco do relógio */}
      <path d="M3.5 16a9 9 0 1 0 0.5-8" />
      {/* Seta - moveu um pouquinho pra esquerda */}
      <path d="M1.4 6.8l0.9 3.5h4" />
      {/* Ponteiros */}
      <path d="M11 8.7v4l3 3" />
    </svg>
  )
}