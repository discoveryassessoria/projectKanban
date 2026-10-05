// CRIAR EM: src/app/api/financas/dashboard/route.ts
//
// GET /api/financas/dashboard
// Alimenta o Dashboard Corporativo do Financeiro Geral.
//
// Tudo que dá pra puxar do banco é REAL:
//   - Caixa consolidado .......... soma de ContaBancaria.saldoAtual (+ por moeda)
//   - A pagar .................... obrigações V3 A_PAGAR com saldo (mesma fonte da aba Central)
//   - A receber (mês) ............ obrigações V3 A_RECEBER em aberto com vencimento no mês
//   - Recebido (mês) ............. ocorrências de pagamento V3 do mês
//   - Próximos recebimentos ...... obrigações A_RECEBER em aberto, por vencimento (sem vencimento ao fim)
//   - Próximos pagamentos ........ obrigações A_PAGAR em aberto, por vencimento
//   (motor antigo — ParcelaFinanceira/ContaPagar/PagamentoFatura — NÃO é mais lido aqui; ver lib/financeiro/leitura/abas-v3.ts)
//   - Exposição cambial .......... ContaBancaria por moeda (EUR/USD)
//   - Atividade recente .......... LogAuditoria (7 últimas)
//
// O que o mockup inventa e NÃO existe no banco (conversão lead→cliente, DSO/DPO,
// ticket médio, série de 6 meses do gráfico) volta como `mock: {...}` e o front
// mostra como placeholder. Trocamos por dado real numa fatia futura.

import { ONDE_PROCESSO_ATIVO_E_NA_TORRE } from "@/src/services/processo-pre-contrato"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { carregarBaseV3, doMes, emAberto, soma } from "@/lib/financeiro/leitura/abas-v3"
import { verificarPermissao } from "@/src/lib/verificar-permissao"


function inicioDoMes(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function fimDoMes(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
}

export async function GET(req: NextRequest) {
  // 🔒 Sem checagem nenhuma antes — expunha caixa, a pagar/receber e
  // atividade recente pra qualquer usuário autenticado.
  const erro = await verificarPermissao(req, "financeiro.ver")
  if (erro) return erro
  try {
    const agora = new Date()
    const mesIni = inicioDoMes(agora)
    const mesFim = fimDoMes(agora)

    const base = await carregarBaseV3(agora)
    const fx = base.fx
    const semData = (a: Date | null) => (a ? a.getTime() : Number.POSITIVE_INFINITY)

    const [contas, processosAtivos, logs] = await Promise.all([
      // contas bancárias (caixa)
      prisma.contaBancaria.findMany({
        where: { ativo: true },
        select: { id: true, nome: true, banco: true, saldoAtual: true, cor: true, ativo: true },
      }),
      prisma.processo.count({ where: ONDE_PROCESSO_ATIVO_E_NA_TORRE }),
      prisma.logAuditoria.findMany({
        orderBy: { criadoEm: "desc" },
        take: 7,
        select: {
          id: true, acao: true, entidade: true, descricao: true, criadoEm: true,
          usuario: { select: { nome: true } },
        },
      }),
    ])

    const abertasReceber = base.obrigacoes.filter((o) => o.direcao === "A_RECEBER" && emAberto(o))
      .sort((a, b) => semData(a.vencimento ? new Date(a.vencimento) : null) - semData(b.vencimento ? new Date(b.vencimento) : null) || a.obrigacaoId - b.obrigacaoId)
    const abertasPagar = base.obrigacoes.filter((o) => o.direcao === "A_PAGAR" && emAberto(o))
      .sort((a, b) => semData(a.vencimento ? new Date(a.vencimento) : null) - semData(b.vencimento ? new Date(b.vencimento) : null) || a.obrigacaoId - b.obrigacaoId)
    const venc = (o: { vencimento: string | null }) => (o.vencimento ? new Date(o.vencimento) : null)

    // ---- caixa consolidado ----
    const caixaBRL = contas.reduce((acc, c) => acc + Number(c.saldoAtual), 0)

    // ---- a pagar ----
    const aPagarBRL = soma(abertasPagar, (o) => o.saldoBrl)
    const qtdPagarPendentes = abertasPagar.length
    const qtdPagarAgendados = 0

    // ---- a receber (mês corrente: só o que tem vencimento no mês) ----
    const aReceberMesBRL = soma(abertasReceber.filter((o) => { const v = venc(o); return v != null && v >= mesIni && v <= mesFim }), (o) => o.saldoBrl)
    const aReceberTotalBRL = soma(abertasReceber, (o) => o.saldoBrl)

    // ---- recebido no mês ----
    const recebidoMesBRL = soma(base.pagamentos.filter((p) => p.direcao === "A_RECEBER" && doMes(p.data, agora)), (p) => p.valorBrl)

    // ---- inadimplência (vencido / total em aberto; sem vencimento nunca é vencido) ----
    const vencidas = abertasReceber.filter((o) => { const v = venc(o); return v != null && v < agora })
    const vencidasBRL = soma(vencidas, (o) => o.saldoBrl)
    const qtdVencidas = vencidas.length
    const inadimplenciaPct = aReceberTotalBRL > 0 ? (vencidasBRL / aReceberTotalBRL) * 100 : 0

    // ---- lucro/margem do mês (recebido - pago no mês) ----
    const pagoMesBRL = soma(base.pagamentos.filter((p) => p.direcao === "A_PAGAR" && doMes(p.data, agora)), (p) => p.valorBrl)
    const lucroMesBRL = recebidoMesBRL - pagoMesBRL
    const margemPct = recebidoMesBRL > 0 ? (lucroMesBRL / recebidoMesBRL) * 100 : 0

    // ---- próximos recebimentos (5) ----
    const proximosRecebimentos = abertasReceber.slice(0, 5).map((o) => ({
      id: o.obrigacaoId,
      cliente: o.processoNome ?? "Avulso",
      pais: o.pais,
      flag: o.flag,
      processoId: o.processoId,
      descricao: o.descricao ?? o.codigoOperacional ?? `Receita ${o.obrigacaoId}`,
      valorBRL: o.saldoBrl,
      vencimento: o.vencimento,
      atrasado: venc(o) != null && venc(o)! < agora,
    }))

    // ---- próximos pagamentos (5) ----
    const proximosPagamentos = abertasPagar.slice(0, 5).map((o) => ({
      id: o.obrigacaoId,
      fornecedor: o.fornecedor ?? "—",
      valorBRL: o.saldoBrl,
      vencimento: o.vencimento,
      atrasado: venc(o) != null && venc(o)! < agora,
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
        naoConvertido: base.naoConvertido,
        motor: "V3 (ObrigacaoEconomica + OcorrenciaFinanceira)",
        semVencimento: { qtd: abertasReceber.filter((o) => !o.vencimento).length, totalBRL: soma(abertasReceber.filter((o) => !o.vencimento), (o) => o.saldoBrl) },
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