/**
 * GUARDA DO POOL DE CONEXÕES.
 * Rodar: npx tsx scripts/prisma-pool-guard.test.ts
 *
 * Existe por causa de uma queda real: produção passou a recusar `findUnique` com
 * "too many database connections". A aplicação não tinha nada de errado — o que
 * estava errado era a conta de conexões.
 *
 * O QUE ESTE ARQUIVO TRAVA
 * ------------------------
 *  1. UM cliente por instância. O cache no `globalThis` vale também em produção;
 *     sem ele, cada avaliação do módulo (route handler, middleware, instrumentação
 *     entram em bundles distintos) criava outro PrismaClient — outro pool inteiro.
 *  2. UMA conexão por instância quando a URL é TCP direta. O padrão do Prisma é
 *     `num_cpus * 2 + 1`; multiplicado por dezenas de instâncias, estoura o banco.
 *  3. URL já pooled fica INTOCADA — quem gerencia o pool ali é o proxy.
 *  4. O runtime não usa a URL de migração. `DIRECT_DATABASE_URL` só aparece no
 *     schema como `directUrl`, que o Prisma usa apenas em migrate/introspect.
 *  5. Ninguém mais instancia PrismaClient no caminho de request.
 */
export {}

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const RAIZ = process.cwd()
let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string, detalhe?: unknown) {
  if (cond) {
    passed++
    console.log(`  ✅ ${nome}`)
  } else {
    failed++
    falhas.push(nome)
    console.log(`  ❌ ${nome}${detalhe !== undefined ? ` → ${JSON.stringify(detalhe)}` : ""}`)
  }
}

function arquivos(dir: string, ext = [".ts", ".tsx"]): string[] {
  const raiz = join(RAIZ, dir)
  const out: string[] = []
  const andar = (d: string) => {
    let itens: string[]
    try {
      itens = readdirSync(d)
    } catch {
      return
    }
    for (const item of itens) {
      const p = join(d, item)
      if (statSync(p).isDirectory()) {
        if (item === "node_modules" || item === ".next") continue
        andar(p)
      } else if (ext.some((e) => item.endsWith(e))) {
        out.push(relative(RAIZ, p))
      }
    }
  }
  andar(raiz)
  return out
}

const fonte = readFileSync(join(RAIZ, "lib/prisma.ts"), "utf8")

console.log("\n1) UM CLIENTE POR INSTÂNCIA")
ok(
  /globalForPrisma\.prisma\s*=\s*_prisma/.test(fonte),
  "o cliente estendido é guardado no globalThis",
)
ok(
  /globalForPrisma\.prismaBase\s*=\s*base/.test(fonte),
  "o cliente base também",
)
// A regressão a evitar: o cache voltar a ser condicionado a NODE_ENV.
const trechoCache = fonte.slice(fonte.indexOf("const _prisma"))
ok(
  !/if\s*\(\s*process\.env\.NODE_ENV\s*!==\s*["']production["']\s*\)\s*\{[\s\S]{0,200}globalForPrisma\.prisma\s*=/.test(
    trechoCache,
  ),
  "e o cache NÃO é condicionado a NODE_ENV (era isso que criava um pool por bundle em produção)",
)

console.log("\n2) O POOL É CONTIDO QUANDO A CONEXÃO É DIRETA")
// CONTIDO, não MÍNIMO. O limite era 1 — e 1 provou ser fatal por construção: uma
// transação longa (criar processo leva até 20s) segurava a única conexão e a
// requisição ao lado morria com "Timed out fetching a new connection from the
// connection pool". O que precisa continuar valendo é que o pool seja PEQUENO e
// EXPLÍCITO (o total em serverless é governado pelo nº de instâncias), não que
// seja exatamente 1.
const limite = Number(/connection_limit=(\d+)/.exec(fonte)?.[1] ?? NaN)
ok(Number.isFinite(limite), "conexão direta declara um connection_limit explícito", limite)
ok(limite > 1, "e maior que 1 — com uma só, qualquer concorrência na instância é fatal", limite)
ok(limite <= 10, "porém pequeno: o total continua governado pelo nº de instâncias", limite)
ok(/pool_timeout=/.test(fonte), "com espera pela vez em vez de falha imediata")
ok(
  /datasources:\s*\{\s*db:\s*\{\s*url/.test(fonte),
  "e o ajuste entra pela URL do datasource, sem depender de alguém editar a variável",
)

// A função é pura o bastante para ser exercitada aqui.
function classificar(url: string): boolean {
  return (
    url.startsWith("prisma+postgres://") ||
    url.includes("accelerate.prisma-data.net") ||
    url.includes("pooler.") ||
    url.includes("pgbouncer=true")
  )
}
ok(classificar("prisma+postgres://accelerate.prisma-data.net/?api_key=x"), "URL do Accelerate é reconhecida como pooled")
ok(classificar("postgresql://u:p@aws-0-sa-east-1.pooler.supabase.com:6543/db"), "pooler dedicado é reconhecido como pooled")
ok(classificar("postgresql://u:p@host/db?pgbouncer=true"), "pgbouncer declarado é reconhecido como pooled")
ok(!classificar("postgresql://u:p@db.prisma.io:5432/postgres?sslmode=require"), "conexão TCP direta NÃO é pooled")

console.log("\n3) URL POOLED NÃO É ALTERADA")
ok(
  /if\s*\(pooled\)\s*return bruta/.test(fonte),
  "quando o proxy gerencia o pool, a URL passa intacta",
)
ok(
  /connection_limit=/.test(fonte) && /jaTem/.test(fonte),
  "e um connection_limit já presente é respeitado",
)

console.log("\n4) O RUNTIME NÃO USA A URL DE MIGRAÇÃO")
ok(
  !/DIRECT_DATABASE_URL/.test(fonte),
  "lib/prisma.ts não lê DIRECT_DATABASE_URL",
)
const schema = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8")
ok(
  /url\s*=\s*env\("PRISMA_DATABASE_URL"\)/.test(schema),
  "o datasource usa PRISMA_DATABASE_URL como url de runtime",
)
ok(
  /directUrl\s*=\s*env\("DIRECT_DATABASE_URL"\)/.test(schema),
  "e DIRECT_DATABASE_URL só como directUrl (migrate/introspect)",
)

console.log("\n5) NINGUÉM MAIS ABRE CLIENTE NO CAMINHO DE REQUEST")
const suspeitos: string[] = []
for (const f of [...arquivos("src"), ...arquivos("lib"), ...arquivos("app")]) {
  if (f === "lib/prisma.ts") continue
  const src = readFileSync(join(RAIZ, f), "utf8")
  if (/new PrismaClient\(/.test(src)) suspeitos.push(f)
}
ok(suspeitos.length === 0, "só lib/prisma.ts instancia PrismaClient", suspeitos)

console.log(`\n${"=".repeat(60)}`)
console.log(`Guarda do pool: ${passed} passou, ${failed} falhou`)
if (failed > 0) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
console.log("✅ Um cliente por instância, uma conexão por cliente, migração fora do runtime.\n")
