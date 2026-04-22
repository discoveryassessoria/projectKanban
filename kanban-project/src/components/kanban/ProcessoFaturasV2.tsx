// src/components/kanban/ProcessoFaturasV2.tsx
// ==============================================================
// VERSÃO NOVA — Coexiste com ProcessoFaturas.tsx original.
// 5 sub-abas (Visão Geral / Receitas / Custos / Extrato / Análise)
// ==============================================================

"use client"

import { useState, useEffect, useCallback } from "react"
import { Gem, TrendingUp, TrendingDown, AlignLeft, BarChart3 } from "lucide-react"
import { VisaoGeralFinanceiro } from "@/src/components/financeiro/subabas/VisaoGeralFinanceiro"
import { ReceitasLista } from "@/src/components/financeiro/subabas/ReceitasLista"
import { CustosLista } from "@/src/components/financeiro/subabas/CustosLista"
import { ExtratoTimeline } from "@/src/components/financeiro/subabas/ExtratoTimeline"
import { AnaliseProcesso } from "@/src/components/financeiro/subabas/AnaliseProcesso"
import { calcularResumo } from "@/src/lib/financeiro/helpers-v2"
import type {
  FaturaEnriquecida, ResumoFinanceiro, PessoaParaSelect
} from "@/src/types/financeiro-v2"
import type { FinanceiroContext } from "@/src/types/financeiro-context"

interface ProcessoFaturasV2Props {
  processoId: number
  nomeFamilia: string
  onUpdate?: () => void
}

type SubAba = "visao" | "receitas" | "custos" | "extrato" | "analise"

export function ProcessoFaturasV2({ processoId, nomeFamilia, onUpdate }: ProcessoFaturasV2Props) {
  const [subAba, setSubAba] = useState<SubAba>("visao")
  const [loading, setLoading] = useState(true)

  const [faturas, setFaturas] = useState<FaturaEnriquecida[]>([])
  const [pastaTotal, setPastaTotal] = useState(0)
  const [pastaPago, setPastaPago] = useState(0)
  const [pastaDetalhes, setPastaDetalhes] = useState<FinanceiroContext["pastaDetalhes"]>([])
  const [contasPagar, setContasPagar] = useState<FinanceiroContext["contasPagar"]>([])
  const [pessoas, setPessoas] = useState<PessoaParaSelect[]>([])
  const [pais, setPais] = useState("")
  const [etapaAtual, setEtapaAtual] = useState("")

  const authHeaders = () => ({
    "Content-Type": "application/json",
    "Authorization": `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") || "" : ""}`
  })

  const fetchDados = useCallback(async () => {
    setLoading(true)
    try {
      const [faturasRes, resumoRes] = await Promise.all([
        fetch(`/api/processos/${processoId}/faturas`, { headers: authHeaders() }),
        fetch(`/api/financeiro/resumo/${processoId}`, { headers: authHeaders() })
      ])
      const fat = await faturasRes.json()
      const res = await resumoRes.json()

      setFaturas(fat.faturas || [])
      setPastaTotal(res.pastaTotal || 0)
      setPastaPago(res.pastaPago || 0)
      setPastaDetalhes(res.pastaDetalhes || [])
      setContasPagar(res.contasPagar || [])
      setPessoas(res.pessoas || [])
      setPais(res.pais || "")
      setEtapaAtual(res.etapaAtual || "")
    } catch (e) {
      console.error("Erro ao carregar financeiro:", e)
    } finally {
      setLoading(false)
    }
  }, [processoId])

  useEffect(() => { fetchDados() }, [fetchDados])

  const resumo: ResumoFinanceiro = calcularResumo(faturas, pastaTotal, pastaPago, contasPagar)

  const refresh = () => {
    fetchDados()
    onUpdate?.()
  }

  const ctx: FinanceiroContext = {
    processoId, nomeFamilia, pais, etapaAtual,
    faturas, pessoas, pastaTotal, pastaPago, pastaDetalhes,
    contasPagar, resumo, refresh
  }

  const TABS: { id: SubAba; label: string; Icon: any }[] = [
    { id: "visao", label: "Visão Geral", Icon: Gem },
    { id: "receitas", label: "Receitas", Icon: TrendingUp },
    { id: "custos", label: "Custos", Icon: TrendingDown },
    { id: "extrato", label: "Extrato", Icon: AlignLeft },
    { id: "analise", label: "Análise", Icon: BarChart3 },
  ]

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        Carregando financeiro...
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="sticky top-0 z-10 bg-white border-b px-6 py-3 flex gap-2 flex-wrap">
        {TABS.map(t => {
          const ativa = subAba === t.id
          const Icon = t.Icon
          return (
            <button
              key={t.id}
              onClick={() => setSubAba(t.id)}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
                ${ativa ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}
              `}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {subAba === "visao" && <VisaoGeralFinanceiro ctx={ctx} />}
        {subAba === "receitas" && <ReceitasLista ctx={ctx} />}
        {subAba === "custos" && <CustosLista ctx={ctx} />}
        {subAba === "extrato" && <ExtratoTimeline ctx={ctx} />}
        {subAba === "analise" && <AnaliseProcesso ctx={ctx} />}
      </div>
    </div>
  )
}