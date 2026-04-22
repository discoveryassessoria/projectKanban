// src/components/financeiro/subabas/VisaoGeralFinanceiro.tsx
"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import type { FinanceiroContext } from "@/src/types/financeiro-context"
import { fmtBRL } from "@/src/lib/financeiro/helpers-v2"
import {
  gerarResumoExecutivoPDF, gerarDREPDF, gerarPrestacaoContasPDF,
  gerarExtratoReceitasPDF, gerarExtratoCustosPDF
} from "@/src/lib/pdf/gerar-relatorios"
import { DetalhesKPIModal } from "@/src/components/financeiro/modals/DetalhesKPIModal"

export function VisaoGeralFinanceiro({ ctx }: { ctx: FinanceiroContext }) {
  const [dropOpen, setDropOpen] = useState(false)
  const [kpiModal, setKpiModal] = useState<null | "totalCobrado" | "recebido" | "aReceber" | "vencido">(null)
  const r = ctx.resumo

  const procCtx = {
    nome: ctx.nomeFamilia, pais: ctx.pais, etapaAtual: ctx.etapaAtual,
    requerentes: ctx.pessoas.filter(p => p.tipo === "REQUERENTE").map(p => p.nome)
  }

  const dadosRel = {
    faturas: ctx.faturas,
    pastaTotal: ctx.pastaTotal,
    pastaPago: ctx.pastaPago,
    pastaDetalhes: ctx.pastaDetalhes,
    contasPagar: ctx.contasPagar,
    resumo: r,
    ctx: procCtx
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900">📊 Visão Geral do Financeiro</h2>
          <p className="text-sm text-gray-500">Indicadores consolidados do processo</p>
        </div>
        <div className="relative">
          <button
            onClick={() => setDropOpen(!dropOpen)}
            className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50 flex items-center gap-2"
          >
            ⬇ Relatórios <ChevronDown className="h-4 w-4" />
          </button>
          {dropOpen && (
            <div className="absolute right-0 mt-1 bg-white border rounded-lg shadow-lg z-20 min-w-[260px]">
              <button onClick={() => { gerarResumoExecutivoPDF(dadosRel); setDropOpen(false) }}
                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b">
                Resumo Executivo (PDF)
              </button>
              <button onClick={() => { gerarDREPDF(dadosRel); setDropOpen(false) }}
                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b">
                DRE do Processo (PDF)
              </button>
              <button onClick={() => { gerarPrestacaoContasPDF(dadosRel); setDropOpen(false) }}
                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b">
                Prestação de Contas (PDF)
              </button>
              <button onClick={() => { gerarExtratoReceitasPDF(dadosRel); setDropOpen(false) }}
                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-b">
                Extrato de Receitas (PDF)
              </button>
              <button onClick={() => { gerarExtratoCustosPDF(dadosRel); setDropOpen(false) }}
                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50">
                Extrato de Custos (PDF)
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <KPI label="Total Cobrado" valor={fmtBRL(r.totalCobrado)} cor="violet" onClick={() => setKpiModal("totalCobrado")} />
        <KPI label="Recebido" valor={fmtBRL(r.recebido)} cor="green" sub={`${r.pctRecebido.toFixed(1)}%`} onClick={() => setKpiModal("recebido")} />
        <KPI label="A Receber" valor={fmtBRL(r.aReceber)} cor="orange" sub={`${r.pendentesCount} pendente(s)`} onClick={() => setKpiModal("aReceber")} />
        <KPI label="Vencido" valor={fmtBRL(r.vencido)} cor="red" sub={`${r.vencidasCount} vencida(s)`} onClick={() => setKpiModal("vencido")} />
      </div>

      <div className="bg-gradient-to-r from-violet-50 to-violet-100 border border-violet-200 rounded-xl p-6 mb-6">
        <div className="text-xs font-bold text-violet-700 uppercase tracking-wider mb-2">Saldo atual no processo</div>
        <div className="text-4xl font-extrabold text-violet-900 tabular-nums">
          {fmtBRL(r.recebido - r.custoPago)}
        </div>
        <div className="text-sm text-violet-700 mt-1">
          Recebido {fmtBRL(r.recebido)} − Pago {fmtBRL(r.custoPago)}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <KPI label="Custo Total" valor={fmtBRL(r.custo)} cor="gray" sub={`${r.pctPago.toFixed(1)}% pago`} />
        <KPI label="Lucro Projetado" valor={fmtBRL(r.lucro)} cor="blue" />
        <KPI label="Margem" valor={`${r.margem.toFixed(1)}%`} cor="violet" sub={r.margem > 70 ? "Excelente" : r.margem > 50 ? "Boa" : "Atenção"} />
      </div>

      {kpiModal && <DetalhesKPIModal qual={kpiModal} ctx={ctx} onClose={() => setKpiModal(null)} />}
    </div>
  )
}

function KPI({ label, valor, cor, sub, onClick }: any) {
  const classes: Record<string, string> = {
    violet: "bg-violet-50 border-violet-200 text-violet-900",
    green: "bg-green-50 border-green-200 text-green-900",
    orange: "bg-orange-50 border-orange-200 text-orange-900",
    red: "bg-red-50 border-red-200 text-red-900",
    gray: "bg-gray-50 border-gray-200 text-gray-900",
    blue: "bg-blue-50 border-blue-200 text-blue-900",
  }
  const labelColor: Record<string, string> = {
    violet: "text-violet-700", green: "text-green-700", orange: "text-orange-700",
    red: "text-red-700", gray: "text-gray-600", blue: "text-blue-700",
  }
  return (
    <div
      className={`${classes[cor]} border rounded-xl p-4 ${onClick ? "cursor-pointer hover:shadow-md transition" : ""}`}
      onClick={onClick}
    >
      <div className={`text-[10.5px] font-bold uppercase tracking-wider mb-2 ${labelColor[cor]}`}>{label}</div>
      <div className="text-2xl font-extrabold tabular-nums">{valor}</div>
      {sub && <div className={`text-xs font-medium mt-1 ${labelColor[cor]}`}>{sub}</div>}
    </div>
  )
}