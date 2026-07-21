// src/app/api/financeiro/custos/route.ts
// GET  /api/financeiro/custos?processoId=X[&status=ATIVA] → lista custos do processo
// POST /api/financeiro/custos                              → cria custo (com parcelas, exceto rascunho)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRetry } from "@/lib/db-retry"; // 🆕

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const processoIdStr = searchParams.get("processoId");
    const processoId = Number(processoIdStr);
    if (!processoIdStr || !processoId || isNaN(processoId)) {
      return NextResponse.json(
        { error: "Query param 'processoId' obrigatório e numérico" },
        { status: 400 }
      );
    }

    const statusStr = searchParams.get("status");
    const statusValido = ["ATIVA", "RASCUNHO", "CANCELADA"];
    const where: { processoId: number; status?: "ATIVA" | "RASCUNHO" | "CANCELADA" } =
      { processoId };
    if (statusStr && statusValido.includes(statusStr)) {
      where.status = statusStr as "ATIVA" | "RASCUNHO" | "CANCELADA";
    }

    // 🆕 withRetry
    const custos = await withRetry(() =>
      prisma.custo.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          parcelas: { orderBy: { numero: "asc" } },
          // 🆕 Pasta Documental: nomes p/ o detalhe agrupado (aditivo — não quebra
          // consumidores existentes; campos podem vir null p/ custos não vinculados).
          pessoa: { select: { id: true, nome: true, sobrenome: true } },
          tipoServico: { select: { id: true, nome: true } },
          documento: { select: { id: true, tipo: true } },
        },
      })
    );

    return NextResponse.json(custos);
  } catch (err) {
    console.error("[GET /api/financeiro/custos] erro:", err);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

// ── FinanceRuleEngine é o ÚNICO autorizado a criar lançamentos ──────────────
// A criação manual foi DESATIVADA: nenhum endpoint/tela cria custo diretamente.
// O corpo original é preservado abaixo (renomeado) só para referência/compat.
export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: "Criação manual desativada. Lançamentos financeiros são gerados exclusivamente pelo FinanceRuleEngine (a partir de eventos/automações e do cadastro mestre).",
      codigo: "CRIACAO_MANUAL_DESATIVADA",
    },
    { status: 405 },
  )
}
