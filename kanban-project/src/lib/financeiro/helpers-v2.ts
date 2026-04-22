// src/lib/financeiro/helpers-v2.ts
// Funções utilitárias puras.

import type {
  FaturaEnriquecida, PagamentoFaturaEnriquecido,
  ResumoFinanceiro, MoedaV2
} from "@/src/types/financeiro-v2"

export function toNumber(v: any): number {
  if (v === null || v === undefined) return 0
  if (typeof v === "number") return v
  if (typeof v === "string") return parseFloat(v) || 0
  if (v && typeof v.toString === "function") return parseFloat(v.toString()) || 0
  return 0
}

export function fmtBRL(v: number | null | undefined): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(toNumber(v))
}

export function fmt(v: number | null | undefined, moeda: MoedaV2): string {
  const simbolo = moeda === "EUR" ? "€" : moeda === "USD" ? "US$" : "R$"
  return `${simbolo} ${toNumber(v).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

export function simboloMoeda(moeda: MoedaV2): string {
  return moeda === "EUR" ? "€" : moeda === "USD" ? "US$" : "R$"
}

export function fmtDataBR(d: string | Date | null | undefined): string {
  if (!d) return "—"
  const data = typeof d === "string" ? new Date(d) : d
  if (isNaN(data.getTime())) return "—"
  return data.toLocaleDateString("pt-BR")
}

export function today(): string {
  return new Date().toISOString().split("T")[0]
}

export function diasEntre(d1: string | Date, d2: string | Date = new Date()): number {
  const date1 = typeof d1 === "string" ? new Date(d1) : d1
  const date2 = typeof d2 === "string" ? new Date(d2) : d2
  return Math.floor((date2.getTime() - date1.getTime()) / 86400000)
}

export function nomeDoPagador(pag: PagamentoFaturaEnriquecido): string {
  const dests = pag.destinatarios || []
  if (dests.length === 0) return "—"
  if (dests.length === 1) return dests[0].nome
  return "Rateado: " + dests.map(d => d.nome.split(" ")[0]).join(", ")
}

export function pagamentosAtivos(f: FaturaEnriquecida): PagamentoFaturaEnriquecido[] {
  return (f.pagamentos || []).filter(p => !p.estornado)
}

export function calcularResumo(
  faturas: FaturaEnriquecida[],
  pastaDocumentalTotal: number,
  pastaDocumentalPago: number,
  contasPagar: Array<{ valor: number; valorPago: number | null; status: string }>
): ResumoFinanceiro {
  let totalCobrado = 0
  let recebido = 0
  let aReceber = 0
  let vencido = 0
  let pendentesCount = 0
  let vencidasCount = 0

  faturas.forEach(f => {
    totalCobrado += toNumber(f.valorTotalBRL)
    recebido += toNumber(f.valorPagoBRL)
    if (f.status === "VENCIDO") {
      vencido += toNumber(f.valorRestanteBRL)
      vencidasCount++
    } else if (f.status !== "PAGO") {
      aReceber += toNumber(f.valorRestanteBRL)
      pendentesCount++
    }
  })

  totalCobrado += toNumber(pastaDocumentalTotal)
  recebido += toNumber(pastaDocumentalPago)
  aReceber += Math.max(0, toNumber(pastaDocumentalTotal) - toNumber(pastaDocumentalPago))

  let custo = 0, custoPago = 0
  contasPagar.forEach(c => {
    custo += toNumber(c.valor)
    custoPago += toNumber(c.valorPago)
  })
  const custoPendente = Math.max(0, custo - custoPago)

  const pctPago = custo > 0 ? (custoPago / custo) * 100 : 0
  const pctRecebido = totalCobrado > 0 ? (recebido / totalCobrado) * 100 : 0
  const lucro = totalCobrado - custo
  const margem = totalCobrado > 0 ? (lucro / totalCobrado) * 100 : 0

  return {
    totalCobrado, recebido, aReceber, vencido,
    numFaturas: faturas.length,
    pendentesCount, vencidasCount, pctRecebido,
    custo, custoPago, custoPendente, pctPago,
    lucro, margem
  }
}

export function converterParaBRL(valor: number, moeda: MoedaV2, cambio: number | null): number {
  if (moeda === "BRL") return valor
  if (!cambio || cambio <= 0) return valor
  return valor * cambio
}

export function valorPorExtenso(v: number): string {
  const int = Math.floor(v)
  const cent = Math.round((v - int) * 100)
  return `${int.toLocaleString("pt-BR")} reais${cent > 0 ? ` e ${cent} centavos` : ""}`
}

export const FORMAS_PAGAMENTO_LABELS: Record<string, string> = {
  PIX: "PIX",
  CARTAO_CREDITO: "Cartão Crédito",
  CARTAO_DEBITO: "Cartão Débito",
  BOLETO: "Boleto",
  TRANSFERENCIA: "Transferência",
  DINHEIRO: "Dinheiro",
  CHEQUE: "Cheque",
  OUTRO: "Outro"
}