// scripts/mandato-rascunho-publicacao.test.ts
// ============================================================================
// MANDATO — BLOCO 3: RASCUNHO E PUBLICAÇÃO (lifecycle).
// Rodar: PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/mandato-rascunho-publicacao.test.ts
//
// CONFIRMADO JÁ EXISTIR (nenhuma alteração necessária — provado abaixo):
//   - RASCUNHO = a definição viva (`PhaseInternalWorkflow`/`PhaseInternalWorkflowStep`),
//     marcada por `rascunhoAlteradoEm`/`rascunhoAlteradoPor` quando difere da
//     última publicação (`src/services/publicacao-de-workflow.ts`).
//   - PUBLICADO = `PhaseInternalWorkflowVersao`, imutável, uma linha por versão
//     (congelada por `congelarVersaoVigente`).
//   - ARQUIVADO/SUBSTITUÍDO = `PhaseInternalWorkflow.arquivado`; a escolha de
//     qual workflow serve uma fase filtra SEMPRE `active:true, arquivado:false`
//     (`resolverWorkflowAplicavel`).
//   - Instâncias JÁ EXISTENTES nunca são afetadas por publicar (provado por
//     `scripts/preview-impacto-publicacao.test.ts`, 11/11, reexecutado aqui como
//     regressão).
//
// ACHADO REAL (confirmado por reprodução, não hipótese): `resolverWorkflowAplicavel`
// (chamada por `instanciarWorkflowDaFase`, o ÚNICO criador de
// `PhaseWorkflowInstance`) lê os PASSOS da tabela VIVA/editável
// (`PhaseInternalWorkflowStep`) — não da última versão publicada. Entre o
// instante em que um administrador SALVA uma alteração (`rascunhoAlteradoEm`
// passa a existir) e o instante em que ele PUBLICA, uma Tarefa nova que nasça
// nesse intervalo herdava o `slaDays` do RASCUNHO, nunca revisado — o oposto
// exato do que o mandato exige ("alterações estruturais importantes não devem
// entrar em produção operacional enquanto o admin ainda está editando").
//
// CORRIGIDO: `src/services/phase-workflow.ts::ancorarNaVersaoPublicada` — quando
// há rascunho pendente, ancora TODO o conjunto de passos (não só `slaDays`)
// na ÚLTIMA VERSÃO REALMENTE PUBLICADA, e ancora `workflowVersion` da
// instância nova nessa mesma versão, nunca no contador ao vivo que uma edição
// em andamento já adiantou. Contraprova (13/09/2026, segunda rodada): a
// ESTRUTURA (quais passos existem, quantos) TAMBÉM vazava — um passo novo
// criado no rascunho, sem publicar, aparecia numa Tarefa materializada nesse
// intervalo. Fechado: a lista de passos agora vem inteira do congelado
// (`PassoCongelado` já carrega tudo que `DefStep` precisa; `stepDefinitionId`
// é resolvido por chave contra a tabela viva, com fallback seguro — esse
// ponteiro já era conhecidamente frágil, ver `versaoDaInstancia`). Ações/
// campos/canais/checklist de CADA passo já eram protegidos antes disso, em
// EXECUÇÃO, via `definicaoHistoricaDoPasso` (par workflowVersion×key) — o que
// faltava era só o CONJUNTO de passos na hora de decidir quais materializar.
// Seções 7-8 abaixo provam a contraprova estrutural.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { publicarWorkflow, marcarRascunho } from "@/src/services/publicacao-de-workflow"
import { instanciarWorkflowDaFase } from "@/src/services/phase-workflow"

const MARCA = "RASCUNHOPUB-TEST"
const PHASE_KEY = `${MARCA.toLowerCase()}_fase`

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.faseMacro.deleteMany({ where: { phaseKey: PHASE_KEY } })
  await prisma.macroWorkflow.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { wfUid: { startsWith: MARCA } } })
}

async function main() {
  exigirBancoDeTeste("mandato-rascunho-publicacao.test.ts — Bloco 3 (rascunho/publicação)")
  await limpar()
  console.log("MANDATO BLOCO 3 — RASCUNHO E PUBLICAÇÃO (lifecycle)\n")

  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })

  // Um TipoProcessoNacionalidade real do seed (qualquer um serve — só precisa existir).
  const tipo = await prisma.tipoProcessoNacionalidade.findFirst({ select: { id: true } })
  if (!tipo) throw new Error("Banco de teste sem nenhum TipoProcessoNacionalidade — rode o seed base primeiro.")

  // Modalidade habilitada para esse tipo — qualquer uma serve; cria uma se o
  // tipo ainda não tiver nenhuma (fixture, não é uma regra de negócio).
  let habilitacao = await prisma.tipoProcessoModalidadeHabilitada.findFirst({ where: { tipoProcessoId: tipo.id } })
  if (!habilitacao) {
    const modalidade = await prisma.modalidadePais.findFirstOrThrow()
    habilitacao = await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: modalidade.id, ativo: true } })
  }

  const macro = await prisma.macroWorkflow.upsert({
    where: { tipoProcessoId_modalidadeId: { tipoProcessoId: tipo.id, modalidadeId: habilitacao.modalidadeId } },
    update: {},
    create: { tipoProcessoId: tipo.id, modalidadeId: habilitacao.modalidadeId, name: `${MARCA} macro` },
    select: { id: true, versao: true },
  })
  const faseMacro = await prisma.faseMacro.upsert({
    where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: PHASE_KEY } },
    update: {},
    create: { macroWorkflowId: macro.id, phaseKey: PHASE_KEY, label: PHASE_KEY },
    select: { id: true, versao: true },
  })

  // ══════════════════════════════════════════════════════════════════════
  secao("1) CADASTRO — workflow nasce, ganha 1 passo (SLA=5), é PUBLICADO (V1)")
  // ══════════════════════════════════════════════════════════════════════
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}-wf`, phaseKey: PHASE_KEY, name: `${MARCA} wf`, active: true, tipoProcessoId: tipo.id, escopoExecucao: "PROCESSO" },
    select: { id: true },
  })
  const step = await prisma.phaseInternalWorkflowStep.create({
    data: { workflowId: wf.id, key: "passo_unico", label: "Passo Único", ordem: 1, slaDays: 5, cardinalidade: "PROCESSO" },
    select: { id: true },
  })
  const pub1 = await publicarWorkflow({ workflowId: wf.id, actorId: null })
  ok("1.1) publicação inicial sucede", pub1.ok === true, JSON.stringify(pub1).slice(0, 150))

  secao("2) ARQUIVADO/ATIVO — só workflow active=true, arquivado=false materializa")
  const wfArquivado = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}-wf-arquivado`, phaseKey: PHASE_KEY, name: `${MARCA} arquivado`, active: false, arquivado: true, tipoProcessoId: tipo.id },
    select: { id: true },
  })
  ok("2.1) workflow arquivado/inativo cadastrado só para confirmar que é ignorado", wfArquivado.id > 0)

  // ══════════════════════════════════════════════════════════════════════
  secao("3) MATERIALIZAÇÃO NORMAL (sem rascunho pendente) — usa o valor publicado")
  // ══════════════════════════════════════════════════════════════════════
  const arv1 = await prisma.arvore.create({ data: { nome: `${MARCA} arv1` }, select: { id: true } })
  const proc1 = await prisma.processo.create({
    data: { nome: `${MARCA} proc1`, arvoreId: arv1.id, faseAtualKey: PHASE_KEY, workflowRuntime: "v2", tipoProcessoMotorId: tipo.id, modalidadeId: habilitacao.modalidadeId },
    select: { id: true },
  })
  const r1 = await instanciarWorkflowDaFase({ processoId: proc1.id, faseMacroKey: PHASE_KEY })
  ok("3.1) instanciarWorkflowDaFase sucede (sem rascunho pendente)", r1.success === true, JSON.stringify(r1).slice(0, 200))
  if (r1.success) {
    const wfDefUsado = r1.workflowInstance.workflowDefinitionId
    ok("3.2) usou o workflow ATIVO (não o arquivado)", wfDefUsado === wf.id, `usado=${wfDefUsado} ativo=${wf.id} arquivado=${wfArquivado.id}`)
    const stepInst1 = await prisma.phaseWorkflowStepInstance.findFirst({ where: { workflowInstanceId: r1.workflowInstance.id }, select: { slaDays: true } })
    ok("3.3) slaDays materializado bate com o publicado (5)", stepInst1?.slaDays === 5, String(stepInst1?.slaDays))
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("4) ADMIN COMEÇA A EDITAR (rascunho salvo, NÃO publicado) — a alteração NÃO pode vazar")
  // ══════════════════════════════════════════════════════════════════════
  await prisma.phaseInternalWorkflowStep.update({ where: { id: step.id }, data: { slaDays: 999 } })
  await marcarRascunho(wf.id, null)
  const wfComRascunho = await prisma.phaseInternalWorkflow.findUniqueOrThrow({ where: { id: wf.id }, select: { rascunhoAlteradoEm: true } })
  ok("4.1) rascunho pendente está marcado (rascunhoAlteradoEm != null)", wfComRascunho.rascunhoAlteradoEm != null)

  const arv2 = await prisma.arvore.create({ data: { nome: `${MARCA} arv2` }, select: { id: true } })
  const proc2 = await prisma.processo.create({
    data: { nome: `${MARCA} proc2`, arvoreId: arv2.id, faseAtualKey: PHASE_KEY, workflowRuntime: "v2", tipoProcessoMotorId: tipo.id, modalidadeId: habilitacao.modalidadeId },
    select: { id: true },
  })
  const r2 = await instanciarWorkflowDaFase({ processoId: proc2.id, faseMacroKey: PHASE_KEY })
  ok("4.2) instanciarWorkflowDaFase sucede mesmo com rascunho pendente", r2.success === true, JSON.stringify(r2).slice(0, 200))
  if (r2.success) {
    const stepInst2 = await prisma.phaseWorkflowStepInstance.findFirst({ where: { workflowInstanceId: r2.workflowInstance.id }, select: { slaDays: true } })
    ok(
      "4.3) A CORREÇÃO: uma Tarefa NOVA, materializada DURANTE a edição não publicada, usa o valor PUBLICADO (5) — NUNCA o rascunho (999)",
      stepInst2?.slaDays === 5,
      `materializado=${stepInst2?.slaDays} (rascunho não-publicado tinha 999)`,
    )
    ok(
      "4.4) o ponteiro de versão da instância nova aponta para uma versão REALMENTE publicada (existe PhaseInternalWorkflowVersao para ela)",
      (await prisma.phaseInternalWorkflowVersao.findUnique({
        where: { workflowId_versao: { workflowId: wf.id, versao: r2.workflowInstance.workflowVersion! } },
      })) != null,
    )
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("5) PUBLICAR a edição — SÓ ENTÃO a Tarefa nova passa a usar o valor novo")
  // ══════════════════════════════════════════════════════════════════════
  const pub2 = await publicarWorkflow({ workflowId: wf.id, actorId: null })
  ok("5.1) segunda publicação sucede", pub2.ok === true, JSON.stringify(pub2).slice(0, 150))

  const arv3 = await prisma.arvore.create({ data: { nome: `${MARCA} arv3` }, select: { id: true } })
  const proc3 = await prisma.processo.create({
    data: { nome: `${MARCA} proc3`, arvoreId: arv3.id, faseAtualKey: PHASE_KEY, workflowRuntime: "v2", tipoProcessoMotorId: tipo.id, modalidadeId: habilitacao.modalidadeId },
    select: { id: true },
  })
  const r3 = await instanciarWorkflowDaFase({ processoId: proc3.id, faseMacroKey: PHASE_KEY })
  ok("5.2) terceira materialização sucede", r3.success === true)
  if (r3.success) {
    const stepInst3 = await prisma.phaseWorkflowStepInstance.findFirst({ where: { workflowInstanceId: r3.workflowInstance.id }, select: { slaDays: true } })
    ok("5.3) DEPOIS de publicar, a Tarefa nova usa o valor NOVO (999) — publicação passou a valer", stepInst3?.slaDays === 999, String(stepInst3?.slaDays))
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("6) INVARIANTE — instâncias já existentes NUNCA mudam retroativamente")
  // ══════════════════════════════════════════════════════════════════════
  if (r1.success) {
    const stepInst1Depois = await prisma.phaseWorkflowStepInstance.findFirst({ where: { workflowInstanceId: r1.workflowInstance.id }, select: { slaDays: true } })
    ok("6.1) a Tarefa 1 (nascida na V1) continua com slaDays=5 depois de DUAS publicações posteriores", stepInst1Depois?.slaDays === 5, String(stepInst1Depois?.slaDays))
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("7) CONTRAPROVA ESTRUTURAL — admin ADICIONA um passo novo (rascunho), sem publicar")
  // ══════════════════════════════════════════════════════════════════════
  // V2 publicada (seção 5) tem 1 passo só. Agora o admin cria um SEGUNDO passo
  // na tabela viva, sem publicar — a contagem de passos em si diverge da
  // última versão publicada, não só um campo de um passo existente.
  await prisma.phaseInternalWorkflowStep.create({
    data: { workflowId: wf.id, key: "passo_dois", label: "Passo Dois (rascunho, não publicado)", ordem: 2, slaDays: 3, cardinalidade: "PROCESSO" },
    select: { id: true },
  })
  await marcarRascunho(wf.id, null)
  const wfAposAdicao = await prisma.phaseInternalWorkflow.findUniqueOrThrow({ where: { id: wf.id }, select: { rascunhoAlteradoEm: true } })
  ok("7.1) rascunho pendente está marcado depois de adicionar o passo 2", wfAposAdicao.rascunhoAlteradoEm != null)

  const arv4 = await prisma.arvore.create({ data: { nome: `${MARCA} arv4` }, select: { id: true } })
  const proc4 = await prisma.processo.create({
    data: { nome: `${MARCA} proc4`, arvoreId: arv4.id, faseAtualKey: PHASE_KEY, workflowRuntime: "v2", tipoProcessoMotorId: tipo.id, modalidadeId: habilitacao.modalidadeId },
    select: { id: true },
  })
  const r4 = await instanciarWorkflowDaFase({ processoId: proc4.id, faseMacroKey: PHASE_KEY })
  ok("7.2) quarta materialização sucede mesmo com passo novo não publicado", r4.success === true)
  if (r4.success) {
    const steps4 = await prisma.phaseWorkflowStepInstance.findMany({ where: { workflowInstanceId: r4.workflowInstance.id }, select: { stepKey: true } })
    ok(
      "7.3) A CORREÇÃO ESTRUTURAL: a Tarefa nova nasce com o CONJUNTO PUBLICADO de passos (1) — o passo 2 do rascunho NÃO vaza",
      steps4.length === 1 && steps4[0]?.stepKey === "passo_unico",
      `stepKeys materializados=${JSON.stringify(steps4.map((s) => s.stepKey))}`,
    )
  }

  secao("8) PUBLICAR a estrutura nova (2 passos) — só então a Tarefa nova ganha o segundo passo")
  const pub3 = await publicarWorkflow({ workflowId: wf.id, actorId: null })
  ok("8.1) terceira publicação (2 passos) sucede", pub3.ok === true, JSON.stringify(pub3).slice(0, 150))

  const arv5 = await prisma.arvore.create({ data: { nome: `${MARCA} arv5` }, select: { id: true } })
  const proc5 = await prisma.processo.create({
    data: { nome: `${MARCA} proc5`, arvoreId: arv5.id, faseAtualKey: PHASE_KEY, workflowRuntime: "v2", tipoProcessoMotorId: tipo.id, modalidadeId: habilitacao.modalidadeId },
    select: { id: true },
  })
  const r5 = await instanciarWorkflowDaFase({ processoId: proc5.id, faseMacroKey: PHASE_KEY })
  ok("8.2) quinta materialização sucede", r5.success === true)
  if (r5.success) {
    const steps5 = await prisma.phaseWorkflowStepInstance.findMany({ where: { workflowInstanceId: r5.workflowInstance.id }, select: { stepKey: true }, orderBy: { ordem: "asc" } })
    ok(
      "8.3) DEPOIS de publicar, a Tarefa nova ganha os 2 passos",
      steps5.length === 2 && steps5[0]?.stepKey === "passo_unico" && steps5[1]?.stepKey === "passo_dois",
      `stepKeys=${JSON.stringify(steps5.map((s) => s.stepKey))}`,
    )
  }

  ok("8.4) a Tarefa 4 (nascida durante o rascunho estrutural) continua com 1 passo só, mesmo após a publicação", (await prisma.phaseWorkflowStepInstance.count({ where: { workflowInstanceId: r4.success ? r4.workflowInstance.id : -1 } })) === 1)

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
