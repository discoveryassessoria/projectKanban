// scripts/codigos-reconciliacao.ts
// DIAGNÓSTICO (read-only) dos códigos públicos. NÃO corrige nada silenciosamente — apenas relata:
//   - entidades sem código; códigos duplicados; formato inválido; sequência abaixo do maior código.
// Extensível: 1 linha por entidade em ENTIDADES. Execução:
//   PRISMA_DATABASE_URL=... npx tsx scripts/codigos-reconciliacao.ts
import { prisma } from "@/lib/prisma"

// (tabela, coluna do código, prefixo esperado ou "ISO" p/ processo dinâmico, scope da sequência)
const ENTIDADES: { tabela: string; coluna: string; prefixo: string | "ISO"; scope: string | null }[] = [
  { tabela: "OperacaoAntecipada", coluna: "publicCode", prefixo: "OPA", scope: "OPA" },
  { tabela: "Processo", coluna: "codigo", prefixo: "ISO", scope: null },
  { tabela: "Receita", coluna: "codigo", prefixo: "REC", scope: "REC" },
  { tabela: "Custo", coluna: "codigo", prefixo: "CUS", scope: "CUS" },
]

async function q<T = Record<string, unknown>>(sql: string): Promise<T[]> { return prisma.$queryRawUnsafe<T[]>(sql) }

async function main() {
  let problemas = 0
  for (const e of ENTIDADES) {
    const semCodigo = (await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "${e.tabela}" WHERE "${e.coluna}" IS NULL`))[0].n
    const dups = await q<{ c: string; n: number }>(`SELECT "${e.coluna}" AS c, COUNT(*)::int AS n FROM "${e.tabela}" WHERE "${e.coluna}" IS NOT NULL GROUP BY "${e.coluna}" HAVING COUNT(*) > 1`)
    // formato: PREFIXO-<número sem zero à esquerda>. Para ISO (processo), prefixo é 2 letras.
    const fmt = e.prefixo === "ISO" ? `^[A-Z]{2}-[1-9][0-9]*$` : `^${e.prefixo}-[1-9][0-9]*$`
    const invalidos = await q<{ c: string }>(`SELECT "${e.coluna}" AS c FROM "${e.tabela}" WHERE "${e.coluna}" IS NOT NULL AND "${e.coluna}" !~ '${fmt}' LIMIT 20`)
    let seqAbaixo: string | null = null
    if (e.scope) {
      const maxRow = await q<{ maxn: number }>(`SELECT COALESCE(MAX(CAST(split_part("${e.coluna}", '-', 2) AS INT)), 0) AS maxn FROM "${e.tabela}" WHERE "${e.coluna}" ~ '^${e.prefixo}-[0-9]+$'`)
      const seqRow = await q<{ ultimo: number }>(`SELECT COALESCE("ultimo",0) AS ultimo FROM "CodeSequence" WHERE "scope" = '${e.scope}'`)
      const maxn = maxRow[0]?.maxn ?? 0, ultimo = seqRow[0]?.ultimo ?? 0
      if (maxn > ultimo) seqAbaixo = `sequência ${e.scope}=${ultimo} ABAIXO do maior código ${maxn}`
    }
    const issues = [semCodigo > 0 ? `${semCodigo} sem código` : "", dups.length ? `${dups.length} duplicado(s): ${dups.map(d=>d.c).join(",")}` : "",
      invalidos.length ? `${invalidos.length} formato inválido: ${invalidos.map(i=>i.c).join(",")}` : "", seqAbaixo ?? ""].filter(Boolean)
    if (issues.length) { problemas += issues.length; console.log(`⚠ ${e.tabela}.${e.coluna}: ${issues.join(" | ")}`) }
    else console.log(`✓ ${e.tabela}.${e.coluna}: ok`)
  }
  console.log(problemas === 0 ? "\n✓ RECONCILIAÇÃO LIMPA" : `\n⚠ ${problemas} problema(s) — NÃO corrigidos automaticamente (exigem autorização)`)
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
