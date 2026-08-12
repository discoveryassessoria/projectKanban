// scripts/etapa-nao-e-tarefa.test.ts
// ============================================================================
// UMA TAREFA, N ETAPAS — a prova da arquitetura operacional.
// Rodar: npm run test:etapa-nao-e-tarefa   (banco de TESTE)
//
// A Emissão Documental é publicada com cinco passos: solicitar, aguardar,
// receber, conferir, validar. Isso NÃO são cinco tarefas — é UMA tarefa, a do
// documento daquela pessoa, com cinco etapas internas.
//
// O defeito que este teste tranca: a identidade da tarefa era `stepinst{id}`,
// então cada instância de passo ganhava a sua própria tarefa. Um documento
// virava cinco linhas na fila, com cinco prazos e cinco responsáveis, e
// concluir "solicitar" fechava uma tarefa sem que nada tivesse sido obtido.
//
// A granularidade que PRECISA sobreviver: dois documentos são duas obrigações,
// logo duas tarefas. O que não pode existir é 20 documentos × 5 passos = 100
// tarefas.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { garantirTarefaDePasso, carregarPreCondicoes } from "@/src/services/passo-tarefa"
import { atribuirTarefa, transferirTarefa, iniciarTarefa } from "@/lib/operacional/tarefa-comandos"
import { concluirEtapa } from "@/lib/operacional/tarefa-etapa"
import { aguardarTerceiro, retomarDeEspera, reabrirTarefa } from "@/lib/operacional/tarefa-ciclo"
import { minhaFila } from "@/lib/operacional/tarefa-projecoes"

const MARCA = "ETAPA5"
/** O workflow interno REAL da Emissão Documental. */
const PASSOS = ["Solicitar certidão", "Aguardar retorno do cartório", "Receber certidão", "Conferir certidão", "Validar certidão"]

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
  await prisma.documento.deleteMany({ where: { pessoa: { arvore: { nome: { startsWith: MARCA } } } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@etapa5.test" } } })
}

/** Um processo com N documentos, cada um com os 5 passos da Emissão Documental. */
async function palco(sufixo: string, documentos: string[]) {
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} ${sufixo}` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} ${sufixo}`, pais: "espanha", arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: "emissao_documental" },
    select: { id: true },
  })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Teste", sobrenome: "Operacional" }, select: { id: true } })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i-${sufixo}-${proc.id}` },
    select: { id: true },
  })

  const unidades: Array<{ necessidadeId: number; documentoId: number; stepIds: number[] }> = []
  for (const [d, nomeDoc] of documentos.entries()) {
    const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${sufixo}_${d}`, name: nomeDoc, natureza: "DOCUMENTO" }, select: { id: true } })
    const doc = await prisma.documento.create({ data: { pessoaId: pes.id, descricao: nomeDoc, status: "PENDENTE" }, select: { id: true } })
    const nec = await prisma.necessidadeDocumental.create({
      data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-n-${sufixo}-${d}-${proc.id}` },
      select: { id: true },
    })
    const stepIds: number[] = []
    for (const [i, label] of PASSOS.entries()) {
      const s = await prisma.phaseWorkflowStepInstance.create({
        data: {
          workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "emissao_documental",
          stepKey: `${sufixo}_d${d}_s${i}`, ordem: i + 1, tipo: "HUMANO", obrigatorio: true,
          // TODOS os cinco passos com geraTarefa=true — é exatamente a
          // configuração publicada hoje, e o ponto do teste é que ela NÃO
          // produz cinco tarefas.
          geraTarefa: true,
          status: i === 0 ? "DISPONIVEL" : "PENDENTE",
          necessidadeId: nec.id, documentoId: doc.id, pessoaId: pes.id, papel: "equipe_documental",
          slaDays: 5, ciclo: 1,
          snapshot: { titulo: `${nomeDoc} — Teste Operacional`, label } as never,
          chaveIdempotencia: `${MARCA}-s-${sufixo}-${d}-${i}-${proc.id}`,
        }, select: { id: true },
      })
      stepIds.push(s.id)
    }
    unidades.push({ necessidadeId: nec.id, documentoId: doc.id, stepIds })
  }

  // A MATERIALIZAÇÃO REAL: o serviço roda para CADA passo, como o motor faz.
  // Se a identidade da tarefa fosse o passo, sairiam 5 tarefas por documento.
  const pre = await carregarPreCondicoes(proc.id)
  for (const u of unidades) {
    for (const stepId of u.stepIds) {
      await garantirTarefaDePasso({ stepInstanceId: stepId, origem: "workflow", preCondicoes: pre })
    }
  }
  return { processoId: proc.id, pessoaId: pes.id, instanciaId: inst.id, unidades }
}

const tarefas = (processoId: number) =>
  prisma.tarefa.findMany({ where: { processoId }, select: { id: true, titulo: true, statusTarefa: true, necessidadeId: true, workflowStepInstanceId: true, dataConclusao: true }, orderBy: { id: "asc" } })
const steps = (instanciaId: number) =>
  prisma.phaseWorkflowStepInstance.findMany({ where: { workflowInstanceId: instanciaId }, select: { id: true, status: true, ordem: true }, orderBy: { ordem: "asc" } })

async function main() {
  exigirBancoDeTeste("prova que etapa não é tarefa")
  await limpar()
  await prisma.motorConfig.upsert({ where: { id: 1 }, create: { id: 1, runtimeV2Habilitado: true }, update: { runtimeV2Habilitado: true } })

  const gestor = await prisma.usuario.create({ data: { nome: "Gestor", email: "gestor@etapa5.test", senha: "x", tipo: "admin" }, select: { id: true } })
  const dani = await prisma.usuario.create({ data: { nome: "Daniela Brait", email: "dani@etapa5.test", senha: "x", tipo: "assistente" }, select: { id: true } })
  const maria = await prisma.usuario.create({ data: { nome: "Maria Souza", email: "maria@etapa5.test", senha: "x", tipo: "assistente" }, select: { id: true } })

  console.log("ETAPA NÃO É TAREFA — cinco passos, um trabalho\n")

  // ═════════════════════════════════════════════════════════════════════════
  secao("§31) UM documento com 5 etapas = 1 tarefa + 5 steps")
  // ═════════════════════════════════════════════════════════════════════════
  const p = await palco("A", ["Certidão de nascimento - Inteiro Teor"])
  const ts = await tarefas(p.processoId)
  const ss = await steps(p.instanciaId)
  ok("§31) 1 Tarefa", ts.length === 1, `${ts.length} tarefa(s)`)
  ok("§31) 5 StepInstances", ss.length === 5, `${ss.length} step(s)`)
  const X = ts[0]?.id
  ok("§31) taskId = X registrado", Number.isInteger(X), `taskId ${X}`)
  ok("§31) a tarefa aponta para a obrigação, não para um passo", ts[0]?.necessidadeId === p.unidades[0].necessidadeId)
  ok("§31) e para a etapa CORRENTE", ts[0]?.workflowStepInstanceId === p.unidades[0].stepIds[0])

  // ═════════════════════════════════════════════════════════════════════════
  secao("§33) DOIS documentos = 2 tarefas + 10 steps (nunca 10 tarefas)")
  // ═════════════════════════════════════════════════════════════════════════
  const q = await palco("B", ["Certidão de nascimento - Inteiro Teor", "Certidão de casamento - Inteiro Teor"])
  const tq = await tarefas(q.processoId)
  const sq = await steps(q.instanciaId)
  ok("§33) 2 Tarefas", tq.length === 2, `${tq.length}`)
  ok("§33) 10 StepInstances", sq.length === 10, `${sq.length}`)
  ok("§30) a granularidade por documento sobreviveu",
    new Set(tq.map((t) => t.necessidadeId)).size === 2, "duas obrigações, duas tarefas")
  ok("§30) e NÃO viraram 10 tarefas", tq.length !== 10)

  // ═════════════════════════════════════════════════════════════════════════
  secao("§34) Minha Fila mostra TAREFAS, não steps")
  // ═════════════════════════════════════════════════════════════════════════
  for (const t of tq) await atribuirTarefa({ tarefaId: t.id, responsavelId: dani.id, autorId: gestor.id })
  const fila = await minhaFila(dani.id)
  const daFase = fila.filter((l) => tq.some((t) => t.id === l.taskId))
  ok("§34) 2 linhas na fila, não 10", daFase.length === 2, `${daFase.length}`)
  ok("§34) cada linha mostra a sua etapa atual",
    daFase.every((l) => l.etapaAtual === "Solicitar certidão"), daFase.map((l) => l.etapaAtual).join(" | "))
  ok("§35) uma notificação por tarefa atribuída",
    (await prisma.notificacaoOperacional.count({ where: { tarefaId: { in: tq.map((t) => t.id) } } })) === 2)

  // ═════════════════════════════════════════════════════════════════════════
  secao("§32) O workflow inteiro roda dentro da MESMA tarefa")
  // ═════════════════════════════════════════════════════════════════════════
  await atribuirTarefa({ tarefaId: X, responsavelId: dani.id, autorId: gestor.id })
  const notifApos = await prisma.notificacaoOperacional.count({ where: { tarefaId: X } })
  await iniciarTarefa({ tarefaId: X, autorId: dani.id })
  ok("§13) iniciar usa a porta canônica e move a etapa",
    (await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.unidades[0].stepIds[0] }, select: { status: true } })).status === "EM_ANDAMENTO")

  // 1 · Solicitar
  const e1 = await concluirEtapa({ tarefaId: X, autorId: dani.id })
  ok("§32) Solicitar concluída — taskId X", e1.ok && e1.tarefaId === X)
  ok("§15) a tarefa NÃO foi encerrada por uma etapa do meio", e1.ok && e1.tarefaConcluida === false)
  ok("§15) a etapa 2 ficou ativa", (await steps(p.instanciaId))[1].status === "DISPONIVEL")
  ok("§15) nenhuma tarefa nova nasceu", (await tarefas(p.processoId)).length === 1)
  ok("§35) e nenhuma notificação de 'nova tarefa'",
    (await prisma.notificacaoOperacional.count({ where: { tarefaId: X } })) === notifApos)

  // 2 · Aguardar retorno do cartório — espera externa NA MESMA tarefa
  await aguardarTerceiro({ tarefaId: X, autorId: dani.id, motivo: "protocolo no cartório" })
  const emEspera = await prisma.tarefa.findUniqueOrThrow({ where: { id: X }, select: { statusTarefa: true } })
  ok("§16) a espera é ESTADO da mesma tarefa", emEspera.statusTarefa === "AGUARDANDO_TERCEIRO", emEspera.statusTarefa)
  ok("§16) e continua sendo a tarefa X", (await tarefas(p.processoId)).length === 1)
  await retomarDeEspera({ tarefaId: X, autorId: dani.id, motivo: "cartório respondeu" })
  const e2 = await concluirEtapa({ tarefaId: X, autorId: dani.id })
  ok("§17) retomada e etapa 2 concluída — taskId X", e2.ok && e2.tarefaId === X)

  // 3 · Receber — com transferência no meio do workflow
  const tr = await transferirTarefa({ tarefaId: X, responsavelId: maria.id, autorId: gestor.id, motivo: "redistribuição" })
  const depoisTransf = await prisma.tarefa.findUniqueOrThrow({ where: { id: X }, select: { workflowStepInstanceId: true, responsavelId: true } })
  ok("§25) transferência mantém o taskId", tr.ok && tr.tarefaId === X)
  ok("§25) e o MESMO step atual — o workflow não reinicia",
    depoisTransf.workflowStepInstanceId === p.unidades[0].stepIds[2],
    `step ${depoisTransf.workflowStepInstanceId}`)
  ok("§25) saiu da fila da Daniela e entrou na de Maria",
    !(await minhaFila(dani.id)).some((l) => l.taskId === X) && (await minhaFila(maria.id)).some((l) => l.taskId === X))
  ok("§25) as etapas já concluídas continuam concluídas",
    (await steps(p.instanciaId)).slice(0, 2).every((s) => s.status === "CONCLUIDO"))

  const e3 = await concluirEtapa({ tarefaId: X, autorId: maria.id })
  ok("§18) Receber concluída — taskId X", e3.ok && e3.tarefaId === X)
  const e4 = await concluirEtapa({ tarefaId: X, autorId: maria.id })
  ok("§18) Conferir concluída — taskId X", e4.ok && e4.tarefaId === X)

  // 5 · Validar — terminal
  const e5 = await concluirEtapa({ tarefaId: X, autorId: maria.id })
  ok("§19) Validar concluída — taskId X", e5.ok && e5.tarefaId === X)
  ok("§19) a ÚLTIMA etapa encerrou a tarefa", e5.ok && e5.tarefaConcluida === true)
  const fim = await tarefas(p.processoId)
  ok("§19) dataConclusao registrada", fim[0].dataConclusao != null)
  ok("§32) 5 etapas concluídas", (await steps(p.instanciaId)).every((s) => s.status === "CONCLUIDO"))
  ok("§32) ZERO tarefas intermediárias — 1 do começo ao fim", fim.length === 1, `${fim.length}`)
  ok("§32) e é a MESMA tarefa X", fim[0].id === X)

  // ═════════════════════════════════════════════════════════════════════════
  secao("§27) Reabertura é retrabalho da MESMA tarefa")
  // ═════════════════════════════════════════════════════════════════════════
  const re = await reabrirTarefa({ tarefaId: X, autorId: gestor.id, motivo: "cartório enviou certidão errada" })
  ok("§27) reabriu com o mesmo taskId", re.ok && re.tarefaId === X)
  ok("§27) sem criar outra tarefa para o retrabalho", (await tarefas(p.processoId)).length === 1)

  // ═════════════════════════════════════════════════════════════════════════
  secao("§23) O histórico é UM, da mesma tarefa")
  // ═════════════════════════════════════════════════════════════════════════
  const hist = await prisma.logAuditoria.findMany({ where: { entidade: "Tarefa", entidadeId: X }, select: { acao: true } })
  const acoes = new Set(hist.map((h) => h.acao))
  for (const esperada of ["TAREFA_ATRIBUIDA", "TAREFA_INICIADA", "TAREFA_ETAPA_CONCLUIDA", "TAREFA_AGUARDANDO_TERCEIRO", "TAREFA_REABERTA"]) {
    ok(`§23) registra ${esperada}`, [...acoes].some((a) => a.startsWith(esperada.slice(0, 18))), [...acoes].join(", ").slice(0, 90))
  }
  ok("§23) e não existe histórico por subtarefa",
    (await prisma.tarefa.count({ where: { processoId: p.processoId, NOT: { tarefaPaiId: null } } })) === 0)

  // ═════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
  await limpar()
  await prisma.$disconnect()
  if (falhou > 0) process.exit(1)
  console.log("Cinco etapas, um trabalho, um taskId — do nascimento à conclusão.")
}

main().catch(async (e) => { console.error("falhou:", e); await prisma.$disconnect(); process.exit(1) })
