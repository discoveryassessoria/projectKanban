// scripts/gate-avanco-cancelado-e-fora-da-linha.test.ts
// ============================================================================
// ACHADO REAL 30/09/2026 — processo 675 Antão parado em Emissão documental com TODAS as certidões concluídas na tela
// ("11 de 11 validados", 82%). Duas causas no gate de avanço (computeGate):
//   1) `PASSO_OK` não tinha CANCELADO: o passo da certidão cancelada ("Certidão de casamento · Edison Nás Antão Junior")
//      bloqueava como PASSO_OBRIGATORIO_ABERTO "(CANCELADO)" para sempre. Passo cancelado = decisão humana de que a
//      obrigação não vale: não bloqueia (mas também NÃO conta como conclusão).
//   2) `passosPorObrigacao` ligava passo→necessidade só pelos documentos da LINHA RETA. A certidão de nascimento de um
//      cônjuge fora da linha (Evanir Teixeira da Silva, Priscila Oliveira Araujo) tinha o passo CONCLUÍDO, mas não ligava
//      à necessidade → "certidão obrigatória pendente" para sempre. Agora usa TODOS os documentos (`documentosTodos`),
//      o mesmo conjunto que `computeGate` já usava para achar a necessidade de um passo.
// ============================================================================
import { computeGate, buildOperationalProjection, type GateStepData, type ProjectionInput } from "../src/lib/motor/operational-projection-core"
import { classificarPasso } from "../src/lib/motor/blocking-helpers"
import { readFileSync } from "node:fs"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }

let seq = 1
const passo = (p: { status: string; documentoId: number; necessidadeId?: number | null; obrigatorio?: boolean }): GateStepData => ({
  id: seq++, stepKey: "solicitar_certidao", ordem: 1, status: p.status, obrigatorio: p.obrigatorio ?? true, tipo: "HUMANO", geraTarefa: true,
  documentoId: p.documentoId, necessidadeId: p.necessidadeId ?? null, bloqueadoManual: false, motivo: null, snapshot: null, dependeDeStepKeys: null, tarefas: [],
} as GateStepData)

function entrada(o: { steps: GateStepData[]; necessidades: Array<{ id: number; status: string }>; documentosLinhaReta: Array<{ id: number; necessidadeId: number | null }>; documentosTodos?: Array<{ id: number; necessidadeId: number | null }> }): ProjectionInput {
  return {
    processId: 675, faseCode: "EMISSAO_DOCUMENTAL", faseMacroKey: "emissao_documental", phaseName: null, scope: "DOCUMENTO",
    processoExists: true, hasActiveInstance: true, steps: o.steps,
    necessidades: o.necessidades.map((n) => ({ id: n.id, status: n.status, obrigatoria: true, ehCertidao: true })) as ProjectionInput["necessidades"],
    documentos: o.documentosLinhaReta as ProjectionInput["documentos"],
    ...(o.documentosTodos ? { documentosTodos: o.documentosTodos as ProjectionInput["documentos"] } : {}),
    hasArvore: true, requerentesCount: 1,
  } as ProjectionInput
}
const codigos = (i: ProjectionInput) => computeGate(i).filter((x) => x.severity === "BLOCKING").map((x) => x.code)

console.log("(1) Passo CANCELADO não bloqueia o avanço")
ok("classificarPasso: CANCELADO obrigatório → sem issue", classificarPasso("CANCELADO", true, "solicitar_certidao", 3044) === null)
ok("classificarPasso: DISPONIVEL obrigatório continua BLOQUEANDO", classificarPasso("DISPONIVEL", true, "solicitar_certidao", 1)?.code === "PASSO_OBRIGATORIO_ABERTO")
ok("classificarPasso: EM_ANDAMENTO continua BLOQUEANDO", classificarPasso("EM_ANDAMENTO", true, "solicitar_certidao", 1)?.code === "PASSO_OBRIGATORIO_ABERTO")

console.log("\n(2) O cenário do Antão: linha reta concluída + cônjuges fora da linha concluídos + 1 passo cancelado")
const steps = [
  passo({ status: "CONCLUIDO", documentoId: 10 }),   // linha reta (ex.: Emerson Teixeira da Silva Antão)
  passo({ status: "CONCLUIDO", documentoId: 20 }),   // cônjuge fora da linha (Evanir Teixeira da Silva)
  passo({ status: "CONCLUIDO", documentoId: 21 }),   // cônjuge fora da linha (Priscila Oliveira Araujo)
  passo({ status: "CANCELADO", documentoId: 30 }),   // a certidão cancelada (Edison Nás Antão Junior, sem necessidade)
]
const necessidades = [{ id: 1, status: "ATENDIDA" }, { id: 2, status: "ATENDIDA" }, { id: 3, status: "ATENDIDA" }]
const todos = [{ id: 10, necessidadeId: 1 }, { id: 20, necessidadeId: 2 }, { id: 21, necessidadeId: 3 }, { id: 30, necessidadeId: null }]
const linhaReta = [{ id: 10, necessidadeId: 1 }, { id: 30, necessidadeId: null }]
const cenario = entrada({ steps, necessidades, documentosLinhaReta: linhaReta, documentosTodos: todos })
ok("o gate LIBERA (nenhuma pendência bloqueante)", codigos(cenario).length === 0, JSON.stringify(codigos(cenario)))
ok("e a projeção diz que pode avançar", (buildOperationalProjection(cenario) as { status?: { canAdvance?: boolean } }).status?.canAdvance === true)
const projeto = buildOperationalProjection(cenario) as { progress?: { percentage?: number } }
ok("o progresso é 100% (gate e progresso nunca divergem)", projeto.progress?.percentage === 100, String(projeto.progress?.percentage))

console.log("\n(3) Controle negativo: sem `documentosTodos` o bug antigo reaparece só para os cônjuges (prova a causa)")
const semTodos = entrada({ steps: steps.slice(0, 3), necessidades, documentosLinhaReta: linhaReta })
ok("sem documentosTodos, as certidões de fora da linha voltam a ficar pendentes", codigos(semTodos).includes("CERTIDAO_OBRIGATORIA_PENDENTE"))

console.log("\n(4) O que DEVE continuar bloqueando")
const aberto = entrada({ steps: [...steps.slice(0, 2), passo({ status: "DISPONIVEL", documentoId: 21 })], necessidades, documentosLinhaReta: linhaReta, documentosTodos: todos })
ok("certidão de cônjuge com passo AINDA ABERTO continua bloqueando", codigos(aberto).length > 0, JSON.stringify(codigos(aberto)))
const pendenteSemPasso = entrada({ steps: steps.slice(0, 2), necessidades, documentosLinhaReta: linhaReta, documentosTodos: todos })
ok("necessidade obrigatória SEM nenhum passo continua pendente", codigos(pendenteSemPasso).includes("CERTIDAO_OBRIGATORIA_PENDENTE"))
const soCancelada = entrada({ steps: [passo({ status: "CANCELADO", documentoId: 10, necessidadeId: 1 })], necessidades: [{ id: 1, status: "PENDENTE" }], documentosLinhaReta: [{ id: 10, necessidadeId: 1 }], documentosTodos: [{ id: 10, necessidadeId: 1 }] })
ok("cancelar o passo NÃO conclui a obrigação: necessidade ATIVA sem passo concluído segue pendente (cancelada ≠ concluída)", codigos(soCancelada).includes("CERTIDAO_OBRIGATORIA_PENDENTE"))


console.log("\n(5) TRAVA ESTRUTURAL: todo status de passo do schema tem decisão EXPLÍCITA no gate (nunca por omissão)")
// Decisão por status: "libera" = não bloqueia o avanço; "bloqueia" = bloqueia. Um status NOVO no enum sem entrada aqui
// reprova este teste — é assim que o próximo "CANCELADO esquecido" vira vermelho antes de virar processo parado.
const DECISAO: Record<string, "libera" | "bloqueia"> = {
  PENDENTE: "bloqueia", DISPONIVEL: "bloqueia", EM_ANDAMENTO: "bloqueia", AGUARDANDO: "bloqueia", BLOQUEADO: "bloqueia",
  EXECUTADO: "bloqueia", AGUARDANDO_APROVACAO: "bloqueia", FALHOU: "bloqueia",
  CONCLUIDO: "libera", DISPENSADO: "libera", SUPERSEDIDO: "libera", CANCELADO: "libera",
}
const schema = readFileSync("prisma/schema.prisma", "utf8")
const bloco = schema.slice(schema.indexOf("enum StepInstanceStatus"))
const statuses = bloco.slice(bloco.indexOf("{") + 1, bloco.indexOf("}")).split("\n").map((l) => l.trim().split(/\s|\/\//)[0]).filter((l) => /^[A-Z_]+$/.test(l))
ok(`o enum StepInstanceStatus tem ${statuses.length} valores, todos com decisão explícita`, statuses.length > 0 && statuses.every((st) => st in DECISAO), statuses.filter((st) => !(st in DECISAO)).join(","))
for (const st of statuses) {
  const bloqueia = classificarPasso(st, true, "solicitar_certidao", 1) !== null
  ok(`${st}: ${DECISAO[st]}`, bloqueia === (DECISAO[st] === "bloqueia"))
}

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
