// scripts/torre-fase-futura-regra-unica.test.ts
// ============================================================================
// TAREFA DE FASE FUTURA — UMA REGRA PARA TODA A TORRE E A OPERAÇÃO (30/09/2026).
//
//   npx tsx scripts/torre-fase-futura-regra-unica.test.ts   (banco de teste)
//
// Caso real: #3906 "Encerrar processo" (`finalizado`) com o processo 651 em
// `emissao_documental` entrava na lista da Torre e no KPI 'Sem responsável'
// mas não no 'Precisa de você'. PROVA: fase futura fora de lista, KPI,
// Operação (minhaFila, semResponsavel, acompanhamento), sino; fase atual e
// ANTERIOR entram; fase desconhecida/sem fase são neutras; número do KPI =
// tamanho da lista que o clique filtra.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-fase-futura-regra-unica.test.ts")

import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { ehFaseFutura, semFaseFutura } from "../lib/operacional/fase-futura"
import { minhaFila, semResponsavel, visaoGerencial } from "../lib/operacional/tarefa-projecoes"
import { kpisDasLinhas, linhasDoKpi } from "../lib/operacional/torre-kpis"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { lerLinhasOperacionais } from "../lib/operacional/avisos-sino"
import { itensPrecisaDeVoce } from "../lib/operacional/precisa-de-voce"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREFUT"

async function main() {
  secao("REGRA PURA")
  const ordens = new Map([["genealogia", 1], ["emissao", 5], ["finalizado", 9]])
  ok("fase de ordem MAIOR que a atual é futura", ehFaseFutura("finalizado", "emissao", ordens) === true)
  ok("fase atual não é futura", ehFaseFutura("emissao", "emissao", ordens) === false)
  ok("fase ANTERIOR não é futura (segue aparecendo)", ehFaseFutura("genealogia", "emissao", ordens) === false)
  ok("neutro: fase da tarefa fora do cadastro, sem fase, processo sem fase atual, sem ordens",
    !ehFaseFutura("desconhecida", "emissao", ordens) && !ehFaseFutura(null, "emissao", ordens) && !ehFaseFutura("finalizado", null, ordens) && !ehFaseFutura("finalizado", "emissao", null))
  ok("semFaseFutura tira só as marcadas", semFaseFutura([{ faseFutura: true }, { faseFutura: false }, {}]).length === 2)

  secao("BANCO: 5 tarefas no mesmo tipo, processo na fase atual")
  const c = await montarCenario(MARCA)
  try {
    const macroId = (await prisma.faseMacro.findFirstOrThrow({ where: { phaseKey: c.PHASE_KEY }, select: { macroWorkflowId: true } })).macroWorkflowId
    const ANT = `${MARCA.toLowerCase()}_ant`, FUT = `${MARCA.toLowerCase()}_fut`
    await prisma.faseMacro.createMany({ data: [
      { macroWorkflowId: macroId, phaseKey: ANT, label: ANT, ordem: -5 },
      { macroWorkflowId: macroId, phaseKey: FUT, label: FUT, ordem: 50 },
    ] })
    const mk = async (faseMacroKey: string | null) => {
      const o = await c.novaObrigacao({ responsavelId: null })
      await prisma.tarefa.update({ where: { id: o.tarefaId }, data: { faseMacroKey } })
      return o
    }
    const atual = await mk(c.PHASE_KEY)
    const anterior = await mk(ANT)
    const futura = await mk(FUT)              // o caso #3906
    const desconhecida = await mk("fase_fora_do_cadastro")
    const transversal = await mk(null)
    const todas = [atual, anterior, futura, desconhecida, transversal]
    const procIds = todas.map((o) => o.processoId)
    const agora = new Date()

    const cru = (await Promise.all(procIds.map((processoId) => visaoGerencial({ processoId }, agora)))).flatMap((r) => r.linhas)
    ok("a projeção marca faseFutura só na tarefa de fase futura",
      cru.find((l) => l.taskId === futura.tarefaId)?.faseFutura === true && cru.filter((l) => l.faseFutura).length === 1)

    const torre = await listarTarefasDaTorre({}, agora)
    const ids = new Set(torre.linhas.map((l) => l.taskId))
    ok("Torre/lista: fase FUTURA fora", !ids.has(futura.tarefaId))
    ok("Torre/lista: fase atual, ANTERIOR, desconhecida e sem fase entram",
      ids.has(atual.tarefaId) && ids.has(anterior.tarefaId) && ids.has(desconhecida.tarefaId) && ids.has(transversal.tarefaId))

    const doTeste = torre.linhas.filter((l) => procIds.includes(l.processoId as number))
    const kpi = kpisDasLinhas(doTeste)
    ok("KPI 'Sem responsável' = 4 (antes 5) e = tamanho da lista que o clique filtra", kpi.semDono === 4 && linhasDoKpi("semdono", doTeste).length === 4, `kpi=${kpi.semDono}`)

    const sr = (await semResponsavel(agora)).map((l) => l.taskId)
    ok("Operação/semResponsavel: futura fora, as outras 4 dentro",
      !sr.includes(futura.tarefaId) && [atual, anterior, desconhecida, transversal].every((o) => sr.includes(o.tarefaId)))
    const mf = (await minhaFila(null, agora)).map((l) => l.taskId)
    ok("Operação/minhaFila (equipe): futura fora, anterior dentro", !mf.includes(futura.tarefaId) && mf.includes(anterior.tarefaId))
    const av = (await lerLinhasOperacionais(agora)).map((l) => l.taskId)
    ok("sino/avisos: futura fora, atual dentro", !av.includes(futura.tarefaId) && av.includes(atual.tarefaId))
    const pv = (await itensPrecisaDeVoce({ agora })).flatMap((i) => (i as unknown as { tarefaId?: number }).tarefaId ?? [])
    ok("coerente com o 'Precisa de você' (que já excluía a futura)", !pv.includes(futura.tarefaId))
  } finally {
    await prisma.faseMacro.deleteMany({ where: { phaseKey: { in: [`${MARCA.toLowerCase()}_ant`, `${MARCA.toLowerCase()}_fut`] } } })
    await c.limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
