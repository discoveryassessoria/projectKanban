/**
 * READ-ONLY — conta registros "soltos" cujo processoId aponta para Processo
 * inexistente (órfãos de processo apagado). NÃO deleta nada. Rodar com env de prod.
 */
import { prisma } from "@/lib/prisma"

async function main() {
  const processos = await prisma.processo.findMany({ select: { id: true } })
  const existentes = new Set(processos.map((p) => p.id))
  console.log(`Processos existentes: ${existentes.size}`)

  const checks: Array<{ nome: string; ids: (number | null)[] }> = []

  const distinct = async (nome: string, rows: Array<{ processoId: number | null }>) =>
    checks.push({ nome, ids: rows.map((r) => r.processoId) })

  await distinct("Tarefa", await prisma.tarefa.findMany({ where: { processoId: { not: null } }, select: { processoId: true } }))
  await distinct("ContaPagar", await prisma.contaPagar.findMany({ where: { processoId: { not: null } }, select: { processoId: true } }))
  await distinct("Transacao", await prisma.transacao.findMany({ where: { processoId: { not: null } }, select: { processoId: true } }))
  await distinct("Evento", await prisma.evento.findMany({ where: { processoId: { not: null } }, select: { processoId: true } }))
  await distinct("TabelaValor", await prisma.tabelaValor.findMany({ where: { processoId: { not: null } }, select: { processoId: true } }))
  await distinct("PhaseWorkflowStepInstance", await prisma.phaseWorkflowStepInstance.findMany({ select: { processoId: true } }))
  await distinct("WorkflowEvento", await prisma.workflowEvento.findMany({ select: { processoId: true } }))
  await distinct("PhaseAdvanceLog", await prisma.phaseAdvanceLog.findMany({ select: { processoId: true } }))

  let totalOrfaos = 0
  for (const c of checks) {
    const orfaos = c.ids.filter((id): id is number => id != null && !existentes.has(id))
    const idsUnicos = Array.from(new Set(orfaos))
    totalOrfaos += orfaos.length
    console.log(
      `${c.nome}: ${c.ids.length} c/ processoId · ÓRFÃOS=${orfaos.length}` +
        (idsUnicos.length ? ` (processoIds inexistentes: ${idsUnicos.slice(0, 20).join(", ")}${idsUnicos.length > 20 ? "…" : ""})` : ""),
    )
  }
  console.log(`\nTOTAL DE ÓRFÃOS: ${totalOrfaos}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
