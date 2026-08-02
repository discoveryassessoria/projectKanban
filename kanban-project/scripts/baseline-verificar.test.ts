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
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = join(RAIZ, 'prisma', 'baseline', 'baseline.sql')

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
