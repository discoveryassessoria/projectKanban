// src/app/api/financeiro/receitas/route.ts
// GET  /api/financeiro/receitas?processoId=X  → lista receitas do processo
// POST /api/financeiro/receitas               → cria receita (com parcelas + requerentes)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  CriarReceitaSchema,
  formatZodError,
} from "@/lib/financeiro/validacao";
import { gerarCodigoReceita } from "@/lib/financeiro/codigos";
import { gerarParcelas } from "@/lib/financeiro/parcelas";

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

    const receitas = await prisma.receita.findMany({
      where: { processoId },
      orderBy: { createdAt: "desc" },
      include: {
        parcelas: { orderBy: { numero: "asc" } },
        requerentes: { orderBy: { idx: "asc" } },
      },
    });

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

    const processo = await prisma.processo.findUnique({
      where: { id: data.processoId },
      select: { id: true },
    });
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

    const parcelas = gerarParcelas(data.valor, data.nParcelas, data.data1);

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
        parcelas: {
          create: parcelas.map((p) => ({
            numero: p.numero,
            vencimento: p.vencimento,
            valor: p.valor,
            status: "PENDENTE" as const,
          })),
        },
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
        eventos: {
          create: {
            tipo: "CRIACAO" as const,
            descricao: `Receita criada: ${data.descricao}`,
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
