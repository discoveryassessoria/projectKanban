// src/app/api/financas/impostos/route.ts
//
// GET /api/financas/impostos — aba "Impostos e Tributos".
//
// ETAPA 1A — FONTE ÚNICA. Os tributos vêm EXCLUSIVAMENTE do cadastro oficial
// `Imposto`, mantido em Gerenciamento (/api/gerenciamento/impostos). Nenhuma
// constante de negócio permanece neste arquivo.
//
// O QUE AINDA NÃO EXISTE: provisionamento. O cadastro define QUAIS tributos
// existem e suas alíquotas; ele não sabe competência, base de cálculo, guia
// emitida nem vencimento — não há tabela de provisão/guia no schema. Esses
// campos voltam ZERADOS/vazios e `previa` permanece true enquanto for assim.
// Zero é honesto; número inventado não é.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const pct = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export async function GET(_req: NextRequest) {
  try {
    const impostos = await prisma.imposto.findMany({
      where: { ativo: true },
      orderBy: [{ tipo: "asc" }, { nome: "asc" }],
      select: {
        id: true, codigo: true, nome: true, tipo: true,
        modoCalculo: true, percentual: true, valorFixo: true, aplicaA: true,
      },
    })

    const agora = new Date()
    const competencia = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`

    // Um item por tributo CADASTRADO. Alíquota é real; base/provisão/vencimento
    // não têm fonte — ficam zerados até existir motor de provisionamento.
    const tributos = impostos.map((i) => ({
      id: String(i.id),
      tipo: i.codigo ? `${i.codigo} · ${i.nome}` : i.nome,
      competencia,
      base: 0,
      aliquota: i.modoCalculo === "fixed" ? 0 : pct(i.percentual),
      provisao: 0,
      vencimento: "",
      status: "previsto",
      // metadados reais do cadastro (aditivos — a tela ignora o que não usa)
      modoCalculo: i.modoCalculo ?? "percentage",
      valorFixo: i.valorFixo != null ? Number(i.valorFixo) : null,
      aplicaA: i.aplicaA ?? null,
      classificacao: i.tipo ?? null,
    }))

    return NextResponse.json({
      // true = tributos são reais, mas a APURAÇÃO ainda não existe
      previa: true,
      motivoPrevia:
        "Cadastro de tributos é real; não há tabela de provisão/guia para apurar competência, base e vencimento.",
      fonte: "cadastro:Imposto",
      kpis: {
        provisaoMes: 0,
        qtdGuias: 0,
        aPagar: 0,
        qtdPendentes: 0,
        pagosMes: 0,
        atrasados: 0,
        totalAtrasado: 0,
      },
      calendario: [],
      cargaTributaria: [],
      tributos,
    })
  } catch (e) {
    console.error("[financas/impostos] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar tributos" }, { status: 500 })
  }
}
