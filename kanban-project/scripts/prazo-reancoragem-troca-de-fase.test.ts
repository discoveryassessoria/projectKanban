// scripts/prazo-reancoragem-troca-de-fase.test.ts
// Passo B1 (08/10/2026): a tarefa que MUDA DE FASE não leva o prazo antigo. Caso real: tarefa 3929 (Carlota Salvarani) nasceu na Genealogia com SLA de 1 dia (30/09),
// o processo entrou em Emissão em 06/10 e a reancoragem manteve 30/09. Banco de TESTE.
import { readFileSync } from "node:fs"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { reancorarTarefaNaUnidade, ajustarPrazoAEntradaNaFase } from "../lib/operacional/tarefa-canonica"

let n = 0, falhou = 0
const ok = (nome: string, c: boolean, d = "") => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}${d ? ` — ${d}` : ""}`) } }
const dia = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? null

async function main() {
  exigirBancoDeTeste("prazo-reancoragem-troca-de-fase.test.ts")
  const c = await montarCenario("PRZREANC")
  const pids: number[] = []
  try {
    console.log("\n1) Criada na Genealogia com prazo curto; depois muda de fase")
    const o = await c.novaObrigacao()
    pids.push(o.processoId)
    const t0 = await prisma.tarefa.findUniqueOrThrow({ where: { id: o.tarefaId }, select: { workflowInstanceId: true, workflowStepInstanceId: true, chaveIdempotencia: true } })
    await prisma.phaseWorkflowStepInstance.update({ where: { id: o.stepInstanceId }, data: { slaDays: 10 } })
    await prisma.tarefa.update({ where: { id: o.tarefaId }, data: { faseMacroKey: "genealogia", dataPrazo: new Date("2026-09-30T17:15:00Z") } })
    await prisma.phaseAdvanceLog.create({ data: { processoId: o.processoId, faseAtual: "genealogia", fasePretendida: c.PHASE_KEY, resultado: "AVANCADO", policy: "ALL_REQUIRED_COMPLETED", origem: "teste", pendencias: [], warnings: [], forcado: false, regrasAvaliadas: {}, correlationId: "przreanc-1", chaveIdempotencia: "przreanc-1", criadoEm: new Date("2026-10-06T17:29:00Z") } as never })
    await prisma.$transaction(async (tx) => {
      await reancorarTarefaNaUnidade(tx, { tarefaId: o.tarefaId, workflowInstanceId: t0.workflowInstanceId!, workflowStepInstanceId: t0.workflowStepInstanceId!, faseMacroKey: c.PHASE_KEY, chaveIdempotencia: t0.chaveIdempotencia! })
    })
    const t1 = await prisma.tarefa.findUniqueOrThrow({ where: { id: o.tarefaId }, select: { dataPrazo: true, faseMacroKey: true } })
    ok("mudou de fase: o prazo deixa de ser 30/09 e passa a entrada (06/10) + SLA do passo novo (10 d) = 16/10", t1.faseMacroKey === c.PHASE_KEY && dia(t1.dataPrazo) === "2026-10-16", dia(t1.dataPrazo) ?? "")
    const log = await prisma.logAuditoria.findFirst({ where: { entidade: "Tarefa", entidadeId: o.tarefaId, acao: "TAREFA_PRAZO_REANCORADO" } })
    ok("registrado no histórico da tarefa (valor antigo e novo)", !!log && /2026-09-30/.test(log.descricao) && /2026-10-16/.test(log.descricao))

    console.log("\n2) Prazo já posterior à entrada: não é encurtado nem alterado")
    await prisma.tarefa.update({ where: { id: o.tarefaId }, data: { dataPrazo: new Date("2026-10-25T12:00:00Z") } })
    const r = await prisma.$transaction((tx) => ajustarPrazoAEntradaNaFase(tx, o.tarefaId))
    const t2 = await prisma.tarefa.findUniqueOrThrow({ where: { id: o.tarefaId }, select: { dataPrazo: true } })
    ok("prazo 25/10 (depois da entrada) segue 25/10", r === null && dia(t2.dataPrazo) === "2026-10-25")
    await prisma.tarefa.update({ where: { id: o.tarefaId }, data: { dataPrazo: new Date("2026-10-06T17:29:00Z") } })
    ok("prazo exatamente na entrada também não muda", (await prisma.$transaction((tx) => ajustarPrazoAEntradaNaFase(tx, o.tarefaId))) === null)

    console.log("\n3) Fiação: toda troca de fase passa pela regra")
    ok("reancorarTarefaNaUnidade aplica a regra quando a fase muda", /atual\.faseMacroKey !== \(args\.faseMacroKey \?\? null\)\) await ajustarPrazoAEntradaNaFase\(tx, tarefa\.id\)/.test(readFileSync("lib/operacional/tarefa-canonica.ts", "utf8")))
    ok("o avanço de fase reaplica a regra depois de gravar a entrada (log)", /6b\) PRAZO NUNCA ANTERIOR/.test(readFileSync("src/lib/motor/phase-advance.ts", "utf8")))
  } finally {
    await prisma.phaseAdvanceLog.deleteMany({ where: { processoId: { in: pids } } })
    await c.limpar()
    await prisma.$disconnect()
  }
  console.log(`\n${n - falhou}/${n} verificações`)
  if (falhou > 0) process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) })
