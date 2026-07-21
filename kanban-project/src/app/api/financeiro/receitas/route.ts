// src/app/api/financeiro/receitas/route.ts
// GET  /api/financeiro/receitas?processoId=X[&status=ATIVA] → lista receitas do processo
// POST /api/financeiro/receitas                              → 405: criação manual desativada (só o FinanceRuleEngine cria)

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

    // 🆕 withRetry: cobre cold start do Prisma Postgres
    const receitas = await withRetry(() =>
      prisma.receita.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          parcelas: { orderBy: { numero: "asc" } },
          requerentes: { orderBy: { idx: "asc" } },
          // 🆕 Pasta Documental (espelho de Custos): nomes p/ o detalhe agrupado
          pessoa: { select: { id: true, nome: true, sobrenome: true } },
          tipoServico: { select: { id: true, nome: true } },
          documento: { select: { id: true, tipo: true } },
        },
      })
    );

    // AGRUPAMENTO: o grupo pai da listagem é a FASE de origem. Enriquecemos com o
    // rótulo do CatalogoFase para a UI não precisar de um segundo round-trip.
    const phaseKeys = [...new Set(receitas.map((r) => r.phaseKey).filter((k): k is string => !!k))];
    const fases = phaseKeys.length
      ? await prisma.catalogoFase.findMany({
          where: { phaseKey: { in: phaseKeys } },
          select: { phaseKey: true, label: true },
        })
      : [];
    const labelPorFase = new Map(fases.map((f) => [f.phaseKey, f.label]));

    return NextResponse.json(
      receitas.map((r) => ({
        ...r,
        faseLabel: r.phaseKey ? (labelPorFase.get(r.phaseKey) ?? null) : null,
      }))
    );
  } catch (err) {
    console.error("[GET /api/financeiro/receitas] erro:", err);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

// ── FinanceRuleEngine é o ÚNICO autorizado a criar lançamentos ──────────────
// A criação manual foi DESATIVADA: nenhum endpoint/tela cria receita diretamente.
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
