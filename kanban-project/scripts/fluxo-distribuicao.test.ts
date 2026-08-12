// scripts/fluxo-distribuicao.test.ts
// ============================================================================
// NASCE SEM RESPONSÁVEL → GESTOR ATRIBUI → FUNCIONÁRIO RECEBE.
// Rodar: npm run test:fluxo-distribuicao   (banco de TESTE)
//
// A pergunta desta camada é uma só: o trabalho CHEGA até quem executa, sem que
// ele precise entrar no processo, achar a fase, achar o documento e criar uma
// atividade para si mesmo?
//
// E a prova que sustenta tudo: é a MESMA tarefa dos dois lados. Se o `taskId`
// mudasse entre "sem responsável" e "minha fila", teríamos cópia — e cópia é
// como a árvore legada de subtarefas nasceu.
//
// SEM RESPONSÁVEL é estado operacional NORMAL. Não é órfã, não é erro, não é
// bloqueio: é trabalho existente esperando uma decisão humana de distribuição.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import { atribuirTarefa, transferirTarefa } from "@/lib/operacional/tarefa-comandos"
import { devolverAFila } from "@/lib/operacional/tarefa-ciclo"
import { minhaFila, semResponsavel, ordenarFila, type LinhaDeFila } from "@/lib/operacional/tarefa-projecoes"

const MARCA = "DISTR"

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
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.workflowEvento.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@distr.test" } } })
}

/**
 * O CENÁRIO REAL: processo criado, obrigação executável, workflow publicado.
 * A tarefa NÃO é criada à mão — quem a cria é o motor, ao reconciliar. É isso
 * que torna o teste uma prova e não uma encenação.
 */
async function palco(sufixo: string, prioridade?: "URGENTE" | "ALTA" | "MEDIA" | "BAIXA", diasPrazo?: number) {
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${sufixo}`, name: "Certidão de Nascimento", natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} ${sufixo}` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} Família ${sufixo}`, pais: "espanha", arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: "genealogia" },
    select: { id: true },
  })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "João", sobrenome: "da Silva" }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-n-${sufixo}-${proc.id}` },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i-${sufixo}-${proc.id}` },
    select: { id: true },
  })
  for (const [i, key] of ["pesquisar_registro", "consultar_cartorio", "confirmar_livro", "validar_dados"].entries()) {
    await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "genealogia", stepKey: `${key}_${sufixo}`,
        ordem: i + 1, tipo: "HUMANO", obrigatorio: true, status: i === 0 ? "DISPONIVEL" : "PENDENTE",
        necessidadeId: nec.id, pessoaId: pes.id, papel: "equipe_documental", slaDays: 5, ciclo: 1,
        snapshot: { label: i === 0 ? "Pesquisar registro" : key } as never,
        chaveIdempotencia: `${MARCA}-s-${sufixo}-${proc.id}-${i}`,
      },
    })
  }
  // O MOTOR cria a tarefa — ninguém a cria à mão.
  await reconciliarTarefas({ processoId: proc.id })
  const t = await prisma.tarefa.findFirstOrThrow({ where: { processoId: proc.id }, select: { id: true } })
  if (prioridade || diasPrazo !== undefined) {
    await prisma.tarefa.update({
      where: { id: t.id },
      data: {
        ...(prioridade ? { prioridade } : {}),
        ...(diasPrazo !== undefined ? { dataPrazo: new Date(Date.now() + diasPrazo * 86400000) } : {}),
      },
    })
  }
  return { processoId: proc.id, tarefaId: t.id, pessoaId: pes.id }
}

const naFila = (linhas: LinhaDeFila[], taskId: number) => linhas.some((l) => l.taskId === taskId)
const notificacoes = (tarefaId: number) =>
  prisma.notificacaoOperacional.findMany({ where: { tarefaId }, select: { id: true, destinatarioId: true, tipo: true, chaveIdempotencia: true } })

async function main() {
  exigirBancoDeTeste("prova o fluxo de distribuição de tarefas")
  await limpar()

  const gestor = await prisma.usuario.create({ data: { nome: "Gestor", email: "gestor@distr.test", senha: "x", tipo: "admin" }, select: { id: true } })
  const daniela = await prisma.usuario.create({ data: { nome: "Daniela Brait", email: "daniela@distr.test", senha: "x", tipo: "assistente" }, select: { id: true } })
  const maria = await prisma.usuario.create({ data: { nome: "Maria Souza", email: "maria@distr.test", senha: "x", tipo: "assistente" }, select: { id: true } })

  console.log("DISTRIBUIÇÃO — nasce sem responsável, o gestor atribui, o trabalho chega\n")

  // ═════════════════════════════════════════════════════════════════════════
  secao("§21 · 1-6) A tarefa nasce sem responsável e isso é NORMAL")
  // ═════════════════════════════════════════════════════════════════════════
  const p = await palco("A")
  const X = p.tarefaId

  const t0 = await prisma.tarefa.findUniqueOrThrow({ where: { id: X }, select: { responsavelId: true, statusTarefa: true, origem: true, workflowInstanceId: true } })
  ok("1-3) o motor criou a tarefa (taskId X)", Number.isInteger(X) && X > 0, `taskId ${X}`)
  ok("4) responsavelId = null", t0.responsavelId === null)
  ok("4) e isso NÃO é estado de erro — a tarefa está ativa", t0.statusTarefa === "NAO_INICIADA", t0.statusTarefa)
  // O motor carimba a origem exata (RECONCILIADOR); o que importa é que NÃO é
  // manual — tarefa manual não pode nascer sem alguém tê-la pedido.
  ok("4) nasceu do MOTOR, não à mão", t0.origem !== "MANUAL" && t0.origem != null, String(t0.origem))
  ok("11) uma tarefa para as 4 etapas — etapa não é tarefa",
    (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === 1)

  const sem0 = await semResponsavel()
  ok("5) aparece em SEM RESPONSÁVEL", naFila(sem0, X))
  ok("6) NÃO aparece na fila de ninguém", !naFila(await minhaFila(daniela.id), X) && !naFila(await minhaFila(maria.id), X))

  const linha = sem0.find((l) => l.taskId === X)!
  ok("§3) a linha traz processo/família", linha.processoNome?.startsWith(MARCA) === true, linha.processoNome ?? "—")
  ok("§3) a pessoa relacionada", linha.pessoaNome === "João da Silva", linha.pessoaNome ?? "—")
  ok("§3) a fase", linha.faseMacroKey === "genealogia", linha.faseMacroKey ?? "—")
  ok("§3) o serviço/documento", linha.servico === "Certidão de Nascimento", linha.servico ?? "—")
  ok("§9) a ETAPA ATUAL, não a lista de etapas", linha.etapaAtual === "Pesquisar registro", linha.etapaAtual ?? "—")
  ok("§3) a data de criação", linha.criadaEm != null)
  ok("§3) o prazo derivado do SLA", linha.dataPrazo != null)
  ok("§3) status e prioridade", linha.statusTarefa === "NAO_INICIADA" && linha.prioridade === "MEDIA")
  ok("§14) ainda sem responsável", linha.responsavelId === null && linha.atribuidaEm === null)

  // ═════════════════════════════════════════════════════════════════════════
  secao("§21 · 7-13) O gestor atribui — mesma tarefa, do outro lado")
  // ═════════════════════════════════════════════════════════════════════════
  const r = await atribuirTarefa({ tarefaId: X, responsavelId: daniela.id, autorId: gestor.id })
  ok("7-8) assignTask executado", r.ok === true, r.ok ? "" : r.mensagem)
  ok("9) MESMO taskId", r.ok && r.tarefaId === X, `${r.ok ? r.tarefaId : "-"} === ${X}`)

  const t1 = await prisma.tarefa.findUniqueOrThrow({ where: { id: X }, select: { responsavelId: true, dataAtribuicao: true, atribuidoPorId: true } })
  ok("10) responsavelId atualizado", t1.responsavelId === daniela.id)
  ok("§5) registra QUANDO foi atribuída", t1.dataAtribuicao != null)
  ok("§5) e QUEM atribuiu", t1.atribuidoPorId === gestor.id)
  ok("§5) com auditoria",
    (await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: X, acao: { startsWith: "TAREFA_ATRIBU" } } })) >= 1)

  ok("11) saiu de SEM RESPONSÁVEL", !naFila(await semResponsavel(), X))
  ok("12) apareceu na MINHA FILA da Daniela", naFila(await minhaFila(daniela.id), X))
  ok("12) e não na de Maria", !naFila(await minhaFila(maria.id), X))

  const n1 = await notificacoes(X)
  ok("13) UMA notificação, para a Daniela", n1.length === 1 && n1[0].destinatarioId === daniela.id, `${n1.length}`)

  // ═════════════════════════════════════════════════════════════════════════
  secao("§25) Retry de assignTask não duplica nada")
  // ═════════════════════════════════════════════════════════════════════════
  const rr = await atribuirTarefa({ tarefaId: X, responsavelId: daniela.id, autorId: gestor.id })
  ok("retry é recusado sem efeito", rr.ok === false && rr.codigo === "MESMO_RESPONSAVEL", rr.ok ? "aceitou!" : rr.codigo)
  ok("nenhuma tarefa nova", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === 1)
  ok("nenhuma notificação nova", (await notificacoes(X)).length === 1)

  // ═════════════════════════════════════════════════════════════════════════
  secao("§24) Concorrência: ninguém sobrescreve em silêncio")
  // ═════════════════════════════════════════════════════════════════════════
  // Gestor A leu a tarefa quando ela ainda não tinha dono (lockVersion antigo).
  // Gestor B já atribuiu para Daniela. A tentativa de A com o estado velho
  // precisa FALHAR — e não trocar a Daniela pela Maria sem ninguém saber.
  const lvAntigo = 0
  const conflito = await atribuirTarefa({ tarefaId: X, responsavelId: maria.id, autorId: gestor.id, lockVersion: lvAntigo })
  ok("a atribuição com estado velho é recusada", conflito.ok === false && conflito.codigo === "CONFLITO",
    conflito.ok ? "sobrescreveu!" : conflito.codigo)
  ok("a responsabilidade permanece de quem chegou primeiro",
    (await prisma.tarefa.findUniqueOrThrow({ where: { id: X }, select: { responsavelId: true } })).responsavelId === daniela.id)
  ok("e nenhuma notificação foi criada pelo conflito", (await notificacoes(X)).length === 1)

  // ═════════════════════════════════════════════════════════════════════════
  secao("§22) Transferência: Daniela → Maria, mesma tarefa")
  // ═════════════════════════════════════════════════════════════════════════
  const tr = await transferirTarefa({ tarefaId: X, responsavelId: maria.id, autorId: gestor.id, motivo: "férias da Daniela" })
  ok("transferTask executado", tr.ok === true, tr.ok ? "" : tr.mensagem)
  ok("MESMO taskId", tr.ok && tr.tarefaId === X)
  ok("saiu da fila da Daniela", !naFila(await minhaFila(daniela.id), X))
  ok("entrou na fila da Maria", naFila(await minhaFila(maria.id), X))
  const n2 = await notificacoes(X)
  ok("Maria recebeu UMA notificação pertinente",
    n2.filter((x) => x.destinatarioId === maria.id).length === 1, `${n2.length} no total`)
  ok("o histórico registra a transferência",
    (await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: X } })) >= 2)

  // ═════════════════════════════════════════════════════════════════════════
  secao("§23) Devolver para SEM RESPONSÁVEL")
  // ═════════════════════════════════════════════════════════════════════════
  const un = await devolverAFila({ tarefaId: X, autorId: gestor.id, motivo: "redistribuir" })
  ok("unassignTask executado", un.ok === true, un.ok ? "" : un.mensagem)
  ok("MESMO taskId", un.ok && un.tarefaId === X)
  const t2 = await prisma.tarefa.findUniqueOrThrow({ where: { id: X }, select: { responsavelId: true, dataAtribuicao: true } })
  ok("responsavelId = null", t2.responsavelId === null)
  ok("e a marca de atribuição foi limpa junto", t2.dataAtribuicao === null)
  ok("saiu da fila da Maria", !naFila(await minhaFila(maria.id), X))
  ok("voltou para SEM RESPONSÁVEL", naFila(await semResponsavel(), X))
  ok("§15) do começo ao fim foi SEMPRE a mesma tarefa",
    (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === 1, "nenhuma cópia foi criada")

  // ═════════════════════════════════════════════════════════════════════════
  secao("§10) A ordem é operacional, não cronológica")
  // ═════════════════════════════════════════════════════════════════════════
  const atrasada = await palco("B", "MEDIA", -3)
  const urgente = await palco("C", "URGENTE", 30)
  const proxima = await palco("D", "MEDIA", 2)
  const distante = await palco("E", "MEDIA", 60)
  for (const t of [atrasada, urgente, proxima, distante]) {
    await atribuirTarefa({ tarefaId: t.tarefaId, responsavelId: daniela.id, autorId: gestor.id })
  }
  const fila = await minhaFila(daniela.id)
  const ordem = fila.map((l) => l.taskId)
  ok("1º as atrasadas", ordem[0] === atrasada.tarefaId, `${ordem.join(", ")}`)
  ok("2º as urgentes", ordem[1] === urgente.tarefaId)
  ok("3º a que vence primeiro", ordem[2] === proxima.tarefaId)
  ok("por último a mais distante", ordem[3] === distante.tarefaId)
  ok("a ordenação é determinística — duas leituras, a mesma ordem",
    JSON.stringify((await minhaFila(daniela.id)).map((l) => l.taskId)) === JSON.stringify(ordem))
  ok("sem prazo NÃO é urgência: vai para o fim",
    ordenarFila([
      { ...fila[0], taskId: 901, atrasada: false, prioridade: "MEDIA", dataPrazo: null },
      { ...fila[0], taskId: 902, atrasada: false, prioridade: "MEDIA", dataPrazo: new Date(Date.now() + 9e8).toISOString() },
    ]).map((l) => l.taskId).join(",") === "902,901")

  // ═════════════════════════════════════════════════════════════════════════
  secao("§8/§19) Minha Fila é projeção — e nada disso usa a árvore legada")
  // ═════════════════════════════════════════════════════════════════════════
  ok("§8) nenhuma tabela/entidade de fila foi criada",
    !Object.keys(prisma).some((k) => /minhaFila|filaTarefa/i.test(k)))
  ok("§19) nenhuma tarefa da nova operação é parte de outra tarefa",
    !Object.keys(prisma.tarefa.fields).some((f) => /tarefaPai|subtarefa/i.test(f)))
  ok("§19) nem o discriminador de subtarefa legado",
    !Object.keys(prisma.tarefa.fields).some((f) => /tipoSubtarefa/i.test(f)))

  // ═════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
  await limpar()
  await prisma.$disconnect()
  if (falhou > 0) process.exit(1)
  console.log("O trabalho nasce, é distribuído e chega — sempre a mesma tarefa.")
}

main().catch(async (e) => { console.error("falhou:", e); await prisma.$disconnect(); process.exit(1) })
