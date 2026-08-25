// src/components/financeiro/shared/CardPastaDocumental.tsx
"use client"

import type { FinanceiroContext } from "@/src/types/financeiro"
import { fmtBRL } from "@/src/lib/financeiro/helpers"

interface Props {
  ctx: FinanceiroContext
}

export function CardPastaDocumental({ ctx }: Props) {
  const total = ctx.pastaTotal
  const pago = ctx.pastaPago
  const restante = Math.max(0, total - pago)
  const pct = total > 0 ? (pago / total) * 100 : 0
  const totalmente = pago >= total - 0.005
  const st = totalmente ? "PAGO" : pago > 0 ? "PARCIAL" : "PENDENTE"

  const stColors: Record<string, { bg: string; txt: string; lbl: string }> = {
    PAGO: { bg: "bg-[var(--surface-secondary)]", txt: "text-green-800", lbl: "✓ Pago" },
    PARCIAL: { bg: "bg-[var(--surface-secondary)]", txt: "text-[var(--text-secondary)]", lbl: `Parcial · ${pct.toFixed(0)}%` },
    PENDENTE: { bg: "bg-[var(--surface-secondary)]", txt: "text-amber-800", lbl: "A receber" },
  }

  const agrupado: Record<string, number> = {}
  ctx.pastaDetalhes.forEach((d: any) => {
    agrupado[d.servico] = (agrupado[d.servico] || 0) + d.valor
  })

  return (
    <div className="bg-[var(--surface-primary)] border border-gray-200 border-l-4 border-l-blue-500 rounded-xl p-4 shadow-[var(--elev-1)]">
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <div className="font-bold text-gray-900">
            📋 Pasta Documental · {ctx.pastaDetalhes.length} ite{ctx.pastaDetalhes.length === 1 ? "m" : "ns"}
          </div>
          <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {Object.entries(agrupado).map(([n, v]) => (
              <span key={n}>{n} {fmtBRL(v)}</span>
            ))}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-extrabold tabular-nums">{fmtBRL(total)}</div>
          <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${stColors[st].bg} ${stColors[st].txt}`}>
            {stColors[st].lbl}
          </span>
        </div>
      </div>

      <div className="mb-3">
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-1">
          <div
            className={`h-full ${totalmente ? "bg-green-600" : "bg-[var(--surface-secondary)]"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-gray-500">
          <span>{pago > 0 ? `Recebido ${fmtBRL(pago)}` : "Nenhum pagamento ainda"}</span>
          <span>{pct.toFixed(0)}% · Restante {fmtBRL(restante)}</span>
        </div>
      </div>

      <div className="text-xs text-gray-500 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded p-2">
        ℹ Os valores da planilha são recebidos diretamente na aba <strong>Custos</strong>,
        onde você pode editar cada item individualmente.
      </div>
    </div>
  )
}