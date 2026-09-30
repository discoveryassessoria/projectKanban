// scripts/backfill-a-iniciar-651.ts
// ============================================================================
// BACKFILL PONTUAL — relógio "a iniciar" das 9 tarefas do 651 (30/09/2026, autorizado pelo usuário).
//
// EMI-022 acusava 9 tarefas da Emissão do processo 651 "sem próxima ação determinável": a instância 495 está
// ancorada na versão 20 do workflow, cujo snapshot congelado não carrega `diasParaIniciar` (só passou a ser
// gravado na versão 21) — `materializarSubtarefas` não teve o que ler e `SubtaskExecution.proximoAcompanhamentoEm`
// de "enviar_requerimento_cartorio" ficou nulo. Mesma classe do hotfix de 26/09.
//
// FAZ (e só isto): para as tarefas NOMEADAS abaixo, do processo 651, com a subtarefa de entrada ainda intocada,
// grava `proximoAcompanhamentoEm = base + diasParaIniciar` — `diasParaIniciar` lido do CADASTRO VIVO do passo
// (não hardcoded) e `base` = `Tarefa.dataAtribuicao ?? Tarefa.createdAt`, a MESMA conta do motor. Uma linha de
// auditoria por tarefa. NÃO toca responsável, prazo, status, nem outro processo. Idempotente.
//
// --dry por padrão. --aplicar exige --prod + EU_CONFIRMO_ESCRITA_EM_PRODUCAO.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import { prazoOperacional } from "@/lib/operacional/tempo-operacional"

const APLICAR = process.argv.includes("--aplicar")
const PROD = process.argv.includes("--prod")
const PROCESSO = 651
const TAREFAS = [3834, 3845, 3850, 3864, 3866, 3868, 3869, 3870, 3871]

async function main() {
  const url = process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL ?? ""
  const classe = classificar(await retratar(prisma))
  console.log(`Banco: ${identificador(url)} — classificado como ${classe}`)
  if (APLICAR) {
    if (classe === CLASSE.PRODUCAO && !PROD) { console.error("Banco é PRODUÇÃO mas --prod não foi passado. Abortando."); process.exit(1) }
    if (PROD) {
      if (classe !== CLASSE.PRODUCAO) { console.error("--prod pedido mas o banco não é PRODUÇÃO. Abortando."); process.exit(1) }
      if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO") { console.error("Falta EU_CONFIRMO_ESCRITA_EM_PRODUCAO. Abortando."); process.exit(1) }
    }
  }

  const tarefas = await prisma.tarefa.findMany({
    where: { id: { in: TAREFAS }, processoId: PROCESSO },
    select: { id: true, dataAtribuicao: true, createdAt: true, workflowStepInstanceId: true, statusTarefa: true, workflowStepInstance: { select: { stepKey: true, workflowInstance: { select: { workflowDefinitionId: true } } } } },
    orderBy: { id: "asc" },
  })
  if (tarefas.length !== TAREFAS.length) { console.error(`Esperava ${TAREFAS.length} tarefas do processo ${PROCESSO}, achei ${tarefas.length}. Abortando.`); process.exit(1) }

  let feitas = 0
  for (const t of tarefas) {
    const stepKey = t.workflowStepInstance?.stepKey
    const wfId = t.workflowStepInstance?.workflowInstance?.workflowDefinitionId
    const vivo = wfId && stepKey ? await prisma.phaseInternalWorkflowStep.findFirst({ where: { workflowId: wfId, key: stepKey }, select: { diasParaIniciar: true } }) : null
    const dias = vivo?.diasParaIniciar ?? null
    if (dias == null) { console.log(`  #${t.id}: o cadastro vivo não declara diasParaIniciar — nada a fazer`); continue }
    const exec = await prisma.subtaskExecution.findFirst({
      where: { stepInstanceId: t.workflowStepInstanceId!, supersededAt: null, status: "DISPONIVEL", startedAt: null, proximoAcompanhamentoEm: null },
      select: { id: true, subtaskKey: true },
      orderBy: { id: "asc" },
    })
    if (!exec) { console.log(`  #${t.id}: sem subtarefa de entrada intocada e sem relógio — nada a fazer (idempotente)`); continue }
    const base = t.dataAtribuicao ?? t.createdAt
    const novo = prazoOperacional(dias, base)!
    console.log(`  #${t.id}: execução ${exec.id} (${exec.subtaskKey}) proximoAcompanhamentoEm null → ${novo.toISOString()} (base ${base.toISOString()} + ${dias} d)`)
    if (!APLICAR) continue
    await prisma.$transaction([
      prisma.subtaskExecution.update({ where: { id: exec.id }, data: { proximoAcompanhamentoEm: novo } }),
      prisma.logAuditoria.create({
        data: {
          acao: "ACOMPANHAMENTO_A_INICIAR_BACKFILL", entidade: "Tarefa", entidadeId: t.id,
          descricao: `Relógio "a iniciar" gravado no backfill do processo ${PROCESSO}: acompanhamento em ${novo.toISOString().slice(0, 10)} (${dias} d após ${base.toISOString().slice(0, 10)}). A instância está na versão 20 do workflow, cujo snapshot não carrega diasParaIniciar.`,
          detalhes: { antes: null, depois: novo.toISOString(), base: base.toISOString(), diasParaIniciar: dias, subtarefa: exec.subtaskKey, execucaoId: exec.id, origem: "scripts/backfill-a-iniciar-651.ts" },
        },
      }),
    ])
    feitas++
  }
  console.log(`\n${APLICAR ? `${feitas} tarefa(s) atualizada(s).` : "[dry-run] nada foi escrito. Rode com --aplicar --prod para gravar."}`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
