// scripts/sino-consolidacao-atencao.test.ts
// ============================================================================
// CONSOLIDAÇÃO DO SINO — mandato 19/09/2026 (fechamento do item 9 pendente na
// validação pós-deploy). Prova, com dado real materializado (não mock):
//
//   1) PRAZO_TAREFA_VENCIDO isolado continua pelo dono de sempre
//      (`avisarPrazosEAtrasos`, tipo ATRASO) — formato de chave INALTERADO,
//      nenhuma regressão nos testes que já dependem dele.
//   2) ACOMPANHAMENTO_DEVIDO isolado, vindo SÓ do relógio novo da subtarefa
//      (`acompanhamentoPasso`), passa a notificar — antes não tinha dono.
//   3) TERCEIRO_ATRASADO isolado passa a notificar — dimensão nova, sem dono
//      antes desta rodada.
//   4) COLISÃO (cenário F): prazo + acompanhamento + terceiro vencidos na
//      MESMA Tarefa → EXATAMENTE 1 notificação, com os 3 motivos no payload
//      — nunca 2 nem 3 notificações. Roda a varredura completa (consolidada
//      + as duas de sempre, com exclusão), do jeito que o cron real orquestra.
//   5) Idempotência: rodar tudo de novo não duplica nada.
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//     npx tsx scripts/sino-consolidacao-atencao.test.ts
// ============================================================================
import { PrismaClient } from "@prisma/client"
import {
  avisarAtencaoConsolidada, avisarPrazosEAtrasos, avisarAcontecimentosOperacionais,
  chaveDeAtencaoConsolidada, tipoPrincipalDeAtencao,
} from "../lib/operacional/tarefa-comandos"
import { exigirBancoDeTeste } from "./_banco-de-teste"

const prisma = new PrismaClient()
const M = "SINOCONS"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: `${M} ` } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefa: { processoId: { in: ids } } } })
  await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: { in: ids } } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  const arvIds = [...new Set(procs.map((p) => p.arvoreId).filter((x): x is number => x != null))]
  await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arvIds } } })
  await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::wf` }, select: { id: true } })
  if (wf) {
    await prisma.stepSubtaskDefinition.deleteMany({ where: { step: { workflowId: wf.id } } })
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: `${M}_fase` } })
  await prisma.usuario.deleteMany({ where: { email: `${M.toLowerCase()}@teste.local` } })
}

async function main() {
  exigirBancoDeTeste("prova a consolidação do sino — 1 notificação por colisão, nunca 3")
  await limpar()
  console.log("SINO CONSOLIDADO — 1 notificação por colisão (mandato 19/09/2026)\n")

  const user = await prisma.usuario.create({
    data: { nome: "Usuário SINOCONS", email: `${M.toLowerCase()}@teste.local`, senha: "x", tipo: "operacional" },
    select: { id: true },
  })

  await prisma.catalogoFase.upsert({
    where: { phaseKey: `${M}_fase` }, update: {},
    create: { phaseKey: `${M}_fase`, label: "Fase de teste sino", escopo: "PROCESSO", ordemPadrao: 99, efeitosPermitidos: ["REGISTER_ONLY"] },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${M}::wf`, phaseKey: `${M}_fase`, name: "Workflow de teste do sino", versao: 1, execucao: "SEQUENCIAL" },
    select: { id: true },
  })
  const passo = await prisma.phaseInternalWorkflowStep.create({
    data: {
      workflowId: wf.id, key: `${M}_passo`, label: "Passo de teste", ordem: 1, createsTask: true,
      required: true, cardinalidade: "DOCUMENTO", executorKey: "padrao", dependeDe: [] as never, slaDays: 5,
      regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS",
    },
    select: { id: true, key: true },
  })
  await prisma.stepSubtaskDefinition.create({
    data: { stepId: passo.id, key: "acao_interna", label: "Ação interna", ordem: 1, obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: [] as never, slaDays: 1 },
  })
  await prisma.stepSubtaskDefinition.create({
    data: { stepId: passo.id, key: "espera_terceiro", label: "Espera de terceiro", ordem: 2, obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: ["acao_interna"] as never, esperaExternaAoLiberar: true },
  })

  const hoje = new Date()
  const dias = (n: number) => { const d = new Date(hoje); d.setDate(d.getDate() + n); return d }

  const cenarios = [
    { letra: "P", nome: "Só prazo oficial vencido (isolado)", prazoOficial: dias(-1), acompanhamento: null as Date | null, regraTemporal: null as Date | null },
    { letra: "A", nome: "Só acompanhamento vencido (isolado, relógio da subtarefa)", prazoOficial: dias(30), acompanhamento: dias(-1), regraTemporal: null },
    { letra: "T", nome: "Só terceiro atrasado (isolado)", prazoOficial: dias(30), acompanhamento: null, regraTemporal: dias(-1) },
    { letra: "F", nome: "Colisão — prazo + acompanhamento + terceiro, tudo vencido", prazoOficial: dias(-1), acompanhamento: dias(-1), regraTemporal: dias(-2) },
  ]

  const tarefaPorLetra = new Map<string, number>()
  for (const c of cenarios) {
    const arv = await prisma.arvore.create({ data: { nome: `${M} árvore ${c.letra}` }, select: { id: true } })
    const pessoa = await prisma.pessoa.create({ data: { nome: "Fulano SINOCONS", sobrenome: c.letra, arvoreId: arv.id }, select: { id: true } })
    const proc = await prisma.processo.create({
      data: { nome: `${M} Cenário ${c.letra} — ${c.nome}`, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: `${M}_fase` },
      select: { id: true },
    })
    const inst = await prisma.phaseWorkflowInstance.create({
      data: { processoId: proc.id, faseMacroKey: `${M}_fase`, ciclo: 1, status: "ATIVO", workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `${M}-${c.letra}-i1` },
      select: { id: true },
    })
    const si = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: `${M}_fase`, ciclo: 1,
        stepKey: passo.key, ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
        status: "EM_ANDAMENTO", dependeDeStepKeys: [] as never, pessoaId: pessoa.id,
        stepDefinitionId: passo.id, stepDefinitionVersion: 1, chaveIdempotencia: `${M}-${c.letra}-p1`,
      },
      select: { id: true },
    })
    const tarefa = await prisma.tarefa.create({
      data: {
        titulo: `${M} ${c.nome}`, processoId: proc.id, workflowStepInstanceId: si.id, workflowInstanceId: inst.id,
        chaveIdempotencia: `${M}-${c.letra}-t1`, statusTarefa: "AGUARDANDO_TERCEIRO",
        responsavelId: user.id, dataPrazo: c.prazoOficial, pessoaId: pessoa.id,
      },
      select: { id: true },
    })
    tarefaPorLetra.set(c.letra, tarefa.id)
    await prisma.subtaskExecution.create({
      data: {
        stepInstanceId: si.id, subtaskKey: "acao_interna", sequencia: 1, status: "CONCLUIDO", motivo: "ABERTURA",
        completedAt: new Date(), executadoPorId: user.id, chaveIdempotencia: `${M}-${c.letra}-sub1`,
      },
    })
    await prisma.subtaskExecution.create({
      data: {
        stepInstanceId: si.id, subtaskKey: "espera_terceiro", sequencia: 1, status: "AGUARDANDO_EXTERNO", motivo: "ABERTURA",
        proximoAcompanhamentoEm: c.acompanhamento, previstoPara: c.regraTemporal, chaveIdempotencia: `${M}-${c.letra}-sub2`,
      },
    })
  }

  const taskP = tarefaPorLetra.get("P")!
  const taskA = tarefaPorLetra.get("A")!
  const taskT = tarefaPorLetra.get("T")!
  const taskF = tarefaPorLetra.get("F")!

  console.log("1) VARREDURA CONSOLIDADA — quem ela assume e quem ela deixa pro dono de sempre")
  const consolidada1 = await avisarAtencaoConsolidada({ agora: hoje })
  check("P (só prazo) NÃO foi assumida pela consolidada — dono de sempre continua",
    !consolidada1.tarefasConsolidadas.includes(taskP))
  check("A (só acompanhamento da subtarefa) FOI assumida — dimensão sem dono antes",
    consolidada1.tarefasConsolidadas.includes(taskA))
  check("T (só terceiro atrasado) FOI assumida — dimensão nova, sem dono antes",
    consolidada1.tarefasConsolidadas.includes(taskT))
  check("F (colisão) FOI assumida", consolidada1.tarefasConsolidadas.includes(taskF))

  console.log("\n2) NOTIFICAÇÕES CRIADAS PELA CONSOLIDADA — 1 por tarefa assumida, motivos certos")
  const notifA = await prisma.notificacaoOperacional.findMany({ where: { tarefaId: taskA } })
  check("A: exatamente 1 notificação", notifA.length === 1, `n=${notifA.length}`)
  check("A: tipo = ACOMPANHAMENTO_VENCIDO", notifA[0]?.tipo === "ACOMPANHAMENTO_VENCIDO")
  check("A: motivos = [ACOMPANHAMENTO_DEVIDO]", JSON.stringify(notifA[0]?.motivos) === JSON.stringify(["ACOMPANHAMENTO_DEVIDO"]), JSON.stringify(notifA[0]?.motivos))

  const notifT = await prisma.notificacaoOperacional.findMany({ where: { tarefaId: taskT } })
  check("T: exatamente 1 notificação", notifT.length === 1, `n=${notifT.length}`)
  check("T: tipo = TERCEIRO_ATRASADO", notifT[0]?.tipo === "TERCEIRO_ATRASADO")
  check("T: motivos = [TERCEIRO_ATRASADO]", JSON.stringify(notifT[0]?.motivos) === JSON.stringify(["TERCEIRO_ATRASADO"]), JSON.stringify(notifT[0]?.motivos))

  console.log("\n3) COLISÃO F — a varredura completa, orquestrada como o cron real (consolidada primeiro, exclusão nas outras duas)")
  const [prazos, atencao] = await Promise.all([
    avisarPrazosEAtrasos({ agora: hoje, excluirTarefaIds: consolidada1.tarefasConsolidadas }),
    avisarAcontecimentosOperacionais({ agora: hoje, excluirTarefaIds: consolidada1.tarefasConsolidadas }),
  ])
  check("avisarPrazosEAtrasos não gerou ATRASO para F (excluída)", prazos.previa.every((p) => p.tarefaId !== taskF) && true)
  check("avisarAcontecimentosOperacionais não gerou nada para F (excluída)", atencao.previa.every((p) => p.tarefaId !== taskF) && true)

  const todasDeF = await prisma.notificacaoOperacional.findMany({ where: { tarefaId: taskF } })
  check("F: EXATAMENTE 1 notificação no total (nunca 2 nem 3)", todasDeF.length === 1, `n=${todasDeF.length} tipos=${todasDeF.map((n) => n.tipo).join(",")}`)
  const motivosF = (todasDeF[0]?.motivos ?? []) as string[]
  check("F: motivos contém PRAZO_TAREFA_VENCIDO", motivosF.includes("PRAZO_TAREFA_VENCIDO"), JSON.stringify(motivosF))
  check("F: motivos contém ACOMPANHAMENTO_DEVIDO", motivosF.includes("ACOMPANHAMENTO_DEVIDO"), JSON.stringify(motivosF))
  check("F: motivos contém TERCEIRO_ATRASADO", motivosF.includes("TERCEIRO_ATRASADO"), JSON.stringify(motivosF))
  check("F: tipoPrincipalDeAtencao(motivos) = ATRASO (maior precedência, prazo vencido)", tipoPrincipalDeAtencao(motivosF as never) === "ATRASO")
  check("F: deep-link único aponta para a tarefa/família na Minha Operação", !!todasDeF[0]?.link && todasDeF[0]!.link!.length > 0, todasDeF[0]?.link ?? "")

  console.log("\n4) P (isolado) — o dono de sempre (ATRASO) continua funcionando, formato de chave inalterado")
  const notifP = await prisma.notificacaoOperacional.findMany({ where: { tarefaId: taskP } })
  check("P: exatamente 1 notificação, tipo ATRASO (via avisarPrazosEAtrasos, dono de sempre)",
    notifP.length === 1 && notifP[0]?.tipo === "ATRASO", `n=${notifP.length} tipo=${notifP[0]?.tipo}`)
  check("P: motivos = null (não passou pela consolidada)", notifP[0]?.motivos == null)

  console.log("\n5) IDEMPOTÊNCIA — roda tudo de novo, nada duplica")
  const consolidada2 = await avisarAtencaoConsolidada({ agora: hoje })
  await Promise.all([
    avisarPrazosEAtrasos({ agora: hoje, excluirTarefaIds: consolidada2.tarefasConsolidadas }),
    avisarAcontecimentosOperacionais({ agora: hoje, excluirTarefaIds: consolidada2.tarefasConsolidadas }),
  ])
  const totalDepois = await prisma.notificacaoOperacional.count({
    where: { tarefaId: { in: [taskP, taskA, taskT, taskF] } },
  })
  check("segunda rodada: total continua 4 (1 por tarefa), nenhuma duplicata", totalDepois === 4, `total=${totalDepois}`)

  console.log("\n6) CHAVE DETERMINÍSTICA — mesmo conjunto de motivos, mesma chave (dedup pelo banco)")
  const chave1 = chaveDeAtencaoConsolidada(taskF, ["ACOMPANHAMENTO_DEVIDO", "PRAZO_TAREFA_VENCIDO", "TERCEIRO_ATRASADO"] as never, user.id)
  const chave2 = chaveDeAtencaoConsolidada(taskF, ["TERCEIRO_ATRASADO", "PRAZO_TAREFA_VENCIDO", "ACOMPANHAMENTO_DEVIDO"] as never, user.id)
  check("chave não depende da ORDEM dos motivos (ordenada internamente)", chave1 === chave2, `${chave1} vs ${chave2}`)

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
