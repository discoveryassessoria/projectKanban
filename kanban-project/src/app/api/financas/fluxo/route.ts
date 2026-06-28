// CRIAR EM: src/app/api/financas/fluxo/route.ts
//
// GET /api/financas/fluxo — aba "Fluxo de Caixa", dados REAIS.
// Constrói a linha do tempo de caixa combinando:
//   ENTRADAS = ParcelaFinanceira de receita (em aberto ou recebida) por data
//   SAÍDAS   = ContaPagar por data de vencimento/pagamento
// Janela: 90 dias passados + 90 dias futuros.
// Saldo atual = soma de ContaBancaria.saldoAtual.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const FX = { EUR: 5.52, USD: 5.08, BRL: 1 }
function toBRL(v: number, m: string) { return v * (FX[m as keyof typeof FX] ?? 1) }
function dias(d: Date) { return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000) }
function iso(d: Date) { return new Date(d).toISOString().slice(0, 10) }

export async function GET(_req: NextRequest) {
  try {
    const agora = new Date()
    const ini = new Date(agora); ini.setDate(ini.getDate() - 90)
    const fim = new Date(agora); fim.setDate(fim.getDate() + 90)

    const [parcelas, contasPagar, contasBancarias] = await Promise.all([
      prisma.parcelaFinanceira.findMany({
        where: { receitaId: { not: null }, vencimento: { gte: ini, lte: fim }, receita: { is: { cancelada: false } } },
        select: {
          valor: true, valorBrl: true, vencimento: true, status: true, dataPagamento: true,
          receita: { select: { descricao: true, moeda: true, processo: { select: { nome: true } } } },
        },
      }),
      prisma.contaPagar.findMany({
        where: { status: { not: "CANCELADO" }, dataVencimento: { gte: ini, lte: fim } },
        select: {
          valor: true, dataVencimento: true, dataPagamento: true, status: true, descricao: true,
          fornecedor: { select: { nome: true } },
        },
      }),
      prisma.contaBancaria.findMany({ where: { ativo: true }, select: { saldoAtual: true } }),
    ])

    const saldoAtual = contasBancarias.reduce((a, c) => a + Number(c.saldoAtual), 0)

    // monta eventos unificados
    type Evento = { date: string; entrada: number; saida: number; desc: string; tipo: "in" | "out"; realizado: boolean }
    const eventos: Evento[] = []

    for (const p of parcelas) {
      const moeda = p.receita?.moeda ?? "BRL"
      const valorBRL = p.valorBrl ? Number(p.valorBrl) : toBRL(Number(p.valor), moeda)
      const recebida = p.status === "RECEBIDA" || p.status === "PAGA"
      const dataRef = recebida && p.dataPagamento ? p.dataPagamento : p.vencimento
      eventos.push({
        date: iso(dataRef), entrada: valorBRL, saida: 0,
        desc: `${p.receita?.processo?.nome ?? "Avulso"} · ${p.receita?.descricao ?? "Recebimento"}`,
        tipo: "in", realizado: recebida,
      })
    }
    for (const c of contasPagar) {
      const pago = c.status === "PAGO"
      const dataRef = pago && c.dataPagamento ? c.dataPagamento : c.dataVencimento
      eventos.push({
        date: iso(dataRef), entrada: 0, saida: Number(c.valor),
        desc: `${c.fornecedor?.nome ?? "—"} · ${c.descricao}`,
        tipo: "out", realizado: pago,
      })
    }

    eventos.sort((a, b) => a.date.localeCompare(b.date))

    // agrega por dia (pro gráfico e calendário)
    const porDia = new Map<string, { entrada: number; saida: number }>()
    for (const e of eventos) {
      const cur = porDia.get(e.date) ?? { entrada: 0, saida: 0 }
      cur.entrada += e.entrada; cur.saida += e.saida
      porDia.set(e.date, cur)
    }

    // série pro gráfico com saldo acumulado (começa no saldo atual menos o que já passou)
    const diasOrdenados = [...porDia.keys()].sort()
    // saldo de início = saldoAtual menos o líquido já realizado no passado da janela
    const liquidoPassado = eventos.filter(e => e.realizado).reduce((a, e) => a + e.entrada - e.saida, 0)
    let acc = saldoAtual - liquidoPassado
    const serie = diasOrdenados.map((dia) => {
      const v = porDia.get(dia)!
      acc += v.entrada - v.saida
      return { date: dia, entrada: v.entrada, saida: v.saida, saldo: acc }
    })

    // KPIs 30 dias futuros
    const em30 = eventos.filter((e) => { const d = dias(new Date(e.date)); return d >= 0 && d <= 30 })
    const entradas30 = em30.reduce((a, e) => a + e.entrada, 0)
    const saidas30 = em30.reduce((a, e) => a + e.saida, 0)
    const net30 = entradas30 - saidas30

    // calendário do mês corrente
    const ano = agora.getFullYear(), mes = agora.getMonth()
    const ultimoDia = new Date(ano, mes + 1, 0).getDate()
    const primeiroDiaSemana = new Date(ano, mes, 1).getDay()
    const calendario: { day: number | null; hasIn: boolean; hasOut: boolean; isToday: boolean }[] = []
    for (let i = 0; i < primeiroDiaSemana; i++) calendario.push({ day: null, hasIn: false, hasOut: false, isToday: false })
    for (let d = 1; d <= ultimoDia; d++) {
      const isoDia = iso(new Date(ano, mes, d))
      const v = porDia.get(isoDia)
      calendario.push({ day: d, hasIn: !!v && v.entrada > 0, hasOut: !!v && v.saida > 0, isToday: d === agora.getDate() })
    }

    // timeline (limita a 40 eventos pra não pesar)
    const timeline = eventos.slice(0, 40).map((e) => ({
      date: e.date, desc: e.desc, entrada: e.entrada, saida: e.saida,
      realizado: e.realizado, past: dias(new Date(e.date)) < 0,
    }))

    return NextResponse.json({
      kpis: {
        saldoAtual,
        entradas30, qtdEntradas30: em30.filter((e) => e.entrada > 0).length,
        saidas30, qtdSaidas30: em30.filter((e) => e.saida > 0).length,
        saldoProjetado30: saldoAtual + net30, net30,
      },
      serie,
      calendario,
      mesLabel: agora.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
      timeline,
    })
  } catch (e) {
    console.error("[financas/fluxo] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar fluxo de caixa" }, { status: 500 })
  }
}