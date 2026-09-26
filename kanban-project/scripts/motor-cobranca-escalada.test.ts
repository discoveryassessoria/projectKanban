// scripts/motor-cobranca-escalada.test.ts
// ============================================================================
// MOTOR DE COBRANÇA E ESCALADA — Etapa 2, itens 5 e 8.
// Rodar: PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//        DIRECT_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//        npx tsx scripts/motor-cobranca-escalada.test.ts
//
// PROVA, contra o banco de teste (fixture sintética, nunca produção):
//   1) dias corridos: sexta + 1 dia corrido cai no sábado (nunca pula fim de
//      semana — `prazoOperacional` é dias CORRIDOS em toda a régua, decisão
//      definitiva 23/09/2026).
//   2) `registrarCobranca` reagenda `proximoAcompanhamentoEm` em
//      `diasAposCobranca` (cadastro do passo) dias corridos a partir de agora.
//   3) A 2ª cobrança liga `escalada` (cadastro `escalarApos=2`); concluir a
//      subtarefa zera `escalada`/`escaladaEm` — nunca fica pendurada num
//      passo já resolvido.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { publicarWorkflow } from "@/src/services/publicacao-de-workflow"
import { instanciarWorkflowDaFase } from "@/src/services/phase-workflow"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"
import {
  subtarefasDaEtapa, concluirSubtarefaCorrentePeloPasso,
  registrarCobranca, historicoDeCobrancasDaSubtarefa,
} from "@/src/services/subtarefas-da-etapa"
import { prazoOperacional } from "@/lib/operacional/tempo-operacional"

const MARCA = "MOTORCOBRANCA"
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
  const tarefaIds = (await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })).map((t) => t.id)
  await prisma.contatoTerceiro.deleteMany({ where: { tarefaId: { in: tarefaIds } } })
  await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: { in: ids } } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
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
  exigirBancoDeTeste("motor-cobranca-escalada.test.ts")
  await limpar()
  console.log("MOTOR DE COBRANÇA E ESCALADA\n")

  // ══════════════════════════════════════════════════════════════════════
  secao("1) DIAS CORRIDOS — sexta + 1 dia corrido cai no sábado")
  // ══════════════════════════════════════════════════════════════════════
  const sexta = new Date("2026-10-02T12:00:00.000Z") // sexta-feira
  const maisUm = prazoOperacional(1, sexta)
  ok(
    "1.1) sexta 02/10 + 1 dia corrido = sábado 03/10 (nunca pula pro segunda)",
    maisUm != null && maisUm.getUTCDay() === 6 && maisUm.getUTCDate() === 3,
    maisUm ? maisUm.toISOString() : "null",
  )

  // ══════════════════════════════════════════════════════════════════════
  secao("2) CADASTRO — 1 Step com 2 subtarefas (entrada + espera externa cobrável)")
  // ══════════════════════════════════════════════════════════════════════
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

  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}-wf`, phaseKey: PHASE_KEY, name: `${MARCA} wf`, active: true, tipoProcessoId: tipo.id, escopoExecucao: "PROCESSO" },
    select: { id: true },
  })
  const step = await prisma.phaseInternalWorkflowStep.create({
    data: {
      workflowId: wf.id, key: "solicitar_certidao", label: "Solicitar certidão", ordem: 1,
      slaDays: 0, cardinalidade: "PROCESSO", diasAposCobranca: 1, escalarApos: 2,
    },
    select: { id: true },
  })
  const SUBTAREFAS = [
    { key: "enviar_requerimento", label: "Enviar requerimento", ordem: 0, esperaExternaAoLiberar: false, dependeDe: [] as string[] },
    { key: "aguardar_retorno", label: "Aguardar retorno do cartório", ordem: 1, esperaExternaAoLiberar: true, acompanhamentoAtivo: true, acompanhamentoPrimeiroDias: 5, dependeDe: ["enviar_requerimento"] },
  ]
  for (const s of SUBTAREFAS) {
    const criada = await prisma.stepSubtaskDefinition.create({
      data: {
        stepId: step.id, key: s.key, label: s.label, ordem: s.ordem,
        esperaExternaAoLiberar: s.esperaExternaAoLiberar,
        acompanhamentoAtivo: s.acompanhamentoAtivo ?? false,
        acompanhamentoPrimeiroDias: s.acompanhamentoPrimeiroDias ?? null,
        dependeDe: s.dependeDe,
      },
      select: { id: true },
    })
    await prisma.stepAction.create({
      data: { stepId: step.id, subtaskId: criada.id, key: "concluir", label: "Concluir", ordem: 1, effectKey: "COMPLETE_STEP" },
    })
  }
  const pub = await publicarWorkflow({ workflowId: wf.id, actorId: null, pularCompetenciaDeEfeito: true })
  ok("2.1) publicação sucede", pub.ok === true, JSON.stringify(pub).slice(0, 150))

  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} proc`, arvoreId: arv.id, faseAtualKey: PHASE_KEY, workflowRuntime: "v2", tipoProcessoMotorId: tipo.id, modalidadeId: habilitacao.modalidadeId },
    select: { id: true },
  })
  const r = await instanciarWorkflowDaFase({ processoId: proc.id, faseMacroKey: PHASE_KEY })
  if (!r.success) { console.error(r); await limpar(); process.exit(1) }
  const stepInst = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { workflowInstanceId: r.workflowInstance.id }, select: { id: true } })
  // `garantirTarefaDePasso` é quem cria a Tarefa E dispara `materializarSubtarefas`
  // (ligado nesta mesma Etapa 2) — sem a Tarefa, `registrarCobranca` recusa
  // com SEM_TAREFA (a cobrança pertence à obrigação, não só ao passo).
  await garantirTarefaDePasso({ stepInstanceId: stepInst.id })

  // Conclui a subtarefa de entrada para "aguardar_retorno" virar a corrente
  // e nascer em AGUARDANDO_EXTERNO (mesmo caminho reativo da produção).
  const c1 = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: stepInst.id, executadoPorId: null, payload: {} })
  ok("2.2) 'enviar_requerimento' concluída, corrente avança", c1.aplicavel === true && c1.subtarefaKey === "enviar_requerimento")
  const subsAntes = await subtarefasDaEtapa({ stepInstanceId: stepInst.id })
  const aguardarAntes = subsAntes.find((s) => s.key === "aguardar_retorno")
  ok("2.3) 'aguardar_retorno' nasceu em AGUARDANDO_EXTERNO", aguardarAntes?.status === "AGUARDANDO_EXTERNO")

  // ══════════════════════════════════════════════════════════════════════
  secao("3) 1ª COBRANÇA — reagenda +1 dia corrido, não escala ainda")
  // ══════════════════════════════════════════════════════════════════════
  const antesDaCobranca = new Date()
  const r1 = await registrarCobranca({ stepInstanceId: stepInst.id, subtaskKey: "aguardar_retorno", canal: "EMAIL", observacao: "primeiro contato" })
  ok("3.1) 1ª cobrança registrada com sucesso", r1.ok === true, JSON.stringify(r1))
  if (r1.ok) {
    const esperado = prazoOperacional(1, antesDaCobranca)
    ok(
      "3.2) proximoAcompanhamentoEm reagendado para +1 dia corrido (diasAposCobranca=1)",
      esperado != null && r1.proximoAcompanhamentoEm != null
        && Math.abs(r1.proximoAcompanhamentoEm.getTime() - esperado.getTime()) < 5000,
      `esperado≈${esperado?.toISOString()} obtido=${r1.proximoAcompanhamentoEm?.toISOString()}`,
    )
    ok("3.3) ainda NÃO escalou com 1 cobrança (escalarApos=2)", r1.escalada === false, `totalContatos=${r1.totalContatos}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("4) 2ª COBRANÇA — liga escalada")
  // ══════════════════════════════════════════════════════════════════════
  const r2 = await registrarCobranca({ stepInstanceId: stepInst.id, subtaskKey: "aguardar_retorno", canal: "TELEFONE" })
  ok("4.1) 2ª cobrança registrada com sucesso", r2.ok === true, JSON.stringify(r2))
  if (r2.ok) ok("4.2) escalada=true na 2ª cobrança (escalarApos=2)", r2.escalada === true, `totalContatos=${r2.totalContatos}`)

  const historico = await historicoDeCobrancasDaSubtarefa(stepInst.id, "aguardar_retorno")
  ok("4.3) histórico lista as 2 cobranças, na ordem", historico.length === 2 && historico[0].canal === "EMAIL" && historico[1].canal === "TELEFONE")

  const execApósEscalada = await prisma.subtaskExecution.findFirst({ where: { stepInstanceId: stepInst.id, subtaskKey: "aguardar_retorno", supersededAt: null }, select: { escalada: true, escaladaEm: true } })
  ok("4.4) SubtaskExecution.escalada=true e escaladaEm preenchida", execApósEscalada?.escalada === true && execApósEscalada?.escaladaEm != null)

  // ══════════════════════════════════════════════════════════════════════
  secao("5) CONCLUIR A SUBTAREFA ZERA A ESCALADA")
  // ══════════════════════════════════════════════════════════════════════
  const c2 = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: stepInst.id, executadoPorId: null, payload: {} })
  ok("5.1) 'aguardar_retorno' concluída", c2.aplicavel === true && c2.subtarefaKey === "aguardar_retorno")
  const execFinal = await prisma.subtaskExecution.findFirst({ where: { stepInstanceId: stepInst.id, subtaskKey: "aguardar_retorno" }, orderBy: { id: "desc" }, select: { status: true, escalada: true, escaladaEm: true } })
  ok("5.2) escalada volta a false e escaladaEm é null após concluir", execFinal?.status === "CONCLUIDO" && execFinal?.escalada === false && execFinal?.escaladaEm == null)

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch(async (e) => { console.error(e); await limpar().catch(() => {}); process.exit(1) }).finally(() => prisma.$disconnect())
