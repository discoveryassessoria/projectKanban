// scripts/tarefa-nasce-com-prazo-do-sla.test.ts
// Investigação 30/09/2026 (tarefas do 651 sem prazo apesar de slaDays=10): prova que o código de criação
// (`garantirTarefaDePasso`) GRAVA `dataPrazo = criação + slaDays` quando nenhuma subtarefa define o prazo — logo o
// `dataPrazo` nulo das tarefas "a iniciar" do 651 não vem da criação (foi zerado depois, por desenho: o prazo
// passa a nascer do envio, via `previsaoRetorno`).
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("tarefa-nasce-com-prazo-do-sla.test.ts")
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
async function main() {
  const c = await montarCenario("TPRAZO", { slaDays: 10 })
  try {
    const o = await c.novaObrigacao({})
    const t = await prisma.tarefa.findFirstOrThrow({ where: { processoId: o.processoId }, select: { dataPrazo: true, createdAt: true, workflowStepInstanceId: true } })
    const st = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: t.workflowStepInstanceId! }, select: { slaDays: true } })
    console.log("slaDays do passo:", st.slaDays, "| dataPrazo da tarefa:", t.dataPrazo, "| createdAt:", t.createdAt)
    if (t.dataPrazo == null) throw new Error("tarefa nasceu SEM prazo com slaDays=" + st.slaDays)
    const dias = Math.round((t.dataPrazo.getTime() - t.createdAt.getTime()) / 86_400_000)
    if (dias !== 10) throw new Error("prazo esperado = criação + 10 dias, veio " + dias)
    console.log("✅ PASSOU: tarefa nasce com prazo = criação + slaDays")
  } finally { await c.limpar() }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
