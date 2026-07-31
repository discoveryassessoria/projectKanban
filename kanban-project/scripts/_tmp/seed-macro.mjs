import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const TIPO = 7 // Cidadania Italiana — Administrativa (italia)

await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })

const macro = await prisma.macroWorkflow.upsert({
  where: { tipoProcessoId: TIPO },
  update: { ativo: true },
  create: { tipoProcessoId: TIPO, name: 'Macro Itália (teste)', ativo: true },
})
const fases = [
  ['genealogia', 'Genealogia', 1],
  ['emissao_documental', 'Emissão documental', 2],
]
for (const [phaseKey, label, ordem] of fases) {
  await prisma.faseMacro.upsert({
    where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey } },
    update: { ordem, label },
    create: { macroWorkflowId: macro.id, phaseKey, label, ordem },
  })
}
// Workflow interno da genealogia (global)
const wf = await prisma.phaseInternalWorkflow.upsert({
  where: { wfUid: `all::genealogia` },
  update: { active: true, arquivado: false },
  create: { wfUid: `all::genealogia`, phaseKey: 'genealogia', name: 'Genealogia (teste)', active: true },
})
await prisma.phaseInternalWorkflowStep.upsert({
  where: { workflowId_key: { workflowId: wf.id, key: 'localizar_registro' } },
  update: { ordem: 1, required: true },
  create: { workflowId: wf.id, key: 'localizar_registro', label: 'Localizar registro da certidão', ordem: 1, required: true, createsTask: true },
})
console.log('seed ok: macro', macro.id, 'wf', wf.id)
await prisma.$disconnect()
