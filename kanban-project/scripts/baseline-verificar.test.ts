/**
 * GUARDA — prisma/baseline/baseline.sql em dia com o prisma/schema.prisma.
 * Rodar: npm run test:baseline   (roda tambem no build)
 *
 * O defeito que este teste trava: alguem altera o schema.prisma, o baseline
 * nao e regenerado, e a divergencia so aparece num desastre — quando o
 * baseline for a unica forma de reconstruir o banco e produzir um schema
 * diferente do real.
 *
 * NAO abre conexao com banco. Compara texto: regenera o corpo a partir do
 * schema.prisma (offline) + o bloco manual, e confere contra o commitado.
 */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = join(RAIZ, 'prisma', 'baseline', 'baseline.sql')
const DIR_MIGRATIONS = join(RAIZ, 'prisma', 'migrations')
const MIGRATION = join(DIR_MIGRATIONS, '0000_baseline', 'migration.sql')

/**
 * Checksum registrado em `_prisma_migrations` de PRODUCAO para 0000_baseline,
 * consolidado em 02/08/2026. O Prisma guarda o sha256 do migration.sql; se o
 * arquivo mudar, ele passa a acusar "migration modificada depois de aplicada"
 * e o `migrate deploy` para.
 *
 * Mudar esta constante NAO conserta nada por si so: o ledger de producao
 * precisa ser reconciliado no mesmo movimento, de forma explicita e auditada.
 */
// RECONCILIACAO DO LEDGER — feita em 03/08/2026, junto com a migration ADITIVA
// 20260803d_mover_fase_manual (dois valores de enum: AdvanceResultado.MOVIDO e
// WorkflowEventoTipo.FASE_MOVIDA).
//
//   anterior : b0021b6e4e9b6ba07a137c271f8229bc122b6f6aaa4838402be09beb7e3ce4a3
//   atual    : 6aa5afa53bd7e4b089b05cf957235163f77cf931b61cdad817c650a1c802ae01
//
// Procedimento executado: backup do ledger -> conferencia de que o diff do baseline
// eram SO as duas linhas de CREATE TYPE (zero DDL destrutivo) -> UPDATE de UMA
// coluna na linha 0000_baseline -> `prisma migrate status` consistente -> `prisma
// migrate deploy`. Nenhuma outra migration foi tocada; contagens de processos,
// instancias, passos, tarefas, eventos e logs identicas antes e depois.
// ATUALIZACAO 04/08/2026 — migration ADITIVA 20260804_solicitacao_documental
// (SolicitacaoDocumento, DocumentoArquivo, DocumentoObservacao e duas colunas em
// Protocolo). O baseline foi regenerado e o checksum mudou:
//
//   anterior : 6aa5afa53bd7e4b089b05cf957235163f77cf931b61cdad817c650a1c802ae01
//   atual    : 81743bfef8cb44adfce7b4953d67026d95e65749e71ca8721a5df06bfe925491
//
// RECONCILIACAO DO LEDGER: NAO FOI POSSIVEL — e a razao importa. Em 04/08/2026 a
// tabela `_prisma_migrations` NAO EXISTE em nenhum dos bancos alcancaveis por
// PRISMA_DATABASE_URL nem por DIRECT_DATABASE_URL (verificado por
// information_schema). Nao ha linha 0000_baseline para atualizar, e
// `prisma migrate deploy` nesse estado tentaria aplicar o baseline inteiro sobre
// um schema que ja existe. Por isso a migration foi aplicada pelo caminho
// controlado de `scripts/aplicar-migration-aditiva.ts` (SQL aditivo, idempotente,
// numa transacao, com prova de identidade antes da escrita).
//
// PENDENCIA DECLARADA: quando o banco de producao com os dados voltar a estar
// acessivel, CONFERIR se ele tem `_prisma_migrations` e, se tiver, reconciliar o
// checksum da linha 0000_baseline antes de qualquer `migrate deploy`.
//
// PENDENCIA RESOLVIDA — 04/08/2026, junto com a migration ADITIVA
// 20260804b_requerimento_doc21_vinculo (DocumentoArquivo ganha protocoloId,
// documentTypeId, hashConteudo e as colunas de versao; nasce
// ExigenciaEvidenciaEtapa).
//
// O banco de producao voltou, e com ele a `_prisma_migrations`. A linha
// 0000_baseline estava com `6aa5afa5...` — o checksum ANTERIOR a regeneracao de
// 04/08 —, ou seja, a reconciliacao de entao realmente nao aconteceu. Os dois
// saltos foram fechados de uma vez:
//
//   ledger antes : 6aa5afa53bd7e4b089b05cf957235163f77cf931b61cdad817c650a1c802ae01
//   arquivo antes: 81743bfef8cb44adfce7b4953d67026d95e65749e71ca8721a5df06bfe925491
//   atual (ambos): c3b59b340c8b529cc31cc98c770622897a093bac3c4cc6bc154e1580682b4c43
//
// Procedimento executado: pg_dump completo de producao -> copia da tabela
// `_prisma_migrations` para CSV -> conferencia de que o diff do baseline eram 64
// linhas SO de INSERT (zero DDL destrutivo, zero linha removida) -> UPDATE de UMA
// coluna na linha 0000_baseline -> `prisma migrate status` consistente. Nenhuma
// outra migration foi tocada; nenhum dado de negocio foi lido ou alterado.
// ATUALIZACAO 04/08/2026 (contrato documental) — migration ADITIVA
// 20260804c_contrato_documental: FamiliaDocumental, NaturezaOperacionalDocumento,
// PerfilOperacionalDocumento, enum EscopoExecucao e colunas novas em
// TipoDocumentoCadastro e PhaseInternalWorkflow. Diff do baseline: SO insercoes.
//   anterior : c3b59b340c8b529cc31cc98c770622897a093bac3c4cc6bc154e1580682b4c43
//   atual    : 503a30b46aa6ea92de7bba1441603b2bec79351deee4c8ec6f70f756ba4ba02a
const CHECKSUM_LEDGER = '503a30b46aa6ea92de7bba1441603b2bec79351deee4c8ec6f70f756ba4ba02a'

/**
 * Migrations criadas DEPOIS da consolidacao de 02/08/2026. Toda migration nova
 * entra aqui no MESMO commit que a cria — assim o guard continua reprovando uma
 * migration historica que volte por engano, sem travar o fluxo normal do Prisma.
 */
const MIGRATIONS_POS_BASELINE: string[] = [
  '20260803_workflow_escopo_execucao',
  '20260803b_cardinalidade_passo',
  '20260803c_regularizacao_historica',
  '20260803d_mover_fase_manual',
  '20260804_solicitacao_documental',
  '20260804b_requerimento_doc21_vinculo',
  '20260804c_contrato_documental',
]

const sha256 = (t: string) => createHash('sha256').update(t).digest('hex')

/**
 * A migration oficial e o baseline sao o MESMO arquivo, byte a byte, e sao a
 * unica migration do repositorio. As 112 antigas vivem em
 * prisma/migrations-arquivo/ e nunca mais sao aplicadas.
 */
function verificarMigrationOficial() {
  if (!existsSync(MIGRATION)) {
    falhar([
      '  A MIGRATION OFICIAL 0000_baseline NAO EXISTE',
      '',
      '  prisma/migrations/0000_baseline/migration.sql sumiu. Producao tem esse',
      '  nome registrado em _prisma_migrations; sem o arquivo, o Prisma trata a',
      '  migration como removida e o deploy fica inconsistente.',
      '',
      '  Rode: npm run baseline:gerar',
    ])
  }

  const migration = readFileSync(MIGRATION, 'utf8')
  const baseline = readFileSync(BASELINE, 'utf8')

  if (migration !== baseline) {
    falhar([
      '  BASELINE E MIGRATION DIVERGIRAM',
      '',
      '  prisma/baseline/baseline.sql e prisma/migrations/0000_baseline/migration.sql',
      '  precisam ser identicos byte a byte — sao a mesma verdade em dois lugares.',
      '',
      '  Rode: npm run baseline:gerar (escreve os dois)',
    ])
  }

  const checksum = sha256(migration)
  if (checksum !== CHECKSUM_LEDGER) {
    falhar([
      '  O CHECKSUM DO BASELINE MUDOU',
      '',
      `  esperado (ledger de producao) : ${CHECKSUM_LEDGER}`,
      `  atual    (arquivo commitado)  : ${checksum}`,
      '',
      '  Producao registra 0000_baseline por ESTE checksum. Com o arquivo',
      '  diferente, `prisma migrate deploy` acusa migration modificada depois de',
      '  aplicada e para — em producao, no meio do deploy.',
      '',
      'COMO RESOLVER — e um procedimento, nao um ajuste de constante:',
      '  1. entenda POR QUE o conteudo mudou (schema novo? bloco manual?);',
      '  2. faca backup do ledger antes de qualquer escrita;',
      '  3. atualize o checksum da linha 0000_baseline em _prisma_migrations',
      '     de forma explicita e auditada, sem tocar em schema nem em dados;',
      '  4. so entao atualize CHECKSUM_LEDGER aqui, no mesmo commit.',
      '',
      '  Nunca mude so a constante: isso mente para o proximo que ler.',
    ])
  }

  const entradas = readdirSync(DIR_MIGRATIONS)
    .filter((n) => statSync(join(DIR_MIGRATIONS, n)).isDirectory())
  const inesperadas = entradas.filter((n) => n !== '0000_baseline' && !MIGRATIONS_POS_BASELINE.includes(n))
  if (inesperadas.length > 0) {
    falhar([
      '  HA MIGRATION NAO REGISTRADA EM prisma/migrations',
      '',
      `  encontradas: ${entradas.join(', ')}`,
      `  nao registradas: ${inesperadas.join(', ')}`,
      '',
      '  As 112 migrations historicas foram arquivadas em prisma/migrations-arquivo/',
      '  em 02/08/2026 porque nao reconstroem o banco e nao podem ser reaplicadas.',
      '  Migration NOVA e bem-vinda — mas precisa ser declarada em',
      '  MIGRATIONS_POS_BASELINE, no topo deste arquivo, no mesmo commit que a cria.',
      '  Se uma antiga voltou, foi engano: mova de volta.',
    ])
  }
  const faltando = MIGRATIONS_POS_BASELINE.filter((n) => !entradas.includes(n))
  if (faltando.length > 0) {
    falhar([
      '  MIGRATION DECLARADA NAO EXISTE NO REPOSITORIO',
      '',
      `  declaradas em MIGRATIONS_POS_BASELINE e ausentes: ${faltando.join(', ')}`,
      '',
      '  Producao pode ja te-las aplicado. Apagar o diretorio nao as desfaz —',
      '  restaure o diretorio ou remova a declaracao com justificativa.',
    ])
  }

  const extra = MIGRATIONS_POS_BASELINE.length
  console.log(`  ✅ 0000_baseline integro (sha256 ${checksum.slice(0, 12)}…)${extra ? ` + ${extra} migration(s) pos-baseline declarada(s)` : ' e unica migration do repositorio'}`)
}

/** Inicio deterministico do corpo gerado pelo Prisma — separa o cabecalho. */
const MARCO_CORPO = '-- CreateSchema'

function semCabecalho(txt: string): string {
  const i = txt.indexOf(MARCO_CORPO)
  return i === -1 ? txt : txt.slice(i)
}

function versaoDoCabecalho(txt: string): string {
  return txt.match(/^-- Prisma\s+:\s*(.+)$/m)?.[1]?.trim() ?? 'desconhecida'
}

function falhar(linhas: string[]): never {
  console.error('\n' + linhas.join('\n') + '\n')
  process.exit(1)
}

async function main() {
const gerador = await import('./baseline-gerar.mjs')

if (!existsSync(BASELINE)) {
  falhar([
    '════════════════════════════════════════════════════════════════════════',
    '  O BASELINE NAO EXISTE',
    '════════════════════════════════════════════════════════════════════════',
    '',
    'Esperado em: prisma/baseline/baseline.sql',
    '',
    'COMO RESOLVER — copie e cole:',
    '',
    '    npm run baseline:gerar',
    '',
  ])
}

const commitado = readFileSync(BASELINE, 'utf8')
const esperado = gerador.conteudoSemCabecalho()
const atual = semCabecalho(commitado)

if (atual.trim() === esperado.trim()) {
  const tabelas = (commitado.match(/^CREATE TABLE/gm) ?? []).length
  const fks = (commitado.match(/FOREIGN KEY/g) ?? []).length
  console.log(`  ✅ baseline em dia com o schema.prisma (${tabelas} tabelas · ${fks} foreign keys)`)
  verificarMigrationOficial()
  process.exit(0)
}

// ── divergencia: monta uma mensagem que se explica sozinha ──────────────────
const versaoBaseline = versaoDoCabecalho(commitado)
const versaoAtual = gerador.versaoPrisma()
const mudouPrisma = versaoBaseline !== 'desconhecida' && versaoBaseline !== versaoAtual

const linhasAtual = atual.trim().split('\n')
const linhasEsper = esperado.trim().split('\n')
const primeira = linhasAtual.findIndex((l, i) => l !== linhasEsper[i])
const amostra: string[] = []
if (primeira >= 0) {
  amostra.push('', 'PRIMEIRA DIFERENCA (linha ' + (primeira + 1) + ' do corpo):', '')
  amostra.push('  no baseline commitado : ' + (linhasAtual[primeira] ?? '(fim do arquivo)').slice(0, 100))
  amostra.push('  gerado do schema      : ' + (linhasEsper[primeira] ?? '(fim do arquivo)').slice(0, 100))
}

falhar([
  '════════════════════════════════════════════════════════════════════════',
  '  O BASELINE ESTA DESATUALIZADO',
  '════════════════════════════════════════════════════════════════════════',
  '',
  'O QUE ACONTECEU',
  '  O prisma/schema.prisma mudou, mas o prisma/baseline/baseline.sql nao foi',
  '  regenerado. Os dois deixaram de descrever o mesmo banco.',
  '',
  'POR QUE ISSO IMPORTA',
  '  O baseline.sql e a UNICA forma de reconstruir este banco do zero. O',
  '  historico de migrations nao faz isso: o replay quebra na 7a migration,',
  '  porque metade das tabelas de producao nunca teve CREATE TABLE versionado.',
  '  Baseline velho = restore de desastre recria um banco diferente do real.',
  '',
  'COMO RESOLVER — copie e cole:',
  '',
  '    npm run baseline:gerar',
  '',
  '  Depois confira o diff e commite JUNTO com a sua mudanca de schema:',
  '',
  '    git diff prisma/baseline/baseline.sql',
  '',
  ...(mudouPrisma
    ? [
        'ATENCAO — A VERSAO DO PRISMA MUDOU',
        `  O baseline foi gerado com Prisma ${versaoBaseline}; voce esta com ${versaoAtual}.`,
        '  Versoes diferentes podem gerar o mesmo schema com formatacao diferente.',
        '  Se voce NAO mexeu no schema.prisma, e provavelmente so isso: rode o',
        '  mesmo comando acima, confira que o diff e apenas cosmetico, e commite.',
        '',
      ]
    : [
        'SE VOCE NAO MEXEU NO SCHEMA.PRISMA',
        '  Confira se alguem alterou prisma/baseline/bloco-manual.sql sem',
        '  regenerar. Esse arquivo tambem entra no baseline.',
        '',
      ]),
  'NAO ARRANQUE ESTE TESTE PARA DESTRAVAR O BUILD.',
  '  Ele custa um comando. O que ele protege custa um banco.',
  '  Contexto completo: prisma/baseline/README.md',
  ...amostra,
])
}

main().catch((e) => {
  console.error('\n[baseline] ERRO ao verificar o baseline:', String(e?.message ?? e), '\n')
  process.exit(1)
})
