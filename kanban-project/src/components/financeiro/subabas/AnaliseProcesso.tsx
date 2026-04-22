// src/components/financeiro/subabas/AnaliseProcesso.tsx
"use client"

import type { FinanceiroContext } from "@/src/types/financeiro-context"
import { fmtBRL } from "@/src/lib/financeiro/helpers-v2"

export function AnaliseProcesso({ ctx }: { ctx: FinanceiroContext }) {
  const r = ctx.resumo

  const porFornecedor: Record<string, number> = {}
  ctx.contasPagar.forEach((c: any) => {
    const forn = c.fornecedor || "Sem fornecedor"
    porFornecedor[forn] = (porFornecedor[forn] || 0) + Number(c.valor)
  })

  const porTipoReceita: Record<string, number> = {
    "Faturas": ctx.faturas.reduce((s, f) => s + f.valorTotalBRL, 0),
    "Pasta Documental": ctx.pastaTotal
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">📈 Análise do Processo</h2>
        <p className="text-sm text-gray-500">Distribuição e indicadores</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="border rounded-xl p-5 bg-white">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Custos por Fornecedor</div>
          <div className="space-y-2">
            {Object.entries(porFornecedor).length === 0 && <div className="text-sm text-gray-400">Nenhum custo ainda</div>}
            {Object.entries(porFornecedor).map(([n, v]) => (
              <div key={n} className="flex justify-between items-center text-sm">
                <span>{n}</span>
                <strong>{fmtBRL(v)}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="border rounded-xl p-5 bg-white">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Receitas por Origem</div>
          <div className="space-y-2">
            {Object.entries(porTipoReceita).map(([n, v]) => v > 0 && (
              <div key={n} className="flex justify-between items-center text-sm">
                <span>{n}</span>
                <strong>{fmtBRL(v)}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <div className="text-[10px] font-bold text-green-700 uppercase">Receita</div>
          <div className="text-lg font-bold text-green-900">{fmtBRL(r.totalCobrado)}</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="text-[10px] font-bold text-red-700 uppercase">Custo</div>
          <div className="text-lg font-bold text-red-900">{fmtBRL(r.custo)}</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-[10px] font-bold text-blue-700 uppercase">Lucro</div>
          <div className="text-lg font-bold text-blue-900">{fmtBRL(r.lucro)}</div>
        </div>
        <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
          <div className="text-[10px] font-bold text-violet-700 uppercase">Margem</div>
          <div className="text-lg font-bold text-violet-900">{r.margem.toFixed(1)}%</div>
        </div>
      </div>
    </div>
  )
}