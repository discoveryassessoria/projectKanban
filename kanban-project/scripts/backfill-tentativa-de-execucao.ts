// scripts/backfill-tentativa-de-execucao.ts
// ============================================================================
// DÁ UMA TENTATIVA A CADA PASSO QUE JÁ EXISTE.
//
//   npx tsx scripts/backfill-tentativa-de-execucao.ts              SOMENTE LEITURA
//   npx tsx scripts/backfill-tentativa-de-execucao.ts --execute
//
// ─── O QUE ELE SABE, E O QUE ELE NÃO SABE ───────────────────────────────────
// Cria UMA tentativa por passo existente, com o estado, o início, o fim e os dados
// que a linha do passo carrega hoje. É o único mapeamento determinístico possível.
//
// O que ele NÃO sabe, e por isso não inventa: quantas tentativas REALMENTE
// aconteceram. Um passo reaberto três vezes antes deste gate teve o `completedAt`
// apagado a cada vez — as execuções anteriores não foram registradas em lugar
// nenhum e não podem ser reconstruídas. Deduzi-las do `WorkflowEvento` seria
// plausível e ainda assim adivinhação: o evento diz que houve reabertura, não o que
// a execução apagada continha.
//
// Por isso toda tentativa criada aqui nasce com `motivo = BACKFILL`. Ela afirma o
// que é verdade — "este é o estado que o passo tinha quando o modelo de tentativas
// passou a existir" — e não afirma ser a primeira nem a única.
//
// CLASSIFICAÇÃO DOS DADOS ANTIGOS (exigida pelo gate):
//   DETERMINISTICAMENTE MIGRÁVEL — o estado atual do passo; migrado.
//   NÃO RECONSTRUÍVEL — tentativas anteriores a uma reabertura; NÃO inventadas.
//                       Ficam legíveis no `WorkflowEvento` (PASSO_REABERTO), que
//                       continua sendo a prova de que houve retrabalho.
//
// ─── O QUE ELE NÃO FAZ ──────────────────────────────────────────────────────
// Não altera passo, tarefa, instância, processo ou documento. Só insere numa tabela
// que estava vazia. IDEMPOTENTE: a chave é única por passo+sequência.
// ============================================================================
import { prisma } from '../lib/prisma'
import { garantirTentativa, MOTIVOS_DE_TENTATIVA } from '../src/services/execucao-do-passo'

const EXECUTAR = process.argv.includes('--execute')

async function main() {
  console.log(EXECUTAR ? 'BACKFILL DE TENTATIVAS — APLICANDO\n' : 'BACKFILL DE TENTATIVAS — SOMENTE LEITURA (use --execute)\n')

  const passos = await prisma.phaseWorkflowStepInstance.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true, stepKey: true, status: true, startedAt: true, completedAt: true,
      metadata: true, faseMacroKey: true, ciclo: true,
      execucoes: { select: { id: true } },
    },
  })

  // QUANTOS PASSOS TIVERAM RETRABALHO QUE NÃO PODE SER RECONSTRUÍDO — a prova de
  // que o backfill está deixando algo de fora, dita em número em vez de omitida.
  const reaberturas = await prisma.workflowEvento.groupBy({
    by: ['entityId'],
    where: { entityType: 'step_instance', tipo: { in: ['PASSO_REABERTO'] } },
    _count: { _all: true },
  })
  const porPasso = new Map(reaberturas.map((r) => [r.entityId, r._count._all]))

  let criadas = 0
  let jaTinham = 0
  let comHistoricoPerdido = 0

  for (const p of passos) {
    if (p.execucoes.length > 0) { jaTinham++; continue }
    const meta = (p.metadata ?? null) as { operacao?: Record<string, unknown> } | null
    const reab = porPasso.get(p.id) ?? 0
    if (reab > 0) comHistoricoPerdido++
    console.log(
      `  ${EXECUTAR ? '✔' : '→'} passo#${String(p.id).padStart(4)} ${p.faseMacroKey}/c${p.ciclo} ${p.stepKey.padEnd(30)} ${p.status.padEnd(12)}` +
      `${reab > 0 ? ` · ${reab} reabertura(s) anteriores NÃO reconstruíveis` : ''}`,
    )
    if (EXECUTAR) {
      await garantirTentativa(p.id, {
        motivo: MOTIVOS_DE_TENTATIVA.BACKFILL,
        status: p.status,
        startedAt: p.startedAt,
        completedAt: p.completedAt,
        payload: (meta?.operacao ?? undefined) as never,
      })
      criadas++
    }
  }

  const total = await prisma.stepExecution.count()
  console.log(`\n${'═'.repeat(74)}`)
  console.log(`Passos: ${passos.length} · tentativas criadas agora: ${criadas} · já tinham: ${jaTinham}`)
  console.log(`Passos com retrabalho anterior NÃO reconstruível: ${comHistoricoPerdido} (registrado, não inventado)`)
  console.log(`Tentativas no banco: ${total}`)
  if (!EXECUTAR) console.log('\nNada foi alterado. Para aplicar: --execute')
}

void main().finally(() => prisma.$disconnect())
