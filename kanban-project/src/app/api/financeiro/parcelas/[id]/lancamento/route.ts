// src/app/api/financeiro/parcelas/[id]/lancamento/route.ts
// POST /api/financeiro/parcelas/[id]/lancamento
//
// Lança o pagamento (Custo) ou recebimento (Receita) de uma parcela.
// Detecta automaticamente pelo vínculo:
//   - parcela.receitaId preenchido → status RECEBIDA, evento RECEBIMENTO
//   - parcela.custoId   preenchido → status PAGA,     evento PAGAMENTO

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  LancarParcelaSchema,
  formatZodError,
} from "@/lib/financeiro/validacao";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { id: idStr } = await ctx.params;
    const id = Number(idStr);
    if (!id || isNaN(id)) {
      return NextResponse.json(
        { error: "id de parcela inválido" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const parse = LancarParcelaSchema.safeParse(body);
    if (!parse.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: formatZodError(parse.error) },
        { status: 400 }
      );
    }
    const data = parse.data;

    const parcela = await prisma.parcelaFinanceira.findUnique({
      where: { id },
      select: {
        id: true,
        numero: true,
        valor: true,
        status: true,
        receitaId: true,
        custoId: true,
        receita: { select: { cancelada: true, descricao: true } },
        custo: { select: { cancelado: true, descricao: true } },
      },
    });
    if (!parcela) {
      return NextResponse.json(
        { error: "Parcela não encontrada" },
        { status: 404 }
      );
    }

    if (parcela.receitaId == null && parcela.custoId == null) {
      return NextResponse.json(
        { error: "Parcela sem vínculo (receita/custo)" },
        { status: 500 }
      );
    }

    if (parcela.status !== "PENDENTE") {
      return NextResponse.json(
        {
          error: `Parcela já está com status ${parcela.status}; só parcelas PENDENTES podem ser lançadas`,
        },
        { status: 409 }
      );
    }

    const isReceita = parcela.receitaId != null;
    if (isReceita && parcela.receita?.cancelada) {
      return NextResponse.json(
        { error: "Receita está cancelada; não é possível lançar parcela" },
        { status: 409 }
      );
    }
    if (!isReceita && parcela.custo?.cancelado) {
      return NextResponse.json(
        { error: "Custo está cancelado; não é possível lançar parcela" },
        { status: 409 }
      );
    }

    const valorParcela = Number(parcela.valor);
    const valorBrl = Number((valorParcela * data.cambioAplicado).toFixed(2));
    const novoStatus = isReceita ? "RECEBIDA" : "PAGA";
    const tipoEvento = isReceita ? "RECEBIMENTO" : "PAGAMENTO";

    const [parcelaAtualizada] = await prisma.$transaction([
      prisma.parcelaFinanceira.update({
        where: { id },
        data: {
          status: novoStatus,
          cambioAplicado: data.cambioAplicado,
          valorBrl,
          dataPagamento: data.dataPagamento,
          formaPagamento: data.formaPagamento ?? null,
          banco: data.banco ?? null,
          comprovanteUrl: data.comprovanteUrl ?? null,
          comprovanteNome: data.comprovanteNome ?? null,
          observacoes: data.observacoes ?? null,
        },
      }),
      prisma.eventoFinanceiro.create({
        data: {
          receitaId: parcela.receitaId,
          custoId: parcela.custoId,
          tipo: tipoEvento,
          descricao: `${
            tipoEvento === "RECEBIMENTO" ? "Recebimento" : "Pagamento"
          } da parcela ${parcela.numero}${
            data.formaPagamento ? ` via ${data.formaPagamento}` : ""
          } (câmbio aplicado: ${data.cambioAplicado.toFixed(4)})`,
          valor: valorParcela,
          cambio: data.cambioAplicado,
          valorBrl,
          dados: {
            parcelaId: parcela.id,
            parcelaNumero: parcela.numero,
            banco: data.banco ?? null,
          },
        },
      }),
    ]);

    return NextResponse.json(parcelaAtualizada);
  } catch (err) {
    console.error(
      "[POST /api/financeiro/parcelas/[id]/lancamento] erro:",
      err
    );
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
