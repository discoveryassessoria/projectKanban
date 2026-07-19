// scripts/central-unificada-guard.test.ts
//
// BLINDAGEM ESTÁTICA — trava a arquitetura definitiva desta sessão para NUNCA regredir:
//  (A) Central UNIFICADA: uma única tela (ativa|passada), dados VIVOS por fase, sem snapshot.
//  (B) Painel histórico separado ELIMINADO (HistoricalPhasePanel/resolveHistoricalPhaseProjection).
//  (C) Auto-avanço por evento ligado nas mutações do gate.
//  (D) Invariante de progresso↔avanço (blindagem de runtime) presente.
//
// Falha ⇒ quebra o build/CI. Se um item mudar de propósito, ATUALIZE este guard junto.

import { readFileSync, existsSync } from "fs"
import { join } from "path"

const ROOT = join(__dirname, "..")
const p = (rel: string) => join(ROOT, rel)
const read = (rel: string) => readFileSync(p(rel), "utf8")

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

console.log("\n(A) Central unificada OPERATE|PAST_READ_ONLY")
const rota = read("src/app/api/processos/[processoId]/central-operacional/route.ts")
check("rota devolve mode ACTIVE|PAST_READ_ONLY", /CentralMode\s*=\s*"ACTIVE"\s*\|\s*"PAST_READ_ONLY"/.test(rota))
check("rota expõe phaseContext (faseCode/instanceId/ciclo)", rota.includes("phaseContext") && rota.includes("workflowInstanceId"))
check("rota lê ?faseCode e escopa por faseCodeToPhaseKey", rota.includes('searchParams.get("faseCode")') && rota.includes("faseCodeToPhaseKey"))
check("rota passa faseContexto aos dois resolvers", rota.includes("resolveProgressoFaseDocumento(id, faseContexto)") && rota.includes("resolveOperationalProjection(id, faseContexto)"))

const projLib = read("src/lib/process-stage/operational-projection.ts")
check("resolveOperationalProjection aceita contexto de fase", /resolveOperationalProjection\(\s*[^)]*contexto\?/.test(projLib) && projLib.includes("FaseProjecaoContexto"))
check("existe resolver dedicado por-fase (instância específica)", projLib.includes("resolveOperationalProjectionParaFase"))
const progLib = read("src/lib/process-stage/resolve-fase-progresso.ts")
check("resolveProgressoFaseDocumento aceita contexto de fase", progLib.includes("FaseContexto") && progLib.includes("contexto?.faseMacroKey"))

const central = read("src/components/kanban/ProcessoCentralOperacional.tsx")
check("Central tem viewData/bodyData/readOnly (mesma tela, só leitura)", central.includes("viewData") && central.includes("bodyData") && central.includes("readOnly"))
check("trilha segue a fase ATIVA (faseAtivaNome), corpo a consultada", central.includes("faseAtivaNome") && central.includes("currentPhase={faseAtivaNome}"))
check("painéis bespoke só no modo ACTIVE (não vazam fase ativa na consulta)", central.includes("!isView && ehAnalise") && central.includes("!isView && faseCodeGenerica"))
check("cabeçalho de consulta: Somente leitura + Retornar (fluxo oficial)", central.includes("Somente leitura") && central.includes("RetornarFaseButton"))

console.log("\n(B) Painel histórico separado ELIMINADO (sem snapshot como fonte da tela)")
check("HistoricalPhasePanel.tsx removido", !existsSync(p("src/components/kanban/HistoricalPhasePanel.tsx")))
check("resolve-historical-phase-projection.ts removido", !existsSync(p("src/lib/motor/resolve-historical-phase-projection.ts")))
check("rota /phases/[id]/projection removida", !existsSync(p("src/app/api/processos/[processoId]/phases/[phaseInstanceId]/projection/route.ts")))
check("nada referencia HistoricalPhasePanel", !central.includes("HistoricalPhasePanel"))

console.log("\n(C) Auto-avanço por evento (card vai sozinho ao finalizar)")
check("gancho único tentarAvancoAutomatico existe", existsSync(p("src/lib/motor/auto-avanco.ts")) && read("src/lib/motor/auto-avanco.ts").includes("tentarAvancoAutomatico"))
check("ligado em concluir tarefa", read("src/app/api/tarefas/[tarefaId]/concluir/route.ts").includes("tentarAvancoAutomatico"))
check("ligado em necessidade PATCH", read("src/app/api/processos/[processoId]/necessidades/[necessidadeId]/route.ts").includes("tentarAvancoAutomatico"))
check("ligado em processo PUT (requerente/árvore)", read("src/app/api/processos/[processoId]/route.ts").includes("tentarAvancoAutomatico"))

console.log("\n(D) Invariante progresso↔avanço (blindagem de runtime)")
const core = read("src/lib/motor/operational-projection-core.ts")
check("blocked ⇒ percentual < 100 (trava de runtime)", core.includes("blocked") && /prog\.percentage\s*=\s*99/.test(core))

console.log("\n(E) Auto-avanço UNIVERSAL — alinhamento bespoke↔gate + roteamento condicional")
const alinhar = existsSync(p("src/services/alinhar-workflow-fase.ts")) ? read("src/services/alinhar-workflow-fase.ts") : ""
check("helper conclui Workflow Interno da fase (via serviço canônico)", alinhar.includes("concluirWorkflowInternoDaFase") && alinhar.includes("concluirPasso"))
const auto = read("src/lib/motor/auto-avanco.ts")
check("concluirFaseBespokeEAvancar (conclui gate + avança)", auto.includes("concluirFaseBespokeEAvancar") && auto.includes("concluirWorkflowInternoDaFase"))
const bespoke: Array<[string, string]> = [
  ["Análise", "src/app/api/processos/[processoId]/analise/concluir/route.ts"],
  ["Tradução", "src/app/api/processos/[processoId]/traducao/etapas/[stepId]/route.ts"],
  ["Apostilamento", "src/app/api/processos/[processoId]/apostilamento/etapas/[stepId]/route.ts"],
  ["Retificação", "src/app/api/processos/[processoId]/retificacao/pacotes/[pkgId]/etapas/[stepId]/route.ts"],
  ["Emissão Retificada", "src/app/api/processos/[processoId]/emissao-retificada/documentos/[docId]/etapas/[stepId]/route.ts"],
  ["Fase Final", "src/app/api/processos/[processoId]/fase-final/etapas/[stepId]/route.ts"],
]
for (const [nome, rel] of bespoke) check(`auto-avanço ligado em ${nome}`, read(rel).includes("concluirFaseBespokeEAvancar"))
const adv = read("src/lib/motor/phase-advance.ts")
check("advance usa roteamento condicional (proximaFaseComCondicional + flag conditional)", adv.includes("proximaFaseComCondicional") && adv.includes("f.conditional") && adv.includes("requerRetificacao"))
check("advance NÃO usa mais proximaFasePorOrdem (por-ordem cego)", !adv.includes("proximaFasePorOrdem("))
const helpers = read("src/lib/motor/phase-advance-helpers.ts")
check("proximaFaseAplicavel (pula condicionais não aplicáveis)", helpers.includes("export function proximaFaseAplicavel"))

console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
if (falhas.length) { for (const f of falhas) console.log("  - " + f); process.exit(1) }
