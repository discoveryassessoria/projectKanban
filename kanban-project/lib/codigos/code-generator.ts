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
import { escopoDe, formatarCodigo, padraoLikeDe, type EntidadeCodigo } from './code-patterns'

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

/**
 * Gera o código público definitivo da entidade (ex.: "DE-7", "CLI-48", "DOC7").
 * O ESCOPO conta; o FORMATO escreve — ver `code-patterns.ts`.
 */
export async function gerarCodigoPublico(
  db: DB,
  entidade: EntidadeCodigo,
  opts?: { pais?: string | null },
): Promise<string> {
  const numero = await proximoNumero(db, escopoDe(entidade, opts?.pais))
  return formatarCodigo(entidade, numero, opts?.pais)
}

/**
 * MODO TEMPORÁRIO DE REAPROVEITAMENTO — só para Processo, só enquanto ligado.
 *
 * Pedido explícito do usuário em 10/09/2026: durante a carga inicial dos
 * processos reais, ele cria/testa/exclui processo à vontade, e não quer os
 * furos que isso deixaria no código público (ES-5, ES-9, ES-11...). Continua
 * valendo a regra de sempre — "nunca reutiliza" — para TODAS as outras
 * entidades (cliente, documento, tarefa etc.), e para o Processo assim que
 * ele mandar desligar.
 *
 * Interruptor em `ConfiguracaoSistema['processo_reutiliza_codigo_lacuna']`
 * (não em variável de ambiente) para poder ligar/desligar sem novo deploy.
 */
export async function modoReutilizaLacunaProcessoLigado(db: DB): Promise<boolean> {
  const row = await db.configuracaoSistema.findUnique({
    where: { chave: 'processo_reutiliza_codigo_lacuna' },
    select: { valor: true },
  })
  return row?.valor === '1'
}

/**
 * O MENOR número de Processo ainda livre nesse país (entre 1 e o maior já
 * usado); se a sequência já estiver densa (sem furo), cai no próximo número
 * normal. Nos dois casos, ressincroniza `CodeSequence` para não ficar para
 * trás (`semearSequencia` só AVANÇA — nunca poderia devolver um número já
 * emitido para frente de novo).
 *
 * Só chamada quando `modoReutilizaLacunaProcessoLigado` está ligado — com o
 * interruptor desligado, `gerarCodigoPublico` normal (nunca reutiliza) segue
 * sendo o único caminho.
 */
export async function proximoNumeroProcessoComPossivelLacuna(db: DB, iso: string): Promise<number> {
  const registros = await (db as PrismaClient).processo.findMany({
    where: { codigo: { startsWith: `${iso}-` } },
    select: { codigo: true },
  })
  const usados = new Set(
    registros
      .map((r) => r.codigo)
      .filter((c): c is string => c != null)
      .map((c) => Number(c.slice(iso.length + 1)))
      .filter((n) => Number.isInteger(n) && n > 0),
  )
  let candidato = 1
  while (usados.has(candidato)) candidato++
  await semearSequencia(db, iso, candidato)
  return candidato
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

/**
 * RESSINCRONIZA a sequência de um escopo com a REALIDADE da tabela.
 *
 * Existe porque a sequência e os dados podem divergir: uma limpeza/restauração
 * que preserve registros mas zere `CodeSequence`, ou um backfill que grave
 * códigos sem avançar o contador. Quando isso acontece, o gerador entrega um
 * número já usado e o `create` estoura P2002 — foi exatamente o que derrubou a
 * criação de usuários.
 *
 * Lê o MAIOR sufixo numérico já gravado na tabela para o prefixo do escopo e
 * semeia a sequência nesse valor. Idempotente e monotônico (`semearSequencia`
 * usa GREATEST): rodar de novo nunca retrocede nem reaproveita número.
 *
 * `tabela` e `campo` vêm SEMPRE do CODE_REGISTRY (constantes do próprio código),
 * nunca de entrada externa; ainda assim são validados por allowlist antes de
 * entrar no SQL.
 */
export async function sincronizarSequenciaComTabela(
  db: DB, tabela: string, campo: string, entidade: EntidadeCodigo, pais?: string | null,
): Promise<number> {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(tabela) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(campo)) {
    throw new Error(`Identificador inválido em sincronizarSequenciaComTabela: ${tabela}.${campo}`)
  }
  const scope = escopoDe(entidade, pais)
  // O sufixo numérico FINAL é o número da sequência nos dois formatos em uso
  // ("CLI-48" e "DOC7") — não se pode assumir o hífen como separador.
  const rows = await db.$queryRawUnsafe<{ max: number | null }[]>(
    `SELECT COALESCE(MAX(NULLIF(substring("${campo}" from '([0-9]+)$'), '')::bigint), 0)::int AS max
       FROM "${tabela}"
      WHERE "${campo}" LIKE $1`,
    padraoLikeDe(entidade, pais),
  )
  const max = Number(rows?.[0]?.max ?? 0)
  if (max > 0) await semearSequencia(db, scope, max)
  return max
}
