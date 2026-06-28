// CRIAR EM: src/app/api/financas/comissoes/route.ts
//
// GET /api/financas/comissoes — aba "Comissões".
// ⚠ O schema NÃO tem tabela de comissões nem de regras. Toda esta aba é
// "prévia" (dados de exemplo do mockup). Quando existir um model Comissao +
// RegraComissao, troca-se a fonte aqui. Estrutura fiel ao mockup.

import { NextRequest, NextResponse } from "next/server"

const COMISSOES = [
  { id: "c1", beneficiario: "João Silva", papel: "Vendedor", processo: "🇩🇪 Pupp", processoId: "ALE-2025-0002", base: 5500, pct: 8, valor: 440, status: "a_pagar", vencimento: "2026-05-30" },
  { id: "c2", beneficiario: "João Silva", papel: "Vendedor", processo: "🇪🇸 Cruz Lopes", processoId: "ESP-2025-0007", base: 5000, pct: 8, valor: 400, status: "a_pagar", vencimento: "2026-05-30" },
  { id: "c3", beneficiario: "João Silva", papel: "Vendedor", processo: "🇮🇹 Rizzo", processoId: "ITA-2025-0021", base: 6000, pct: 8, valor: 480, status: "a_pagar", vencimento: "2026-05-30" },
  { id: "c4", beneficiario: "João Silva", papel: "Vendedor", processo: "🇮🇹 Ravasi", processoId: "ITA-2025-0008", base: 5500, pct: 8, valor: 440, status: "a_pagar", vencimento: "2026-05-30" },
  { id: "c5", beneficiario: "João Silva", papel: "Vendedor", processo: "🇪🇸 Antiqueira", processoId: "ESP-2025-0019", base: 4000, pct: 8, valor: 320, status: "a_pagar", vencimento: "2026-05-30" },
  { id: "c6", beneficiario: "Studio Romano", papel: "Parceiro", processo: "🇮🇹 Conti", processoId: "ITA-2025-0014", base: 22000, pct: 5, valor: 1100, status: "paga", vencimento: "2026-04-30", pagoEm: "2026-04-30" },
  { id: "c7", beneficiario: "Despachante Lisboa", papel: "Parceiro", processo: "🇵🇹 Sousa", processoId: "PRT-2025-0001", base: 14000, pct: 6, valor: 840, status: "paga", vencimento: "2026-05-08", pagoEm: "2026-05-08" },
  { id: "c8", beneficiario: "João Silva", papel: "Vendedor", processo: "🇮🇹 Conti", processoId: "ITA-2025-0014", base: 5500, pct: 8, valor: 440, status: "paga", vencimento: "2026-05-05", pagoEm: "2026-05-05" },
  { id: "c9", beneficiario: "João Silva", papel: "Vendedor", processo: "🇩🇪 Brinker", processoId: "ALE-2025-0001", base: 6500, pct: 8, valor: 520, status: "paga", vencimento: "2026-04-28", pagoEm: "2026-04-28" },
  { id: "c10", beneficiario: "João Silva", papel: "Vendedor", processo: "🇩🇪 Betina", processoId: "ALE-2025-0003", base: 4500, pct: 8, valor: 360, status: "prevista", vencimento: "2026-06-30" },
]

const REGRAS = [
  { id: "r1", nome: "João Silva", tipo: "Vendedor", base: "sobre cada parcela paga", valor: "8%", aplicacao: "Todos os processos", ativa: true },
  { id: "r2", nome: "Studio Romano", tipo: "Parceiro", base: "sobre contrato fechado", valor: "5%", aplicacao: "Processos Itália", ativa: true },
  { id: "r3", nome: "Despachante Lisboa", tipo: "Parceiro", base: "sobre contrato fechado", valor: "6%", aplicacao: "Processos Portugal", ativa: true },
  { id: "r4", nome: "Indicação cliente", tipo: "Indicador", base: "comissão fixa", valor: "R$ 500,00", aplicacao: "Quando indicação vira contrato", ativa: true },
]

export async function GET(_req: NextRequest) {
  const aPagar = COMISSOES.filter((c) => c.status === "a_pagar").reduce((a, c) => a + c.valor, 0)
  const previstas = COMISSOES.filter((c) => c.status === "prevista").reduce((a, c) => a + c.valor, 0)
  const pagas = COMISSOES.filter((c) => c.status === "paga").reduce((a, c) => a + c.valor, 0)
  const totalJoao = COMISSOES.filter((c) => c.beneficiario === "João Silva").reduce((a, c) => a + c.valor, 0)
  const qtdJoao = COMISSOES.filter((c) => c.beneficiario === "João Silva").length

  // ordena: a_pagar → prevista → paga
  const peso: Record<string, number> = { a_pagar: 0, prevista: 1, paga: 2 }
  const lista = [...COMISSOES].sort((a, b) => (peso[a.status] - peso[b.status]) || a.vencimento.localeCompare(b.vencimento))

  return NextResponse.json({
    previa: true, // aba inteira é prévia (sem tabela no schema)
    kpis: {
      aPagar, qtdAPagar: COMISSOES.filter((c) => c.status === "a_pagar").length,
      previstas, qtdPrevistas: COMISSOES.filter((c) => c.status === "prevista").length,
      pagas, qtdPagas: COMISSOES.filter((c) => c.status === "paga").length,
      destaque: "João Silva", totalDestaque: totalJoao, qtdDestaque: qtdJoao,
    },
    regras: REGRAS,
    comissoes: lista,
    contagem: {
      todos: COMISSOES.length,
      a_pagar: COMISSOES.filter((c) => c.status === "a_pagar").length,
      previstas: COMISSOES.filter((c) => c.status === "prevista").length,
      pagas: COMISSOES.filter((c) => c.status === "paga").length,
    },
  })
}