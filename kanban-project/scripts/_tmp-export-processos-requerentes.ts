/**
 * SCRIPT TEMPORÁRIO — exportação pré-reset dos processos.
 * Gera `processos_requerentes.xlsx` com: Família | Processo | Requerente
 * (uma linha por requerente). Somente leitura. Pode ser removido depois.
 *
 * Uso: tsx scripts/_tmp-export-processos-requerentes.ts
 */
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import ExcelJS from "exceljs"
import { PrismaClient } from "@prisma/client"

// --- carrega a credencial do banco (produção) a partir do env de rollout ---
function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

const env = loadEnvFile(join(homedir(), ".discovery-prod-rollout.env"))
const dbUrl =
  env.PRISMA_DATABASE_URL || env.DIRECT_DATABASE_URL || env.DATABASE_URL
if (!dbUrl) {
  throw new Error("Nenhuma URL de banco encontrada em ~/.discovery-prod-rollout.env")
}
process.env.PRISMA_DATABASE_URL = dbUrl
process.env.DIRECT_DATABASE_URL = dbUrl

// url passada explicitamente via datasources (não depende da env global)
const prisma = new PrismaClient({
  log: ["warn", "error"],
  datasources: { db: { url: dbUrl } },
})

async function main() {
  // Relações REAIS: Processo → Familia (familiaId) e Processo → Requerente
  // via join ProcessoRequerente. Requerente.nome é o nome completo.
  const processos = await prisma.processo.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      nome: true,
      familia: { select: { nome: true } },
      requerentes: {
        select: { requerente: { select: { id: true, nome: true } } },
      },
    },
  })

  type Row = { familia: string; processo: number; requerente: string }
  const rows: Row[] = []
  let processosSemRequerente = 0

  for (const p of processos) {
    const familiaNome = (p.familia?.nome ?? p.nome ?? "").trim()
    const reqs = p.requerentes
      .map((pr) => pr.requerente)
      .filter((r): r is { id: number; nome: string } => !!r)

    if (reqs.length === 0) {
      // nada é descartado silenciosamente: processo sem requerente vira 1 linha
      processosSemRequerente++
      rows.push({ familia: familiaNome, processo: p.id, requerente: "" })
      continue
    }
    for (const r of reqs) {
      rows.push({ familia: familiaNome, processo: p.id, requerente: (r.nome ?? "").trim() })
    }
  }

  // --- gera o XLSX ---
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Processos x Requerentes")
  ws.columns = [
    { header: "Família", key: "familia", width: 40 },
    { header: "Processo", key: "processo", width: 14 },
    { header: "Requerente", key: "requerente", width: 40 },
  ]
  ws.getRow(1).font = { bold: true }
  for (const r of rows) ws.addRow(r)

  const outPath = join(homedir(), "processos_requerentes.xlsx")
  await wb.xlsx.writeFile(outPath)

  console.log("---------------------------------------------")
  console.log(`Banco             : ${new URL(dbUrl).host}`)
  console.log(`Processos lidos   : ${processos.length}`)
  console.log(`Requerentes(linhas): ${rows.length - processosSemRequerente}`)
  console.log(`Sem requerente    : ${processosSemRequerente} (linha com requerente vazio)`)
  console.log(`Total de linhas   : ${rows.length}`)
  console.log(`Arquivo gerado    : ${outPath}`)
  console.log("---------------------------------------------")
}

main()
  .catch((e) => {
    console.error("FALHA na exportação:", e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
