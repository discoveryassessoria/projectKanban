// scripts/motor-prazo-ancoragem-subtarefas.test.ts
// ============================================================================
// MOTOR DE PRAZO/ACOMPANHAMENTO/COBRANÇA — FONTE DA VERDADE = VERSÃO PUBLICADA
// (mandato 25/09/2026, acréscimo à Etapa 2).
// Rodar: PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//        DIRECT_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//        npx tsx scripts/motor-prazo-ancoragem-subtarefas.test.ts
//
// REPRODUZ O BUG REAL DE PRODUÇÃO (workflow 12, "Emissão Documental"): o
// editor da Biblioteca salva rascunho direto na tabela viva
// (`StepSubtaskDefinition`), e uma publicação SEGUINTE pode congelar um
// snapshot correto (fonte real ainda não identificada — ver relatório
// separado) MESMO com a tabela viva vazia. `resolverWorkflowAplicavel` lia
// essa tabela viva para decidir os STEPS a materializar — as SUBTAREFAS,
// confirmado por leitura de código, já eram 100% via snapshot
// (`subtarefasDaEtapa` → `definicaoHistoricaDoPasso` → `versaoDaInstancia` →
// `lerVersaoPublicada`, nunca a tabela viva). Este teste prova as duas
// pernas: (1) o STEP nasce ancorado na versão publicada mesmo com rascunho
// pendente — cobertura NOVA que `mandato-rascunho-publicacao.test.ts` não
// tinha (aquele teste não usa subtarefas); (2) as SUBTAREFAS da instância
// nova continuam corretas mesmo com a tabela viva zerada, provando que a
// leitura de subtarefas nunca dependeu da tabela viva — só do par
// (workflowVersion, stepKey) que a instância já registra.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { publicarWorkflow, marcarRascunho } from "@/src/services/publicacao-de-workflow"
import { instanciarWorkflowDaFase } from "@/src/services/phase-workflow"
import { subtarefasDaEtapa } from "@/src/services/subtarefas-da-etapa"

const MARCA = "MOTORPRAZO-ANCORA"
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
  await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: { in: ids } } } })
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
  exigirBancoDeTeste("motor-prazo-ancoragem-subtarefas.test.ts")
  await limpar()
  console.log("MOTOR DE PRAZO — FONTE DA VERDADE = VERSÃO PUBLICADA\n")

  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })

  const tipo = await prisma.tipoProcessoNacionalidade.findFirst({ select: { id: true } })
  if (!tipo) throw new Error("Banco de teste sem nenhum TipoProcessoNacionalidade — rode o seed base primeiro.")
  let habilitacao = await prisma.tipoProcessoModalidadeHabilitada.findFirst({ where: { tipoProcessoId: tipo.id } })
  if (!habilitacao) {
    const modalidade = await prisma.modalidadePais.findFirstOrThrow()
    habilitacao = await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: modalidade.id, ativo: true } })
  }
  const macro = await prisma.macroWorkflow.upsert({
    where: { tipoProcessoId_modalidadeId: { tipoProcessoId: tipo.id, modalidadeId: habilitacao.modalidadeId } },
    update: {}, create: { tipoProcessoId: tipo.id, modalidadeId: habilitacao.modalidadeId, name: `${MARCA} macro` },
    select: { id: true },
  })
  await prisma.faseMacro.upsert({
    where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: PHASE_KEY } },
    update: {}, create: { macroWorkflowId: macro.id, phaseKey: PHASE_KEY, label: PHASE_KEY },
    select: { id: true },
  })

  // ══════════════════════════════════════════════════════════════════════
  secao("1) CADASTRO — 1 Step ('solicitar_certidao') com 4 subtarefas, como o cadastro real de Emissão Documental (25/09/2026)")
  // ══════════════════════════════════════════════════════════════════════
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}-wf`, phaseKey: PHASE_KEY, name: `${MARCA} wf`, active: true, tipoProcessoId: tipo.id, escopoExecucao: "PROCESSO" },
    select: { id: true },
  })
  const step = await prisma.phaseInternalWorkflowStep.create({
    data: {
      workflowId: wf.id, key: "solicitar_certidao", label: "Solicitar certidão", ordem: 1,
      slaDays: 0, cardinalidade: "PROCESSO", diasParaIniciar: 2, diasAposCobranca: 1, escalarApos: 2,
    },
    select: { id: true },
  })
  const SUBTAREFAS = [
    { key: "enviar_requerimento_cartorio", label: "Enviar requerimento ao cartório", ordem: 0, esperaExternaAoLiberar: false, dependeDe: [] as string[] },
    { key: "receber_confirmacao_pedido", label: "Receber confirmação do pedido", ordem: 1, esperaExternaAoLiberar: true, acompanhamentoAtivo: true, acompanhamentoPrimeiroDias: 1, dependeDe: ["enviar_requerimento_cartorio"] },
    { key: "receber_certidao", label: "Receber certidão", ordem: 2, esperaExternaAoLiberar: true, acompanhamentoAtivo: true, acompanhamentoPrimeiroDias: 7, definePrazoDaTarefa: true, prazoDaTarefaDias: 10, dependeDe: ["receber_confirmacao_pedido"] },
    { key: "conferir_validar_certidao", label: "Conferir e validar certidão", ordem: 3, esperaExternaAoLiberar: false, dependeDe: ["receber_certidao"] },
  ]
  for (const s of SUBTAREFAS) {
    const criada = await prisma.stepSubtaskDefinition.create({
      data: {
        stepId: step.id, key: s.key, label: s.label, ordem: s.ordem,
        esperaExternaAoLiberar: s.esperaExternaAoLiberar,
        acompanhamentoAtivo: s.acompanhamentoAtivo ?? false,
        acompanhamentoPrimeiroDias: s.acompanhamentoPrimeiroDias ?? null,
        definePrazoDaTarefa: s.definePrazoDaTarefa ?? false,
        prazoDaTarefaDias: s.prazoDaTarefaDias ?? null,
        dependeDe: s.dependeDe,
      },
      select: { id: true },
    })
    // TODA subtarefa precisa de pelo menos 1 ação pra publicar (regra do
    // validador — "SUBTAREFA_SEM_ACAO") — mesma "concluir"/COMPLETE_STEP
    // que o cadastro real de produção usa (confirmado no snapshot v18/v20).
    await prisma.stepAction.create({
      data: { stepId: step.id, subtaskId: criada.id, key: "concluir", label: "Concluir", ordem: 1, effectKey: "COMPLETE_STEP" },
    })
  }
  // `pularCompetenciaDeEfeito`: a fase sintética deste teste não está no
  // Catálogo de Fases real — sem isto, "COMPLETE_STEP" seria rejeitado por
  // "fora de competência" (checagem que só faz sentido pra fases reais).
  const pub1 = await publicarWorkflow({ workflowId: wf.id, actorId: null, pularCompetenciaDeEfeito: true })
  ok("1.1) publicação com 1 step + 4 subtarefas sucede", pub1.ok === true, JSON.stringify(pub1).slice(0, 150))

  // ══════════════════════════════════════════════════════════════════════
  secao("2) REPRODUZ O BUG: rascunho zera as subtarefas na tabela VIVA, sem publicar")
  // ══════════════════════════════════════════════════════════════════════
  await prisma.stepSubtaskDefinition.deleteMany({ where: { stepId: step.id } })
  await marcarRascunho(wf.id, null)
  const contagemViva = await prisma.stepSubtaskDefinition.count({ where: { stepId: step.id } })
  ok("2.1) tabela viva está zerada (reproduz o achado real de produção)", contagemViva === 0, `subtarefas na tabela viva: ${contagemViva}`)
  const wfRascunho = await prisma.phaseInternalWorkflow.findUniqueOrThrow({ where: { id: wf.id }, select: { rascunhoAlteradoEm: true } })
  ok("2.2) rascunho pendente está marcado", wfRascunho.rascunhoAlteradoEm != null)

  // ══════════════════════════════════════════════════════════════════════
  secao("3) MATERIALIZA UMA TAREFA NOVA COM A TABELA VIVA ZERADA — deve nascer completa mesmo assim")
  // ══════════════════════════════════════════════════════════════════════
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} proc`, arvoreId: arv.id, faseAtualKey: PHASE_KEY, workflowRuntime: "v2", tipoProcessoMotorId: tipo.id, modalidadeId: habilitacao.modalidadeId },
    select: { id: true },
  })
  const r = await instanciarWorkflowDaFase({ processoId: proc.id, faseMacroKey: PHASE_KEY })
  ok("3.1) instanciarWorkflowDaFase sucede com a tabela viva zerada", r.success === true, JSON.stringify(r).slice(0, 200))
  if (!r.success) { await limpar(); process.exit(1) }

  const stepInst = await prisma.phaseWorkflowStepInstance.findFirst({ where: { workflowInstanceId: r.workflowInstance.id }, select: { id: true, stepKey: true } })
  ok("3.2) o Step 'solicitar_certidao' foi materializado (1 Step, como o cadastro real)", stepInst?.stepKey === "solicitar_certidao")
  ok(
    "3.3) o ponteiro de versão da instância aponta pra uma versão REALMENTE publicada",
    (await prisma.phaseInternalWorkflowVersao.findUnique({
      where: { workflowId_versao: { workflowId: wf.id, versao: r.workflowInstance.workflowVersion! } },
    })) != null,
  )

  const subs = stepInst ? await subtarefasDaEtapa({ stepInstanceId: stepInst.id }) : []
  ok("3.4) A PROVA CENTRAL: a instância nova enxerga as 4 subtarefas via snapshot, mesmo com a tabela viva zerada", subs.length === 4, `subtarefas projetadas: ${subs.map((s) => s.key).join(", ")}`)
  const receberCertidao = subs.find((s) => s.key === "receber_certidao")
  ok("3.5) 'receber_certidao' preserva esperaExternaAoLiberar=true e acompanhamentoPrimeiroDias=7 do snapshot", receberCertidao?.definicao.esperaExternaAoLiberar === true && receberCertidao?.definicao.acompanhamentoPrimeiroDias === 7)
  ok("3.6) 'receber_certidao' preserva definePrazoDaTarefa=true e prazoDaTarefaDias=10 do snapshot", receberCertidao?.definicao.definePrazoDaTarefa === true && receberCertidao?.definicao.prazoDaTarefaDias === 10)
  const enviarRequerimento = subs.find((s) => s.key === "enviar_requerimento_cartorio")
  ok("3.7) 'enviar_requerimento_cartorio' é a corrente (disponível, sem bloqueio)", enviarRequerimento?.disponivel === true)

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch(async (e) => { console.error(e); await limpar().catch(() => {}); process.exit(1) }).finally(() => prisma.$disconnect())
