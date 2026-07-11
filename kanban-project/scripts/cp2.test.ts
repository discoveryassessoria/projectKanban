/**
 * CP-2 — testes (unitários, sem servidor/DB).
 * Rodar: npm run test:cp2
 */

import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import {
  codeDocumentoMestre,
  nomeDocumentoMestre,
  resolverItemCatalogoDeTipoServico,
} from "../src/services/catalogo-helpers"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

function run() {
  console.log("CP-2 — testes\n")

  // 1) Helpers do Documento Mestre
  console.log("1) Catálogo Mestre (helpers):")
  ok(codeDocumentoMestre("CERTIDAO_NASCIMENTO") === "DOC_CERTIDAO_NASCIMENTO", "codeDocumentoMestre determinístico")
  ok(codeDocumentoMestre("rg") === "DOC_RG", "codeDocumentoMestre normaliza para maiúsculo")
  ok(nomeDocumentoMestre("CERTIDAO_NASCIMENTO") === "Certidao Nascimento", "nomeDocumentoMestre legível")

  // 2) TipoServico: preferir vínculo canônico, fallback null
  console.log("\n2) TipoServico -> ItemCatalogo:")
  ok(resolverItemCatalogoDeTipoServico({ itemCatalogoId: 7 }) === 7, "prefere itemCatalogoId canônico")
  ok(resolverItemCatalogoDeTipoServico({ itemCatalogoId: null }) === null, "fallback null quando não vinculado")
  ok(resolverItemCatalogoDeTipoServico({}) === null, "fallback null quando ausente")

  // 3) Migration CP-2 aditiva
  console.log("\n3) Migration CP-2 (aditiva/não-destrutiva):")
  const mig = readFileSync(
    join(ROOT, "prisma/migrations/20260711130000_cp2_tiposervico_catalogo/migration.sql"),
    "utf8"
  )
  ok(!/DROP\s+TABLE/i.test(mig), "não contém DROP TABLE")
  ok(!/DROP\s+COLUMN/i.test(mig), "não contém DROP COLUMN")
  ok(/ALTER TABLE "TipoServico" ADD COLUMN\s+"itemCatalogoId"/.test(mig), "adiciona TipoServico.itemCatalogoId")

  // 4) Schema
  console.log("\n4) Schema:")
  const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8")
  ok(/itemCatalogoId\s+Int\?/.test(schema), "schema tem itemCatalogoId aditivo")
  ok(/tiposServico\s+TipoServico\[\]/.test(schema), "ItemCatalogo tem back-relation tiposServico")

  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
  console.log("CP-2: todos os testes verdes ✅")
}

run()
