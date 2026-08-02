// scripts/reconciliar-sequencias-codigo.ts
// ============================================================================
// RECONCILIAÇÃO das sequências de código público com a realidade das tabelas.
//
// Existe por causa de um incidente real: a criação de usuários passou a
// devolver "Erro interno do servidor" porque `CodeSequence` do escopo USR
// estava ATRÁS dos códigos já gravados em Usuario — o gerador entregava um
// número já usado e o insert estourava P2002.
//
// Este script alinha TODOS os escopos do CODE_REGISTRY de uma vez. É
// idempotente e monotônico (a semente usa GREATEST): rodar de novo não
// retrocede nem reaproveita número. Somente leitura nas tabelas de negócio —
// escreve apenas em CodeSequence.
//
// Rodar: npx tsx scripts/reconciliar-sequencias-codigo.ts [--dry-run]
// No build da Vercel roda sozinho em produção (o gerador também se autocura
// em runtime; isto evita que o primeiro create de cada escopo pague o pato).
// ============================================================================
import { prisma } from '@/lib/prisma'
import { CODE_REGISTRY } from '@/lib/codigos/entity-registry'
import { escopoDe, padraoLikeDe } from '@/lib/codigos/code-patterns'
import { sincronizarSequenciaComTabela } from '@/lib/codigos/code-generator'

const dry = process.argv.includes('--dry-run')

async function main() {
  console.log(`[sequencias] reconciliação${dry ? ' (dry-run)' : ''} — ${Object.keys(CODE_REGISTRY).length} escopo(s)`)
  let corrigidos = 0

  for (const [modelo, cfg] of Object.entries(CODE_REGISTRY)) {
    const scope = escopoDe(cfg.entidade)
    try {
      const atual = await prisma.$queryRawUnsafe<{ ultimo: number }[]>(
        `SELECT "ultimo" FROM "CodeSequence" WHERE "scope" = $1`, scope,
      ).then((r) => Number(r?.[0]?.ultimo ?? 0)).catch(() => 0)

      // sufixo numérico FINAL: serve para "CLI-48" e para "DOC7" (ver code-patterns).
      const maxTabela = await prisma.$queryRawUnsafe<{ max: number | null }[]>(
        `SELECT COALESCE(MAX(NULLIF(substring("${cfg.campo}" from '([0-9]+)$'), '')::bigint), 0)::int AS max
           FROM "${modelo}" WHERE "${cfg.campo}" LIKE $1`, padraoLikeDe(cfg.entidade),
      ).then((r) => Number(r?.[0]?.max ?? 0)).catch(() => 0)

      const atrasada = maxTabela > atual
      console.log(`  ${atrasada ? '⚠' : '·'} ${scope.padEnd(5)} ${modelo.padEnd(22)} sequência=${atual} · maior código=${maxTabela}${atrasada ? '  → ATRASADA' : ''}`)

      if (atrasada && !dry) {
        await sincronizarSequenciaComTabela(prisma, modelo, cfg.campo, cfg.entidade)
        console.log(`      ✓ sequência de ${scope} semeada em ${maxTabela}`)
        corrigidos++
      }
    } catch (e) {
      console.log(`  ! ${scope}: não foi possível reconciliar (${String((e as Error)?.message ?? e).slice(0, 120)})`)
    }
  }

  console.log(`[sequencias] ${corrigidos} escopo(s) ${dry ? 'seriam corrigidos' : 'corrigidos'}.`)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error('[sequencias] erro:', e); await prisma.$disconnect(); process.exit(1) })
