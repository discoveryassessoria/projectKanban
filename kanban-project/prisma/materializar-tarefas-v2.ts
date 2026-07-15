// prisma/materializar-tarefas-v2.ts
// ============================================================================
// RECUPERAÇÃO — materializa a camada Tarefa a partir dos PhaseWorkflowStepInstance
// V2 intactos, usando EXCLUSIVAMENTE o gerador idempotente existente
// `garantirTarefaDePasso` (CP-4C). NÃO contém lógica de negócio nova: é só o
// orquestrador (lotes, contagem antes/depois, auditoria, manifesto p/ rollback).
//
// Garantias:
//   • idempotente (garantirTarefaDePasso dedup por chaveIdempotencia) → sem duplicatas;
//   • lotes pequenos com contagem ANTES e DEPOIS → aborta se delta != criados (interferência);
//   • cada tarefa é criada em transação (dentro do serviço);
//   • manifesto JSON dos criados → rollback lógico (via cancelamento, nunca delete físico);
//   • NÃO toca a estrutura V2 (só lê steps; escreve apenas Tarefa/WorkflowEvento/DomainOutbox
//     que o próprio serviço já emite).
//
// Uso:
//   DRY-RUN (default):  npx tsx prisma/materializar-tarefas-v2.ts
//   EXECUÇÃO real:      MATERIALIZE_EXECUTE=1 npx tsx prisma/materializar-tarefas-v2.ts --execute [--limit N]
//   (requer PRISMA_DATABASE_URL apontando p/ o banco alvo)
// ============================================================================

import { randomUUID } from 'crypto'
import { writeFileSync } from 'fs'
import { prisma } from '@/lib/prisma'
import { garantirTarefaDePasso } from '@/src/services/passo-tarefa'

const EXECUTE = process.argv.includes('--execute') && process.env.MATERIALIZE_EXECUTE === '1'
const BATCH = 30
const CONC = 6 // concorrência DENTRO do lote (só nossas escrituras; delta do lote continua válido)

/** Executa fn sobre items com no máx. `conc` em paralelo, preservando a ordem dos resultados. */
async function runPool<T, R>(items: T[], conc: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let idx = 0
  async function worker() {
    for (;;) {
      const i = idx++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, worker))
  return out
}
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity
const RUN_ID = randomUUID()

async function main() {
  const steps = await prisma.phaseWorkflowStepInstance.findMany({
    where: {
      tipo: 'HUMANO',
      geraTarefa: true,
      status: 'DISPONIVEL',
      workflowInstance: { status: { in: ['ATIVO', 'AGUARDANDO', 'BLOQUEADO'] } },
    },
    select: { id: true, processoId: true },
    orderBy: { id: 'asc' },
  })
  const alvo = steps.slice(0, LIMIT)
  const tarefaInicial = await prisma.tarefa.count()

  console.log('=== MATERIALIZAÇÃO Tarefa ← PhaseWorkflowStepInstance (garantirTarefaDePasso) ===')
  console.log(`run=${RUN_ID}  modo=${EXECUTE ? 'EXECUÇÃO REAL' : 'DRY-RUN'}  lote=${BATCH}  limite=${LIMIT}`)
  console.log(`steps alvo=${alvo.length} (de ${steps.length})  Tarefa atual=${tarefaInicial}`)

  if (!EXECUTE) {
    // Dry-run read-only: amostra do que seria criado (título vem do snapshot do passo).
    const amostra = await prisma.phaseWorkflowStepInstance.findMany({
      where: { id: { in: alvo.slice(0, 5).map((s) => s.id) } },
      select: { id: true, processoId: true, stepKey: true, snapshot: true },
    })
    for (const s of amostra) {
      const snap = (s.snapshot as { titulo?: string } | null) ?? null
      console.log(`  · step ${s.id} (proc ${s.processoId}) → Tarefa "${snap?.titulo ?? `Passo ${s.stepKey}`}"`)
    }
    console.log(`DRY-RUN: nada escrito. Para executar: MATERIALIZE_EXECUTE=1 --execute`)
    return
  }

  const stats = { materializadas: 0, jaExistiam: 0, falhas: 0, porCodigo: {} as Record<string, number> }
  const criados: { stepId: number; tarefaId: number; chave: string | null }[] = []
  let abortado = false

  for (let i = 0; i < alvo.length && !abortado; i += BATCH) {
    const lote = alvo.slice(i, i + BATCH)
    const antes = await prisma.tarefa.count()
    let criadosLote = 0

    // causationId bounded (RUN_ID, 36 chars): evita overflow do WorkflowEvento.causationId
    // VarChar(60) quando step.chaveIdempotencia é longo. NÃO afeta idempotência (chaves
    // derivam de chaveTarefa) nem o vínculo (workflowStepInstanceId permanece).
    const resultados = await runPool(lote, CONC, async (step) => {
      try {
        const r = await garantirTarefaDePasso({ stepInstanceId: step.id, origem: 'recuperacao', correlationId: RUN_ID, causationId: RUN_ID })
        return { step, r, err: null as string | null }
      } catch (e) {
        return { step, r: null, err: e instanceof Error ? e.message : String(e) }
      }
    })

    for (const { step, r, err } of resultados) {
      if (err) {
        stats.falhas++
        stats.porCodigo['EXCEPTION'] = (stats.porCodigo['EXCEPTION'] ?? 0) + 1
        console.error(`  ! erro no step ${step.id}: ${err}`)
        continue
      }
      const res = r!
      if (!res.success) {
        stats.falhas++
        stats.porCodigo[res.code] = (stats.porCodigo[res.code] ?? 0) + 1
      } else if (res.created) {
        stats.materializadas++
        criadosLote++
        criados.push({ stepId: step.id, tarefaId: res.tarefa.id, chave: res.tarefa.chaveIdempotencia })
      } else {
        stats.jaExistiam++
      }
    }

    const depois = await prisma.tarefa.count()
    const delta = depois - antes
    if (delta !== criadosLote) {
      console.error(`⛔ ABORT: lote ${i / BATCH + 1}: delta=${delta} != criados=${criadosLote} (escrita concorrente?). Parando.`)
      abortado = true
      break
    }
    console.log(`  lote ${i / BATCH + 1}: +${criadosLote} criadas, ${lote.length} processadas (Tarefa ${antes}→${depois})`)
  }

  // Manifesto p/ rollback lógico (cancelamento via serviço, nunca delete físico).
  const manifestoPath = `/Users/marcoantoniofriedrichbrinkerrovatti/discovery-materializacao-${RUN_ID}.json`
  writeFileSync(manifestoPath, JSON.stringify({ runId: RUN_ID, criados }, null, 2))

  const tarefaFinal = await prisma.tarefa.count()
  console.log('\n=== RELATÓRIO ===')
  console.log(`materializadas (novas): ${stats.materializadas}`)
  console.log(`já existiam (idempotente): ${stats.jaExistiam}`)
  console.log(`falhas: ${stats.falhas}  ${JSON.stringify(stats.porCodigo)}`)
  console.log(`Tarefa: ${tarefaInicial} → ${tarefaFinal} (delta ${tarefaFinal - tarefaInicial})`)
  console.log(`manifesto (rollback lógico): ${manifestoPath}`)
  if (abortado) { console.log('STATUS: ABORTADO por divergência — reexecute (idempotente) após checar concorrência.'); process.exitCode = 1 }
  else console.log('STATUS: concluído.')
}

main()
  .catch((e) => { console.error('ERRO fatal:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
