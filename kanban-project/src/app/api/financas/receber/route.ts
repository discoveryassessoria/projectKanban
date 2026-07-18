// CRIAR EM: src/app/api/financas/receber/route.ts
//
// GET /api/financas/receber — aba "A Receber", dados REAIS do banco.
// Fonte: ParcelaFinanceira (receitaId != null) → Receita → Processo.
// Campos conferidos no schema:
//   - ParcelaFinanceira: numero, valor, valorBrl, vencimento, status (PENDENTE/RECEBIDA/PAGA/CANCELADA), dataPagamento
//   - Receita: nParcelas (total de parcelas), categoria (enum CategoriaReceita), moeda, cancelada, status (ATIVA/RASCUNHO/CANCELADA)
//   - Processo: nome, pais (enum Pais)
// Só DSO e "vs Abril" são mock ("prévia").

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const FX = { EUR: 5.52, USD: 5.08, BRL: 1 }
function toBRL(v: number, m: string) { return v * (FX[m as keyof typeof FX] ?? 1) }
function dias(d: Date) { return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000) }

// rótulos amigáveis pro enum CategoriaReceita
const CAT_LABEL: Record<string, string> = {
  HONORARIOS: "Honorários",
  REEMBOLSO: "Reembolso",
  PASTA_DOCUMENTAL: "Pasta documental",
  OUTROS: "Outros",
}

export async function GET(_req: NextRequest) {
  try {
    const agora = new Date()

    const [parcelas, processosAtivos] = await Promise.all([
      prisma.parcelaFinanceira.findMany({
        // só parcelas de RECEITA cuja receita não está cancelada
        where: { receitaId: { not: null }, receita: { is: { cancelada: false, status: { not: "CANCELADA" } } } },
        orderBy: { vencimento: "asc" },
        select: {
          id: true, numero: true, valor: true, valorBrl: true, vencimento: true, status: true, dataPagamento: true,
          receita: {
            select: {
              id: true, descricao: true, moeda: true, categoria: true, nParcelas: true,
              // §1/§3/§4 — campos CANÔNICOS do lançamento de origem
              origemLancamento: true, naturezaLancamento: true, estornoDeId: true, canceladoEm: true, estornadoEm: true,
              phaseKey: true, configFinanceiraId: true, valorUnitario: true, dataCompetencia: true,
              processo: { select: { id: true, nome: true, pais: true } },
            },
          },
        },
      }),
      prisma.processo.count({ where: { dataConclusao: null } }),
    ])

    const itens = parcelas.map((p) => {
      const moeda = p.receita?.moeda ?? "BRL"
      const valorBRL = p.valorBrl ? Number(p.valorBrl) : toBRL(Number(p.valor), moeda)
      const d = dias(p.vencimento)
      const recebida = p.status === "RECEBIDA" || p.status === "PAGA"
      const cancelada = p.status === "CANCELADA"
      const atrasada = !recebida && !cancelada && p.vencimento < agora
      return {
        id: p.id,
        numero: p.numero,
        totalParcelas: p.receita?.nParcelas ?? 1,
        cliente: p.receita?.processo?.nome ?? "Avulso",
        processoId: p.receita?.processo?.id ?? null,
        pais: p.receita?.processo?.pais ?? null,
        descricao: p.receita?.descricao ?? `Parcela ${p.numero}`,
        categoria: CAT_LABEL[p.receita?.categoria ?? "OUTROS"] ?? "Outros",
        valorBRL,
        vencimento: p.vencimento,
        dataPagamento: p.dataPagamento,
        status: p.status,
        recebida,
        cancelada,
        atrasada,
        diasParaVencer: d,
        // §1/§3/§4/§5 — canônico: origem, vínculo, natureza, bloqueio de edição, estorno
        lancamentoOrigemTipo: "receita" as const,
        lancamentoOrigemId: p.receita?.id ?? null,
        origem: (p.receita?.origemLancamento ?? "PROCESSO") as string,
        natureza: (p.receita?.naturezaLancamento ?? "RECEITA") as string,
        editavelEstrutural: (p.receita?.origemLancamento ?? "PROCESSO") !== "PROCESSO",
        estorno: p.receita?.estornoDeId != null,
        canceladoEm: p.receita?.canceladoEm ?? null,
        estornadoEm: p.receita?.estornadoEm ?? null,
        phaseKey: p.receita?.phaseKey ?? null,
        configFinanceiraId: p.receita?.configFinanceiraId ?? null,
        valorUnitario: p.receita?.valorUnitario != null ? Number(p.receita.valorUnitario) : null,
        dataCompetencia: p.receita?.dataCompetencia ?? null,
      }
    })

    const emAberto = itens.filter((i) => !i.recebida && !i.cancelada)
    const aReceber = emAberto.reduce((a, i) => a + i.valorBRL, 0)
    const atrasadas = itens.filter((i) => i.atrasada)
    const vencido = atrasadas.reduce((a, i) => a + i.valorBRL, 0)
    const recebidoMes = itens
      .filter((i) => i.recebida && i.dataPagamento && new Date(i.dataPagamento).getMonth() === agora.getMonth() && new Date(i.dataPagamento).getFullYear() === agora.getFullYear())
      .reduce((a, i) => a + i.valorBRL, 0)

    const aVencer7 = emAberto.filter((i) => i.diasParaVencer >= 0 && i.diasParaVencer <= 7).reduce((a, i) => a + i.valorBRL, 0)
    const aVencer30 = emAberto.filter((i) => i.diasParaVencer >= 0 && i.diasParaVencer <= 30).reduce((a, i) => a + i.valorBRL, 0)
    const inadimplencia = aReceber > 0 ? (vencido / aReceber) * 100 : 0
    const ticketMedio = emAberto.length > 0 ? aReceber / emAberto.length : 0

    // aging
    const noPrazo = emAberto.filter((i) => i.diasParaVencer >= 0)
    const b30 = emAberto.filter((i) => i.atrasada && i.diasParaVencer >= -30 && i.diasParaVencer < 0)
    const b60 = emAberto.filter((i) => i.atrasada && i.diasParaVencer >= -60 && i.diasParaVencer < -30)
    const b90 = emAberto.filter((i) => i.atrasada && i.diasParaVencer < -60)
    const soma = (arr: typeof itens) => arr.reduce((a, i) => a + i.valorBRL, 0)
    const aging = {
      noPrazo: { total: soma(noPrazo), qtd: noPrazo.length },
      d30: { total: soma(b30), qtd: b30.length },
      d60: { total: soma(b60), qtd: b60.length },
      d90: { total: soma(b90), qtd: b90.length },
    }

    const paises = ["ITALIA", "ESPANHA", "ALEMANHA", "PORTUGAL"]
    const porPais = paises.map((pais) => ({ pais, total: soma(emAberto.filter((i) => i.pais === pais)) }))

    const mapaDevedor = new Map<number, { nome: string; pais: string | null; total: number }>()
    for (const i of emAberto) {
      if (!i.processoId) continue
      const cur = mapaDevedor.get(i.processoId) ?? { nome: i.cliente, pais: i.pais, total: 0 }
      cur.total += i.valorBRL
      mapaDevedor.set(i.processoId, cur)
    }
    const topDevedores = [...mapaDevedor.entries()].map(([id, v]) => ({ processoId: id, ...v })).sort((a, b) => b.total - a.total).slice(0, 5)

    const resumo = {
      totalPrevisto: soma(itens.filter((i) => !i.cancelada)),
      recebido: recebidoMes,
      emAberto: soma(emAberto.filter((i) => !i.atrasada)),
      atrasado: vencido,
      previstoFuturo: soma(emAberto.filter((i) => i.diasParaVencer > 30)),
    }

    // ordena: atrasada → em aberto → recebida; depois por vencimento
    const peso = (i: typeof itens[number]) => (i.atrasada ? 0 : i.recebida ? 4 : i.cancelada ? 5 : 1)
    const lista = [...itens].sort((a, b) => {
      const pa = peso(a), pb = peso(b)
      if (pa !== pb) return pa - pb
      return new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime()
    })

    return NextResponse.json({
      kpis: {
        aReceber, vencido, aVencer7, aVencer30, inadimplencia, ticketMedio,
        qtdAberto: emAberto.length, qtdAtrasadas: atrasadas.length,
        qtdAVencer7: emAberto.filter((i) => i.diasParaVencer >= 0 && i.diasParaVencer <= 7).length,
        processosAtivos,
      },
      aging, porPais, topDevedores, resumo, parcelas: lista,
      contagem: {
        todos: itens.length,
        atrasadas: atrasadas.length,
        proximos7: emAberto.filter((i) => i.diasParaVencer >= 0 && i.diasParaVencer <= 7).length,
        proximos30: emAberto.filter((i) => i.diasParaVencer >= 0 && i.diasParaVencer <= 30).length,
        recebidas: itens.filter((i) => i.recebida).length,
      },
      mock: { dso: 42 },
    })
  } catch (e) {
    console.error("[financas/receber] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar contas a receber" }, { status: 500 })
  }
}