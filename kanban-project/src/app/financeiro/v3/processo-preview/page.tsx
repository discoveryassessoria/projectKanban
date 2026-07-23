// src/app/financeiro/v3/processo-preview/page.tsx
// Visualização em página do Financeiro V3 do processo (mesmo componente do modal).
// Útil para acesso direto e validação visual. ?processoId=<id>.
"use client"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { HeaderBar } from "@/src/components/header-bar"
import { ProcessoFinanceiroV3 } from "@/src/components/financeiro/v3/ProcessoFinanceiroV3"

function Inner() {
  const sp = useSearchParams()
  const processoId = Number(sp.get("processoId") || 0)
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <HeaderBar title="Financeiro do Processo · V3" subtitle="Motor Financeiro · Ledger" />
      <div className="mx-auto max-w-5xl px-6 py-8">
        {processoId ? <ProcessoFinanceiroV3 processoId={processoId} /> : <div className="text-sm text-neutral-400">Informe ?processoId=&lt;id&gt; na URL.</div>}
      </div>
    </div>
  )
}
export default function Page() { return <Suspense><Inner /></Suspense> }
