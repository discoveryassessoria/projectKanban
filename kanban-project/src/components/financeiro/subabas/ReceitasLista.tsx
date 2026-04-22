// src/components/financeiro/subabas/ReceitasLista.tsx
"use client"

import { useState, useMemo } from "react"
import { Search } from "lucide-react"
import type { FinanceiroContext } from "@/src/types/financeiro-context"
import { fmtBRL, fmtDataBR } from "@/src/lib/financeiro/helpers-v2"
import { CardFatura } from "@/src/components/financeiro/shared/CardFatura"
import { CardPastaDocumental } from "@/src/components/financeiro/shared/CardPastaDocumental"
import { GerarReciboModal } from "@/src/components/financeiro/modals/GerarReciboModal"

export function ReceitasLista({ ctx }: { ctx: FinanceiroContext }) {
  const [busca, setBusca] = useState("")
  const [modalRecibos, setModalRecibos] = useState(false)

  const faturasFiltradas = useMemo(() => {
    return ctx.faturas
      .filter(f => !busca ||
        f.descricao.toLowerCase().includes(busca.toLowerCase())
      )
      .sort((a, b) => {
        if (a.status === "VENCIDO" && b.status !== "VENCIDO") return -1
        if (b.status === "VENCIDO" && a.status !== "VENCIDO") return 1
        return (a.dataVencimento || "").localeCompare(b.dataVencimento || "")
      })
  }, [ctx.faturas, busca])

  const proximosVencimentos = useMemo(() => {
    const hoje = new Date().toISOString().split("T")[0]
    const limite = new Date()
    limite.setDate(limite.getDate() + 7)
    const limiteStr = limite.toISOString().split("T")[0]
    return ctx.faturas.filter(f =>
      f.dataVencimento && f.dataVencimento >= hoje && f.dataVencimento <= limiteStr &&
      f.status !== "PAGO"
    )
  }, [ctx.faturas])

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">💰 Receitas</h2>
          <p className="text-sm text-gray-500">Faturas e pasta documental a receber do cliente</p>
        </div>
        <button
          onClick={() => setModalRecibos(true)}
          className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
        >
          📄 Recibos
        </button>
      </div>

      {proximosVencimentos.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
          <div className="font-bold text-amber-900 mb-2">🔔 Próximos vencimentos (7 dias)</div>
          <div className="space-y-1 text-sm">
            {proximosVencimentos.map(f => (
              <div key={f.id} className="flex justify-between">
                <span>{f.descricao} — vence {fmtDataBR(f.dataVencimento)}</span>
                <strong>{fmtBRL(f.valorRestanteBRL)}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar em faturas..."
          className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"
        />
      </div>

      <div className="space-y-4">
        {ctx.pastaTotal > 0 && <CardPastaDocumental ctx={ctx} />}

        {faturasFiltradas.map(f => (
          <CardFatura key={f.id} fatura={f} ctx={ctx} />
        ))}

        {faturasFiltradas.length === 0 && ctx.pastaTotal === 0 && (
          <div className="text-center py-12 text-gray-500">
            Nenhuma receita registrada.
          </div>
        )}
      </div>

      {modalRecibos && (
        <GerarReciboModal ctx={ctx} onClose={() => setModalRecibos(false)} />
      )}
    </div>
  )
}