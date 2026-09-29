// scripts/sino-consolidacao-atencao.test.ts
// ============================================================================
// CONSOLIDAÇÃO DO SINO — mandato 19/09/2026, reescrito para o sino AGRUPADO
// (redesenho de 29/09/2026). Prova, com dado real materializado (não mock):
//
//   1) PRAZO_TAREFA_VENCIDO isolado vira "<Família> — 1 vencida" no PRECISA_AGIR.
//   2) ACOMPANHAMENTO_DEVIDO isolado, vindo SÓ do relógio novo da subtarefa
//      (`acompanhamentoPasso`), vira "1 cobrança a fazer".
//   3) TERCEIRO_ATRASADO isolado também vira "1 cobrança a fazer".
//   4) COLISÃO (cenário F): prazo + acompanhamento + terceiro vencidos na MESMA
//      Tarefa → EXATAMENTE 1 aviso (por pessoa/família), que cobre UMA tarefa
//      (contagem 1, nunca 2 nem 3) e diz "1 vencida · 1 cobrança a fazer".
//      Roda o resumo diário e a varredura horária, do jeito que os crons reais fazem.
//   5) Idempotência: rodar tudo de novo não duplica nem renotifica nada.
//   6) Determinismo: a mesma foto em outra ordem de ids é o mesmo aviso (SEM_MUDANCA).
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//     npx tsx scripts/sino-consolidacao-atencao.test.ts
// ============================================================================
import { PrismaClient } from "@prisma/client"
import { rodarResumoDiario, rodarVarreduraHoraria } from "../lib/operacional/avisos-sino"
import { gravarFotoDoAviso } from "../lib/operacional/notificacao-canonica"
import { textoDoAviso, type ResumoDoAviso } from "../lib/operacional/aviso-texto"
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
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({
    where: { OR: [{ processoId: { in: ids } }, { tarefaId: { in: ts.map((t) => t.id) } }] },
  })
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
    data: { stepId: passo.id, key: "acao_interna", label: "Ação interna", ordem: 1, obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: [] as never },
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

  const avisosDe = (processoId: number) =>
    prisma.notificacaoOperacional.findMany({ where: { processoId }, orderBy: { id: "asc" } })
  const procDe = async (taskId: number) => (await prisma.tarefa.findUniqueOrThrow({ where: { id: taskId }, select: { processoId: true } })).processoId!
  const procP = await procDe(taskP), procA = await procDe(taskA), procT = await procDe(taskT), procF = await procDe(taskF)
  const resumoDe = (a: { resumo: unknown } | undefined) => (a?.resumo ?? {}) as ResumoDoAviso

  console.log("1) RESUMO DIÁRIO — cada cenário vira o seu texto, na sua família")
  const dia1 = await rodarResumoDiario({ agora: hoje })
  void dia1
  const [avP] = await avisosDe(procP)
  const [avA] = await avisosDe(procA)
  const [avT] = await avisosDe(procT)
  check("P (só prazo vencido): '<Família> — 1 vencida'", avP?.tipo === "PRECISA_AGIR" && avP.titulo.endsWith(" — 1 vencida"), avP?.titulo)
  check("A (só acompanhamento da subtarefa): '1 cobrança a fazer' — dimensão sem dono antes",
    avA?.tipo === "PRECISA_AGIR" && avA.titulo.endsWith(" — 1 cobrança a fazer"), avA?.titulo ?? "sem aviso")
  check("T (só terceiro atrasado): '1 cobrança a fazer' — dimensão nova, sem dono antes",
    avT?.tipo === "PRECISA_AGIR" && avT.titulo.endsWith(" — 1 cobrança a fazer"), avT?.titulo ?? "sem aviso")

  console.log("\n2) AVISOS DE FAMÍLIA — 1 por (pessoa, família), categorias certas no resumo")
  const notifA = await avisosDe(procA)
  check("A: exatamente 1 aviso", notifA.length === 1, `n=${notifA.length}`)
  check("A: destinatário é o responsável e o aviso é agrupado (sem tarefaId)", notifA[0]?.destinatarioId === user.id && notifA[0].agrupado === true && notifA[0].tarefaId == null)
  check("A: só cobrança (nenhuma vencida)", JSON.stringify(resumoDe(notifA[0]).cobrancas) === JSON.stringify([taskA]) && (resumoDe(notifA[0]).vencidas ?? []).length === 0, JSON.stringify(notifA[0]?.resumo))
  const notifT = await avisosDe(procT)
  check("T: exatamente 1 aviso", notifT.length === 1, `n=${notifT.length}`)
  check("T: só cobrança (nenhuma vencida)", JSON.stringify(resumoDe(notifT[0]).cobrancas) === JSON.stringify([taskT]) && (resumoDe(notifT[0]).vencidas ?? []).length === 0, JSON.stringify(notifT[0]?.resumo))

  console.log("\n3) COLISÃO F — prazo + acompanhamento + terceiro na mesma tarefa: UM aviso, UMA tarefa")
  const hora1 = await rodarVarreduraHoraria({ agora: hoje })
  const todasDeF = await avisosDe(procF)
  check("F: EXATAMENTE 1 aviso no total (nunca 2 nem 3)", todasDeF.length === 1, `n=${todasDeF.length} tipos=${todasDeF.map((n) => n.tipo).join(",")}`)
  const rF = resumoDe(todasDeF[0])
  check("F: a tarefa está em 'vencidas' (prazo vencido)", (rF.vencidas ?? []).includes(taskF), JSON.stringify(rF))
  check("F: a tarefa está em 'cobranças' (acompanhamento devido / terceiro atrasado)", (rF.cobrancas ?? []).includes(taskF), JSON.stringify(rF))
  check("F: cobre UMA tarefa (a mesma em duas categorias não conta em dobro)", todasDeF[0]?.contagem === 1 && todasDeF[0].tarefaIds.length === 1 && todasDeF[0].tarefaIds[0] === taskF, `contagem=${todasDeF[0]?.contagem}`)
  check("F: texto '<Família> — 1 vencida · 1 cobrança a fazer'", todasDeF[0]?.titulo.endsWith(" — 1 vencida · 1 cobrança a fazer") === true, todasDeF[0]?.titulo)
  const nomeF = (await prisma.processo.findUniqueOrThrow({ where: { id: procF }, select: { nome: true } })).nome
  check("F: texto = função pura de (tipo, família, contagem, resumo)",
    todasDeF[0]?.titulo === textoDoAviso("PRECISA_AGIR", nomeF, { contagem: todasDeF[0].contagem, resumo: rF }))
  check("F: deep-link único aponta para a aba de acompanhamento da família na Operação",
    todasDeF[0]?.link === `/operacao?processo=${procF}&aba=acompanhamento`, todasDeF[0]?.link ?? "")

  console.log("\n4) P (isolado) — só vencida, sem cobrança misturada")
  const notifP = await avisosDe(procP)
  check("P: exatamente 1 aviso, PRECISA_AGIR", notifP.length === 1 && notifP[0]?.tipo === "PRECISA_AGIR", `n=${notifP.length} tipo=${notifP[0]?.tipo}`)
  check("P: sem cobranças no resumo", (resumoDe(notifP[0]).cobrancas ?? []).length === 0 && (resumoDe(notifP[0]).vencidas ?? []).includes(taskP), JSON.stringify(notifP[0]?.resumo))
  check("nenhum aviso legado por tarefa (agrupado=false) em nenhum cenário",
    (await prisma.notificacaoOperacional.count({ where: { processoId: { in: [procP, procA, procT, procF] }, agrupado: false } })) === 0)

  console.log("\n5) IDEMPOTÊNCIA — roda tudo de novo, nada duplica nem renotifica")
  const idsAntes = new Map<number, Date>()
  for (const pr of [procP, procA, procT, procF]) for (const a of await avisosDe(pr)) idsAntes.set(a.id, a.atualizadoEm)
  const dia2 = await rodarResumoDiario({ agora: hoje })
  const hora2 = await rodarVarreduraHoraria({ agora: hoje })
  const totalDepois = await prisma.notificacaoOperacional.count({ where: { processoId: { in: [procP, procA, procT, procF] } } })
  check("segunda rodada: total continua 4 (1 por família), nenhuma duplicata", totalDepois === 4, `total=${totalDepois}`)
  check("segunda rodada: nenhum aviso criado nem atualizado", dia2.precisaAgir.criados === 0 && hora2.precisaAgir.criados === 0 && dia2.precisaAgir.atualizados === 0 && hora2.precisaAgir.atualizados === 0,
    `dia criados=${dia2.precisaAgir.criados} hora criados=${hora2.precisaAgir.criados}`)
  let intactos = true
  for (const pr of [procP, procA, procT, procF]) for (const a of await avisosDe(pr)) if (idsAntes.get(a.id)?.getTime() !== a.atualizadoEm.getTime()) intactos = false
  check("os avisos não voltaram ao topo (atualizadoEm intacto)", intactos)
  void hora1

  console.log("\n6) DETERMINISMO — a mesma foto, em outra ordem de ids, é o mesmo aviso")
  const avF = todasDeF[0]
  const embaralhado: ResumoDoAviso = { ...rF, vencidas: [...(rF.vencidas ?? [])].reverse(), cobrancas: [...(rF.cobrancas ?? [])].reverse() }
  const regravado = await gravarFotoDoAviso(prisma, {
    tipo: "PRECISA_AGIR", destinatarioId: user.id, processoId: procF, familiaNome: nomeF,
    resumo: embaralhado, link: avF.link ?? "",
  })
  check("mesma foto, ordem diferente → SEM_MUDANCA no mesmo aviso (a foto é normalizada)", regravado.acao === "SEM_MUDANCA" && regravado.id === avF.id, `${regravado.acao}`)

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
