// scripts/adicionar-aguardando-receber-certidao.ts
// ============================================================================
// CORREÇÃO — o passo "Receber certidão" tem UMA espera de terceiro própria
// (entre o protocolo confirmado no passo 2 e a certidão física chegar), mas
// só tinha a ação "Registrar recebimento" — sem jeito de declarar "ainda
// aguardando". Reaproveita o MESMO mecanismo já usado por "Solicitar
// certidão" (efeito `PAUSE_FOR_EXTERNAL_WAIT`, já testado, já em produção):
// adiciona a ação "Ainda aguardando o cartório" ao cadastro do passo.
//
// Nenhum efeito novo, nenhum campo de schema novo — só a AÇÃO que faltava no
// cadastro do passo "receber_certidao".
//
// IDEMPOTENTE: rodar de novo não duplica.
//
// USO:
//   PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/adicionar-aguardando-receber-certidao.ts --workflow-id=<id>
//   npx tsx scripts/adicionar-aguardando-receber-certidao.ts --producao
// ============================================================================
import { prisma } from "@/lib/prisma"

export async function adicionarAguardandoEmReceberCertidao(workflowId: number) {
  const step = await prisma.phaseInternalWorkflowStep.findFirst({
    where: { workflowId, key: "receber_certidao" },
    select: { id: true, acoes: { select: { key: true, effectKey: true } } },
  })
  if (!step) {
    console.log(`[aguardando-receber] "receber_certidao" não encontrado no workflow ${workflowId} — nada a fazer.`)
    return { jaExistia: false, adicionado: false }
  }
  if (step.acoes.some((a) => a.effectKey === "PAUSE_FOR_EXTERNAL_WAIT")) {
    console.log(`[aguardando-receber] já existe ação PAUSE_FOR_EXTERNAL_WAIT em "receber_certidao" (stepId=${step.id}) — nada a fazer.`)
    return { jaExistia: true, adicionado: false }
  }
  await prisma.stepAction.create({
    data: {
      stepId: step.id,
      key: "aguardando_cartorio",
      label: "Ainda aguardando o cartório",
      effectKey: "PAUSE_FOR_EXTERNAL_WAIT",
      ordem: 2,
    },
  })
  console.log(`[aguardando-receber] ação "aguardando_cartorio" adicionada ao passo "receber_certidao" (stepId=${step.id}).`)
  return { jaExistia: false, adicionado: true, stepId: step.id }
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
  const r = await adicionarAguardandoEmReceberCertidao(workflowId)
  console.log(JSON.stringify(r))
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
}
