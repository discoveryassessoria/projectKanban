// src/app/api/financas/cc/route.ts
//
// GET /api/financas/cc — aba "Centros de Custo" do Financeiro.
// AGORA SÓ DADOS REAIS: lista os CentroCusto ativos do banco.
// orçado/executado = 0 porque o schema ainda NÃO tem campo de orçamento no
// CentroCusto, nem liga ContaPagar/Custo a ele. Esses números passam a ser
// reais na FASE B (adicionar `orcamento` ao CentroCusto + `centroCustoId` ao
// ContaPagar). Sem mock, sem fallback de 9 centros.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(_req: NextRequest) {
  try {
    const reais = await prisma.centroCusto.findMany({
      where: { ativo: true },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true, cor: true },
    })

    const paleta = ["#3b82f6", "#ec4899", "#22c55e", "#f59e0b", "#6366f1", "#64748b", "#06b6d4", "#ef4444", "#94a3b8"]

    // centros reais, sem orçamento/execução (não há fonte no schema ainda)
    const centros = reais.map((c, i) => ({
      id: c.id,
      nome: c.nome,
      cor: c.cor || paleta[i % paleta.length],
      orcado: 0,
      executado: 0,
      mock: false,
    }))

    const ordenados = [...centros].sort((a, b) => a.nome.localeCompare(b.nome))

    return NextResponse.json({
      temReais: centros.length > 0,
      semOrcamento: true, // sinaliza pro front: orçado/executado ainda não existem (Fase B)
      centros: ordenados.map((c) => ({
        ...c,
        disponivel: 0,
        pctExecucao: 0,
        pctDoTotal: 0,
        status: "ok",
      })),
      kpis: {
        totalExecutado: 0,
        totalOrcado: 0,
        disponivel: 0,
        pctExecucaoTotal: 0,
        maiorCC: ordenados[0] ? { nome: ordenados[0].nome, executado: 0, pct: 0 } : null,
        qtdEstouros: 0,
        nomesEstouros: [],
        qtdCentros: centros.length,
      },
    })
  } catch (e) {
    console.error("[financas/cc] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar centros de custo" }, { status: 500 })
  }
}