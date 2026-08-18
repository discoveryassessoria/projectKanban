// scripts/reparar-passo-duplicado.ts
// ============================================================================
// DUAS INSTÂNCIAS DO MESMO PASSO PARA A MESMA OBRIGAÇÃO.
//
//   npx tsx scripts/reparar-passo-duplicado.ts            SOMENTE LEITURA
//   npx tsx scripts/reparar-passo-duplicado.ts --execute  aplica
//   npx tsx scripts/reparar-passo-duplicado.ts --processo 523
//
// ─── O QUE ACONTECEU ────────────────────────────────────────────────────────
// Dois materializadores criavam o mesmo passo com chaves de idempotência em
// FORMATOS diferentes:
//
//   wfi300|stepdef243|stepkeylocalizar_registro|stepv1|c2|doc2111|nec190
//   matdoc|localizar_registro|nec190|c2
//
// O do workflow publicado convergia com o documental; o documental só procurava
// pela própria string. Quem rodasse depois criava o segundo passo. É a mesma
// família da duplicidade de TAREFA (duas chaves, e quem procura numa nunca acha
// a outra) — agora no nível do PASSO.
//
// O código já não produz mais duplicata. Este script trata o que ficou gravado.
//
// ─── O QUE ELE FAZ, E O QUE NÃO FAZ ─────────────────────────────────────────
// SUPERSEDE as sobras — nunca apaga. `SUPERSEDIDO` é o estado que o domínio já
// usa para "saiu do fluxo sem ter sido cancelado por alguém": o registro
// permanece, o histórico permanece, e o gate deixa de esperar por ele.
//
// SOBREVIVE o passo MAIS ADIANTADO. Trabalho feito não se joga fora: se um dos
// dois foi concluído, é ele que fica. Empate resolve pelo mais antigo, que é a
// identidade original.
//
// A TAREFA que apontava para o descartado é reancorada no sobrevivente — senão
// a fila ficaria apontando para um passo que saiu do fluxo.
//
// NÃO conclui passo, não avança fase, não cria nada, não apaga nada.
// ============================================================================
import { prisma } from '../lib/prisma'

const EXECUTAR = process.argv.includes('--execute')
const iProc = process.argv.indexOf('--processo')
const PROCESSO = iProc >= 0 ? Number(process.argv[iProc + 1]) : null

/** Ordem de "quão adiantado" — o maior sobrevive. */
const AVANCO: Record<string, number> = {
  CONCLUIDO: 6, EXECUTADO: 5, AGUARDANDO_APROVACAO: 5, AGUARDANDO: 4,
  EM_ANDAMENTO: 3, BLOQUEADO: 2, DISPONIVEL: 1, PENDENTE: 0, FALHOU: 0,
}

async function main() {
  console.log(EXECUTAR ? 'REPARO — APLICANDO\n' : 'REPARO — SOMENTE LEITURA (use --execute para aplicar)\n')

  const passos = await prisma.phaseWorkflowStepInstance.findMany({
    where: {
      status: { notIn: ['SUPERSEDIDO', 'CANCELADO'] },
      ...(PROCESSO ? { processoId: PROCESSO } : {}),
    },
    select: {
      id: true, processoId: true, workflowInstanceId: true, ciclo: true, stepKey: true,
      necessidadeId: true, documentoId: true, status: true, chaveIdempotencia: true,
      stepDefinitionId: true,
    },
    orderBy: { id: 'asc' },
  })

  // A IDENTIDADE LÓGICA do passo: instância + ciclo + stepKey + OBRIGAÇÃO.
  // A obrigação vence o documento (o documento é onde ela se materializa), pela
  // mesma razão que na identidade da tarefa.
  const grupos = new Map<string, typeof passos>()
  for (const p of passos) {
    const obrigacao =
      p.necessidadeId != null ? `nec${p.necessidadeId}`
      : p.documentoId != null ? `doc${p.documentoId}`
      : null
    // Passo administrativo de fase não tem obrigação — e é único por construção.
    if (obrigacao == null) continue
    const k = `wfi${p.workflowInstanceId}|c${p.ciclo}|${p.stepKey}|${obrigacao}`
    const arr = grupos.get(k) ?? []
    arr.push(p)
    grupos.set(k, arr)
  }

  const duplicados = [...grupos.entries()].filter(([, arr]) => arr.length > 1)
  if (duplicados.length === 0) {
    console.log('Nenhuma duplicidade de passo encontrada.')
    return
  }

  let supersedidos = 0
  let tarefasReancoradas = 0

  for (const [chave, arr] of duplicados) {
    const ordenados = [...arr].sort(
      (a, b) => (AVANCO[b.status] ?? 0) - (AVANCO[a.status] ?? 0) || a.id - b.id,
    )
    const sobrevive = ordenados[0]
    const sobra = ordenados.slice(1)
    console.log(`\n${chave}`)
    console.log(`  sobrevive #${sobrevive.id} (${sobrevive.status})  chave=${sobrevive.chaveIdempotencia}`)
    for (const s of sobra) {
      console.log(`  supersede #${s.id} (${s.status})  chave=${s.chaveIdempotencia}`)
    }

    if (!EXECUTAR) continue

    await prisma.$transaction(async (tx) => {
      for (const s of sobra) {
        // A TAREFA ancorada no descartado passa para o sobrevivente ANTES de ele
        // sair do fluxo: uma tarefa apontando para passo supersedido é
        // exatamente o tipo de ponteiro morto que a fila não sabe explicar.
        const reancoradas = await tx.tarefa.updateMany({
          where: { workflowStepInstanceId: s.id },
          data: { workflowStepInstanceId: sobrevive.id },
        })
        tarefasReancoradas += reancoradas.count

        await tx.phaseWorkflowStepInstance.update({
          where: { id: s.id },
          data: { status: 'SUPERSEDIDO' },
        })
        supersedidos++

        await tx.logAuditoria.create({
          data: {
            acao: 'PASSO_DUPLICADO_SUPERSEDIDO',
            entidade: 'PhaseWorkflowStepInstance',
            entidadeId: s.id,
            descricao:
              `Passo duplicado da mesma obrigação supersedido em favor de #${sobrevive.id} ` +
              `(${s.status} → SUPERSEDIDO). Chaves em formatos diferentes: "${s.chaveIdempotencia}" ` +
              `× "${sobrevive.chaveIdempotencia}".`,
            detalhes: {
              identidade: chave,
              supersedido: { id: s.id, status: s.status, chave: s.chaveIdempotencia },
              sobrevivente: { id: sobrevive.id, status: sobrevive.status, chave: sobrevive.chaveIdempotencia },
              tarefasReancoradas: reancoradas.count,
            },
          },
        })
      }
    })
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Grupos duplicados: ${duplicados.length}`)
  if (EXECUTAR) console.log(`Passos supersedidos: ${supersedidos} · Tarefas reancoradas: ${tarefasReancoradas}`)
  else console.log('Nada foi alterado. Rode com --execute para aplicar.')
}

void main().finally(() => prisma.$disconnect())
