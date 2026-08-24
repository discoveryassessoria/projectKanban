// scripts/reparar-passo-fantasma.ts
//
// FECHA OS FILHOS QUE FICARAM VIVOS DENTRO DE INSTÂNCIAS JÁ MORTAS.
//
//   npx tsx scripts/reparar-passo-fantasma.ts            SOMENTE LEITURA
//   npx tsx scripts/reparar-passo-fantasma.ts --execute
//
// O defeito foi corrigido na origem: quem supersede a instância agora supersede os
// passos e as tarefas na mesma transação. Este script existe para o que já aconteceu
// antes disso — e passa pela MESMA porta, para não inventar uma segunda maneira de
// superseder passo.

import { PrismaClient } from "@prisma/client"
import { supersederPassosDaInstanciaTx } from "../src/services/task-step-sync"

const prisma = new PrismaClient()
const EXECUTAR = process.argv.includes("--execute")

async function main() {
  console.log(EXECUTAR ? "REPARO — APLICANDO\n" : "REPARO — SOMENTE LEITURA (use --execute)\n")

  const mortas = await prisma.phaseWorkflowInstance.findMany({
    where: { status: { in: ["SUPERSEDIDO", "CANCELADO"] } },
    select: {
      id: true, processoId: true, faseMacroKey: true, ciclo: true, status: true,
      steps: {
        where: { status: { in: ["PENDENTE", "DISPONIVEL", "EM_ANDAMENTO", "AGUARDANDO", "BLOQUEADO", "EXECUTADO", "AGUARDANDO_APROVACAO"] } },
        select: {
          id: true, stepKey: true, status: true,
          tarefas: {
            where: { statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"] } },
            select: { id: true, titulo: true },
          },
        },
      },
    },
  })
  const comFantasma = mortas.filter((i) => i.steps.length > 0)
  if (!comFantasma.length) { console.log("Nada a reparar: nenhuma instância morta com filho vivo.") ; return }

  let passos = 0
  let tarefas = 0
  for (const i of comFantasma) {
    console.log(`  proc#${i.processoId} · ${i.faseMacroKey} c${i.ciclo} [${i.status}]`)
    for (const s of i.steps) {
      console.log(`      ${EXECUTAR ? "✔" : "→"} ${s.stepKey.padEnd(30)} ${s.status}${s.tarefas.length ? `  · ${s.tarefas.length} tarefa(s) viva(s)` : ""}`)
      passos++
      tarefas += s.tarefas.length
    }
    if (!EXECUTAR) continue
    // PELA MESMA PORTA que o avanço de fase usa: a precedência da máquina vale, os
    // eventos são gravados e a coerência passo↔tarefa é assegurada.
    const r = await prisma.$transaction((tx) => supersederPassosDaInstanciaTx(tx, i.id, {
      correlationId: `reparo-fantasma-${i.id}`,
      causationId: `reparo|wfi${i.id}`,
      ciclo: i.ciclo,
      processoId: i.processoId,
      workflowInstanceId: i.id,
    }), { maxWait: 20_000, timeout: 120_000 })
    console.log(`      → ${r.passos} passo(s) e ${r.tarefas} tarefa(s) fechados`)
  }

  console.log(`\n${"═".repeat(70)}`)
  console.log(`${comFantasma.length} instância(s) · ${passos} passo(s) · ${tarefas} tarefa(s) ${EXECUTAR ? "fechados" : "seriam fechados"}`)
  if (!EXECUTAR) console.log("\nNada foi alterado. Para aplicar: --execute")
}

void main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
