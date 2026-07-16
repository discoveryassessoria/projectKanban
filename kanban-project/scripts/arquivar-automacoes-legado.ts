/**
 * Neutralização de dados (SEM DELETE) das automações antigas que criam trabalho
 * OBRIGATÓRIO da fase. Arquiva (arquivado=true / active=false) — nunca exclui.
 *
 *   --dry-run  (padrão): só conta, não altera
 *   --execute : aplica o arquivamento
 *
 * Alvos:
 *  - PhaseAutomationRule.kind ∈ {task, document}  → arquivado=true, active=false
 *  - ModeloAutomacao.type     ∈ {task, document}  → arquivado=true
 *  - RegraTarefaTransversal (todas não arquivadas) → arquivado=true
 *  - ModeloTarefaTransversal (todas não arquivadas)→ arquivado=true
 * Preservados: financial, event, protocol, alert e demais efeitos adicionais.
 */
import { prisma } from "@/lib/prisma"

const EXECUTE = process.argv.includes("--execute")
const KINDS = ["task", "document"]

async function main() {
  console.log(EXECUTE ? "MODO: EXECUTE (arquivando)" : "MODO: DRY-RUN (só conta)")

  const parCount = await prisma.phaseAutomationRule.count({ where: { kind: { in: KINDS }, arquivado: false } })
  const modCount = await prisma.modeloAutomacao.count({ where: { type: { in: KINDS }, arquivado: false } })
  const regraCount = await prisma.regraTarefaTransversal.count({ where: { arquivado: false } })
  const modTransCount = await prisma.modeloTarefaTransversal.count({ where: { arquivado: false } })

  console.log(`PhaseAutomationRule (task/document, ativas):   ${parCount}`)
  console.log(`ModeloAutomacao     (task/document, ativos):   ${modCount}`)
  console.log(`RegraTarefaTransversal (não arquivadas):        ${regraCount}`)
  console.log(`ModeloTarefaTransversal (não arquivados):       ${modTransCount}`)
  const total = parCount + modCount + regraCount + modTransCount
  console.log(`TOTAL a arquivar: ${total}`)

  if (!EXECUTE) { console.log("\n(dry-run — nada alterado. Rode com --execute para arquivar.)"); return }
  if (total === 0) { console.log("\nNada a arquivar."); return }

  const a = await prisma.phaseAutomationRule.updateMany({ where: { kind: { in: KINDS }, arquivado: false }, data: { arquivado: true, active: false } })
  const b = await prisma.modeloAutomacao.updateMany({ where: { type: { in: KINDS }, arquivado: false }, data: { arquivado: true } })
  const c = await prisma.regraTarefaTransversal.updateMany({ where: { arquivado: false }, data: { arquivado: true } })
  const d = await prisma.modeloTarefaTransversal.updateMany({ where: { arquivado: false }, data: { arquivado: true } })
  console.log(`\nARQUIVADOS (sem delete): PhaseAutomationRule=${a.count}, ModeloAutomacao=${b.count}, RegraTarefaTransversal=${c.count}, ModeloTarefaTransversal=${d.count}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
