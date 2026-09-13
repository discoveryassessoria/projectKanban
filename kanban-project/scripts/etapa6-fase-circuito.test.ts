// scripts/etapa6-fase-circuito.test.ts
// ============================================================================
// ETAPA 6 — CIRCUITO OPERACIONAL COMPLETO (grão FASE/PROCESSO).
//
// Avançar → reabrir → retornar, com comparação de IDs antes/depois — mover
// fase NÃO pode concluir/cancelar/apagar/recriar/resetar Tarefa, nem perder
// follow-up, nem apagar histórico. A conclusão real de fase (FASE_CONCLUIDA,
// notificação consolidada, retry sem duplicar, manual-move não finge
// concluir) já está provada com concorrência real em
// scripts/etapa4-fase-concluida.test.ts — não duplicada aqui.
//
// TRUNCATA o banco de teste — só roda isolado (mesmo padrão de
// mover-fase-manual.test.ts / etapa4-fase-concluida.test.ts).
// ============================================================================
import { PrismaClient } from "@prisma/client"
import { garantirOferta } from "./_fixture-oferta"

let ok = 0
const falhas: string[] = []
const check = (n: string, c: boolean, e?: string) => { if (c) { ok++; console.log(`  ✅ ${n}`) } else { falhas.push(n); console.log(`  ❌ ${n}${e ? ` — ${e}` : ""}`) } }

const url = process.env.PRISMA_DATABASE_URL ?? ""
if (!/discovery_test/.test(url)) {
  console.log("Etapa 6 — circuito de fase — PULADO (sem banco de teste local)")
  process.exit(0)
}

const prisma = new PrismaClient()

async function main() {
  const { advance, reopenPhase, returnPhase } = await import("../src/lib/motor/phase-advance")
  const { materializarExecucaoDaFase } = await import("../src/services/materializar-fase")
  const { concluirEtapa } = await import("../lib/operacional/tarefa-etapa")

  await prisma.$executeRawUnsafe(
    'TRUNCATE "Processo","Arvore","Pessoa","Uniao","Documento","NecessidadeDocumental","NecessidadeDocumentalEvento","PhaseWorkflowInstance","PhaseWorkflowStepInstance","PhaseInternalWorkflow","PhaseInternalWorkflowStep","WorkflowEvento","DomainOutbox","Tarefa","MacroWorkflow","FaseMacro","PhaseAdvanceLog","LogAuditoria","NotificacaoOperacional" RESTART IDENTITY CASCADE',
  )
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
  const oferta = await garantirOferta(prisma, { countryKey: "alemanha", countryLabel: "Alemanha", nationalityKey: "alema", nationalityLabel: "Alemã", modalityKey: "administrativa", modalityLabel: "Administrativa" })
  const tipo = await prisma.tipoProcessoNacionalidade.upsert({
    where: { code: "ALE-ADM-E6" }, update: {},
    create: { code: "ALE-ADM-E6", name: "Alemã (Etapa 6)", paisId: oferta.paisId, modalidadeId: oferta.modalidadeId, processFamily: "CIDADANIA", serviceNature: "PROCESSO" },
  })
  const FASES = ["fase_um", "fase_dois"]
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: "Macro E6", versao: 1 } })
  for (let i = 0; i < FASES.length; i++) {
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASES[i], label: FASES[i], ordem: i, versao: 1 } })
  }
  for (const phaseKey of FASES) {
    const wf = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `all::${phaseKey}`, phaseKey, name: `WF ${phaseKey}`, tipoProcessoId: null, versao: 1 } })
    await prisma.phaseInternalWorkflowStep.create({
      data: { workflowId: wf.id, key: `passo_${phaseKey}`, label: `Passo ${phaseKey}`, ordem: 1, createsTask: true, required: true, owner: "equipe_documental", slaDays: 3, cardinalidade: "PROCESSO" },
    })
  }

  const admin = await prisma.usuario.upsert({ where: { email: "admin.e6@teste.local" }, update: {}, create: { nome: "Admin E6", email: "admin.e6@teste.local", senha: "x", tipo: "admin" } })
  const arvore = await prisma.arvore.create({ data: { nome: "Árvore E6" } })
  await prisma.pessoa.create({ data: { nome: "Joao", sobrenome: "Silva", arvoreId: arvore.id, linhaReta: true, requerente: "maior" } })

  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n12) AVANÇAR → REABRIR → RETORNAR — Tarefa nunca concluída/cancelada/recriada/resetada")
  // ═══════════════════════════════════════════════════════════════════════
  const p1 = await prisma.processo.create({ data: { nome: "E6-P1", codigo: "T-E6-P1", arvoreId: arvore.id, faseAtualKey: "fase_um", tipoProcessoMotorId: tipo.id, workflowRuntime: "v2" } })
  await materializarExecucaoDaFase({ processoId: p1.id, fonte: "CADASTRO_EM_ANDAMENTO" })

  const tarefaFase1Antes = await prisma.tarefa.findFirstOrThrow({ where: { processoId: p1.id, faseMacroKey: "fase_um" } })
  const historicoAntes = await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: tarefaFase1Antes.id } })

  // A) avançar (conclusão real) — pela PORTA CANÔNICA (concluirEtapa), nunca
  // por UPDATE direto: é o comando real que sincroniza Tarefa+Step+evento
  // atomicamente (task-step-sync). Escrever o status do passo por fora, como
  // um rascunho inicial deste teste fazia, deixa a Tarefa (NAO_INICIADA) e o
  // passo (CONCLUIDO) discordando — um estado que o motor nunca produz sozinho.
  const rConcluirPasso = await concluirEtapa({ tarefaId: tarefaFase1Antes.id, autorId: admin.id })
  check("A0) o passo é concluído pela porta canônica", rConcluirPasso.ok === true, JSON.stringify(rConcluirPasso))
  // Concluir a ÚLTIMA obrigação de fase_um já dispara o AUTO-AVANÇO (reação
  // de task-step-sync) — `advance()` explícito é só a rede de segurança
  // quando isso ainda não aconteceu.
  const jaAvancouSozinho = (await prisma.processo.findUniqueOrThrow({ where: { id: p1.id }, select: { faseAtualKey: true } })).faseAtualKey === "fase_dois"
  const rAvancar = jaAvancouSozinho ? null : await advance(p1.id, { origem: "teste-e6" })
  check("A) avanço aceito (automático ou explícito — fase_um → fase_dois)", jaAvancouSozinho || rAvancar?.success === true, JSON.stringify(rAvancar))

  const tarefaFase1DepoisAvancar = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaFase1Antes.id } })
  check("A) a Tarefa da fase_um PRESERVA o id", tarefaFase1DepoisAvancar.id === tarefaFase1Antes.id)
  check("A) a Tarefa da fase_um NÃO foi cancelada", tarefaFase1DepoisAvancar.statusTarefa !== "CANCELADA")
  check("A) a Tarefa da fase_um continua com sua conclusão real (não foi resetada)", tarefaFase1DepoisAvancar.statusTarefa === "CONCLUIDO_RECEBIDO" || tarefaFase1DepoisAvancar.statusTarefa === "CONCLUIDO_NAO_POSSUI")

  // B) reabrir a fase ATUAL (fase_dois) — novo ciclo, mesma fase.
  const rReabrir = await reopenPhase(p1.id, { justificativa: "Teste de reabertura — Etapa 6.", motivoCodigo: "CORRECAO_CADASTRO", solicitadoPorId: admin.id })
  check("B) reabertura aceita", rReabrir.success === true, JSON.stringify(rReabrir))
  const tarefaFase1DepoisReabrir = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaFase1Antes.id } })
  check("B) a Tarefa da fase_um (histórica) continua intacta depois de reabrir fase_dois", tarefaFase1DepoisReabrir.statusTarefa === tarefaFase1DepoisAvancar.statusTarefa)
  check("B) histórico da Tarefa antiga não foi apagado", (await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: tarefaFase1Antes.id } })) >= historicoAntes)

  // C) retornar para a fase_um (novo ciclo lá).
  const rRetornar = await returnPhase(p1.id, { faseAlvo: "fase_um", justificativa: "Teste de retorno controlado — Etapa 6.", motivoCodigo: "CORRECAO_CADASTRO", solicitadoPorId: admin.id })
  check("C) retorno aceito", rRetornar.success === true, JSON.stringify(rRetornar))
  const processoFinal = await prisma.processo.findUniqueOrThrow({ where: { id: p1.id } })
  check("C) o processo está de volta em fase_um", processoFinal.faseAtualKey === "fase_um")
  check("C) a Tarefa ORIGINAL da fase_um (ciclo 1) continua existindo, nunca apagada", (await prisma.tarefa.count({ where: { id: tarefaFase1Antes.id } })) === 1)
  const tarefaFase1Final = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaFase1Antes.id } })
  check("C) a Tarefa original NÃO foi resetada para NAO_INICIADA — retornar não desfaz trabalho já feito",
    tarefaFase1Final.statusTarefa === "CONCLUIDO_RECEBIDO" || tarefaFase1Final.statusTarefa === "CONCLUIDO_NAO_POSSUI")
  // REENTRADA (comportamento CONGELADO — src/services/phase-workflow.ts,
  // "REENTRADA NA FASE"): o passo novo do ciclo 2 nasce HERDANDO o estado
  // terminal positivo da mesma obrigação/unidade já concluída antes — "voltar
  // a 0 de 5" seria o defeito, não isto. Por isso, corretamente, NENHUMA
  // Tarefa nova é materializada aqui: não há trabalho novo a fazer na mesma
  // obrigação que já foi entregue.
  const novoCicloStep = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { processoId: p1.id, faseMacroKey: "fase_um", ciclo: 2 } })
  check("C) o passo do novo ciclo HERDA o estado concluído (reentrada), não reabre do zero", novoCicloStep.status === "CONCLUIDO")
  check("C) nenhuma Tarefa foi apagada no circuito inteiro (append-only)", (await prisma.tarefa.count({ where: { processoId: p1.id } })) === 3)

  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n13) PROCESSO INICIADO EM FASE AVANÇADA — obrigações anteriores continuam completáveis")
  // ═══════════════════════════════════════════════════════════════════════
  const p2 = await prisma.processo.create({ data: { nome: "E6-P2", codigo: "T-E6-P2", arvoreId: arvore.id, faseAtualKey: "fase_dois", tipoProcessoMotorId: tipo.id, workflowRuntime: "v2" } })
  await materializarExecucaoDaFase({ processoId: p2.id, fonte: "CADASTRO_EM_ANDAMENTO" })
  check("13a) processo nasce direto em fase_dois (fase_um nunca foi materializada)", (await prisma.phaseWorkflowInstance.count({ where: { processoId: p2.id, faseMacroKey: "fase_um" } })) === 0)
  check("13a) fase_dois tem sua Tarefa normalmente", (await prisma.tarefa.count({ where: { processoId: p2.id, faseMacroKey: "fase_dois" } })) === 1)

  // Um retorno controlado a fase_um materializa a obrigação anterior — que
  // NÃO foi invalidada só por o processo ter começado adiante.
  const rRetornarP2 = await returnPhase(p2.id, { faseAlvo: "fase_um", justificativa: "Fase anterior precisa ser refeita — Etapa 6.", motivoCodigo: "CORRECAO_CADASTRO", solicitadoPorId: admin.id })
  check("13b) retorno à fase anterior aceito mesmo o processo tendo começado adiante", rRetornarP2.success === true, JSON.stringify(rRetornarP2))
  const tarefaFase1DoP2 = await prisma.tarefa.findFirst({ where: { processoId: p2.id, faseMacroKey: "fase_um" } })
  check("13c) a obrigação de fase_um agora existe e é uma Tarefa completável", tarefaFase1DoP2 != null && tarefaFase1DoP2.statusTarefa !== "CANCELADA")
  check("13c) fase_dois (onde o processo nasceu) NÃO foi invalidada/apagada", (await prisma.tarefa.count({ where: { processoId: p2.id, faseMacroKey: "fase_dois" } })) === 1)

  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${ok + falhas.length} | ✅ ${ok} | ❌ ${falhas.length}`)
  if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhas.length === 0
    ? "Avançar/reabrir/retornar preserva toda Tarefa; fase avançada não invalida obrigação anterior."
    : "O circuito de fase quebrou em algum elo.")
  await prisma.$disconnect()
  process.exit(falhas.length > 0 ? 1 : 0)
}

void main()
