// scripts/emissao-gate.test.ts
// Regra: fase DOCUMENTO (Emissão) só avança quando TODAS as certidões OBRIGATÓRIAS estão
// resolvidas (documento com operação concluída). Docs de apoio não gateiam. gate ⟺ progresso.
import { buildOperationalProjection, type ProjectionInput, type GateStepData } from "../src/lib/motor/operational-projection-core"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) } else { falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

// passo por-documento (validar_certidao) concluído ou não
function stepDoc(id: number, documentoId: number, status: string): GateStepData {
  return { id, stepKey: "validar_certidao", ordem: 5, status, obrigatorio: true, tipo: "HUMANO", geraTarefa: false, documentoId, necessidadeId: null, bloqueadoManual: false, motivo: null, snapshot: null, dependeDeStepKeys: null, tarefas: [] }
}
function base(over: Partial<ProjectionInput>): ProjectionInput {
  return {
    processId: 1, faseCode: "EMISSAO_DOCUMENTAL", faseMacroKey: "emissao_documental", phaseName: "Emissão documental",
    scope: "DOCUMENTO", processoExists: true, hasActiveInstance: true, steps: [], necessidades: [], documentos: [],
    hasArvore: true, requerentesCount: 1, ...over,
  }
}
const cert = (id: number, over = {}) => ({ id, status: "ATENDIDA", obrigatoria: true, ehCertidao: true, ...over })
const doc = (id: number, necessidadeId: number) => ({ id, status: "PENDENTE", linhaReta: true, necessidadeId })

console.log("Gate da Emissão — certidões obrigatórias")

// 1) 2 certidões obrigatórias, NENHUMA emitida (sem doc) → bloqueado, 0%, não avança
{
  const p = buildOperationalProjection(base({ necessidades: [cert(1), cert(2)] }))
  check("0/2 emitidas → bloqueado, 0%, canAdvance false", p.status.blocked && p.progress.percentage === 0 && !p.status.canAdvance)
}
// 2) 1 de 2 emitida (doc 101 concluído p/ nec 1) → bloqueado, 50%, <100
{
  const p = buildOperationalProjection(base({
    necessidades: [cert(1), cert(2)],
    documentos: [doc(101, 1), doc(102, 2)],
    steps: [stepDoc(1, 101, "CONCLUIDO")], // só a certidão 1 concluída
  }))
  check("1/2 emitida → bloqueado, 50%, <100", p.status.blocked && p.progress.percentage === 50 && !p.status.canAdvance)
}
// 3) 2 de 2 emitidas → 100%, canAdvance true
{
  const p = buildOperationalProjection(base({
    necessidades: [cert(1), cert(2)],
    documentos: [doc(101, 1), doc(102, 2)],
    steps: [stepDoc(1, 101, "CONCLUIDO"), stepDoc(2, 102, "CONCLUIDO")],
  }))
  check("2/2 emitidas → 100%, canAdvance true", !p.status.blocked && p.progress.percentage === 100 && p.status.canAdvance)
}
// 4) certidão DISPENSADA não conta no denominador
{
  const p = buildOperationalProjection(base({
    necessidades: [cert(1), cert(2, { status: "DISPENSADA" })],
    documentos: [doc(101, 1)],
    steps: [stepDoc(1, 101, "CONCLUIDO")],
  }))
  check("dispensada fora do denominador → 100%, avança", !p.status.blocked && p.progress.percentage === 100 && p.status.canAdvance)
}
// 5) doc de APOIO (não-certidão) NÃO gateia
{
  const p = buildOperationalProjection(base({
    necessidades: [cert(1)],
    documentos: [doc(101, 1), { id: 900, status: "PENDENTE", linhaReta: true, necessidadeId: null }], // RG sem necessidade
    steps: [stepDoc(1, 101, "CONCLUIDO")],
  }))
  check("doc de apoio não gateia → 100%, avança", !p.status.blocked && p.progress.percentage === 100 && p.status.canAdvance)
}
// 6) INVARIANTE: em todos, (100% ⟺ canAdvance) e (blocked ⇒ <100)
{
  const cenarios = [
    base({ necessidades: [cert(1), cert(2)] }),
    base({ necessidades: [cert(1), cert(2)], documentos: [doc(101, 1), doc(102, 2)], steps: [stepDoc(1, 101, "CONCLUIDO")] }),
    base({ necessidades: [cert(1)], documentos: [doc(101, 1)], steps: [stepDoc(1, 101, "CONCLUIDO")] }),
  ]
  const inv = cenarios.every((c) => { const p = buildOperationalProjection(c); return ((p.progress.percentage >= 100) === p.status.canAdvance) && !(p.status.blocked && p.progress.percentage >= 100) })
  check("invariante 100%⟺canAdvance e blocked⇒<100", inv)
}

console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
if (falhas.length) process.exit(1)
