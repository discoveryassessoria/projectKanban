// scripts/backfill-local-obito.ts — preenche Pessoa.local_obito / estado_obito a partir do texto antigo `local_emigracao`, SÓ onde dá para ler com segurança como
// local de óbito (pessoa faleceu, sem dado de emigração, texto legível). Nunca altera `local_emigracao`; nunca sobrescreve coluna já preenchida; lista o resto.
//   npx tsx scripts/backfill-local-obito.ts            (lista, não grava)
//   npx tsx scripts/backfill-local-obito.ts --executar (grava SÓ as colunas novas; exige as colunas já migradas)
import { PrismaClient } from "@prisma/client"
import { readFileSync } from "node:fs"
import { lerLocalDeObito, podeLerComoObito } from "../src/lib/genealogia/local-obito"

const env = Object.fromEntries(readFileSync(".env", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")] }))
const prisma = new PrismaClient({ datasourceUrl: process.env.PRISMA_DATABASE_URL ?? env.PRISMA_DATABASE_URL })
const EXECUTAR = process.argv.includes("--executar")

;(async () => {
  const jaMigrado = ((await prisma.$queryRawUnsafe(`select count(*)::int n from information_schema.columns where table_name='Pessoa' and column_name='local_obito'`)) as Array<{ n: number }>)[0].n === 1
  const cols = jaMigrado ? `p.local_obito, p.estado_obito,` : `null::text local_obito, null::text estado_obito,`
  const rows = (await prisma.$queryRawUnsafe(`
    select p.id, p.nome || ' ' || coalesce(p.sobrenome,'') pessoa, coalesce(a.nome,'—') familia, p.vivo, p.data_obito, p.local_emigracao, ${cols}
           p.data_emigracao, p.porto_embarque, p.data_chegada, p.porto_chegada, p.pais_destino, p.navio
    from "Pessoa" p left join "Arvore" a on a.id = p."arvoreId"
    where p."removidaEm" is null and p.local_emigracao is not null and btrim(p.local_emigracao) <> '' order by a.nome, p.id`)) as Array<Record<string, any>>
  const gravar: Array<{ id: number; cidade: string; estado: string | null; texto: string; pessoa: string; familia: string }> = []
  const vazios: Array<{ pessoa: string; familia: string; texto: string; motivo: string }> = []
  for (const r of rows) {
    if (r.local_obito) continue // já tem: nunca sobrescreve
    if (!podeLerComoObito(r as never)) { vazios.push({ pessoa: r.pessoa.trim(), familia: r.familia, texto: r.local_emigracao, motivo: r.vivo === false || r.data_obito ? "tem dado de emigração: pode ser local de partida" : "pessoa não consta como falecida" }); continue }
    const l = lerLocalDeObito(r.local_emigracao)
    if (!l) { vazios.push({ pessoa: r.pessoa.trim(), familia: r.familia, texto: r.local_emigracao, motivo: "texto não pôde ser lido com segurança" }); continue }
    gravar.push({ id: r.id, cidade: l.cidade, estado: l.estado, texto: r.local_emigracao, pessoa: r.pessoa.trim(), familia: r.familia })
  }
  console.log(`colunas já migradas: ${jaMigrado} · com texto em local_emigracao: ${rows.length}`)
  console.log(`\nPREENCHE (${gravar.length}):`); for (const g of gravar) console.log(`  ${g.familia} · ${g.pessoa}: «${g.texto}» → cidade «${g.cidade}»${g.estado ? ` · estado ${g.estado}` : ""}`)
  console.log(`\nFICAM VAZIOS, para o Marco (${vazios.length}):`); for (const v of vazios) console.log(`  ${v.familia} · ${v.pessoa}: «${v.texto}» — ${v.motivo}`)
  if (EXECUTAR) {
    if (!jaMigrado) throw new Error("as colunas novas ainda não existem neste banco — nada gravado")
    let n = 0
    for (const g of gravar) n += Number(await prisma.$executeRawUnsafe(`update "Pessoa" set local_obito = $1, estado_obito = $2 where id = $3 and local_obito is null`, g.cidade, g.estado, g.id))
    console.log(`\nGRAVADO: ${n} pessoa(s) (só local_obito/estado_obito; local_emigracao intacto)`)
  } else console.log("\n(dry-run: nada gravado)")
  process.exit(0)
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1) })
