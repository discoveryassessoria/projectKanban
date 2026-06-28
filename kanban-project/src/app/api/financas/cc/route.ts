// CRIAR EM: src/app/api/financas/cc/route.ts
//
// GET /api/financas/cc — aba "Centros de Custo".
// REAL: lista de CentroCusto (nome/cor) do banco, se houver.
// MOCK ("prévia"): orçado/executado — o schema NÃO liga ContaPagar/Custo a
// CentroCusto (tabela isolada, sem budget/spent), então não há como medir
// execução real. Se a tabela estiver vazia, usa os 9 centros do mockup.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// 9 centros do mockup (idênticos), usados como "prévia" quando não há reais
const CC_MOCK = [
  { nome: "Comercial", orcado: 8000, executado: 6200, cor: "#3b82f6" },
  { nome: "Marketing", orcado: 10000, executado: 8050, cor: "#ec4899" },
  { nome: "Operacional", orcado: 4500, executado: 2480, cor: "#22c55e" },
  { nome: "Documental", orcado: 6000, executado: 4360, cor: "#f59e0b" },
  { nome: "Jurídico", orcado: 5000, executado: 2208, cor: "#6366f1" },
  { nome: "Administrativo", orcado: 42000, executado: 38540, cor: "#64748b" },
  { nome: "Tecnologia", orcado: 2000, executado: 1300, cor: "#06b6d4" },
  { nome: "Financeiro", orcado: 18000, executado: 16200, cor: "#ef4444" },
  { nome: "Diretoria", orcado: 10000, executado: 8390, cor: "#94a3b8" },
]

export async function GET(_req: NextRequest) {
  try {
    const reais = await prisma.centroCusto.findMany({
      where: { ativo: true },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true, cor: true },
    })

    const temReais = reais.length > 0
    const paleta = ["#3b82f6", "#ec4899", "#22c55e", "#f59e0b", "#6366f1", "#64748b", "#06b6d4", "#ef4444", "#94a3b8"]

    // monta a lista exibida; orçado/executado é sempre mock (sem fonte no schema)
    const centros = temReais
      ? reais.map((c, i) => {
          // associa um valor mock por índice só pra ter o que mostrar na prévia
          const m = CC_MOCK[i % CC_MOCK.length]
          return { id: c.id, nome: c.nome, cor: c.cor || paleta[i % paleta.length], orcado: m.orcado, executado: m.executado, mock: true }
        })
      : CC_MOCK.map((c, i) => ({ id: -(i + 1), nome: c.nome, cor: c.cor, orcado: c.orcado, executado: c.executado, mock: true }))

    const totalExecutado = centros.reduce((a, c) => a + c.executado, 0)
    const totalOrcado = centros.reduce((a, c) => a + c.orcado, 0)
    const ordenados = [...centros].sort((a, b) => b.executado - a.executado)
    const estouros = centros.filter((c) => c.executado > c.orcado)

    return NextResponse.json({
      temReais,
      centros: ordenados.map((c) => ({
        ...c,
        disponivel: c.orcado - c.executado,
        pctExecucao: c.orcado > 0 ? (c.executado / c.orcado) * 100 : 0,
        pctDoTotal: totalExecutado > 0 ? (c.executado / totalExecutado) * 100 : 0,
        status: c.executado > c.orcado ? "estourou" : c.orcado > 0 && c.executado / c.orcado > 0.85 ? "atencao" : "ok",
      })),
      kpis: {
        totalExecutado,
        totalOrcado,
        disponivel: totalOrcado - totalExecutado,
        pctExecucaoTotal: totalOrcado > 0 ? (totalExecutado / totalOrcado) * 100 : 0,
        maiorCC: ordenados[0] ? { nome: ordenados[0].nome, executado: ordenados[0].executado, pct: totalExecutado > 0 ? (ordenados[0].executado / totalExecutado) * 100 : 0 } : null,
        qtdEstouros: estouros.length,
        nomesEstouros: estouros.map((c) => c.nome),
        qtdCentros: centros.length,
      },
    })
  } catch (e) {
    console.error("[financas/cc] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar centros de custo" }, { status: 500 })
  }
}