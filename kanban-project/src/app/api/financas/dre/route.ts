// src/app/api/financas/dre/route.ts
//
// GET /api/financas/dre — Demonstração de Resultado (gerencial).
//
// FONTE: MOTOR V3 (a mesma da aba Central) — ObrigacaoEconomica por COMPETÊNCIA REAL: a `dataCompetencia` do lançamento de origem ou o
// `vencimento` da obrigação. A data de CRIAÇÃO nunca é competência; obrigação sem data fica numa linha à parte (`semCompetencia`),
// fora de qualquer mês e dos totais mensais. Receita bruta = A_RECEBER natureza RECEITA/RECEITA_EXTRA; custos variáveis = A_PAGAR natureza CUSTO;
// despesas operacionais = demais A_PAGAR, quebradas por fornecedor. O motor antigo (ParcelaFinanceira/Custo/ContaPagar) não é mais lido.
// Nada aqui é estimado por percentual arbitrário.
//   • Câmbio: o da própria obrigação (computeCambioAging), nunca taxa fixa.
//   • Impostos sobre receita: cadastro oficial `Imposto` (aplicaA = revenue).
//     A alíquota agregada é a SOMA das alíquotas cadastradas e ativas — não
//     mais o 13,6% inventado.
//   • Quebra de despesas: agrupada por FORNECEDOR real de ContaPagar.
//
// A classificação financeira intermediária (Categorias, Plano de Contas e
// Centros de Custo) foi ELIMINADA em 02/08/2026: o comportamento financeiro
// pertence à Configuração Financeira do cadastro mestre. Sem cadastro de
// classificação, a única dimensão REAL de uma conta a pagar é o fornecedor —
// é por ele que a despesa é quebrada. Nada é inventado nem estimado.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { carregarBaseV3, soma, NATUREZAS_RECEITA } from "@/lib/financeiro/leitura/abas-v3"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

function intervaloMes(ref: Date) {
  return { ini: new Date(ref.getFullYear(), ref.getMonth(), 1), fim: new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59) }
}

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export async function GET(req: NextRequest) {
  // 🔒 Sem checagem nenhuma antes — expunha a DRE gerencial pra qualquer
  // usuário autenticado.
  const erro = await verificarPermissao(req, "financeiro.ver")
  if (erro) return erro
  try {
    const agora = new Date()
    const mesAtual = intervaloMes(agora)
    const refAnterior = new Date(agora.getFullYear(), agora.getMonth() - 1, 1)
    const mesAnterior = intervaloMes(refAnterior)

    const base = await carregarBaseV3(agora)
    const fx = base.fx
    const impostosReceitaCad = await prisma.imposto.findMany({
      where: { ativo: true, aplicaA: "revenue", modoCalculo: { not: "fixed" } },
      select: { id: true, codigo: true, nome: true, percentual: true },
      orderBy: { nome: "asc" },
    })
    const noMes = (o: { competencia: Date | null }, m: { ini: Date; fim: Date }) => o.competencia != null && o.competencia >= m.ini && o.competencia <= m.fim
    const receitas = base.obrigacoes.filter((o) => o.direcao === "A_RECEBER" && NATUREZAS_RECEITA.includes(o.natureza))
    const pagaveis = base.obrigacoes.filter((o) => o.direcao === "A_PAGAR")
    const custos = pagaveis.filter((o) => o.natureza === "CUSTO")
    const despesas = pagaveis.filter((o) => o.natureza !== "CUSTO")

    // SEM COMPETÊNCIA DEFINIDA — fora de qualquer mês e dos totais mensais (igual ao "sem vencimento" do Fluxo).
    const semData = (arr: typeof base.obrigacoes) => { const x = arr.filter((o) => o.competencia == null); return { qtd: x.length, totalBRL: soma(x, (o) => o.contratadoBrl) } }
    const semCompetencia = { receitas: semData(receitas), aPagar: semData(pagaveis) }

    const rBruta = { total: soma(receitas.filter((o) => noMes(o, mesAtual)), (o) => o.contratadoBrl) }
    const rBrutaPrev = { total: soma(receitas.filter((o) => noMes(o, mesAnterior)), (o) => o.contratadoBrl) }
    const cVariaveis = { total: soma(custos.filter((o) => noMes(o, mesAtual)), (o) => o.contratadoBrl) }
    const contasPagarMes = despesas.filter((o) => noMes(o, mesAtual)).map((o) => ({ valor: o.contratadoBrl, fornecedor: { nome: o.fornecedor } }))

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

    // ── quebra de despesas: por FORNECEDOR real ──────────────────────────────
    const porFornecedor = new Map<string, number>()
    for (const c of contasPagarMes) {
      const label = c.fornecedor?.nome ?? "Sem fornecedor"
      porFornecedor.set(label, cent((porFornecedor.get(label) ?? 0) + Number(c.valor)))
    }
    const despesasDetalhe = [...porFornecedor.entries()]
      .map(([label, valor]) => ({ label, valor: -valor, real: true }))
      .sort((a, b) => a.valor - b.valor)

    const margem = (v: number) => (receitaBruta > 0 ? (v / receitaBruta) * 100 : 0)
    const ah = (cur: number, prev: number) => (prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : 0)

    const naoConvertido = base.naoConvertido

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
      semCompetencia,
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
        despesas: "V3 › obrigações A_PAGAR (não-custo) › Fornecedor",
        motor: "V3 (ObrigacaoEconomica) por competência real (data do lançamento ou vencimento); sem data = linha à parte",
        classificacaoIntermediaria: false,
        classificacaoObs: "Categorias Financeiras, Plano de Contas e Centros de Custo foram eliminados: o comportamento financeiro vive na Configuração Financeira do cadastro mestre.",
      },
    })
  } catch (e) {
    console.error("[financas/dre] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar DRE" }, { status: 500 })
  }
}
