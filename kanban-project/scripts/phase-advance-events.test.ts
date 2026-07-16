/**
 * Eventos canônicos de fase + chaves idempotentes — núcleo PURO (sem DB).
 * Rodar: tsx scripts/phase-advance-events.test.ts
 */
import {
  montarChaveAdvance,
  montarEventoEntered,
  montarEventoCompleted,
  proximaFasePorOrdem,
  faseAlvoEhAnterior,
  type EventoFasePayloadInput,
} from "../src/lib/motor/phase-advance-helpers"

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

const OCC = "2026-07-15T12:00:00.000Z"
const base = (over: Partial<EventoFasePayloadInput> = {}): EventoFasePayloadInput => ({
  processoId: 42,
  faseAnteriorKey: "genealogia",
  faseAnteriorInstanceId: 100,
  faseNovaKey: "analise",
  faseNovaInstanceId: 200,
  ciclo: 1,
  operacao: "AVANCAR",
  origem: "advance",
  solicitadoPorId: 7,
  macroVersion: 3,
  chaveTransicao: "adv|proc42|opAVANCAR|degenealogia|paraanalise|lv5|c1",
  correlationId: "corr-abc",
  occurredAt: OCC,
  ...over,
})

console.log("\nphase.entered — payload e idempotência")
{
  const e = montarEventoEntered(base())
  ok(e.tipo === "phase.entered", "tipo é phase.entered")
  const p = e.payload
  ok(p.processId === 42, "processId presente")
  ok(p.previousPhaseId === "genealogia", "previousPhaseId = fase de origem")
  ok(p.previousPhaseInstanceId === 100, "previousPhaseInstanceId presente")
  ok(p.newPhaseId === "analise" && p.newPhaseKey === "analise", "newPhaseId/newPhaseKey = destino")
  ok(p.newPhaseInstanceId === 200, "newPhaseInstanceId presente")
  ok(p.occurredAt === OCC, "occurredAt injetado (determinístico)")
  ok(p.source === "advance", "source presente")
  ok(p.idempotencyKey === base().chaveTransicao, "idempotencyKey = chave da transição")
  ok(typeof p.eventId === "string" && (p.eventId as string).includes("entered"), "eventId presente")
  ok(p.workflowMacroVersionId === 3, "workflowMacroVersionId presente")
  // campos mínimos exigidos pelo contrato
  for (const campo of ["eventId","idempotencyKey","processId","previousPhaseId","previousPhaseInstanceId","newPhaseId","newPhaseInstanceId","newPhaseKey","occurredAt","source"]) {
    ok(campo in p, `payload contém "${campo}"`)
  }
}

console.log("\nEstabilidade da chave idempotente (mesmo estado → mesma chave)")
{
  const a = montarEventoEntered(base()).chaveIdempotencia
  const b = montarEventoEntered(base()).chaveIdempotencia
  ok(a === b, "mesma transição → mesma chaveIdempotencia (dedup no @unique)")
  const c = montarEventoEntered(base({ chaveTransicao: "adv|proc42|opAVANCAR|deanalise|paratraducao|lv6|c1" })).chaveIdempotencia
  ok(a !== c, "transição diferente → chave diferente")
  const completed = montarEventoCompleted(base()).chaveIdempotencia
  ok(completed !== a, "phase.completed e phase.entered têm chaves distintas")
}

console.log("\nphase.completed — só descreve a fase concluída")
{
  const e = montarEventoCompleted(base())
  ok(e.tipo === "phase.completed", "tipo é phase.completed")
  ok(e.payload.phaseId === "genealogia" && e.payload.phaseInstanceId === 100, "phaseId/phaseInstanceId = fase de origem")
}

console.log("\nmontarChaveAdvance — determinístico por estado (lockVersion)")
{
  const k1 = montarChaveAdvance({ processoId: 1, operacao: "AVANCAR", faseAtual: "a", fasePretendida: "b", lockVersion: 0, cicloAlvo: 1 })
  const k2 = montarChaveAdvance({ processoId: 1, operacao: "AVANCAR", faseAtual: "a", fasePretendida: "b", lockVersion: 0, cicloAlvo: 1 })
  const k3 = montarChaveAdvance({ processoId: 1, operacao: "AVANCAR", faseAtual: "a", fasePretendida: "b", lockVersion: 1, cicloAlvo: 1 })
  ok(k1 === k2, "mesmo estado → mesma chave (clique duplo converge)")
  ok(k1 !== k3, "lockVersion diferente → chave diferente (avanço seguinte)")
}

console.log("\nproximaFasePorOrdem / faseAlvoEhAnterior — ordem do Workflow Macro")
{
  const fases = [
    { phaseKey: "genealogia", ordem: 1 },
    { phaseKey: "analise", ordem: 2 },
    { phaseKey: "traducao", ordem: 3 },
  ]
  ok(proximaFasePorOrdem(fases, "genealogia") === "analise", "próxima de genealogia = analise")
  ok(proximaFasePorOrdem(fases, "traducao") === null, "última fase → sem próxima")
  ok(faseAlvoEhAnterior(fases, "traducao", "genealogia") === true, "genealogia é anterior a traducao")
  ok(faseAlvoEhAnterior(fases, "genealogia", "traducao") === false, "traducao não é anterior a genealogia")
}

console.log(`\n${failed === 0 ? "✅" : "❌"} EVENTOS CANÔNICOS — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("\nFalhas:"); for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
