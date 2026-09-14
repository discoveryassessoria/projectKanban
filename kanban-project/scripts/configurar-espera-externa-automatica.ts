// scripts/configurar-espera-externa-automatica.ts
// ============================================================================
// CORREÇÃO CONCEITUAL — "Aguardar retorno do cartório" e "Receber certidão"
// SÃO espera de terceiro por definição, desde o instante em que ficam
// disponíveis. Não é uma ação que o operador declara ("Ainda aguardando o
// cartório") — é o cadastro do PASSO que diz isso
// (`PhaseInternalWorkflowStep.esperaExternaAoLiberar`), e o motor entra em
// AGUARDANDO_TERCEIRO sozinho ao liberar o passo (ver
// `aplicarEsperaExternaSeConfigurado`, src/services/task-step-sync.ts).
//
// Esta migração:
//   1. marca `esperaExternaAoLiberar = true` em "aguardar_retorno_do_cartorio"
//      e "receber_certidao";
//   2. remove a StepAction "aguardando_cartorio" (PAUSE_FOR_EXTERNAL_WAIT) que
//      uma correção anterior, hoje revertida, tinha cadastrado em
//      "receber_certidao" — o botão manual que a disparava foi removido do
//      formulário; a ação cadastrada sem botão que a chame vira cadastro morto.
//
// IDEMPOTENTE: rodar de novo não duplica nem falha.
//
// USO:
//   PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/configurar-espera-externa-automatica.ts --workflow-id=<id>
//   npx tsx scripts/configurar-espera-externa-automatica.ts --producao
// ============================================================================
import { prisma } from "@/lib/prisma"

export async function configurarEsperaExternaAutomatica(workflowId: number) {
  const steps = await prisma.phaseInternalWorkflowStep.findMany({
    where: { workflowId, key: { in: ["aguardar_retorno_do_cartorio", "receber_certidao"] } },
    select: { id: true, key: true, esperaExternaAoLiberar: true, acoes: { select: { id: true, key: true, effectKey: true } } },
  })
  const resultado: Record<string, { antes: boolean; depois: boolean; acaoManualRemovida: boolean }> = {}
  for (const s of steps) {
    const antes = s.esperaExternaAoLiberar
    if (!antes) {
      await prisma.phaseInternalWorkflowStep.update({
        where: { id: s.id },
        data: { esperaExternaAoLiberar: true },
      })
    }
    let acaoManualRemovida = false
    if (s.key === "receber_certidao") {
      const acaoManual = s.acoes.find((a) => a.key === "aguardando_cartorio" && a.effectKey === "PAUSE_FOR_EXTERNAL_WAIT")
      if (acaoManual) {
        await prisma.stepAction.delete({ where: { id: acaoManual.id } })
        acaoManualRemovida = true
      }
    }
    resultado[s.key] = { antes, depois: true, acaoManualRemovida }
  }
  return resultado
}

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--workflow-id="))
  const producao = process.argv.includes("--producao")
  if (!arg && !producao) {
    console.error("uso: --workflow-id=<id> (teste) ou --producao")
    process.exit(1)
  }
  let workflowId: number
  if (producao) {
    const wf = await prisma.phaseInternalWorkflow.findFirstOrThrow({
      where: { phaseKey: "emissao_documental", active: true, arquivado: false, tipoProcessoId: null },
      select: { id: true },
    })
    workflowId = wf.id
  } else {
    workflowId = Number(arg!.split("=")[1])
  }
  const r = await configurarEsperaExternaAutomatica(workflowId)
  console.log(JSON.stringify(r, null, 2))
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
}
