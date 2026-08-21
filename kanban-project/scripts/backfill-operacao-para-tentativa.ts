// scripts/backfill-operacao-para-tentativa.ts
// ============================================================================
// O QUE FOI PREENCHIDO PASSA A PERTENCER À EXECUÇÃO QUE O PREENCHEU.
//
//   npx tsx scripts/backfill-operacao-para-tentativa.ts              SOMENTE LEITURA
//   npx tsx scripts/backfill-operacao-para-tentativa.ts --execute
//
// Copia `PhaseWorkflowStepInstance.metadata.operacao` para o `payload` da tentativa
// VIGENTE de cada passo. É o único destino determinístico: o blob guarda um estado
// só, e o estado que ele guarda é o da última vez — que é, por definição, a execução
// vigente.
//
// O QUE NÃO DÁ PARA RECONSTRUIR: a operação das execuções ANTERIORES. Elas foram
// sobrescritas quando o blob era a fonte. O relatório conta quantos passos tiveram
// retrabalho (têm mais de uma tentativa) e portanto perderam o preenchimento antigo —
// dito em número, não omitido.
//
// NÃO APAGA O BLOB. Ele fica como evidência comparável: a verificação OPE-001 confere
// tentativa contra blob e acusa divergência. Apagá-lo agora tiraria a única forma de
// provar que a cópia está correta.
// ============================================================================
import { prisma } from '../lib/prisma'
import { garantirTentativa, MOTIVOS_DE_TENTATIVA, tentativaVigente } from '../src/services/execucao-do-passo'

const EXECUTAR = process.argv.includes('--execute')
const RESERVADAS = new Set(['acao', 'efeito', 'versaoDaConfiguracao', 'decididoEm', 'detalhes'])

async function main() {
  console.log(EXECUTAR ? 'OPERAÇÃO → TENTATIVA — APLICANDO\n' : 'OPERAÇÃO → TENTATIVA — SOMENTE LEITURA (use --execute)\n')

  const passos = await prisma.phaseWorkflowStepInstance.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true, stepKey: true, status: true, startedAt: true, completedAt: true, metadata: true,
      execucoes: { select: { id: true, sequencia: true, supersededAt: true, payload: true } },
    },
  })

  let copiados = 0, jaTinham = 0, semBlob = 0, retrabalhoPerdido = 0
  for (const p of passos) {
    const blob = ((p.metadata ?? {}) as { operacao?: Record<string, unknown> }).operacao ?? null
    const chaves = blob ? Object.keys(blob).filter((k) => !RESERVADAS.has(k)) : []
    if (!blob || chaves.length === 0) { semBlob++; continue }

    if (p.execucoes.length > 1) retrabalhoPerdido++

    const vigente = p.execucoes.find((e) => e.supersededAt == null) ?? null
    const jaTem = vigente && Object.keys((vigente.payload ?? {}) as Record<string, unknown>).filter((k) => !RESERVADAS.has(k)).length > 0
    if (jaTem) { jaTinham++; continue }

    console.log(`  ${EXECUTAR ? '✔' : '→'} passo#${String(p.id).padStart(4)} ${p.stepKey.padEnd(30)} ${chaves.length} campo(s): ${chaves.slice(0, 6).join(', ')}${chaves.length > 6 ? '…' : ''}` +
      (p.execucoes.length > 1 ? ` · ${p.execucoes.length} execuções (as anteriores NÃO são reconstruíveis)` : ''))

    if (EXECUTAR) {
      await garantirTentativa(p.id, {
        motivo: MOTIVOS_DE_TENTATIVA.BACKFILL, status: p.status,
        startedAt: p.startedAt, completedAt: p.completedAt,
      })
      const t = (await tentativaVigente(p.id))!
      const anterior = (t.payload ?? {}) as Record<string, unknown>
      await prisma.stepExecution.update({
        where: { id: t.id },
        data: { payload: { ...blob, ...anterior } as never },
      })
      copiados++
    }
  }

  console.log(`\n${'═'.repeat(78)}`)
  console.log(`Passos: ${passos.length} · copiados agora: ${copiados} · já tinham: ${jaTinham} · sem operação: ${semBlob}`)
  console.log(`Passos com retrabalho cuja operação ANTERIOR não é reconstruível: ${retrabalhoPerdido} (registrado, não inventado)`)
  if (!EXECUTAR) console.log('\nNada foi alterado. Para aplicar: --execute')
}

void main().finally(() => prisma.$disconnect())
