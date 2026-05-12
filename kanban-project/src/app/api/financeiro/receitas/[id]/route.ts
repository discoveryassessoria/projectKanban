// src/app/api/financeiro/receitas/[id]/route.ts
// GET    /api/financeiro/receitas/[id]
// PATCH  /api/financeiro/receitas/[id]   regenera parcelas quando campos críticos mudam
//                                        ou quando rascunho é promovido pra ativa
// DELETE /api/financeiro/receitas/[id]

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  EditarReceitaSchema,
  formatZodError,
} from "@/lib/financeiro/validacao";
import { withRetry } from "@/lib/db-retry"; // 🆕

type RouteContext = { params: Promise<{ id: string }> };

async function parseId(ctx: RouteContext): Promise<number | null> {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  return !id || isNaN(id) ? null : id;
}

function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  const targetDay = out.getDate();
  out.setDate(1);
  out.setMonth(out.getMonth() + n);
  const ultimoDia = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(targetDay, ultimoDia));
  return out;
}

function gerarParcelas(opts: {
  valor: number;
  nParcelas: number;
  dataInicio: Date;
}): Array<{ numero: number; vencimento: Date; valor: number }> {
  const { valor, nParcelas, dataInicio } = opts;
  const valorCentavos = Math.round(valor * 100);
  const baseCentavos = Math.floor(valorCentavos / nParcelas);
  const restoCentavos = valorCentavos - baseCentavos * nParcelas;

  return Array.from({ length: nParcelas }, (_, i) => {
    const venc = addMonths(dataInicio, i);
    const centavos =
      i === nParcelas - 1 ? baseCentavos + restoCentavos : baseCentavos;
    return {
      numero: i + 1,
      vencimento: venc,
      valor: centavos / 100,
    };
  });
}

// ============================================================
// GET
// ============================================================
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const id = await parseId(ctx);
    if (id == null) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    // 🆕 withRetry
    const receita = await withRetry(() =>
      prisma.receita.findUnique({
        where: { id },
        include: {
          parcelas: { orderBy: { numero: "asc" } },
          requerentes: { orderBy: { idx: "asc" } },
          eventos: { orderBy: { createdAt: "desc" } },
        },
      })
    );
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

// ============================================================
// PATCH — atualiza receita e regenera parcelas se necessário
// ============================================================
const CAMPOS_QUE_AFETAM_PARCELAS = [
  "valor",
  "nParcelas",
  "data1",
  "periodicidade",
  "moeda",
  "fxRule",
  "fxFixo",
] as const;

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

    // 🆕 withRetry na primeira chamada
    const existente = await withRetry(() =>
      prisma.receita.findUnique({
        where: { id },
        include: { parcelas: true },
      })
    );
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

    const algumCampoCriticoMudou = CAMPOS_QUE_AFETAM_PARCELAS.some(
      (k) => (data as Record<string, unknown>)[k] !== undefined
    );

    const eraRascunho = existente.status === "RASCUNHO";
    const novoStatus = data.status ?? existente.status;
    const promovendoParaAtiva = eraRascunho && novoStatus === "ATIVA";

    const regenerarParcelas = promovendoParaAtiva || algumCampoCriticoMudou;

    if (regenerarParcelas) {
      const temParcelaProcessada = existente.parcelas.some(
        (p) => p.status === "RECEBIDA" || p.status === "PAGA"
      );
      if (temParcelaProcessada) {
        return NextResponse.json(
          {
            error:
              "Não é possível alterar valor/parcelas/datas: existem parcelas já recebidas. Estorne ou cancele primeiro.",
          },
          { status: 409 }
        );
      }
    }

    const valorEfetivo = data.valor ?? Number(existente.valor);
    const nParcEfetivo = data.nParcelas ?? existente.nParcelas;
    const dataInicioEfetiva = data.data1 ?? existente.data1;

    const atualizada = await prisma.$transaction(async (tx) => {
      if (regenerarParcelas) {
        await tx.parcelaFinanceira.deleteMany({
          where: { receitaId: id },
        });
        if (valorEfetivo > 0 && nParcEfetivo > 0) {
          const novasParcelas = gerarParcelas({
            valor: valorEfetivo,
            nParcelas: nParcEfetivo,
            dataInicio: dataInicioEfetiva,
          });
          await tx.parcelaFinanceira.createMany({
            data: novasParcelas.map((p) => ({
              receitaId: id,
              numero: p.numero,
              vencimento: p.vencimento,
              valor: p.valor,
              status: "PENDENTE",
            })),
          });
        }
      }

      return await tx.receita.update({
        where: { id },
        data,
        include: {
          parcelas: { orderBy: { numero: "asc" } },
          requerentes: { orderBy: { idx: "asc" } },
          eventos: { orderBy: { createdAt: "desc" } },
        },
      });
    });

    const eventoDesc = promovendoParaAtiva
      ? `Rascunho promovido para ATIVA (campos: ${camposAlterados.join(", ")})${algumCampoCriticoMudou ? " — parcelas regeneradas" : " — parcelas geradas"}`
      : `Receita editada (campos: ${camposAlterados.join(", ")})${
          algumCampoCriticoMudou ? " — parcelas regeneradas" : ""
        }`;

    await prisma.eventoFinanceiro.create({
      data: {
        receitaId: id,
        tipo: "EDICAO",
        descricao: eventoDesc,
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

// ============================================================
// DELETE — soft delete (marca cancelada=true)
// ============================================================
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const id = await parseId(ctx);
    if (id == null) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    // 🆕 withRetry na primeira chamada
    const existente = await withRetry(() =>
      prisma.receita.findUnique({
        where: { id },
        select: { id: true, descricao: true, cancelada: true },
      })
    );
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