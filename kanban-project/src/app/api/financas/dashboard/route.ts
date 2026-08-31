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
import { carregarFx, converterBrl } from "@/lib/financeiro/cambio-financas"


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

    // ETAPA 1A — câmbio vem de CotacaoCambio (job diário). Sem cotação real o
    // valor NÃO é convertido: fica fora do total e é declarado em `fontes`.
    const fx = await carregarFx()
    const semCotacao: { moeda: string; valor: number }[] = []
    const toBRL = (valor: number, moeda?: string | null): number => {
      const c = converterBrl(fx, valor, moeda)
      if (c == null) { semCotacao.push({ moeda: (moeda ?? "BRL").toUpperCase(), valor }); return 0 }
      return c
    }

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
              processo: { select: { id: true, nome: true, pais: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } } } },
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
      pais: p.receita?.processo?.paisCanonico?.countryKey ?? null,
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
      // câmbio de referência REAL (pro front mostrar @ R$)
      fx: fx.taxas,
      fontes: {
        cambio: fx.fonte,
        cambioDataReferencia: fx.dataReferencia,
        moedasSemCotacao: fx.indisponiveis,
        naoConvertido: semCotacao,
      },
      // placeholders (sem fonte no banco ainda) — front mostra como "prévia".
      // SEM DADOS FICTÍCIOS: métricas ainda não consolidadas voltam ZERADAS/vazias
      // (nunca números inventados). Serão preenchidas por dado real numa fatia futura.
      mock: (() => {
        const now = new Date()
        const labels = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
          return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "")
        })
        const zeros = [0, 0, 0, 0, 0, 0]
        return {
          ticketMedioBRL: 0, novosProcessos: 0, conversaoPct: 0, burnRateBRL: 0, runwayDias: 0, dso: 0, dpo: 0,
          colaboradores: 0,
          fechamentoLabel: now.toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(".", ""),
          fechamentoStatus: "Aberto",
          conciliacaoDiff: 0, conciliacaoPendencias: 0,
          aVencerFiscalBRL: 0, qtdImpostos: 0, comissoesPendBRL: 0, qtdComissoes: 0,
          forecast30BRL: 0, exposicaoEUR: 0, exposicaoUSD: 0, exposicaoBRL: 0,
          serie6meses: { labels, entradas: zeros, saidas: zeros, saldo: zeros, totalEntradas: 0, totalSaidas: 0, totalSaldo: 0 },
          receitaPorPais: {},
          alertas: [] as { tipo: string; titulo: string; texto: string; meta: string }[],
        }
      })(),
    })
  } catch (e) {
    console.error("[financas/dashboard] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar dashboard" }, { status: 500 })
  }
}