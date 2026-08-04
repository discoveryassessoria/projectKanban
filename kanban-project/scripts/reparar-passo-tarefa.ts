// scripts/reparar-passo-tarefa.ts
// ============================================================================
// REPARO IDEMPOTENTE de pares passo↔tarefa em estados contraditórios.
//
// O QUE ELE CONSERTA
//   Pares em que o passo e a tarefa dizem coisas incompatíveis sobre a MESMA
//   execução — o caso de produção: passo CONCLUIDO com tarefa NAO_INICIADA, criado
//   por caminhos que escreviam o status do passo sem projetar a tarefa.
//
// COMO ELE DECIDE
//   O PASSO é a fonte de verdade do estado operacional; a tarefa é projeção dele. O
//   reparo só age quando o estado do passo está CONFIRMADO pelo histórico — existe
//   `WorkflowEvento` da transição (PASSO_CONCLUIDO/CANCELADO/DISPENSADO/SUPERSEDIDO)
//   ou a data correspondente no próprio passo. Sem essa confirmação o caso vira
//   AMBÍGUO e é apenas LISTADO, para decisão administrativa.
//
// O QUE ELE NUNCA FAZ
//   • inventar data (usa a do passo, ou a do evento — nunca `now` para o passado);
//   • duplicar tarefa;
//   • concluir passo a partir da tarefa (a direção é passo → tarefa);
//   • tocar em par já coerente.
//
// USO
//   npx tsx scripts/reparar-passo-tarefa.ts                 # diagnóstico
//   npx tsx scripts/reparar-passo-tarefa.ts --execute
//   npx tsx scripts/reparar-passo-tarefa.ts --tarefa 3222 --execute
// ============================================================================

import { prisma } from "@/lib/prisma"
import { paresCoerentes, STATUS_TAREFA_POR_PASSO } from "@/src/services/passo-tarefa-projecao"
import type { StatusTarefa, StepInstanceStatus } from "@prisma/client"

const EXECUTE = process.argv.includes("--execute")
const idxT = process.argv.indexOf("--tarefa")
const TAREFA_ALVO = idxT >= 0 ? parseInt(process.argv[idxT + 1] ?? "", 10) : null

/** Evento que CONFIRMA que o passo chegou ao estado terminal declarado. */
const EVENTO_CONFIRMADOR: Partial<Record<StepInstanceStatus, string[]>> = {
  CONCLUIDO: ["PASSO_CONCLUIDO", "PASSO_APROVADO"],
  CANCELADO: ["PASSO_CANCELADO"],
  DISPENSADO: ["PASSO_DISPENSADO"],
  SUPERSEDIDO: ["PASSO_SUPERSEDIDO"],
}

/** Data que o passo já registra para aquele desfecho — nunca inventada. */
function dataDoDesfecho(
  status: StepInstanceStatus,
  p: { completedAt: Date | null; cancelledAt: Date | null; dispensedAt: Date | null; supersededAt: Date | null },
): Date | null {
  switch (status) {
    case "CONCLUIDO": return p.completedAt
    case "CANCELADO": return p.cancelledAt
    case "DISPENSADO": return p.dispensedAt
    case "SUPERSEDIDO": return p.supersededAt
    default: return null
  }
}

const CONCLUIDAS = new Set<StatusTarefa>(["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI"])

async function main() {
  console.log(`\nReparo passo↔tarefa — modo ${EXECUTE ? "EXECUTAR" : "SOMENTE LEITURA"}`)
  if (TAREFA_ALVO) console.log(`Tarefa alvo: ${TAREFA_ALVO}`)

  const tarefas = await prisma.tarefa.findMany({
    where: { workflowStepInstanceId: { not: null }, ...(TAREFA_ALVO ? { id: TAREFA_ALVO } : {}) },
    select: {
      id: true, statusTarefa: true, concluida: true, dataInicio: true, dataConclusao: true,
      responsavelId: true, processoId: true, titulo: true,
      workflowStepInstance: {
        select: {
          id: true, status: true, stepKey: true, faseMacroKey: true, ciclo: true,
          completedAt: true, cancelledAt: true, dispensedAt: true, supersededAt: true, responsavelId: true,
        },
      },
    },
    orderBy: { id: "asc" },
  })
  console.log(`Pares passo↔tarefa avaliados: ${tarefas.length}\n`)

  const reparaveis: string[] = []
  const ambiguos: string[] = []
  let reparados = 0

  for (const t of tarefas) {
    const p = t.workflowStepInstance
    if (!p) continue
    if (paresCoerentes(p.status, t.statusTarefa)) continue

    const alvo = STATUS_TAREFA_POR_PASSO[p.status]
    const rotulo = `tarefa ${t.id} "${t.titulo}" (proc ${t.processoId}) — passo ${p.id} ${p.stepKey} ${p.faseMacroKey} c${p.ciclo}: passo=${p.status} × tarefa=${t.statusTarefa} → esperado ${alvo}`

    if (alvo == null) { ambiguos.push(`${rotulo} [sem projeção definida para este estado de passo]`); continue }

    // CONFIRMAÇÃO pelo histórico: evento da transição OU data do desfecho no passo.
    const tiposConfirmadores = EVENTO_CONFIRMADOR[p.status]
    const data = dataDoDesfecho(p.status, p)
    let confirmado = data != null
    if (!confirmado && tiposConfirmadores) {
      const evt = await prisma.workflowEvento.findFirst({
        where: { stepInstanceId: p.id, tipo: { in: tiposConfirmadores as never[] } },
        orderBy: { id: "desc" }, select: { id: true, criadoEm: true },
      })
      confirmado = evt != null
    }
    // Passo em estado NÃO terminal com tarefa encerrada: a contradição é do lado da
    // tarefa e não há como saber, do histórico, se o encerramento dela foi legítimo.
    const passoTerminal = ["CONCLUIDO", "CANCELADO", "DISPENSADO", "SUPERSEDIDO"].includes(p.status)
    if (!passoTerminal) { ambiguos.push(`${rotulo} [tarefa encerrada sobre passo aberto — decidir manualmente]`); continue }
    if (!confirmado) { ambiguos.push(`${rotulo} [sem evento nem data que confirme o desfecho do passo]`); continue }

    reparaveis.push(rotulo)

    if (EXECUTE) {
      const concluiu = CONCLUIDAS.has(alvo)
      await prisma.$transaction(async (tx) => {
        await tx.tarefa.update({
          where: { id: t.id },
          data: {
            statusTarefa: alvo,
            concluida: concluiu,
            // Data do PASSO — nunca `now`: o trabalho terminou quando o passo terminou.
            dataConclusao: concluiu ? (t.dataConclusao ?? data) : null,
            ...(concluiu && !t.dataInicio && data ? { dataInicio: data } : {}),
            ...(concluiu ? { executedById: t.responsavelId ?? p.responsavelId ?? null } : {}),
          },
        })
        await tx.logAuditoria.create({
          data: {
            acao: "PASSO_TAREFA_REPARADO", entidade: "TAREFA", entidadeId: t.id,
            descricao: `Tarefa realinhada ao passo ${p.id} (${p.status}) — projeção do estado oficial`,
            detalhes: {
              stepInstanceId: p.id, statusPasso: p.status, faseMacroKey: p.faseMacroKey, ciclo: p.ciclo,
              tarefaDe: t.statusTarefa, tarefaPara: alvo,
              dataAplicada: (concluiu ? (t.dataConclusao ?? data) : null)?.toISOString() ?? null,
              confirmadoPor: data != null ? "data_do_passo" : "evento_do_passo",
            },
          },
        })
      })
      reparados++
    }
  }

  console.log(`Divergências REPARÁVEIS: ${reparaveis.length}`)
  for (const r of reparaveis) console.log(`  · ${r}`)
  console.log(`\nCasos AMBÍGUOS (decisão administrativa): ${ambiguos.length}`)
  for (const a of ambiguos) console.log(`  · ${a}`)

  if (EXECUTE) console.log(`\n✔ ${reparados} tarefa(s) realinhada(s) ao passo, com auditoria.`)
  else if (reparaveis.length) console.log("\n(diagnóstico — rode com --execute para reparar)")
  if (!reparaveis.length && !ambiguos.length) console.log("\n✔ Nenhuma divergência passo↔tarefa.")

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
