// scripts/torre-bloco-e-metricas.test.ts
// ============================================================================
// TORRE DE CONTROLE, BLOCO E9 + E11 (29/09/2026) — dias na fase (data REAL de
// entrada, PhaseAdvanceLog), próximo marco (texto derivado do estado real das
// tarefas) e tempo médio real por fase (entrada→saída pareadas no log).
//
//   npx tsx scripts/torre-bloco-e-metricas.test.ts
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-bloco-e-metricas.test.ts")

import { prisma } from "../lib/prisma"
import { diasNaFaseAtual, proximoMarco, tempoMedioRealPorFase, progressoRealDoProcesso } from "../lib/operacional/metricas-processo"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "TORRE_E9E11_"

async function limpar() {
  await prisma.phaseAdvanceLog.deleteMany({ where: { processo: { nome: { startsWith: MARCA } } } })
  await prisma.tarefa.deleteMany({ where: { processo: { nome: { startsWith: MARCA } } } })
  await prisma.processo.deleteMany({ where: { nome: { startsWith: MARCA } } })
}

let seq = 0
async function logDeAvanco(processoId: number, de: string, para: string, criadoEm: Date) {
  seq++
  await prisma.phaseAdvanceLog.create({
    data: {
      processoId, faseAtual: de, fasePretendida: para, resultado: "MOVIDO", origem: "TESTE",
      regrasAvaliadas: {}, pendencias: {}, correlationId: `${MARCA}${seq}`, chaveIdempotencia: `${MARCA}${seq}`,
      criadoEm,
    },
  })
}

async function main() {
  await limpar()

  const agora = new Date()
  const diasAtras = (n: number) => new Date(agora.getTime() - n * 86_400_000)

  secao("E9 · DIAS NA FASE — pela data real de entrada")

  const proc1 = await prisma.processo.create({ data: { nome: `${MARCA}proc1`, faseAtualKey: "emissao_documental", dataInicio: diasAtras(60) } })
  await logDeAvanco(proc1.id, "coleta_de_dados", "emissao_documental", diasAtras(10))

  const d1 = await diasNaFaseAtual(proc1.id, agora)
  ok("acha a fase atual", d1.faseAtual === "emissao_documental")
  ok("origem é AVANCO_DE_FASE quando há log", d1.origem === "AVANCO_DE_FASE")
  ok("dias = 10 (desde o avanço, não desde o cadastro)", d1.dias === 10, `got ${d1.dias}`)

  const proc2 = await prisma.processo.create({ data: { nome: `${MARCA}proc2-sem-log`, faseAtualKey: "coleta_de_dados", dataInicio: diasAtras(7) } })
  const d2 = await diasNaFaseAtual(proc2.id, agora)
  ok("SEM log de avanço, cai para a data do cadastro (nunca inventa)", d2.origem === "CADASTRO_DO_PROCESSO")
  ok("dias = 7 (desde o cadastro)", d2.dias === 7, `got ${d2.dias}`)

  const proc3 = await prisma.processo.create({ data: { nome: `${MARCA}proc3-sem-fase` } })
  const d3 = await diasNaFaseAtual(proc3.id, agora)
  ok("processo sem faseAtualKey → tudo null, nunca um número inventado", d3.faseAtual === null && d3.dias === null)

  secao("E9 · PROGRESSO REAL — delega para completude documental (uma fonte por dado)")
  const p1 = await progressoRealDoProcesso(proc3.id)
  ok("processo sem árvore → required=0/completed=0 (delegado, não recalculado)", p1.required === 0 && p1.completed === 0)

  secao("E9 · PRÓXIMO MARCO — texto derivado do estado real")
  const semTarefas = await proximoMarco(proc1.id)
  ok("sem tarefas ativas na fase → null, nunca texto fixo", semTarefas === null)

  await prisma.tarefa.create({ data: { titulo: `${MARCA}t1`, processoId: proc1.id, faseMacroKey: "emissao_documental", statusTarefa: "AGUARDANDO_TERCEIRO" } })
  await prisma.tarefa.create({ data: { titulo: `${MARCA}t2`, processoId: proc1.id, faseMacroKey: "emissao_documental", statusTarefa: "NAO_INICIADA" } })
  await prisma.tarefa.create({ data: { titulo: `${MARCA}t3`, processoId: proc1.id, faseMacroKey: "emissao_documental", statusTarefa: "NAO_INICIADA" } })
  await prisma.tarefa.create({ data: { titulo: `${MARCA}t4-outra-fase`, processoId: proc1.id, faseMacroKey: "apostilamento", statusTarefa: "NAO_INICIADA" } })

  const marco = await proximoMarco(proc1.id)
  ok("conta só as tarefas DA FASE ATUAL", marco === "3 pedido(s) na fase; 1 enviado(s), 2 a enviar", `got "${marco}"`)

  secao("E11 · TEMPO MÉDIO REAL POR FASE — entrada→saída pareadas")

  // proc1 entrou em coleta_de_dados há 20 dias, saiu para emissao_documental há 10
  // (já registrado acima) — permanência em coleta_de_dados = 10 dias.
  await logDeAvanco(proc1.id, "abertura", "coleta_de_dados", diasAtras(20))

  const proc4 = await prisma.processo.create({ data: { nome: `${MARCA}proc4`, faseAtualKey: "emissao_documental" } })
  await logDeAvanco(proc4.id, "abertura", "coleta_de_dados", diasAtras(30))
  await logDeAvanco(proc4.id, "coleta_de_dados", "emissao_documental", diasAtras(24)) // 6 dias em coleta_de_dados
  await logDeAvanco(proc4.id, "emissao_documental", "apostilamento", diasAtras(4)) // 20 dias em emissao_documental — AINDA EM CURSO seria diferente; aqui já saiu.

  const geral = await tempoMedioRealPorFase()
  const coleta = geral.find((f) => f.fase === "coleta_de_dados")
  ok("coleta_de_dados: 2 amostras (proc1=10, proc4=6) → média 8", coleta?.amostras === 2 && coleta?.mediaDias === 8,
    `got ${JSON.stringify(coleta)}`)

  const soProc1 = await tempoMedioRealPorFase(proc1.id)
  ok("por processo (proc1) só conta as PRÓPRIAS transições", soProc1.find((f) => f.fase === "coleta_de_dados")?.amostras === 1)

  // proc5: entrou numa fase e AINDA está nela (sem saída) — não pode entrar na média.
  const proc5 = await prisma.processo.create({ data: { nome: `${MARCA}proc5-em-curso`, faseAtualKey: "apostilamento" } })
  await logDeAvanco(proc5.id, "emissao_documental", "apostilamento", diasAtras(3))
  const semSaida = await tempoMedioRealPorFase(proc5.id)
  ok("fase ainda em curso (sem saída registrada) não entra na média", semSaida.length === 0, `got ${JSON.stringify(semSaida)}`)

  await limpar()

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
