// CRIAR/SUBSTITUIR EM: src/app/api/financas/tesouraria/route.ts
//
// GET /api/financas/tesouraria
// REAL: lista de ContaBancaria do banco + total. Se o banco estiver vazio,
// o front cai no conjunto mock (as 6 contas do mockup, marcadas "prévia").
// MOCK fiel ao mockup: 6 contas (Itaú/Nubank/Inter/Wise EUR/Wise USD/Caixa),
// conciliação por conta, moedas, transferências (moeda nativa), projeção 45d,
// cotações. Tudo "prévia" no front até existir dado real.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const FX = { EUR: 5.52, USD: 5.08, BRL: 1 }
function toBRL(v: number, m: string) { return v * (FX[m as keyof typeof FX] ?? 1) }

// as 6 contas do mockup (idênticas) — usadas como "prévia" quando não há contas reais
const CONTAS_MOCK = [
  { id: -1, nome: "Itaú Empresarial", banco: "Itaú · Ag 0001 / CC 12345-6", tipo: "conta_corrente", moeda: "BRL", saldoNativo: 287450.32, projetadoNativo: 342100.0, cor: "#ff6900", principal: true },
  { id: -2, nome: "Nubank PJ", banco: "Nubank · CNPJ", tipo: "conta_corrente", moeda: "BRL", saldoNativo: 45120.18, projetadoNativo: 52300.0, cor: "#820ad1", principal: false },
  { id: -3, nome: "Inter Reserva", banco: "Inter · Aplicação CDB", tipo: "reserva", moeda: "BRL", saldoNativo: 120000.0, projetadoNativo: 120480.0, cor: "#ff7a00", principal: false },
  { id: -4, nome: "Wise EUR", banco: "Wise · Conta multimoeda", tipo: "conta_internacional", moeda: "EUR", saldoNativo: 12450.5, projetadoNativo: 18200.0, cor: "#00b9ff", principal: false },
  { id: -5, nome: "Wise USD", banco: "Wise · Conta multimoeda", tipo: "conta_internacional", moeda: "USD", saldoNativo: 3200.0, projetadoNativo: 3200.0, cor: "#163300", principal: false },
  { id: -6, nome: "Caixa Interno", banco: "Dinheiro / despesas miúdas", tipo: "caixa_interno", moeda: "BRL", saldoNativo: 1830.0, projetadoNativo: 1830.0, cor: "#64748b", principal: false },
]

export async function GET(_req: NextRequest) {
  try {
    const reais = await prisma.contaBancaria.findMany({
      where: { ativo: true },
      orderBy: [{ principal: "desc" }, { nome: "asc" }],
      select: { id: true, nome: true, banco: true, tipoConta: true, saldoAtual: true, cor: true, principal: true },
    })

    const temReais = reais.length > 0

    // monta a lista exibida: real (se houver) ou mock
    const contas = temReais
      ? reais.map((c) => ({
          id: c.id, nome: c.nome, banco: c.banco, tipo: c.tipoConta || "conta_corrente",
          moeda: "BRL", saldoNativo: Number(c.saldoAtual), saldoBRL: Number(c.saldoAtual),
          projetadoNativo: Number(c.saldoAtual), projetadoBRL: Number(c.saldoAtual),
          cor: c.cor, principal: c.principal, mock: false,
        }))
      : CONTAS_MOCK.map((c) => ({
          id: c.id, nome: c.nome, banco: c.banco, tipo: c.tipo, moeda: c.moeda,
          saldoNativo: c.saldoNativo, saldoBRL: toBRL(c.saldoNativo, c.moeda),
          projetadoNativo: c.projetadoNativo, projetadoBRL: toBRL(c.projetadoNativo, c.moeda),
          cor: c.cor, principal: c.principal, mock: true,
        }))

    const totalBRL = contas.reduce((a, c) => a + c.saldoBRL, 0)
    const projetadoBRL = contas.reduce((a, c) => a + c.projetadoBRL, 0)

    const brlBRL = contas.filter((c) => c.moeda === "BRL").reduce((a, c) => a + c.saldoBRL, 0)
    const eurNativo = contas.filter((c) => c.moeda === "EUR").reduce((a, c) => a + c.saldoNativo, 0)
    const usdNativo = contas.filter((c) => c.moeda === "USD").reduce((a, c) => a + c.saldoNativo, 0)

    const contagem = {
      todas: contas.length,
      BRL: contas.filter((c) => c.moeda === "BRL").length,
      EUR: contas.filter((c) => c.moeda === "EUR").length,
      USD: contas.filter((c) => c.moeda === "USD").length,
      conta_corrente: contas.filter((c) => c.tipo === "conta_corrente").length,
      reserva: contas.filter((c) => c.tipo === "reserva").length,
    }

    const saldoPorTipo = {
      "Conta corrente": contas.filter((c) => c.tipo === "conta_corrente").reduce((a, c) => a + c.saldoBRL, 0),
      "Reserva / aplicação": contas.filter((c) => c.tipo === "reserva").reduce((a, c) => a + c.saldoBRL, 0),
      "Wallet internacional": contas.filter((c) => c.tipo === "conta_internacional").reduce((a, c) => a + c.saldoBRL, 0),
      "Caixa interno": contas.filter((c) => c.tipo === "caixa_interno").reduce((a, c) => a + c.saldoBRL, 0),
    }

    // conciliação: por conta, saldo sistema = saldo banco (sem diferença) — placeholder
    const conciliacao = contas.map((c) => ({
      nome: c.nome, saldoSistema: c.saldoBRL, saldoBanco: c.saldoBRL, diferenca: 0, pendencias: 0,
    }))

    return NextResponse.json({
      temReais,
      contas,
      totalBRL, projetadoBRL,
      brlBRL, eurNativo, usdNativo,
      contagem, saldoPorTipo, conciliacao,
      fx: FX,
      ultimaConciliacao: "15/05 às 18:42",
      mock: {
        transferencias: [
          { data: "15/05", hora: "14:22", de: "Itaú Empresarial", para: "Inter Reserva", moeda: "BRL", valor: 50000, taxa: null, obs: "Reserva de emergência mensal", por: "MR" },
          { data: "12/05", hora: "09:10", de: "Wise EUR", para: "Itaú Empresarial", moeda: "EUR", valor: 8200, taxa: 5.51, obs: "Conversão recebimento Itália", por: "MR" },
          { data: "08/05", hora: "16:45", de: "Nubank PJ", para: "Itaú Empresarial", moeda: "BRL", valor: 15000, taxa: null, obs: "Consolidação caixa", por: "MR" },
          { data: "05/05", hora: "11:30", de: "Itaú Empresarial", para: "Caixa Interno", moeda: "BRL", valor: 2000, taxa: null, obs: "Reposição caixinha", por: "MR" },
          { data: "02/05", hora: "10:00", de: "Itaú Empresarial", para: "Wise EUR", moeda: "BRL", valor: 5000, taxa: 0.18, obs: "Compra de euros · viagem Roma", por: "MR" },
          { data: "28/04", hora: "15:30", de: "Wise USD", para: "Itaú Empresarial", moeda: "USD", valor: 1500, taxa: 5.07, obs: "Conversão recebimento Brinker", por: "MR" },
        ],
        projecao45: Array.from({ length: 46 }, (_, i) => ({
          dia: i,
          saldo: totalBRL + Math.round(Math.sin(i / 6) * totalBRL * 0.025) + i * (totalBRL * 0.0006),
        })),
        cotacoes: { eurBrl: FX.EUR, usdBrl: FX.USD, atualizado: "16/05 · 14:22" },
      },
    })
  } catch (e) {
    console.error("[financas/tesouraria] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar tesouraria" }, { status: 500 })
  }
}