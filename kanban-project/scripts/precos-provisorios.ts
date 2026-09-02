// scripts/precos-provisorios.ts
//
// PREÇO PROVISÓRIO — para o sistema andar enquanto o preço real não chega.
//
// ⚠ ESTES VALORES SÃO FICTÍCIOS. Foram pedidos explicitamente para destravar o
// teste ("cadastre tudo com preço fictício que depois eu altero"). Enquanto
// estiverem no ar, qualquer cobrança gerada sai com valor errado.
//
// Por isso três salvaguardas:
//   1. O valor é 1,00 — obviamente falso. Um valor realista passaria batido
//      numa fatura; 1,00 grita.
//   2. O nome começa com o marcador abaixo, então dá para listar todos.
//   3. `npx tsx scripts/precos-provisorios.ts --listar` mostra o que ainda é
//      provisório, a qualquer momento.
//
// Também cria a Configuração Financeira dos itens que não têm nenhuma — sem
// ela o item não é cobrável, e o preço não teria onde se prender.
//
//   Ver:      npx tsx scripts/precos-provisorios.ts
//   Listar:   npx tsx scripts/precos-provisorios.ts --listar
//   Aplicar:  EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/precos-provisorios.ts --aplicar

import { prisma } from "@/lib/prisma"

/** O que marca um preço como provisório. Não mudar: é a chave da listagem. */
export const MARCADOR = "[PROVISÓRIO]"
const VALOR = 1

const APLICAR = process.argv.includes("--aplicar")
const LISTAR = process.argv.includes("--listar")

async function r<T>(f: () => Promise<T>, n = 20): Promise<T> {
  for (let i = 0; i < n; i++) {
    try { return await f() } catch (e) {
      if (i === n - 1) throw e
      await new Promise((x) => setTimeout(x, Math.min(15000, 1500 * (i + 1))))
    }
  }
  throw new Error("sem conexão")
}

/** A unidade do item decide como o preço é calculado — não é escolha minha. */
function modoDe(unidade: string | null | undefined): { modo: string; unidade: string } {
  switch (unidade) {
    case "REQUERENTE": return { modo: "per_applicant", unidade: "requerente" }
    case "DOCUMENTO": return { modo: "per_unit", unidade: "documento" }
    case "PESSOA": return { modo: "per_applicant", unidade: "pessoa" }
    default: return { modo: "fixed", unidade: "unidade" }
  }
}

async function listar() {
  const precos = await r(() => prisma.tabelaValor.findMany({
    where: { name: { startsWith: MARCADOR }, arquivado: false },
    select: { id: true, name: true, natureza: true, moeda: true, valor: true,
      configuracaoFinanceiraItem: { select: { id: true, nome: true } } },
    orderBy: { id: "asc" },
  }))
  const configs = await r(() => prisma.produtoFinanceiro.findMany({
    where: { nome: { startsWith: MARCADOR } },
    select: { id: true, nome: true },
  }))
  console.log(`PREÇOS PROVISÓRIOS NO AR: ${precos.length}\n`)
  for (const p of precos) {
    console.log(`  preço #${String(p.id).padStart(3)} · ${p.natureza} · ${p.moeda} ${Number(p.valor).toFixed(2)} · ${p.configuracaoFinanceiraItem?.nome ?? "—"}`)
  }
  if (configs.length) {
    console.log(`\nCONFIGURAÇÕES CRIADAS COMO PROVISÓRIAS: ${configs.length}`)
    for (const c of configs) console.log(`  config #${c.id} · ${c.nome}`)
  }
  console.log(precos.length
    ? `\n⚠ Enquanto existirem, a cobrança sai com valor errado. Troque em Gerenciamento → Tabela de Preços.`
    : `\n✅ Nenhum preço provisório — todos os preços são reais.`)
}

async function main() {
  if (LISTAR) return listar()

  // ── 1) Itens sem configuração financeira ──────────────────────────────────
  const semConfig = await r(() => prisma.itemCatalogo.findMany({
    where: { ativo: true, produtos: { none: {} } },
    select: { id: true, name: true, natureza: true, unidade: true },
  }))

  // ── 2) Configurações sem preço, pela MESMA regra da verificação FIN-001 ────
  const configs = await r(() => prisma.produtoFinanceiro.findMany({
    where: { ativo: true },
    select: {
      id: true, nome: true, naturezaFin: true, possuiCusto: true, possuiReceita: true,
      moedaPadrao: true, itemCatalogoId: true, itemCatalogo: { select: { unidade: true } },
      precosConfig: { where: { arquivado: false, legadoPendente: false }, select: { natureza: true } },
    },
  }))
  const faltando: { c: (typeof configs)[number]; venda: boolean; custo: boolean }[] = []
  for (const c of configs) {
    const nat = new Set(c.precosConfig.map((p) => String(p.natureza)))
    const geraReceita = c.naturezaFin ? c.naturezaFin !== "SOMENTE_CUSTO" : c.possuiReceita
    const geraCusto = c.naturezaFin ? c.naturezaFin !== "SOMENTE_RECEITA" : c.possuiCusto
    const venda = geraReceita && !nat.has("VENDA") && !nat.has("RECEITA")
    const custo = geraCusto && !nat.has("CUSTO")
    if (venda || custo) faltando.push({ c, venda, custo })
  }

  console.log("PREÇO PROVISÓRIO — o que seria criado\n")
  console.log(`  ${semConfig.length} configuração(ões) financeira(s) para itens que não têm nenhuma:`)
  for (const i of semConfig) console.log(`     ${i.name} (${i.natureza}, ${i.unidade})`)
  console.log(`\n  ${faltando.reduce((s, f) => s + (f.venda ? 1 : 0) + (f.custo ? 1 : 0), 0)} preço(s) em configurações que já existem:`)
  for (const f of faltando) {
    console.log(`     ${f.c.nome} → ${[f.venda ? "VENDA" : null, f.custo ? "CUSTO" : null].filter(Boolean).join(" + ")} · ${f.c.moedaPadrao} ${VALOR.toFixed(2)}`)
  }
  console.log(`\n  Todos com valor ${VALOR.toFixed(2)} e nome começando em "${MARCADOR}".`)

  if (!APLICAR) { console.log("\nDRY-RUN: nada foi escrito."); return }
  if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "1") {
    console.error("\n❌ Escrita não confirmada. Defina EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1.")
    process.exit(1)
  }

  let novasConfigs = 0
  for (const i of semConfig) {
    const { modo, unidade } = modoDe(i.unidade)
    const custeavel = i.natureza === "DOCUMENTO" || i.natureza === "SERVICO" || i.natureza === "TAXA"
    const cfg = await r(() => prisma.produtoFinanceiro.create({
      data: {
        codigo: `PROV-${i.id}`,
        nome: `${MARCADOR} ${i.name}`,
        itemCatalogoId: i.id,
        moedaPadrao: "BRL",
        naturezaFin: custeavel ? "CUSTO_E_RECEITA" : "SOMENTE_RECEITA",
        possuiReceita: true,
        possuiCusto: custeavel,
        cobravelDoCliente: true,
        ativo: true,
      },
      select: { id: true, nome: true },
    }))
    novasConfigs++
    for (const natureza of custeavel ? (["VENDA", "CUSTO"] as const) : (["VENDA"] as const)) {
      await r(() => prisma.tabelaValor.create({
        data: {
          name: `${MARCADOR} ${i.name} — ${natureza.toLowerCase()}`,
          itemCatalogoId: i.id, configuracaoFinanceiraItemId: cfg.id,
          natureza, moeda: "BRL", valor: VALOR, modoCalculo: modo, unidade,
        },
      }))
    }
  }

  let novosPrecos = 0
  for (const f of faltando) {
    const { modo, unidade } = modoDe(f.c.itemCatalogo?.unidade)
    for (const natureza of [f.venda ? "VENDA" : null, f.custo ? "CUSTO" : null].filter(Boolean) as ("VENDA" | "CUSTO")[]) {
      await r(() => prisma.tabelaValor.create({
        data: {
          name: `${MARCADOR} ${f.c.nome} — ${natureza.toLowerCase()}`,
          itemCatalogoId: f.c.itemCatalogoId, configuracaoFinanceiraItemId: f.c.id,
          natureza, moeda: f.c.moedaPadrao, valor: VALOR, modoCalculo: modo, unidade,
        },
      }))
      novosPrecos++
    }
  }

  console.log(`\n✅ ${novasConfigs} configuração(ões) e ${novosPrecos} preço(s) provisório(s) criados.`)
  console.log(`\n⚠ SÃO VALORES FICTÍCIOS (${VALOR.toFixed(2)}). Para ver quais são, a qualquer momento:`)
  console.log(`     npx tsx scripts/precos-provisorios.ts --listar`)
}

main().finally(() => prisma.$disconnect())
