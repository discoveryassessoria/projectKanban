// src/components/financeiro/shared/CardFatura.tsx
"use client"

import { useState } from "react"
import { Paperclip, RotateCcw, FileText } from "lucide-react"
import type { FaturaEnriquecida, PagamentoFaturaEnriquecido } from "@/src/types/financeiro"
import type { FinanceiroContext } from "@/src/types/financeiro"
import {
  fmt, fmtBRL, fmtDataBR, simboloMoeda, nomeDoPagador, pagamentosAtivos
} from "@/src/lib/financeiro/helpers"
import { ComprovanteModal } from "@/src/components/financeiro/modals/ComprovanteModal"
import { gerarReciboIndividualPDF } from "@/src/lib/pdf/gerar-recibo"

interface Props {
  fatura: FaturaEnriquecida
  ctx: FinanceiroContext
}

export function CardFatura({ fatura: f, ctx }: Props) {
  const [comprovanteModal, setComprovanteModal] = useState<PagamentoFaturaEnriquecido | null>(null)
  const [gerandoRecibo, setGerandoRecibo] = useState<number | null>(null)
  const simbolo = simboloMoeda(f.moeda)
  const pct = f.valor > 0 ? Math.min(100, (f.valorPago / f.valor) * 100) : 0
  const pagsAtivos = pagamentosAtivos(f)

  const stColors: Record<string, { bg: string; txt: string; lbl: string }> = {
    PAGO: { bg: "bg-green-100", txt: "text-green-800", lbl: "✓ Pago" },
    PARCIAL: { bg: "bg-blue-100", txt: "text-blue-800", lbl: "Parcial" },
    VENCIDO: { bg: "bg-red-100", txt: "text-red-800", lbl: "⚠ Vencido" },
    PENDENTE: { bg: "bg-amber-100", txt: "text-amber-800", lbl: "Pendente" },
  }
  const st = stColors[f.status] || stColors.PENDENTE

  async function handleEstornar(pagId: number) {
    if (!confirm("Estornar este pagamento?")) return
    try {
      const res = await fetch(`/api/financeiro/pagamentos-fatura/${pagId}/estorno`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken") || ""}`
        },
        body: JSON.stringify({ motivo: "Estornado pelo usuário" })
      })
      if (!res.ok) throw new Error(await res.text())
      ctx.refresh()
    } catch (e: any) {
      alert("Erro ao estornar: " + e.message)
    }
  }

  async function handleGerarRecibo(p: PagamentoFaturaEnriquecido) {
    if (gerandoRecibo) return
    setGerandoRecibo(p.id)

    const cam = f.moeda === "BRL" ? 1 : Number(p.cambio || f.cambio || 1)
    const valorBRL = Number(p.valor) * cam

    const primeiroDest = p.destinatarios?.[0]
    const pagadorRequerente = ctx.pessoas.find(
      pe => pe.tipo === "REQUERENTE" && pe.id === primeiroDest?.id
    )
    const enderecoLinhas: string[] = []
    if (pagadorRequerente?.endereco) {
      const end = [
        pagadorRequerente.endereco + (pagadorRequerente.numero ? `, ${pagadorRequerente.numero}` : ""),
        pagadorRequerente.bairro,
        [pagadorRequerente.cidade, pagadorRequerente.estado].filter(Boolean).join(" - "),
        pagadorRequerente.cep ? `CEP: ${pagadorRequerente.cep}` : null
      ].filter(Boolean) as string[]
      enderecoLinhas.push(...end)
    }
    const endereco = enderecoLinhas.join(" · ")

    try {
      const body: any = {
        processoId: ctx.processoId,
        data: new Date().toISOString(),
        valorTotal: valorBRL,
        descricao: f.descricao,
        pagamentoIds: [p.id],
      }
      if (pagadorRequerente) {
        body.pagadorTipo = "REQUERENTE"
        body.pagadorId = pagadorRequerente.id
      } else {
        body.pagadorNome = nomeDoPagador(p)
      }

      const res = await fetch("/api/financeiro/recibos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken") || ""}`
        },
        body: JSON.stringify(body)
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()

      gerarReciboIndividualPDF({
        numero: data.numero,
        dataEmissao: new Date().toISOString(),
        valorTotal: valorBRL,
        pagadorNome: nomeDoPagador(p),
        pagadorEndereco: endereco || undefined,
        descricao: f.descricao,
        origem: "Fatura",
        etapa: ctx.etapaAtual,
        dataPagamento: p.data,
        formaPagamento: p.formaPagamento || "—",
        moedaOriginal: f.moeda,
        valorOriginal: Number(p.valor),
        cambio: cam,
        comprovante: p.comprovanteNome || undefined,
        temAnexo: !!p.comprovanteUrl,
        processoCtx: {
          nome: ctx.nomeFamilia, pais: ctx.pais, etapaAtual: ctx.etapaAtual,
          requerentes: ctx.pessoas.filter(x => x.tipo === "REQUERENTE").map(x => x.nome)
        }
      })
      ctx.refresh()
    } catch (e: any) {
      alert("Erro ao gerar recibo: " + e.message)
    } finally {
      setGerandoRecibo(null)
    }
  }

  return (
    <>
      <div className="bg-white border border-gray-200 border-l-4 border-l-green-500 rounded-xl p-4 shadow-sm">
        <div className="flex justify-between items-start mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                ↙ A RECEBER
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                📄 #F-{String(f.id).padStart(4, "0")}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                🔖 {f.moeda}
              </span>
            </div>
            <div className="font-bold text-gray-900">{f.descricao}</div>
            <div className="text-xs text-gray-500 mt-1">
              📅 Venc. {fmtDataBR(f.dataVencimento)}
              {f.destinatarios.length > 0 && (
                <span> · 👥 {f.destinatarios.length} destinatário{f.destinatarios.length > 1 ? "s" : ""}</span>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-extrabold tabular-nums">{simbolo} {fmt(f.valor, f.moeda).replace(/^[A-Z€$R\s]+/, "")}</div>
            {f.moeda !== "BRL" && <div className="text-xs text-gray-500">≈ {fmtBRL(f.valorTotalBRL)}</div>}
            <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${st.bg} ${st.txt}`}>
              {st.lbl}
            </span>
          </div>
        </div>

        {pagsAtivos.length > 0 && (
          <div className="mb-3">
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-1">
              <div
                className={`h-full ${f.status === "PAGO" ? "bg-green-500" : f.status === "VENCIDO" ? "bg-red-500" : "bg-blue-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-gray-500">
              <span>Recebido {simbolo} {fmt(f.valorPago, f.moeda).replace(/^[A-Z€$R\s]+/, "")}</span>
              <span>{pct.toFixed(0)}% · Restante {simbolo} {fmt(f.valorRestante, f.moeda).replace(/^[A-Z€$R\s]+/, "")}</span>
            </div>
          </div>
        )}

        {f.observacoes && (
          <div className="text-xs text-gray-600 bg-gray-50 rounded p-2 mb-3">💬 {f.observacoes}</div>
        )}

        {pagsAtivos.length > 0 && (
          <div className="bg-gray-50 rounded-lg p-3 mb-3">
            <div className="text-[10.5px] font-bold text-gray-500 uppercase tracking-wider mb-2">
              Histórico ({pagsAtivos.length}) · Pagamentos recebidos
            </div>
            <div className="space-y-1">
              {pagsAtivos.slice(-4).reverse().map(p => (
                <div key={p.id} className="flex justify-between items-center bg-white border rounded p-2 text-xs">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">
                      {fmtDataBR(p.data)} · {p.formaPagamento || "—"}
                      {p.comprovanteUrl ? " · 📎" : ""}
                    </div>
                    <div className="text-gray-500 text-[10.5px] truncate">
                      👤 {nomeDoPagador(p)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <strong className="text-green-700">
                      {simbolo} {fmt(Number(p.valor), f.moeda).replace(/^[A-Z€$R\s]+/, "")}
                    </strong>
                    {p.comprovanteUrl && (
                      <button onClick={() => setComprovanteModal(p)} title="Ver anexo" className="p-1 hover:bg-gray-100 rounded">
                        <Paperclip className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button onClick={() => handleEstornar(p.id)} title="Estornar" className="p-1 hover:bg-gray-100 rounded">
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleGerarRecibo(p)}
                      disabled={gerandoRecibo === p.id}
                      title="Gerar recibo"
                      className="p-1 hover:bg-gray-100 rounded disabled:opacity-50"
                    >
                      <FileText className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {comprovanteModal && (
        <ComprovanteModal
          url={comprovanteModal.comprovanteUrl || ""}
          nome={comprovanteModal.comprovanteNome || "comprovante"}
          onClose={() => setComprovanteModal(null)}
        />
      )}
    </>
  )
}