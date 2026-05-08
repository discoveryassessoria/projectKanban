// src/app/api/financeiro/receitas/[id]/route.ts
// GET    /api/financeiro/receitas/[id]
// PATCH  /api/financeiro/receitas/[id]
// DELETE /api/financeiro/receitas/[id]

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  EditarReceitaSchema,
  formatZodError,
} from "@/lib/financeiro/validacao";

type RouteContext = { params: Promise<{ id: string }> };

async function parseId(ctx: RouteContext): Promise<number | null> {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  return !id || isNaN(id) ? null : id;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const id = await parseId(ctx);
    if (id == null) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    const receita = await prisma.receita.findUnique({
      where: { id },
      include: {
        parcelas: { orderBy: { numero: "asc" } },
        requerentes: { orderBy: { idx: "asc" } },
        eventos: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!receita) {
      return NextResponse.json(
        { error: "Receita não encontrada" },
        { status: 404 }
      );
    }
    return NextResponse.json(receita);
  } catch (err) {
    console.error("[GET /api/financeiro/receitas/[id]] erro:", err);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const id = await parseId(ctx);
    if (id == null) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    const body = await req.json();
    const parse = EditarReceitaSchema.safeParse(body);
    if (!parse.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: formatZodError(parse.error) },
        { status: 400 }
      );
    }

    const existente = await prisma.receita.findUnique({
      where: { id },
      select: { id: true, descricao: true, cancelada: true },
    });
    if (!existente) {
      return NextResponse.json(
        { error: "Receita não encontrada" },
        { status: 404 }
      );
    }
    if (existente.cancelada) {
      return NextResponse.json(
        { error: "Não é possível editar uma receita cancelada" },
        { status: 409 }
      );
    }

    const data = parse.data;
    const camposAlterados = Object.entries(data)
      .filter(([_, v]) => v !== undefined)
      .map(([k]) => k);

    if (camposAlterados.length === 0) {
      return NextResponse.json(
        { error: "Nenhum campo enviado para editar" },
        { status: 400 }
      );
    }

    const atualizada = await prisma.receita.update({
      where: { id },
      data,
      include: {
        parcelas: { orderBy: { numero: "asc" } },
        requerentes: { orderBy: { idx: "asc" } },
        eventos: { orderBy: { createdAt: "desc" } },
      },
    });

    await prisma.eventoFinanceiro.create({
      data: {
        receitaId: id,
        tipo: "EDICAO",
        descricao: `Receita editada (campos: ${camposAlterados.join(", ")})`,
      },
    });

    return NextResponse.json(atualizada);
  } catch (err) {
    console.error("[PATCH /api/financeiro/receitas/[id]] erro:", err);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const id = await parseId(ctx);
    if (id == null) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    const existente = await prisma.receita.findUnique({
      where: { id },
      select: { id: true, descricao: true, cancelada: true },
    });
    if (!existente) {
      return NextResponse.json(
        { error: "Receita não encontrada" },
        { status: 404 }
      );
    }
    if (existente.cancelada) {
      return NextResponse.json({
        id,
        cancelada: true,
        jaEstavaCancelada: true,
      });
    }

    const cancelada = await prisma.receita.update({
      where: { id },
      data: { cancelada: true },
      select: { id: true, codigo: true, cancelada: true },
    });

    await prisma.eventoFinanceiro.create({
      data: {
        receitaId: id,
        tipo: "CANCELAMENTO",
        descricao: `Receita cancelada: ${existente.descricao}`,
      },
    });

    return NextResponse.json(cancelada);
  } catch (err) {
    console.error("[DELETE /api/financeiro/receitas/[id]] erro:", err);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
