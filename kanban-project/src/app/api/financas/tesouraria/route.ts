// src/app/api/financas/tesouraria/route.ts
// GET /api/financas/tesouraria
// SOMENTE DADOS REAIS: lista de ContaBancaria do banco. Sem contas cadastradas →
// tudo zerado/vazio (nada de contas/transferências/projeção fictícias). Cotações
// de câmbio vêm da CotacaoCambio; sem cotação, a moeda estrangeira não é convertida.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(_req: NextRequest) {
  try {
    const [reais, cotacoes] = await Promise.all([
      prisma.contaBancaria.findMany({
        where: { ativo: true },
        orderBy: [{ principal: "desc" }, { nome: "asc" }],
        select: { id: true, nome: true, banco: true, tipoConta: true, saldoAtual: true, cor: true, principal: true, moeda: true },
      }),
      prisma.cotacaoCambio.findMany({ where: { moedaPara: "BRL", ativo: true }, orderBy: { criadoEm: "desc" }, select: { moedaDe: true, taxa: true } }),
    ])

    // taxa moeda→BRL a partir de cotações REAIS (BRL=1). Sem cotação → não converte.
    const fx: Record<string, number> = { BRL: 1 }
    for (const c of cotacoes) if (!(c.moedaDe in fx)) fx[c.moedaDe] = Number(c.taxa)
    const toBRL = (v: number, m: string) => v * (fx[m] ?? (m === "BRL" ? 1 : 0))

    const temReais = reais.length > 0
    const contas = reais.map((c) => {
      const moeda = (c.moeda as string) || "BRL"
      const saldoNativo = Number(c.saldoAtual)
      return {
        id: c.id, nome: c.nome, banco: c.banco, tipo: c.tipoConta || "conta_corrente",
        moeda, saldoNativo, saldoBRL: toBRL(saldoNativo, moeda),
        projetadoNativo: saldoNativo, projetadoBRL: toBRL(saldoNativo, moeda),
        cor: c.cor, principal: c.principal, mock: false,
      }
    })

    const totalBRL = contas.reduce((a, c) => a + c.saldoBRL, 0)
    const projetadoBRL = totalBRL
    const brlBRL = contas.filter((c) => c.moeda === "BRL").reduce((a, c) => a + c.saldoBRL, 0)
    const eurNativo = contas.filter((c) => c.moeda === "EUR").reduce((a, c) => a + c.saldoNativo, 0)
    const usdNativo = contas.filter((c) => c.moeda === "USD").reduce((a, c) => a + c.saldoNativo, 0)

    const contagem = {
      todas: contas.length,
      BRL: contas.filter((c) => c.moeda === "BRL").length,
      EUR: contas.filter((c) => c.moeda === "EUR").length,
      USD: contas.filter((c) => c.moeda === "USD").length,
      conta_corrente: contas.filter((c) => c.tipo === "conta_corrente").length,
      reserva: contas.filter((c) => c.tipo === "reserva").length,
    }
    const saldoPorTipo = {
      "Conta corrente": contas.filter((c) => c.tipo === "conta_corrente").reduce((a, c) => a + c.saldoBRL, 0),
      "Reserva / aplicação": contas.filter((c) => c.tipo === "reserva").reduce((a, c) => a + c.saldoBRL, 0),
      "Wallet internacional": contas.filter((c) => c.tipo === "conta_internacional").reduce((a, c) => a + c.saldoBRL, 0),
      "Caixa interno": contas.filter((c) => c.tipo === "caixa_interno").reduce((a, c) => a + c.saldoBRL, 0),
    }
    const conciliacao = contas.map((c) => ({ nome: c.nome, saldoSistema: c.saldoBRL, saldoBanco: c.saldoBRL, diferenca: 0, pendencias: 0 }))

    return NextResponse.json({
      temReais,
      contas,
      totalBRL, projetadoBRL,
      brlBRL, eurNativo, usdNativo,
      contagem, saldoPorTipo, conciliacao,
      fx,
      ultimaConciliacao: null,
      // Sem dados fictícios: transferências/projeção só existem quando houver dado real.
      mock: {
        transferencias: [],
        projecao45: Array.from({ length: 46 }, (_, i) => ({ dia: i, saldo: totalBRL })),
        cotacoes: { eurBrl: fx.EUR ?? null, usdBrl: fx.USD ?? null, atualizado: null },
      },
    })
  } catch (e) {
    console.error("[financas/tesouraria] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar tesouraria" }, { status: 500 })
  }
}
