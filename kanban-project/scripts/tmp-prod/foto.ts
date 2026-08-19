// SOMENTE LEITURA — fotografia lógica antes/depois.
import { prisma } from '../../lib/prisma'
import { calcularPendencias } from '../../src/lib/motor/blocking-engine'
async function main() {
  const pid = 523
  const p = await prisma.processo.findUnique({ where: { id: pid }, select: { faseAtualKey: true, lockVersion: true } })
  const c = {
    fase: p?.faseAtualKey, lockVersion: p?.lockVersion,
    instancias: await prisma.phaseWorkflowInstance.count({ where: { processoId: pid } }),
    passos: await prisma.phaseWorkflowStepInstance.count({ where: { processoId: pid } }),
    tarefas: await prisma.tarefa.count({ where: { processoId: pid } }),
    necessidades: await prisma.necessidadeDocumental.count({ where: { processoId: pid } }),
    documentos: await prisma.documento.count({ where: { necessidade: { processoId: pid } } }),
    eventos: await prisma.workflowEvento.count({ where: { processoId: pid } }),
    logsAvanco: await prisma.phaseAdvanceLog.count({ where: { processoId: pid } }),
  }
  const g = await calcularPendencias(pid, p!.faseAtualKey!, { correlationId: 'foto' })
  console.log(JSON.stringify({ ...c, canAdvance: g.canAdvance, blocking: g.blocking.map(b => b.code) }))
  const ss = await prisma.phaseWorkflowStepInstance.findMany({ where: { processoId: pid }, orderBy: { id: 'asc' }, select: { id: true, faseMacroKey: true, ciclo: true, stepKey: true, status: true } })
  for (const s of ss) console.log(`  passo#${s.id} ${s.faseMacroKey}/c${s.ciclo} ${s.stepKey} ${s.status}`)
  const ts = await prisma.tarefa.findMany({ where: { processoId: pid }, orderBy: { id: 'asc' }, select: { id: true, statusTarefa: true, faseMacroKey: true, responsavelId: true, dataPrazo: true } })
  for (const t of ts) console.log(`  tarefa#${t.id} ${t.faseMacroKey} ${t.statusTarefa} resp=${t.responsavelId} prazo=${t.dataPrazo?.toISOString().slice(0,10)}`)
}
main().then(() => process.exit(0)).catch(e => { console.error(String(e).slice(0,300)); process.exit(1) })
