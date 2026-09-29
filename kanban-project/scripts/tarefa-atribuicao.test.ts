// scripts/tarefa-atribuicao.test.ts
// ============================================================================
// ATRIBUIÇÃO, TRANSFERÊNCIA E NOTIFICAÇÃO — testes A–L.
// Rodar: npm run test:tarefa-atribuicao   (banco de TESTE)
//
// A pergunta: mudar de dono muda a MESMA tarefa, avisa UMA vez, e não vira
// ruído quando o retry acontece?
//
// CONTRATO DO SINO AGRUPADO (29/09/2026): "avisa" = UM aviso não lido por (pessoa,
// família, tipo), atualizado no lugar. Atribuir → CHEGOU_TRABALHO para quem recebe;
// transferir → MUDOU_DE_MAO para quem perdeu + CHEGOU_TRABALHO para quem recebeu;
// prazo/atraso viraram partes do PRECISA_AGIR ("vencidas · vencem hoje · vencem amanhã").
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { atribuirTarefa, transferirTarefa, iniciarTarefa } from "@/lib/operacional/tarefa-comandos"
import { avaliarPrecisaAgir } from "@/lib/operacional/avisos-sino"
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
  const users = await prisma.usuario.findMany({ where: { email: { endsWith: "@atrib.test" } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({
    where: { OR: [{ tarefa: { processoId: { in: ids } } }, { processoId: { in: ids } }, { destinatarioId: { in: users.map((u) => u.id) } }] },
  })
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
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo`, arvoreId: arv.id }, select: { id: true } })
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

/** Avisos AGRUPADOS que listam a tarefa (o sino novo não tem aviso por tarefa: `tarefaIds`). */
const notifs = (tarefaId: number, tipo?: string) =>
  prisma.notificacaoOperacional.findMany({
    where: { agrupado: true, tarefaIds: { has: tarefaId }, ...(tipo ? { tipo } : {}) },
    select: { id: true, tipo: true, destinatarioId: true, titulo: true, link: true, contagem: true, processoId: true, resumo: true, lidaEm: true },
    orderBy: { id: "asc" },
  })

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
  secao("E/F) Atribuição cria UM aviso (CHEGOU_TRABALHO) — e o retry não cria outro")
  // ═════════════════════════════════════════════════════════════════════════
  let ns = await notifs(p.tarefaId, "CHEGOU_TRABALHO")
  ok("exatamente um aviso", ns.length === 1, `${ns.length}`)
  ok("para a Daniela", ns[0]?.destinatarioId === daniela.id)
  ok("da família do processo, cobrindo a tarefa (contagem 1)", ns[0]?.processoId === p.processoId && ns[0]?.contagem === 1)
  // O aviso leva à FILA da família (`aba=fila`, as novas no topo): o sino é agrupado,
  // não aponta mais para UMA tarefa. Nunca /kanban.
  ok("com link canônico para a fila da família",
    ns[0]?.link === `/operacao?processo=${p.processoId}&aba=fila`, String(ns[0]?.link))
  ok("e o título diz o que aconteceu", /— 1 tarefa atribuída a você$/.test(ns[0]?.titulo ?? ""), ns[0]?.titulo)
  ok("nenhum aviso legado por tarefa (agrupado=false / tarefaId)",
    (await prisma.notificacaoOperacional.count({ where: { destinatarioId: daniela.id, OR: [{ agrupado: false }, { tarefaId: { not: null } }] } })) === 0)

  // O retry: mesma chamada de novo. A tarefa já é da Daniela, então o comando
  // recusa — e, sobretudo, não nasce um segundo aviso nem a contagem sobe.
  const retry = await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: gestor.id })
  ok("reatribuir para a mesma pessoa é recusado", retry.ok === false && retry.codigo === "MESMO_RESPONSAVEL")
  const nsRetry = await notifs(p.tarefaId, "CHEGOU_TRABALHO")
  ok("e continua havendo UM aviso, com contagem 1", nsRetry.length === 1 && nsRetry[0].contagem === 1)

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
  const nt = await notifs(p.tarefaId, "CHEGOU_TRABALHO")
  ok("o novo responsável foi avisado (CHEGOU_TRABALHO)", nt.length === 1 && nt[0].destinatarioId === joao.id && nt[0].contagem === 1)
  const perdeu = await notifs(p.tarefaId, "MUDOU_DE_MAO")
  ok("quem perdeu a tarefa foi avisado (MUDOU_DE_MAO), e só ela", perdeu.length === 1 && perdeu[0].destinatarioId === daniela.id)
  ok("nenhum aviso de posse sobrou para a Daniela sobre a tarefa (regra 5)",
    (await notifs(p.tarefaId)).filter((n) => n.destinatarioId === daniela.id).every((n) => n.tipo === "MUDOU_DE_MAO"))
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

  // Prazo vencido → "N vencidas" no PRECISA_AGIR da família do responsável ATUAL (o
  // vencedor da corrida acima), uma linha só — atualizada no lugar, nunca um aviso por dia.
  await prisma.tarefa.update({
    where: { id: p.tarefaId },
    data: { dataPrazo: new Date(Date.now() - 86400000), statusTarefa: "EM_ANDAMENTO", concluida: false },
  })
  const dono = (await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { responsavelId: true } })).responsavelId
  ok("pré-condição: a tarefa tem dono depois da corrida", dono != null)
  const agirDaTarefa = () => notifs(p.tarefaId, "PRECISA_AGIR")
  // A varredura é GLOBAL de propósito (em produção ela roda para todo mundo), então a
  // asserção não pode ser sobre o contador dela: uma tarefa vencida deixada por outro
  // cenário entraria na conta. O que é DESTE cenário é o aviso desta tarefa.
  await avaliarPrecisaAgir({ modo: "FOTO" })
  const agir1 = await agirDaTarefa()
  ok("a varredura avisa a tarefa atrasada, ao responsável atual",
    agir1.length === 1 && agir1[0].destinatarioId === dono && (agir1[0].resumo as { vencidas?: number[] } | null)?.vencidas?.includes(p.tarefaId) === true, JSON.stringify(agir1))
  ok("o texto diz '1 vencida'", /— 1 vencida$/.test(agir1[0]?.titulo ?? ""), agir1[0]?.titulo)
  const v2 = await avaliarPrecisaAgir({ modo: "FOTO" })
  ok("rodar de novo no mesmo dia não duplica", (await agirDaTarefa()).length === 1, `${(await agirDaTarefa()).length}`)
  ok("e a segunda varredura não conta ESTE aviso como novo nem o atualiza",
    (await agirDaTarefa())[0]?.id === agir1[0]?.id && v2.criados === 0, JSON.stringify({ criados: v2.criados, semMudanca: v2.semMudanca }))
  ok("o atraso não criou tarefa nova", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === 1)
  ok("o aviso é da família e aponta para a aba de acompanhamento dela",
    agir1[0]?.processoId === p.processoId && agir1[0]?.link === `/operacao?processo=${p.processoId}&aba=acompanhamento`, String(agir1[0]?.link))

  // Prazo futuro (amanhã) → o MESMO aviso é recomposto no lugar ("1 vence amanhã"), único.
  await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { dataPrazo: new Date(Date.now() + 86400000) } })
  await avaliarPrecisaAgir({ modo: "FOTO" })
  await avaliarPrecisaAgir({ modo: "FOTO" })
  const agir2 = await agirDaTarefa()
  ok("aviso de prazo também é único (o mesmo aviso, recomposto no lugar)", agir2.length === 1 && agir2[0].id === agir1[0].id, JSON.stringify(agir2.map((n) => n.id)))
  ok("e diz '1 vence amanhã'", /— 1 vence amanhã$/.test(agir2[0]?.titulo ?? ""), agir2[0]?.titulo)

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
