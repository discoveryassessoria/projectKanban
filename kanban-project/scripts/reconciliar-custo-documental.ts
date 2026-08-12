// scripts/reconciliar-custo-documental.ts
//
// Reconciliação da cadeia documental-financeira. Sem argumento, só RELATA:
//
//   npx tsx scripts/reconciliar-custo-documental.ts              # relatório
//   npx tsx scripts/reconciliar-custo-documental.ts --processo 514
//   npx tsx scripts/reconciliar-custo-documental.ts --execute    # repara o determinístico
//
// O modo relatório não escreve nada. O `--execute` cria APENAS os lançamentos
// que faltam, com a mesma chave idempotente do evento — nunca sobrescreve valor,
// nunca apaga custo pago, nunca resolve caso ambíguo.

import { prisma } from "@/lib/prisma"
import { reconciliarDocumentalFinanceiro } from "@/src/services/financeiro/reconciliacao-documental-financeira"

const args = process.argv.slice(2)
const executar = args.includes("--execute")
const iProc = args.indexOf("--processo")
const processoId = iProc >= 0 && args[iProc + 1] ? Number(args[iProc + 1]) : null

async function main() {
  console.log(`\n== Reconciliação documental-financeira ${executar ? "(EXECUTANDO)" : "(somente relatório)"} ==`)
  if (processoId) console.log(`   escopo: processo ${processoId}`)

  const r = await reconciliarDocumentalFinanceiro({ processoId, executar })

  console.log(`\nprocessos analisados ......... ${r.processos}`)
  console.log(`documentos localizados ....... ${r.documentosLocalizados}`)
  console.log(`lançamentos criados .......... ${r.reparados}`)
  console.log(`achados ...................... ${r.achados.length} (${r.ambiguos} exigem decisão)`)

  if (r.achados.length) {
    const porTipo = new Map<string, number>()
    for (const a of r.achados) porTipo.set(a.tipo, (porTipo.get(a.tipo) ?? 0) + 1)
    console.log("\npor tipo:")
    for (const [t, n] of [...porTipo].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${t}`)

    console.log("\ndetalhe:")
    for (const a of r.achados) {
      const alvo = [
        a.processoId ? `proc ${a.processoId}` : null,
        a.documentoId ? `doc ${a.documentoId}` : null,
        a.tipoServicoId ? `serv ${a.tipoServicoId}` : null,
        a.obrigacaoId ? `obr ${a.obrigacaoId}` : null,
        a.stepInstanceId ? `passo ${a.stepInstanceId}` : null,
      ].filter(Boolean).join(" · ")
      console.log(`  [${a.tipo}] ${alvo} — ${a.detalhe}`)
    }
  }

  if (!executar && r.achados.some((a) => a.reparavel)) {
    console.log("\nHá casos determinísticos reparáveis. Rode de novo com --execute para criar o que falta.")
  }
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
