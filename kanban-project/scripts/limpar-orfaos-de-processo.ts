// scripts/limpar-orfaos-de-processo.ts
//
// LINHAS QUE APONTAM PARA UM PROCESSO QUE NÃO EXISTE MAIS.
//
// Doze tabelas guardam `processoId` SEM constraint de chave estrangeira. Sem a
// constraint o banco não tem como cascatear, e apagar um processo deixou para
// trás a trilha inteira dele. Hoje: 174 eventos de workflow, 127 registros de
// avanço de fase e 11 obrigações econômicas apontando para processos deletados.
//
// A conta fica visível no relatório: o domínio Financeiro mostrava "11
// obrigações" e as onze eram de processos que não existem.
//
// Este script limpa o que já vazou. A porta é fechada pela migration seguinte,
// que cria as FKs — a partir dela o banco não deixa mais acontecer.
//
//   Ver:      npx tsx scripts/limpar-orfaos-de-processo.ts
//   Aplicar:  EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/limpar-orfaos-de-processo.ts --aplicar

import { prisma } from "@/lib/prisma"

const APLICAR = process.argv.includes("--aplicar")

/** Tabelas com `processoId` e sem FK. Ordem: filhas antes das mães. */
const TABELAS = [
  "WorkflowEvento", "PhaseAdvanceLog", "PhaseWorkflowStepInstance",
  "OperacaoAntecipada", "ParteExterna", "SolicitacaoDocumento",
  "Cobranca", "ContaPagar", "CreditoMovimento", "Transacao",
  "TabelaValor", "ObrigacaoEconomica",
]

async function r<T>(f: () => Promise<T>, n = 20): Promise<T> {
  for (let i = 0; i < n; i++) {
    try { return await f() } catch (e) {
      if (i === n - 1) throw e
      await new Promise((x) => setTimeout(x, Math.min(15000, 1500 * (i + 1))))
    }
  }
  throw new Error("sem conexão")
}

const orfaosDe = (t: string) =>
  r(() => prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*)::int n FROM "${t}" x WHERE x."processoId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "Processo" p WHERE p.id = x."processoId")`)).then((x) => x[0].n as number)

async function main() {
  console.log("ÓRFÃOS DE PROCESSO — linhas apontando para processo inexistente\n")
  const plano: { tabela: string; n: number }[] = []
  for (const t of TABELAS) {
    const n = await orfaosDe(t)
    if (n > 0) plano.push({ tabela: t, n })
    console.log(`  ${n > 0 ? "⚠" : "✅"} ${t.padEnd(28)} ${n}`)
  }
  const total = plano.reduce((s, p) => s + p.n, 0)
  if (total === 0) { console.log("\n✅ Nada a limpar."); return }

  // O financeiro é mostrado LINHA A LINHA antes de sumir: apagar registro de
  // dinheiro sem olhar é o tipo de coisa que não tem volta.
  const fin = await r(() => prisma.$queryRawUnsafe<any[]>(`
    SELECT o.id, o."codigoOperacional", o.natureza, o.direcao, o."valorContratado",
           o."moedaContratual", o.status, o."processoId"
      FROM "ObrigacaoEconomica" o
     WHERE o."processoId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "Processo" p WHERE p.id = o."processoId")
     ORDER BY o.id`))
  if (fin.length) {
    console.log(`\n  AS ${fin.length} OBRIGAÇÕES ECONÔMICAS ÓRFÃS, uma a uma:`)
    for (const o of fin) {
      console.log(`     #${o.id} ${o.codigoOperacional ?? "—"} · ${o.direcao} ${o.natureza} · ` +
        `${o.moedaContratual} ${Number(o.valorContratado).toFixed(2)} · ${o.status} · processo ${o.processoId} (inexistente)`)
    }
  }

  console.log(`\n  TOTAL: ${total} linha(s) em ${plano.length} tabela(s)`)
  if (!APLICAR) { console.log("\nDRY-RUN: nada foi escrito."); return }
  if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "1") {
    console.error("\n❌ Escrita não confirmada. Defina EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1.")
    process.exit(1)
  }

  for (const p of plano) {
    const apagados = await r(() => prisma.$executeRawUnsafe(
      `DELETE FROM "${p.tabela}" x WHERE x."processoId" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "Processo" pr WHERE pr.id = x."processoId")`))
    console.log(`  ✅ ${p.tabela}: ${apagados} linha(s) removida(s)`)
  }

  console.log("\n  Conferência final:")
  let restam = 0
  for (const t of TABELAS) { const n = await orfaosDe(t); restam += n }
  console.log(`  órfãos restantes: ${restam}`)
}

main().finally(() => prisma.$disconnect())
