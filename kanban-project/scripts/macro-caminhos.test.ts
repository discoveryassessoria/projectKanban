// scripts/macro-caminhos.test.ts
//
// CAMINHO A e CAMINHO B do macrofluxo — o desvio condicional depois da Análise.
//
//   A) Análise → requerRetificacao=true  → Retificação de Registros
//   B) Análise → requerRetificacao=false → pula as condicionais → Tradução Juramentada
//
// Prova que o motor RESOLVE as chaves canônicas, materializa a fase certa com o
// workflow publicado dela e não deixa fase ativa vazia. Só roda no banco de teste.

import { PrismaClient } from "@prisma/client"

let ok = 0
const falhas: string[] = []
const check = (n: string, c: boolean, e?: string) => { if (c) { ok++; console.log(`  ✅ ${n}`) } else { falhas.push(n); console.log(`  ❌ ${n}${e ? ` — ${e}` : ""}`) } }

const url = process.env.PRISMA_DATABASE_URL ?? ""
if (!/discovery_test/.test(url)) {
  console.log("Caminhos do macrofluxo — PULADO (sem banco de teste local)")
  process.exit(0)
}

const prisma = new PrismaClient()

// O macro OFICIAL do ALE-ADM, com as chaves CANÔNICAS (o estado corrigido em prod).
const FASES_MACRO = [
  { phaseKey: "genealogia", ordem: 1, required: true, conditional: false },
  { phaseKey: "emissao_documental", ordem: 2, required: true, conditional: false },
  { phaseKey: "analise_documental", ordem: 3, required: true, conditional: false },
  { phaseKey: "retificacao_registros", ordem: 4, required: false, conditional: true },
  { phaseKey: "emissao_documental_retificada", ordem: 5, required: false, conditional: true },
  { phaseKey: "traducao_juramentada", ordem: 6, required: true, conditional: false },
  { phaseKey: "apostilamento", ordem: 7, required: true, conditional: false },
]

async function main() {
  const { advance } = await import("../src/lib/motor/phase-advance")
  const { materializarExecucaoDaFase } = await import("../src/services/materializar-fase")

  await prisma.$executeRawUnsafe(
    'TRUNCATE "Processo","Arvore","Pessoa","Uniao","Documento","NecessidadeDocumental","NecessidadeDocumentalEvento","PhaseWorkflowInstance","PhaseWorkflowStepInstance","PhaseInternalWorkflow","PhaseInternalWorkflowStep","WorkflowEvento","DomainOutbox","Tarefa","MacroWorkflow","FaseMacro","AnaliseDocumental","PhaseAdvanceLog","LogAuditoria" RESTART IDENTITY CASCADE',
  )
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
  const tipo = await prisma.tipoProcessoNacionalidade.upsert({
    where: { code: "ALE-ADM-TEST" }, update: {},
    create: {
      code: "ALE-ADM-TEST", name: "Alemã (teste de caminhos)", countryKey: "alemanha", countryLabel: "Alemanha",
      nationalityKey: "alema", nationalityLabel: "Alemã", modalityKey: "administrativa",
      modalityLabel: "Administrativa", processFamily: "CIDADANIA", serviceNature: "PROCESSO",
    },
  })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: "Macro ALE canônico", versao: 1 } })
  for (const f of FASES_MACRO) {
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: f.phaseKey, label: f.phaseKey, ordem: f.ordem, required: f.required, conditional: f.conditional, versao: 1 } })
  }
  // Workflow Interno publicado para CADA chave canônica (escopo PROCESSO: 1 passo/fase).
  for (const f of FASES_MACRO) {
    const wf = await prisma.phaseInternalWorkflow.create({
      data: { wfUid: `all::${f.phaseKey}`, phaseKey: f.phaseKey, name: `WF ${f.phaseKey}`, tipoProcessoId: null, versao: 1 },
    })
    await prisma.phaseInternalWorkflowStep.create({
      data: { workflowId: wf.id, key: `passo_${f.phaseKey}`, label: `Passo ${f.phaseKey}`, ordem: 1, createsTask: true, required: true, owner: "equipe_documental", slaDays: 3, cardinalidade: "PROCESSO" },
    })
  }

  async function processoNaAnalise(nome: string, requerRetificacao: boolean) {
    const p = await prisma.processo.create({
      data: { nome, codigo: `T-${nome}`, faseAtualKey: "analise_documental", tipoProcessoMotorId: tipo.id, workflowRuntime: "v2" },
    })
    await materializarExecucaoDaFase({ processoId: p.id, fonte: "CADASTRO_EM_ANDAMENTO" })
    await prisma.analiseDocumental.create({ data: { processoId: p.id, requerRetificacao } })
    // conclui a Análise para liberar o gate
    await prisma.phaseWorkflowStepInstance.updateMany({
      where: { processoId: p.id, faseMacroKey: "analise_documental" },
      data: { status: "CONCLUIDO", completedAt: new Date() },
    })
    return p
  }

  async function conferirDestino(processoId: number, faseEsperada: string, rotulo: string) {
    const r = await advance(processoId, { origem: "teste-caminhos" })
    check(`${rotulo}: avanço aceito`, r.success === true, JSON.stringify(r))
    if (!r.success) return
    check(`${rotulo}: destino é ${faseEsperada}`, r.faseDestino === faseEsperada, r.faseDestino)
    check(`${rotulo}: sem rollback por phaseKey inexistente`, r.resultado === "AVANCADO")
    check(`${rotulo}: a fase foi MATERIALIZADA`, r.materializacao?.estado === "MATERIALIZADO", JSON.stringify(r.materializacao))
    const inst = await prisma.phaseWorkflowInstance.findUnique({
      where: { id: r.workflowInstanceId! },
      select: { faseMacroKey: true, status: true, workflowDefinitionId: true, steps: { select: { id: true, stepKey: true, tarefas: { select: { id: true } } } } },
    })
    check(`${rotulo}: instância na fase certa e ATIVA`, inst?.faseMacroKey === faseEsperada && inst?.status === "ATIVO")
    check(`${rotulo}: workflow publicado vinculado`, inst?.workflowDefinitionId != null)
    check(`${rotulo}: fase NÃO ficou ativa e vazia`, (inst?.steps.length ?? 0) > 0, String(inst?.steps.length))
    check(`${rotulo}: passo é o do workflow daquela fase`, inst!.steps.every((s) => s.stepKey === `passo_${faseEsperada}`), JSON.stringify(inst!.steps.map((s) => s.stepKey)))
    check(`${rotulo}: tarefa criada`, inst!.steps.every((s) => s.tarefas.length === 1))
  }

  // ── PARTE 15 — criação de macro a partir do CatalogoFase (seedDefaults) ────
  console.log("\nCriação de macro com seedDefaults — nasce canônico ou não nasce")
  for (const f of [
    { phaseKey: "genealogia", label: "Genealogia", ordemPadrao: 1, requiredPadrao: true, conditionalPadrao: false, slaDiasPadrao: 30 },
    { phaseKey: "analise_documental", label: "Análise Documental", ordemPadrao: 3, requiredPadrao: true, conditionalPadrao: false, slaDiasPadrao: 30 },
    { phaseKey: "retificacao_registros", label: "Retificação de Registros", ordemPadrao: 4, requiredPadrao: false, conditionalPadrao: true, slaDiasPadrao: 30 },
    { phaseKey: "traducao_juramentada", label: "Tradução Juramentada", ordemPadrao: 6, requiredPadrao: true, conditionalPadrao: false, slaDiasPadrao: 30 },
  ]) {
    await prisma.catalogoFase.upsert({ where: { phaseKey: f.phaseKey }, update: f, create: f })
  }
  // Roda o seed OFICIAL duas vezes: idempotente, não duplica.
  const { execSync } = await import("child_process")
  execSync("npx tsx prisma/seed-motor-1b.ts", { cwd: __dirname + "/..", env: process.env, stdio: "pipe" })
  const catalogo1 = await prisma.catalogoFase.count()
  execSync("npx tsx prisma/seed-motor-1b.ts", { cwd: __dirname + "/..", env: process.env, stdio: "pipe" })
  const catalogo2 = await prisma.catalogoFase.count()
  check("o seed oficial é idempotente (2 execuções, mesma contagem)", catalogo1 === catalogo2, `${catalogo1} → ${catalogo2}`)
  const catFinal = await prisma.catalogoFase.findMany({ select: { phaseKey: true } })
  check("o seed não deixou chave legada no CatalogoFase",
    !catFinal.some((c) => c.phaseKey === "traducao" || c.phaseKey === "retificacao"), JSON.stringify(catFinal.map((c) => c.phaseKey)))
  check("o CatalogoFase tem as canônicas", ["traducao_juramentada", "retificacao_registros"].every((k) => catFinal.some((c) => c.phaseKey === k)))

  // Macro novo montado como o endpoint monta (a partir do catálogo ativo).
  const tipoNovo = await prisma.tipoProcessoNacionalidade.upsert({
    where: { code: "NOVO-SEED" }, update: {},
    create: { code: "NOVO-SEED", name: "Macro novo (seedDefaults)", countryKey: "italia", countryLabel: "Itália", nationalityKey: "italiana", nationalityLabel: "Italiana", modalityKey: "administrativa", modalityLabel: "Administrativa", processFamily: "CIDADANIA", serviceNature: "PROCESSO" },
  })
  const catAtivo = await prisma.catalogoFase.findMany({ where: { ativo: true }, orderBy: { ordemPadrao: "asc" } })
  const macroNovo = await prisma.macroWorkflow.create({
    data: {
      tipoProcessoId: tipoNovo.id, name: "Macro novo", ativo: true,
      fases: { create: catAtivo.map((f, i) => ({ phaseKey: f.phaseKey, label: f.label, ordem: i + 1, required: f.requiredPadrao, conditional: f.conditionalPadrao, entryRule: i === 0 ? "process_created" : "previous_phase_completed", slaDays: f.slaDiasPadrao, showInKanban: true })) },
    },
    include: { fases: true },
  })
  const chavesNovas = macroNovo.fases.map((f) => f.phaseKey)
  check("macro novo recebe traducao_juramentada", chavesNovas.includes("traducao_juramentada"))
  check("macro novo recebe retificacao_registros", chavesNovas.includes("retificacao_registros"))
  check("macro novo NÃO recebe traducao", !chavesNovas.includes("traducao"))
  check("macro novo NÃO recebe retificacao", !chavesNovas.includes("retificacao"))
  check("macro novo sem duplicação", new Set(chavesNovas).size === chavesNovas.length)
  const { phaseKeyToFaseCode } = await import("../src/lib/process-stage/fases-catalog")
  check("toda fase do macro novo é canônica", chavesNovas.every((k) => phaseKeyToFaseCode(k) != null), JSON.stringify(chavesNovas))
  // remoção do macro temporário (mecanismo oficial de teste)
  await prisma.macroWorkflow.delete({ where: { id: macroNovo.id } })
  check("macro temporário removido", (await prisma.macroWorkflow.count({ where: { id: macroNovo.id } })) === 0)

  console.log("\nCAMINHO A — Análise → Retificação de Registros (requerRetificacao = true)")
  const pa = await processoNaAnalise("CAMA", true)
  const antesA = { passos: await prisma.phaseWorkflowStepInstance.count({ where: { processoId: pa.id } }), tarefas: await prisma.tarefa.count({ where: { processoId: pa.id } }) }
  await conferirDestino(pa.id, "retificacao_registros", "A")
  check("A: nenhuma obrigação anterior foi apagada",
    (await prisma.phaseWorkflowStepInstance.count({ where: { processoId: pa.id } })) > antesA.passos &&
    (await prisma.tarefa.count({ where: { processoId: pa.id } })) >= antesA.tarefas)

  console.log("\nCAMINHO B — Análise → Tradução Juramentada (requerRetificacao = false, pula condicionais)")
  const pb = await processoNaAnalise("CAMB", false)
  await conferirDestino(pb.id, "traducao_juramentada", "B")
  check("B: as fases condicionais NÃO foram materializadas",
    (await prisma.phaseWorkflowInstance.count({ where: { processoId: pb.id, faseMacroKey: { in: ["retificacao_registros", "emissao_documental_retificada"] } } })) === 0)
  check("B: e também não foram marcadas como concluídas",
    (await prisma.phaseWorkflowInstance.count({ where: { processoId: pb.id, status: "CONCLUIDO", faseMacroKey: { in: ["retificacao_registros", "emissao_documental_retificada"] } } })) === 0)

  console.log("\nMovimentação manual continua funcionando sobre as chaves canônicas")
  const { movePhaseManual } = await import("../src/lib/motor/phase-advance")
  const mv = await movePhaseManual(pb.id, {
    faseAlvo: "retificacao_registros", justificativa: "Abertura administrativa da retificação.",
    motivoCodigo: "OPERACAO_ADMINISTRATIVA", origem: "teste-caminhos",
  })
  check("move manual para retificacao_registros é aceito", mv.success === true, JSON.stringify(mv))
  check("e materializa a fase", mv.success && mv.materializacao?.estado === "MATERIALIZADO", JSON.stringify(mv.success ? mv.materializacao : null))
  const mv2 = await movePhaseManual(pb.id, {
    faseAlvo: "traducao_juramentada", justificativa: "Voltar à tradução.",
    motivoCodigo: "CORRECAO_DE_FASE", origem: "teste-caminhos",
  })
  check("move manual para traducao_juramentada é aceito", mv2.success === true, JSON.stringify(mv2))
  check("e cria o 2º ciclo materializado", mv2.success && mv2.ciclo === 2 && mv2.materializacao?.estado === "MATERIALIZADO", JSON.stringify(mv2.success ? { ciclo: mv2.ciclo, mat: mv2.materializacao?.estado } : null))

  console.log("\nChave LEGADA continua sendo recusada (nenhum alias foi introduzido)")
  const legado = await movePhaseManual(pb.id, { faseAlvo: "traducao", justificativa: "Tentativa com chave legada.", motivoCodigo: "CORRECAO_DE_FASE", origem: "teste-caminhos" })
  check("mover para 'traducao' é REJEITADO", legado.success === false && legado.code === "FASE_ALVO_INVALIDA", JSON.stringify(legado))
  const legado2 = await movePhaseManual(pb.id, { faseAlvo: "retificacao", justificativa: "Tentativa com chave legada.", motivoCodigo: "CORRECAO_DE_FASE", origem: "teste-caminhos" })
  check("mover para 'retificacao' é REJEITADO", legado2.success === false && legado2.code === "FASE_ALVO_INVALIDA", JSON.stringify(legado2))

  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { console.log("\nFalhas:"); for (const f of falhas) console.log(`  · ${f}`) }
  await prisma.$disconnect()
  process.exit(falhas.length === 0 ? 0 : 1)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
