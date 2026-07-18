/**
 * GUARDA — ciclo de vida CANÔNICO da NecessidadeDocumental.
 * Rodar: tsx scripts/necessidade-lifecycle-guard.test.ts
 *
 * A necessidade evolui PENDENTE → EM_ATENDIMENTO → ATENDIDA por EVENTOS do Workflow,
 * via um serviço ÚNICO do domínio. Nenhum componente escreve o status direto. O resolver
 * canônico consome o ESTADO OFICIAL (n.status), não infere pelo passo. Teste ESTÁTICO.
 */
import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
let passed = 0, failed = 0
const viol: string[] = []
function ok(c: boolean, n: string) { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; viol.push(n); console.log(`  ❌ ${n}`) } }
const ler = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")

const svc = ler("src/services/necessidade-documental.ts")
const op = ler("src/services/documento-operacao.ts")
const apiRoute = ler("src/app/api/processos/[processoId]/necessidades/[necessidadeId]/route.ts")
const materializar = ler("src/services/genealogia/materializar-genealogia.ts")
const core = ler("src/lib/motor/operational-projection-core.ts")

console.log("\n1) Serviço ÚNICO de domínio com as transições canônicas")
ok(/export async function iniciarAtendimentoNecessidade/.test(svc), "iniciarAtendimentoNecessidade (PENDENTE→EM_ATENDIMENTO)")
ok(/export async function atenderNecessidade/.test(svc), "atenderNecessidade (→ATENDIDA)")
ok(/export async function dispensarNecessidade/.test(svc), "dispensarNecessidade (→DISPENSADA)")
ok(/export async function reativarNecessidade/.test(svc), "reativarNecessidade (DISPENSADA→PENDENTE)")
ok(/export async function evoluirNecessidadePorPasso/.test(svc), "driver evoluirNecessidadePorPasso (estado do passo → estado da necessidade)")
ok(/n\.status === "ATENDIDA" \|\| n\.status === "DISPENSADA"[\s\S]*?return/.test(svc), "atender é idempotente e não sobrescreve DISPENSADA")

console.log("\n2) Evolução por EVENTO do Workflow (único gatilho), não por tela")
ok(/if \(p\.necessidadeId != null\) \{[\s\S]*?evoluirNecessidadePorPasso\(p\.necessidadeId, novo\)/.test(op), "atualizarPassoV2 dispara o driver ao evoluir o passo vinculado")

console.log("\n3) Nenhum componente escreve o status direto (usa o serviço)")
ok(!/necessidadeDocumental\.update\(\{ where: \{ id \}, data: \{ status:/.test(apiRoute), "API route NÃO escreve status direto")
ok(/dispensarNecessidade\(|atenderNecessidade\(|iniciarAtendimentoNecessidade\(/.test(apiRoute), "API route usa o serviço de domínio")
ok(!/necessidadeDocumental\.update\(\{ where: \{ id: n\.id \}, data: \{ status: "DISPENSADA" \}/.test(materializar), "materializar NÃO escreve status direto")
ok(/dispensarNecessidade\(|reativarNecessidade\(/.test(materializar), "materializar usa o serviço de domínio")

console.log("\n4) Resolver canônico consome o ESTADO OFICIAL da necessidade")
ok(/n\.status === "ATENDIDA"/.test(core), "projeção NECESSIDADE considera n.status === ATENDIDA (estado oficial)")
ok(/const esperadas = input\.necessidades\.filter\(\(n\) => n\.ehCertidao && n\.obrigatoria && n\.status !== "DISPENSADA"\)/.test(core), "gate de fase DOCUMENTO vazia = existência da certidão esperada (não o status ATENDIDA)")

console.log("\n5) Reconciliação (compat, idempotente, append-only)")
ok(/export async function reconciliarNecessidadesPorPassos/.test(svc), "reconciliarNecessidadesPorPassos existe (backfill compat)")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA NECESSIDADE-LIFECYCLE — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + viol.join("; ")); process.exit(1) }
