// scripts/home-subtarefas-ativas-ownership.test.ts
// ============================================================================
// HOME/SUBTAREFAS ATIVAS USA A MESMA FONTE DE OWNERSHIP QUE MINHA OPERAÇÃO.
//
// Auditoria real (18/09/2026): o card "Subtarefas ativas" da Home filtrava
// `SubtaskExecution` pelo escopo do PASSO (`PhaseWorkflowStepInstance.
// responsavelId`) — um campo snapshot que NENHUM caminho do motor escreve
// (0 de 30 linhas em produção). Resultado: 0/0/0/0/0 para QUALQUER usuário
// não-admin, mesmo com a Tarefa corretamente atribuída — não era específico
// da Grisotto, era estrutural. Corrigido em `escopoPasso` (agora usa
// `Tarefa.responsavelId`, via `PhaseWorkflowStepInstance.tarefas`) — a MESMA
// fonte que `escopoTarefa`/Minha Operação já usavam.
//
// Este teste prova: Daniela tem 3 tarefas, cada uma com uma subtarefa ativa
// com prazo — "Subtarefas ativas" tem que contar as 3, no balde certo — e
// "Tarefas" continua contando pelo `Task.dataPrazo` macro, sem os dois
// relógios se fundirem.
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/home-subtarefas-ativas-ownership.test.ts
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { carregarBase, montarPrazosDeSubtarefas, montarPrazosDeTarefas, type ContextoHome } from "@/src/lib/home/coleta"

const MARCA = "HOMESUBAT"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const ids = procs.map((p) => p.id)
  await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: { in: ids } } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } })
}

async function main() {
  exigirBancoDeTeste("prova que Home usa a mesma fonte de ownership que Minha Operação")
  await limpar()
  console.log("HOME/SUBTAREFAS ATIVAS — OWNERSHIP CANÔNICO\n")

  const daniela = await prisma.usuario.create({
    data: { nome: `${MARCA} Daniela`, email: `daniela@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "assistente" },
    select: { id: true },
  })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} Grisotto`, arvoreId: arv.id }, select: { id: true } })

  const prazoMacro = new Date()
  prazoMacro.setDate(prazoMacro.getDate() + 12) // fora de 7 dias, de propósito — bate no "no prazo" de Tarefa
  const prazoPasso = new Date()
  prazoPasso.setDate(prazoPasso.getDate() + 1) // "vence amanhã" — dentro de "próximos 3 dias" de Subtarefa

  for (let i = 0; i < 3; i++) {
    const inst = await prisma.phaseWorkflowInstance.create({
      data: { processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i${i}` },
      select: { id: true },
    })
    const si = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1,
        stepKey: "solicitar_certidao", ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
        status: "AGUARDANDO", dependeDeStepKeys: [] as never, chaveIdempotencia: `${MARCA}-p${i}`,
      },
      select: { id: true },
    })
    await prisma.tarefa.create({
      data: {
        titulo: `${MARCA} certidão ${i}`, processoId: proc.id, workflowStepInstanceId: si.id, workflowInstanceId: inst.id,
        chaveIdempotencia: `${MARCA}-t${i}`, statusTarefa: "AGUARDANDO_TERCEIRO", responsavelId: daniela.id, dataPrazo: prazoMacro,
      },
    })
    await prisma.subtaskExecution.create({
      data: {
        stepInstanceId: si.id, subtaskKey: "aguardar_retorno", sequencia: 1, status: "AGUARDANDO_EXTERNO",
        motivo: "ABERTURA", prazo: prazoPasso, previstoPara: prazoPasso, chaveIdempotencia: `${MARCA}-sub${i}`,
      },
    })
  }

  const ctx: ContextoHome = {
    userId: daniela.id, isAdmin: false, agora: new Date(),
    permissoes: { verProcessos: true, verTarefas: true, verEventos: false, verFinanceiro: false, isAdmin: false },
  }
  const base = await carregarBase(ctx)

  ok("as 3 subtarefas ativas chegaram em base.subtarefas (escopo por Tarefa, não pelo campo morto do passo)",
    base.subtarefas.length === 3, String(base.subtarefas.length))

  const painelSubtarefas = montarPrazosDeSubtarefas(base, ctx)!
  const proximos3 = painelSubtarefas.find((f) => f.key === "subtarefa-proximos-3")
  ok("Home/Subtarefas ativas: 'próximos 3 dias' conta as 3 (prazo do PASSO, amanhã)", proximos3?.quantidade === 3, String(proximos3?.quantidade))
  const semPrazoSubOutros = painelSubtarefas.filter((f) => f.key !== "subtarefa-proximos-3").every((f) => f.quantidade === 0)
  ok("nenhum outro balde de subtarefa inflado", semPrazoSubOutros)

  const painelTarefas = montarPrazosDeTarefas(base, ctx)!
  const noPrazo = painelTarefas.find((f) => f.key === "tarefa-no-prazo")
  ok("Home/Tarefas: 'no prazo' conta as 3 (prazo MACRO, 12 dias) — o relógio macro continua separado do do passo",
    noPrazo?.quantidade === 3, String(noPrazo?.quantidade))
  ok("Home/Tarefas não conta em 'próximos 3 dias' (isso seria confundir o prazo do passo com o macro)",
    painelTarefas.find((f) => f.key === "tarefa-proximos-3")?.quantidade === 0)

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
  await limpar()
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
