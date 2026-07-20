// scripts/codigos-reconciliacao.ts
// DIAGNÓSTICO (read-only) dos códigos públicos — cobre TODAS as entidades do CODE_REGISTRY + as
// já concluídas (Processo/Receita/Custo). NÃO corrige nada silenciosamente: apenas relata sem
// código, duplicados, formato inválido e sequência abaixo do maior código. Execução:
//   PRISMA_DATABASE_URL=... npx tsx scripts/codigos-reconciliacao.ts
import { prisma } from "@/lib/prisma"
import { escopoDe } from "@/lib/codigos/code-patterns"
import { CODE_REGISTRY } from "@/lib/codigos/entity-registry"

type Alvo = { tabela: string; coluna: string; prefixo: string; scope: string | null; iso?: boolean }
// Registro-driven + as já concluídas (usam o mesmo gerador por chamada explícita).
const ALVOS: Alvo[] = [
  ...Object.entries(CODE_REGISTRY).map(([tabela, cfg]) => ({ tabela, coluna: cfg.campo, prefixo: escopoDe(cfg.entidade), scope: escopoDe(cfg.entidade) })),
  { tabela: "Processo", coluna: "codigo", prefixo: "[A-Z]{2}", scope: null, iso: true },
  { tabela: "Receita", coluna: "codigo", prefixo: "REC", scope: "REC" },
  { tabela: "Custo", coluna: "codigo", prefixo: "CUS", scope: "CUS" },
]

const q = <T = Record<string, unknown>>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql)

async function main() {
  let problemas = 0
  for (const e of ALVOS) {
    const semCodigo = (await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "${e.tabela}" WHERE "${e.coluna}" IS NULL`))[0].n
    const dups = await q<{ c: string }>(`SELECT "${e.coluna}" AS c FROM "${e.tabela}" WHERE "${e.coluna}" IS NOT NULL GROUP BY "${e.coluna}" HAVING COUNT(*) > 1`)
    const fmt = `^${e.prefixo}-[1-9][0-9]*$`
    const invalidos = await q<{ c: string }>(`SELECT "${e.coluna}" AS c FROM "${e.tabela}" WHERE "${e.coluna}" IS NOT NULL AND "${e.coluna}" !~ '${fmt}' LIMIT 10`)
    let seqAbaixo: string | null = null
    if (e.scope) {
      const maxn = (await q<{ maxn: number }>(`SELECT COALESCE(MAX(CAST(split_part("${e.coluna}", '-', 2) AS INT)), 0) AS maxn FROM "${e.tabela}" WHERE "${e.coluna}" ~ '^${e.scope}-[0-9]+$'`))[0]?.maxn ?? 0
      const ultimo = (await q<{ ultimo: number }>(`SELECT COALESCE("ultimo",0) AS ultimo FROM "CodeSequence" WHERE "scope" = '${e.scope}'`))[0]?.ultimo ?? 0
      if (maxn > ultimo) seqAbaixo = `sequência ${e.scope}=${ultimo} ABAIXO do maior código ${maxn}`
    }
    const issues = [semCodigo > 0 ? `${semCodigo} sem código` : "", dups.length ? `${dups.length} duplicado(s): ${dups.map(d => d.c).join(",")}` : "",
      invalidos.length ? `${invalidos.length} formato inválido: ${invalidos.map(i => i.c).join(",")}` : "", seqAbaixo ?? ""].filter(Boolean)
    if (issues.length) { problemas += issues.length; console.log(`⚠ ${e.tabela}.${e.coluna}: ${issues.join(" | ")}`) }
    else console.log(`✓ ${e.tabela}.${e.coluna} (${e.prefixo}): ok`)
  }
  console.log(problemas === 0 ? "\n✓ RECONCILIAÇÃO LIMPA" : `\n⚠ ${problemas} problema(s) — NÃO corrigidos automaticamente (exigem autorização)`)
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
