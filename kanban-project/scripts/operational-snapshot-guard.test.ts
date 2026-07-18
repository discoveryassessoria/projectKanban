/**
 * GUARDA DO SNAPSHOT DE PROJEÇÃO OPERACIONAL — Rodar: tsx scripts/operational-snapshot-guard.test.ts
 *
 * Protege o núcleo PURO `buildOperationalSnapshot` (fundação da Central única VIEW):
 * o envelope histórico é determinístico, versionado e derivado EXCLUSIVAMENTE dos
 * passos materializados do ciclo (nunca de estado vivo). Métricas por contagem de
 * passos concluídos; documentos/necessidades/bloqueios extraídos dos próprios passos.
 *
 * Não toca banco (o hook de captura e a leitura em prisma são cobertos por E2E).
 */
import {
  buildOperationalSnapshot,
  OPERATIONAL_SNAPSHOT_SCHEMA_VERSION,
  type StepForSnapshot,
} from "../src/lib/motor/historical-operational-projection"

let falhas = 0
function ok(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    console.error(`  ✗ ${msg}`)
    falhas++
  }
}

function step(over: Partial<StepForSnapshot> & { id: number; stepKey: string; ordem: number; status: string }): StepForSnapshot {
  return {
    tipo: "HUMANO",
    obrigatorio: true,
    responsavelId: null,
    prazo: null,
    bloqueadoManual: false,
    motivo: null,
    completedAt: null,
    documentoId: null,
    necessidadeId: null,
    ...over,
  }
}

const capturedAt = "2026-07-18T12:00:00.000Z"

// --------------------------------------------------------------------------
console.log("1) Métricas: contagem de passos concluídos (CONCLUIDO/EXECUTADO/DISPENSADO)")
{
  const steps: StepForSnapshot[] = [
    step({ id: 1, stepKey: "a", ordem: 1, status: "CONCLUIDO" }),
    step({ id: 2, stepKey: "b", ordem: 2, status: "EXECUTADO" }),
    step({ id: 3, stepKey: "c", ordem: 3, status: "DISPENSADO" }),
    step({ id: 4, stepKey: "d", ordem: 4, status: "EM_ANDAMENTO" }),
  ]
  const snap = buildOperationalSnapshot({ faseCode: "EMISSAO_DOCUMENTAL", faseMacroKey: "emissao_documental", ciclo: 1, capturedAt, steps })
  ok(snap.metrics.totalWeight === 4, "totalWeight = nº de passos")
  ok(snap.metrics.completedWeight === 3, "completedWeight conta 3 estados terminais")
  ok(snap.metrics.percentage === 75, "percentage = round(3/4*100) = 75")
  ok(snap.workflow.steps.length === 4, "workflow.steps preserva todos os passos")
}

// --------------------------------------------------------------------------
console.log("2) Documentos / necessidades / bloqueios extraídos dos passos")
{
  const steps: StepForSnapshot[] = [
    step({ id: 10, stepKey: "doc", ordem: 1, status: "CONCLUIDO", documentoId: 500 }),
    step({ id: 11, stepKey: "nec", ordem: 2, status: "PENDENTE", necessidadeId: 900 }),
    step({ id: 12, stepKey: "blk", ordem: 3, status: "BLOQUEADO", bloqueadoManual: true, motivo: "aguardando" }),
    step({ id: 13, stepKey: "livre", ordem: 4, status: "PENDENTE" }),
  ]
  const snap = buildOperationalSnapshot({ faseCode: null, faseMacroKey: "x", ciclo: 2, capturedAt, steps })
  ok(snap.documents.length === 1 && snap.documents[0].documentoId === 500, "documents só dos passos com documentoId")
  ok(snap.needs.length === 1 && snap.needs[0].necessidadeId === 900, "needs só dos passos com necessidadeId")
  ok(snap.blocks.length === 1 && snap.blocks[0].stepKey === "blk", "blocks capta BLOQUEADO/bloqueadoManual")
  ok(snap.blocks[0].motivo === "aguardando", "block preserva o motivo")
}

// --------------------------------------------------------------------------
console.log("3) Envelope versionado + seções ricas ainda não capturadas = null")
{
  const snap = buildOperationalSnapshot({ faseCode: "GENEALOGIA", faseMacroKey: "genealogia", ciclo: 3, capturedAt, steps: [] })
  ok(snap.schemaVersion === OPERATIONAL_SNAPSHOT_SCHEMA_VERSION, "schemaVersion = versão corrente")
  ok(snap.faseMacroKey === "genealogia" && snap.ciclo === 3, "identidade fase/ciclo preservada")
  ok(snap.capturedAt === capturedAt, "capturedAt vem de fora (determinístico)")
  ok(snap.metrics.percentage === 0 && snap.metrics.totalWeight === 0, "sem passos → 0% e total 0 (sem divisão por zero)")
  ok(snap.cards === null && snap.queue === null && snap.panels === null && snap.decisions === null, "seções ricas = null até serem migradas por fase")
}

// --------------------------------------------------------------------------
console.log("4) Determinismo: mesma entrada → envelope idêntico (imutabilidade lógica)")
{
  const steps: StepForSnapshot[] = [step({ id: 1, stepKey: "a", ordem: 1, status: "CONCLUIDO", documentoId: 7 })]
  const a = buildOperationalSnapshot({ faseCode: "EMISSAO_DOCUMENTAL", faseMacroKey: "emissao_documental", ciclo: 1, capturedAt, steps })
  const b = buildOperationalSnapshot({ faseCode: "EMISSAO_DOCUMENTAL", faseMacroKey: "emissao_documental", ciclo: 1, capturedAt, steps })
  ok(JSON.stringify(a) === JSON.stringify(b), "duas serializações da mesma entrada são idênticas")
}

// --------------------------------------------------------------------------
if (falhas > 0) {
  console.error(`\n❌ ${falhas} verificação(ões) falharam.`)
  process.exit(1)
}
console.log("\n✅ Guard do snapshot operacional: todas as invariantes OK.")
