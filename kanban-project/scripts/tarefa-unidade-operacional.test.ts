// scripts/tarefa-unidade-operacional.test.ts
// ============================================================================
// A TAREFA É A UNIDADE OPERACIONAL — testes A–O.
// Rodar: npm run test:tarefa-operacional   (banco de TESTE)
//
// A pergunta que este arquivo responde: sete etapas continuam sendo UM trabalho?
//
// O cenário é o da emissão documental real — preparar, enviar, protocolar,
// aguardar, acompanhar, receber, validar — porque é ali que o desenho antigo
// quebrava: cada etapa disponível virava a sua própria tarefa, e concluir
// "enviar ao cartório" fechava uma tarefa sem que nada tivesse sido obtido.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import {
  materializarTarefaOperacional, sincronizarTarefaComWorkflow, chaveDaTarefa,
  estadoDerivado, etapaCorrente, calcularPrazo,
} from "@/lib/operacional/tarefa-canonica"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"

const MARCA = "TAREFA-OP"
const ETAPAS = [
  "preparar_pedido", "enviar_cartorio", "registrar_protocolo",
  "aguardar_cartorio", "acompanhar", "receber_certidao", "validar",
]

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
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
}

interface Palco {
  processoId: number; pessoaId: number; necessidadeId: number; instanciaId: number; stepIds: number[]
}

/** Uma certidão a obter, com o workflow interno de sete etapas. */
async function montarPalco(sufixo = "A"): Promise<Palco> {
  const item = await prisma.itemCatalogo.create({
    data: { code: `${MARCA}_${sufixo}`, name: `Certidão de Nascimento - Inteiro Teor`, natureza: "DOCUMENTO" },
    select: { id: true },
  })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} ${sufixo}` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} ${sufixo}`, pais: "espanha", arvoreId: arv.id }, select: { id: true },
  })
  const pes = await prisma.pessoa.create({
    data: { arvoreId: arv.id, nome: "Ademir", sobrenome: "Matheus" }, select: { id: true },
  })
  const nec = await prisma.necessidadeDocumental.create({
    data: {
      processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1,
      chaveIdempotencia: `${MARCA}-nec-${sufixo}-${proc.id}`,
    },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: {
      processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1, status: "ATIVO",
      chaveIdempotencia: `${MARCA}-inst-${sufixo}-${proc.id}`,
    },
    select: { id: true },
  })
  const stepIds: number[] = []
  for (const [i, key] of ETAPAS.entries()) {
    const s = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "genealogia",
        stepKey: key, ordem: i + 1, tipo: "HUMANO", obrigatorio: true,
        status: i === 0 ? "DISPONIVEL" : "PENDENTE",
        necessidadeId: nec.id, pessoaId: pes.id, papel: "equipe_documental", slaDays: i === 3 ? 15 : 5,
        chaveIdempotencia: `${MARCA}-step-${sufixo}-${proc.id}-${key}`,
      },
      select: { id: true },
    })
    stepIds.push(s.id)
  }
  return { processoId: proc.id, pessoaId: pes.id, necessidadeId: nec.id, instanciaId: inst.id, stepIds }
}

const tarefaDo = (processoId: number) =>
  prisma.tarefa.findFirst({
    where: { processoId },
    select: {
      id: true, titulo: true, statusTarefa: true, workflowInstanceId: true, workflowStepInstanceId: true,
      responsavelId: true, equipeKey: true, dataPrazo: true, necessidadeId: true, pessoaId: true,
      concluida: true, dataConclusao: true, chaveIdempotencia: true, ciclo: true,
    },
  })

const mudarStep = (id: number, status: string) =>
  prisma.phaseWorkflowStepInstance.update({ where: { id }, data: { status: status as never } })

async function main() {
  exigirBancoDeTeste("prova que sete etapas continuam sendo UMA tarefa")
  await limpar()
  const p = await montarPalco("A")

  console.log("A TAREFA É A UNIDADE OPERACIONAL — 7 etapas, 1 trabalho\n")

  // ═════════════════════════════════════════════════════════════════════════
  secao("A) Uma certidão gera UMA tarefa")
  // ═════════════════════════════════════════════════════════════════════════
  let r = await reconciliarTarefas({ processoId: p.processoId })
  ok("o reconciliador criou uma tarefa", r.tarefasCriadas === 1, `${r.tarefasCriadas}`)
  ok("existe exatamente UMA tarefa no processo",
    (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === 1)
  let t = await tarefaDo(p.processoId)
  ok("o título é o do TRABALHO, não o da etapa",
    /Certidão de Nascimento/.test(t?.titulo ?? "") && !/preparar_pedido/.test(t?.titulo ?? ""), t?.titulo)
  ok("a tarefa sabe por que existe (processo · pessoa · necessidade)",
    t?.pessoaId === p.pessoaId && t?.necessidadeId === p.necessidadeId)
  ok("a tarefa é dona do workflow", t?.workflowInstanceId === p.instanciaId)
  ok("a equipe veio do papel declarado nas etapas", t?.equipeKey === "equipe_documental", String(t?.equipeKey))
  ok("nasce sem responsável — na fila da equipe", t?.responsavelId === null)
  // SLA do trabalho = a etapa mais demorada (15d de "aguardar cartório"), não a
  // soma nem a menor: o prazo é para ter a certidão na mão.
  const dias = t?.dataPrazo ? Math.round((t.dataPrazo.getTime() - Date.now()) / 86400000) : null
  ok("o prazo é do trabalho, derivado do maior SLA obrigatório (15d)", dias === 15, `${dias}d`)

  // ═════════════════════════════════════════════════════════════════════════
  secao("B) Workflow com 7 etapas continua UMA tarefa")
  // ═════════════════════════════════════════════════════════════════════════
  const steps = await prisma.phaseWorkflowStepInstance.count({ where: { workflowInstanceId: p.instanciaId } })
  ok("o workflow tem 7 etapas", steps === 7, `${steps}`)
  ok("e mesmo assim há 1 tarefa", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === 1)
  ok("a etapa corrente é a primeira disponível", t?.workflowStepInstanceId === p.stepIds[0])

  // ═════════════════════════════════════════════════════════════════════════
  secao("C) Concluir a etapa 1 não cria a tarefa 2")
  // ═════════════════════════════════════════════════════════════════════════
  await mudarStep(p.stepIds[0], "CONCLUIDO")
  await mudarStep(p.stepIds[1], "DISPONIVEL")
  await reconciliarTarefas({ processoId: p.processoId })
  ok("continua havendo UMA tarefa", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === 1)
  t = await tarefaDo(p.processoId)
  ok("a MESMA tarefa avançou de etapa", t?.workflowStepInstanceId === p.stepIds[1])
  ok("e passou a EM_ANDAMENTO", t?.statusTarefa === "EM_ANDAMENTO", t?.statusTarefa)
  ok("sem concluir", t?.concluida === false)

  // ═════════════════════════════════════════════════════════════════════════
  secao("D) Concluir a etapa 6 não conclui a tarefa (falta a 7)")
  // ═════════════════════════════════════════════════════════════════════════
  for (const id of p.stepIds.slice(0, 6)) await mudarStep(id, "CONCLUIDO")
  await mudarStep(p.stepIds[6], "DISPONIVEL")
  await reconciliarTarefas({ processoId: p.processoId })
  t = await tarefaDo(p.processoId)
  ok("a tarefa NÃO está concluída", t?.concluida === false && t?.statusTarefa !== "CONCLUIDO_RECEBIDO", t?.statusTarefa)
  ok("a etapa corrente é a última", t?.workflowStepInstanceId === p.stepIds[6])

  // ═════════════════════════════════════════════════════════════════════════
  secao("E) Concluir a etapa terminal conclui a tarefa")
  // ═════════════════════════════════════════════════════════════════════════
  await mudarStep(p.stepIds[6], "CONCLUIDO")
  await reconciliarTarefas({ processoId: p.processoId })
  t = await tarefaDo(p.processoId)
  ok("a tarefa está concluída", t?.concluida === true && t?.statusTarefa === "CONCLUIDO_RECEBIDO", t?.statusTarefa)
  ok("com data de conclusão", t?.dataConclusao != null)
  ok("e continua sendo UMA tarefa", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === 1)

  // ═════════════════════════════════════════════════════════════════════════
  secao("H) Aguardar terceiro não conclui — e não some da fila")
  // ═════════════════════════════════════════════════════════════════════════
  const q = await montarPalco("H")
  await reconciliarTarefas({ processoId: q.processoId })
  await mudarStep(q.stepIds[0], "CONCLUIDO")
  await mudarStep(q.stepIds[3], "AGUARDANDO")
  await reconciliarTarefas({ processoId: q.processoId })
  const tq = await tarefaDo(q.processoId)
  ok("a tarefa fica AGUARDANDO_TERCEIRO", tq?.statusTarefa === "AGUARDANDO_TERCEIRO", tq?.statusTarefa)
  ok("continua aberta", tq?.concluida === false)
  ok("e continua com a etapa 'aguardar cartório' como corrente", tq?.workflowStepInstanceId === q.stepIds[3])

  // ═════════════════════════════════════════════════════════════════════════
  secao("F/G) Transferir e bloquear não duplicam")
  // ═════════════════════════════════════════════════════════════════════════
  const usuario = await prisma.usuario.findFirst({ select: { id: true } })
  await prisma.tarefa.update({ where: { id: tq!.id }, data: { responsavelId: usuario?.id ?? null, dataAtribuicao: new Date() } })
  await reconciliarTarefas({ processoId: q.processoId })
  ok("transferir não cria tarefa nova", (await prisma.tarefa.count({ where: { processoId: q.processoId } })) === 1)
  ok("a tarefa é a mesma", (await tarefaDo(q.processoId))?.id === tq!.id)

  await mudarStep(q.stepIds[3], "BLOQUEADO")
  await reconciliarTarefas({ processoId: q.processoId })
  ok("bloquear não cria tarefa nova", (await prisma.tarefa.count({ where: { processoId: q.processoId } })) === 1)
  ok("a tarefa fica BLOQUEADA", (await tarefaDo(q.processoId))?.statusTarefa === "BLOQUEADA")

  // ═════════════════════════════════════════════════════════════════════════
  secao("J) Reconciliar N vezes não duplica")
  // ═════════════════════════════════════════════════════════════════════════
  for (let i = 0; i < 3; i++) await reconciliarTarefas({ processoId: q.processoId })
  ok("depois de 3 reconciliações continua 1 tarefa",
    (await prisma.tarefa.count({ where: { processoId: q.processoId } })) === 1)
  const r2 = await reconciliarTarefas({ processoId: q.processoId })
  ok("e a última rodada não cria nada", r2.tarefasCriadas === 0, `${r2.tarefasCriadas}`)

  // ═════════════════════════════════════════════════════════════════════════
  secao("I) A identidade é a obrigação, não o título nem a etapa")
  // ═════════════════════════════════════════════════════════════════════════
  const base = { processoId: 1, necessidadeId: 2, pessoaId: 3, ciclo: 1 }
  ok("a chave é estável", chaveDaTarefa(base) === chaveDaTarefa({ ...base }))
  ok("ciclo diferente é outro trabalho", chaveDaTarefa({ ...base, ciclo: 2 }) !== chaveDaTarefa(base))
  ok("pessoa diferente é outro trabalho", chaveDaTarefa({ ...base, pessoaId: 9 }) !== chaveDaTarefa(base))
  ok("a chave não contém título nem etapa",
    !/titulo|step/i.test(chaveDaTarefa(base)), chaveDaTarefa(base))

  // Reabrir: a tarefa concluída volta pela MESMA identidade.
  const chaveA = (await tarefaDo(p.processoId))?.chaveIdempotencia
  await mudarStep(p.stepIds[6], "DISPONIVEL")
  await reconciliarTarefas({ processoId: p.processoId })
  const treaberta = await tarefaDo(p.processoId)
  ok("reabrir preserva a identidade da tarefa", treaberta?.chaveIdempotencia === chaveA)
  ok("e não cria uma segunda", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === 1)

  // ═════════════════════════════════════════════════════════════════════════
  secao("Unidades puras — estado e etapa corrente")
  // ═════════════════════════════════════════════════════════════════════════
  const st = (status: string, ordem: number, obrigatorio = true) => ({ status, ordem, obrigatorio, stepKey: `s${ordem}`, id: ordem })
  ok("todas obrigatórias concluídas → tarefa concluída",
    estadoDerivado([st("CONCLUIDO", 1), st("CONCLUIDO", 2)]).status === "CONCLUIDO_RECEBIDO")
  ok("uma bloqueada domina", estadoDerivado([st("CONCLUIDO", 1), st("BLOQUEADO", 2)]).status === "BLOQUEADA")
  ok("aguardando terceiro não conclui", estadoDerivado([st("CONCLUIDO", 1), st("AGUARDANDO", 2)]).status === "AGUARDANDO_TERCEIRO")
  ok("etapa opcional pendente não impede a conclusão",
    estadoDerivado([st("CONCLUIDO", 1), st("PENDENTE", 2, false)]).status === "CONCLUIDO_RECEBIDO")
  ok("a etapa corrente prefere a que está em andamento",
    etapaCorrente([st("DISPONIVEL", 1), st("EM_ANDAMENTO", 2)])?.ordem === 2)
  ok("sem SLA não se inventa prazo", calcularPrazo(null, new Date()) === null)
  ok("SLA zero não vira prazo de hoje", calcularPrazo(0, new Date()) === null)

  // ═════════════════════════════════════════════════════════════════════════
  secao("Causa encerrada — a tarefa sai da fila sem sumir")
  // ═════════════════════════════════════════════════════════════════════════
  const z = await montarPalco("Z")
  await reconciliarTarefas({ processoId: z.processoId })
  const tz = await tarefaDo(z.processoId)
  // A CAUSA É A OBRIGAÇÃO. Encerrar o roteiro da fase não encerra a exigência:
  // enquanto a necessidade estiver viva, a certidão continua sendo devida, e a
  // tarefa não pode sair da fila por causa de uma mudança de fase.
  await prisma.phaseWorkflowInstance.update({ where: { id: z.instanciaId }, data: { status: "SUPERSEDIDO" } })
  const rzViva = await reconciliarTarefas({ processoId: z.processoId })
  ok("obrigação viva NÃO é encerrada por mudança de roteiro",
    rzViva.tarefasEncerradasSemCausa === 0 && rzViva.tarefasAguardandoDecisao === 0)
  // Agora a exigência em si é dispensada — aí sim o trabalho perdeu a razão.
  await prisma.necessidadeDocumental.update({ where: { id: z.necessidadeId }, data: { status: "DISPENSADA" } })
  await prisma.phaseWorkflowInstance.update({ where: { id: z.instanciaId }, data: { status: "CANCELADO" } })
  const rz = await reconciliarTarefas({ processoId: z.processoId })
  ok("a tarefa sem causa é encerrada", rz.tarefasEncerradasSemCausa === 1, `${rz.tarefasEncerradasSemCausa}`)
  const tzDepois = await prisma.tarefa.findUnique({ where: { id: tz!.id }, select: { statusTarefa: true, motivoCodigo: true } })
  // `CAUSA_REMOVIDA` — o motivo passou a distinguir os três casos do §74, e
  // este cenário é o da tarefa que NUNCA foi iniciada: cancelar não joga fora
  // trabalho de ninguém.
  ok("com status CANCELADA e motivo", tzDepois?.statusTarefa === "CANCELADA" && tzDepois?.motivoCodigo === "CAUSA_REMOVIDA",
    `${tzDepois?.statusTarefa}/${tzDepois?.motivoCodigo}`)
  ok("mas NÃO apagada — o histórico é fato",
    (await prisma.tarefa.count({ where: { id: tz!.id } })) === 1)

  // ═════════════════════════════════════════════════════════════════════════
  secao("Materialização direta — idempotência da porta única")
  // ═════════════════════════════════════════════════════════════════════════
  const w = await montarPalco("W")
  const nova = {
    titulo: "Solicitar Certidão", processoId: w.processoId, pessoaId: w.pessoaId,
    necessidadeId: w.necessidadeId, ciclo: 1, workflowInstanceId: w.instanciaId, slaDays: 5,
  }
  const r1 = await prisma.$transaction((tx) => materializarTarefaOperacional(tx, nova, new Date()))
  const rr2 = await prisma.$transaction((tx) => materializarTarefaOperacional(tx, nova, new Date()))
  const rr3 = await prisma.$transaction((tx) => materializarTarefaOperacional(tx, nova, new Date()))
  ok("materializar 3x devolve a MESMA tarefa", r1.tarefaId === rr2.tarefaId && rr2.tarefaId === rr3.tarefaId)
  ok("e só a primeira cria", r1.criada && !rr2.criada && !rr3.criada)
  ok("uma instância = uma tarefa (trava do banco)",
    (await prisma.tarefa.count({ where: { workflowInstanceId: w.instanciaId } })) === 1)
  await prisma.$transaction((tx) => sincronizarTarefaComWorkflow(tx, r1.tarefaId, new Date()))

  await limpar()

  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    process.exit(1)
  }
  console.log("Sete etapas, um trabalho, uma tarefa.\n")
}

main().catch((e) => { console.error("falhou:", e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
