// src/app/api/financeiro/custos/[id]/route.ts
// GET    /api/financeiro/custos/[id]
// PATCH  /api/financeiro/custos/[id]
// DELETE /api/financeiro/custos/[id]

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  EditarCustoSchema,
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

    const custo = await prisma.custo.findUnique({
      where: { id },
      include: {
        parcelas: { orderBy: { numero: "asc" } },
        eventos: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!custo) {
      return NextResponse.json(
        { error: "Custo não encontrado" },
        { status: 404 }
      );
    }
    return NextResponse.json(custo);
  } catch (err) {
    console.error("[GET /api/financeiro/custos/[id]] erro:", err);
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
    const parse = EditarCustoSchema.safeParse(body);
    if (!parse.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: formatZodError(parse.error) },
        { status: 400 }
      );
    }

    const existente = await prisma.custo.findUnique({
      where: { id },
      select: { id: true, descricao: true, cancelado: true },
    });
    if (!existente) {
      return NextResponse.json(
        { error: "Custo não encontrado" },
        { status: 404 }
      );
    }
    if (existente.cancelado) {
      return NextResponse.json(
        { error: "Não é possível editar um custo cancelado" },
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

    const atualizado = await prisma.custo.update({
      where: { id },
      data,
      include: {
        parcelas: { orderBy: { numero: "asc" } },
        eventos: { orderBy: { createdAt: "desc" } },
      },
    });

    await prisma.eventoFinanceiro.create({
      data: {
        custoId: id,
        tipo: "EDICAO",
        descricao: `Custo editado (campos: ${camposAlterados.join(", ")})`,
      },
    });

    return NextResponse.json(atualizado);
  } catch (err) {
    console.error("[PATCH /api/financeiro/custos/[id]] erro:", err);
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

    const existente = await prisma.custo.findUnique({
      where: { id },
      select: { id: true, descricao: true, cancelado: true },
    });
    if (!existente) {
      return NextResponse.json(
        { error: "Custo não encontrado" },
        { status: 404 }
      );
    }
    if (existente.cancelado) {
      return NextResponse.json({
        id,
        cancelado: true,
        jaEstavaCancelado: true,
      });
    }

    const cancelado = await prisma.custo.update({
      where: { id },
      data: { cancelado: true },
      select: { id: true, codigo: true, cancelado: true },
    });

    await prisma.eventoFinanceiro.create({
      data: {
        custoId: id,
        tipo: "CANCELAMENTO",
        descricao: `Custo cancelado: ${existente.descricao}`,
      },
    });

    return NextResponse.json(cancelado);
  } catch (err) {
    console.error("[DELETE /api/financeiro/custos/[id]] erro:", err);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
