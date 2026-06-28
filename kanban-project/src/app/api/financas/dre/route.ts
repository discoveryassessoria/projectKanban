// CRIAR EM: src/app/api/financas/dre/route.ts
//
// GET /api/financas/dre — Demonstração de Resultado (gerencial).
// REAL: Receita Bruta = Σ Receita do mês (por data1/parcelas); Custos = Σ Custo + ContaPagar do mês.
// MOCK ("prévia"): a quebra fina do DRE (Folha/Marketing/Sistemas/Jurídico/
//   impostos separados/ajustes cambiais) e o comparativo mês anterior — o schema
//   não tem um plano de contas estruturado pra isso. Estrutura fiel ao mockup.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const FX = { EUR: 5.52, USD: 5.08, BRL: 1 }
function toBRL(v: number, m: string) { return v * (FX[m as keyof typeof FX] ?? 1) }

function intervaloMes(ref: Date) {
  return { ini: new Date(ref.getFullYear(), ref.getMonth(), 1), fim: new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59) }
}

export async function GET(_req: NextRequest) {
  try {
    const agora = new Date()
    const mesAtual = intervaloMes(agora)
    const refAnterior = new Date(agora.getFullYear(), agora.getMonth() - 1, 1)
    const mesAnterior = intervaloMes(refAnterior)

    // RECEITA real do mês (parcelas de receita previstas/recebidas no mês)
    const [parcMesAtual, parcMesAnterior, custosMesAtual, contasPagarMes] = await Promise.all([
      prisma.parcelaFinanceira.findMany({
        where: { receitaId: { not: null }, vencimento: { gte: mesAtual.ini, lte: mesAtual.fim }, receita: { is: { cancelada: false } } },
        select: { valor: true, valorBrl: true, receita: { select: { moeda: true } } },
      }),
      prisma.parcelaFinanceira.findMany({
        where: { receitaId: { not: null }, vencimento: { gte: mesAnterior.ini, lte: mesAnterior.fim }, receita: { is: { cancelada: false } } },
        select: { valor: true, valorBrl: true, receita: { select: { moeda: true } } },
      }),
      prisma.parcelaFinanceira.findMany({
        where: { custoId: { not: null }, vencimento: { gte: mesAtual.ini, lte: mesAtual.fim }, custo: { is: { cancelado: false } } },
        select: { valor: true, valorBrl: true, custo: { select: { moeda: true } } },
      }),
      prisma.contaPagar.findMany({
        where: { status: { not: "CANCELADO" }, dataVencimento: { gte: mesAtual.ini, lte: mesAtual.fim } },
        select: { valor: true },
      }),
    ])

    const somaParc = (arr: any[], chaveMoeda: "receita" | "custo") =>
      arr.reduce((a, p) => a + (p.valorBrl ? Number(p.valorBrl) : toBRL(Number(p.valor), p[chaveMoeda]?.moeda ?? "BRL")), 0)

    const receitaBruta = somaParc(parcMesAtual, "receita")
    const receitaBrutaPrev = somaParc(parcMesAnterior, "receita")
    const custosVariaveis = somaParc(custosMesAtual, "custo")
    const despesasContas = contasPagarMes.reduce((a, c) => a + Number(c.valor), 0)

    // estimativas (mock onde não há fonte estruturada)
    const impostosReceita = receitaBruta * 0.136 // ~Simples+ISS+IRRF
    const receitaLiquida = receitaBruta - impostosReceita
    const lucroBruto = receitaLiquida - custosVariaveis
    const despesasOperacionais = despesasContas // o que houver em contas a pagar
    const lucroOperacional = lucroBruto - despesasOperacionais
    const ajustesFinanceiros = 0
    const lucroLiquido = lucroOperacional + ajustesFinanceiros

    const margem = (v: number) => (receitaBruta > 0 ? (v / receitaBruta) * 100 : 0)
    const ah = (cur: number, prev: number) => (prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : 0)

    return NextResponse.json({
      periodoAtual: agora.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
      periodoAnterior: refAnterior.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
      kpis: {
        receitaBruta, receitaBrutaPrev, ahReceita: ah(receitaBruta, receitaBrutaPrev),
        lucroBruto, margemBruta: margem(lucroBruto),
        lucroOperacional, margemOper: margem(lucroOperacional),
        lucroLiquido, margemLiq: margem(lucroLiquido),
      },
      // estrutura do DRE (real onde dá, mock nas sublinhas)
      dre: {
        receitaBruta: { valor: receitaBruta, prev: receitaBrutaPrev, av: 100, real: true },
        impostosReceita: { valor: -impostosReceita, prev: -receitaBrutaPrev * 0.136, av: margem(-impostosReceita), real: false },
        receitaLiquida: { valor: receitaLiquida, prev: receitaBrutaPrev * 0.864, av: margem(receitaLiquida), real: false },
        custosVariaveis: { valor: -custosVariaveis, prev: 0, av: margem(-custosVariaveis), real: true },
        lucroBruto: { valor: lucroBruto, prev: 0, av: margem(lucroBruto), real: false },
        despesasOperacionais: { valor: -despesasOperacionais, prev: 0, av: margem(-despesasOperacionais), real: true },
        lucroOperacional: { valor: lucroOperacional, prev: 0, av: margem(lucroOperacional), real: false },
        ajustesFinanceiros: { valor: ajustesFinanceiros, prev: 0, av: 0, real: false },
        lucroLiquido: { valor: lucroLiquido, prev: 0, av: margem(lucroLiquido), real: false },
      },
      mock: {
        // sublinhas detalhadas (sem fonte estruturada no banco)
        impostosDetalhe: [
          { label: "Simples Nacional (8,6%)", valor: -impostosReceita * 0.58 },
          { label: "ISS Amparo (5%)", valor: -impostosReceita * 0.34 },
          { label: "IRRF", valor: -impostosReceita * 0.08 },
        ],
        despesasDetalhe: [
          { label: "Folha + encargos", valor: -(despesasOperacionais * 0.45) },
          { label: "Marketing + Tráfego", valor: -(despesasOperacionais * 0.18) },
          { label: "Comissões", valor: -(despesasOperacionais * 0.12) },
          { label: "Administrativo", valor: -(despesasOperacionais * 0.10) },
          { label: "Jurídico · Parceiros", valor: -(despesasOperacionais * 0.08) },
          { label: "Sistemas / Tecnologia", valor: -(despesasOperacionais * 0.05) },
          { label: "Outras despesas", valor: -(despesasOperacionais * 0.02) },
        ],
      },
    })
  } catch (e) {
    console.error("[financas/dre] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar DRE" }, { status: 500 })
  }
}