// scripts/diagnostico-legado-tarefas.ts
// ============================================================================
// DRY-RUN DO LEGADO — classifica o estado operacional antes de convergir.
// Read-only. Não escreve nada, em lugar nenhum.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"

async function main() {
  const tarefas = await prisma.tarefa.count()
  console.log(`\nTAREFAS ................................ ${tarefas}`)
  console.log(`  com workflow ......................... ${await prisma.tarefa.count({ where: { workflowInstanceId: { not: null } } })}`)
  console.log(`  SEM workflow (manuais/administrativas) ${await prisma.tarefa.count({ where: { workflowInstanceId: null } })}`)
  console.log(`  sem processo (órfãs) ................. ${await prisma.tarefa.count({ where: { processoId: null } })}`)
  console.log(`  sem provenance (nem nec nem doc) ..... ${await prisma.tarefa.count({ where: { necessidadeId: null, documentoId: null, origem: { not: "MANUAL" } } })}`)
  console.log(`  ativas sem responsável E sem equipe .. ${await prisma.tarefa.count({ where: { responsavelId: null, equipeKey: null, statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"] } } })}`)
  console.log(`  com SLA mas sem prazo ................ ${await prisma.tarefa.count({ where: { dataPrazo: null, statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"] } } })}`)
  console.log(`  aguardando decisão (causa removida) .. ${await prisma.tarefa.count({ where: { causaRemovidaEm: { not: null } } })}`)

  const dupes = await prisma.tarefa.groupBy({ by: ["workflowInstanceId"], _count: { _all: true }, where: { workflowInstanceId: { not: null } } })
  console.log(`  instâncias com MAIS de uma tarefa .... ${dupes.filter((d) => d._count._all > 1).length}`)

  console.log(`\nWORKFLOWS`)
  console.log(`  instâncias ATIVAS .................... ${await prisma.phaseWorkflowInstance.count({ where: { status: "ATIVO" } })}`)
  console.log(`  ATIVAS sem tarefa (operação invisível) ${await prisma.phaseWorkflowInstance.count({ where: { status: "ATIVO", tarefa: null } })}`)
  console.log(`  etapas ............................... ${await prisma.phaseWorkflowStepInstance.count()}`)
  const semInst = await prisma.phaseWorkflowStepInstance.count({ where: { workflowInstance: { status: { in: ["CANCELADO", "SUPERSEDIDO"] } } } })
  console.log(`  etapas de workflow encerrado ......... ${semInst}`)

  console.log(`\nO QUE O RECONCILIADOR FARIA (dry-run)`)
  const r = await reconciliarTarefas({ dryRun: true })
  console.log(`  instâncias avaliadas ................. ${r.instanciasAvaliadas}`)
  console.log(`  tarefas a criar ...................... ${r.tarefasCriadas}`)
  console.log(`  a encerrar (nunca iniciadas) ......... ${r.tarefasEncerradasSemCausa}`)
  console.log(`  a marcar p/ decisão (já iniciadas) ... ${r.tarefasAguardandoDecisao}`)
  console.log(`  sem título (falta catálogo) .......... ${r.semTitulo}`)
  for (const d of r.detalhes.slice(0, 15)) console.log(`   inst ${d.instanciaId}: ${d.acao}`)
  console.log(`\nNADA FOI ESCRITO.\n`)
}
main().finally(() => prisma.$disconnect())
