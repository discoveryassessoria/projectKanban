// src/app/api/financas/dre/route.ts
//
// GET /api/financas/dre — Demonstração de Resultado (gerencial).
//
// ETAPA 1A — FONTE ÚNICA. Nada aqui é estimado por percentual arbitrário.
//   • Câmbio: CotacaoCambio (lib/financeiro/cambio-financas), nunca taxa fixa.
//   • Impostos sobre receita: cadastro oficial `Imposto` (aplicaA = revenue).
//     A alíquota agregada é a SOMA das alíquotas cadastradas e ativas — não
//     mais o 13,6% inventado.
//   • Quebra de despesas: agrupada por `CategoriaFinanceira` real de ContaPagar.
//
// LIMITE CONHECIDO — vínculo com PlanoConta: `ContaPagar` não possui FK para
// `PlanoConta`, então a quebra do DRE por conta contábil oficial é impossível
// hoje sem inventar o mapeamento. O plano de contas oficial é devolvido em
// `planoContas` (real) e `planoContaVinculado: false` declara a lacuna. A
// quebra usa a única dimensão real existente: categoria financeira.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { carregarFx, somarBrl } from "@/lib/financeiro/cambio-financas"

function intervaloMes(ref: Date) {
  return { ini: new Date(ref.getFullYear(), ref.getMonth(), 1), fim: new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59) }
}

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export async function GET(_req: NextRequest) {
  try {
    const agora = new Date()
    const mesAtual = intervaloMes(agora)
    const refAnterior = new Date(agora.getFullYear(), agora.getMonth() - 1, 1)
    const mesAnterior = intervaloMes(refAnterior)

    const fx = await carregarFx()

    const [parcMesAtual, parcMesAnterior, custosMesAtual, contasPagarMes, impostosReceitaCad, planoContas] =
      await Promise.all([
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
          select: { valor: true, categoriaId: true },
        }),
        // cadastro oficial de tributos que incidem sobre RECEITA
        prisma.imposto.findMany({
          where: { ativo: true, aplicaA: "revenue", modoCalculo: { not: "fixed" } },
          select: { id: true, codigo: true, nome: true, percentual: true },
          orderBy: { nome: "asc" },
        }),
        prisma.planoConta.findMany({
          where: { ativo: true },
          select: { id: true, codigo: true, nome: true, tipo: true, natureza: true },
          orderBy: { codigo: "asc" },
        }),
      ])

    const somaParc = (arr: any[], chave: "receita" | "custo") =>
      somarBrl(fx, arr.map((p) => ({ valor: Number(p.valor), moeda: p[chave]?.moeda ?? "BRL", valorBrl: p.valorBrl != null ? Number(p.valorBrl) : null })))

    const rBruta = somaParc(parcMesAtual, "receita")
    const rBrutaPrev = somaParc(parcMesAnterior, "receita")
    const cVariaveis = somaParc(custosMesAtual, "custo")

    const receitaBruta = rBruta.total
    const receitaBrutaPrev = rBrutaPrev.total
    const custosVariaveis = cVariaveis.total
    const despesasOperacionais = cent(contasPagarMes.reduce((a, c) => a + Number(c.valor), 0))

    // ── impostos sobre receita: alíquota REAL do cadastro ────────────────────
    const aliquotaTotal = impostosReceitaCad.reduce((a, i) => a + Number(i.percentual ?? 0), 0)
    const impostosReceita = cent(receitaBruta * (aliquotaTotal / 100))
    const impostosReceitaPrev = cent(receitaBrutaPrev * (aliquotaTotal / 100))
    const impostosDetalhe = impostosReceitaCad.map((i) => ({
      label: `${i.codigo ? `${i.codigo} · ` : ""}${i.nome} (${Number(i.percentual ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%)`,
      valor: -cent(receitaBruta * (Number(i.percentual ?? 0) / 100)),
      real: true,
    }))

    const receitaLiquida = cent(receitaBruta - impostosReceita)
    const lucroBruto = cent(receitaLiquida - custosVariaveis)
    const lucroOperacional = cent(lucroBruto - despesasOperacionais)
    const ajustesFinanceiros = 0
    const lucroLiquido = cent(lucroOperacional + ajustesFinanceiros)

    // ── quebra de despesas: por CategoriaFinanceira REAL ─────────────────────
    const catIds = [...new Set(contasPagarMes.map((c) => c.categoriaId).filter((v): v is number => v != null))]
    const categorias = catIds.length
      ? await prisma.categoriaFinanceira.findMany({ where: { id: { in: catIds } }, select: { id: true, nome: true } })
      : []
    const nomeCat = new Map(categorias.map((c) => [c.id, c.nome]))
    const porCategoria = new Map<string, number>()
    for (const c of contasPagarMes) {
      const label = c.categoriaId != null ? (nomeCat.get(c.categoriaId) ?? `Categoria #${c.categoriaId}`) : "Sem categoria"
      porCategoria.set(label, cent((porCategoria.get(label) ?? 0) + Number(c.valor)))
    }
    const despesasDetalhe = [...porCategoria.entries()]
      .map(([label, valor]) => ({ label, valor: -valor, real: true }))
      .sort((a, b) => a.valor - b.valor)

    const margem = (v: number) => (receitaBruta > 0 ? (v / receitaBruta) * 100 : 0)
    const ah = (cur: number, prev: number) => (prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : 0)

    const naoConvertido = [...rBruta.naoConvertido, ...rBrutaPrev.naoConvertido, ...cVariaveis.naoConvertido]

    return NextResponse.json({
      periodoAtual: agora.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
      periodoAnterior: refAnterior.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
      kpis: {
        receitaBruta, receitaBrutaPrev, ahReceita: ah(receitaBruta, receitaBrutaPrev),
        lucroBruto, margemBruta: margem(lucroBruto),
        lucroOperacional, margemOper: margem(lucroOperacional),
        lucroLiquido, margemLiq: margem(lucroLiquido),
      },
      dre: {
        receitaBruta: { valor: receitaBruta, prev: receitaBrutaPrev, av: 100, real: true },
        impostosReceita: { valor: -impostosReceita, prev: -impostosReceitaPrev, av: margem(-impostosReceita), real: true },
        receitaLiquida: { valor: receitaLiquida, prev: cent(receitaBrutaPrev - impostosReceitaPrev), av: margem(receitaLiquida), real: true },
        custosVariaveis: { valor: -custosVariaveis, prev: 0, av: margem(-custosVariaveis), real: true },
        lucroBruto: { valor: lucroBruto, prev: 0, av: margem(lucroBruto), real: true },
        despesasOperacionais: { valor: -despesasOperacionais, prev: 0, av: margem(-despesasOperacionais), real: true },
        lucroOperacional: { valor: lucroOperacional, prev: 0, av: margem(lucroOperacional), real: true },
        ajustesFinanceiros: { valor: ajustesFinanceiros, prev: 0, av: 0, real: true },
        lucroLiquido: { valor: lucroLiquido, prev: 0, av: margem(lucroLiquido), real: true },
      },
      detalhe: { impostos: impostosDetalhe, despesas: despesasDetalhe },
      // compatibilidade: `mock` mantido enquanto a tela consumir esse nome,
      // porém agora com dados REAIS (nenhuma estimativa por percentual fixo).
      mock: { impostosDetalhe, despesasDetalhe },
      fontes: {
        cambio: fx.fonte,
        cambioDataReferencia: fx.dataReferencia,
        moedasSemCotacao: fx.indisponiveis,
        naoConvertido,
        impostos: "cadastro:Imposto",
        aliquotaReceitaTotal: aliquotaTotal,
        despesas: "ContaPagar › CategoriaFinanceira",
        planoContaVinculado: false,
        planoContaObs: "ContaPagar não possui vínculo com PlanoConta; quebra por conta contábil exige esse relacionamento.",
      },
      planoContas,
    })
  } catch (e) {
    console.error("[financas/dre] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar DRE" }, { status: 500 })
  }
}
