// src/app/api/financeiro/receitas/route.ts
// GET  /api/financeiro/receitas?processoId=X[&status=ATIVA] → lista receitas do processo
// POST /api/financeiro/receitas                              → cria receita (com parcelas + requerentes, exceto rascunho)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  CriarReceitaSchema,
  formatZodError,
} from "@/lib/financeiro/validacao";
import { gerarCodigoReceita } from "@/lib/financeiro/codigos";
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

    return NextResponse.json(receitas);
  } catch (err) {
    console.error("[GET /api/financeiro/receitas] erro:", err);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parse = CriarReceitaSchema.safeParse(body);
    if (!parse.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: formatZodError(parse.error) },
        { status: 400 }
      );
    }
    const data = parse.data;

    // 🆕 withRetry só na primeira chamada Prisma — se passa, banco tá acordado
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

    const codigo = await gerarCodigoReceita();

    const valorBrlFixo =
      data.fxRule === "FIXO" && data.fxFixo
        ? Number((data.valor * data.fxFixo).toFixed(2))
        : null;

    // Rascunho não gera parcelas — só são criadas quando promove pra ATIVA
    const isRascunho = data.status === "RASCUNHO";
    const parcelas = isRascunho
      ? []
      : gerarParcelas(data.valor, data.nParcelas, data.data1);

    const cambioReferencia = data.fxFixo ?? data.fxEstimado;
    const valorBrlReferencia = Number(
      (data.valor * cambioReferencia).toFixed(2)
    );

    const receita = await prisma.receita.create({
      data: {
        codigo,
        processoId: data.processoId,
        categoria: data.categoria,
        descricao: data.descricao,
        moeda: data.moeda,
        valor: data.valor,
        fxEstimado: data.fxEstimado,
        fxRule: data.fxRule,
        fxFixo: data.fxFixo ?? null,
        fxData: data.fxData ?? null,
        valorBrlFixo,
        nParcelas: data.nParcelas,
        data1: data.data1,
        periodicidade: data.periodicidade,
        observacoes: data.observacoes ?? null,
        status: data.status,
        // §4 — congelamento também no lançamento MANUAL (sem regra de preço).
        origem: "manual", origemLancamento: "PROCESSO", naturezaLancamento: "RECEITA",
        valorUnitario: data.valor, quantidade: 1, valorTotalCongelado: data.valor,
        modoCalculoAplicado: "manual", naturezaPreco: "VENDA", dataReferencia: new Date(),
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
        ...(data.requerentes.length > 0 && {
          requerentes: {
            create: data.requerentes.map((r) => ({
              idx: r.idx,
              nome: r.nome,
              idade: r.idade ?? null,
              statusFamiliar: r.statusFamiliar ?? null,
              percentual: r.percentual,
              requerenteId: r.requerenteId ?? null,
            })),
          },
        }),
        eventos: {
          create: {
            tipo: "CRIACAO" as const,
            descricao: isRascunho
              ? `Rascunho criado: ${data.descricao}`
              : `Receita criada: ${data.descricao}`,
            valor: data.valor,
            cambio: cambioReferencia,
            valorBrl: valorBrlReferencia,
          },
        },
      },
      include: {
        parcelas: { orderBy: { numero: "asc" } },
        requerentes: { orderBy: { idx: "asc" } },
        eventos: { orderBy: { createdAt: "desc" } },
      },
    });

    return NextResponse.json(receita, { status: 201 });
  } catch (err) {
    console.error("[POST /api/financeiro/receitas] erro:", err);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}