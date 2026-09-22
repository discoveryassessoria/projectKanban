// scripts/reconciliacao-workflow-emissao-documental.test.ts
// ============================================================================
// PROVA de que a reconciliação de conteúdo de workflow (item 2/3/4, mandato
// "Catálogo de Fases", correção 20/09/2026) preserva a instância legada
// (1 passo, "Solicitar certidão" — a regressão real de produção) e materializa
// os 4 passos novos num ciclo novo, sem tocar em nada do que já existia.
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/reconciliacao-workflow-emissao-documental.test.ts
// ============================================================================
import { prisma } from "../lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { garantirOferta } from "./_fixture-oferta"
import { materializarExecucaoDaFase } from "../src/services/materializar-fase"
import { proximoCiclo } from "../src/lib/motor/phase-advance"
import { montarChaveWorkflow, montarChavePasso } from "../src/services/phase-workflow-helpers"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra: string | null | undefined = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "RECWFED"
const FASE = "emissao_documental"

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const procIds = procs.map((p) => p.id)
  await prisma.logAuditoria.deleteMany({ where: { entidadeId: { in: procIds } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@recwfed.test" } } })
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({ where: { code: { startsWith: MARCA } }, select: { id: true } })
  const tipoIds = tipos.map((t) => t.id)
  const macros = await prisma.macroWorkflow.findMany({ where: { tipoProcessoId: { in: tipoIds } }, select: { id: true } })
  await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
  await prisma.macroWorkflow.deleteMany({ where: { id: { in: macros.map((m) => m.id) } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: { in: tipoIds } } })
}

async function main() {
  exigirBancoDeTeste("reconciliação de workflow — emissão documental")
  console.log("RECONCILIAÇÃO DE WORKFLOW — emissao_documental (itens 2/3/4, correção 20/09/2026)\n")
  await limpar()

  const wf = await prisma.phaseInternalWorkflow.findFirst({ where: { phaseKey: FASE, wfUid: `all::${FASE}` } })
  if (!wf) { console.error("PRÉ-REQUISITO ausente: rode scripts/publicar-workflows-emissao-documental.ts --aplicar antes deste teste."); process.exit(1) }

  secao("0) Pré-condição: workflow publicado tem exatamente 4 passos, 2º/3º em espera externa")
  const stepsPublicados = await prisma.phaseInternalWorkflowStep.findMany({ where: { workflowId: wf.id }, orderBy: { ordem: "asc" } })
  ok("0.1) exatamente 4 passos vivos no cadastro", stepsPublicados.length === 4, String(stepsPublicados.length))
  ok("0.2) passo 2 é espera externa", stepsPublicados[1]?.esperaExternaAoLiberar === true)
  ok("0.3) passo 3 é espera externa", stepsPublicados[2]?.esperaExternaAoLiberar === true)

  // Alguém precisa existir para ser dono da tarefa legada, e a fase precisa de um
  // macro que a contenha — reaproveita o tipo/macro de teste que outros arquivos já
  // usam, criando o mínimo próprio aqui para não depender de ordem de execução.
  const admin = await prisma.usuario.create({ data: { nome: "Admin RecWfEd", email: "admin@recwfed.test", senha: "x", tipo: "admin" }, select: { id: true } })
  const oferta = await garantirOferta(prisma, { countryKey: `${MARCA}_pais`, countryLabel: "País RecWfEd", modalityKey: `${MARCA}_modal`, modalityLabel: "Modalidade RecWfEd" })
  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: `${MARCA}_TIPO`, name: `${MARCA} Tipo`, paisId: oferta.paisId }, select: { id: true } })
  await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, ativo: true } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, name: `${MARCA} macro`, versao: 1 }, select: { id: true } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASE, label: "Emissão documental", ordem: 1, required: true, conditional: false } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: "finalizado", label: "finalizado", ordem: 2, required: true, conditional: false } })

  // emissao_documental é escopo DOCUMENTO (canônico) — precisa de árvore/pessoa/
  // documento reais para o motor ter alvo, exatamente como qualquer processo real.
  const arvore = await prisma.arvore.create({ data: { nome: `Árvore ${MARCA}` } })
  const pessoa = await prisma.pessoa.create({ data: { nome: "Grisotto", sobrenome: "RecWfEd", arvoreId: arvore.id, linhaReta: true, requerente: "maior" } })
  await prisma.documento.create({ data: { pessoaId: pessoa.id, descricao: "Certidão de nascimento" } })

  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} Grisotto-like`, workflowRuntime: "v2", faseAtualKey: FASE, tipoProcessoMotorId: tipo.id, modalidadeId: oferta.modalidadeId, macroWorkflowVersion: 1, arvoreId: arvore.id },
    select: { id: true },
  })

  // Simula a instância LEGADA real de produção: ciclo 1, workflowVersion 1 (a
  // versão de 1 passo, "Solicitar certidão" — a regressão real), status ATIVO,
  // com uma tarefa aberta e responsável atribuído.
  const chaveWfLegada = montarChaveWorkflow({ processoId: processo.id, faseMacroKey: FASE, workflowDefinitionId: wf.id, workflowVersion: 1, ciclo: 1 })
  const instanciaLegada = await prisma.phaseWorkflowInstance.create({
    data: { processoId: processo.id, faseMacroKey: FASE, workflowDefinitionId: wf.id, workflowVersion: 1, ciclo: 1, status: "ATIVO", origem: "MOTOR", chaveIdempotencia: chaveWfLegada },
  })
  const chavePassoLegado = montarChavePasso({ workflowInstanceId: instanciaLegada.id, stepDefinitionId: 999999, stepKey: "solicitar_certidao", stepDefinitionVersion: 1, ciclo: 1 })
  const stepLegado = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: instanciaLegada.id, processoId: processo.id, faseMacroKey: FASE,
      stepDefinitionId: 999999, stepDefinitionVersion: 1, stepKey: "solicitar_certidao",
      ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true, ciclo: 1, status: "DISPONIVEL",
      chaveIdempotencia: chavePassoLegado,
    },
  })
  const tarefaLegada = await prisma.tarefa.create({
    data: {
      processoId: processo.id, faseMacroKey: FASE, workflowInstanceId: instanciaLegada.id, workflowStepInstanceId: stepLegado.id,
      titulo: "Solicitar certidão", statusTarefa: "NAO_INICIADA", origem: "workflow", responsavelId: admin.id,
      chaveIdempotencia: `tarefa|${chavePassoLegado}`,
    },
  })

  secao("1) Reconciliação: instância legada (1 passo) → novo ciclo (4 passos)")
  const novoCiclo = await proximoCiclo(processo.id, FASE)
  ok("1.1) próximo ciclo é 2", novoCiclo === 2, String(novoCiclo))
  const rel = await materializarExecucaoDaFase({ processoId: processo.id, faseMacroKey: FASE, ciclo: novoCiclo, fonte: "RECONCILIACAO" })
  ok("1.2) materialização bem-sucedida", rel.estado === "MATERIALIZADO", rel.estado)
  ok("1.3) exatamente 4 passos instanciados no ciclo novo", rel.passosTotais === 4, String(rel.passosTotais))
  await prisma.phaseWorkflowInstance.update({ where: { id: rel.workflowInstanceId! }, data: { previousInstanceId: instanciaLegada.id } })

  const legadaDepois = await prisma.phaseWorkflowInstance.findUniqueOrThrow({ where: { id: instanciaLegada.id } })
  ok("1.4) instância legada preservada — status intocado", legadaDepois.status === "ATIVO")
  ok("1.5) instância legada preservada — workflowVersion intocado (continua 1)", legadaDepois.workflowVersion === 1)
  const stepLegadoDepois = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: stepLegado.id } })
  ok("1.6) passo legado ('solicitar_certidao') preservado intacto", stepLegadoDepois.status === "DISPONIVEL" && stepLegadoDepois.stepKey === "solicitar_certidao")
  const tarefaLegadaDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaLegada.id } })
  ok("1.7) tarefa legada preservada — aberta, mesmo responsável", tarefaLegadaDepois.statusTarefa === "NAO_INICIADA" && tarefaLegadaDepois.responsavelId === admin.id)

  const novosSteps = await prisma.phaseWorkflowStepInstance.findMany({ where: { workflowInstanceId: rel.workflowInstanceId! }, orderBy: { ordem: "asc" } })
  ok("1.8) os 4 novos passos são os corretos, na ordem certa", novosSteps.map((s) => s.stepKey).join(",") === "enviar_requerimento_ao_cartorio,receber_confirmacao_do_pedido,receber_certidao,conferir_e_validar_certidao", novosSteps.map((s) => s.stepKey).join(","))

  secao("2) Idempotência — segunda reconciliação")
  const jaReconciliado = await prisma.phaseWorkflowInstance.findFirst({ where: { previousInstanceId: instanciaLegada.id } })
  ok("2.1) processo detectável como já reconciliado", !!jaReconciliado)
  const instAntes = await prisma.phaseWorkflowInstance.count({ where: { processoId: processo.id } })
  const tarefasAntes = await prisma.tarefa.count({ where: { processoId: processo.id } })
  if (!jaReconciliado) {
    await materializarExecucaoDaFase({ processoId: processo.id, faseMacroKey: FASE, ciclo: await proximoCiclo(processo.id, FASE), fonte: "RECONCILIACAO" })
  }
  const instDepois = await prisma.phaseWorkflowInstance.count({ where: { processoId: processo.id } })
  const tarefasDepois = await prisma.tarefa.count({ where: { processoId: processo.id } })
  ok("2.2) segunda reconciliação: zero novas instâncias", instDepois === instAntes, `${instAntes} → ${instDepois}`)
  ok("2.3) segunda reconciliação: zero novas tarefas", tarefasDepois === tarefasAntes, `${tarefasAntes} → ${tarefasDepois}`)

  console.log(`\n${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
  await limpar()
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect() })
