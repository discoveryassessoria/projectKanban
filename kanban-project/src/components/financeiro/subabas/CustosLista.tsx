// src/components/financeiro/subabas/CustosLista.tsx
"use client"

import { useState, useMemo } from "react"
import { Search } from "lucide-react"
import type { FinanceiroContext } from "@/src/types/financeiro-context"
import { fmtBRL, fmtDataBR } from "@/src/lib/financeiro/helpers-v2"

// ⚠ IMPORTANTE: importar aqui o componente da SUA PLANILHA EXISTENTE
// da Pasta Documental (TipoServico + CustoPessoa).
// Ex: import { PlanilhaCustosPessoa } from "@/src/components/kanban/PlanilhaCustosPessoa"
// Depois substituir o placeholder amarelo abaixo.

export function CustosLista({ ctx }: { ctx: FinanceiroContext }) {
  const [busca, setBusca] = useState("")

  const contasFiltradas = useMemo(() => {
    return ctx.contasPagar
      .filter((c: any) => !busca ||
        c.descricao?.toLowerCase().includes(busca.toLowerCase()) ||
        c.fornecedor?.toLowerCase().includes(busca.toLowerCase())
      )
      .sort((a: any, b: any) => (a.dataVencimento || "").localeCompare(b.dataVencimento || ""))
  }, [ctx.contasPagar, busca])

  return (
    <div className="space-y-6">
      {/* PLANILHA PASTA DOCUMENTAL */}
      <div className="bg-white border rounded-xl p-4">
        <h3 className="text-base font-bold text-gray-900 mb-3">📋 Pasta Documental</h3>

        {/* ⚠ PLACEHOLDER — substituir pelo componente real */}
        {/* Exemplo: <PlanilhaCustosPessoa processoId={ctx.processoId} /> */}

        <div className="p-6 border-2 border-dashed border-amber-300 bg-amber-50 rounded-lg text-center text-sm text-amber-800">
          <strong>👉 Aqui é onde você deve renderizar seu componente atual</strong><br />
          da planilha da Pasta Documental (TipoServico + CustoPessoa).<br />
          Substitua este placeholder pelo import correto do seu componente existente.
        </div>
      </div>

      {/* CONTAS A PAGAR DO PROCESSO */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <div>
            <h3 className="text-base font-bold text-gray-900">💸 Contas a Pagar</h3>
            <p className="text-xs text-gray-500">Repasses a fornecedores vinculados a este processo</p>
          </div>
        </div>

        <div className="mb-3 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar contas..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"
          />
        </div>

        {contasFiltradas.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm border-2 border-dashed rounded-lg">
            Nenhuma conta a pagar vinculada a este processo.
          </div>
        ) : (
          <div className="space-y-2">
            {contasFiltradas.map((c: any) => (
              <CardConta key={c.id} conta={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CardConta({ conta }: { conta: any }) {
  const statusColors: Record<string, { bg: string; txt: string; lbl: string }> = {
    PAGO: { bg: "bg-green-100", txt: "text-green-800", lbl: "✓ Pago" },
    PENDENTE: { bg: "bg-amber-100", txt: "text-amber-800", lbl: "Pendente" },
    VENCIDO: { bg: "bg-red-100", txt: "text-red-800", lbl: "⚠ Vencido" },
    CANCELADO: { bg: "bg-gray-100", txt: "text-gray-600", lbl: "Cancelado" },
    AGENDADO: { bg: "bg-blue-100", txt: "text-blue-800", lbl: "Agendado" },
  }
  const st = statusColors[conta.status] || statusColors.PENDENTE

  return (
    <div className="bg-white border rounded-xl p-4 flex justify-between items-center">
      <div className="flex-1">
        <div className="font-semibold text-gray-900">{conta.descricao}</div>
        <div className="text-xs text-gray-500 mt-1">
          {conta.fornecedor && <span>🏢 {conta.fornecedor} · </span>}
          📅 Venc. {fmtDataBR(conta.dataVencimento)}
        </div>
      </div>
      <div className="text-right">
        <div className="font-bold text-lg tabular-nums">{fmtBRL(conta.valor)}</div>
        {conta.valorPago > 0 && (
          <div className="text-xs text-green-600">Pago: {fmtBRL(conta.valorPago)}</div>
        )}
        <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${st.bg} ${st.txt}`}>
          {st.lbl}
        </span>
      </div>
    </div>
  )
}