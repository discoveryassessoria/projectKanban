// scripts/tarefa-atribuicao.test.ts
// ============================================================================
// ATRIBUIÇÃO, TRANSFERÊNCIA E NOTIFICAÇÃO — testes A–L.
// Rodar: npm run test:tarefa-atribuicao   (banco de TESTE)
//
// A pergunta: mudar de dono muda a MESMA tarefa, avisa UMA vez, e não vira
// ruído quando o retry acontece?
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { atribuirTarefa, transferirTarefa, iniciarTarefa, avisarPrazosEAtrasos, linkDaTarefa } from "@/lib/operacional/tarefa-comandos"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"

const MARCA = "ATRIB-TEST"

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
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefa: { processoId: { in: ids } } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@atrib.test" } } })
}

async function palco() {
  const item = await prisma.itemCatalogo.create({
    data: { code: `${MARCA}_C`, name: "Certidão de Nascimento - Inteiro Teor", natureza: "DOCUMENTO" }, select: { id: true },
  })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo`, pais: "espanha", arvoreId: arv.id }, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Ademir", sobrenome: "Matheus" }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${proc.id}` },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-inst-${proc.id}` },
    select: { id: true },
  })
  const step = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "genealogia", stepKey: "localizar_registro",
      ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "DISPONIVEL", necessidadeId: nec.id, pessoaId: pes.id,
      papel: "equipe_documental", slaDays: 5, chaveIdempotencia: `${MARCA}-step-${proc.id}`,
    },
    select: { id: true },
  })
  await reconciliarTarefas({ processoId: proc.id })
  const t = await prisma.tarefa.findFirstOrThrow({ where: { processoId: proc.id }, select: { id: true, lockVersion: true } })
  return { processoId: proc.id, necessidadeId: nec.id, instanciaId: inst.id, stepId: step.id, tarefaId: t.id, lockVersion: t.lockVersion }
}

const usuario = (nome: string) =>
  prisma.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@atrib.test`, senha: "x", tipo: "assistente" }, select: { id: true, nome: true } })

const notifs = (tarefaId: number, tipo?: string) =>
  prisma.notificacaoOperacional.findMany({ where: { tarefaId, ...(tipo ? { tipo } : {}) }, select: { id: true, tipo: true, destinatarioId: true, titulo: true, link: true, chaveIdempotencia: true } })

async function main() {
  exigirBancoDeTeste("prova atribuição, transferência e notificação canônicas")
  await limpar()
  const p = await palco()
  const daniela = await usuario("Daniela")
  const joao = await usuario("Joao")
  // O gestor precisa EXISTIR: a auditoria é transacional de propósito, então um
  // autor inválido derruba o ato inteiro em vez de gravar um log órfão.
  const gestor = await usuario("Gestor")

  console.log("ATRIBUIÇÃO E NOTIFICAÇÃO — a mesma tarefa muda de dono\n")

  // ═════════════════════════════════════════════════════════════════════════
  secao("A) Tarefa com equipe e sem responsável é estado LEGÍTIMO")
  // ═════════════════════════════════════════════════════════════════════════
  let t = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { responsavelId: true, equipeKey: true, statusTarefa: true } })
  ok("nasce sem responsável", t.responsavelId === null)
  ok("com equipe declarada", t.equipeKey === "equipe_documental", String(t.equipeKey))
  ok("e não é considerada erro (segue ativa)", t.statusTarefa === "NAO_INICIADA")
  ok("iniciar sem responsável é recusado",
    (await iniciarTarefa({ tarefaId: p.tarefaId, autorId: daniela.id })).ok === false)

  // ═════════════════════════════════════════════════════════════════════════
  secao("B) Atribuir muda a MESMA tarefa e não duplica")
  // ═════════════════════════════════════════════════════════════════════════
  const antes = await prisma.tarefa.count({ where: { processoId: p.processoId } })
  const r1 = await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: gestor.id })
  ok("a atribuição deu certo", r1.ok === true)
  ok("é a MESMA tarefa", r1.ok && r1.tarefaId === p.tarefaId)
  ok("nenhuma tarefa nova foi criada", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === antes)
  t = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { responsavelId: true, equipeKey: true, statusTarefa: true } })
  ok("o responsável mudou", t.responsavelId === daniela.id)
  ok("a equipe foi preservada", t.equipeKey === "equipe_documental")
  const comData = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { dataAtribuicao: true, atribuidoPorId: true } })
  ok("data e autor da atribuição registrados", comData.dataAtribuicao != null && comData.atribuidoPorId === gestor.id)
  ok("o workflow não foi recriado",
    (await prisma.phaseWorkflowInstance.count({ where: { processoId: p.processoId } })) === 1)

  // ═════════════════════════════════════════════════════════════════════════
  secao("E/F) Atribuição cria UMA notificação — e o retry não cria outra")
  // ═════════════════════════════════════════════════════════════════════════
  let ns = await notifs(p.tarefaId, "ATRIBUICAO")
  ok("exatamente uma notificação", ns.length === 1, `${ns.length}`)
  ok("para a Daniela", ns[0]?.destinatarioId === daniela.id)
  // O link do aviso é o MESMO deep-link da fila: processo + Central + taskId.
  // Enquanto ele era só `/operacao?taskId=`, clicar no sino levava à lista em
  // vez de levar ao trabalho.
  ok("com link canônico para a tarefa",
    ns[0]?.link === linkDaTarefa(p.tarefaId, p.processoId), String(ns[0]?.link))
  ok("e o título diz o que aconteceu", /Nova tarefa atribuída/.test(ns[0]?.titulo ?? ""))

  // O retry: mesma chamada de novo. A tarefa já é da Daniela, então o comando
  // recusa — e, sobretudo, não nasce uma segunda notificação.
  const retry = await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: gestor.id })
  ok("reatribuir para a mesma pessoa é recusado", retry.ok === false && retry.codigo === "MESMO_RESPONSAVEL")
  ok("e continua havendo UMA notificação", (await notifs(p.tarefaId, "ATRIBUICAO")).length === 1)

  // ═════════════════════════════════════════════════════════════════════════
  secao("L) Iniciar não cria workflow novo")
  // ═════════════════════════════════════════════════════════════════════════
  const wAntes = await prisma.phaseWorkflowInstance.count({ where: { processoId: p.processoId } })
  const ri = await iniciarTarefa({ tarefaId: p.tarefaId, autorId: daniela.id })
  ok("o responsável inicia a própria tarefa", ri.ok === true)
  const ti = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { statusTarefa: true, dataInicio: true } })
  ok("status vai a EM_ANDAMENTO", ti.statusTarefa === "EM_ANDAMENTO", ti.statusTarefa)
  ok("dataInicio preenchida", ti.dataInicio != null)
  ok("nenhum workflow novo", (await prisma.phaseWorkflowInstance.count({ where: { processoId: p.processoId } })) === wAntes)
  ok("quem não é o responsável não inicia",
    (await iniciarTarefa({ tarefaId: p.tarefaId, autorId: joao.id })).ok === false)

  // ═════════════════════════════════════════════════════════════════════════
  secao("C) Transferir muda a MESMA tarefa")
  // ═════════════════════════════════════════════════════════════════════════
  const rt = await transferirTarefa({ tarefaId: p.tarefaId, responsavelId: joao.id, autorId: gestor.id, motivo: "férias" })
  ok("a transferência deu certo", rt.ok === true)
  ok("mesmo taskId", rt.ok && rt.tarefaId === p.tarefaId)
  ok("uma tarefa só no processo", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === 1)
  ok("o responsável agora é o João",
    (await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { responsavelId: true } })).responsavelId === joao.id)
  const nt = await notifs(p.tarefaId, "TRANSFERENCIA")
  ok("o novo responsável foi avisado", nt.length === 1 && nt[0].destinatarioId === joao.id)
  const logT = await prisma.logAuditoria.findFirst({ where: { entidade: "Tarefa", entidadeId: p.tarefaId, acao: "TAREFA_TRANSFERIDA" }, select: { descricao: true, detalhes: true } })
  ok("a auditoria registra de-para e motivo",
    !!logT && /transferida/.test(logT.descricao ?? "") && /férias/.test(JSON.stringify(logT.detalhes)))

  // ═════════════════════════════════════════════════════════════════════════
  secao("Concorrência — dois gestores ao mesmo tempo")
  // ═════════════════════════════════════════════════════════════════════════
  // OS DOIS DESTINOS SÃO NOVOS de propósito. Um deles era o dono ATUAL, e aí o
  // perdedor podia falhar por "já é dessa pessoa" em vez de por conflito — o
  // teste passava ou não conforme a ordem em que as duas transações rodassem, e
  // uma falha intermitente ensina a equipe a reexecutar em vez de investigar.
  const terceiro = await usuario("Terceiro")
  const versao = (await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { lockVersion: true } })).lockVersion
  const [a, b] = await Promise.all([
    atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: gestor.id, lockVersion: versao }),
    atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: terceiro.id, autorId: gestor.id, lockVersion: versao }),
  ])
  ok("só um dos dois vence", [a.ok, b.ok].filter(Boolean).length === 1, `${a.ok}/${b.ok}`)
  const perdedor = a.ok ? b : a
  ok("o perdedor recebe CONFLITO, não sobrescreve", !perdedor.ok && perdedor.codigo === "CONFLITO")

  // ═════════════════════════════════════════════════════════════════════════
  secao("G/H/I) Prazo e atraso são da TAREFA; etapa não gera ruído")
  // ═════════════════════════════════════════════════════════════════════════
  const antesRuido = (await notifs(p.tarefaId)).length
  await prisma.phaseWorkflowStepInstance.update({ where: { id: p.stepId }, data: { status: "CONCLUIDO" } })
  await reconciliarTarefas({ processoId: p.processoId })
  ok("concluir etapa NÃO gera notificação", (await notifs(p.tarefaId)).length === antesRuido, `${(await notifs(p.tarefaId)).length}`)

  // Prazo vencido → aviso de atraso, um por dia.
  await prisma.tarefa.update({
    where: { id: p.tarefaId },
    data: { dataPrazo: new Date(Date.now() - 86400000), statusTarefa: "EM_ANDAMENTO", concluida: false },
  })
  // A varredura é GLOBAL de propósito (em produção ela roda para todo mundo),
  // então a asserção não pode ser sobre o contador dela: uma tarefa vencida
  // deixada por outro cenário entraria na conta e o teste passaria a depender
  // da ordem de execução. O que é DESTE cenário é o aviso desta tarefa.
  await avisarPrazosEAtrasos()
  ok("a varredura avisa a tarefa atrasada", (await notifs(p.tarefaId, "ATRASO")).length === 1)
  const v2 = await avisarPrazosEAtrasos()
  ok("rodar de novo no mesmo dia não duplica", (await notifs(p.tarefaId, "ATRASO")).length === 1, `${(await notifs(p.tarefaId, "ATRASO")).length}`)
  ok("e a segunda varredura não conta ESTE aviso como novo", v2.atraso === 0, JSON.stringify(v2))
  ok("o atraso não criou tarefa nova", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === 1)
  const nAtraso = await notifs(p.tarefaId, "ATRASO")
  ok("o aviso é da tarefa e aponta para ela",
    nAtraso[0]?.link === linkDaTarefa(p.tarefaId, p.processoId), String(nAtraso[0]?.link))

  // Prazo futuro dentro da janela → aviso de prazo, também um por dia.
  await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { dataPrazo: new Date(Date.now() + 86400000) } })
  await avisarPrazosEAtrasos()
  await avisarPrazosEAtrasos()
  ok("aviso de prazo também é único no dia", (await notifs(p.tarefaId, "PRAZO")).length === 1)

  // ═════════════════════════════════════════════════════════════════════════
  secao("J) Bloqueio não cria tarefa nova")
  // ═════════════════════════════════════════════════════════════════════════
  await prisma.phaseWorkflowStepInstance.update({ where: { id: p.stepId }, data: { status: "BLOQUEADO" } })
  await reconciliarTarefas({ processoId: p.processoId })
  ok("a tarefa fica BLOQUEADA",
    (await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { statusTarefa: true } })).statusTarefa === "BLOQUEADA")
  ok("e continua sendo UMA tarefa", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === 1)

  // ═════════════════════════════════════════════════════════════════════════
  secao("Tarefa encerrada não aceita mais mudança de dono")
  // ═════════════════════════════════════════════════════════════════════════
  await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { statusTarefa: "CONCLUIDO_RECEBIDO", concluida: true } })
  const rEnc = await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: gestor.id })
  ok("atribuir tarefa encerrada é recusado", !rEnc.ok && rEnc.codigo === "TERMINAL")

  await limpar()

  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    process.exit(1)
  }
  console.log("Mudar de dono muda a mesma tarefa, e avisa uma vez só.\n")
}

main().catch((e) => { console.error("falhou:", e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
