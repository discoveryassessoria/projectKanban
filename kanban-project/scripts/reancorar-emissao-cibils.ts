// scripts/reancorar-emissao-cibils.ts
// ============================================================================
// REANCORAGEM — materializa as SubtaskExecution que faltam nas 5 Step
// instances da Emissão Documental do processo 651 (Cibils): 2787, 2788,
// 2789, 2790, 2791.
//
// ACHADO (25/09/2026): essas 5 instâncias registram `workflowVersion: 18` —
// um snapshot correto, com as 4 subtarefas configuradas (confirmado por
// leitura). Mas `SubtaskExecution` está vazio pra todas as 5: ninguém
// chamou `materializarSubtarefas` depois que elas foram criadas. A
// DEFINIÇÃO está certa; a EXECUÇÃO nunca foi persistida.
//
// `materializarSubtarefas` (src/services/subtarefas-da-etapa.ts) é
// IDEMPOTENTE — já existente vira "jaExistiam", nunca duplica — então rodar
// este script mais de uma vez é seguro.
//
// Modo --dry por padrão (só loga o que faria). --aplicar escreve de verdade
// e exige --prod + EU_CONFIRMO_ESCRITA_EM_PRODUCAO quando o banco alvo é
// produção (mesmo padrão de scripts/corrigir-tarefas-sem-pessoa.ts).
//
// Uso:
//   npx tsx scripts/reancorar-emissao-cibils.ts                    (dry-run)
//   npx tsx scripts/reancorar-emissao-cibils.ts --aplicar --prod \
//     (com EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO')
// ============================================================================
import { prisma } from "@/lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import { materializarSubtarefas } from "@/src/services/subtarefas-da-etapa"
import { aplicarEsperaExternaDaSubtarefaSeConfigurado } from "@/src/services/subtarefas-da-etapa"

const STEP_INSTANCE_IDS = [2787, 2788, 2789, 2790, 2791]

const APLICAR = process.argv.includes("--aplicar")
const PROD = process.argv.includes("--prod")

async function main() {
  const url = process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL ?? ""
  const id = identificador(url)
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`Banco: ${id} — classificado como ${classe}`)

  if (APLICAR && PROD) {
    if (classe !== CLASSE.PRODUCAO) {
      console.error("--prod pedido mas o banco não classifica como PRODUÇÃO. Abortando.")
      process.exit(1)
    }
    if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO") {
      console.error("Falta EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'. Abortando.")
      process.exit(1)
    }
  }

  for (const stepInstanceId of STEP_INSTANCE_IDS) {
    const antes = await prisma.subtaskExecution.count({ where: { stepInstanceId } })
    console.log(`\nStep instance ${stepInstanceId} — SubtaskExecution antes: ${antes}`)

    if (!APLICAR) {
      console.log(`  [dry-run] chamaria materializarSubtarefas({ stepInstanceId: ${stepInstanceId} })`)
      continue
    }

    const res = await materializarSubtarefas({ stepInstanceId })
    console.log(`  [APLICADO] criadas=${res.criadas} jaExistiam=${res.jaExistiam}`)

    // Se a subtarefa CORRENTE nasceu como espera externa (ex.: já teria
    // avançado além do passo 1), aplica o bloqueio automático da Tarefa —
    // mesmo efeito que já dispara reativamente quando alguém conclui a
    // subtarefa anterior. Idempotente (aplicado:false quando não se aplica).
    const espera = await aplicarEsperaExternaDaSubtarefaSeConfigurado({ stepInstanceId })
    if (espera.aplicado) console.log(`  espera externa automática aplicada`)

    const depois = await prisma.subtaskExecution.count({ where: { stepInstanceId } })
    console.log(`  SubtaskExecution depois: ${depois}`)
  }

  if (!APLICAR) console.log("\nRode com --aplicar (e --prod, se for o caso) para escrever de verdade.")
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
