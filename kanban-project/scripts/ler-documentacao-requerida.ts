// SOMENTE LEITURA (SELECT). Uso: set -a; . ./.env; set +a; npx tsx scripts/ler-documentacao-requerida.ts 675
// Imprime o número ÚNICO (requeridos/recebidos/pendentes) e prova que Geral, Documentos, Central,
// Torre e Home concordam — todos leem de documentacao-requerida.ts / da projeção canônica.
import { prisma } from "../lib/prisma"
import { documentacaoRequeridaDoProcesso } from "../src/lib/process-stage/documentacao-requerida"
import { resolverCompletudeDocumental } from "../src/lib/process-stage/completude-documental"
import { resolveOperationalProjection } from "../src/lib/process-stage/operational-projection"
import { progressoRealDoProcesso } from "../lib/operacional/metricas-processo"

async function main() {
  const pid = Number(process.argv[2])
  if (!Number.isInteger(pid)) throw new Error("informe o id do processo")
  const unico = await documentacaoRequeridaDoProcesso(pid)
  const central = await resolverCompletudeDocumental(pid, { escopoPessoa: "TODAS" })
  const torre = await progressoRealDoProcesso(pid)
  const home = (await resolveOperationalProjection(pid)).progress
  console.log("NÚMERO ÚNICO (Geral + Documentos):", unico)
  console.log("Central (resolverCompletudeDocumental):", central.completed, "de", central.required, `(${central.percentage}%)`)
  console.log("Torre (progressoRealDoProcesso):", torre.completed, "de", torre.required, `(${torre.percentage}%)`)
  console.log("Home (projeção operacional):", home.completedWeight, "de", home.totalWeight, `(${home.percentage}%)`)
  const concordam =
    unico.requeridos === central.required && unico.recebidos === central.completed &&
    torre.required === unico.requeridos && torre.completed === unico.recebidos &&
    home.totalWeight === unico.requeridos && home.completedWeight === unico.recebidos && home.percentage === unico.percentual
  console.log(concordam ? "CONCORDAM: as cinco telas mostram o mesmo número" : "DIVERGEM")
  process.exitCode = concordam ? 0 : 1
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
