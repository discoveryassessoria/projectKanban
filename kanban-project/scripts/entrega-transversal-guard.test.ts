// scripts/entrega-transversal-guard.test.ts
// BLINDAGEM da entrega: Tarefa Transversal, regressão de reabertura, pendência financeira
// reprocessável, claim atômico da outbox, métricas por pessoaId. Falha ⇒ quebra o build.
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { buildOperationalProjection, type ProjectionInput } from "../src/lib/motor/operational-projection-core"

const ROOT = join(__dirname, "..")
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8")
let ok = 0
const falhas: string[] = []
const check = (n: string, c: boolean) => { if (c) { ok++; console.log(`  ✅ ${n}`) } else { falhas.push(n); console.log(`  ❌ ${n}`) } }

console.log("(P1) Tarefa Transversal")
check("serviço existe (criar/concluir/cancelar/reconciliar)", existsSync(join(ROOT, "src/services/tarefa-transversal.ts")) && (() => { const s = read("src/services/tarefa-transversal.ts"); return s.includes("criarTarefaTransversal") && s.includes("concluirTarefaTransversal") && s.includes("cancelarTarefaTransversal") && s.includes("reconciliarTransversaisNaFase") })())
check("NÃO materializa fase futura / usa motores oficiais", (() => { const s = read("src/services/tarefa-transversal.ts"); return s.includes("atenderNecessidade") && s.includes("tentarAvancoAutomatico") && !s.includes("instanciarWorkflowDaFase") })())
check("ação restrita ao CATÁLOGO (sem texto livre)", read("src/services/tarefa-transversal.ts").includes("não existe no catálogo"))
check("rotas: criar/listar + concluir/cancelar + ações", existsSync(join(ROOT, "src/app/api/processos/[processoId]/tarefas-transversais/route.ts")) && existsSync(join(ROOT, "src/app/api/tarefas-transversais/[id]/route.ts")) && existsSync(join(ROOT, "src/app/api/tarefas-transversais/acoes/route.ts")))
check("reconciliação ligada no phase.entered (idempotente)", read("src/services/outbox-dispatcher.ts").includes("reconciliarTransversaisNaFase"))
check("UI: modal + ação discreta na Central", existsSync(join(ROOT, "src/components/kanban/TarefaTransversalModal.tsx")) && read("src/components/kanban/PainelDaFase.tsx").includes("onCriarTransversal"))

console.log("\n(P3) Reabertura de step regride necessidade (transacional)")
const docop = read("src/services/documento-operacao.ts")
check("reabrirAtendimentoNecessidade no ramo vaiReabrir", docop.includes("reabrirAtendimentoNecessidade") && docop.includes("if (vaiReabrir) await reabrirAtendimentoNecessidade"))
check("reabertura em transação", /await prisma\.\$transaction\(async \(tx\) =>/.test(docop) && docop.includes("await tx.phaseWorkflowStepInstance.update({ where: { id: p.id }"))
check("serviço reabrirAtendimentoNecessidade (ATENDIDA/NAO_LOCALIZADA → EM_ATENDIMENTO)", read("src/services/necessidade-documental.ts").includes("export async function reabrirAtendimentoNecessidade"))

console.log("\n(P4) Automação financeira sem preço → pendência reprocessável")
const exec = read("src/lib/motor/executor.ts")
check("registrarPendencia nos skips (SEM_PRECO/SEM_PRECO_VALIDO/SEM_CAMBIO)", exec.includes("registrarPendencia(") && exec.includes("SEM_PRECO") && !/{ name: titulo, reason: 'Configuração Financeira sem preço cadastrado' }\); continue/.test(exec))
check("resolve pendência ao lançar + função de reprocesso", exec.includes("resolverPendencia(") && exec.includes("export async function reprocessarPendenciasFinanceiras"))
check("reprocesso disparado ao cadastrar preço", read("src/app/api/gerenciamento/tabela-valores/route.ts").includes("reprocessarPendenciasFinanceiras"))
check("nunca lançamento zero (valor<=0 já barrado; sem fallback 1:1)", exec.includes("fxParaBRL") && !exec.includes("fx ?? 1"))

console.log("\n(P7) Outbox — claim atômico + phase.completed")
const ob = read("src/services/outbox-dispatcher.ts")
check("claim atômico (updateMany reservadoEm) + reclaim de reserva presa", ob.includes("updateMany({") && ob.includes("reservadoEm: null") && ob.includes("CLAIM_STALE_MS"))
check("libera reserva na falha (reservadoEm: null)", ob.includes("reservadoEm: null, tentativas:"))
check("phase.completed arquivado (não acumula)", ob.includes("TIPOS_SEM_EFEITO") && ob.includes("phase.completed"))

console.log("\n(P6) Métricas por pessoaId (homônimos não colapsam)")
check("QueueRow com pessoaId + agrupamento por pessoaId", read("src/app/api/processos/[processoId]/central-operacional/route.ts").includes("pessoaId: number // P6") && read("src/components/kanban/ProcessoCentralOperacional.tsx").includes("q.pessoaId != null && q.pessoaId > 0 ? q.pessoaId : q.pessoaNome"))

console.log("\n(RUNTIME) Reabertura: necessidade EM_ATENDIMENTO NÃO conta como concluída (gate volta a bloquear)")
{
  const base = (over: Partial<ProjectionInput>): ProjectionInput => ({
    processId: 1, faseCode: "GENEALOGIA", faseMacroKey: "genealogia", phaseName: "Genealogia", scope: "NECESSIDADE",
    processoExists: true, hasActiveInstance: true, steps: [], necessidades: [], documentos: [], hasArvore: true, requerentesCount: 1, ...over,
  })
  const step = (necId: number, status: string) => ({ id: necId, stepKey: "localizar_registro", ordem: 1, status, obrigatorio: true, tipo: "HUMANO", geraTarefa: false, documentoId: null, necessidadeId: necId, bloqueadoManual: false, motivo: null, snapshot: null, dependeDeStepKeys: null, tarefas: [] })
  // antes: passo CONCLUIDO + necessidade ATENDIDA → 100%/avança
  const antes = buildOperationalProjection(base({ necessidades: [{ id: 5, status: "ATENDIDA", obrigatoria: true, ehCertidao: true }], steps: [step(5, "CONCLUIDO")] }))
  // depois da reabertura: passo DISPONIVEL + necessidade EM_ATENDIMENTO → <100%/bloqueado
  const depois = buildOperationalProjection(base({ necessidades: [{ id: 5, status: "EM_ATENDIMENTO", obrigatoria: true, ehCertidao: true }], steps: [step(5, "DISPONIVEL")] }))
  check("antes: 100% e pode avançar", antes.progress.percentage === 100 && antes.status.canAdvance)
  check("depois (reaberto): <100% e bloqueado", depois.progress.percentage < 100 && depois.status.blocked && !depois.status.canAdvance)
}

console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
if (falhas.length) { for (const f of falhas) console.log("  - " + f); process.exit(1) }
