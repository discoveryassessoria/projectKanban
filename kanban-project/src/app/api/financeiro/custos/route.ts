// src/app/api/financeiro/custos/route.ts
// GET  /api/financeiro/custos?processoId=X[&status=ATIVA] → lista custos do processo
// POST /api/financeiro/custos                              → cria custo (com parcelas, exceto rascunho)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  CriarCustoSchema,
  formatZodError,
} from "@/lib/financeiro/validacao";
import { gerarCodigoCusto } from "@/lib/financeiro/codigos";
import { gerarParcelas } from "@/lib/financeiro/parcelas";
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parse = CriarCustoSchema.safeParse(body);
    if (!parse.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: formatZodError(parse.error) },
        { status: 400 }
      );
    }
    const data = parse.data;

    // 🆕 withRetry na primeira chamada
    const processo = await withRetry(() =>
      prisma.processo.findUnique({
        where: { id: data.processoId },
        select: { id: true },
      })
    );
    if (!processo) {
      return NextResponse.json(
        { error: `Processo ${data.processoId} não encontrado` },
        { status: 404 }
      );
    }

    const codigo = await gerarCodigoCusto();

    const valorBrlFixo =
      data.fxRule === "FIXO" && data.fxFixo
        ? Number((data.valor * data.fxFixo).toFixed(2))
        : null;

    // Rascunho não gera parcelas
    const isRascunho = data.status === "RASCUNHO";
    const parcelas = isRascunho
      ? []
      : gerarParcelas(data.valor, data.nParcelas, data.vencimento);

    const cambioReferencia = data.fxFixo ?? data.fxEstimado;
    const valorBrlReferencia = Number(
      (data.valor * cambioReferencia).toFixed(2)
    );

    const custo = await prisma.custo.create({
      data: {
        codigo,
        processoId: data.processoId,
        tipo: data.tipo,
        categoria: data.categoria,
        descricao: data.descricao,
        fornecedor: data.fornecedor ?? null,
        moeda: data.moeda,
        valor: data.valor,
        fxEstimado: data.fxEstimado,
        fxRule: data.fxRule,
        fxFixo: data.fxFixo ?? null,
        fxData: data.fxData ?? null,
        valorBrlFixo,
        nParcelas: data.nParcelas,
        vencimento: data.vencimento,
        custoOperacional: data.custoOperacional,
        categoriaVinculada: data.categoriaVinculada ?? null,
        percentualVinculado: data.percentualVinculado ?? null,
        formaPagamento: data.formaPagamento,
        observacoes: data.observacoes ?? null,
        status: data.status,
        ...(parcelas.length > 0 && {
          parcelas: {
            create: parcelas.map((p) => ({
              numero: p.numero,
              vencimento: p.vencimento,
              valor: p.valor,
              status: "PENDENTE" as const,
            })),
          },
        }),
        eventos: {
          create: {
            tipo: "CRIACAO" as const,
            descricao: isRascunho
              ? `Rascunho criado: ${data.descricao}`
              : `Custo criado: ${data.descricao}`,
            valor: data.valor,
            cambio: cambioReferencia,
            valorBrl: valorBrlReferencia,
          },
        },
      },
      include: {
        parcelas: { orderBy: { numero: "asc" } },
        eventos: { orderBy: { createdAt: "desc" } },
      },
    });

    return NextResponse.json(custo, { status: 201 });
  } catch (err) {
    console.error("[POST /api/financeiro/custos] erro:", err);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}