// scripts/torre-proximo-marco-da-linha.test.ts
// ============================================================================
// OPERAÇÃO/TORRE — "PRÓXIMO MARCO" DA FAMÍLIA VEM DO CAMINHO REAL DO PROCESSO (B5, 30/09/2026).
//
// Achado real: a aba Famílias mostrava "Próximo marco: Análise documental" FIXO para qualquer processo (literal que
// só serve a um tipo). Depois foi omitido, porque a linha não trazia o dado. Agora a projeção (`LinhaGerencial`)
// traz `proximaFaseDoProcessoLabel`: o RÓTULO da fase seguinte do Workflow Macro do processo (tipo + modalidade),
// pulando as fases CONDICIONAIS que a Análise não pediu — a MESMA regra do avanço (`proximaFaseDoCaminho`, usada por
// `proximaFaseComCondicional` em phase-advance.ts) e o MESMO rótulo de `faseAtualDoProcessoLabel`.
//
// PROVA:
//   • processo em fase X → o marco é a fase seguinte REAL do macrofluxo (não "Análise documental" fixo);
//   • fase condicional (retificação) é pulada sem `requerRetificacao` e entra com ele — igual à regra do motor;
//   • última fase / fase fora do macro / processo sem modalidade → `null` (a tela omite o marco);
//   • o resultado é o MESMO que `resolverMacroWorkflowDoProcesso` + `proximaFaseDoCaminho` dão por processo;
//   • uma leitura em lote: o número de consultas não cresce com o número de processos;
//   • a aba Famílias mostra "Próximo marco: <fase>" com o campo (e omite quando ausente).
//
//   npx tsx scripts/torre-proximo-marco-da-linha.test.ts   (banco de teste)
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-proximo-marco-da-linha.test.ts")

import { readFileSync } from "node:fs"
import { PrismaClient } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { visaoGerencial } from "../lib/operacional/tarefa-projecoes"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { labelDaFasePorPhaseKey } from "../src/lib/process-stage/fases-catalog"
import { resolverMacroWorkflowDoProcesso } from "../src/lib/motor/resolver-macro-workflow"
import { proximaFaseDoCaminho } from "../src/lib/motor/phase-advance-helpers"
import { proximoMarcoDaFamilia } from "../src/components/operacao/operacao-v3-derivacoes"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORRE_B5_MARCO"

async function contar<T>(rodar: (db: PrismaClient) => Promise<T>): Promise<{ n: number; r: T }> {
  const espiao = new PrismaClient({ log: [{ emit: "event", level: "query" }] })
  let n = 0
  ;(espiao as unknown as { $on: (e: string, cb: (q: { query: string }) => void) => void }).$on("query", (q) => { if (!/^\s*SELECT 1\b/i.test(q.query)) n++ })
  try { const r = await rodar(espiao); return { n, r } } finally { await espiao.$disconnect() }
}

async function main() {
  const c = await montarCenario(MARCA)
  try {
    // O macrofluxo do tipo de teste: [fase da fixture (ordem 0)] → Genealogia → Emissão documental →
    // Retificação de registros (CONDICIONAL) → Tradução juramentada (última).
    const macro = await prisma.macroWorkflow.findFirstOrThrow({ where: { tipoProcessoId: c.tipoId }, select: { id: true } })
    for (const [phaseKey, ordem, conditional] of [["genealogia", 10, false], ["emissao_documental", 20, false], ["retificacao_registros", 30, true], ["traducao_juramentada", 40, false]] as const) {
      await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey, label: phaseKey, ordem, conditional } })
    }
    const L = (k: string) => labelDaFasePorPhaseKey(k)!

    /** Uma obrigação num processo que está na fase `fase` (e, opcionalmente, com a decisão da Análise). */
    async function processoEm(fase: string, opcoes: { requerRetificacao?: boolean; semModalidade?: boolean } = {}) {
      const o = await c.novaObrigacao()
      await prisma.processo.update({ where: { id: o.processoId }, data: { faseAtualKey: fase, ...(opcoes.semModalidade ? { modalidadeId: null } : {}) } })
      if (opcoes.requerRetificacao !== undefined) await prisma.analiseDocumental.create({ data: { processoId: o.processoId, requerRetificacao: opcoes.requerRetificacao } })
      return o
    }
    const marcoDe = async (tarefaId: number, agora = new Date()) => {
      const { linhas } = await visaoGerencial({}, agora)
      const l = linhas.find((x) => x.taskId === tarefaId)
      if (!l) throw new Error(`tarefa ${tarefaId} fora da visão`)
      return l.proximaFaseDoProcessoLabel
    }

    secao("(1) O marco é a fase SEGUINTE REAL do macrofluxo — nunca um literal")
    const naFixture = await processoEm(c.PHASE_KEY)
    ok("na 1ª fase (fora do catálogo) → Genealogia", (await marcoDe(naFixture.tarefaId)) === L("genealogia"), L("genealogia"))
    const emGenealogia = await processoEm("genealogia")
    ok("em Genealogia → Emissão documental", (await marcoDe(emGenealogia.tarefaId)) === L("emissao_documental"), L("emissao_documental"))
    ok("e NÃO é o literal 'Análise documental' de antes", (await marcoDe(emGenealogia.tarefaId)) !== "Análise documental" && (await marcoDe(emGenealogia.tarefaId)) !== "Análise Documental")

    secao("(2) Fase CONDICIONAL: pulada sem retificação, incluída com ela (a regra do avanço)")
    const semAnalise = await processoEm("emissao_documental")
    ok("sem Análise gravada → pula a Retificação → Tradução juramentada", (await marcoDe(semAnalise.tarefaId)) === L("traducao_juramentada"), L("traducao_juramentada"))
    const semRetificacao = await processoEm("emissao_documental", { requerRetificacao: false })
    ok("Análise diz 'sem retificação' → pula → Tradução juramentada", (await marcoDe(semRetificacao.tarefaId)) === L("traducao_juramentada"))
    const comRetificacao = await processoEm("emissao_documental", { requerRetificacao: true })
    ok("Análise diz 'com retificação' → Retificação de registros", (await marcoDe(comRetificacao.tarefaId)) === L("retificacao_registros"), L("retificacao_registros"))

    secao("(3) Sem próximo marco → null (a tela omite)")
    const ultima = await processoEm("traducao_juramentada")
    ok("última fase → null", (await marcoDe(ultima.tarefaId)) === null)
    const foraDoMacro = await processoEm("apostilamento")
    ok("fase que o macrofluxo do tipo não tem → null (fase desconhecida não inventa marco)", (await marcoDe(foraDoMacro.tarefaId)) === null)
    const semModalidade = await processoEm("genealogia", { semModalidade: true })
    ok("processo sem modalidade (sem Workflow Macro resolvível) → null", (await marcoDe(semModalidade.tarefaId)) === null)

    secao("(4) Igual ao que o MOTOR resolve para cada processo (resolverMacroWorkflowDoProcesso + regra do avanço)")
    const todos = [naFixture, emGenealogia, semAnalise, semRetificacao, comRetificacao, ultima, foraDoMacro]
    const { linhas } = await visaoGerencial({})
    for (const o of todos) {
      const p = await prisma.processo.findUniqueOrThrow({ where: { id: o.processoId }, select: { faseAtualKey: true, tipoProcessoMotorId: true, modalidadeId: true } })
      const wf = await resolverMacroWorkflowDoProcesso(p.tipoProcessoMotorId, p.modalidadeId)
      const analise = await prisma.analiseDocumental.findUnique({ where: { processoId: o.processoId }, select: { requerRetificacao: true } })
      const chave = wf && p.faseAtualKey ? proximaFaseDoCaminho(wf.fases, p.faseAtualKey, analise?.requerRetificacao === true) : null
      const esperado = chave ? labelDaFasePorPhaseKey(chave) : null
      const linha = linhas.find((l) => l.taskId === o.tarefaId)!
      ok(`processo em ${p.faseAtualKey}: ${JSON.stringify(linha.proximaFaseDoProcessoLabel)} == motor ${JSON.stringify(esperado)}`, linha.proximaFaseDoProcessoLabel === esperado)
    }

    secao("(5) A Torre traz o mesmo campo (mesma projeção)")
    const torre = await listarTarefasDaTorre({})
    ok("a linha da Torre de um processo em Genealogia traz 'Emissão documental'", torre.linhas.find((l) => l.taskId === emGenealogia.tarefaId)?.proximaFaseDoProcessoLabel === L("emissao_documental"))

    secao("(6) Em LOTE: o número de consultas não cresce com o número de processos")
    const antes = await contar((db) => visaoGerencial({}, new Date(), db))
    for (let i = 0; i < 5; i++) await processoEm(i % 2 ? "genealogia" : "emissao_documental", { requerRetificacao: i % 2 === 0 })
    const depois = await contar((db) => visaoGerencial({}, new Date(), db))
    ok("com mais processos, o MESMO número de consultas", antes.n === depois.n && depois.r.linhas.length >= antes.r.linhas.length + 5, `${antes.n} × ${depois.n} consultas para ${antes.r.linhas.length} × ${depois.r.linhas.length} linhas`)

    secao("(7) A aba Famílias mostra 'Próximo marco: <fase>' com o campo, e omite sem ele")
    const abas = readFileSync("src/components/operacao/operacao-v3-abas.tsx", "utf8")
    ok("usa proximoMarcoDaFamilia e mostra 'Próximo marco:' só quando há marco", /marco: proximoMarcoDaFamilia\(/.test(abas) && /f\.marco \? <> · Próximo marco: <b>\{f\.marco\}<\/b><\/> : null/.test(abas))
    ok("nenhum literal 'Análise documental' como marco na aba", !/Próximo marco: <b>Análise/.test(abas) && !/marco: "Análise/i.test(abas))
    const doServidor = linhas.filter((l) => [emGenealogia.tarefaId, semAnalise.tarefaId].includes(l.taskId))
    ok("a família (linhas reais da projeção) resolve o marco", proximoMarcoDaFamilia(doServidor as never) === L("emissao_documental") || proximoMarcoDaFamilia(doServidor as never) === L("traducao_juramentada"))
    ok("sem o dado → null (a tela omite)", proximoMarcoDaFamilia([{ proximaFaseDoProcessoLabel: null }, {}] as never) === null)
  } finally {
    await c.limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas${falhas.length ? ` — ${falhas.join(" | ")}` : ""}`)
  await prisma.$disconnect()
  process.exit(falhou ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
