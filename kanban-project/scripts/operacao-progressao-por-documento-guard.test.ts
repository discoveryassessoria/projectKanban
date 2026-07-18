/**
 * GUARDA — progressão POR-DOCUMENTO do workflow interno (sem lock-step entre irmãos).
 * Rodar: tsx scripts/operacao-progressao-por-documento-guard.test.ts
 *
 * BUG: na Emissão, concluir "Solicitar certidão" de um documento deixava "Aguardar
 * retorno" TRAVADA ("AGUARDANDO DOCS") esperando TODOS os outros documentos concluírem
 * a etapa anterior (lock-step em lote em atualizarPassoV2). Cada certidão deve fluir
 * independente; o gate "todos prontos" é do AVANÇO DE FASE (BlockingEngine), não do passo.
 *
 * FIX: ao concluir uma etapa, a próxima etapa DO MESMO documento libera imediatamente
 * (EM_ANDAMENTO), sem esperar irmãos. Teste ESTÁTICO.
 */
import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
let passed = 0, failed = 0
const viol: string[] = []
function ok(c: boolean, n: string) { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; viol.push(n); console.log(`  ❌ ${n}`) } }
const ler = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")

const svc = ler("src/services/documento-operacao.ts")

console.log("\n1) Conclusão libera a PRÓXIMA etapa do MESMO documento (sem esperar irmãos)")
ok(/if \(liberarProximo\)[\s\S]*?documentoId, faseMacroKey: p\.faseMacroKey, ordem: \{ gt: p\.ordem \}/.test(svc), "acha a próxima etapa do próprio documento")
ok(/proximo\.id[\s\S]*?status: "EM_ANDAMENTO", startedAt: now, prazo: due, motivo: null/.test(svc), "próxima etapa do doc vira EM_ANDAMENTO ao concluir")

console.log("\n2) Lock-step em lote removido (não trava esperando outros documentos)")
ok(!/Aguardando outros documentos do processo/.test(svc), "sem motivo de lock-step 'Aguardando outros documentos'")
ok(!/todosConcluiram/.test(svc), "sem gate 'todosConcluiram' entre irmãos no passo")

console.log("\n3) Reabertura ainda re-bloqueia as etapas seguintes do próprio doc (inalterado)")
ok(/if \(vaiReabrir\)[\s\S]*?documentoId, faseMacroKey: p\.faseMacroKey, ordem: \{ gt: p\.ordem \}[\s\S]*?status: "BLOQUEADO"/.test(svc), "reabrir volta as seguintes do doc para BLOQUEADO")

console.log(`\n${failed === 0 ? "✅" : "❌"} GUARDA PROGRESSÃO-POR-DOC — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + viol.join("; ")); process.exit(1) }
