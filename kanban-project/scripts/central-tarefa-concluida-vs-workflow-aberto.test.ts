// scripts/central-tarefa-concluida-vs-workflow-aberto.test.ts
// ============================================================================
// UM WORKFLOW ABERTO (0/4, 1/4...) NUNCA PODE APRESENTAR O PRAZO/STATUS DA
// TAREFA COMO "CONCLUÍDA" — reprodução ponta a ponta pedida explicitamente
// (mandato "correção definitiva do modelo temporal", 19-20/09/2026,
// continuação — item 1 da lista de fechamento).
//
// ─── O CENÁRIO REAL QUE PODERIA PRODUZIR ISSO ──────────────────────────────
// Investigação confirmou (fork de auditoria, 19/09/2026): a ÚNICA forma de um
// documento acumular DUAS linhas de Tarefa é a REEXECUÇÃO
// (`garantirTarefaDePasso`, ramo "jaEncerrada" — src/services/passo-tarefa.ts)
// — quando a mesma unidade (documento) já tem uma Tarefa CONCLUÍDA de uma
// visita anterior e uma NOVA visita (nova `PhaseWorkflowInstance`) precisa de
// trabalho de novo. A Tarefa antiga fica CONCLUIDO_RECEBIDO; nasce uma
// SEGUNDA Tarefa, chaveada `|reexec<novaInstancia>`, para a visita nova.
//
// A pergunta que este teste responde: quando isso acontece, a projeção que
// alimenta a Central Operacional (`resolveDocumentOperationalProjection`)
// continua mostrando o workflow aberto (progresso parcial) com a Tarefa
// CORRETA (a nova, não concluída) — nunca a antiga.
//
// ─── A GARANTIA ESTRUTURAL (não só o cenário feliz) ────────────────────────
// `tarefasVivasDasUnidades` (lib/operacional/identidade-da-tarefa.ts) filtra
// `statusTarefa NOT IN [CONCLUIDO_RECEBIDO, CONCLUIDO_NAO_POSSUI, CANCELADA,
// SUPERSEDIDA]` no PRÓPRIO WHERE da consulta — não como desempate. Uma Tarefa
// genuinamente concluída é EXCLUÍDA do resultado antes mesmo de chegar à
// comparação de ciclo; ela estruturalmente não pode voltar como "a tarefa
// canônica" deste documento, non importa quantas visitas/ciclos existam.
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/central-tarefa-concluida-vs-workflow-aberto.test.ts
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { resolveDocumentOperationalProjection } from "@/src/lib/process-stage/document-operational-projection"

const MARCA = "CENTDIV"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: `${MARCA} ` } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { descricao: { startsWith: MARCA } } })
  const arvIds = [...new Set(procs.map((p) => p.arvoreId).filter((x): x is number => x != null))]
  await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arvIds } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: `${MARCA}_fase` } })
}

async function main() {
  exigirBancoDeTeste("reproduz Tarefa CONCLUÍDA + workflow aberto, prova que a Central nunca mistura as duas")
  await limpar()
  console.log("CENTRAL OPERACIONAL — TAREFA CONCLUÍDA NUNCA APARECE COM WORKFLOW ABERTO\n")

  await prisma.catalogoFase.upsert({
    where: { phaseKey: `${MARCA}_fase` },
    update: {},
    create: { phaseKey: `${MARCA}_fase`, label: "Fase de Teste Divergência", escopo: "DOCUMENTO", ordemPadrao: 99, efeitosPermitidos: ["REGISTER_ONLY"] },
  })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const pessoa = await prisma.pessoa.create({ data: { nome: "Fulano", sobrenome: "Divergência", arvoreId: arv.id }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} processo`, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: `${MARCA}_fase` },
    select: { id: true },
  })
  const doc = await prisma.documento.create({
    data: { pessoaId: pessoa.id, descricao: `${MARCA} Certidão`, status: "PENDENTE" },
    select: { id: true },
  })

  // ══════════════════════════════════════════════════════════════
  console.log("1) VISITA ANTIGA — concluída de verdade (ciclo 1)")
  // ══════════════════════════════════════════════════════════════
  const instAntiga = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: `${MARCA}_fase`, ciclo: 1, status: "CONCLUIDO", chaveIdempotencia: `${MARCA}-i1` },
    select: { id: true },
  })
  const passoAntigo = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: instAntiga.id, processoId: proc.id, faseMacroKey: `${MARCA}_fase`, ciclo: 1,
      stepKey: `${MARCA}_passo_unico`, ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
      status: "CONCLUIDO", dependeDeStepKeys: [] as never, documentoId: doc.id,
      startedAt: new Date(), completedAt: new Date(), chaveIdempotencia: `${MARCA}-p1`,
    },
    select: { id: true },
  })
  const tarefaAntiga = await prisma.tarefa.create({
    data: {
      titulo: `${MARCA} tarefa antiga (concluída)`, processoId: proc.id, documentoId: doc.id,
      // MESMO padrão de `aplicarTarefa` ao concluir: workflowStepInstanceId
      // limpo — a Tarefa concluída não aponta mais pra um passo "atual".
      workflowStepInstanceId: null, workflowInstanceId: instAntiga.id,
      chaveIdempotencia: `${MARCA}-unidade-doc${doc.id}`, statusTarefa: "CONCLUIDO_RECEBIDO",
      concluida: true, dataConclusao: new Date(),
    },
    select: { id: true, statusTarefa: true },
  })
  console.log(`  passo antigo #${passoAntigo.id} CONCLUIDO, tarefa antiga #${tarefaAntiga.id} ${tarefaAntiga.statusTarefa}`)

  // ══════════════════════════════════════════════════════════════
  console.log("\n2) VISITA NOVA — reexecução: 4 passos, só 1 concluído (25%)")
  // ══════════════════════════════════════════════════════════════
  const instNova = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: `${MARCA}_fase`, ciclo: 2, status: "ATIVO", chaveIdempotencia: `${MARCA}-i2` },
    select: { id: true },
  })
  const statusPorOrdem = ["CONCLUIDO", "DISPONIVEL", "PENDENTE", "PENDENTE"]
  const passosNovos: number[] = []
  for (let i = 0; i < 4; i++) {
    const p = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: instNova.id, processoId: proc.id, faseMacroKey: `${MARCA}_fase`, ciclo: 2,
        stepKey: `${MARCA}_passo_${i + 1}`, ordem: i + 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
        status: statusPorOrdem[i] as never, dependeDeStepKeys: [] as never, documentoId: doc.id,
        completedAt: statusPorOrdem[i] === "CONCLUIDO" ? new Date() : null,
        chaveIdempotencia: `${MARCA}-p2-${i + 1}`,
      },
      select: { id: true },
    })
    passosNovos.push(p.id)
  }
  // A SEGUNDA TAREFA — a reexecução, chaveada como `garantirTarefaDePasso`
  // (src/services/passo-tarefa.ts) realmente chaveia: `${chaveBase}|reexec${workflowInstanceId}`.
  const tarefaNova = await prisma.tarefa.create({
    data: {
      titulo: `${MARCA} tarefa nova (reexecução)`, processoId: proc.id, documentoId: doc.id,
      workflowStepInstanceId: passosNovos[1], workflowInstanceId: instNova.id,
      chaveIdempotencia: `${MARCA}-unidade-doc${doc.id}|reexec${instNova.id}`, statusTarefa: "EM_ANDAMENTO",
      dataInicio: new Date(),
    },
    select: { id: true, statusTarefa: true },
  })
  console.log(`  4 passos novos (1 concluído, 3 pendentes), tarefa nova #${tarefaNova.id} ${tarefaNova.statusTarefa}`)

  // ══════════════════════════════════════════════════════════════
  console.log("\n3) A PROJEÇÃO REAL — resolveDocumentOperationalProjection(doc)")
  // ══════════════════════════════════════════════════════════════
  const resultado = await resolveDocumentOperationalProjection(doc.id)
  check("a projeção resolveu (found=true)", resultado.found === true)
  // `DocumentProjectionResult.workflow` é `unknown` no tipo público — o valor
  // real, em runtime, é o `WorkflowV2Shape` completo (com `workflowInstanceId`/
  // `ciclo`), só re-tipado internamente como `WfShape` (mais estreito) no
  // resolver. Aqui é exatamente isso que este teste quer inspecionar.
  const wf = resultado.workflow as {
    steps?: unknown[]; progress?: number; workflowInstanceId?: number | null; ciclo?: number | null
  } | null
  const proj = resultado.projection

  check("o workflow tem 4 passos (a visita NOVA, não a antiga com 1)", wf?.steps?.length === 4, String(wf?.steps?.length))
  check("o progresso é 25% (1 de 4) — nunca 100%, nunca a visita antiga", wf?.progress === 25, String(wf?.progress))
  // `projection.workflowInstanceId` é `String(wf.id)`, e `wf.id` é a chave
  // SINTÉTICA do shape legado ("v2-doc-fase-cN"), não o id numérico da
  // instância — o campo numérico real é `wf.workflowInstanceId`.
  check("workflowInstanceId numérico do workflow é o da visita NOVA, não da antiga",
    wf?.workflowInstanceId === instNova.id, `${wf?.workflowInstanceId} (esperado ${instNova.id}, antiga era ${instAntiga.id})`)
  check("e o ciclo é 2 (a visita nova), nunca 1",
    wf?.ciclo === 2, String(wf?.ciclo))

  check("a Tarefa canônica é a NOVA (#" + tarefaNova.id + "), nunca a antiga concluída",
    proj?.tarefa?.taskId === tarefaNova.id, `taskId=${proj?.tarefa?.taskId}`)
  check("o statusTarefa da projeção é EM_ANDAMENTO, nunca CONCLUIDO_RECEBIDO",
    proj?.tarefa?.statusTarefa === "EM_ANDAMENTO", proj?.tarefa?.statusTarefa)
  check("o rótulo do prazo NÃO diz 'Concluída' — é exatamente o bug relatado que isto prova ausente",
    !(proj?.tarefa?.rotuloDoPrazo ?? "").startsWith("Concluída"), proj?.tarefa?.rotuloDoPrazo ?? "(sem tarefa)")

  // ══════════════════════════════════════════════════════════════
  console.log("\n4) A GARANTIA ESTRUTURAL — a tarefa antiga nunca é sequer candidata")
  // ══════════════════════════════════════════════════════════════
  const { tarefasVivasDasUnidades, chaveDaUnidade } = await import("@/lib/operacional/identidade-da-tarefa")
  const unidade = { processoId: proc.id, documentoId: doc.id, ciclo: 1 } // ciclo ERRADO de propósito — igual ao bug documentado
  const vivas = await tarefasVivasDasUnidades(prisma, [unidade])
  const achada = vivas.get(chaveDaUnidade(unidade))
  check("mesmo pedindo ciclo=1 (o valor hardcoded no resolver), a busca devolve a tarefa VIVA (nova), nunca a concluída",
    achada?.id === tarefaNova.id, `achada=#${achada?.id}`)
  check("e o status dela não é nenhum dos 4 terminais",
    !!achada && !["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"].includes(achada.statusTarefa))

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
