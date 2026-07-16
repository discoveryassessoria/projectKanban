/**
 * GUARDA — remoção da aplicação MANUAL de templates financeiros.
 * Rodar: tsx scripts/financeiro-template-manual-guard.test.ts
 *
 * ARQUITETURA NOVA: lançamentos financeiros nascem apenas via Automações por Fase
 * (kind=financial) em resposta a eventos do Workflow Interno. Nenhum usuário
 * aplica templates manualmente. Esta guarda impede a volta do fluxo manual:
 *   1. o modal SeletorTemplate não existe mais;
 *   2. Custos/Receitas não têm botão "Template" nem importam o modal;
 *   3. o endpoint POST /aplicar responde 410 e não cria receita/custo;
 *   4. a biblioteca técnica de templates é PRESERVADA (não alterada).
 *
 * Teste ESTÁTICO (source-scan) — roda sem banco.
 */
import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

let passed = 0, failed = 0
const violacoes: string[] = []
function ok(cond: boolean, nome: string, detalhe?: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; violacoes.push(detalhe ? `${nome} — ${detalhe}` : nome); console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}
function ler(rel: string): string {
  const p = join(ROOT, rel)
  return existsSync(p) ? readFileSync(p, "utf8") : ""
}

// 1) modal removido
console.log("\n1) Modal 'Aplicar Template Financeiro' removido")
ok(!existsSync(join(ROOT, "src/components/financeiro/SeletorTemplate.tsx")), "SeletorTemplate.tsx não existe mais")

// 2) subabas sem botão/import
console.log("\n2) Custos/Receitas sem aplicação manual")
for (const rel of ["src/components/financeiro/subabas/Custos.tsx", "src/components/financeiro/subabas/Receitas.tsx"]) {
  const src = ler(rel)
  const nome = rel.split("/").pop()
  ok(!/import\s*\{\s*SeletorTemplate/.test(src), `${nome} — não importa SeletorTemplate`)
  ok(!/<SeletorTemplate/.test(src), `${nome} — não renderiza SeletorTemplate`)
  ok(!/setTemplateAberto\(true\)/.test(src), `${nome} — sem botão que abre o seletor`)
  ok(!/⚡ Template/.test(src), `${nome} — botão "⚡ Template" removido`)
}

// 3) endpoint de aplicação desativado (410) e sem criar lançamento
console.log("\n3) Endpoint POST /aplicar desativado")
const aplicar = ler("src/app/api/financeiro/templates/aplicar/route.ts")
ok(/status:\s*410/.test(aplicar), "aplicar/route responde 410")
ok(!/prisma\.receita\.create|prisma\.custo\.create|\$transaction/.test(aplicar), "aplicar/route NÃO cria receita/custo/transação")

// 4) biblioteca técnica preservada
console.log("\n4) Biblioteca técnica de templates preservada")
ok(existsSync(join(ROOT, "lib/financeiro/templates.ts")), "lib/financeiro/templates.ts preservado")
ok(existsSync(join(ROOT, "lib/financeiro/templateEngine.ts")), "lib/financeiro/templateEngine.ts preservado")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA TEMPLATE-MANUAL-FINANCEIRO — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("\nViolações:"); for (const v of violacoes) console.log(`  · ${v}`); process.exit(1) }
