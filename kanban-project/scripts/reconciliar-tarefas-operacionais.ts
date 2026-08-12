// scripts/reconciliar-tarefas-operacionais.ts
// ============================================================================
// Converge as tarefas operacionais: todo workflow ativo passa a ter a SUA
// tarefa, com estado, etapa corrente, equipe e prazo.
//
//   Dry-run:  npx tsx scripts/reconciliar-tarefas-operacionais.ts [processoId]
//   Aplicar:  EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/reconciliar-tarefas-operacionais.ts [processoId] --execute
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirConfirmacaoDeEscritaEmProducao } from "./_banco-de-teste"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"

const EXECUTAR = process.argv.includes("--execute")
const alvo = process.argv.slice(2).find((a) => /^\d+$/.test(a))
const processoId = alvo ? Number(alvo) : undefined

async function main() {
  const previa = await reconciliarTarefas({ processoId, dryRun: true })
  console.log(`\nINSTÂNCIAS ATIVAS AVALIADAS: ${previa.instanciasAvaliadas}`)
  console.log(`  tarefas a criar ............ ${previa.tarefasCriadas}`)
  console.log(`  tarefas a encerrar ......... ${previa.tarefasEncerradasSemCausa}`)
  console.log(`  sem título (falta catálogo)  ${previa.semTitulo}`)
  for (const d of previa.detalhes.slice(0, 20)) console.log(`   inst ${d.instanciaId}: ${d.acao}`)

  if (!EXECUTAR) {
    console.log(`\nDRY-RUN: nada foi escrito.`)
    console.log(`Aplicar: EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/reconciliar-tarefas-operacionais.ts${processoId ? ` ${processoId}` : ""} --execute\n`)
    return
  }
  exigirConfirmacaoDeEscritaEmProducao(
    `materializa ${previa.tarefasCriadas} tarefa(s) operacional(is) e sincroniza ${previa.instanciasAvaliadas} workflow(s)`,
    "reconciliar-tarefas-operacionais",
  )
  const r = await reconciliarTarefas({ processoId })
  console.log(`\n✅ criadas ${r.tarefasCriadas} · sincronizadas ${r.tarefasSincronizadas} · encerradas ${r.tarefasEncerradasSemCausa}`)
  for (const d of r.detalhes.slice(0, 20)) console.log(`   inst ${d.instanciaId} → tarefa ${d.tarefaId}: ${d.acao}`)
}
main().catch((e) => { console.error("falhou:", e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
