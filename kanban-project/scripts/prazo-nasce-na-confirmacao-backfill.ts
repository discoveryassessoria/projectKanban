// scripts/prazo-nasce-na-confirmacao-backfill.ts
// ============================================================================
// BUG 1 — CADASTRO + BACKFILL. Ver scripts/prazo-nasce-na-confirmacao.test.ts
// pro mecanismo provado. Aqui, os dois passos pra produção:
//
// 1. CADASTRO: `receber_certidao` (Biblioteca de Tarefas "Solicitar
//    certidão", StepSubtaskDefinition#131) nunca teve `definePrazoDaTarefa`/
//    `prazoDaTarefaDias` configurado (achado: TODAS as 4 subtarefas do
//    catálogo tinham `false`/`null`) — por isso toda Tarefa nova caía no
//    regime incondicional antigo (`slaDays` do PASSO, 10 dias, contados da
//    CRIAÇÃO). Corrige pra `definePrazoDaTarefa: true, prazoDaTarefaDias: 10`
//    — o prazo passa a nascer quando o passo 2 (confirmação) libera o passo
//    3 como corrente, nunca antes.
//
// 2. BACKFILL: zera `Tarefa.dataPrazo` das Tarefas que JÁ nasceram com o
//    valor indevido (corrente ainda em "enviar_requerimento_cartorio" ou
//    "receber_confirmacao_pedido" — o cartório nunca confirmou, o prazo não
//    devia existir). Nenhuma tarefa em produção, na hora desta investigação,
//    já tinha avançado além do passo 2 com o prazo antigo gravado — não há
//    caso de "recalcular" (confirmação já aconteceu, prazo devia refletir
//    ela), só de "zerar".
//
// --dry por padrão. --aplicar exige --prod + EU_CONFIRMO_ESCRITA_EM_PRODUCAO.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"

const APLICAR = process.argv.includes("--aplicar")
const PROD = process.argv.includes("--prod")

const ENCERRADOS = new Set(["CONCLUIDO", "CANCELADO", "INVALIDADO", "FALHOU"])
const DEPENDE_DE: Record<string, string[]> = {
  enviar_requerimento_cartorio: [],
  receber_confirmacao_pedido: ["enviar_requerimento_cartorio"],
  receber_certidao: ["receber_confirmacao_pedido"],
  conferir_validar_certidao: ["receber_certidao"],
}

async function main() {
  const url = process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL ?? ""
  const id = identificador(url)
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`Banco: ${id} — classificado como ${classe}`)

  if (APLICAR) {
    if (classe === CLASSE.PRODUCAO && !PROD) { console.error("Banco é PRODUÇÃO mas --prod não foi passado. Abortando."); process.exit(1) }
    if (PROD) {
      if (classe !== CLASSE.PRODUCAO) { console.error("--prod pedido mas o banco não é PRODUÇÃO. Abortando."); process.exit(1) }
      if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO") { console.error("Falta EU_CONFIRMO_ESCRITA_EM_PRODUCAO. Abortando."); process.exit(1) }
    }
  }

  // ── 1. Cadastro ──────────────────────────────────────────────────────
  console.log("\n=== 1. Cadastro: receber_certidao (StepSubtaskDefinition#131) ===")
  const antes = await prisma.stepSubtaskDefinition.findUnique({
    where: { id: 131 }, select: { id: true, key: true, definePrazoDaTarefa: true, prazoDaTarefaDias: true },
  })
  if (!antes || antes.key !== "receber_certidao") { console.error(`Estado inesperado pra id=131: ${JSON.stringify(antes)}. Abortando.`); process.exit(1) }
  console.log("antes:", JSON.stringify(antes))
  if (APLICAR) {
    await prisma.stepSubtaskDefinition.update({ where: { id: 131 }, data: { definePrazoDaTarefa: true, prazoDaTarefaDias: 10 } })
    const depois = await prisma.stepSubtaskDefinition.findUnique({ where: { id: 131 }, select: { id: true, key: true, definePrazoDaTarefa: true, prazoDaTarefaDias: true } })
    console.log("depois:", JSON.stringify(depois))
  } else {
    console.log("[dry-run] definePrazoDaTarefa: false → true, prazoDaTarefaDias: null → 10")
  }

  // ── 2. Backfill ──────────────────────────────────────────────────────
  console.log("\n=== 2. Backfill: dataPrazo indevido (corrente em passo 1/2) ===")
  const stepInstances = await prisma.phaseWorkflowStepInstance.findMany({
    where: { faseMacroKey: "emissao_documental" }, select: { id: true }, orderBy: { id: "asc" },
  })
  const ids = stepInstances.map((s) => s.id)
  const execs = await prisma.subtaskExecution.findMany({ where: { stepInstanceId: { in: ids }, supersededAt: null }, select: { stepInstanceId: true, subtaskKey: true, status: true } })
  const tarefas = await prisma.tarefa.findMany({ where: { workflowStepInstanceId: { in: ids } }, select: { id: true, workflowStepInstanceId: true, dataPrazo: true } })
  const execsPorStep = new Map<number, typeof execs>()
  for (const e of execs) execsPorStep.set(e.stepInstanceId, [...(execsPorStep.get(e.stepInstanceId) ?? []), e])
  const tarefaPorStep = new Map(tarefas.map((t) => [t.workflowStepInstanceId as number, t]))

  const alvos: { stepInstanceId: number; tarefaId: number; dataPrazoAntes: Date }[] = []
  for (const stepInstanceId of ids) {
    const es = execsPorStep.get(stepInstanceId) ?? []
    if (es.length === 0) continue
    const concluidasKeys = new Set(es.filter((e) => e.status === "CONCLUIDO").map((e) => e.subtaskKey))
    const corrente = es.filter((e) => !ENCERRADOS.has(e.status)).find((e) => (DEPENDE_DE[e.subtaskKey] ?? []).every((dep) => concluidasKeys.has(dep)))
    if (corrente?.subtaskKey !== "enviar_requerimento_cartorio" && corrente?.subtaskKey !== "receber_confirmacao_pedido") continue
    const tarefa = tarefaPorStep.get(stepInstanceId)
    if (!tarefa?.dataPrazo) continue
    alvos.push({ stepInstanceId, tarefaId: tarefa.id, dataPrazoAntes: tarefa.dataPrazo })
  }
  console.log(`${alvos.length} tarefa(s) alvo:`)
  for (const a of alvos) console.log(JSON.stringify(a))

  if (!APLICAR) {
    console.log("\nRode com --aplicar (e --prod) para escrever de verdade.")
    await prisma.$disconnect()
    return
  }
  for (const a of alvos) {
    await prisma.tarefa.update({ where: { id: a.tarefaId }, data: { dataPrazo: null } })
    console.log(`tarefa ${a.tarefaId}: dataPrazo ${a.dataPrazoAntes.toISOString()} → null`)
  }
  console.log(`\n${alvos.length} tarefa(s) corrigidas.`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
