// src/app/financeiro/v3/receita/[ref]/page.tsx
// ============================================================================
// Rota dedicada da RECEITA (Financeiro V3) — wrapper fino sobre ReceitaDetalheView.
// Mantém URL direta / refresh funcionando; a lógica vive no componente reutilizável
// (também embutido no modal do processo via ProcessoFinanceiroShell).
// ============================================================================
"use client"

import { use } from "react"
import { useRouter } from "next/navigation"
import { ReceitaDetalheView } from "@/src/components/financeiro/v3/ReceitaDetalheView"

export default function ReceitaV3Page({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = use(params)
  const router = useRouter()
  return <div className="min-h-screen bg-[var(--app-background)] px-6 py-5"><ReceitaDetalheView refParam={ref} onVoltar={() => router.back()} /></div>
}
