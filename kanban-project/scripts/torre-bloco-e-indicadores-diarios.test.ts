// scripts/torre-bloco-e-indicadores-diarios.test.ts
// ============================================================================
// TORRE DE CONTROLE, BLOCO E10 (29/09/2026) — a foto diária dos 8 KPIs +
// backlog. Os números vêm das MESMAS projeções da Operação
// (`indicadoresGerenciais`/`visaoGerencial`) — nada recalculado aqui.
//
//   npx tsx scripts/torre-bloco-e-indicadores-diarios.test.ts
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-bloco-e-indicadores-diarios.test.ts")

import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { calcularIndicadoresDoDia, gravarIndicadoresDoDia, serieDeIndicadores } from "../lib/operacional/indicadores-diarios"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "TORRE_E10_"

async function limpar() {
  await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
  await prisma.torreIndicadorDiario.deleteMany({})
  await (await montarCenario("TORREE10FX")).limpar()
}

async function main() {
  await limpar()

  const agora = new Date()
  const antesDeCriar = await calcularIndicadoresDoDia(agora)

  secao("E10 · OS 8 INDICADORES — vêm de dado real, incrementam com fixture")

  await prisma.tarefa.create({
    data: { titulo: `${MARCA}vencida`, statusTarefa: "NAO_INICIADA", dataPrazo: new Date(agora.getTime() - 5 * 86_400_000) },
  })
  await prisma.tarefa.create({
    data: { titulo: `${MARCA}vence-em-3-dias`, statusTarefa: "NAO_INICIADA", dataPrazo: new Date(agora.getTime() + 3 * 86_400_000) },
  })
  await prisma.tarefa.create({ data: { titulo: `${MARCA}sem-dono`, statusTarefa: "NAO_INICIADA", responsavelId: null } })
  // "Com o cartório" é a projeção `estadoOperacao: AGUARDANDO` (Bloco J3: cartão e lista usam a MESMA definição) —
  // um status cru sem passo por trás não é "com o cartório". Uma obrigação real, materializada pelo motor, é.
  const cenario = await montarCenario("TORREE10FX")
  await cenario.novaObrigacao({ aguardando: true })
  await prisma.tarefa.create({ data: { titulo: `${MARCA}criada-esta-semana`, createdAt: agora } })
  await prisma.tarefa.create({
    data: { titulo: `${MARCA}concluida-esta-semana`, statusTarefa: "CONCLUIDO_RECEBIDO", dataConclusao: agora },
  })
  // Cancelada NÃO conta como backlog fechado (regra permanente).
  await prisma.tarefa.create({
    data: { titulo: `${MARCA}cancelada-esta-semana`, statusTarefa: "CANCELADA", dataConclusao: agora },
  })

  const depoisDeCriar = await calcularIndicadoresDoDia(agora)

  ok("vencidas sobe com a tarefa atrasada", depoisDeCriar.vencidas === antesDeCriar.vencidas + 1)
  ok("vencemEm7Dias sobe com a tarefa a 3 dias", depoisDeCriar.vencemEm7Dias === antesDeCriar.vencemEm7Dias + 1)
  ok("semDono sobe com as 2 tarefas sem dono criadas (sem-dono + com-cartorio? não — só as sem responsavelId)",
    depoisDeCriar.semDono >= antesDeCriar.semDono + 1)
  ok("aguardandoTerceiro sobe com a tarefa no cartório", depoisDeCriar.aguardandoTerceiro === antesDeCriar.aguardandoTerceiro + 1)
  ok("backlogAbertas sobe com as tarefas criadas nesta semana",
    depoisDeCriar.backlogAbertas >= antesDeCriar.backlogAbertas + 6)
  ok("backlogFechadasNaSemana sobe com a conclusão real, nunca com a CANCELADA",
    depoisDeCriar.backlogFechadasNaSemana === antesDeCriar.backlogFechadasNaSemana + 1,
    `antes=${antesDeCriar.backlogFechadasNaSemana} depois=${depoisDeCriar.backlogFechadasNaSemana}`)

  secao("E10 · A FOTO — grava, idempotente por dia, nunca duplica")

  const g1 = await gravarIndicadoresDoDia(agora)
  const contagemAposPrimeiraGravacao = await prisma.torreIndicadorDiario.count()
  ok("grava a foto do dia", contagemAposPrimeiraGravacao === 1)
  ok("a foto guarda os mesmos números calculados", g1.indicadores.vencidas === depoisDeCriar.vencidas)

  // Reexecutar no MESMO dia operacional deve ATUALIZAR, nunca duplicar.
  await prisma.tarefa.create({ data: { titulo: `${MARCA}mais-uma-vencida`, statusTarefa: "NAO_INICIADA", dataPrazo: new Date(agora.getTime() - 1 * 86_400_000) } })
  const g2 = await gravarIndicadoresDoDia(agora)
  const contagemAposSegundaGravacao = await prisma.torreIndicadorDiario.count()
  ok("reexecutar no mesmo dia NÃO duplica a linha (upsert por data)", contagemAposSegundaGravacao === 1)
  ok("mas ATUALIZA o número", g2.indicadores.vencidas === g1.indicadores.vencidas + 1,
    `g1=${g1.indicadores.vencidas} g2=${g2.indicadores.vencidas}`)

  secao("E10 · A SÉRIE — mais recente primeiro, alimenta a tendência")
  const serie = await serieDeIndicadores(14)
  ok("a série devolve a foto de hoje", serie.length === 1 && serie[0]?.data === g1.data)

  await limpar()

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
