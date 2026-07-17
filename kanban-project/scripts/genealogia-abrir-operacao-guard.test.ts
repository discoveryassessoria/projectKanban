/**
 * GUARDA — Abertura da operação da Genealogia via a MESMA Central lateral da
 * Emissão Documental (DocumentoOperationalDrawer → aba Workflow → passo
 * localizar_registro → editor registral). Rodar:
 *   tsx scripts/genealogia-abrir-operacao-guard.test.ts
 *
 * REGRESSÃO CORRIGIDA (3 causas concretas do travamento em "Abrindo operação…"):
 *  1. handler abrirOperacao não enviava Authorization: Bearer authToken → 401 p/ logado.
 *  2. DocumentoOperationalDrawer renderiza backdrop sempre e o carregar() saía em
 *     silêncio sem documentoId → backdrop preso com painel vazio.
 *  3. passo DISPONIVEL mapeado como "nao_iniciada" → aparecia travado/sem botão na
 *     aba Workflow (não dava para abrir a etapa).
 *
 * Reutiliza os componentes existentes (EditorRegistralModal, WorkflowTab,
 * CentralDaEtapaDrawer, DocumentoOperationalDrawer). Teste ESTÁTICO + 1 funcional.
 */
import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { stepInstanceStatusToLegacy } from "../src/lib/process-stage/legacy-status-map"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
let passed = 0, failed = 0
const viol: string[] = []
function ok(c: boolean, n: string) { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; viol.push(n); console.log(`  ❌ ${n}`) } }
const ler = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")

const endpoint = ler("src/app/api/processos/[processoId]/genealogia/operacao/route.ts")
const route = ler("src/app/api/processos/[processoId]/central-operacional/route.ts")
const central = ler("src/components/kanban/ProcessoCentralOperacional.tsx")
const painel = ler("src/components/kanban/PainelDaFase.tsx")
const drawer = ler("src/components/kanban/DocumentoOperationalDrawer.tsx")

console.log("\n1) Endpoint garante o registro operacional da necessidade (idempotente)")
ok(existsSync(join(ROOT, "src/app/api/processos/[processoId]/genealogia/operacao/route.ts")), "endpoint genealogia/operacao existe")
ok(/documento\.findFirst\(\{ where: \{ necessidadeId: nec\.id \}/.test(endpoint), "reusa Documento existente da necessidade (idempotência)")
ok(/documento\.create/.test(endpoint) && /origem: "automatica"/.test(endpoint), "cria Documento (origem 'automatica', válida no CHECK) quando não há")
ok(/phaseWorkflowStepInstance\.updateMany\(\{[\s\S]*?stepKey: "localizar_registro"[\s\S]*?documentoId: null[\s\S]*?data: \{ documentoId: d\.id \}/.test(endpoint), "liga o passo localizar_registro (só se documentoId null) ao Documento")

console.log("\n2) Central expõe necessidadeId e o front autentica a abertura")
ok(/necessidadeId: n\.id/.test(route) && /necessidadeId\?: number \| null/.test(route), "queue V2 inclui/tipa necessidadeId")
ok(/genealogia\/operacao`, \{[\s\S]*?Authorization: `Bearer \$\{localStorage\.getItem\("authToken"\)\}`/.test(central), "abrirOperacao envia Authorization: Bearer authToken (igual ao resto da app)")
ok(/setAbrindoOperacao\(false\)/.test(central) && /finally \{/.test(central), "loading SEMPRE termina (finally)")
ok(/erroOperacao/.test(central) && /Não foi possível abrir a operação/.test(central), "erro visível e fechável (sem backdrop órfão)")

console.log("\n3) DocumentoOperationalDrawer nunca prende backdrop vazio")
ok(/if \(!documentoId\) \{[\s\S]*?setErro\("Operação sem documento associado\."\)/.test(drawer), "carregar sinaliza erro (não sai em silêncio) sem documentoId")
ok(/\{!doc && !loading && \(erro \|\| !documentoId\) && \(/.test(drawer), "estado terminal fechável cobre '!doc && !loading'")

console.log("\n4) Central lateral reutilizada; abas respeitam a fase Genealogia")
ok(/faseCode[\s\S]*?=== "GENEALOGIA"/.test(drawer), "drawer decide abas pela fase (workflow.faseCode), sem lista fixa")
ok(/OCULTAS_GENEALOGIA = new Set<TabId>\(\["divergences", "attach", "attempts", "audit"\]\)/.test(drawer), "Genealogia oculta Divergências/Anexos/Tentativas/Auditoria")
ok(/id: "workflow"/.test(drawer) && /id: "registry"/.test(drawer) && /id: "returns"/.test(drawer), "preserva Workflow, Dados Registrais e Devoluções")

console.log("\n5) Passo localizar_registro fica CLICÁVEL na aba Workflow (DISPONIVEL = ativo)")
ok(stepInstanceStatusToLegacy("DISPONIVEL" as never) === "em_andamento", "DISPONIVEL → em_andamento (acionável, não 'nao_iniciada')")
ok(stepInstanceStatusToLegacy("CONCLUIDO" as never) === "concluida", "CONCLUIDO → concluida (inalterado)")
ok(stepInstanceStatusToLegacy("PENDENTE" as never) === "bloqueada", "PENDENTE → bloqueada (inalterado)")

console.log("\n6) Painel repassa necessidadeId no clique 'Abrir operação'")
ok(/onAbrirOperacao\(d\.id, d\.necessidadeId\)/.test(painel), "clique passa d.id + d.necessidadeId")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA ABRIR-OPERAÇÃO — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + viol.join("; ")); process.exit(1) }
