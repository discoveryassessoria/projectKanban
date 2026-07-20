// lib/codigos/code-generator.ts
// CodeGeneratorService — ÚNICO ponto de geração de código público em todo o sistema.
// Nenhuma controller/service/repository monta código manualmente: todos chamam aqui.
//
// Garantias: único, atômico, à prova de concorrência, funciona dentro de transação, e
// NUNCA reutiliza (o contador só cresce; excluir registro não devolve o número).
//
// Uso:
//   const codigo = await gerarCodigoPublico(tx, 'PROCESS', { pais: proc.pais }) // "DE-7"
//   const codigo = await gerarCodigoPublico(prisma, 'REVENUE')                   // "REC-42"

import { Prisma, PrismaClient } from '@prisma/client'
import { escopoDe, type EntidadeCodigo } from './code-patterns'

// Aceita o client normal OU um tx client (para rodar dentro de transação). NÃO importa o singleton
// (evita ciclo: lib/prisma → code-generator → lib/prisma) — o client é sempre passado pelo chamador.
type DB = Prisma.TransactionClient | PrismaClient

/**
 * Próximo número da sequência do escopo, de forma ATÔMICA (uma única instrução):
 * INSERT ... ON CONFLICT DO UPDATE SET ultimo = ultimo + 1 RETURNING ultimo.
 * O lock de linha do Postgres serializa concorrentes → sem duplicidade.
 */
async function proximoNumero(db: DB, scope: string): Promise<number> {
  const rows = await db.$queryRaw<{ ultimo: number }[]>(Prisma.sql`
    INSERT INTO "CodeSequence" ("scope", "ultimo", "atualizadoEm")
    VALUES (${scope}, 1, now())
    ON CONFLICT ("scope")
    DO UPDATE SET "ultimo" = "CodeSequence"."ultimo" + 1, "atualizadoEm" = now()
    RETURNING "ultimo"
  `)
  return Number(rows[0].ultimo)
}

/** Gera o código público definitivo da entidade (ex.: "DE-7", "CLI-48", "REC-42"). */
export async function gerarCodigoPublico(
  db: DB,
  entidade: EntidadeCodigo,
  opts?: { pais?: string | null },
): Promise<string> {
  const scope = escopoDe(entidade, opts?.pais)
  const numero = await proximoNumero(db, scope)
  return `${scope}-${numero}`
}

/** Semeia/avança a sequência de um escopo para >= `ate` (usado pelo backfill; idempotente). */
export async function semearSequencia(db: DB, scope: string, ate: number): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "CodeSequence" ("scope", "ultimo", "atualizadoEm")
    VALUES (${scope}, ${ate}, now())
    ON CONFLICT ("scope")
    DO UPDATE SET "ultimo" = GREATEST("CodeSequence"."ultimo", ${ate}), "atualizadoEm" = now()
  `
}
