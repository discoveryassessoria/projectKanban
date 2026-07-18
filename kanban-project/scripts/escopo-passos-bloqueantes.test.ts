/**
 * TESTE — resolver canônico de passos bloqueantes por ESCOPO OPERACIONAL.
 * Rodar: tsx scripts/escopo-passos-bloqueantes.test.ts
 *
 * Cobre: fase PROCESSO (só genéricos), fase NECESSIDADE, fase DOCUMENTO, instância legada
 * (genéricos + vinculados), fase documental sem documento materializado, e a garantia de
 * que genéricos legítimos de escopo PROCESSO continuam bloqueando.
 */
import { resolvePassosBloqueantesDaFase, escopoDoPasso, faseOperadaPorEntidade } from "../src/lib/motor/resolve-passos-bloqueantes"

let passed = 0, failed = 0
const viol: string[] = []
function ok(c: boolean, n: string) { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; viol.push(n); console.log(`  ❌ ${n}`) } }
const g = (id: number) => ({ id, documentoId: null, necessidadeId: null })       // genérico
const d = (id: number, doc: number) => ({ id, documentoId: doc, necessidadeId: null }) // documento
const n = (id: number, nec: number) => ({ id, documentoId: null, necessidadeId: nec }) // necessidade

console.log("\n1) Escopo de um passo")
ok(escopoDoPasso(g(1)) === "PROCESSO", "sem doc e sem nec → PROCESSO")
ok(escopoDoPasso(d(1, 10)) === "DOCUMENTO", "com doc → DOCUMENTO")
ok(escopoDoPasso(n(1, 10)) === "NECESSIDADE", "com nec → NECESSIDADE")

console.log("\n2) Fase PROCESSO (só genéricos) — genéricos SÃO o gate")
const proc = [g(1), g(2), g(3)]
ok(!faseOperadaPorEntidade(proc), "não é operada por entidade")
ok(resolvePassosBloqueantesDaFase(proc).length === 3, "todos os 3 genéricos entram no gate")

console.log("\n3) Fase DOCUMENTO — genéricos ignorados, só documentos bloqueiam")
const doc = [g(1), g(2), d(3, 100), d(4, 100), d(5, 101)]
ok(faseOperadaPorEntidade(doc), "é operada por entidade")
const rDoc = resolvePassosBloqueantesDaFase(doc)
ok(rDoc.length === 3 && rDoc.every((s) => s.documentoId != null), "só os 3 passos por-documento entram no gate; genéricos fora")

console.log("\n4) Fase NECESSIDADE — genéricos ignorados, só necessidades bloqueiam")
const nec = [g(1), n(2, 7), n(3, 8)]
const rNec = resolvePassosBloqueantesDaFase(nec)
ok(rNec.length === 2 && rNec.every((s) => s.necessidadeId != null), "só os 2 passos por-necessidade entram no gate")

console.log("\n4b) NECESSIDADE tem precedência: passo com DOC mas SEM necessidade (ex.: #1019) NÃO bloqueia")
// Genealogia real: passos com doc+nec (reais) + 1 passo com doc mas nec=null (doc duplicado)
const genReal = [{ id: 20, documentoId: 100, necessidadeId: 7 }, { id: 21, documentoId: 101, necessidadeId: 8 }, { id: 19, documentoId: 200, necessidadeId: null }]
const rGen = resolvePassosBloqueantesDaFase(genReal)
ok(rGen.length === 2 && rGen.every((s) => s.necessidadeId != null), "escopo NECESSIDADE: passo #19 (doc, sem nec) sai do gate; só os por-necessidade gatam")

console.log("\n5) Instância LEGADA (2 esteiras: genéricos + vinculados) — compat")
const legada = [g(10), g(11), g(12), g(13), g(14), d(20, 200), d(21, 200)]
const rLeg = resolvePassosBloqueantesDaFase(legada)
ok(rLeg.length === 2 && rLeg.every((s) => s.documentoId != null), "genéricos legados 10-14 saem; só os por-documento gatam")

console.log("\n6) Fase documental SEM documento materializado — só genéricos → gatam (não avança à toa)")
const semDoc = [g(1), g(2), g(3), g(4), g(5)]
ok(resolvePassosBloqueantesDaFase(semDoc).length === 5, "sem entidade materializada, genéricos gatam (fase não fica sem gate)")

console.log(`\n${failed === 0 ? "✅" : "❌"} ESCOPO PASSOS BLOQUEANTES — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + viol.join("; ")); process.exit(1) }
