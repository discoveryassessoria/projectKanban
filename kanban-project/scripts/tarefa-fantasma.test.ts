// scripts/tarefa-fantasma.test.ts
//
// A INSTÂNCIA MORRE E LEVA OS FILHOS JUNTO.
//
// Voltar a uma fase supersede a instância anterior e abre um ciclo novo. Os passos
// dela ficavam onde estavam — e as tarefas junto. Medido em produção em 24/08/2026:
// quatro passos DISPONIVEL/EM_ANDAMENTO dentro de instâncias já SUPERSEDIDAS, três
// com tarefa viva na fila de alguém.
//
// O efeito não é sujeira no banco: é trabalho fantasma. A pessoa abre a tarefa, faz o
// que ela pede, e está mexendo num ciclo que já passou — ou, mais provável, aprende a
// desconfiar da lista inteira. Uma fila em que parte dos itens não é trabalho deixa de
// ser fila.
//
//   node scripts/mrg-banco-teste.mjs up && npm run db:push:teste
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   npx tsx scripts/tarefa-fantasma.test.ts

import { PrismaClient } from "@prisma/client"
import { supersederPassosDaInstanciaTx } from "../src/services/task-step-sync"

const prisma = new PrismaClient()
const M = "FANT"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: `${M} ` } }, select: { id: true } })
  for (const p of procs) {
    await prisma.stepExecution.deleteMany({ where: { stepInstance: { processoId: p.id } } })
    await prisma.tarefa.deleteMany({ where: { processoId: p.id } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: p.id } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: p.id } })
    await prisma.workflowEvento.deleteMany({ where: { processoId: p.id } })
    await prisma.processo.delete({ where: { id: p.id } }).catch(() => null)
  }
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: `${M} ` } } })
}

/** Um palco: uma instância de fase com quatro passos em estados diferentes. */
async function montar() {
  const arv = await prisma.arvore.create({ data: { nome: `${M} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${M} processo`, pais: "espanha", arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: "emissao_documental" },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: {
      processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO",
      chaveIdempotencia: `${M}-i1`,
    },
    select: { id: true },
  })
  // QUATRO ESTADOS DE PROPÓSITO: dois vivos, um concluído, um cancelado. O concluído e
  // o cancelado são desfecho, e superseder desfecho apagaria o que aconteceu.
  const estados = [
    ["passo_disponivel", "DISPONIVEL"],
    ["passo_em_andamento", "EM_ANDAMENTO"],
    ["passo_concluido", "CONCLUIDO"],
    ["passo_cancelado", "CANCELADO"],
  ] as const
  const ids: Record<string, number> = {}
  for (const [i, [key, status]] of estados.entries()) {
    const si = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1,
        stepKey: key, ordem: i + 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
        status, dependeDeStepKeys: [] as never, chaveIdempotencia: `${M}-p${i}`,
        ...(status === "CONCLUIDO" ? { completedAt: new Date() } : {}),
      },
      select: { id: true },
    })
    ids[key] = si.id
    await prisma.tarefa.create({
      data: {
        processoId: proc.id, titulo: `${M} ${key}`, workflowStepInstanceId: si.id,
        workflowInstanceId: null, ciclo: 1,
        statusTarefa: status === "CONCLUIDO" ? "CONCLUIDO_RECEBIDO" : status === "CANCELADO" ? "CANCELADA" : "NAO_INICIADA",
      },
    })
  }
  return { proc, inst, ids }
}

async function main() {
  await limpar()
  const { proc, inst, ids } = await montar()

  console.log("\nANTES — a instância ainda está ativa")
  const vivosAntes = await prisma.phaseWorkflowStepInstance.count({
    where: { workflowInstanceId: inst.id, status: { in: ["DISPONIVEL", "EM_ANDAMENTO"] } } })
  check("dois passos vivos no palco", vivosAntes === 2, String(vivosAntes))

  // ── O ATO: superseder a instância, como o avanço de fase faz ───────────────
  await prisma.$transaction(async (tx) => {
    await tx.phaseWorkflowInstance.update({
      where: { id: inst.id }, data: { status: "SUPERSEDIDO", supersededAt: new Date() } })
    await supersederPassosDaInstanciaTx(tx, inst.id, {
      correlationId: `${M}-c1`, causationId: `${M}-cause`, ciclo: 1,
      processoId: proc.id, workflowInstanceId: inst.id,
    })
  })

  console.log("\nDEPOIS — a instância morreu")
  const fantasmas = await prisma.phaseWorkflowStepInstance.count({
    where: { workflowInstanceId: inst.id, status: { in: ["PENDENTE", "DISPONIVEL", "EM_ANDAMENTO", "AGUARDANDO", "BLOQUEADO"] } } })
  check("nenhum passo vivo sobrou dentro da instância morta", fantasmas === 0, `${fantasmas} sobraram`)

  const tarefasVivas = await prisma.tarefa.count({
    where: { processoId: proc.id, statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"] } } })
  check("nenhuma tarefa fantasma sobrou na fila", tarefasVivas === 0, `${tarefasVivas} sobraram`)

  // ── O DESFECHO NÃO É APAGADO ──────────────────────────────────────────────
  const concluido = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: ids.passo_concluido }, select: { status: true, completedAt: true } })
  check("o passo CONCLUÍDO continua concluído, com a data dele",
    concluido?.status === "CONCLUIDO" && concluido.completedAt !== null, String(concluido?.status))
  const cancelado = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: ids.passo_cancelado }, select: { status: true } })
  check("o passo CANCELADO continua cancelado", cancelado?.status === "CANCELADO", String(cancelado?.status))
  const tConcluida = await prisma.tarefa.findFirst({
    where: { workflowStepInstanceId: ids.passo_concluido }, select: { statusTarefa: true } })
  check("e a tarefa concluída não vira supersedida",
    tConcluida?.statusTarefa === "CONCLUIDO_RECEBIDO", String(tConcluida?.statusTarefa))

  // ── O QUE ACONTECEU FICOU REGISTRADO ──────────────────────────────────────
  const evts = await prisma.workflowEvento.count({
    where: { processoId: proc.id, tipo: { in: ["PASSO_SUPERSEDIDO", "TAREFA_SUPERSEDIDA"] } } })
  check("a supersessão deixou evento — não foi um UPDATE mudo", evts >= 4, `${evts} eventos`)

  // ── REPETIR É SEGURO ──────────────────────────────────────────────────────
  const r2 = await prisma.$transaction((tx) =>
    supersederPassosDaInstanciaTx(tx, inst.id, {
      correlationId: `${M}-c2`, causationId: `${M}-cause2`, ciclo: 1,
      processoId: proc.id, workflowInstanceId: inst.id,
    }))
  check("repetir não muda mais nada", r2.passos === 0 && r2.tarefas === 0, JSON.stringify(r2))

  // ── A LIGAÇÃO ESTÁ NO AVANÇO DE FASE, NÃO NUM VARREDOR ────────────────────
  const { readFileSync } = await import("fs")
  const advance = readFileSync(new URL("../src/lib/motor/phase-advance.ts", import.meta.url), "utf8")
  check("quem supersede a instância supersede os filhos, na MESMA transação",
    advance.includes("supersederPassosDaInstanciaTx(tx, atual.id"))
  const blocoSupersede = advance.slice(advance.indexOf("if (!concluir) {"), advance.indexOf("await tx.workflowEvento.create"))
  check("e só quando SUPERSEDE — concluir a fase não mexe nos passos",
    blocoSupersede.includes("supersederPassosDaInstanciaTx") && blocoSupersede.includes("instanciaSupersedidaId = atual.id"))
  check("a permissão do invariante só é dada quando houve supersessão de verdade",
    advance.includes("let instanciaSupersedidaId: number | null = null") &&
    advance.includes("instanciaSupersedidaId,"))

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\nA PERMISSÃO DO INVARIANTE É ESTREITA")
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Superseder a instância passou a ser a ÚNICA mudança de estado que uma movimentação
  // pode causar. O invariante nasceu para pegar o defeito oposto — a tela bespoke
  // concluindo à força os passos da fase — e isso continua sendo violação.
  const { compararObrigacoes } = await import("../src/lib/motor/invariantes-obrigacoes")
  type Foto = Awaited<ReturnType<typeof import("../src/lib/motor/invariantes-obrigacoes").fotografarObrigacoes>>
  const foto = (registros: Array<[string, Record<string, unknown>]>): Foto => ({
    processoId: 1, porChave: new Map(registros as never), pendentesPorFase: new Map(), total: registros.length,
  }) as Foto
  const passoVivo = (st: string) => ["passo:1", { chave: "passo:1", tipo: "PASSO", id: 1, workflowInstanceId: 9,
    faseMacroKey: "f", ciclo: 1, status: st, obrigatorio: true, concluidoEm: null }] as [string, Record<string, unknown>]

  const supersedeu = compararObrigacoes(foto([passoVivo("DISPONIVEL")]), foto([passoVivo("SUPERSEDIDO")]),
    { instanciaDestinoId: null, instanciaSupersedidaId: 9 })
  check("acompanhar a instância morta para SUPERSEDIDO é aceito", supersedeu.ok, JSON.stringify(supersedeu.violacoes))

  const concluiu = compararObrigacoes(foto([passoVivo("DISPONIVEL")]), foto([passoVivo("CONCLUIDO")]),
    { instanciaDestinoId: null, instanciaSupersedidaId: 9 })
  check("CONCLUIR o passo durante a movimentação continua sendo violação", !concluiu.ok,
    JSON.stringify(concluiu.violacoes))

  const cancelou = compararObrigacoes(foto([passoVivo("DISPONIVEL")]), foto([passoVivo("CANCELADO")]),
    { instanciaDestinoId: null, instanciaSupersedidaId: 9 })
  check("CANCELAR o passo durante a movimentação continua sendo violação", !cancelou.ok)

  const outraInstancia = compararObrigacoes(foto([passoVivo("DISPONIVEL")]), foto([passoVivo("SUPERSEDIDO")]),
    { instanciaDestinoId: null, instanciaSupersedidaId: 999 })
  check("passo de OUTRA instância não pode ser supersedido junto", !outraInstancia.ok)

  const jaConcluido = ["passo:1", { chave: "passo:1", tipo: "PASSO", id: 1, workflowInstanceId: 9,
    faseMacroKey: "f", ciclo: 1, status: "CONCLUIDO", obrigatorio: true, concluidoEm: "2026-01-01T00:00:00.000Z" }] as [string, Record<string, unknown>]
  const apagouDesfecho = compararObrigacoes(foto([jaConcluido]), foto([passoVivo("SUPERSEDIDO")]),
    { instanciaDestinoId: null, instanciaSupersedidaId: 9 })
  check("superseder um passo JÁ CONCLUÍDO continua sendo violação", !apagouDesfecho.ok)

  const semSupersessao = compararObrigacoes(foto([passoVivo("DISPONIVEL")]), foto([passoVivo("SUPERSEDIDO")]),
    { instanciaDestinoId: null })
  check("sem instância supersedida, nada é dispensado", !semSupersessao.ok)

  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { falhas.forEach((f) => console.log(`   · ${f}`)); process.exitCode = 1 }
  await limpar()
}

void main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
