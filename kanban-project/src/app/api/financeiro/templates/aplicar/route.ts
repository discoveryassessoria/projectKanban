// src/app/api/financeiro/templates/aplicar/route.ts
// POST /api/financeiro/templates/aplicar
//   body: { processoId, templateId, opcoes?: { dataInicial?, cambio?, confirmado? } }
//
// Aplica um template financeiro num processo: gera todas as receitas e custos
// (incluindo os custos automáticos de composição interna) numa única
// prisma.$transaction. Espelha `aplicarTemplateFinanceiro` da engine v2 do
// mockup, adaptado pro schema real.
//
// Duplicidade: se o processo já tem receitas/custos ATIVOS e `confirmado` não
// veio true, devolve { ok:false, precisaConfirmacao:true } em vez de aplicar —
// o cliente confirma e re-chama com opcoes.confirmado = true.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withRetry } from "@/lib/db-retry";
import { getTemplate } from "@/lib/financeiro/templates";
import { montarTemplate } from "@/lib/financeiro/templateEngine";
import { gerarCodigoReceita, gerarCodigoCusto } from "@/lib/financeiro/codigos";

const AplicarTemplateSchema = z.object({
  processoId: z.number().int().positive(),
  templateId: z.string().min(1),
  opcoes: z
    .object({
      dataInicial: z.string().optional(),
      cambio: z.number().positive().optional(),
      confirmado: z.boolean().optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parse = AplicarTemplateSchema.safeParse(body);
    if (!parse.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parse.error.issues },
        { status: 400 },
      );
    }
    const { processoId, templateId, opcoes } = parse.data;

    const template = getTemplate(templateId);
    if (!template) {
      return NextResponse.json(
        { error: `Template '${templateId}' não encontrado` },
        { status: 404 },
      );
    }

    // withRetry: primeira chamada Prisma cobre cold start do Postgres
    const processo = await withRetry(() =>
      prisma.processo.findUnique({
        where: { id: processoId },
        select: {
          id: true,
          requerentes: {
            select: {
              requerente: {
                select: { id: true, nome: true, dataNascimento: true },
              },
            },
          },
        },
      }),
    );
    if (!processo) {
      return NextResponse.json(
        { error: `Processo ${processoId} não encontrado` },
        { status: 404 },
      );
    }

    // Duplicidade — conta lançamentos ATIVOS já existentes
    const [receitasExistentes, custosExistentes] = await Promise.all([
      prisma.receita.count({
        where: { processoId, status: "ATIVA", cancelada: false },
      }),
      prisma.custo.count({
        where: { processoId, status: "ATIVA", cancelado: false },
      }),
    ]);

    if (
      (receitasExistentes > 0 || custosExistentes > 0) &&
      !opcoes?.confirmado
    ) {
      return NextResponse.json({
        ok: false,
        precisaConfirmacao: true,
        jaTem: { receitas: receitasExistentes, custos: custosExistentes },
        templateLabel: template.label,
      });
    }

    // Monta as specs (puro, sem DB)
    const requerentesEntrada = processo.requerentes.map((pr) => ({
      requerenteId: pr.requerente.id,
      nome: pr.requerente.nome,
      dataNascimento: pr.requerente.dataNascimento,
    }));

    const montagem = montarTemplate(template, requerentesEntrada, {
      dataInicial: opcoes?.dataInicial,
      cambio: opcoes?.cambio,
    });

    // Gera códigos únicos antes da transação (dedup defensivo dentro do lote)
    const usados = new Set<string>();
    const codigosReceita: string[] = [];
    for (let i = 0; i < montagem.receitas.length; i++) {
      let cod = await gerarCodigoReceita();
      let guard = 0;
      while (usados.has(cod) && guard++ < 10) cod = await gerarCodigoReceita();
      usados.add(cod);
      codigosReceita.push(cod);
    }
    const codigosCusto: string[] = [];
    for (let i = 0; i < montagem.custos.length; i++) {
      let cod = await gerarCodigoCusto();
      let guard = 0;
      while (usados.has(cod) && guard++ < 10) cod = await gerarCodigoCusto();
      usados.add(cod);
      codigosCusto.push(cod);
    }

    // Monta as operações de create
    const opsReceitas = montagem.receitas.map((spec, i) =>
      prisma.receita.create({
        data: {
          codigo: codigosReceita[i],
          processoId,
          categoria: spec.categoria,
          descricao: spec.descricao,
          moeda: spec.moeda,
          valor: spec.valor,
          fxEstimado: spec.fxEstimado,
          fxRule: spec.fxRule,
          fxFixo: spec.fxFixo,
          fxData: spec.fxData,
          valorBrlFixo: spec.valorBrlFixo,
          nParcelas: spec.nParcelas,
          data1: spec.data1,
          periodicidade: spec.periodicidade,
          observacoes: spec.observacoes,
          status: "ATIVA",
          parcelas: {
            create: spec.parcelas.map((p) => ({
              numero: p.numero,
              vencimento: p.vencimento,
              valor: p.valor,
              status: "PENDENTE" as const,
            })),
          },
          requerentes: {
            create: spec.requerentes.map((r) => ({
              idx: r.idx,
              nome: r.nome,
              idade: r.idade,
              statusFamiliar: r.statusFamiliar,
              percentual: r.percentual,
              requerenteId: r.requerenteId,
            })),
          },
          eventos: {
            create: {
              tipo: "CRIACAO" as const,
              descricao: `Receita criada via template "${template.label}": ${spec.descricao}`,
              valor: spec.valor,
              cambio: spec.fxFixo,
              valorBrl: spec.valorBrlFixo,
            },
          },
        },
      }),
    );

    const opsCustos = montagem.custos.map((spec, i) =>
      prisma.custo.create({
        data: {
          codigo: codigosCusto[i],
          processoId,
          tipo: spec.tipo,
          categoria: spec.categoria,
          descricao: spec.descricao,
          fornecedor: spec.fornecedor,
          moeda: spec.moeda,
          valor: spec.valor,
          fxEstimado: spec.fxEstimado,
          fxRule: spec.fxRule,
          fxFixo: spec.fxFixo,
          fxData: spec.fxData,
          valorBrlFixo: spec.valorBrlFixo,
          nParcelas: spec.nParcelas,
          vencimento: spec.vencimento,
          custoOperacional: spec.custoOperacional,
          categoriaVinculada: spec.categoriaVinculada,
          percentualVinculado: spec.percentualVinculado,
          formaPagamento: "TRANSFERENCIA" as const,
          observacoes: spec.observacoes,
          status: "ATIVA",
          parcelas: {
            create: spec.parcelas.map((p) => ({
              numero: p.numero,
              vencimento: p.vencimento,
              valor: p.valor,
              status: "PENDENTE" as const,
            })),
          },
          eventos: {
            create: {
              tipo: "CRIACAO" as const,
              descricao: `Custo criado via template "${template.label}": ${spec.descricao}`,
              valor: spec.valor,
              cambio: spec.fxFixo,
              valorBrl: spec.valorBrlFixo,
            },
          },
        },
      }),
    );

    // Tudo numa transação — ou cria tudo, ou nada
    await prisma.$transaction([...opsReceitas, ...opsCustos]);

    return NextResponse.json(
      {
        ok: true,
        templateId,
        templateLabel: template.label,
        receitasCriadas: montagem.receitas.length,
        custosCriados: montagem.custos.length,
        totalAdultos: montagem.totalAdultos,
        totalMenores: montagem.totalMenores,
        aviso:
          montagem.totalAdultos === 0
            ? "O processo não tem requerentes adultos cadastrados — só os custos do template foram criados."
            : undefined,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("[POST /api/financeiro/templates/aplicar] erro:", err);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 },
    );
  }
}