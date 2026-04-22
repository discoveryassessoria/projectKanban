// src/components/financeiro/modals/DetalhesKPIModal.tsx
"use client"

import type { FinanceiroContext } from "@/src/types/financeiro-context"
import { ModalBase } from "./ModalBase"
import {
  fmt, fmtBRL, fmtDataBR, nomeDoPagador, pagamentosAtivos
} from "@/src/lib/financeiro/helpers-v2"

interface Props {
  ctx: FinanceiroContext
  qual: "totalCobrado" | "recebido" | "aReceber" | "vencido"
  onClose: () => void
}

export function DetalhesKPIModal({ ctx, qual, onClose }: Props) {
  const titulos = {
    totalCobrado: { titulo: "Total Cobrado", cor: "violet" as const },
    recebido: { titulo: "Recebido", cor: "green" as const },
    aReceber: { titulo: "A Receber", cor: "orange" as const },
    vencido: { titulo: "Vencido", cor: "red" as const },
  }

  const itens: any[] = ctx.faturas.map(f => {
    const pagsA = pagamentosAtivos(f)
    const ultimoPag = pagsA.sort((a, b) => b.data.localeCompare(a.data))[0]
    return {
      origem: "Fatura",
      nome: f.descricao,
      sub: `#F-${String(f.id).padStart(4, "0")} · ${f.moeda}`,
      emitido: f.dataEmissao.slice(0, 10),
      venc: f.dataVencimento,
      dataRec: ultimoPag?.data,
      total: f.valorTotalBRL,
      pago: f.valorPagoBRL,
      restante: f.valorRestanteBRL,
      st: f.status,
      moeda: f.moeda,
      valorOriginal: f.valor,
      pagamentos: pagsA.map(p => ({
        data: p.data,
        valor: Number(p.valor) * Number(p.cambio || f.cambio || 1),
        forma: p.formaPagamento || "—",
        pagador: nomeDoPagador(p)
      }))
    }
  })

  if (ctx.pastaTotal > 0) {
    const rest = ctx.pastaTotal - ctx.pastaPago
    const st = rest < 0.005 ? "PAGO" : ctx.pastaPago > 0 ? "PARCIAL" : "PENDENTE"
    itens.push({
      origem: "Pasta Documental",
      nome: "📋 Pasta Documental consolidada",
      sub: `${ctx.pastaDetalhes.length} itens · BRL`,
      emitido: null, venc: null, dataRec: null,
      total: ctx.pastaTotal,
      pago: ctx.pastaPago,
      restante: rest,
      st,
      moeda: "BRL" as const,
      valorOriginal: ctx.pastaTotal,
      pagamentos: []
    })
  }

  let filtrados = itens
  let total = 0
  if (qual === "totalCobrado") {
    total = filtrados.reduce((s, i) => s + i.total, 0)
  } else if (qual === "recebido") {
    filtrados = itens.filter(i => i.pago > 0)
    total = filtrados.reduce((s, i) => s + i.pago, 0)
  } else if (qual === "aReceber") {
    filtrados = itens.filter(i => i.restante > 0 && i.st !== "VENCIDO")
    total = filtrados.reduce((s, i) => s + i.restante, 0)
  } else if (qual === "vencido") {
    filtrados = itens.filter(i => i.st === "VENCIDO")
    total = filtrados.reduce((s, i) => s + i.restante, 0)
  }

  const stColors: Record<string, { bg: string; txt: string }> = {
    PAGO: { bg: "bg-green-100", txt: "text-green-800" },
    PARCIAL: { bg: "bg-blue-100", txt: "text-blue-800" },
    VENCIDO: { bg: "bg-red-100", txt: "text-red-800" },
    PENDENTE: { bg: "bg-amber-100", txt: "text-amber-800" },
  }

  return (
    <ModalBase
      title={`Detalhamento · ${titulos[qual].titulo}`}
      subtitle={`${filtrados.length} item(ns) · ${fmtBRL(total)}`}
      icon="📊"
      color={titulos[qual].cor}
      size="xl"
      onClose={onClose}
      footer={<button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Fechar</button>}
    >
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3 text-[10.5px] font-bold uppercase tracking-wider">ORIGEM</th>
              <th className="p-3 text-[10.5px] font-bold uppercase tracking-wider">DESCRIÇÃO</th>
              <th className="p-3 text-[10.5px] font-bold uppercase tracking-wider">EMITIDO</th>
              <th className="p-3 text-[10.5px] font-bold uppercase tracking-wider">VENC.</th>
              <th className="p-3 text-[10.5px] font-bold uppercase tracking-wider">DATA RECEB.</th>
              <th className="p-3 text-[10.5px] font-bold uppercase tracking-wider text-right">VALOR</th>
              <th className="p-3 text-[10.5px] font-bold uppercase tracking-wider">STATUS</th>
              <th className="p-3 text-[10.5px] font-bold uppercase tracking-wider">PAGAMENTOS</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr><td colSpan={8} className="p-8 text-center text-gray-400">Nenhum item nesta categoria</td></tr>
            )}
            {filtrados.map((i, idx) => {
              const valorExibir = qual === "recebido" ? i.pago
                : qual === "aReceber" || qual === "vencido" ? i.restante
                : i.total
              return (
                <tr key={idx} className="border-t hover:bg-gray-50">
                  <td className="p-3">
                    <span className="text-[10.5px] font-bold bg-gray-100 px-2 py-1 rounded uppercase">{i.origem}</span>
                  </td>
                  <td className="p-3">
                    <div className="font-semibold">{i.nome}</div>
                    <div className="text-xs text-gray-500">{i.sub}</div>
                  </td>
                  <td className="p-3">{i.emitido ? fmtDataBR(i.emitido) : "—"}</td>
                  <td className="p-3">{i.venc ? fmtDataBR(i.venc) : "—"}</td>
                  <td className="p-3">
                    <span className={i.dataRec ? "text-green-700 font-semibold" : "text-gray-400"}>
                      {i.dataRec ? fmtDataBR(i.dataRec) : "—"}
                    </span>
                    {i.pagamentos.length > 1 && (
                      <div className="text-[10px] text-gray-400">+{i.pagamentos.length - 1} anterior{i.pagamentos.length > 2 ? "es" : ""}</div>
                    )}
                  </td>
                  <td className="p-3 text-right font-bold tabular-nums">
                    {fmtBRL(valorExibir)}
                    {i.moeda !== "BRL" && (
                      <div className="text-[10.5px] text-gray-400 font-medium">orig. {fmt(i.valorOriginal, i.moeda)}</div>
                    )}
                  </td>
                  <td className="p-3">
                    <span className={`text-[10.5px] font-bold px-2 py-1 rounded-full ${stColors[i.st]?.bg} ${stColors[i.st]?.txt}`}>
                      {i.st === "PAGO" ? "Pago" : i.st === "PARCIAL" ? "Parcial" : i.st === "VENCIDO" ? "Vencido" : "Pendente"}
                    </span>
                  </td>
                  <td className="p-3">
                    {i.pagamentos.length > 0 ? (
                      <div className="space-y-1">
                        {i.pagamentos.slice(0, 3).map((p: any, ii: number) => (
                          <div key={ii} className="text-xs text-gray-700">
                            {fmtDataBR(p.data)} · {fmtBRL(p.valor)} · {p.forma} · {p.pagador}
                          </div>
                        ))}
                        {i.pagamentos.length > 3 && (
                          <div className="text-[10px] text-gray-400">+{i.pagamentos.length - 3} mais</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-gray-50 border-t-2 border-violet-500">
            <tr>
              <td colSpan={5} className="p-3 font-bold">TOTAL</td>
              <td className="p-3 text-right font-extrabold text-violet-600">{fmtBRL(total)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </ModalBase>
  )
}