// src/components/financeiro/subabas/ExtratoTimeline.tsx
"use client"

import { useMemo } from "react"
import type { FinanceiroContext } from "@/src/types/financeiro-context"
import { fmtBRL, fmtDataBR, nomeDoPagador, pagamentosAtivos } from "@/src/lib/financeiro/helpers-v2"

export function ExtratoTimeline({ ctx }: { ctx: FinanceiroContext }) {
  const eventos = useMemo(() => {
    const lista: any[] = []

    ctx.faturas.forEach(f => {
      lista.push({
        id: `f${f.id}`,
        data: f.dataEmissao.slice(0, 10),
        categoria: "lancamento",
        tipo: "Fatura criada",
        titulo: f.descricao,
        sub: `Valor: ${fmtBRL(f.valorTotalBRL)}`,
        valor: f.valorTotalBRL,
        cor: "green"
      })

      pagamentosAtivos(f).forEach(p => {
        const cam = f.moeda === "BRL" ? 1 : Number(p.cambio || f.cambio || 1)
        lista.push({
          id: `p${p.id}`,
          data: p.data.slice(0, 10),
          categoria: "pagamento",
          tipo: "Recebimento",
          titulo: f.descricao,
          sub: `${nomeDoPagador(p)} · ${p.formaPagamento || "—"}`,
          valor: p.valor * cam,
          cor: "green"
        })
      })
    })

    ctx.contasPagar.forEach((c: any) => {
      if (c.valorPago > 0) {
        lista.push({
          id: `cp${c.id}`,
          data: c.dataVencimento.slice(0, 10),
          categoria: "pagamento",
          tipo: "Pagamento efetuado",
          titulo: c.descricao,
          sub: c.fornecedor ? `🏢 ${c.fornecedor}` : "",
          valor: c.valorPago,
          cor: "red"
        })
      }
    })

    return lista.sort((a, b) => b.data.localeCompare(a.data))
  }, [ctx])

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">📋 Extrato Cronológico</h2>
        <p className="text-sm text-gray-500">Timeline de todos os eventos financeiros do processo</p>
      </div>

      {eventos.length === 0 ? (
        <div className="text-center py-12 text-gray-500">Nenhum evento registrado.</div>
      ) : (
        <div className="relative border-l-2 border-gray-200 ml-3 space-y-4">
          {eventos.map(ev => (
            <div key={ev.id} className="relative pl-6">
              <div className={`absolute left-0 -translate-x-1/2 w-3 h-3 rounded-full mt-2 ${
                ev.cor === "green" ? "bg-green-500" : "bg-red-500"
              }`} />
              <div className="bg-white border border-gray-200 rounded-lg p-3 hover:shadow-sm">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-xs text-gray-500">{fmtDataBR(ev.data)} · {ev.tipo}</div>
                    <div className="font-semibold text-gray-900">{ev.titulo}</div>
                    <div className="text-xs text-gray-600">{ev.sub}</div>
                  </div>
                  <div className={`font-bold ${ev.cor === "green" ? "text-green-600" : "text-red-600"}`}>
                    {ev.categoria === "pagamento" ? (ev.cor === "green" ? "+" : "−") : ""}
                    {fmtBRL(ev.valor)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}