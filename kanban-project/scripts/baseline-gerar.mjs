#!/usr/bin/env node
// scripts/baseline-gerar.mjs
// ============================================================================
// REGENERA prisma/baseline/baseline.sql a partir do schema.prisma.
//
//   npm run baseline:gerar
//
// O arquivo final é SEMPRE derivado, nesta ordem:
//   1. cabeçalho (gerado aqui, com metadados e a versão do Prisma)
//   2. corpo     (prisma migrate diff --from-empty — tabelas, enums, índices, FKs)
//   3. bloco manual (prisma/baseline/bloco-manual.sql, mantido à mão)
//
// Este script NUNCA lê o baseline.sql — só escreve. É o que garante que o bloco
// manual não pode ser perdido numa regeneração: a fonte dele é outro arquivo.
//
// NÃO toca em banco nenhum. `migrate diff --from-empty` é puramente offline;
// as URLs falsas abaixo existem só para satisfazer o datasource do schema e
// garantir que, se algum dia o comando tentar conectar, ele falhe alto.
// ============================================================================
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const RAIZ = join(import.meta.dirname, '..')
const SCHEMA = join(RAIZ, 'prisma', 'schema.prisma')
const BLOCO = join(RAIZ, 'prisma', 'baseline', 'bloco-manual.sql')
const SAIDA = join(RAIZ, 'prisma', 'baseline', 'baseline.sql')
// A migration OFICIAL é o mesmo arquivo, byte a byte. Ela está registrada em
// _prisma_migrations de produção pelo checksum do conteúdo: se as duas cópias
// divergirem, o Prisma passa a acusar "migration modificada depois de aplicada".
// Por isso o gerador escreve as DUAS — nunca uma só.
const SAIDA_MIGRATION = join(RAIZ, 'prisma', 'migrations', '0000_baseline', 'migration.sql')

/** Início determinístico do corpo — separa cabeçalho (data/versão) do conteúdo. */
const MARCO_CORPO = '-- CreateSchema'

// Binário LOCAL, nunca `npx prisma`. Rodando de outro diretório, o npx pode
// resolver para um Prisma global de outra versão — e as versões divergem na
// sintaxe desta flag (`--to-schema-datamodel` virou `--to-schema`). Apontar
// para node_modules/.bin torna o script independente de cwd e de instalação
// global.
const PRISMA = join(RAIZ, 'node_modules', '.bin', 'prisma')

const FALSA = 'postgres://gerador:offline@127.0.0.1:1/nao-conectar'

function abortar(msg) {
  console.error(`\n[baseline] ABORTADO: ${msg}\n`)
  process.exit(1)
}

for (const [caminho, nome] of [[PRISMA, 'prisma (node_modules/.bin)'], [SCHEMA, 'prisma/schema.prisma'], [BLOCO, 'prisma/baseline/bloco-manual.sql']]) {
  if (!existsSync(caminho)) abortar(`${nome} não encontrado em ${caminho}. Rode \`npm install\` na raiz de kanban-project.`)
}

export function versaoPrisma() {
  const saida = execFileSync(PRISMA, ['--version'], { encoding: 'utf8', env: { ...process.env } })
  return saida.split('\n').find((l) => /^prisma\s+:/.test(l.trim()))?.split(':')[1]?.trim() ?? 'desconhecida'
}

/** Corpo gerado pelo Prisma. Offline — não abre conexão. */
export function corpoGerado() {
  return execFileSync(
    PRISMA,
    ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', SCHEMA, '--script'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PRISMA_DATABASE_URL: FALSA, DIRECT_DATABASE_URL: FALSA } },
  )
}

export function blocoManual() {
  return readFileSync(BLOCO, 'utf8')
}

/** Cabeçalho. `data` entra por parâmetro para o teste poder comparar sem ruído. */
export function cabecalho({ versao, data }) {
  return `-- ============================================================================
-- BASELINE CONSOLIDADO — Discovery
--
-- ARQUIVO DERIVADO. Não edite à mão: \`npm run baseline:gerar\` sobrescreve.
--   corpo        → gerado do prisma/schema.prisma
--   bloco manual → prisma/baseline/bloco-manual.sql (edite LÁ)
--
-- Gerado em : ${data}
-- Prisma    : ${versao}
--
-- PARA QUE SERVE: reconstruir o banco DO ZERO. O histórico de migrations NÃO
-- faz isso — o replay morre na 7ª (20260113180000_add_tipo_registro_custo,
-- erro 42P01: relation "CustoPessoa" does not exist), porque metade das tabelas
-- de produção nunca teve CREATE TABLE versionado.
--
-- Ver prisma/baseline/README.md para quando usar, como validar e como aplicar.
--
-- DIVERGÊNCIA CONHECIDA E COSMÉTICA — não corrigir sem avaliar:
--   Produção tem o unique de CotacaoCambio sob o nome manual
--   "uq_cotacao_confidence". Este baseline o cria como
--   "CotacaoCambio_moedaDe_moedaPara_dataReferencia_modalidade_o_key" (nome que
--   o Prisma gera). MESMAS COLUNAS, MESMA ORDEM, MESMA SEMÂNTICA — só o nome
--   muda. Renomear é trivial (ALTER INDEX ... RENAME, sem rebuild), mas o nome
--   legado pode estar em DROP INDEX IF EXISTS de migrations idempotentes ou em
--   ON CONFLICT ON CONSTRAINT. Grepar antes de mexer.
--
-- Extensões de produção NÃO incluídas de propósito: pg_stat_statements,
-- pgcrypto e uuid-ossp. Nenhuma coluna usa gen_random_uuid(),
-- uuid_generate_v4() ou crypt(); são observabilidade e legado do provedor,
-- não dependência do schema.
-- ============================================================================

`
}

/** O conteúdo COMPARÁVEL — tudo menos o cabeçalho, que carrega data e versão. */
export function conteudoSemCabecalho() {
  return corpoGerado() + '\n' + blocoManual()
}

/**
 * Data do cabeçalho já gravada, quando existe.
 *
 * O checksum do baseline É o registro de `_prisma_migrations` em produção. Se
 * a data do cabeçalho mudasse a cada regeração, o checksum mudaria sem que uma
 * linha do schema tivesse mudado — e o Prisma passaria a acusar "migration
 * modificada depois de aplicada" por puro ruído de calendário. Então a data só
 * anda quando o CONTEÚDO anda.
 */
function dataPreservada(corpoNovo) {
  if (!existsSync(SAIDA)) return null
  const atual = readFileSync(SAIDA, 'utf8')
  const i = atual.indexOf(MARCO_CORPO)
  if (i === -1) return null
  if (atual.slice(i) !== corpoNovo.slice(corpoNovo.indexOf(MARCO_CORPO))) return null
  return atual.match(/^-- Gerado em\s+:\s*(.+)$/m)?.[1]?.trim() ?? null
}

if (import.meta.filename === process.argv[1]) {
  const versao = versaoPrisma()
  const corpo = conteudoSemCabecalho()
  const data = dataPreservada(corpo) ?? new Date().toISOString().slice(0, 10)
  const conteudo = cabecalho({ versao, data }) + corpo
  writeFileSync(SAIDA, conteudo)
  mkdirSync(dirname(SAIDA_MIGRATION), { recursive: true })
  writeFileSync(SAIDA_MIGRATION, conteudo)
  const linhas = conteudo.split('\n').length
  const tabelas = (conteudo.match(/^CREATE TABLE/gm) ?? []).length
  const fks = (conteudo.match(/FOREIGN KEY/g) ?? []).length
  console.log(`[baseline] prisma/baseline/baseline.sql regenerado`)
  console.log(`[baseline]   ${linhas} linhas · ${tabelas} tabelas · ${fks} foreign keys · Prisma ${versao}`)
  console.log(`[baseline]   bloco manual reanexado de prisma/baseline/bloco-manual.sql`)
  console.log(`[baseline] prisma/migrations/0000_baseline/migration.sql regravado (mesmo conteúdo)`)
  console.log(`[baseline] Confira o diff antes de commitar: git diff prisma/baseline prisma/migrations`)
  console.log(`[baseline] Se o checksum mudar, o ledger de produção precisa ser reconciliado EXPLICITAMENTE.`)
}
