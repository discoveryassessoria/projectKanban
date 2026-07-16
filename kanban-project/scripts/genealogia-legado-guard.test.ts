/**
 * GUARDA — desativação da lógica antiga da Genealogia.
 * Rodar: tsx scripts/genealogia-legado-guard.test.ts
 *
 * Esta tarefa foi de DESATIVAÇÃO/LIMPEZA (sem substituto). A guarda impede a
 * reintrodução acidental do legado inconsistente:
 *   1. criar/editar Pessoa NÃO pode chamar reconcileDocsForPessoa (auto-geração);
 *   2. document-generator: reconcile* precisam do guard anti-reativação;
 *   3. endpoint /pessoas/[id]/reconcile precisa estar desativado (410, sem chamar gerador);
 *   4. central-operacional precisa neutralizar a Genealogia (flag + STATUS_VALIDADOS
 *      não usado como verdade da fase Genealogia);
 *   5. o avanço de fase continua gated por blocking-engine (NecessidadeDocumental/steps),
 *      SEM depender de matrix.percentage/STATUS_VALIDADOS/linhaRetaDocs.
 *
 * É um teste ESTÁTICO (source-scan) — roda sem banco, cobre o que o tsc não pega.
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

/** Lê arquivo removendo comentários de linha (// ...) para não gerar falso-positivo. */
function lerSemComentarios(rel: string): string {
  const p = join(ROOT, rel)
  if (!existsSync(p)) return ""
  return readFileSync(p, "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n")
}
function lerBruto(rel: string): string {
  const p = join(ROOT, rel)
  return existsSync(p) ? readFileSync(p, "utf8") : ""
}

// --------------------------------------------------------------------------
// 1) Criar/editar Pessoa NÃO chama reconcileDocsForPessoa (fora de comentário)
// --------------------------------------------------------------------------
console.log("\n1) Pessoa — sem auto-geração de Documento")
const pessoasPost = lerSemComentarios("src/app/api/pessoas/route.ts")
const pessoasPut = lerSemComentarios("src/app/api/pessoas/[id]/route.ts")
ok(!/reconcileDocsForPessoa/.test(pessoasPost), "POST /api/pessoas NÃO chama reconcileDocsForPessoa")
ok(!/reconcileDocsForPessoa/.test(pessoasPut), "PUT /api/pessoas/[id] NÃO chama reconcileDocsForPessoa")
ok(!/from ["']@\/src\/lib\/document-generator["']/.test(pessoasPost), "POST /api/pessoas NÃO importa document-generator")
ok(!/from ["']@\/src\/lib\/document-generator["']/.test(pessoasPut), "PUT /api/pessoas/[id] NÃO importa document-generator")

// --------------------------------------------------------------------------
// 2) document-generator: guard anti-reativação nas funções que criam Documento
// --------------------------------------------------------------------------
console.log("\n2) document-generator — LEGADO_INATIVO com guard")
const docGen = lerBruto("src/lib/document-generator.ts")
ok(/LEGADO_INATIVO/.test(docGen), "document-generator marcado como LEGADO_INATIVO")
ok(/__assertGeracaoDocumentalDesativada/.test(docGen), "guard __assertGeracaoDocumentalDesativada existe")
// as duas funções que persistem Documento chamam o guard no corpo
const reconcilePessoa = (docGen.match(/export async function reconcileDocsForPessoa[\s\S]*?\n\}/) || [""])[0]
const reconcileArvore = (docGen.match(/export async function reconcileAllForArvore[\s\S]*?\n\}/) || [""])[0]
ok(/__assertGeracaoDocumentalDesativada\(\)/.test(reconcilePessoa), "reconcileDocsForPessoa chama o guard")
ok(/__assertGeracaoDocumentalDesativada\(\)/.test(reconcileArvore), "reconcileAllForArvore chama o guard")

// --------------------------------------------------------------------------
// 3) endpoint /pessoas/[id]/reconcile desativado (410, sem chamar gerador)
// --------------------------------------------------------------------------
console.log("\n3) endpoint reconcile — desativado")
const reconcileRoute = lerSemComentarios("src/app/api/pessoas/[id]/reconcile/route.ts")
ok(/status:\s*410/.test(reconcileRoute), "reconcile/route responde 410")
ok(!/reconcileDocsForPessoa\s*\(/.test(reconcileRoute) && !/dryRunReconcile\s*\(/.test(reconcileRoute),
  "reconcile/route NÃO executa reconcile/dryRun")

// --------------------------------------------------------------------------
// 4) central-operacional neutraliza a Genealogia
// --------------------------------------------------------------------------
console.log("\n4) Central Operacional — Genealogia neutralizada")
const central = lerBruto("src/app/api/processos/[processoId]/central-operacional/route.ts")
ok(/genealogiaReestruturacao\s*=\s*faseAtualCode\s*===\s*"GENEALOGIA"/.test(central),
  "flag genealogiaReestruturacao derivada da fase GENEALOGIA")
ok(/mensagemReestruturacao/.test(central), "mensagem neutra de reestruturação presente")
// A matriz neutra da Genealogia zera os agregados
ok(/genealogiaReestruturacao\s*\n?\s*\?\s*\{[\s\S]*?percentage:\s*0/.test(central.replace(/\r/g, "")) ||
   /genealogiaReestruturacao[\s\S]{0,120}percentage:\s*0/.test(central),
  "matrix da Genealogia é neutralizada (percentage/total zerados)")
// front consome o flag
const front = lerBruto("src/components/kanban/ProcessoCentralOperacional.tsx")
ok(/modoReestruturacao=\{!!data\.genealogiaReestruturacao\}/.test(front),
  "ProcessoCentralOperacional passa modoReestruturacao ao PainelDaFase")
const painel = lerBruto("src/components/kanban/PainelDaFase.tsx")
ok(/modoReestruturacao/.test(painel), "PainelDaFase suporta modoReestruturacao (esconde KPIs/progresso antigos)")

// --------------------------------------------------------------------------
// 5) Avanço de fase independente das métricas antigas
// --------------------------------------------------------------------------
console.log("\n5) Avanço de fase — gated por blocking-engine, sem métricas antigas")
const phaseAdvance = lerBruto("src/lib/motor/phase-advance.ts")
ok(/calcularPendencias/.test(phaseAdvance), "phase-advance usa calcularPendencias (blocking-engine)")
ok(!/STATUS_VALIDADOS/.test(phaseAdvance), "phase-advance NÃO usa STATUS_VALIDADOS")
ok(!/matrix\.percentage/.test(phaseAdvance) && !/central-operacional/.test(phaseAdvance),
  "phase-advance NÃO depende de matrix.percentage/central-operacional")
const blocking = lerBruto("src/lib/motor/blocking-engine.ts")
ok(/necessidadeDocumental/i.test(blocking) || /NecessidadeDocumental/.test(blocking),
  "blocking-engine gate usa NecessidadeDocumental (camada preservada)")
ok(!/STATUS_VALIDADOS/.test(blocking) && !/linhaReta/.test(blocking),
  "blocking-engine NÃO usa STATUS_VALIDADOS/linhaReta como gate")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA GENEALOGIA-LEGADO — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("\nViolações:"); for (const v of violacoes) console.log(`  · ${v}`); process.exit(1) }
