// scripts/prazo-subtarefa-todos-os-ramos.test.ts
// ============================================================================
// O SLA CADASTRADO NUMA SUBTAREFA TEM QUE VIRAR RELÓGIO, QUALQUER QUE SEJA O
// RAMO PELO QUAL ELA NASCE.
//
// Auditoria real (18/09/2026): só o ramo DISPONIVEL de `materializarSubtarefas`/
// `reconciliarSubtarefas` calculava `prazo`. Uma subtarefa que nascia EM_ANDAMENTO
// (ação síncrona) ou AGUARDANDO_EXTERNO (espera automática) ficava com
// `SubtaskExecution.prazo`/`previstoPara` para sempre `null`, mesmo tendo
// `slaDays` cadastrado e congelado — não porque faltasse "SLA de fornecedor"
// (não existe, e este teste não inventa um), mas porque a materialização não
// cobria todos os ramos de nascimento.
//
// Testa os itens A-E do mandato de 18/09/2026:
//   A) DISPONIVEL → prazo materializado
//   B) EM_ANDAMENTO síncrono → prazo materializado
//   C) AGUARDANDO_EXTERNO automático → prazo E previstoPara materializados
//   D) os três ramos usam A MESMA função (`prazoOperacional`) — sem fórmula duplicada
//   E) reconciliação de legado, rodada duas vezes, não altera de novo os mesmos dados
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=<banco de teste> npx tsx scripts/prazo-subtarefa-todos-os-ramos.test.ts
// ============================================================================

import { PrismaClient } from "@prisma/client"
import { congelarVersaoVigente } from "../src/services/versao-publicada"
import { validarWorkflowParaPublicar } from "../src/services/validacao-de-publicacao"
import { materializarSubtarefas, subtarefasDaEtapa } from "../src/services/subtarefas-da-etapa"
import { execucaoVigente } from "../src/services/execucao-da-subtarefa"
import { executarAcaoCadastrada } from "../src/services/executar-acao-cadastrada"
import { garantirTentativa, MOTIVOS_DE_TENTATIVA } from "../src/services/execucao-do-passo"
import { prazoOperacional, diaOperacional } from "../lib/operacional/tempo-operacional"
import { reconciliarPrazoDeSubtarefasLegadas } from "./backfill-prazo-subtarefa"
import { exigirBancoDeTeste } from "./_banco-de-teste"

const prisma = new PrismaClient()
const M = "PRZSUB"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: `${M} ` } }, select: { id: true } })
  for (const p of procs) {
    await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: p.id } } })
    await prisma.stepExecution.deleteMany({ where: { stepInstance: { processoId: p.id } } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: p.id } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: p.id } })
    await prisma.tarefa.deleteMany({ where: { processoId: p.id } })
    await prisma.processo.delete({ where: { id: p.id } }).catch(() => null)
  }
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: `${M} ` } } })
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::wf` }, select: { id: true } })
  if (wf) {
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: `${M}_fase` } })
}

async function main() {
  exigirBancoDeTeste("prova o relógio da subtarefa em todos os ramos de nascimento")
  await limpar()
  const operador = await prisma.usuario.findFirst({ orderBy: { id: "asc" }, select: { id: true } })
    ?? await prisma.usuario.create({ data: { nome: "Operador PRZSUB", email: `${M}@teste.local`, senha: "x", tipo: "admin" }, select: { id: true } })
  const UID = operador.id
  const PERMS = ["tarefas.editar", "documentos.editar", "processos.editar", "workflow.concluirPasso"]

  const fase = await prisma.catalogoFase.create({
    data: { phaseKey: `${M}_fase`, label: "Fase de Teste Prazo Subtarefa", escopo: "PROCESSO", ordemPadrao: 97, efeitosPermitidos: ["REGISTER_ONLY"] },
    select: { phaseKey: true },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${M}::wf`, phaseKey: fase.phaseKey, name: "Workflow prazo subtarefa", versao: 1, execucao: "SEQUENCIAL" },
    select: { id: true, versao: true },
  })
  const passo = await prisma.phaseInternalWorkflowStep.create({
    data: {
      workflowId: wf.id, key: "passo_de_teste", label: "Passo de Teste", ordem: 1, createsTask: true,
      required: true, cardinalidade: "DOCUMENTO", executorKey: "padrao", dependeDe: [] as never, slaDays: 8,
      regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS",
    },
    select: { id: true, key: true },
  })
  // subA: nasce DISPONIVEL, SLA próprio = 1 dia. Ao ser executada (REGISTER_ONLY,
  // sem condicaoConclusao — resolve na hora), passa por EM_ANDAMENTO síncrono.
  const subA = await prisma.stepSubtaskDefinition.create({
    data: {
      stepId: passo.id, key: "enviar", label: "Enviar requerimento", ordem: 1,
      obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA",
      fonteDeCanais: "NENHUMA", dependeDe: [] as never, slaDays: 1,
    },
    select: { id: true, key: true },
  })
  await prisma.stepAction.create({
    data: { stepId: passo.id, subtaskId: subA.id, key: "enviado", label: "Enviado", effectKey: "REGISTER_ONLY", ordem: 1 },
  })
  // subB: depende de A, `esperaExternaAoLiberar` — nasce direto AGUARDANDO_EXTERNO
  // quando liberada, SLA próprio = 1 dia.
  const subB = await prisma.stepSubtaskDefinition.create({
    data: {
      stepId: passo.id, key: "aguardar", label: "Aguardar retorno", ordem: 2,
      obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA",
      fonteDeCanais: "NENHUMA", dependeDe: ["enviar"] as never, slaDays: 1,
      esperaExternaAoLiberar: true,
    },
    select: { id: true, key: true },
  })
  await prisma.stepAction.create({
    data: { stepId: passo.id, subtaskId: subB.id, key: "retornado", label: "Retornado", effectKey: "REGISTER_ONLY", ordem: 1 },
  })

  const probs = await validarWorkflowParaPublicar(wf.id)
  check("a configuração é publicável", probs.length === 0, JSON.stringify(probs))
  await congelarVersaoVigente(wf.id, "CRIACAO")

  // Uma instância NOVA por cenário — de propósito. `materializarSubtarefas`
  // cria execução para TODA subtarefa da versão de uma vez (inclusive as
  // BLOQUEADAS, à frente); rodá-la na mesma instância que testa o caminho
  // PREGUIÇOSO (o real, o único que a produção usa — `materializarSubtarefas`
  // não tem NENHUM chamador fora de teste) pré-criaria a execução de "aguardar"
  // como BLOQUEADO antes da hora, e o ramo AGUARDANDO_EXTERNO nunca chegaria a
  // rodar (a subtarefa já "teria execução" quando `aplicarEsperaExterna...`
  // fosse checá-la). Isolar por instância é o que deixa cada ramo puro.
  let seqInst = 0
  async function novaInstancia() {
    const n = ++seqInst
    const arv = await prisma.arvore.create({ data: { nome: `${M} árvore ${n}` }, select: { id: true } })
    const proc = await prisma.processo.create({
      data: { nome: `${M} processo ${n}`, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: fase.phaseKey },
      select: { id: true },
    })
    const inst = await prisma.phaseWorkflowInstance.create({
      data: { processoId: proc.id, faseMacroKey: fase.phaseKey, ciclo: 1, status: "ATIVO", workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `${M}-i${n}` },
      select: { id: true },
    })
    const si = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: fase.phaseKey, ciclo: 1,
        stepKey: passo.key, ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
        status: "EM_ANDAMENTO", dependeDeStepKeys: [] as never,
        stepDefinitionId: passo.id, stepDefinitionVersion: 1, chaveIdempotencia: `${M}-p${n}`,
      },
      select: { id: true },
    })
    await garantirTentativa(si.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })
    // A TAREFA do passo — `aplicarEsperaExternaDaSubtarefaSeConfigurado` bloqueia
    // ELA (motivoCodigo AGUARDANDO_TERCEIRO) quando a subtarefa corrente nasce em
    // espera externa; sem Tarefa associada ela não tem o que bloquear.
    await prisma.tarefa.create({
      data: {
        titulo: `${M} tarefa ${n}`, processoId: proc.id, workflowStepInstanceId: si.id,
        workflowInstanceId: inst.id, chaveIdempotencia: `${M}-t${n}`, statusTarefa: "NAO_INICIADA",
      },
    })
    return si
  }

  // ══════════════════════════════════════════════════════════════
  console.log("\nA) DISPONIVEL — materializarSubtarefas liga o relógio")
  // ══════════════════════════════════════════════════════════════
  const siA = await novaInstancia()
  await materializarSubtarefas({ stepInstanceId: siA.id })
  const execA0 = await execucaoVigente(siA.id, "enviar")
  check("A nasce DISPONIVEL", execA0?.status === "DISPONIVEL")
  check("A) prazo materializado (não null)", execA0?.prazo != null, String(execA0?.prazo))
  // Comparação por DIA operacional, não por instante exato: o `new Date()` usado
  // dentro do motor e o `criadoEm` gravado pelo banco (default `now()`) são
  // momentos ligeiramente diferentes da mesma chamada — o que importa é que os
  // dois caem no MESMO dia útil seguinte, calculado pela MESMA função.
  const esperadoA = prazoOperacional(1, execA0!.criadoEm)
  check("A) prazo bate com prazoOperacional(1, criadoEm) — mesma função, sem fórmula duplicada",
    diaOperacional(execA0!.prazo!) === diaOperacional(esperadoA!))

  // ══════════════════════════════════════════════════════════════
  console.log("\nB) EM_ANDAMENTO síncrono — executarAcaoCadastrada liga o relógio")
  // ══════════════════════════════════════════════════════════════
  // Instância PRÓPRIA, nunca tocada por `materializarSubtarefas` — o caminho
  // que a produção de fato usa: "enviar" nasce preguiçosamente quando alguém
  // executa a ação, sem nenhuma subtarefa-irmã pré-materializada antes da hora.
  const siB = await novaInstancia()
  const r = await executarAcaoCadastrada(siB.id, "enviado", {}, {
    usuarioId: UID, permissoes: PERMS, correlationId: `${M}-a1`, subtaskKey: "enviar", fornecedorId: null,
  })
  check("A executa (REGISTER_ONLY, sem condição — resolve na hora)", r.ok, JSON.stringify(r))
  const execA1 = await execucaoVigente(siB.id, "enviar")
  check("A concluiu (nasceu EM_ANDAMENTO e resolveu na mesma chamada — o caso real da Grisotto)", execA1?.status === "CONCLUIDO")
  check("B) prazo materializado mesmo tendo nascido EM_ANDAMENTO, não DISPONIVEL", execA1?.prazo != null, String(execA1?.prazo))
  const esperadoB = prazoOperacional(1, execA1!.criadoEm)
  check("B) prazo bate com prazoOperacional(1, criadoEm) — mesma função", diaOperacional(execA1!.prazo!) === diaOperacional(esperadoB!))

  // ══════════════════════════════════════════════════════════════
  console.log("\nC) AGUARDANDO_EXTERNO automático — aplicarEsperaExternaDaSubtarefaSeConfigurado liga prazo E previstoPara")
  // ══════════════════════════════════════════════════════════════
  // MESMA instância de B, de propósito: "aguardar" só existe depois que
  // "enviar" (a dependência dela) concluiu — e é exatamente o
  // `executarAcaoCadastrada` de B, acima, que dispara essa liberação
  // automaticamente (`aplicarEsperaExternaDaSubtarefaSeConfigurado`).
  const projC = await subtarefasDaEtapa({ stepInstanceId: siB.id })
  check("B (aguardar) ficou corrente, liberada pela dependência", projC.find((s) => s.key === "aguardar")?.status === "AGUARDANDO_EXTERNO")
  const execB = await execucaoVigente(siB.id, "aguardar")
  check("C) nasceu AGUARDANDO_EXTERNO de verdade", execB?.status === "AGUARDANDO_EXTERNO")
  check("C) prazo materializado (não null) — antes desta correção ficava null para sempre", execB?.prazo != null, String(execB?.prazo))
  check("C) previstoPara TAMBÉM materializado — é aqui que existe previsão de terceiro", execB?.previstoPara != null, String(execB?.previstoPara))
  const esperadoC = prazoOperacional(1, execB!.criadoEm)
  check("C) prazo bate com prazoOperacional(1, criadoEm) — mesma função dos ramos A e B",
    diaOperacional(execB!.prazo!) === diaOperacional(esperadoC!))
  check("C) previstoPara é o MESMO valor que prazo neste caso (mesma fórmula, campos distintos, não alias cego no schema)",
    execB!.previstoPara!.getTime() === execB!.prazo!.getTime())

  // ══════════════════════════════════════════════════════════════
  console.log("\nD) Os três ramos concordam: dias úteis, uma função só")
  // ══════════════════════════════════════════════════════════════
  check("A, B (execução) e C usam prazoOperacional — os três resultados batem com a MESMA fórmula aplicada fora do motor",
    diaOperacional(execA0!.prazo!) === diaOperacional(prazoOperacional(1, execA0!.criadoEm)!) &&
    diaOperacional(execA1!.prazo!) === diaOperacional(prazoOperacional(1, execA1!.criadoEm)!) &&
    diaOperacional(execB!.prazo!) === diaOperacional(prazoOperacional(1, execB!.criadoEm)!))

  // ══════════════════════════════════════════════════════════════
  console.log("\nE) Legado — reconciliação idempotente, rodada duas vezes")
  // ══════════════════════════════════════════════════════════════
  // Simula dado LEGADO: zera o prazo de uma execução já concluída (como estava
  // em produção antes desta correção), com criadoEm real no passado (nunca "hoje").
  await prisma.subtaskExecution.update({ where: { id: execA1!.id }, data: { prazo: null } })
  const r1 = await reconciliarPrazoDeSubtarefasLegadas({ aplicar: true, log: false, db: prisma as never })
  const itemE = r1.itens.find((i) => i.id === execA1!.id)
  check("E) 1ª rodada: a execução zerada foi encontrada e reconciliada", itemE != null)
  check("E) 1ª rodada: o prazo recalculado usa criadoEm real (histórico), não 'hoje'",
    itemE?.prazo?.getTime() === prazoOperacional(1, execA1!.criadoEm)!.getTime())
  const execA1Depois = await prisma.subtaskExecution.findUnique({ where: { id: execA1!.id }, select: { prazo: true } })
  check("E) 1ª rodada: o banco realmente foi escrito", execA1Depois?.prazo != null)

  const r2 = await reconciliarPrazoDeSubtarefasLegadas({ aplicar: true, log: false, db: prisma as never })
  const itemE2 = r2.itens.find((i) => i.id === execA1!.id)
  check("E) 2ª rodada: a MESMA execução não aparece mais como candidata (idempotente)", itemE2 == null)
  const execA1Final = await prisma.subtaskExecution.findUnique({ where: { id: execA1!.id }, select: { prazo: true } })
  check("E) 2ª rodada: o prazo não mudou de novo", execA1Final?.prazo?.getTime() === execA1Depois?.prazo?.getTime())

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
