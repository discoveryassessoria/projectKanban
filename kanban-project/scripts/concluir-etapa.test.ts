// scripts/concluir-etapa.test.ts
// ============================================================================
// CONCLUIR ETAPA INTERNA — testes A–N.
// Rodar: npm run test:concluir-etapa   (banco de TESTE)
//
// A pergunta: seis conclusões de etapa movem UM trabalho até o fim, e só a
// última o encerra?
//
// O cenário é o pedido de certidão real: preparar → enviar → aguardar →
// receber → conferir → validar. É o caso em que errar dói: concluir "enviar ao
// cartório" e ver a tarefa fechada significaria dar por obtido um documento que
// ninguém recebeu.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import { concluirEtapa } from "@/lib/operacional/tarefa-etapa"
import { atribuirTarefa, iniciarTarefa } from "@/lib/operacional/tarefa-comandos"
import { bloquearTarefa, aguardarTerceiro, retomarDeEspera, cancelarTarefa, reabrirTarefa } from "@/lib/operacional/tarefa-ciclo"
import { dossieDaTarefa } from "@/lib/operacional/tarefa-projecoes"

const MARCA = "ETAPA"
const ETAPAS = ["preparar_pedido", "enviar_cartorio", "aguardar", "receber", "conferir", "validar"]

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
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@etapa.test" } } })
}

async function palco(sufixo: string) {
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${sufixo}`, name: "Certidão de Nascimento - Inteiro Teor", natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} ${sufixo}` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} ${sufixo}`, pais: "espanha", arvoreId: arv.id }, select: { id: true } })
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

const ler = (id: number) =>
  prisma.tarefa.findUniqueOrThrow({
    where: { id },
    select: { id: true, statusTarefa: true, concluida: true, dataConclusao: true, workflowStepInstanceId: true, dataInicio: true },
  })

const stepDe = (id: number) =>
  prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id }, select: { status: true, completedAt: true } })

const logs = (id: number, acao?: string) =>
  prisma.logAuditoria.findMany({ where: { entidade: "Tarefa", entidadeId: id, ...(acao ? { acao } : {}) }, select: { acao: true, detalhes: true, usuarioId: true } })

async function main() {
  exigirBancoDeTeste("prova a porta de conclusão de etapa")
  await limpar()
  const dani = await prisma.usuario.create({ data: { nome: "Dani", email: "dani@etapa.test", senha: "x", tipo: "assistente" }, select: { id: true } })
  const admin = await prisma.usuario.create({ data: { nome: "Chefe", email: "chefe@etapa.test", senha: "x", tipo: "admin" }, select: { id: true } })

  console.log("CONCLUIR ETAPA — seis etapas, um trabalho\n")

  const p = await palco("A")
  await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: dani.id, autorId: admin.id })
  await iniciarTarefa({ tarefaId: p.tarefaId, autorId: dani.id })

  // ═════════════════════════════════════════════════════════════════════════
  secao("A/B/D) Concluir etapa intermediária: mesma tarefa, próxima ativa")
  // ═════════════════════════════════════════════════════════════════════════
  const nAntes = await prisma.tarefa.count({ where: { processoId: p.processoId } })
  const r1 = await concluirEtapa({ tarefaId: p.tarefaId, autorId: dani.id })
  ok("A) a etapa foi concluída", r1.ok === true, r1.ok ? "" : r1.mensagem)
  ok("A) mesmo taskId", r1.ok && r1.tarefaId === p.tarefaId)
  ok("A) nenhuma tarefa criada", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === nAntes)
  ok("A) a etapa 1 está CONCLUIDO", (await stepDe(p.stepIds[0])).status === "CONCLUIDO")
  ok("A) com data de conclusão", (await stepDe(p.stepIds[0])).completedAt != null)
  ok("B) a etapa 2 foi ATIVADA", (await stepDe(p.stepIds[1])).status === "DISPONIVEL")
  ok("B) e virou a etapa corrente da tarefa", (await ler(p.tarefaId)).workflowStepInstanceId === p.stepIds[1])
  ok("B) o serviço informa a próxima", r1.ok && r1.proximaEtapaId === p.stepIds[1])
  const t1 = await ler(p.tarefaId)
  ok("D) a TAREFA continua aberta", t1.concluida === false && t1.statusTarefa === "EM_ANDAMENTO", t1.statusTarefa)
  ok("D) sem data de conclusão", t1.dataConclusao === null)

  // ═════════════════════════════════════════════════════════════════════════
  secao("E) Retry idempotente — nem efeito nem evento duplicados")
  // ═════════════════════════════════════════════════════════════════════════
  const logsAntes = (await logs(p.tarefaId, "TAREFA_ETAPA_CONCLUIDA")).length
  const retry = await concluirEtapa({ tarefaId: p.tarefaId, etapaId: p.stepIds[0], autorId: dani.id })
  ok("E) o retry devolve ok", retry.ok === true)
  ok("E) dizendo que já estava concluída", retry.ok && retry.jaEstavaConcluida === true)
  ok("E) sem gravar segundo evento", (await logs(p.tarefaId, "TAREFA_ETAPA_CONCLUIDA")).length === logsAntes, `${logsAntes}`)
  ok("E) e sem mexer na etapa 2", (await stepDe(p.stepIds[1])).status === "DISPONIVEL")

  // ═════════════════════════════════════════════════════════════════════════
  secao("Ordem — não se pula etapa obrigatória")
  // ═════════════════════════════════════════════════════════════════════════
  const pulo = await concluirEtapa({ tarefaId: p.tarefaId, etapaId: p.stepIds[4], autorId: dani.id })
  ok("concluir a 5 com a 2 aberta é recusado", pulo.ok === false && pulo.codigo === "DEPENDENCIA_PENDENTE",
    pulo.ok ? "" : pulo.mensagem)

  // ═════════════════════════════════════════════════════════════════════════
  secao("F) Dupla conclusão simultânea — uma transição só")
  // ═════════════════════════════════════════════════════════════════════════
  const [a, b] = await Promise.all([
    concluirEtapa({ tarefaId: p.tarefaId, etapaId: p.stepIds[1], autorId: dani.id }),
    concluirEtapa({ tarefaId: p.tarefaId, etapaId: p.stepIds[1], autorId: dani.id }),
  ])
  const vencedores = [a, b].filter((r) => r.ok && !r.jaEstavaConcluida).length
  ok("F) exatamente uma transição efetiva", vencedores === 1, `${vencedores}`)
  ok("F) a etapa ficou concluída uma vez só",
    (await logs(p.tarefaId, "TAREFA_ETAPA_CONCLUIDA")).filter((l) => (l.detalhes as { etapaId?: number })?.etapaId === p.stepIds[1]).length === 1)
  ok("F) a etapa 3 foi ativada uma vez", (await stepDe(p.stepIds[2])).status === "DISPONIVEL")

  // ═════════════════════════════════════════════════════════════════════════
  secao("15/16) Bloqueio e espera barram a conclusão")
  // ═════════════════════════════════════════════════════════════════════════
  await bloquearTarefa({ tarefaId: p.tarefaId, autorId: dani.id, motivo: "falta procuração" })
  const bloq = await concluirEtapa({ tarefaId: p.tarefaId, autorId: dani.id })
  ok("15) tarefa bloqueada recusa conclusão", bloq.ok === false && bloq.codigo === "TAREFA_BLOQUEADA")
  const forcado = await concluirEtapa({ tarefaId: p.tarefaId, autorId: admin.id, permiteForcar: true })
  ok("15) mas o administrador pode forçar", forcado.ok === true)
  ok("15) e a auditoria registra que foi forçada",
    (await logs(p.tarefaId, "TAREFA_ETAPA_CONCLUIDA")).some((l) => (l.detalhes as { forcada?: boolean })?.forcada !== undefined))

  await aguardarTerceiro({ tarefaId: p.tarefaId, autorId: dani.id, motivo: "cartório" })
  const esperando = await concluirEtapa({ tarefaId: p.tarefaId, autorId: dani.id })
  ok("16) tarefa aguardando terceiro recusa conclusão", esperando.ok === false && esperando.codigo === "TAREFA_AGUARDANDO")
  await retomarDeEspera({ tarefaId: p.tarefaId, autorId: dani.id })
  ok("16) depois da retomada, conclui normalmente",
    (await concluirEtapa({ tarefaId: p.tarefaId, autorId: dani.id })).ok === true)

  // ═════════════════════════════════════════════════════════════════════════
  secao("C) Só a etapa TERMINAL conclui a tarefa")
  // ═════════════════════════════════════════════════════════════════════════
  // Faltam a 5 e a 6. A 5 não pode encerrar.
  const r5 = await concluirEtapa({ tarefaId: p.tarefaId, autorId: dani.id })
  ok("C) concluir a penúltima NÃO encerra", r5.ok && r5.tarefaConcluida === false, r5.ok ? r5.statusTarefa : "")
  ok("C) a tarefa segue aberta", (await ler(p.tarefaId)).concluida === false)

  const r6 = await concluirEtapa({ tarefaId: p.tarefaId, autorId: dani.id })
  ok("C) concluir a ÚLTIMA encerra a tarefa", r6.ok && r6.tarefaConcluida === true, r6.ok ? r6.statusTarefa : "")
  const tf = await ler(p.tarefaId)
  ok("C) status concluído", tf.concluida === true && tf.statusTarefa === "CONCLUIDO_RECEBIDO", tf.statusTarefa)
  ok("C) com dataConclusao", tf.dataConclusao != null)
  ok("C) e continua sendo UMA tarefa", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === nAntes)
  ok("C) todas as 6 etapas concluídas",
    (await prisma.phaseWorkflowStepInstance.count({ where: { workflowInstanceId: p.instanciaId, status: "CONCLUIDO" } })) === 6)

  // ═════════════════════════════════════════════════════════════════════════
  secao("H/G) Tarefa encerrada e cancelada recusam conclusão")
  // ═════════════════════════════════════════════════════════════════════════
  const depois = await concluirEtapa({ tarefaId: p.tarefaId, autorId: dani.id })
  ok("H) tarefa concluída recusa nova conclusão", depois.ok === false && depois.codigo === "TAREFA_TERMINAL")

  const q = await palco("G")
  await cancelarTarefa({ tarefaId: q.tarefaId, autorId: admin.id, motivo: "cliente desistiu" })
  const canc = await concluirEtapa({ tarefaId: q.tarefaId, autorId: dani.id })
  ok("G) tarefa cancelada recusa conclusão", canc.ok === false && canc.codigo === "TAREFA_TERMINAL")
  ok("G) e a etapa continua intocada", (await stepDe(q.stepIds[0])).status === "DISPONIVEL")

  // ═════════════════════════════════════════════════════════════════════════
  secao("K) Auditoria — um registro, com antes e depois")
  // ═════════════════════════════════════════════════════════════════════════
  const todos = await logs(p.tarefaId)
  const conclusoes = todos.filter((l) => l.acao.startsWith("TAREFA_ETAPA_CONCLUIDA"))
  ok("K) uma auditoria por etapa concluída", conclusoes.length === 6, `${conclusoes.length}`)
  const um = conclusoes[0].detalhes as Record<string, unknown>
  for (const campo of ["tarefaId", "workflowInstanceId", "etapaId", "stepKey", "etapaDe", "etapaPara", "tarefaDe", "tarefaPara", "em"]) {
    ok(`K) o log traz ${campo}`, um[campo] !== undefined)
  }
  ok("K) todas com autor", conclusoes.every((l) => l.usuarioId != null))
  ok("K) a última distingue que encerrou a tarefa",
    todos.some((l) => l.acao === "TAREFA_ETAPA_CONCLUIDA_E_TAREFA_CONCLUIDA"))

  // ═════════════════════════════════════════════════════════════════════════
  secao("L) O reconciliador NÃO desfaz a conclusão")
  // ═════════════════════════════════════════════════════════════════════════
  const antesRec = JSON.stringify(await ler(p.tarefaId))
  for (let i = 0; i < 5; i++) await reconciliarTarefas({ processoId: p.processoId })
  ok("L) a tarefa concluída continua igual", JSON.stringify(await ler(p.tarefaId)) === antesRec)
  ok("L) e não nasceu tarefa nova", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === nAntes)

  // ═════════════════════════════════════════════════════════════════════════
  secao("Reabrir e reconcluir — o ciclo fecha sem duplicar")
  // ═════════════════════════════════════════════════════════════════════════
  await reabrirTarefa({ tarefaId: p.tarefaId, autorId: admin.id, motivo: "cartório mandou documento errado", stepDestinoId: p.stepIds[5] })
  const reab = await ler(p.tarefaId)
  ok("reaberta volta a EM_ANDAMENTO", reab.statusTarefa === "EM_ANDAMENTO")
  ok("com a etapa de destino como corrente", reab.workflowStepInstanceId === p.stepIds[5])
  const rf = await concluirEtapa({ tarefaId: p.tarefaId, autorId: dani.id })
  ok("reconcluir a última encerra de novo", rf.ok && rf.tarefaConcluida === true)
  ok("sem criar tarefa nova", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === nAntes)

  // ═════════════════════════════════════════════════════════════════════════
  secao("M) O dossiê continua respondendo pelo mesmo taskId")
  // ═════════════════════════════════════════════════════════════════════════
  const d = await dossieDaTarefa(p.tarefaId)
  ok("M) o dossiê é da mesma tarefa", d?.taskId === p.tarefaId)
  ok("M) mostra as 6 etapas internas", (d?.etapas.length ?? 0) === 6, `${d?.etapas.length}`)
  ok("M) e o histórico completo", (d?.historico.length ?? 0) >= 6, `${d?.historico.length}`)

  // ═════════════════════════════════════════════════════════════════════════
  secao("Etapa de outra tarefa é recusada")
  // ═════════════════════════════════════════════════════════════════════════
  const outra = await palco("X")
  const cruzada = await concluirEtapa({ tarefaId: outra.tarefaId, etapaId: p.stepIds[0], autorId: dani.id })
  ok("etapa de outro workflow é recusada", cruzada.ok === false && cruzada.codigo === "ETAPA_DE_OUTRA_TAREFA")

  await limpar()

  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    process.exit(1)
  }
  console.log("Seis etapas moveram um trabalho; só a última o encerrou.\n")
}

main().catch((e) => { console.error("falhou:", e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
