// scripts/ci/capturar-referencia-producao.ts
// ============================================================================
// FOTOGRAFA (SÓ LEITURA) OS DADOS DE REFERÊNCIA DE PRODUÇÃO que os testes precisam encontrar já
// existindo — configuração, nunca pessoa/processo/financeiro: hoje, o Catálogo de Fases
// (competência de efeitos por fase, escopo, condução pelo workflow interno).
//
//   npx tsx scripts/ci/capturar-referencia-producao.ts        # usa o .env (produção) — SÓ LÊ
//
// Grava scripts/ci/fixtures/catalogo-fase.json; `criar-banco-de-teste.mjs` o carrega. Rode de
// novo quando o Catálogo de Fases mudar em produção (o gate de build NUNCA lê produção: ele usa
// este arquivo versionado).
// ============================================================================
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "../../lib/prisma"

async function main() {
  const fases = await prisma.catalogoFase.findMany({ orderBy: { ordemPadrao: "asc" } })
  // Fases de teste esquecidas em produção (teste_*, auditoria_final_*) e a chave legada `transcricoes` não são referência.
  const saida = fases.filter((f) => !/^(teste|auditoria_final|transcricoes)/.test(f.phaseKey)).map(({ id: _id, criadoEm: _c, atualizadoEm: _a, ...resto }) => resto)
  const arquivo = join(__dirname, "fixtures", "catalogo-fase.json")
  writeFileSync(arquivo, JSON.stringify(saida, null, 1) + "\n")
  console.log(`✅ ${saida.length} fase(s) do catálogo → ${arquivo}`)
  await prisma.$disconnect()
}
main()
