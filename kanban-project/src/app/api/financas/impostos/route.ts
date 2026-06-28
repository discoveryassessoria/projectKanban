// CRIAR EM: src/app/api/financas/impostos/route.ts
//
// GET /api/financas/impostos — aba "Impostos e Tributos".
// ⚠ O schema NÃO tem tabela de tributos/guias. Toda esta aba é "prévia"
// (dados de exemplo). Quando existir provisão automática ligada à receita,
// troca-se a fonte aqui.

import { NextRequest, NextResponse } from "next/server"

function dias(d: string) { return Math.ceil((new Date(d + "T00:00:00").getTime() - Date.now()) / 86_400_000) }

const TRIBUTOS = [
  { id: "t1", tipo: "DAS Simples Nacional", competencia: "2026-05", base: 42000, aliquota: 8.6, provisao: 3612, vencimento: "2026-06-20", status: "a_pagar" },
  { id: "t2", tipo: "INSS Patronal", competencia: "2026-05", base: 18800, aliquota: 27.5, provisao: 5180, vencimento: "2026-06-20", status: "a_pagar" },
  { id: "t3", tipo: "ISS Amparo", competencia: "2026-05", base: 42000, aliquota: 5.0, provisao: 2100, vencimento: "2026-06-22", status: "a_pagar" },
  { id: "t4", tipo: "IRRF", competencia: "2026-04", base: 18500, aliquota: 10.0, provisao: 1850, vencimento: "2026-05-15", status: "pago", pagoEm: "2026-05-15", pago: 1850 },
]

const CALENDARIO = [
  { date: "2026-05-15", tipo: "IRRF", valor: 1850, status: "pago" },
  { date: "2026-05-20", tipo: "DAS Simples Nacional", valor: 3612, status: "a_pagar" },
  { date: "2026-05-20", tipo: "INSS Patronal", valor: 5180, status: "a_pagar" },
  { date: "2026-05-22", tipo: "ISS Amparo", valor: 2100, status: "a_pagar" },
  { date: "2026-06-15", tipo: "IRRF · Maio", valor: 1950, status: "previsto" },
  { date: "2026-06-20", tipo: "DAS Simples Nacional", valor: 3680, status: "previsto" },
  { date: "2026-06-20", tipo: "INSS Patronal", valor: 5260, status: "previsto" },
  { date: "2026-06-22", tipo: "ISS Amparo", valor: 2140, status: "previsto" },
]

const CARGA = [
  { mes: "Maio/26 (parcial)", pct: 14.5 },
  { mes: "Abril/26", pct: 14.9 },
  { mes: "Março/26", pct: 15.2 },
  { mes: "Fevereiro/26", pct: 15.5 },
]

export async function GET(_req: NextRequest) {
  const aPagar = TRIBUTOS.filter((t) => t.status === "a_pagar").reduce((a, t) => a + t.provisao, 0)
  const pagos = TRIBUTOS.filter((t) => t.status === "pago").reduce((a, t) => a + (t.pago ?? 0), 0)
  const atrasados = TRIBUTOS.filter((t) => t.status === "a_pagar" && dias(t.vencimento) < 0)

  const peso: Record<string, number> = { a_pagar: 0, previsto: 1, pago: 2 }
  const lista = [...TRIBUTOS].sort((a, b) => (peso[a.status] - peso[b.status]) || a.vencimento.localeCompare(b.vencimento))

  return NextResponse.json({
    previa: true,
    kpis: {
      provisaoMes: aPagar, qtdGuias: TRIBUTOS.filter((t) => t.status === "a_pagar").length,
      aPagar, qtdPendentes: TRIBUTOS.filter((t) => t.status === "a_pagar").length,
      pagosMes: pagos,
      atrasados: atrasados.length, totalAtrasado: atrasados.reduce((a, t) => a + t.provisao, 0),
    },
    calendario: CALENDARIO.map((c) => ({ ...c, dueText: dias(c.date) < 0 ? `há ${Math.abs(dias(c.date))}d` : dias(c.date) === 0 ? "hoje" : `em ${dias(c.date)}d` })),
    cargaTributaria: CARGA,
    tributos: lista,
  })
}