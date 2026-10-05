// GET /api/financas/receber — aba "A Receber", lida do MOTOR V3 (a mesma fonte da aba Central).
// Fonte: ObrigacaoEconomica A_RECEBER + OcorrenciaFinanceira de pagamento (ver lib/financeiro/leitura/abas-v3.ts).
// O motor antigo (ParcelaFinanceira) não é mais lido aqui. Uma obrigação = uma linha; sem vencimento não há "vencida" nem "a vencer".

import { ONDE_PROCESSO_ATIVO_E_NA_TORRE } from "@/src/services/processo-pre-contrato"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { totaisAReceber } from "@/lib/financeiro/leitura/totais-a-receber"
import { carregarBaseV3, diasAte, emAberto as estaEmAberto, recebida as estaRecebida, doMes, soma, SEM_VENCIMENTO } from "@/lib/financeiro/leitura/abas-v3"

const CAT_LABEL: Record<string, string> = {
  RECEITA: "Honorários",
  RECEITA_EXTRA: "Receita extra",
  REEMBOLSO: "Reembolso",
}

export async function GET(_req: NextRequest) {
  try {
    const base = await carregarBaseV3()
    const agora = base.agora
    const processosAtivos = await prisma.processo.count({ where: ONDE_PROCESSO_ATIVO_E_NA_TORRE })

    const itens = base.obrigacoes
      .filter((o) => o.direcao === "A_RECEBER")
      .map((o) => {
        const rec = estaRecebida(o)
        const aberto = estaEmAberto(o)
        const d = diasAte(o.vencimento, agora)
        const valorBRL = aberto ? o.saldoBrl : o.contratadoBrl
        const ultimoPagamento = rec ? base.pagamentos.filter((p) => p.obrigacaoId === o.obrigacaoId).sort((a, b) => b.data.getTime() - a.data.getTime())[0] : undefined
        return {
          id: o.obrigacaoId,
          numero: 1,
          totalParcelas: 1,
          cliente: o.processoNome ?? "Avulso",
          processoId: o.processoId,
          pais: o.pais,
          descricao: o.descricao ?? o.codigoOperacional ?? `Receita ${o.obrigacaoId}`,
          categoria: CAT_LABEL[o.natureza] ?? "Outros",
          valorBRL,
          vencimento: o.vencimento,
          dataPagamento: ultimoPagamento ? ultimoPagamento.data.toISOString() : null,
          status: rec ? "RECEBIDA" : "PENDENTE",
          recebida: rec,
          cancelada: false,
          atrasada: aberto && d != null && d < 0,
          diasParaVencer: d ?? SEM_VENCIMENTO,
          semVencimento: o.vencimento == null,
          lancamentoOrigemTipo: "receita" as const,
          lancamentoOrigemId: o.origemTipo === "Receita" ? null : o.obrigacaoId,
          origem: o.origemLancamento ?? "PROCESSO",
          natureza: o.natureza,
          editavelEstrutural: (o.origemLancamento ?? "PROCESSO") !== "PROCESSO",
          estorno: false,
          canceladoEm: null,
          estornadoEm: null,
          phaseKey: o.phaseKey,
          configFinanceiraId: o.configFinanceiraId,
          valorUnitario: null,
          dataCompetencia: o.criadoEm,
        }
      })

    const aberto = itens.filter((i) => !i.recebida && !i.cancelada)
    // OS TOTAIS vêm da MESMA função que a Central do Financeiro usa (`totais-a-receber.ts`): as duas telas não podem divergir.
    const t7 = totaisAReceber(base.obrigacoes, agora, 7)
    const t30 = totaisAReceber(base.obrigacoes, agora, 30)
    const aReceber = t30.totalReceberBRL
    const atrasadas = itens.filter((i) => i.atrasada)
    const vencido = t30.totalVencidoBRL
    const recebidoMes = soma(base.pagamentos.filter((p) => p.direcao === "A_RECEBER" && doMes(p.data, agora)), (p) => p.valorBrl)
    const noHorizonte = (n: number) => aberto.filter((i) => i.diasParaVencer >= 0 && i.diasParaVencer <= n)
    const aVencer7 = t7.totalAVencerBRL
    const aVencer30 = t30.totalAVencerBRL
    const inadimplencia = aReceber > 0 ? (vencido / aReceber) * 100 : 0
    const ticketMedio = aberto.length > 0 ? aReceber / aberto.length : 0

    const noPrazo = aberto.filter((i) => i.diasParaVencer >= 0)
    const b30 = aberto.filter((i) => i.atrasada && i.diasParaVencer >= -30 && i.diasParaVencer < 0)
    const b60 = aberto.filter((i) => i.atrasada && i.diasParaVencer >= -60 && i.diasParaVencer < -30)
    const b90 = aberto.filter((i) => i.atrasada && i.diasParaVencer < -60)
    const tot = (arr: typeof itens) => soma(arr, (i) => i.valorBRL)
    const aging = {
      noPrazo: { total: tot(noPrazo), qtd: noPrazo.length },
      d30: { total: tot(b30), qtd: b30.length },
      d60: { total: tot(b60), qtd: b60.length },
      d90: { total: tot(b90), qtd: b90.length },
    }

    // A LISTA DE PAÍSES VEM DO CADASTRO (nunca fixa em código).
    const paisesCadastrados = await prisma.catalogoPais.findMany({
      where: { ativo: true }, select: { countryKey: true, countryLabel: true, flag: true }, orderBy: { countryLabel: "asc" },
    })
    const porPais = paisesCadastrados.map((c) => ({
      pais: c.countryLabel, chave: c.countryKey, flag: c.flag ?? null,
      total: tot(aberto.filter((i) => (i.pais ?? "").toLowerCase() === c.countryKey.toLowerCase())),
    }))

    const mapaDevedor = new Map<number, { nome: string; pais: string | null; total: number }>()
    for (const i of aberto) {
      if (!i.processoId) continue
      const cur = mapaDevedor.get(i.processoId) ?? { nome: i.cliente, pais: i.pais, total: 0 }
      cur.total = Math.round((cur.total + i.valorBRL) * 100) / 100
      mapaDevedor.set(i.processoId, cur)
    }
    const topDevedores = [...mapaDevedor.entries()].map(([id, v]) => ({ processoId: id, ...v })).sort((a, b) => b.total - a.total).slice(0, 5)

    const resumo = {
      totalPrevisto: tot(itens.filter((i) => !i.cancelada)),
      recebido: recebidoMes,
      emAberto: tot(aberto.filter((i) => !i.atrasada)),
      atrasado: vencido,
      previstoFuturo: tot(aberto.filter((i) => i.diasParaVencer > 30)),
    }

    const peso = (i: typeof itens[number]) => (i.atrasada ? 0 : i.recebida ? 4 : 1)
    const venc = (i: typeof itens[number]) => (i.vencimento ? new Date(i.vencimento).getTime() : Number.POSITIVE_INFINITY)
    const lista = [...itens].sort((a, b) => peso(a) - peso(b) || venc(a) - venc(b) || a.id - b.id)

    const semVencimento = aberto.filter((i) => i.semVencimento)
    return NextResponse.json({
      kpis: {
        aReceber, vencido, aVencer7, aVencer30, inadimplencia, ticketMedio,
        qtdAberto: aberto.length, qtdAtrasadas: atrasadas.length, qtdAVencer7: noHorizonte(7).length,
        processosAtivos,
      },
      aging, porPais, topDevedores, resumo, parcelas: lista,
      contagem: {
        todos: itens.length, atrasadas: atrasadas.length,
        proximos7: noHorizonte(7).length, proximos30: noHorizonte(30).length,
        recebidas: itens.filter((i) => i.recebida).length,
      },
      mock: { dso: 0 },
      fontes: {
        motor: "V3 (ObrigacaoEconomica + OcorrenciaFinanceira)",
        cambio: base.fx.fonte,
        cambioDataReferencia: base.fx.dataReferencia,
        moedasSemCotacao: base.fx.indisponiveis,
        naoConvertido: base.naoConvertido,
        semVencimento: { qtd: semVencimento.length, totalBRL: tot(semVencimento) },
      },
    })
  } catch (e) {
    console.error("[financas/receber] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar contas a receber" }, { status: 500 })
  }
}
