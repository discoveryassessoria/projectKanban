// CRIAR EM: src/app/api/financas/pagar/route.ts
//
// GET /api/financas/pagar — aba "A Pagar", dados REAIS do banco.
// Fonte: ContaPagar → Fornecedor, CategoriaFinanceira, ContaBancaria.
// Campos do schema:
//   ContaPagar: descricao, valor, valorPago, dataVencimento, dataPagamento,
//     status (StatusContaPagar: PENDENTE/PAGO/VENCIDO/CANCELADO/AGENDADO),
//     numeroParcela, totalParcelas, processoId
//   Fornecedor: nome | CategoriaFinanceira: nome, cor | ContaBancaria: nome
//
// Mapeamento do mockup → schema:
//   mockup "a_pagar" (pendente aprovação) ≈ PENDENTE
//   mockup "aprovado" (pronto p/ pagar)   ≈ AGENDADO
//   mockup "pago"                         ≈ PAGO
//   mockup "previsto"                     ≈ (sem equivalente; usamos PENDENTE futuro)
// DPO é mock ("prévia").

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

function dias(d: Date) { return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000) }

export async function GET(_req: NextRequest) {
  try {
    const agora = new Date()
    const mesIni = new Date(agora.getFullYear(), agora.getMonth(), 1)
    const mesFim = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59)

    const contas = await prisma.contaPagar.findMany({
      orderBy: { dataVencimento: "asc" },
      select: {
        id: true, descricao: true, valor: true, valorPago: true,
        dataVencimento: true, dataPagamento: true, status: true,
        numeroParcela: true, totalParcelas: true,
        fornecedor: { select: { nome: true } },
        categoria: { select: { nome: true, cor: true } },
        contaBancaria: { select: { nome: true } },
      },
    })

    const itens = contas.map((c) => {
      const valor = Number(c.valor)
      const d = dias(c.dataVencimento)
      const pago = c.status === "PAGO"
      const cancelado = c.status === "CANCELADO"
      const aberto = !pago && !cancelado
      const vencido = aberto && (c.status === "VENCIDO" || c.dataVencimento < agora)
      return {
        id: c.id,
        fornecedor: c.fornecedor?.nome ?? "—",
        descricao: c.descricao,
        categoria: c.categoria?.nome ?? "Outros",
        categoriaCor: c.categoria?.cor ?? null,
        conta: c.contaBancaria?.nome ?? null,
        valor,
        vencimento: c.dataVencimento,
        dataPagamento: c.dataPagamento,
        status: c.status,
        numeroParcela: c.numeroParcela,
        totalParcelas: c.totalParcelas,
        pago, cancelado, aberto, vencido,
        diasParaVencer: d,
      }
    })

    const abertos = itens.filter((i) => i.aberto)
    const aPagar = abertos.reduce((a, i) => a + i.valor, 0)
    const vencidos = itens.filter((i) => i.vencido)
    const vencidosTotal = vencidos.reduce((a, i) => a + i.valor, 0)

    // "aguardando aprovação" ≈ AGENDADO (pronto pra pagar)
    const agendados = itens.filter((i) => i.status === "AGENDADO")
    const agendadosTotal = agendados.reduce((a, i) => a + i.valor, 0)
    const pendentes = itens.filter((i) => i.status === "PENDENTE")

    const pagosMes = itens
      .filter((i) => i.pago && i.dataPagamento && new Date(i.dataPagamento) >= mesIni && new Date(i.dataPagamento) <= mesFim)
      .reduce((a, i) => a + i.valor, 0)
    const qtdPagosMes = itens.filter((i) => i.pago && i.dataPagamento && new Date(i.dataPagamento) >= mesIni && new Date(i.dataPagamento) <= mesFim).length

    // pipeline
    const pipeline = {
      pendente: { qtd: pendentes.length, total: pendentes.reduce((a, i) => a + i.valor, 0) },
      agendado: { qtd: agendados.length, total: agendadosTotal },
      pago: { qtd: itens.filter((i) => i.pago).length, total: itens.filter((i) => i.pago).reduce((a, i) => a + i.valor, 0) },
      cancelado: { qtd: itens.filter((i) => i.cancelado).length, total: itens.filter((i) => i.cancelado).reduce((a, i) => a + i.valor, 0) },
    }

    // por categoria (abertos)
    const byCat = new Map<string, { total: number; cor: string | null; qtd: number }>()
    for (const i of abertos) {
      const cur = byCat.get(i.categoria) ?? { total: 0, cor: i.categoriaCor, qtd: 0 }
      cur.total += i.valor; cur.qtd += 1
      byCat.set(i.categoria, cur)
    }
    const topCategorias = [...byCat.entries()]
      .map(([nome, v]) => ({ nome, ...v }))
      .sort((a, b) => b.total - a.total)

    // próximos 7 dias
    const proximos7 = abertos
      .filter((i) => i.diasParaVencer >= 0 && i.diasParaVencer <= 7)
      .sort((a, b) => new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime())
      .slice(0, 6)

    const resumo = {
      total: aPagar,
      vencido: vencidosTotal,
      agendados: agendadosTotal,
      pagos: pagosMes,
      previstoFuturo: abertos.filter((i) => i.diasParaVencer > 30).reduce((a, i) => a + i.valor, 0),
    }

    // ordena: vencido/pendente → agendado → pago → cancelado; depois vencimento
    const peso = (i: typeof itens[number]) => i.vencido ? 0 : i.status === "PENDENTE" ? 1 : i.status === "AGENDADO" ? 2 : i.pago ? 3 : 4
    const lista = [...itens].sort((a, b) => {
      const pa = peso(a), pb = peso(b)
      if (pa !== pb) return pa - pb
      return new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime()
    })

    return NextResponse.json({
      kpis: {
        aPagar, qtdAbertos: abertos.length,
        vencidosTotal, qtdVencidos: vencidos.length,
        agendadosTotal, qtdAgendados: agendados.length,
        pagosMes, qtdPagosMes,
        qtdPendentes: pendentes.length,
      },
      pipeline,
      topCategorias,
      proximos7,
      resumo,
      contas: lista,
      contagem: {
        todos: itens.length,
        vencidos: vencidos.length,
        pendentes: pendentes.length,
        agendados: agendados.length,
        pagos: itens.filter((i) => i.pago).length,
      },
      mock: { dpo: 28 },
    })
  } catch (e) {
    console.error("[financas/pagar] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar contas a pagar" }, { status: 500 })
  }
}