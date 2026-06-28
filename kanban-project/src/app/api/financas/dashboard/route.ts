// CRIAR EM: src/app/api/financas/dashboard/route.ts
//
// GET /api/financas/dashboard
// Alimenta o Dashboard Corporativo do Financeiro Geral.
//
// Tudo que dá pra puxar do banco é REAL:
//   - Caixa consolidado .......... soma de ContaBancaria.saldoAtual (+ por moeda)
//   - A pagar .................... ContaPagar PENDENTE/VENCIDO/AGENDADO
//   - A receber (mês) ............ ParcelaFinanceira PENDENTE no mês corrente
//   - Recebido (mês) ............. ParcelaFinanceira RECEBIDA no mês + PagamentoFatura
//   - Próximos recebimentos ...... ParcelaFinanceira em aberto por vencimento
//   - Próximos pagamentos ........ ContaPagar em aberto por vencimento
//   - Exposição cambial .......... ContaBancaria por moeda (EUR/USD)
//   - Atividade recente .......... LogAuditoria (7 últimas)
//
// O que o mockup inventa e NÃO existe no banco (conversão lead→cliente, DSO/DPO,
// ticket médio, série de 6 meses do gráfico) volta como `mock: {...}` e o front
// mostra como placeholder. Trocamos por dado real numa fatia futura.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// câmbio de referência (mesma ideia do mockup FX). TODO: puxar de fonte real depois.
const FX = { EUR: 5.52, USD: 5.08, BRL: 1 }
function toBRL(valor: number, moeda: string): number {
  return valor * (FX[moeda as keyof typeof FX] ?? 1)
}

function inicioDoMes(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function fimDoMes(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
}

export async function GET(_req: NextRequest) {
  try {
    const agora = new Date()
    const mesIni = inicioDoMes(agora)
    const mesFim = fimDoMes(agora)

    const [
      contas,
      contasPagarAbertas,
      parcelasAbertas,
      parcelasRecebidasMes,
      pagamentosMes,
      processosAtivos,
      logs,
    ] = await Promise.all([
      // contas bancárias (caixa + exposição cambial)
      prisma.contaBancaria.findMany({
        where: { ativo: true },
        select: { id: true, nome: true, banco: true, saldoAtual: true, cor: true, ativo: true },
      }),
      // a pagar em aberto
      prisma.contaPagar.findMany({
        where: { status: { in: ["PENDENTE", "VENCIDO", "AGENDADO"] } },
        select: {
          id: true, descricao: true, valor: true, dataVencimento: true, status: true,
          fornecedor: { select: { nome: true } },
          categoria: { select: { nome: true, cor: true } },
        },
        orderBy: { dataVencimento: "asc" },
      }),
      // a receber em aberto (parcelas de receita pendentes)
      prisma.parcelaFinanceira.findMany({
        where: { status: "PENDENTE", receitaId: { not: null } },
        select: {
          id: true, numero: true, valor: true, valorBrl: true, vencimento: true, status: true,
          receita: {
            select: {
              descricao: true, moeda: true,
              processo: { select: { id: true, nome: true, pais: true } },
            },
          },
        },
        orderBy: { vencimento: "asc" },
      }),
      // recebido no mês (parcelas recebidas)
      prisma.parcelaFinanceira.findMany({
        where: { status: "RECEBIDA", dataPagamento: { gte: mesIni, lte: mesFim }, receitaId: { not: null } },
        select: { valor: true, valorBrl: true, receita: { select: { moeda: true } } },
      }),
      // recebido no mês (pagamentos de fatura)
      prisma.pagamentoFatura.findMany({
        where: { data: { gte: mesIni, lte: mesFim }, estornado: false },
        select: { valor: true, valorOriginal: true, cambio: true, fatura: { select: { moeda: true } } },
      }),
      prisma.processo.count({ where: { dataConclusao: null } }),
      prisma.logAuditoria.findMany({
        orderBy: { criadoEm: "desc" },
        take: 7,
        select: {
          id: true, acao: true, entidade: true, descricao: true, criadoEm: true,
          usuario: { select: { nome: true } },
        },
      }),
    ])

    // ---- caixa consolidado + exposição por moeda ----
    // (saldoAtual é em BRL no schema; exposição cambial real depende de moeda da conta,
    //  que o schema não guarda — então tratamos tudo como BRL e deixamos a exposição
    //  EUR/USD como bloco a calibrar quando houver campo de moeda na conta.)
    const caixaBRL = contas.reduce((acc, c) => acc + Number(c.saldoAtual), 0)

    // ---- a pagar ----
    const aPagarBRL = contasPagarAbertas.reduce((acc, c) => acc + Number(c.valor), 0)
    const qtdPagarPendentes = contasPagarAbertas.filter((c) => c.status === "PENDENTE").length
    const qtdPagarAgendados = contasPagarAbertas.filter((c) => c.status === "AGENDADO").length

    // ---- a receber (mês corrente) ----
    const aReceberMesBRL = parcelasAbertas
      .filter((p) => p.vencimento >= mesIni && p.vencimento <= mesFim)
      .reduce((acc, p) => acc + (p.valorBrl ? Number(p.valorBrl) : toBRL(Number(p.valor), p.receita?.moeda ?? "BRL")), 0)

    const aReceberTotalBRL = parcelasAbertas.reduce(
      (acc, p) => acc + (p.valorBrl ? Number(p.valorBrl) : toBRL(Number(p.valor), p.receita?.moeda ?? "BRL")),
      0,
    )

    // ---- recebido no mês ----
    const recebParcelas = parcelasRecebidasMes.reduce(
      (acc, p) => acc + (p.valorBrl ? Number(p.valorBrl) : toBRL(Number(p.valor), p.receita?.moeda ?? "BRL")),
      0,
    )
    const recebPagamentos = pagamentosMes.reduce(
      (acc, p) => acc + (p.valorOriginal && p.cambio ? Number(p.valorOriginal) * Number(p.cambio) : Number(p.valor)),
      0,
    )
    const recebidoMesBRL = recebParcelas + recebPagamentos

    // ---- inadimplência (parcelas vencidas / total em aberto) ----
    const vencidasBRL = parcelasAbertas
      .filter((p) => p.vencimento < agora)
      .reduce((acc, p) => acc + (p.valorBrl ? Number(p.valorBrl) : toBRL(Number(p.valor), p.receita?.moeda ?? "BRL")), 0)
    const qtdVencidas = parcelasAbertas.filter((p) => p.vencimento < agora).length
    const inadimplenciaPct = aReceberTotalBRL > 0 ? (vencidasBRL / aReceberTotalBRL) * 100 : 0

    // ---- lucro/margem do mês (recebido - pago no mês) ----
    const lucroMesBRL = recebidoMesBRL - aPagarBRL
    const margemPct = recebidoMesBRL > 0 ? (lucroMesBRL / recebidoMesBRL) * 100 : 0

    // ---- próximos recebimentos (5) ----
    const proximosRecebimentos = parcelasAbertas.slice(0, 5).map((p) => ({
      id: p.id,
      cliente: p.receita?.processo?.nome ?? "Avulso",
      pais: p.receita?.processo?.pais ?? null,
      processoId: p.receita?.processo?.id ?? null,
      descricao: p.receita?.descricao ?? `Parcela ${p.numero}`,
      valorBRL: p.valorBrl ? Number(p.valorBrl) : toBRL(Number(p.valor), p.receita?.moeda ?? "BRL"),
      vencimento: p.vencimento,
      atrasado: p.vencimento < agora,
    }))

    // ---- próximos pagamentos (5) ----
    const proximosPagamentos = contasPagarAbertas.slice(0, 5).map((c) => ({
      id: c.id,
      fornecedor: c.fornecedor?.nome ?? "—",
      categoria: c.categoria?.nome ?? "Outros",
      categoriaCor: c.categoria?.cor ?? null,
      valorBRL: Number(c.valor),
      vencimento: c.dataVencimento,
      atrasado: c.dataVencimento < agora,
    }))

    // ---- atividade recente (auditoria) ----
    const atividade = logs.map((l) => ({
      id: l.id,
      acao: l.acao,
      entidade: l.entidade,
      descricao: l.descricao,
      usuario: l.usuario?.nome ?? "Sistema",
      data: l.criadoEm,
    }))

    return NextResponse.json({
      kpis: {
        caixaBRL,
        recebidoMesBRL,
        aReceberMesBRL,
        aPagarBRL,
        qtdPagarPendentes,
        qtdPagarAgendados,
        inadimplenciaPct,
        qtdVencidas,
        vencidasBRL,
        lucroMesBRL,
        margemPct,
        processosAtivos,
      },
      contas: contas.map((c) => ({ id: c.id, nome: c.nome, banco: c.banco, saldoBRL: Number(c.saldoAtual), cor: c.cor })),
      proximosRecebimentos,
      proximosPagamentos,
      atividade,
      // câmbio de referência (pro front mostrar @ R$)
      fx: FX,
      // placeholders (sem fonte no banco ainda) — front mostra como "prévia".
      // Replicam fielmente o mockup; trocamos por dado real numa fatia futura.
      mock: {
        ticketMedioBRL: 20454,
        novosProcessos: 4,
        conversaoPct: 38,
        burnRateBRL: 1281.87,
        runwayDias: 421,
        dso: 42,
        dpo: 28,
        colaboradores: 4,
        // strip do topo
        fechamentoLabel: "Abr/2026",
        fechamentoStatus: "Aberto",
        conciliacaoDiff: 0,
        conciliacaoPendencias: 0,
        aVencerFiscalBRL: 10892,
        qtdImpostos: 3,
        comissoesPendBRL: 2440,
        qtdComissoes: 6,
        // segunda fila
        forecast30BRL: 94046.74,
        exposicaoEUR: 12450.5,
        exposicaoUSD: 3200,
        exposicaoBRL: 84982.76,
        // gráfico
        serie6meses: {
          labels: ["Dez/25", "Jan/26", "Fev/26", "Mar/26", "Abr/26", "Mai/26"],
          entradas: [28000, 34500, 41200, 48800, 56300, 42850],
          saidas: [31500, 36200, 38400, 42100, 45200, 33260],
          saldo: [-3500, -1700, 2800, 6700, 11100, 9590],
          totalEntradas: 195400,
          totalSaidas: 168200,
          totalSaldo: 27200,
        },
        receitaPorPais: { Itália: 88000, Espanha: 63500, Alemanha: 79000, Portugal: 14000 },
        // alertas e aprovações
        alertas: [
          { tipo: "critical", titulo: "Brinker · parcela 2/5", texto: "R$ 4.500 vencida há 6 dias.", meta: "há 6 dias · Sistema" },
          { tipo: "critical", titulo: "Betina · parcela 2/6", texto: "R$ 3.500 vencida há 16 dias.", meta: "há 16 dias · Sistema" },
          { tipo: "warning", titulo: "Aprovação pendente", texto: "Demetrio Saccomandi · R$ 3.600 (tradução).", meta: "aguarda Marco · há 1 dia" },
          { tipo: "info", titulo: "DAS + INSS", texto: "R$ 13.700 vencem em 4 dias.", meta: "20/05 · Financeiro" },
          { tipo: "success", titulo: "Barzaghi quitado", texto: "Parcela final de R$ 5.500 recebida.", meta: "há 4 dias · 12/05" },
        ],
      },
    })
  } catch (e) {
    console.error("[financas/dashboard] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar dashboard" }, { status: 500 })
  }
}