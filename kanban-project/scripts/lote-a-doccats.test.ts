/**
 * LOTE A — Documentos & Categorias Documentais (pós-correção arquitetural).
 * CategoriaDocumental = FONTE CANÔNICA consumida por ID. Rodar: npm run test:doccats
 * Estruturais (regex sobre fonte) + puros (mapa + backfill core, sem banco).
 */
import { MANAGEMENT_NAVIGATION } from "../src/components/gerenciamentoComponents/managementNavigation"
import { CODE_TO_LEGACY, LEGACY_TO_CODE, legacyFromCode, codeFromLegacy, SYSTEM_CATEGORY_CODES } from "../src/lib/document-category-map"
import { planejarBackfill } from "../prisma/backfill-document-categories.core"
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

console.log("LOTE A — Categoria Documental como fonte canônica\n")
const CODES = ["REGISTRO_CIVIL", "IDENTIDADE", "JUDICIAL", "CONSULAR", "TRADUCAO", "APOSTILA", "OUTRO"]

// ── C1: resolver oficial expõe classificação canônica ──────────────────────
console.log("C1 — resolver oficial (consumo por ID/code):")
const resolver = src("src/lib/document-type-resolver.ts")
ok(/categoriaDocumentalId:\s*number \| null/.test(resolver) && /categoriaDocumentalCode:\s*string \| null/.test(resolver) && /categoriaDocumentalNome:\s*string \| null/.test(resolver), "1. TipoResolvido expõe categoriaDocumentalId/Code/Nome")
ok(/naturezaDocumental:\s*string \| null/.test(resolver), "1b. TipoResolvido expõe naturezaDocumental (eixo distinto)")
ok(/include:\s*INCLUDE_CATEGORIA/.test(resolver) && /categoriaDocumental:\s*\{\s*select/.test(resolver), "1c. resolver carrega a relação categoriaDocumental")
ok(/rel\?\.id \?\? null/.test(resolver) && /codeFromLegacy\(t\.category\)/.test(resolver), "1d. dual-read: prefere FK, deriva code do legado só como fallback")
const catalogo = src("src/services/catalogo.ts")
ok(/categoriaDocumentalId:\s*t\.categoriaDocumentalId/.test(catalogo) && /categoriaDocumentalCode:\s*t\.categoriaDocumentalCode/.test(catalogo), "2. consumidor catalogo.ts propaga classificação por ID/code")
ok(!/use ISTO p\/ regra[^\n]*category/.test(resolver), "2b. contrato não manda mais usar a string legada `category` para regra")

// ── nature × categoria (semântica) ─────────────────────────────────────────
console.log("\nSemântica nature × categoria:")
ok(/SUBTIPO técnico/.test(resolver) && /Eixo diferente|eixo DISTINTO|eixo distinto/i.test(resolver), "3. resolver documenta nature como eixo distinto (não duplica categoria)")
ok(/naturezaDocumental.*=.*subtipo|subtipo técnico do documento/i.test(src("prisma/schema.prisma")) || /Eixo distinto de `nature`/.test(src("prisma/schema.prisma")), "3b. schema documenta o eixo distinto")

// ── C2: UI/APIs leem a FK ──────────────────────────────────────────────────
console.log("\nC2 — UI/APIs pela FK:")
const tdRoute = src("src/app/api/gerenciamento/tipos-documento/route.ts")
const tdId = src("src/app/api/gerenciamento/tipos-documento/[id]/route.ts")
ok(/include:\s*INCLUDE_CATEGORIA/.test(tdRoute) && /categoriaDocumental:\s*\{\s*select/.test(tdRoute), "4. GET tipos-documento inclui a relação categoriaDocumental")
ok(/include:\s*INCLUDE_CATEGORIA/.test(tdId), "4b. PUT retorna a relação incluída")
const tdTab = src("src/components/gerenciamentoComponents/TiposDocumentoTab.tsx")
ok(/d\.categoriaDocumental\?\.name/.test(tdTab), "5. grade exibe categoriaDocumental.name (FK), não mapa local")
ok(!/const CATEGORIES/.test(tdTab) && !/catLabel/.test(tdTab), "6. CATEGORIES e catLabel removidos da tela")
ok(!/const opt =/.test(tdTab), "6b. código morto `opt` removido (B1)")
ok(/legacyFromCode\(cat\.code\)/.test(tdRoute) && !/legacyFromCode\(cat\.code\)\s*\?\?\s*categoryLegado/.test(tdRoute), "7. POST não infere fonte pelo texto; categoria sem legado grava FK e category=null")

// ── C3: sem hardcodes duplicados ───────────────────────────────────────────
console.log("\nC3 — hardcodes removidos:")
const catalogs = src("src/components/gerenciamentoComponents/gerenciamentoCatalogs.ts")
ok(!/op_doctypes:/.test(catalogs), "8. op_doctypes (scaffold hardcoded) aposentado")
ok(!/op_certtypes'?:/.test(catalogs), "8b. op_certtypes aposentado")
ok(!/'civil_registry',\s*'identity'/.test(catalogs), "9. lista fixa das 7 categorias removida de gerenciamentoCatalogs")
// única ponte legada = document-category-map
ok(SYSTEM_CATEGORY_CODES.length === 7 && CODES.every((c) => SYSTEM_CATEGORY_CODES.includes(c)), "9b. document-category-map é a única fonte dos codes de bootstrap")

// ── A1: certtypes só resolve para doctypes ─────────────────────────────────
console.log("\nA1 — certtypes:")
const page = src("src/app/administrator/page.tsx")
ok(!/certtypes:\s*cat\(/.test(page), "10. entrada morta `certtypes: cat(op_certtypes)` removida de TELAS")
ok(/certtypes:\s*"doctypes"/.test(page), "11. alias certtypes → doctypes preservado (deep-link)")

// ── A2/M1: exclusão + contagem híbrida ─────────────────────────────────────
console.log("\nA2/M1 — exclusão e contagem híbrida:")
const catRoute = src("src/app/api/gerenciamento/categorias-documentais/route.ts")
const catId = src("src/app/api/gerenciamento/categorias-documentais/[id]/route.ts")
ok(/contarUsos/.test(catId) && /categoriaDocumentalId:\s*null,\s*category:\s*legacy/.test(catId), "12. DELETE conta FK + legado")
ok(/code:\s*'IN_USE'[^}]*usosFk[^}]*usosLegado/.test(catId), "12b. 409 IN_USE detalha total/fk/legado")
ok(/tiposCountFk/.test(catRoute) && /tiposCountLegado/.test(catRoute) && /fk \+ legado/.test(catRoute), "13. listagem mostra contagem real (FK + legado)")

// ── A3: codes e categorias de sistema ──────────────────────────────────────
console.log("\nA3 — proteção de code/sistema:")
const schema = src("prisma/schema.prisma")
ok(/sistema\s+Boolean\s+@default\(false\)/.test(schema), "14. schema tem flag `sistema`")
ok(/code:\s*'CODE_IMMUTABLE'/.test(catId) && /imutável após a criação/.test(catId), "15. PUT bloqueia mudança de code (409 CODE_IMMUTABLE)")
ok(/exists\.sistema/.test(catId) && /code:\s*'SYSTEM'/.test(catId), "16. DELETE bloqueia categoria de sistema (409 SYSTEM)")
const mig = src("prisma/migrations/20260713120000_categoria_documental/migration.sql")
ok(/"sistema" BOOLEAN NOT NULL DEFAULT false/.test(mig) && CODES.every((c) => new RegExp(`'${c}'[^\\n]*true`).test(mig)), "17. migration semeia 7 categorias com sistema=true")

// ── A4: categoria inativa na edição ────────────────────────────────────────
console.log("\nA4 — categoria inativa na edição:")
ok(/currentInactive=\{form\.currentCat/.test(tdTab), "18. tela passa currentInactive ao selector")
ok(/currentCat:\s*d\.categoriaDocumental/.test(tdTab), "18b. edição captura a categoria vinculada (mesmo inativa)")
const selector = src("src/components/gerenciamentoComponents/DocumentCategorySelector.tsx")
ok(/currentInactive/.test(selector) && /\(inativa\)/.test(selector), "18c. selector mantém e rotula a categoria inativa")

// ── M2/M3: backfill puro e testável ────────────────────────────────────────
console.log("\nM2/M3 — backfill:")
// prova de importabilidade sem banco: se este arquivo rodou, o import do core acima não conectou
ok(typeof planejarBackfill === "function", "19. backfill core importável sem abrir conexão")
const runner = src("prisma/backfill-document-categories.ts")
const core = src("prisma/backfill-document-categories.core.ts")
ok(/from '\.\/backfill-document-categories\.core'/.test(runner) && /invocadoDireto/.test(runner), "20. runner delega ao core e guarda main() (sem side-effect no import)")
ok(/document-category-map/.test(core) && !/civil_registry:/.test(runner) && !/civil_registry:/.test(core), "21. backfill usa mapa compartilhado (sem cópia própria)")
// comportamento puro
const plano = planejarBackfill(
  [
    { id: 1, category: "civil_registry", categoriaDocumentalId: null },
    { id: 2, category: "identity", categoriaDocumentalId: 99 }, // já vinculado → skip
    { id: 3, category: null, categoriaDocumentalId: null },     // sem categoria
  ],
  CODES.map((code, i) => ({ id: i + 1, code })),
)
ok(plano.relatorio.jaVinculados === 1 && plano.relatorio.aVincular === 1 && plano.relatorio.semCategoria === 1 && !plano.abortar, "22. planejarBackfill: idempotente + resolve conhecido")
const planoRuim = planejarBackfill([{ id: 1, category: "xpto_desconhecido", categoriaDocumentalId: null }], CODES.map((code, i) => ({ id: i + 1, code })))
ok(planoRuim.abortar && planoRuim.relatorio.totalDesconhecidos === 1, "22b. planejarBackfill aborta em valor desconhecido (não inventa)")

// ── M4: filtro Certidões estruturado ───────────────────────────────────────
console.log("\nM4 — filtro Certidões estruturado:")
ok(/ehCertidaoEstruturado\s*=\s*\(r: Tipo\)\s*=>\s*r\.nature/.test(tdTab), "23. filtro Certidões usa nature (classificação estruturada)")
ok(/usaFallbackTextual/.test(tdTab) && /certPorNature/.test(tdTab) && /certPorTexto/.test(tdTab), "24. fallback textual isolado e CONTABILIZADO (cobertura)")
ok(/Cobertura:[\s\S]*por natureza estruturada[\s\S]*por fallback textual/.test(tdTab), "24b. UI mostra a cobertura estruturada vs fallback")

// ── B3: GET filtra no Prisma ───────────────────────────────────────────────
console.log("\nB3/B4:")
ok(/where:\s*Prisma\.CategoriaDocumentalWhereInput/.test(catRoute) && /mode:\s*'insensitive'/.test(catRoute), "25. GET categorias filtra via Prisma where (não em memória)")
ok(/onDelete:\s*Restrict/.test(schema) && /ON DELETE RESTRICT/.test(mig), "26. FK RESTRICT (schema + migration) — sem desclassificação silenciosa")

// ── mapa canônico (dual-read/write) ────────────────────────────────────────
console.log("\nMapa canônico:")
ok(CODES.every((c) => LEGACY_TO_CODE[CODE_TO_LEGACY[c]] === c), "27. LEGACY_TO_CODE inverso exato de CODE_TO_LEGACY")
ok(legacyFromCode("REGISTRO_CIVIL") === "civil_registry" && legacyFromCode("MILITAR") === null, "28. legacyFromCode: null p/ categoria nova sem legado (não rejeita)")
ok(codeFromLegacy("civil_registry") === "REGISTRO_CIVIL" && codeFromLegacy("zzz") === null, "28b. codeFromLegacy resolve e não inventa")

// ── Navegação ──────────────────────────────────────────────────────────────
console.log("\nNavegação:")
const itens = MANAGEMENT_NAVIGATION.flatMap((g) => g.children ?? [])
const doccats = itens.find((i) => i.key === "doccats")
ok(!!doccats && doccats.status === "active", "29. item Categorias Documentais (doccats) ativo em Documentos")
ok(/doccats:\s*CategoriasDocumentaisTab/.test(page), "29b. TELAS mapeia doccats → CategoriasDocumentaisTab")

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("LOTE A (fonte canônica) validado ✅")
