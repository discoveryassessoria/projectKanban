"use client"
// src/components/torre/VoltarDaTorre.tsx — o "← Voltar" de toda página aberta a partir da Torre (acima da trilha). Regra em `lib/torre-voltar.ts`.
import { useRouter } from "next/navigation"
import { DESTINO_SEM_ANTERIOR, haPaginaAnteriorNoSistema, lerEntradaDoHistorico } from "@/src/lib/torre-voltar"

export function VoltarDaTorre() {
  const router = useRouter()
  const voltar = () => {
    if (haPaginaAnteriorNoSistema(lerEntradaDoHistorico())) router.back()
    else router.push(DESTINO_SEM_ANTERIOR)
  }
  return (
    <button type="button" className="tpr-voltar" onClick={voltar} aria-label="Voltar">← Voltar</button>
  )
}
