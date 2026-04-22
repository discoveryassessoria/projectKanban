// src/components/financeiro/modals/GerarReciboModal.tsx
"use client"

import { useState, useEffect } from "react"
import type { FinanceiroContext } from "@/src/types/financeiro-context"
import type { Recibo } from "@/src/types/financeiro-v2"
import { ModalBase } from "./ModalBase"
import { fmtBRL, fmtDataBR } from "@/src/lib/financeiro/helpers-v2"

interface Props {
  ctx: FinanceiroContext
  onClose: () => void
}

export function GerarReciboModal({ ctx, onClose }: Props) {
  const [recibos, setRecibos] = useState<Recibo[]>([])
  const [loading, setLoading] = useState(true)

  async function carregar() {
    setLoading(true)
    try {
      const res = await fetch(`/api/financeiro/recibos?processoId=${ctx.processoId}`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem("authToken") || ""}` }
      })
      const data = await res.json()
      setRecibos(data.recibos || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  useEffect(() => { carregar() }, [])

  function nomeDoPagador(r: Recibo): string {
    return r.pagadorRequerente?.nome || r.pagadorContratante?.nome || r.pagadorNome || "—"
  }

  return (
    <ModalBase
      title="Recibos do Processo"
      subtitle={`${recibos.length} recibo(s) emitido(s)`}
      icon="📄"
      color="green"
      size="xl"
      onClose={onClose}
      footer={<button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Fechar</button>}
    >
      <div className="mb-3 bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-800">
        💡 Recibos individuais são gerados automaticamente ao clicar no ícone 📄 no histórico
        de pagamentos de cada fatura. Esta tela lista todos os recibos já emitidos.
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500">Carregando recibos...</div>
      ) : recibos.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          Nenhum recibo emitido ainda.
          <div className="text-xs mt-2">Gere recibos diretamente nos pagamentos das faturas.</div>
        </div>
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="p-3 text-[10.5px] font-bold uppercase tracking-wider">NÚMERO</th>
                <th className="p-3 text-[10.5px] font-bold uppercase tracking-wider">EMITIDO EM</th>
                <th className="p-3 text-[10.5px] font-bold uppercase tracking-wider">PAGADOR</th>
                <th className="p-3 text-[10.5px] font-bold uppercase tracking-wider">DESCRIÇÃO</th>
                <th className="p-3 text-[10.5px] font-bold uppercase tracking-wider text-right">VALOR</th>
              </tr>
            </thead>
            <tbody>
              {recibos.map(r => (
                <tr key={r.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 font-bold text-violet-600">{r.numero}</td>
                  <td className="p-3">{fmtDataBR(r.data)}</td>
                  <td className="p-3">{nomeDoPagador(r)}</td>
                  <td className="p-3">{r.descricao}</td>
                  <td className="p-3 text-right font-bold tabular-nums text-green-700">
                    {fmtBRL(Number(r.valorTotal))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ModalBase>
  )
}