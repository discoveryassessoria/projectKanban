// src/app/api/financas/comissoes/route.ts
//
// GET /api/financas/comissoes — aba "Comissões".
//
// ETAPA 1A — FONTE ÚNICA. As regras vêm EXCLUSIVAMENTE do cadastro oficial
// `RegraComissao`, mantido em Gerenciamento (/api/gerenciamento/regras-comissao).
// Nenhuma constante de negócio permanece neste arquivo.
//
// O QUE AINDA NÃO EXISTE: apuração. O cadastro define COMO comissionar; não há
// tabela de comissão apurada (beneficiário × processo × base × vencimento), então
// a lista de comissões volta VAZIA e os KPIs ZERADOS. `previa` segue true enquanto
// não existir motor de apuração ligado ao recebimento.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const MOMENTO_LABEL: Record<string, string> = {
  first_payment_received: "no primeiro pagamento recebido",
  contract_signed: "sobre contrato fechado",
  each_payment: "sobre cada parcela paga",
  full_payment: "na quitação total",
}

const fmtBRL = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export async function GET(_req: NextRequest) {
  try {
    const regrasCad = await prisma.regraComissao.findMany({
      orderBy: [{ ativo: "desc" }, { name: "asc" }],
      select: {
        id: true, name: true, papel: true, modoCalculo: true,
        percent: true, valorFixo: true, momento: true, ativo: true,
      },
    })

    const regras = regrasCad.map((r) => ({
      id: String(r.id),
      nome: r.name,
      tipo: r.papel ?? "—",
      base: MOMENTO_LABEL[r.momento] ?? r.momento,
      valor:
        r.modoCalculo === "fixed"
          ? r.valorFixo != null
            ? fmtBRL(Number(r.valorFixo))
            : "—"
          : r.percent != null
            ? `${Number(r.percent).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
            : "—",
      // o cadastro não tem escopo de aplicação (país/processo) — não inventar
      aplicacao: "—",
      ativa: r.ativo,
    }))

    return NextResponse.json({
      // true = regras são reais, mas a APURAÇÃO ainda não existe
      previa: true,
      motivoPrevia:
        "Regras de comissão são reais; não há tabela de comissão apurada por beneficiário/processo.",
      fonte: "cadastro:RegraComissao",
      kpis: {
        aPagar: 0, qtdAPagar: 0,
        previstas: 0, qtdPrevistas: 0,
        pagas: 0, qtdPagas: 0,
        destaque: "—", totalDestaque: 0, qtdDestaque: 0,
      },
      regras,
      comissoes: [],
      contagem: { todos: 0, a_pagar: 0, previstas: 0, pagas: 0 },
    })
  } catch (e) {
    console.error("[financas/comissoes] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar comissões" }, { status: 500 })
  }
}
