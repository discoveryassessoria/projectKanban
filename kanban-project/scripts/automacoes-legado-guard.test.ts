/**
 * GUARDA — neutralização da arquitetura antiga de Automações / Workflows Internos.
 * Rodar: tsx scripts/automacoes-legado-guard.test.ts
 *
 * ARQUITETURA NOVA: o Workflow Interno de cada Fase Macro é o ÚNICO responsável por
 * tarefas obrigatórias, ordem, dependências, responsáveis, SLA e conclusão da fase.
 * Automações apenas REAGEM a eventos, com EFEITOS ADICIONAIS (financeiro, evento,
 * protocolo, notificação). Esta guarda impede a volta do comportamento antigo:
 *   1. executor NÃO cria Tarefa a partir de automação kind=task;
 *   2. automações de fase só aceitam efeitos (sem task/document/phase_advance);
 *   3. modelos de automação idem;
 *   4. Regras/Modelos de Tarefa Transversal: criação desativada (410);
 *   5. UI: abas task/document removidas; telas transversais fora da navegação.
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

// --------------------------------------------------------------------------
// 1) executor.ts — automação kind=task NÃO cria Tarefa
// --------------------------------------------------------------------------
console.log("\n1) executor — automação de tarefa neutralizada")
const executor = ler("src/lib/motor/executor.ts")
// o loop de taskRules não pode mais criar Tarefa (sem criarTarefaDeSpec no bloco).
const blocoTask = (executor.match(/\/\/ TAREFAS[\s\S]*?for \(const rule of taskRules\)[\s\S]*?\n  \}/) || [""])[0]
ok(/NEUTRALIZ/i.test(blocoTask), "bloco de tarefas marcado como neutralizado")
ok(!/criarTarefaDeSpec\(/.test(blocoTask), "bloco de tarefas NÃO chama criarTarefaDeSpec")
ok(!/fazer\([^)]*'Tarefa'/.test(executor) && !/targetTable:\s*'Tarefa'/.test(executor.replace(/skipped[\s\S]*?\n/g, "")), "executor não cria artefato Tarefa por automação")

// --------------------------------------------------------------------------
// 2) automacoes-fase — só efeitos adicionais (sem task/document/phase_advance)
// --------------------------------------------------------------------------
console.log("\n2) API automacoes-fase — só efeitos adicionais")
const apiAuto = ler("src/app/api/gerenciamento/automacoes-fase/route.ts")
const permit = (apiAuto.match(/KINDS_EFEITO_PERMITIDOS = new Set\(\[([^\]]*)\]\)/) || ["", ""])[1]
ok(/'financial'/.test(permit) && /'event'/.test(permit) && /'protocol'/.test(permit) && /'alert'/.test(permit), "permitidos incluem financial/event/protocol/alert")
ok(!/'task'/.test(permit) && !/'document'/.test(permit), "permitidos NÃO incluem task/document")
ok(/kindDeTrabalhoObrigatorio/.test(apiAuto), "há guard kindDeTrabalhoObrigatorio (task/document)")
const apiAutoId = ler("src/app/api/gerenciamento/automacoes-fase/[id]/route.ts")
ok(/k === 'task' \|\| k === 'document'/.test(apiAutoId), "PUT bloqueia mudar/reativar kind task/document")

// --------------------------------------------------------------------------
// 3) modelos-automacao — só efeitos adicionais
// --------------------------------------------------------------------------
console.log("\n3) API modelos-automacao — só efeitos adicionais")
const apiModelos = ler("src/app/api/gerenciamento/modelos-automacao/route.ts")
const permitM = (apiModelos.match(/TIPOS_EFEITO_PERMITIDOS = new Set\(\[([^\]]*)\]\)/) || ["", ""])[1]
ok(!/'task'/.test(permitM) && !/'document'/.test(permitM), "modelos: task/document NÃO são criáveis")
ok(/TIPOS_TRABALHO_OBRIGATORIO/.test(apiModelos), "modelos: há conjunto TIPOS_TRABALHO_OBRIGATORIO bloqueado")

// --------------------------------------------------------------------------
// 4) Tarefa Transversal — criação DESATIVADA (410); dados preservados (GET)
// --------------------------------------------------------------------------
console.log("\n4) Tarefa Transversal — criação desativada")
for (const rel of [
  "src/app/api/gerenciamento/regras-tarefa-transversal/route.ts",
  "src/app/api/gerenciamento/modelos-tarefa-transversal/route.ts",
]) {
  const src = ler(rel)
  ok(/status:\s*410/.test(src), `${rel.split("/").slice(-2).join("/")} — POST responde 410`)
  ok(/export async function GET/.test(src), `${rel.split("/").slice(-2).join("/")} — GET preservado (histórico)`)
  ok(!/prisma\.\w+\.create\(/.test(src), `${rel.split("/").slice(-2).join("/")} — POST não cria registro`)
}
ok(/TRANSVERSAL_DESATIVADO/.test(ler("src/app/api/gerenciamento/regras-tarefa-transversal/[id]/route.ts")), "regra transversal [id] bloqueia reativação")
ok(/TRANSVERSAL_DESATIVADO/.test(ler("src/app/api/gerenciamento/modelos-tarefa-transversal/[id]/route.ts")), "modelo transversal [id] bloqueia reativação")

// --------------------------------------------------------------------------
// 5) UI — abas task/document removidas; telas transversais fora da navegação
// --------------------------------------------------------------------------
console.log("\n5) UI — sem opções que substituem o Workflow Interno")
const tabUI = ler("src/components/gerenciamentoComponents/PhaseAutomationsFasesTab.tsx")
const kindTabs = (tabUI.match(/KIND_TABS:[^\n]*\n?\s*\[[\s\S]*?\]\n\]/) || tabUI.match(/KIND_TABS[\s\S]*?\]\n/) || [""])[0]
ok(!/\["task"/.test(kindTabs) && !/\["document"/.test(kindTabs), "UI: abas 'Tarefas' e 'Documentos' removidas")
ok(/\["financial"/.test(kindTabs) && /\["event"/.test(kindTabs) && /\["protocol"/.test(kindTabs), "UI: abas de efeitos (financeiro/evento/protocolo) mantidas")
const nav = ler("src/components/gerenciamentoComponents/managementNavigation.tsx")
ok(!/"crossrules"/.test(nav), "nav: 'Regras Transversais' (crossrules) removida")
ok(!/"crosstpl"/.test(nav), "nav: 'Modelos de Regras Transversais' (crosstpl) removido")
const page = ler("src/app/administrator/page.tsx")
ok(!/crossrules:/.test(page) && !/crosstpl:/.test(page), "page: telas transversais fora do mapa de telas")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA AUTOMAÇÕES-LEGADO — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("\nViolações:"); for (const v of violacoes) console.log(`  · ${v}`); process.exit(1) }
