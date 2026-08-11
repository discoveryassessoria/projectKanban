// scripts/equivalencia-portas-etapa.test.ts
// ============================================================================
// AS DUAS PORTAS PÚBLICAS CHEGAM AO MESMO LUGAR.
// Rodar: npm run test:equivalencia-portas   (banco de TESTE)
//
// A consolidação só é real se for INDIFERENTE por onde o operador entra.
// Concluir a mesma etapa do mesmo trabalho por:
//
//   • `concluirEtapa`  (porta de TAREFA — a tela de tarefas, o comando HTTP)
//   • `concluirPasso`  (task-step-sync — a Central e o drawer do documento)
//
// tem de produzir o MESMO estado do passo, o MESMO estado da tarefa, o MESMO
// evento de workflow, a MESMA publicação no outbox e a MESMA ativação da etapa
// seguinte. Nada duplicado, nada faltando.
//
// POR QUE ESTE TESTE EXISTE
// Antes, não chegavam. `concluirEtapa` movia o passo com um `updateMany` seu:
// não emitia `WorkflowEvento`, não publicava no outbox e não avançava fase.
// `concluirPasso` fazia as três coisas — mas concluía a TAREFA junto, o que só
// estava certo quando passo e tarefa eram a mesma coisa. O sistema tinha duas
// verdades sobre o mesmo clique, e qual delas valia dependia do botão.
//
// Um guard estático prova que a segunda máquina de estados não existe mais.
// Este teste prova a consequência: o resultado é o mesmo.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import { concluirEtapa } from "@/lib/operacional/tarefa-etapa"
import { concluirPasso } from "@/src/services/task-step-sync"
import { atribuirTarefa, iniciarTarefa } from "@/lib/operacional/tarefa-comandos"
import { reabrirTarefa } from "@/lib/operacional/tarefa-ciclo"

const MARCA = "EQUIV"
const ETAPAS = ["preparar_pedido", "enviar_cartorio", "receber", "validar"]

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
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: ts.map((t) => t.id) } } })
  // O ID DA TAREFA É REUTILIZADO ENTRE EXECUÇÕES. Sem apagar a auditoria, a
  // tarefa criada na próxima rodada nasce com o histórico da anterior colado
  // nela — e asserções sobre "quantos TAREFA_CRIADA existem" passam a depender
  // de quantas vezes o teste já rodou.
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.workflowEvento.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@equiv.test" } } })
}

/**
 * DOIS PALCOS IDÊNTICOS. Mesmo workflow, mesmas etapas, mesma cardinalidade —
 * a única diferença entre eles vai ser a PORTA usada. Se o resultado divergir,
 * a divergência é da porta, não do cenário.
 *
 * `workflowRuntime: "v2"` é obrigatório: `concluirPasso` recusa processo legado
 * no portão, e um teste que passasse por não ter executado nada não provaria
 * coisa alguma.
 */
async function palco(sufixo: string) {
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${sufixo}`, name: "Certidão de Nascimento", natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} ${sufixo}` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} ${sufixo}`, pais: "espanha", arvoreId: arv.id, workflowRuntime: "v2" }, select: { id: true },
  })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Ademir", sobrenome: sufixo }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-n-${sufixo}-${proc.id}` }, select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i-${sufixo}-${proc.id}` }, select: { id: true },
  })
  const stepIds: number[] = []
  for (const [i, key] of ETAPAS.entries()) {
    const s = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "genealogia", stepKey: `${key}_${sufixo}`,
        ordem: i + 1, tipo: "HUMANO", obrigatorio: true, status: i === 0 ? "DISPONIVEL" : "PENDENTE",
        necessidadeId: nec.id, pessoaId: pes.id, papel: "equipe_documental", slaDays: 5,
        chaveIdempotencia: `${MARCA}-s-${sufixo}-${proc.id}-${i}`,
      }, select: { id: true },
    })
    stepIds.push(s.id)
  }
  await reconciliarTarefas({ processoId: proc.id })
  const t = await prisma.tarefa.findFirstOrThrow({ where: { processoId: proc.id }, select: { id: true } })
  return { processoId: proc.id, instanciaId: inst.id, stepIds, tarefaId: t.id }
}

/** O retrato do que importa: o par (passo, tarefa) e o rastro que ele deixou. */
async function retrato(p: { processoId: number; instanciaId: number; tarefaId: number; stepIds: number[] }) {
  const steps = await prisma.phaseWorkflowStepInstance.findMany({
    where: { workflowInstanceId: p.instanciaId },
    select: { status: true, ordem: true, completedAt: true },
    orderBy: { ordem: "asc" },
  })
  const t = await prisma.tarefa.findUniqueOrThrow({
    where: { id: p.tarefaId },
    select: { statusTarefa: true, concluida: true, workflowStepInstanceId: true },
  })
  const eventos = await prisma.workflowEvento.findMany({
    where: { processoId: p.processoId },
    select: { tipo: true, entityType: true },
    orderBy: { id: "asc" },
  })
  const outbox = await prisma.domainOutbox.findMany({
    where: { aggregateType: "PhaseWorkflowStepInstance", aggregateId: { in: p.stepIds } },
    select: { tipo: true },
    orderBy: { id: "asc" },
  })
  return {
    // A ordem das etapas identifica cada uma sem depender do id, que difere
    // entre os dois palcos.
    passos: steps.map((s) => `${s.ordem}:${s.status}:${s.completedAt ? "T" : "-"}`),
    tarefa: `${t.statusTarefa}|${t.concluida}`,
    // O ponteiro vira a ORDEM da etapa: comparar ids entre palcos diferentes
    // acusaria uma diferença que não existe.
    ponteiro: t.workflowStepInstanceId == null ? null : p.stepIds.indexOf(t.workflowStepInstanceId) + 1,
    eventos: eventos.map((e) => `${e.entityType}:${e.tipo}`),
    outbox: outbox.map((o) => o.tipo),
  }
}

async function main() {
  exigirBancoDeTeste("prova a equivalência entre as portas de conclusão de etapa")
  await limpar()
  const dani = await prisma.usuario.create({ data: { nome: "Dani", email: "dani@equiv.test", senha: "x", tipo: "assistente" }, select: { id: true } })
  const admin = await prisma.usuario.create({ data: { nome: "Chefe", email: "chefe@equiv.test", senha: "x", tipo: "admin" }, select: { id: true } })

  // O portão do runtime v2 é global: sem ele `concluirPasso` recusa tudo.
  await prisma.motorConfig.upsert({ where: { id: 1 }, create: { id: 1, runtimeV2Habilitado: true }, update: { runtimeV2Habilitado: true } })

  console.log("EQUIVALÊNCIA DAS PORTAS — o mesmo clique, por dois caminhos\n")

  const A = await palco("A")   // porta de TAREFA
  const B = await palco("B")   // porta de PASSO (Central)
  for (const p of [A, B]) {
    await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: dani.id, autorId: admin.id })
    await iniciarTarefa({ tarefaId: p.tarefaId, autorId: dani.id })
  }

  // ═════════════════════════════════════════════════════════════════════════
  secao("1) Etapa INTERMEDIÁRIA: as duas portas param no mesmo estado")
  // ═════════════════════════════════════════════════════════════════════════
  const rA = await concluirEtapa({ tarefaId: A.tarefaId, autorId: dani.id })
  const rB = await concluirPasso(B.stepIds[0], { origem: "USER", usuarioId: dani.id })
  ok("1) a porta de tarefa concluiu", rA.ok === true, rA.ok ? "" : rA.mensagem)
  ok("1) a porta de passo concluiu", rB.success === true, rB.success ? "" : rB.code)

  const fA1 = await retrato(A)
  const fB1 = await retrato(B)
  ok("1) MESMO estado dos passos", JSON.stringify(fA1.passos) === JSON.stringify(fB1.passos),
    `${fA1.passos.join(",")}  ×  ${fB1.passos.join(",")}`)
  ok("1) MESMO estado da tarefa", fA1.tarefa === fB1.tarefa, `${fA1.tarefa} × ${fB1.tarefa}`)
  ok("1) a tarefa NÃO foi encerrada por uma etapa do meio",
    fA1.tarefa.startsWith("EM_ANDAMENTO") && fB1.tarefa.startsWith("EM_ANDAMENTO"),
    "cinco das seis conclusões de um pedido de certidão não encerram nada")
  ok("1) MESMO ponteiro de etapa corrente", fA1.ponteiro === fB1.ponteiro, `${fA1.ponteiro} × ${fB1.ponteiro}`)
  ok("1) a próxima etapa ficou DISPONIVEL nas duas",
    fA1.passos[1].endsWith("DISPONIVEL:-") && fB1.passos[1].endsWith("DISPONIVEL:-"),
    `${fA1.passos[1]} × ${fB1.passos[1]}`)

  // ═════════════════════════════════════════════════════════════════════════
  secao("2) O RASTRO é o mesmo — evento e outbox, não só o estado final")
  // ═════════════════════════════════════════════════════════════════════════
  ok("2) MESMOS eventos de workflow", JSON.stringify(fA1.eventos) === JSON.stringify(fB1.eventos),
    `${fA1.eventos.join(",")}  ×  ${fB1.eventos.join(",")}`)
  ok("2) a porta de tarefa emite PASSO_CONCLUIDO",
    fA1.eventos.includes("step_instance:PASSO_CONCLUIDO"),
    "era exatamente o que faltava: concluir por aqui não deixava rastro no workflow")
  ok("2) e PASSO_DISPONIBILIZADO da seguinte",
    fA1.eventos.includes("step_instance:PASSO_DISPONIBILIZADO"))
  ok("2) MESMA publicação no outbox", JSON.stringify(fA1.outbox) === JSON.stringify(fB1.outbox),
    `${fA1.outbox.join(",")}  ×  ${fB1.outbox.join(",")}`)
  ok("2) step.concluido foi publicado nas duas",
    fA1.outbox.includes("step.concluido") && fB1.outbox.includes("step.concluido"),
    "é o gatilho da projeção financeira documental")

  // ═════════════════════════════════════════════════════════════════════════
  secao("3) Nenhuma porta duplica trabalho")
  // ═════════════════════════════════════════════════════════════════════════
  for (const [nome, p] of [["tarefa", A], ["passo", B]] as const) {
    const nTarefas = await prisma.tarefa.count({ where: { processoId: p.processoId } })
    ok(`3) porta de ${nome}: continua UMA tarefa`, nTarefas === 1, `${nTarefas}`)
    const concl = await prisma.workflowEvento.count({ where: { processoId: p.processoId, tipo: "PASSO_CONCLUIDO" } })
    ok(`3) porta de ${nome}: UM evento de conclusão`, concl === 1, `${concl}`)
  }

  // ═════════════════════════════════════════════════════════════════════════
  secao("4) Até o FIM do workflow, alternando as portas")
  // ═════════════════════════════════════════════════════════════════════════
  // A conclui pela porta de tarefa; B pela porta de passo. As duas percorrem as
  // três etapas restantes e têm de terminar iguais.
  for (let i = 1; i < ETAPAS.length; i++) {
    const ra = await concluirEtapa({ tarefaId: A.tarefaId, autorId: dani.id })
    const rb = await concluirPasso(B.stepIds[i], { origem: "USER", usuarioId: dani.id })
    ok(`4) etapa ${i + 1} concluída pelas duas`, ra.ok === true && rb.success === true,
      ra.ok ? (rb.success ? "" : rb.code) : ra.mensagem)
  }
  const fA2 = await retrato(A)
  const fB2 = await retrato(B)
  ok("4) MESMO estado final dos passos", JSON.stringify(fA2.passos) === JSON.stringify(fB2.passos),
    `${fA2.passos.join(",")}  ×  ${fB2.passos.join(",")}`)
  ok("4) MESMO estado final da tarefa", fA2.tarefa === fB2.tarefa, `${fA2.tarefa} × ${fB2.tarefa}`)
  ok("4) a última etapa ENCERROU o trabalho nas duas",
    fA2.tarefa === "CONCLUIDO_RECEBIDO|true" && fB2.tarefa === "CONCLUIDO_RECEBIDO|true",
    `${fA2.tarefa} × ${fB2.tarefa}`)
  ok("4) MESMOS eventos do começo ao fim", JSON.stringify(fA2.eventos) === JSON.stringify(fB2.eventos))
  ok("4) a tarefa foi concluída UMA vez em cada",
    fA2.eventos.filter((e) => e === "tarefa:TAREFA_CONCLUIDA").length === 1 &&
    fB2.eventos.filter((e) => e === "tarefa:TAREFA_CONCLUIDA").length === 1)

  // ═════════════════════════════════════════════════════════════════════════
  secao("5) RETRY: repetir o mesmo comando não repete o efeito")
  // ═════════════════════════════════════════════════════════════════════════
  const antesRetryA = await retrato(A)
  const rr = await concluirEtapa({ tarefaId: A.tarefaId, autorId: dani.id })
  ok("5) a porta de tarefa recusa por estado terminal, sem efeito",
    rr.ok === false && rr.codigo === "TAREFA_TERMINAL",
    rr.ok ? "concluiu de novo!" : rr.codigo)
  const rr2 = await concluirPasso(B.stepIds[ETAPAS.length - 1], { origem: "USER", usuarioId: dani.id })
  ok("5) a porta de passo é no-op idempotente", rr2.success === true && rr2.changed === false,
    rr2.success ? `changed=${rr2.changed}` : rr2.code)
  ok("5) nada mudou no palco A", JSON.stringify(await retrato(A)) === JSON.stringify(antesRetryA))

  // ═════════════════════════════════════════════════════════════════════════
  secao("6) REABRIR e reconcluir — a segunda passagem tem identidade própria")
  // ═════════════════════════════════════════════════════════════════════════
  // É aqui que a chave de idempotência quebrava: reabrir e concluir de novo o
  // MESMO passo, no MESMO ciclo, gerava a mesma chave da primeira conclusão e a
  // transação inteira caía com P2002. O trabalho estava certo; a chave é que
  // descrevia mal o fato.
  const reab = await reabrirTarefa({
    tarefaId: A.tarefaId, autorId: admin.id,
    motivo: "cartório enviou o documento errado", stepDestinoId: A.stepIds[ETAPAS.length - 1],
  })
  ok("6) a tarefa reabriu", reab.ok === true, reab.ok ? "" : reab.mensagem)
  ok("6) a reabertura deixou rastro (PASSO_REABERTO)",
    (await prisma.workflowEvento.count({ where: { processoId: A.processoId, tipo: "PASSO_REABERTO" } })) === 1)
  const rec = await concluirEtapa({ tarefaId: A.tarefaId, autorId: dani.id })
  ok("6) reconcluir funciona — sem colisão de chave", rec.ok === true, rec.ok ? "" : `${rec.codigo}: ${rec.mensagem}`)
  ok("6) e encerra o trabalho de novo", rec.ok === true && rec.tarefaConcluida === true)
  ok("6) a segunda conclusão gerou um evento NOVO",
    (await prisma.workflowEvento.count({ where: { processoId: A.processoId, tipo: "PASSO_CONCLUIDO" } })) === ETAPAS.length + 1,
    "cada passagem pelo passo é um fato distinto — não um evento repetido")

  // ═════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) {
    console.log("\nFALHAS:")
    for (const f of falhas) console.log(`  • ${f}`)
  }
  await limpar()
  await prisma.$disconnect()
  if (falhou > 0) process.exit(1)
  console.log("Duas portas, um resultado — a fronteira não muda o que aconteceu.")
}

main().catch(async (e) => { console.error("falhou:", e); await prisma.$disconnect(); process.exit(1) })
