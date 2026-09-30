// scripts/ci/carregar-referencia.ts — carrega no banco de TESTE os dados de referência de
// produção fotografados em scripts/ci/fixtures (ver capturar-referencia-producao.ts).
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { exigirBancoDeTeste } from "../_banco-de-teste"
exigirBancoDeTeste("carregar-referencia.ts")

import { prisma } from "../../lib/prisma"

async function main() {
  const fases = JSON.parse(readFileSync(join(__dirname, "fixtures", "catalogo-fase.json"), "utf8")) as Array<Record<string, unknown> & { phaseKey: string }>
  for (const f of fases) {
    await prisma.catalogoFase.upsert({ where: { phaseKey: f.phaseKey }, update: f as never, create: f as never })
  }
  console.log(`✅ catálogo de fases de referência: ${fases.length} fase(s) (efeitos permitidos como em produção)`)
  await prisma.$disconnect()
}
main()
