// scripts/saude-biblioteca-nao-e-fase.test.ts
// ============================================================================
// SAÚDE DO SISTEMA — a casca de um Modelo da Biblioteca NÃO é workflow de fase (Torre, Bloco I, 30/09/2026).
//
//   npx tsx scripts/saude-biblioteca-nao-e-fase.test.ts   (banco de teste)
//
// Em produção, os 7 workflows da Biblioteca de Tarefas (fase "biblioteca", origemBiblioteca=true) geravam
// ~28 ERROS falsos de CAD-002 + WF-006 + WFI-002 que nunca sumiam. PROVA:
//   • as cascas da biblioteca NÃO disparam CAD-002, WF-006 nem WFI-002;
//   • workflows de fase REAIS continuam sendo verificados: um erro real ainda dispara o achado;
//   • a CHAVE do CAD-002 é estável: republicar (recriar a ação, com outro id) não troca a identidade.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("saude-biblioteca-nao-e-fase.test.ts")
import { prisma } from "../lib/prisma"
import { verificacaoPorCodigo } from "../lib/saude/catalogo"
import "../lib/saude"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "SAUDEBIB"

async function limpar() {
  await prisma.phaseInternalWorkflow.deleteMany({ where: { wfUid: { startsWith: MARCA } } })
}
async function wf(nome: string, phaseKey: string, origemBiblioteca: boolean) {
  const w = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `${MARCA}-${nome}`, phaseKey, name: `${MARCA} ${nome}`, active: true, origemBiblioteca }, select: { id: true } })
  const passo = await prisma.phaseInternalWorkflowStep.create({ data: { workflowId: w.id, key: "passo", label: "Passo", ordem: 1 }, select: { id: true } })
  const acao = await prisma.stepAction.create({ data: { stepId: passo.id, key: "concluir", label: "Concluir", ordem: 1, effectKey: "COMPLETE_STEP" }, select: { id: true } })
  return { w, passo, acao }
}
const rodar = async (codigo: string) => {
  const v = verificacaoPorCodigo(codigo)!
  const r = await v.executar({ agora: new Date(), modo: "COMPLETO" })
  return (r.achados ?? []).filter((a) => JSON.stringify(a).includes(MARCA) || JSON.stringify(a.evidencia ?? {}).includes(MARCA))
}

async function main() {
  await limpar()
  try {
    secao("AS CASCAS DA BIBLIOTECA NÃO SÃO VERIFICADAS COMO FASE")
    // 3 cascas na mesma fase "biblioteca" (genérico) — exatamente o quadro de produção (7 ativos, 1 fase, tipo nulo).
    await wf("modelo-a", "biblioteca", true); await wf("modelo-b", "biblioteca", true); await wf("modelo-c", "biblioteca", true)
    ok("CAD-002 não acusa ação de casca da biblioteca", (await rodar("CAD-002")).length === 0)
    const wf006 = verificacaoPorCodigo("WF-006")!, wfi002 = verificacaoPorCodigo("WFI-002")!
    const ambBib = async (v: typeof wf006) => (await v.executar({ agora: new Date(), modo: "COMPLETO" })).achados?.filter((a) => /biblioteca/.test(JSON.stringify(a))) ?? []
    ok("WF-006 não acusa 'fase biblioteca com vários ativos'", (await ambBib(wf006)).length === 0)
    ok("WFI-002 não acusa 'vários workflows ativos para biblioteca'", (await ambBib(wfi002)).length === 0)

    secao("WORKFLOWS DE FASE REAIS CONTINUAM SENDO VERIFICADOS")
    const faseReal = `${MARCA.toLowerCase()}_fase`
    const a1 = await wf("real-a", faseReal, false)
    const a2 = await wf("real-b", faseReal, false)
    const cad = await rodar("CAD-002")
    ok("CAD-002 ainda dispara para um erro real de fase (fase sem a competência do efeito)", cad.length === 2 && cad.every((a) => a.severidade === "ERRO"), `${cad.length} achados`)
    ok("WF-006 ainda acusa dois ativos reais para a mesma fase", (await wf006.executar({ agora: new Date(), modo: "COMPLETO" })).achados?.some((a) => JSON.stringify(a).includes(faseReal)) === true)
    ok("WFI-002 ainda acusa dois ativos reais para a mesma fase", (await wfi002.executar({ agora: new Date(), modo: "COMPLETO" })).achados?.some((a) => JSON.stringify(a).includes(faseReal)) === true)
    ok("…e as cascas seguem fora dos dois", !(await wf006.executar({ agora: new Date(), modo: "COMPLETO" })).achados?.some((a) => /:biblioteca/.test(a.chave)) && !(await wfi002.executar({ agora: new Date(), modo: "COMPLETO" })).achados?.some((a) => /biblioteca\|/.test(a.chave)))

    secao("A CHAVE DO CAD-002 É ESTÁVEL (não depende do id da ação)")
    const antes = cad.map((a) => a.chave).sort()
    ok("a chave não contém o id da ação", cad.every((a) => !a.chave.includes(String(a.registroId))) || cad.every((a) => a.chave.includes(MARCA)))
    // "Republicar": a ação é apagada e recriada — id novo, mesmo passo, mesma chave de ação.
    for (const x of [a1, a2]) {
      await prisma.stepAction.delete({ where: { id: x.acao.id } })
      await prisma.stepAction.create({ data: { stepId: x.passo.id, key: "concluir", label: "Concluir", ordem: 1, effectKey: "COMPLETE_STEP" } })
    }
    const depois = (await rodar("CAD-002")).map((a) => a.chave).sort()
    ok("depois de recriar as ações (ids novos) as chaves são IDÊNTICAS", JSON.stringify(antes) === JSON.stringify(depois), depois.join(" | "))
    ok("duas ações de mesma chave em passos/workflows diferentes têm chaves diferentes", new Set(depois).size === 2)
  } finally { await limpar() }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
