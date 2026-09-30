// scripts/torre-acompanhamento-vencido-regra-unica.test.ts
// ============================================================================
// ACOMPANHAMENTO VENCIDO — UMA REGRA SÓ (30/09/2026, processo 651: #3864, #3866,
// #3868, #3869, #3870, #3871).
//
//   npx tsx scripts/torre-acompanhamento-vencido-regra-unica.test.ts   (banco de teste)
//
// A subtarefa de entrada estava "a iniciar" (DISPONIVEL) com
// `proximoAcompanhamentoEm` no passado: o rótulo dizia "Atrasada há 2 dias"
// (`acompanhamentoPasso.atrasado`) mas `acompanhamentoVencido` era false — o
// carregador temporal só olhava a subtarefa em AGUARDANDO_EXTERNO. PROVA:
//   • rótulo ⇔ sinal, para todos os deslocamentos de dia;
//   • a tarefa "a iniciar" vencida entra na visão da Torre, no KPI, na aba
//     Acompanhamento da Operação, e o estado temporal canônico concorda;
//   • a subtarefa BLOQUEADA por dependência nunca é a "corrente".
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-acompanhamento-vencido-regra-unica.test.ts")

import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { acompanhamentoVenceuNoDia, escolherSubtarefaCorrente } from "../lib/operacional/subtarefa-corrente"
import { estadoTemporalSubtarefa } from "../lib/operacional/tempo-operacional"
import { estadoTemporalDaOperacao } from "../lib/operacional/proximo-acontecimento"
import { visaoGerencial, acompanhamentoDoUsuario } from "../lib/operacional/tarefa-projecoes"
import { kpisDasLinhas } from "../lib/operacional/torre-kpis"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREACOMP"
const DIA = 86_400_000

async function main() {
  const agora = new Date()

  secao("REGRA PURA: sinal ⇔ rótulo (atrasado ou vence hoje), em todos os deslocamentos")
  const divergentes: number[] = []
  for (let d = -5; d <= 5; d++) {
    const data = new Date(agora.getTime() + d * DIA)
    const est = estadoTemporalSubtarefa({ dataPrazo: data, status: "DISPONIVEL", agora })
    if (acompanhamentoVenceuNoDia(data, agora) !== (est.atrasado || est.venceHoje)) divergentes.push(d)
  }
  ok("para -5..+5 dias, acompanhamentoVenceuNoDia === (atrasado || venceHoje) do rótulo", divergentes.length === 0, divergentes.join(","))
  ok("sem data nunca é vencido", !acompanhamentoVenceuNoDia(null, agora) && !acompanhamentoVenceuNoDia(undefined, agora))

  secao("SUBTAREFA CORRENTE: dependência pendente nunca é a corrente")
  const execs = [
    { subtaskKey: "b", status: "BLOQUEADO" },
    { subtaskKey: "a", status: "DISPONIVEL" },
  ]
  const defs = new Map([["a", { dependeDe: [] as string[] }], ["b", { dependeDe: ["a"] }]])
  const ordens = new Map([["a", 1], ["b", 0]])
  ok("BLOQUEADO (depende de 'a', que não concluiu) não é escolhida mesmo com ordem menor", escolherSubtarefaCorrente(execs, defs, ordens)?.subtaskKey === "a")
  ok("com 'a' CONCLUIDO, a corrente passa a ser 'b'", escolherSubtarefaCorrente([{ subtaskKey: "a", status: "CONCLUIDO" }, { subtaskKey: "b", status: "PENDENTE" }], defs, ordens)?.subtaskKey === "b")

  secao("BANCO: tarefa 'a iniciar' com acompanhamento no passado (o caso do 651)")
  const c = await montarCenario(MARCA)
  try {
    const venc = await c.novaObrigacao()            // a iniciar, acompanhamento há 2 dias
    const hoje = await c.novaObrigacao()            // a iniciar, acompanhamento hoje
    const futuro = await c.novaObrigacao()          // a iniciar, acompanhamento em 3 dias
    const semData = await c.novaObrigacao()         // a iniciar, sem acompanhamento
    const grava = (stepInstanceId: number, d: Date | null) =>
      prisma.subtaskExecution.updateMany({ where: { stepInstanceId, supersededAt: null, status: { notIn: ["CONCLUIDO", "CANCELADO", "INVALIDADO", "FALHOU"] } }, data: { proximoAcompanhamentoEm: d } })
    await grava(venc.stepInstanceId, new Date(agora.getTime() - 2 * DIA))
    await grava(hoje.stepInstanceId, new Date(agora.getTime()))
    await grava(futuro.stepInstanceId, new Date(agora.getTime() + 3 * DIA))
    await grava(semData.stepInstanceId, null)

    const ids = [venc, hoje, futuro, semData].map((o) => o.processoId)
    const linhas = (await Promise.all(ids.map((processoId) => visaoGerencial({ processoId }, agora)))).flatMap((r) => r.linhas)
    const L = (o: { tarefaId: number }) => linhas.find((l) => l.taskId === o.tarefaId)!

    const lv = L(venc)
    ok("pré-condição: o passo está 'a iniciar' (DISPONIVEL, não tocado)", lv.aIniciar === true && lv.estadoOperacao === "FILA")
    ok("o rótulo diz atrasado (acompanhamentoPasso.atrasado)", lv.acompanhamentoPasso?.atrasado === true, lv.acompanhamentoPasso?.rotulo)
    ok("acompanhamentoVencido === true (ANTES: false — a divergência do 651)", lv.acompanhamentoVencido === true)
    ok("hoje: vence hoje E vencido (a categoria 'Acompanhar hoje')", L(hoje).acompanhamentoPasso?.venceHoje === true && L(hoje).acompanhamentoVencido === true)
    ok("daqui a 3 dias: nem rótulo nem sinal", L(futuro).acompanhamentoPasso?.atrasado === false && L(futuro).acompanhamentoVencido === false)
    ok("sem data: nem rótulo nem sinal", L(semData).acompanhamentoVencido === false)
    ok("para TODAS as linhas: sinal ⇔ (atrasado || venceHoje) do rótulo",
      linhas.every((l) => l.acompanhamentoVencido === (l.acompanhamentoPasso?.atrasado === true || l.acompanhamentoPasso?.venceHoje === true)))

    const est = await estadoTemporalDaOperacao(prisma, venc.tarefaId, agora)
    ok("o estado temporal canônico (notificações/Saúde) concorda: acompanhamentoVencido + motivo de risco",
      est?.acompanhamentoVencido === true && est.motivosRisco.includes("ACOMPANHAMENTO_VENCIDO"))

    // TORRE: a mesma linha entra na visão, no KPI 'Cobranças vencidas' e na lista cobrável.
    const torre = await listarTarefasDaTorre({}, agora)
    const doTeste = torre.linhas.filter((l) => ids.includes(l.processoId as number))
    const kpi = kpisDasLinhas(doTeste)
    ok("KPI 'cobranças vencidas' conta as 2 (vencida + hoje) — mesmas linhas da lista", kpi.cobrancasPendentes === 2 && doTeste.filter((l) => l.cobravelVencida).length === 2, `kpi=${kpi.cobrancasPendentes}`)
    ok("a lista filtrada por acompanhamentoVencido bate com o KPI", doTeste.filter((l) => l.acompanhamentoVencido).length === kpi.cobrancasPendentes)

    // OPERAÇÃO: aba Acompanhamento (escopo de equipe, null) traz a vencida e a de hoje.
    const acomp = (await Promise.all(ids.map((processoId) => acompanhamentoDoUsuario(null, agora, undefined, { processoId })))).flat().map((l) => l.taskId)
    ok("Operação/Acompanhamento inclui a 'a iniciar' vencida e a de hoje; exclui futuro e sem data",
      acomp.includes(venc.tarefaId) && acomp.includes(hoje.tarefaId) && !acomp.includes(futuro.tarefaId) && !acomp.includes(semData.tarefaId))
  } finally {
    await c.limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
