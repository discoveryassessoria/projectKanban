// scripts/realinhar-emissao-4-passos.ts
// ============================================================================
// REALINHAMENTO — Emissão Documental, régua de 4 passos (Etapa 2).
//
// ACHADO (26/09/2026, hotfix "régua antiga" da família Cibils): todo
// PhaseWorkflowStepInstance de EMISSAO_DOCUMENTAL sem NENHUMA
// SubtaskExecution foi criado ANTES da Etapa 2 materializar subtarefas na
// criação do Step. O CATÁLOGO já está certo (confirmado: workflowVersion 18,
// 1 Step (`solicitar_certidao`) com as 4 subtarefas congeladas no snapshot —
// não há "catálogo antigo" pra recriar). O que falta é só:
//
//   1. materializar as 4 SubtaskExecution que nunca foram criadas
//      (`materializarSubtarefas`, idempotente — já existente vira
//      "jaExistiam", nunca duplica);
//   2. zerar `Tarefa.dataPrazo`, que ficou com o valor do regime ANTIGO
//      (calculado uma vez, incondicionalmente, na criação da Tarefa) — na
//      régua nova o prazo só nasce quando a subtarefa 3 (receber_certidao,
//      `definePrazoDaTarefa=true`) vira corrente
//      (`aplicarPrazoDaTarefaSeConfigurado`). Esse zeramento tem que
//      acontecer ANTES de materializar: a função tem guarda de idempotência
//      (`dataPrazo != null` → no-op) que nunca vai limpar um prazo antigo
//      sozinha.
//
// O acompanhamento "a iniciar" (`diasParaIniciar`, hoje 2 dias corridos da
// atribuição) já é aplicado automaticamente por `materializarSubtarefas`
// pra a subtarefa de entrada — nenhum passo extra aqui.
//
// Alvo: TODO PhaseWorkflowStepInstance de faseMacroKey='emissao_documental'
// com zero SubtaskExecution (== "sem envio registrado"). Documentos já
// enviados/recebidos (>=1 SubtaskExecution) NÃO são tocados.
//
// Modo --dry por padrão (só loga o que faria). --aplicar escreve de verdade
// e exige --prod + EU_CONFIRMO_ESCRITA_EM_PRODUCAO quando o banco alvo é
// produção — mesmo padrão de scripts/reancorar-emissao-cibils.ts.
//
// Uso:
//   npx tsx scripts/realinhar-emissao-4-passos.ts                    (dry-run)
//   EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO' \
//     npx tsx scripts/realinhar-emissao-4-passos.ts --aplicar --prod
// ============================================================================
import { prisma } from "@/lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import { materializarSubtarefas, aplicarEsperaExternaDaSubtarefaSeConfigurado } from "@/src/services/subtarefas-da-etapa"

const APLICAR = process.argv.includes("--aplicar")
const PROD = process.argv.includes("--prod")

async function main() {
  const url = process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL ?? ""
  const id = identificador(url)
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`Banco: ${id} — classificado como ${classe}`)

  if (APLICAR) {
    if (classe === CLASSE.PRODUCAO && !PROD) {
      console.error("Banco classifica como PRODUÇÃO mas --prod não foi passado. Abortando.")
      process.exit(1)
    }
    if (PROD) {
      if (classe !== CLASSE.PRODUCAO) {
        console.error("--prod pedido mas o banco não classifica como PRODUÇÃO. Abortando.")
        process.exit(1)
      }
      if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO") {
        console.error("Falta EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'. Abortando.")
        process.exit(1)
      }
    }
  }

  const candidatos = await prisma.phaseWorkflowStepInstance.findMany({
    where: { faseMacroKey: "emissao_documental" },
    select: {
      id: true,
      processoId: true,
      stepKey: true,
      processo: { select: { nome: true } },
    },
    orderBy: { id: "asc" },
  })

  const alvos: { stepInstanceId: number; processoId: number; processoNome: string; tarefaId: number | null; dataPrazoAntes: Date | null }[] = []
  for (const c of candidatos) {
    const execCount = await prisma.subtaskExecution.count({ where: { stepInstanceId: c.id } })
    if (execCount > 0) continue
    const tarefa = await prisma.tarefa.findFirst({ where: { workflowStepInstanceId: c.id }, select: { id: true, dataPrazo: true } })
    alvos.push({ stepInstanceId: c.id, processoId: c.processoId, processoNome: c.processo?.nome ?? "?", tarefaId: tarefa?.id ?? null, dataPrazoAntes: tarefa?.dataPrazo ?? null })
  }

  console.log(`\n${candidatos.length} step instances de EMISSAO_DOCUMENTAL no total.`)
  console.log(`${alvos.length} sem nenhuma SubtaskExecution (alvo do realinhamento):\n`)
  for (const a of alvos) {
    console.log(`  stepInstance ${a.stepInstanceId} · processo ${a.processoId} (${a.processoNome}) · tarefa ${a.tarefaId} · dataPrazo antes: ${a.dataPrazoAntes?.toISOString() ?? "null"}`)
  }

  if (!APLICAR) {
    console.log(`\n[dry-run] ${alvos.length} documento(s) mudariam: zerar dataPrazo (${alvos.filter((a) => a.dataPrazoAntes != null).length} têm valor antigo pra zerar) + materializar subtarefas.`)
    console.log("Rode com --aplicar (e --prod, se for o caso) para escrever de verdade.")
    await prisma.$disconnect()
    return
  }

  for (const a of alvos) {
    console.log(`\nstepInstance ${a.stepInstanceId} (processo ${a.processoId}):`)

    if (a.tarefaId != null && a.dataPrazoAntes != null) {
      await prisma.tarefa.update({ where: { id: a.tarefaId }, data: { dataPrazo: null } })
      console.log(`  Tarefa ${a.tarefaId}: dataPrazo zerado (era ${a.dataPrazoAntes.toISOString()})`)
    }

    const res = await materializarSubtarefas({ stepInstanceId: a.stepInstanceId })
    console.log(`  materializarSubtarefas: criadas=${res.criadas} jaExistiam=${res.jaExistiam}`)

    const espera = await aplicarEsperaExternaDaSubtarefaSeConfigurado({ stepInstanceId: a.stepInstanceId })
    if (espera.aplicado) console.log("  espera externa automática aplicada")
  }

  console.log(`\n${alvos.length} documento(s) realinhados.`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
