// scripts/pendencias-parametrizacao.ts — o que falta para o cadastro gerar dinheiro.
// Leitura pura. `npx tsx scripts/pendencias-parametrizacao.ts`
import { prisma } from "@/lib/prisma"
import { pendenciasDaParametrizacao } from "@/src/services/financeiro/pendencias-parametrizacao"

async function main() {
  const r = await pendenciasDaParametrizacao()
  console.log(`\n== Pendências de parametrização ==\n`)
  console.log(`componentes econômicos ....... ${r.componentes}`)
  console.log(`prontos para gerar ........... ${r.componentesProntos}`)
  console.log(`pendências ................... ${r.pendencias.length} (${r.bloqueantes} bloqueiam)\n`)
  for (const p of r.pendencias) {
    console.log(`  ${p.bloqueia ? "⛔" : "⚠ "} ${p.mensagem}`)
    console.log(`        ↳ ${p.onde}${p.phaseKey ? `  ·  fase "${p.phaseKey}"` : ""}`)
  }
  if (!r.pendencias.length) console.log("  nenhuma — o cadastro está completo.")
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
