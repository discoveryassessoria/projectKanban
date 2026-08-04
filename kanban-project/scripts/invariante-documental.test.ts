/**
 * INVARIANTE DOCUMENTAL — Fatia 2: o estado órfão não pode voltar a ser criado.
 *
 * Rodar: npm run test:invariante-doc
 *
 * O processo 505 tem 5 StepInstances e 8 Tarefas sem documentoId. Este teste NÃO
 * os conserta — eles são ambíguos e ficam como estão. Ele prova a outra metade:
 * que materializar um passo documental sem documento passou a ser IMPOSSÍVEL, e
 * que a tarefa herda o documento do passo em vez de escolher o seu.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import {
  exigirDocumentoNoPasso,
  documentoDaTarefa,
  exigirPassoNaTarefaDeWorkflow,
  ViolacaoContratoDocumental,
} from "../src/services/invariante-documental"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8")

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}
/** Roda e devolve o motivo da violação, ou null se não violou. */
function motivo(fn: () => unknown): string | null {
  try { fn(); return null } catch (e) {
    return e instanceof ViolacaoContratoDocumental ? e.detalhe.motivo : `OUTRO_ERRO:${String(e).slice(0, 40)}`
  }
}

console.log("INVARIANTE DOCUMENTAL — o órfão não nasce mais\n")

// ════════════════════════════════════════════════════════════════
// (A) PASSO
// ════════════════════════════════════════════════════════════════
console.log("(A) StepInstance:")

ok(motivo(() => exigirDocumentoNoPasso({
    workflowExigeDocumento: true, stepKey: "solicitar_certidao", documentoId: null, processoId: 505,
  })) === "PASSO_DOCUMENTAL_SEM_DOCUMENTO",
  "1. passo de workflow documental SEM documento é recusado")

ok(motivo(() => exigirDocumentoNoPasso({
    workflowExigeDocumento: true, stepKey: "solicitar_certidao", documentoId: 2077, processoId: 505,
  })) === null,
  "2. passo documental COM documento passa")

ok(motivo(() => exigirDocumentoNoPasso({
    workflowExigeDocumento: false, stepKey: "localizar_registro", documentoId: null, processoId: 505,
  })) === null,
  "3. workflow que NÃO assinou contrato segue como antes — nada é cobrado dele")

// ════════════════════════════════════════════════════════════════
// (B) TAREFA
// ════════════════════════════════════════════════════════════════
console.log("\n(B) Tarefa:")

ok(documentoDaTarefa({
    workflowExigeDocumento: true, stepKey: "solicitar_certidao", stepInstanceId: 1351,
    documentoIdDoPasso: 2077, processoId: 505,
  }) === 2077,
  "4. a tarefa HERDA o documento do passo")

ok(documentoDaTarefa({
    workflowExigeDocumento: true, stepKey: "solicitar_certidao", stepInstanceId: 1351,
    documentoIdDoPasso: 2077, documentoIdInformado: 2077, processoId: 505,
  }) === 2077,
  "5. informar o MESMO documento do passo é aceito")

ok(motivo(() => documentoDaTarefa({
    workflowExigeDocumento: true, stepKey: "solicitar_certidao", stepInstanceId: 1351,
    documentoIdDoPasso: 2077, documentoIdInformado: 9999, processoId: 505,
  })) === "TAREFA_E_PASSO_DIVERGEM",
  "6. tarefa apontando para documento DIFERENTE do passo é recusada")

ok(motivo(() => documentoDaTarefa({
    workflowExigeDocumento: true, stepKey: "solicitar_certidao", stepInstanceId: 1351,
    documentoIdDoPasso: null, processoId: 505,
  })) === "TAREFA_DOCUMENTAL_SEM_DOCUMENTO",
  "7. tarefa documental sem documento (nem no passo) é recusada")

ok(documentoDaTarefa({
    workflowExigeDocumento: false, stepKey: "conferir_arvore", stepInstanceId: 1,
    documentoIdDoPasso: null, processoId: 505,
  }) === null,
  "8. tarefa de workflow não documental continua podendo não ter documento")

ok(motivo(() => exigirPassoNaTarefaDeWorkflow({
    origemEhWorkflow: true, workflowStepInstanceId: null, processoId: 505,
  })) === "TAREFA_DE_WORKFLOW_SEM_PASSO",
  "9. tarefa de origem workflow SEM passo é recusada (as 7 soltas do 505)")

ok(motivo(() => exigirPassoNaTarefaDeWorkflow({
    origemEhWorkflow: false, workflowStepInstanceId: null, processoId: 505,
  })) === null,
  "10. tarefa avulsa (origem manual) continua permitida sem passo")

// ════════════════════════════════════════════════════════════════
// (C) LIGADA NO MOTOR
// ════════════════════════════════════════════════════════════════
console.log("\n(C) Ligada no motor:")

const motor = ler("src/services/phase-workflow.ts")
const helpers = ler("src/services/phase-workflow-helpers.ts")

ok(motor.includes("exigirDocumentoNoPasso("),
  "11. o motor CHAMA a invariante antes de criar o passo")
ok(motor.indexOf("exigirDocumentoNoPasso(") < motor.indexOf("tx.phaseWorkflowStepInstance.create"),
  "12. a invariante roda ANTES do create — não sobra passo órfão gravado")
ok((motor.match(/exigeDocumento: workflow\.exigeDocumento === true/g) || []).length === 2,
  "13. os DOIS caminhos de materialização (nova e convergência) passam o contrato")
ok(helpers.includes("exigeDocumento?: boolean"),
  "14. o contrato chega ao motor pelo tipo do workflow, não por consulta paralela")

// a auditoria não escreve
const auditoria = ler("scripts/auditar-vinculo-documental.ts")
ok(!/\.(update|create|delete|upsert|updateMany|createMany|deleteMany)\(/.test(auditoria),
  "15. o script de auditoria não tem NENHUMA escrita")
ok(auditoria.includes("AMBIGUO") && auditoria.includes("nada de onde deduzir"),
  "16. a auditoria separa reparável de ambíguo, e nomeia o motivo")

// nada de backfill que invente documento
ok(!/documento.*create|createMany.*Documento/.test(auditoria),
  "17. a auditoria não cria documento em hipótese nenhuma")

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("Invariante documental: o estado órfão não pode mais ser criado ✅")
