/**
 * LOTE B — Serviços & Produtos consolidados no ItemCatalogo (mestre).
 * Puros (helpers + backfill core, sem banco) + estruturais. Rodar: npm run test:lote-b
 */
import { codeServicoMestre, codeProdutoMestre, resolverItemCatalogoDeServico } from "../src/services/catalogo-helpers"
import { planejarServicos, planejarProdutos } from "../prisma/backfill-lote-b-catalogo.core"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const src = (p: string) => readFileSync(join(ROOT, p), "utf8")

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

console.log("LOTE B — ItemCatalogo como mestre de Serviços & Produtos\n")

// ── Helpers puros de derivação de code ──────────────────────────────────────
console.log("Helpers de code canônico:")
ok(codeServicoMestre("nascimento") === "SRV_NASCIMENTO", "1. codeServicoMestre prefixa SRV_ e normaliza")
ok(codeProdutoMestre("hon-01") === "PRD_HON-01", "2. codeProdutoMestre prefixa PRD_ e normaliza")
ok(resolverItemCatalogoDeServico({ itemCatalogoId: 7 }) === 7 && resolverItemCatalogoDeServico({ itemCatalogoId: null }) === null, "3. dual-read: prefere itemCatalogoId, fallback null")

// ── Backfill core (puro, idempotente) ───────────────────────────────────────
console.log("\nBackfill core (importável sem banco):")
ok(typeof planejarServicos === "function" && typeof planejarProdutos === "function", "4. core importável sem abrir conexão")
const planoS = planejarServicos([
  { id: 1, code: "abc", name: "ABC", category: "cat", itemCatalogoId: null },
  { id: 2, code: "xyz", name: "XYZ", category: null, itemCatalogoId: 99 }, // já vinculado → pula
])
ok(planoS.length === 1 && planoS[0].code === "SRV_ABC" && planoS[0].id === 1, "5. planejarServicos: pula vinculados, deriva SRV_ code")
const planoP = planejarProdutos([
  { id: 10, codigo: "p1", nome: "P1", itemCatalogoId: null },
  { id: 11, codigo: "p2", nome: "P2", itemCatalogoId: 5 },
])
ok(planoP.length === 1 && planoP[0].code === "PRD_P1", "6. planejarProdutos: pula vinculados, deriva PRD_ code")

// ── Dual-write nas rotas ────────────────────────────────────────────────────
console.log("\nDual-write (ItemCatalogo mestre):")
const sync = src("src/services/catalogo-sync.ts")
ok(/NaturezaItem\.SERVICO/.test(sync) && /NaturezaItem\.PRODUTO/.test(sync) && /itemCatalogo\.upsert/.test(sync), "7. serviço de sync faz upsert por natureza SERVICO/PRODUTO")
const psRoute = src("src/app/api/gerenciamento/produtos-servicos/route.ts")
const psId = src("src/app/api/gerenciamento/produtos-servicos/[id]/route.ts")
ok(/sincronizarItemDeServico/.test(psRoute) && /\$transaction/.test(psRoute) && /itemCatalogoId/.test(psRoute), "8. POST serviço: dual-write em transação, grava itemCatalogoId")
ok(/sincronizarItemDeServico/.test(psId) && /\$transaction/.test(psId), "9. PUT serviço: re-sincroniza o mestre")
const pRoute = src("src/app/api/gerenciamento/produtos/route.ts")
const pId = src("src/app/api/gerenciamento/produtos/[id]/route.ts")
ok(/sincronizarItemDeProduto/.test(pRoute) && /\$transaction/.test(pRoute) && /itemCatalogoId/.test(pRoute), "10. POST produto: dual-write, grava itemCatalogoId")
ok(/sincronizarItemDeProduto/.test(pId) && /\$transaction/.test(pId), "11. PUT produto: re-sincroniza o mestre")

// ── Backfill runner (aditivo, dupla trava, guardado) ────────────────────────
console.log("\nBackfill runner:")
const runner = src("prisma/backfill-lote-b-catalogo.ts")
ok(/BACKFILL_EXECUTE\s*===\s*'1'/.test(runner) && /--execute/.test(runner), "12. runner: dupla trava (--execute + BACKFILL_EXECUTE=1)")
ok(/invocadoDireto/.test(runner) && /from '\.\/backfill-lote-b-catalogo\.core'/.test(runner), "13. runner: guarda main() e delega ao core")
ok(/data:\s*\{\s*itemCatalogoId/.test(runner) && !/delete|drop/i.test(runner.replace(/\/\/.*$/gm, "")), "14. runner só grava itemCatalogoId (aditivo, sem destruição)")

// ── Depreciação de ServicoProduto (UI) ──────────────────────────────────────
console.log("\nDepreciação ServicoProduto:")
const tab = src("src/components/gerenciamentoComponents/ProdutosServicosTab.tsx")
ok(/Tela legada/.test(tab) && /Cat[aá]logo Mestre/.test(tab), "15. tela de Serviços marca depreciação → Catálogo Mestre")

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("LOTE B validado ✅")
