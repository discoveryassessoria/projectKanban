// src/app/api/financeiro/custos/[id]/route.ts
// GET    /api/financeiro/custos/[id]
// PATCH  /api/financeiro/custos/[id]   regenera parcelas quando campos críticos mudam
//                                      ou quando rascunho é promovido pra ativo
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

// ============================================================
// Helper: adiciona N meses a uma data, ajustando overflow
// ============================================================
function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  const targetDay = out.getDate();
  out.setDate(1);
  out.setMonth(out.getMonth() + n);
  const ultimoDia = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(targetDay, ultimoDia));
  return out;
}

// ============================================================
// Helper: gera array de parcelas pra Custo
// ============================================================
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

// ============================================================
// PATCH — atualiza custo e regenera parcelas se necessário
// ============================================================
const CAMPOS_QUE_AFETAM_PARCELAS = [
  "valor",
  "nParcelas",
  "vencimento",
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
    const parse = EditarCustoSchema.safeParse(body);
    if (!parse.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: formatZodError(parse.error) },
        { status: 400 }
      );
    }

    const existente = await prisma.custo.findUnique({
      where: { id },
      include: { parcelas: true },
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

    // Algum campo crítico (valor/parcelas/datas/câmbio) foi enviado?
    const algumCampoCriticoMudou = CAMPOS_QUE_AFETAM_PARCELAS.some(
      (k) => (data as Record<string, unknown>)[k] !== undefined
    );

    // 🆕 Está promovendo rascunho → ativo?
    // Quando isso acontece, sempre regenera porque o rascunho NÃO tem parcelas.
    const eraRascunho = existente.status === "RASCUNHO";
    const novoStatus = data.status ?? existente.status;
    const promovendoParaAtivo = eraRascunho && novoStatus === "ATIVA";

    const regenerarParcelas = promovendoParaAtivo || algumCampoCriticoMudou;

    if (regenerarParcelas) {
      const temParcelaProcessada = existente.parcelas.some(
        (p) => p.status === "RECEBIDA" || p.status === "PAGA"
      );
      if (temParcelaProcessada) {
        return NextResponse.json(
          {
            error:
              "Não é possível alterar valor/parcelas/datas: existem parcelas já pagas. Estorne ou cancele primeiro.",
          },
          { status: 409 }
        );
      }
    }

    // Valores efetivos (campo enviado OU original)
    const valorEfetivo = data.valor ?? Number(existente.valor);
    const nParcEfetivo = data.nParcelas ?? existente.nParcelas;
    const dataInicioEfetiva = data.vencimento ?? existente.vencimento;

    // Transação: regenerar parcelas (se for o caso) + atualizar
    const atualizado = await prisma.$transaction(async (tx) => {
      if (regenerarParcelas) {
        await tx.parcelaFinanceira.deleteMany({
          where: { custoId: id },
        });
        // Só cria parcelas se o valor for > 0
        if (valorEfetivo > 0 && nParcEfetivo > 0) {
          const novasParcelas = gerarParcelas({
            valor: valorEfetivo,
            nParcelas: nParcEfetivo,
            dataInicio: dataInicioEfetiva,
          });
          await tx.parcelaFinanceira.createMany({
            data: novasParcelas.map((p) => ({
              custoId: id,
              numero: p.numero,
              vencimento: p.vencimento,
              valor: p.valor,
              status: "PENDENTE",
            })),
          });
        }
      }

      return await tx.custo.update({
        where: { id },
        data,
        include: {
          parcelas: { orderBy: { numero: "asc" } },
          eventos: { orderBy: { createdAt: "desc" } },
        },
      });
    });

    const eventoDesc = promovendoParaAtivo
      ? `Rascunho promovido para ATIVO (campos: ${camposAlterados.join(", ")})${algumCampoCriticoMudou ? " — parcelas regeneradas" : " — parcelas geradas"}`
      : `Custo editado (campos: ${camposAlterados.join(", ")})${
          algumCampoCriticoMudou ? " — parcelas regeneradas" : ""
        }`;

    await prisma.eventoFinanceiro.create({
      data: {
        custoId: id,
        tipo: "EDICAO",
        descricao: eventoDesc,
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

// ============================================================
// DELETE — soft delete (marca cancelado=true)
// ============================================================
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