// src/app/api/financeiro/templates/route.ts
// GET /api/financeiro/templates[?processoId=X]
//   → { templates: [...], sugerido: string|null, requerentes: {adultos,menores}|null }
//
// `templates` é estático (constantes em lib/financeiro/templates.ts).
// Quando `processoId` é passado, também devolve o template sugerido pelo país
// do processo e a contagem de requerentes adultos/menores (pro seletor mostrar
// "N adultos entram na divisão").

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRetry } from "@/lib/db-retry";
import { listarTemplates } from "@/lib/financeiro/templates";
import { detectarTemplateSugerido } from "@/lib/financeiro/templateEngine";

function calcularIdade(dataNasc: Date | null): number | null {
  if (!dataNasc) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear() - dataNasc.getFullYear();
  const m = hoje.getMonth() - dataNasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < dataNasc.getDate())) idade--;
  return idade;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const processoIdStr = searchParams.get("processoId");
    const templates = listarTemplates();

    if (!processoIdStr) {
      return NextResponse.json({
        templates,
        sugerido: null,
        requerentes: null,
      });
    }

    const processoId = Number(processoIdStr);
    if (!processoId || isNaN(processoId)) {
      return NextResponse.json(
        { error: "Query param 'processoId' inválido" },
        { status: 400 },
      );
    }

    // withRetry: cobre cold start do Prisma Postgres
    const processo = await withRetry(() =>
      prisma.processo.findUnique({
        where: { id: processoId },
        select: {
          pais: true,
          informacaoItalia: { select: { id: true } },
          requerentes: {
            select: {
              requerente: { select: { dataNascimento: true } },
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

    let adultos = 0;
    let menores = 0;
    for (const pr of processo.requerentes) {
      const idade = calcularIdade(pr.requerente.dataNascimento ?? null);
      // sem data de nascimento -> conta como adulto provisório
      if (idade == null || idade >= 18) adultos++;
      else menores++;
    }

    return NextResponse.json({
      templates,
      sugerido: detectarTemplateSugerido(
        processo.pais,
        !!processo.informacaoItalia,
      ),
      requerentes: { adultos, menores },
    });
  } catch (err) {
    console.error("[GET /api/financeiro/templates] erro:", err);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 },
    );
  }
}