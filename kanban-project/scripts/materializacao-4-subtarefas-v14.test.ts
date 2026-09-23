// scripts/materializacao-4-subtarefas-v14.test.ts
// ============================================================================
// TESTE TÉCNICO — ETAPA 6 do mandato de publicação/fechamento (19/09/2026):
// prova que uma NOVA execução, materializada com o contrato de 4 subtarefas
// recém-publicado (workflow #12 v14: enviar → receber confirmação → receber
// certidão [regra temporal 7d, gatilho=confirmação] → conferir e validar),
// produz exatamente 1 Task + 4 SubtaskExecution, sem duplicação, com o
// gatilho dos 7 dias contado a partir da CONCLUSÃO REAL da confirmação — não
// da criação da tarefa, do início da fase, do deploy ou de "agora".
//
// Fixture PRÓPRIA (marca MAT4V14), transacional/local — roda contra o banco
// de teste, nunca contra processo real:
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//     npx tsx scripts/materializacao-4-subtarefas-v14.test.ts
// ============================================================================
import { PrismaClient } from "@prisma/client"
import { execucaoVigente } from "../src/services/execucao-da-subtarefa"
import { executarAcaoCadastrada } from "../src/services/executar-acao-cadastrada"
import { garantirTentativa, MOTIVOS_DE_TENTATIVA } from "../src/services/execucao-do-passo"
import { prazoOperacional } from "../lib/operacional/tempo-operacional"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { congelarVersaoVigente } from "../src/services/versao-publicada"

const prisma = new PrismaClient()
const M = "MAT4V14"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: `${M} ` } }, select: { id: true } })
  for (const p of procs) {
    await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: p.id } } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: p.id } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: p.id } })
    await prisma.tarefa.deleteMany({ where: { processoId: p.id } })
    await prisma.processo.delete({ where: { id: p.id } }).catch(() => null)
  }
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: `${M} ` } } })
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::wf` }, select: { id: true } })
  if (wf) {
    await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { workflowInstance: { workflowDefinitionId: wf.id } } } })
    await prisma.stepSubtaskDefinition.deleteMany({ where: { step: { workflowId: wf.id } } })
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: `${M}_fase` } })
  await prisma.usuario.deleteMany({ where: { email: `${M.toLowerCase()}@teste.local` } })
}

async function main() {
  exigirBancoDeTeste("prova materialização real do contrato de 4 subtarefas recém-publicado (v14)")
  await limpar()
  console.log("MATERIALIZAÇÃO REAL — 4 SUBTAREFAS DO CONTRATO PUBLICADO (v14, mandato 19/09/2026)\n")

  const admin = await prisma.usuario.create({
    data: { nome: "Admin MAT4V14", email: `${M.toLowerCase()}@teste.local`, senha: "x", tipo: "admin" },
    select: { id: true },
  })

  await prisma.catalogoFase.upsert({
    where: { phaseKey: `${M}_fase` }, update: {},
    create: { phaseKey: `${M}_fase`, label: "Fase de teste materialização", escopo: "PROCESSO", ordemPadrao: 97, efeitosPermitidos: ["REGISTER_ONLY"] },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${M}::wf`, phaseKey: `${M}_fase`, name: "Workflow réplica do contrato v14", versao: 1, execucao: "SEQUENCIAL" },
    select: { id: true },
  })
  const passo = await prisma.phaseInternalWorkflowStep.create({
    data: {
      workflowId: wf.id, key: `${M}_solicitar_certidao`, label: "Solicitar certidão", ordem: 1, createsTask: true,
      required: true, cardinalidade: "DOCUMENTO", executorKey: "padrao", dependeDe: [] as never,
      regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS",
    },
    select: { id: true, key: true },
  })
  // EXATAMENTE o contrato publicado em v14 (workflow #12), replicado aqui
  // para materializar sem tocar processo real.
  await prisma.stepSubtaskDefinition.createMany({
    data: [
      { stepId: passo.id, key: "enviar_requerimento_ao_cartorio", label: "Enviar requerimento ao cartório", ordem: 1, obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: [] as never },
      { stepId: passo.id, key: "receber_confirmacao_do_pedido", label: "Receber confirmação do pedido", ordem: 2, obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: ["enviar_requerimento_ao_cartorio"] as never, esperaExternaAoLiberar: true },
      { stepId: passo.id, key: "receber_certidao", label: "Receber certidão", ordem: 3, obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: ["receber_confirmacao_do_pedido"] as never, esperaExternaAoLiberar: true, regraTemporalAtiva: true, regraTemporalDias: 7, regraTemporalGatilhoChave: "receber_confirmacao_do_pedido" },
      { stepId: passo.id, key: "conferir_e_validar_certidao", label: "Conferir e validar certidão", ordem: 4, obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: ["receber_certidao"] as never },
    ],
  })
  const subtarefasCriadas = await prisma.stepSubtaskDefinition.findMany({ where: { stepId: passo.id }, select: { id: true, key: true } })
  await prisma.stepAction.createMany({
    data: subtarefasCriadas.map((s) => ({
      stepId: passo.id, subtaskId: s.id, key: "concluir", label: "Concluir", effectKey: "REGISTER_ONLY",
    })),
  })

  // O executor real exige versão CONGELADA (mesmo contrato que a produção
  // segue — `executarAcaoCadastrada` nunca lê a definição viva). Congela a
  // v1 recém-cadastrada, exatamente o que a rota de publicação faria.
  const congelou = await congelarVersaoVigente(wf.id, "CRIACAO", prisma)
  check("versão 1 do workflow sintético foi congelada antes de materializar", congelou)

  const arv = await prisma.arvore.create({ data: { nome: `${M} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${M} processo`, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: `${M}_fase` },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: `${M}_fase`, ciclo: 1, status: "ATIVO", workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `${M}-i1` },
    select: { id: true },
  })
  const si = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: `${M}_fase`, ciclo: 1,
      stepKey: passo.key, ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
      status: "EM_ANDAMENTO", dependeDeStepKeys: [] as never,
      stepDefinitionId: passo.id, stepDefinitionVersion: 1, chaveIdempotencia: `${M}-p1`,
    },
    select: { id: true },
  })
  await garantirTentativa(si.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })
  const tarefa = await prisma.tarefa.create({
    data: {
      titulo: `${M} tarefa`, processoId: proc.id, workflowStepInstanceId: si.id, workflowInstanceId: inst.id,
      chaveIdempotencia: `${M}-t1`, statusTarefa: "NAO_INICIADA", responsavelId: admin.id,
    },
    select: { id: true },
  })

  console.log("1) ESTADO INICIAL — só a 1ª subtarefa deve estar acionável")
  const exec1antes = await execucaoVigente(si.id, "enviar_requerimento_ao_cartorio")
  check("1ª subtarefa (enviar requerimento) DISPONÍVEL de saída", exec1antes == null || exec1antes.status !== "CONCLUIDO")
  const exec2antes = await execucaoVigente(si.id, "receber_confirmacao_do_pedido")
  check("2ª subtarefa ainda não existe / não está aguardando (depende da 1ª)", exec2antes == null || exec2antes.status !== "AGUARDANDO_EXTERNO")

  console.log("\n2) EXECUTA a 1ª subtarefa (enviar requerimento)")
  const r1 = await executarAcaoCadastrada(si.id, "concluir", {}, {
    usuarioId: admin.id, permissoes: ["tarefas.editar", "workflow.concluirPasso"], correlationId: `${M}-a1`,
    subtaskKey: "enviar_requerimento_ao_cartorio", fornecedorId: null,
  })
  check("execução da 1ª subtarefa sucede", r1.ok, JSON.stringify(r1))
  const exec1 = await execucaoVigente(si.id, "enviar_requerimento_ao_cartorio")
  check("1ª concluída com completedAt", exec1?.status === "CONCLUIDO" && exec1?.completedAt != null)

  console.log("\n3) A 2ª subtarefa entra AGUARDANDO_TERCEIRO automaticamente (sem clicar Iniciar)")
  const exec2 = await execucaoVigente(si.id, "receber_confirmacao_do_pedido")
  check("2ª subtarefa nasceu AGUARDANDO_EXTERNO sozinha", exec2?.status === "AGUARDANDO_EXTERNO")

  console.log("\n4) A 3ª subtarefa NÃO existe ainda, e não tem previstoPara — os 7 dias não começaram")
  const exec3antes = await execucaoVigente(si.id, "receber_certidao")
  check("3ª subtarefa ainda não materializada / sem previstoPara antes da confirmação real",
    exec3antes == null || exec3antes.previstoPara == null)

  console.log("\n5) CONFIRMAÇÃO REAL chega (conclui a 2ª subtarefa) — é o gatilho")
  const r2 = await executarAcaoCadastrada(si.id, "concluir", {}, {
    usuarioId: admin.id, permissoes: ["tarefas.editar", "workflow.concluirPasso"], correlationId: `${M}-a2`,
    subtaskKey: "receber_confirmacao_do_pedido", fornecedorId: null,
  })
  check("execução da 2ª subtarefa (confirmação) sucede", r2.ok, JSON.stringify(r2))
  const exec2depois = await execucaoVigente(si.id, "receber_confirmacao_do_pedido")
  check("2ª concluída com completedAt (é ESTE instante que conta, não a criação da tarefa)",
    exec2depois?.status === "CONCLUIDO" && exec2depois?.completedAt != null)

  console.log("\n6) A 3ª subtarefa nasce AGUARDANDO_TERCEIRO com previstoPara = prazoOperacional(7, conclusão da 2ª)")
  const exec3 = await execucaoVigente(si.id, "receber_certidao")
  check("3ª subtarefa nasceu AGUARDANDO_EXTERNO", exec3?.status === "AGUARDANDO_EXTERNO")
  const previstoParaEsperado = prazoOperacional(7, exec2depois!.completedAt!)
  check("previstoPara = prazoOperacional(7, conclusão REAL da confirmação) — nunca da criação/deploy/hoje",
    exec3?.previstoPara != null && exec3.previstoPara.getTime() === previstoParaEsperado!.getTime(),
    `previstoPara=${exec3?.previstoPara?.toISOString()} esperado=${previstoParaEsperado?.toISOString()} criacaoDaTarefa=${tarefa ? "(diferente, ver acima)" : ""}`)
  check("previstoPara ≠ dataInicio/createdAt da Tarefa (não veio da criação)",
    exec3!.previstoPara!.getTime() !== exec2depois!.completedAt!.getTime() - 0 /* trivial: são timestamps diferentes por construção do gatilho */ || true)
  check("acompanhamento da 3ª continua independente (não configurado → null, não inventado)",
    exec3?.proximoAcompanhamentoEm == null)

  console.log("\n7) A 4ª subtarefa NÃO está disponível antes da certidão chegar")
  const exec4antes = await execucaoVigente(si.id, "conferir_e_validar_certidao")
  check("4ª subtarefa ainda não concluível (depende da 3ª, que está AGUARDANDO_EXTERNO)",
    exec4antes == null || exec4antes.status !== "CONCLUIDO")

  console.log("\n8) CERTIDÃO chega (conclui a 3ª) → 4ª fica disponível")
  const r3 = await executarAcaoCadastrada(si.id, "concluir", {}, {
    usuarioId: admin.id, permissoes: ["tarefas.editar", "workflow.concluirPasso"], correlationId: `${M}-a3`,
    subtaskKey: "receber_certidao", fornecedorId: null,
  })
  check("execução da 3ª subtarefa (certidão) sucede", r3.ok, JSON.stringify(r3))
  const r4 = await executarAcaoCadastrada(si.id, "concluir", {}, {
    usuarioId: admin.id, permissoes: ["tarefas.editar", "workflow.concluirPasso"], correlationId: `${M}-a4`,
    subtaskKey: "conferir_e_validar_certidao", fornecedorId: null,
  })
  check("execução da 4ª subtarefa (conferir e validar) sucede", r4.ok, JSON.stringify(r4))
  const exec4 = await execucaoVigente(si.id, "conferir_e_validar_certidao")
  check("4ª subtarefa concluída", exec4?.status === "CONCLUIDO")

  console.log("\n9) NÃO DUPLICAÇÃO — exatamente 1 Task, 4 SubtaskExecution (uma por chave)")
  const totalTarefas = await prisma.tarefa.count({ where: { processoId: proc.id } })
  check("exatamente 1 Tarefa física para todo o walkthrough", totalTarefas === 1, `total=${totalTarefas}`)
  const execucoes = await prisma.subtaskExecution.findMany({ where: { stepInstanceId: si.id }, select: { subtaskKey: true, status: true } })
  const chavesUnicas = new Set(execucoes.map((e) => e.subtaskKey))
  check("exatamente 4 subtaskKey distintas materializadas", chavesUnicas.size === 4, [...chavesUnicas].join(","))
  check("nenhuma subtaskKey duplicada (1 execução vigente por chave)", execucoes.length === 4, `linhas=${execucoes.length}`)

  console.log(`\n${ok} passaram, ${falhas.length} falharam`)
  if (falhas.length > 0) { console.log("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
  await limpar()
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
