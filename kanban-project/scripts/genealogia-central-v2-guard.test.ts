/**
 * GUARDA — Central Operacional da Genealogia ligada à arquitetura V2.
 * Rodar: tsx scripts/genealogia-central-v2-guard.test.ts
 *
 * A Central da Genealogia NÃO pode mais servir o estado neutro de reestruturação
 * nem calcular por Documento.status/linhaReta/STATUS_VALIDADOS. Fonte = necessidades
 * de CERTIDÃO + passos localizar_registro. Teste ESTÁTICO (source-scan).
 */
import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
let passed = 0, failed = 0
const viol: string[] = []
function ok(c: boolean, n: string) { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; viol.push(n); console.log(`  ❌ ${n}`) } }
const ler = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")

const route = ler("src/app/api/processos/[processoId]/central-operacional/route.ts")

console.log("\n1) Central da Genealogia usa a fonte V2")
ok(/faseAtualCode === "GENEALOGIA"[\s\S]*?phaseWorkflowStepInstance\.findMany[\s\S]*?stepKey: "localizar_registro"/.test(route), "carrega passos localizar_registro para a Genealogia")
ok(/faseAtualCode === "GENEALOGIA"[\s\S]*?necessidadeDocumental\.findMany/.test(route), "carrega NecessidadeDocumental para a Genealogia")
ok(/itemCatalogosDeCertidao/.test(route), "filtra por CERTIDÃO (natureza estruturada)")

console.log("\n2) Estado neutro de reestruturação é DESLIGADO quando há V2")
ok(/genealogiaReestruturacao:\s*genealogiaV2\s*\?\s*false\s*:/.test(route), "response: genealogiaReestruturacao = false quando genealogiaV2 monta a Central")
ok(/mensagemReestruturacao:\s*genealogiaV2\s*\?\s*null\s*:/.test(route), "response: mensagem neutra some quando V2 ativo")

console.log("\n3) Progresso da Genealogia vem dos passos obrigatórios (não Documento.status)")
ok(/obrig\.filter\(\(n\) => localizado\(n\.id\)\)/.test(route), "progresso = passos localizar_registro obrigatórios concluídos")
// matrix BASE vem do V2 (byPerson/faltantes detalhados); o headline de progresso
// (percentage/completed/total) é sobrescrito pela PROJEÇÃO OFICIAL (mesmo % do Kanban).
ok(/matrixBase = genealogiaV2 \? genealogiaV2\.matrix : matrix/.test(route) && /queue: genealogiaV2 \? genealogiaV2\.queue : queue/.test(route), "matrix (base) e queue da Genealogia vêm do V2")
ok(/percentage: projection\.progress\.percentage/.test(route), "headline de progresso vem da projeção oficial (matrixOficial)")

console.log("\n4) Front reconhece 'localizado' como concluído")
const front = ler("src/components/kanban/ProcessoCentralOperacional.tsx")
ok(/includes\("localizado"\)/.test(front), "statusParaCls trata 'localizado' como concluído (verde)")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA CENTRAL V2 — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + viol.join("; ")); process.exit(1) }
