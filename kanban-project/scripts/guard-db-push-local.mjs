#!/usr/bin/env node
// scripts/guard-db-push-local.mjs
//
// `prisma db push` NÃO PODE ALCANÇAR PRODUÇÃO — e alcançou.
//
// O INCIDENTE QUE ELE IMPEDE (22/08/2026)
// ---------------------------------------
// Rodar os testes contra o banco local significa exportar `PRISMA_DATABASE_URL`
// apontando para o Postgres da porta 55432. Só que o datasource declara DUAS
// variáveis:
//
//     url       = env("PRISMA_DATABASE_URL")
//     directUrl = env("DIRECT_DATABASE_URL")
//
// e `db push` usa a SEGUNDA. Exportar só a primeira não redireciona nada: o
// `.env` continua respondendo com a URL de produção, e o push aplica o schema
// lá. Foi o que aconteceu — três colunas e uma tabela entraram em produção sem
// migration e sem ninguém ter autorizado.
//
// O dano foi nulo porque a mudança era aditiva. Ela podia não ser: `db push`
// aceita `--accept-data-loss`, e o que ele não conhece — índice parcial, CHECK
// escrito à mão — ele considera lixo.
//
// A REGRA: `db push` só roda quando AS DUAS variáveis apontam para localhost.
// Não é conselho, é recusa: o comando não acontece.
//
// Uso:  node scripts/guard-db-push-local.mjs && npx prisma db push ...
// Ou:   npm run db:push:teste

import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Lê o `.env` do jeito que o Prisma lê: a variável do ambiente vence a do arquivo. */
function resolver(nome) {
  if (process.env[nome]) return process.env[nome]
  const env = join(RAIZ, '.env')
  if (!existsSync(env)) return null
  for (const linha of readFileSync(env, 'utf8').split('\n')) {
    const m = linha.match(new RegExp(`^\\s*${nome}\\s*=\\s*(.*)$`))
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return null
}

const ehLocal = (url) =>
  !!url && /(^|@|\/\/)(127\.0\.0\.1|localhost)(:|\/)/.test(url)

const mascarar = (url) => (url ? url.replace(/:[^:@/]*@/, ':***@').slice(0, 60) : '(vazia)')

const alvos = ['PRISMA_DATABASE_URL', 'DIRECT_DATABASE_URL'].map((nome) => ({
  nome, url: resolver(nome), local: ehLocal(resolver(nome)),
}))

const remotas = alvos.filter((a) => !a.local)
if (remotas.length === 0) {
  console.log('[guard-db-push] as duas variáveis apontam para localhost — liberado.')
  process.exit(0)
}

console.error('\n  RECUSADO: `db push` alcançaria um banco que não é o local.\n')
for (const a of alvos) {
  console.error(`    ${a.local ? '·' : '✗'} ${a.nome.padEnd(21)} ${mascarar(a.url)}`)
}
console.error(`
  \`db push\` usa DIRECT_DATABASE_URL, não PRISMA_DATABASE_URL. Exportar só a
  primeira não redireciona o push — ele vai para onde a segunda apontar.

  COMO RODAR CONTRA O BANCO DE TESTE:

    npm run db:push:teste

  que exporta as DUAS. Se você precisa mesmo aplicar schema em produção, o
  caminho é migration + \`prisma migrate deploy\`, com o ledger registrando o
  que foi aplicado. \`db push\` não deixa rastro e não sabe o que é índice
  parcial nem CHECK escrito à mão — ele os considera lixo e os derruba.
`)
process.exit(1)
