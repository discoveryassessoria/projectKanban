// scripts/torre-tendencia-vs-semana.test.ts
// ============================================================================
// TORRE NOVA, ETAPA A (01/10/2026) — TENDÊNCIA "vs semana passada" (M4): a foto diária ganhou os totais da Visão geral.
//
//   npx tsx scripts/torre-tendencia-vs-semana.test.ts   (banco de teste)
//
// PROVA:
//   • `tendenciaVsSemana(hoje, fotoSemanaPassada)` é PURA: só devolve tendência de um campo com as DUAS pontas; foto com menos de 7
//     dias (não é "semana passada"), com mais de 10 (já não é comparável), ausente, ou registro ANTIGO sem a coluna (NULL) → sem
//     tendência, nunca estimativa;
//   • a foto diária grava processosAtivos · tarefasAbertas · comEquipe · comCartorio com a MESMA conta dos cartões (e semDono/
//     aguardandoTerceiro continuam onde estavam); reexecutar o cron no dia ATUALIZA, não duplica;
//   • registro antigo (anterior à M4) NUNCA é preenchido depois — nem por gravar a foto de hoje;
//   • `CAMPO_DA_FOTO` liga os cartões Tarefas abertas · Com a equipe · Aguardando terceiros às colunas novas;
//   • a API de tendências devolve a foto de referência com as colunas novas (NULL nas antigas).
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-tendencia-vs-semana.test.ts")

import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { CAMPO_DA_FOTO, tendenciaVsSemana, totaisDaSituacao, numeroDoKpi, type FotoComparavel } from "../lib/operacional/torre-kpis"
import { calcularIndicadoresDoDia, gravarIndicadoresDoDia, serieDeIndicadores } from "../lib/operacional/indicadores-diarios"
import { tendenciasDaTorre } from "../lib/operacional/torre-tendencias"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { processosCriticos, anotarRisco, ONDE_PROCESSO_ATIVO_DA_TORRE } from "../lib/operacional/torre-processos"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREA_TEND"
const DIA = 86_400_000
const dataIso = (d: Date) => d.toISOString().slice(0, 10)

async function main() {
  secao("PURO — só com foto de 7 dias (a 10), e só campo a campo")
  const hoje: FotoComparavel = { data: "2026-10-08", processosAtivos: 112, tarefasAbertas: 3842, comEquipe: 1418, comCartorio: 2328, semDono: 75, vencidas: 61 }
  const foto = (data: string, o: Partial<FotoComparavel> = {}): FotoComparavel => ({ data, processosAtivos: 100, tarefasAbertas: 3800, comEquipe: 1400, comCartorio: 2300, semDono: 96, vencidas: 50, ...o })
  const t = tendenciaVsSemana(hoje, foto("2026-10-01"))
  ok("foto de exatamente 7 dias: tendência de cada campo (+12 processos, −21 sem responsável…)", t.processosAtivos?.delta === 12 && t.processosAtivos.direcao === "up" && t.semDono?.delta === -21 && t.semDono.direcao === "down" && t.comCartorio?.delta === 28 && t.vencidas?.rotulo === "▲ +11 vs semana passada", JSON.stringify(t.processosAtivos))
  ok("o rótulo é o dos cartões ('▼ −21 vs semana passada')", t.semDono?.rotulo === "▼ −21 vs semana passada")
  ok("igual → '= N vs semana passada'", tendenciaVsSemana({ data: "2026-10-08", semDono: 96 }, foto("2026-10-01")).semDono?.direcao === "igual")
  ok("foto de 10 dias ainda vale (limite inclusive)", Object.keys(tendenciaVsSemana(hoje, foto("2026-09-28"))).length > 0)
  ok("foto de 6 dias NÃO é 'semana passada' → nada", Object.keys(tendenciaVsSemana(hoje, foto("2026-10-02"))).length === 0)
  ok("foto de 11 dias já não é comparável → nada", Object.keys(tendenciaVsSemana(hoje, foto("2026-09-27"))).length === 0)
  ok("sem foto (null/undefined) → nada", Object.keys(tendenciaVsSemana(hoje, null)).length === 0 && Object.keys(tendenciaVsSemana(hoje, undefined)).length === 0)
  const antiga: FotoComparavel = { data: "2026-10-01", semDono: 96, vencidas: 50, processosAtivos: null, tarefasAbertas: null, comEquipe: null, comCartorio: null }
  const tAntiga = tendenciaVsSemana(hoje, antiga)
  ok("foto ANTIGA (colunas novas NULL): sem tendência nos campos novos; os antigos continuam", !("processosAtivos" in tAntiga) && !("tarefasAbertas" in tAntiga) && !("comEquipe" in tAntiga) && !("comCartorio" in tAntiga) && tAntiga.semDono?.delta === -21 && tAntiga.vencidas?.delta === 11)
  ok("hoje sem o campo → sem tendência dele", !("tarefasAbertas" in tendenciaVsSemana({ data: "2026-10-08", semDono: 1 }, foto("2026-10-01"))))
  ok("é função pura: não muda os argumentos", (() => { const h = JSON.stringify(hoje), f = JSON.stringify(foto("2026-10-01")); const f2 = foto("2026-10-01"); tendenciaVsSemana(hoje, f2); return JSON.stringify(hoje) === h && JSON.stringify(f2) === f })())
  ok("CAMPO_DA_FOTO liga Tarefas abertas · Com a equipe · Aguardando terceiros às colunas novas", CAMPO_DA_FOTO.abertas === "tarefasAbertas" && CAMPO_DA_FOTO.equipe === "comEquipe" && CAMPO_DA_FOTO.cartorio === "comCartorio" && CAMPO_DA_FOTO.ninguem === "semDono")

  const c = await montarCenario(MARCA)
  const limpar = async () => { await prisma.torreIndicadorDiario.deleteMany({}); await c.limpar() }
  await prisma.torreIndicadorDiario.deleteMany({})
  try {
    const dono = await prisma.usuario.create({ data: { nome: `${MARCA} Dono`, email: `${MARCA.toLowerCase()}-dono@t.com`, senha: "x", tipo: "assistente" } })
    await c.novaObrigacao({})                                          // sem responsável
    await c.novaObrigacao({ responsavelId: dono.id })                  // com a equipe
    await c.novaObrigacao({ responsavelId: dono.id })                  // com a equipe
    await c.novaObrigacao({ responsavelId: dono.id, aguardando: true }) // aguardando terceiros (com responsável)
    await c.novaObrigacao({ aguardando: true })                        // aguardando, SEM responsável (conta em 'Sem responsável')
    const agora = new Date()

    secao("BANCO — a foto de hoje grava os totais com a MESMA conta dos cartões")
    const { linhas } = await listarTarefasDaTorre({}, agora)
    const criticos = await processosCriticos(agora)
    const doTopo = anotarRisco(linhas, criticos)
    const esperado = totaisDaSituacao(doTopo, agora)
    const g = await gravarIndicadoresDoDia(agora)
    const dia = new Date(agora); dia.setUTCHours(0, 0, 0, 0)
    const linha = await prisma.torreIndicadorDiario.findUniqueOrThrow({ where: { data: dia } })
    ok("tarefasAbertas · comEquipe · comCartorio = os cartões (numeroDoKpi) sobre as linhas da Torre", linha.tarefasAbertas === esperado.tarefasAbertas && linha.comEquipe === esperado.comEquipe && linha.comCartorio === esperado.comCartorio && linha.tarefasAbertas === numeroDoKpi("abertas", doTopo, agora), JSON.stringify({ linha, esperado }))
    ok("a partição fecha na foto: comEquipe + comCartorio + semDono = tarefasAbertas", linha.comEquipe! + linha.comCartorio! + linha.semDono === linha.tarefasAbertas, `${linha.comEquipe}+${linha.comCartorio}+${linha.semDono}=${linha.tarefasAbertas}`)
    ok("os dados da cena: 3 com a equipe? 1 aguardando terceiros (com responsável), 2 sem responsável (uma delas aguardando)", linha.comCartorio === 1 && linha.semDono === 2 && linha.comEquipe === 2 && linha.tarefasAbertas === 5)
    ok("aguardandoTerceiro (com OU sem dono) segue sendo outra conta: 2", linha.aguardandoTerceiro === 2)
    ok("processosAtivos = processos não concluídos e não pausados (a lista do Radar/Processos)", linha.processosAtivos === (await prisma.processo.count({ where: ONDE_PROCESSO_ATIVO_DA_TORRE })) && linha.processosAtivos === 5)
    ok("gravarIndicadoresDoDia devolve os mesmos números", g.indicadores.tarefasAbertas === 5 && g.indicadores.processosAtivos === 5)

    secao("BANCO — reexecutar o cron no dia ATUALIZA, nunca duplica")
    await c.novaObrigacao({ responsavelId: dono.id })
    await gravarIndicadoresDoDia(agora)
    ok("uma linha só, com o novo total", (await prisma.torreIndicadorDiario.count()) === 1 && (await prisma.torreIndicadorDiario.findUniqueOrThrow({ where: { data: dia } })).tarefasAbertas === 6)

    secao("BANCO — registro ANTIGO nunca é preenchido depois")
    const diaAntigo = new Date(dia.getTime() - 8 * DIA)
    await prisma.torreIndicadorDiario.create({ data: { data: diaAntigo, vencidas: 3, vencemEm7Dias: 4, semDono: 9, aguardandoTerceiro: 7, cobrancasPendentes: 1, escaladas: 0, emRisco: 2, backlogAbertas: 10, backlogFechadasNaSemana: 8 } })
    await gravarIndicadoresDoDia(agora)
    const velha = await prisma.torreIndicadorDiario.findUniqueOrThrow({ where: { data: diaAntigo } })
    ok("a foto antiga segue com as 4 colunas novas NULL (a gravação de hoje não faz backfill)", velha.processosAtivos === null && velha.tarefasAbertas === null && velha.comEquipe === null && velha.comCartorio === null)
    const serie = await serieDeIndicadores(30)
    ok("a série traz null nas antigas e número na de hoje", serie.find((x) => x.data === dataIso(diaAntigo))?.tarefasAbertas === null && serie.find((x) => x.data === dataIso(dia))?.tarefasAbertas === 6)

    secao("A API de tendências: a referência com as colunas novas; sem tendência onde é NULL")
    const tend = await tendenciasDaTorre(agora)   // a foto antiga tem 8 dias
    ok("a foto antiga (8 dias) é a referência", tend.referencia?.data === dataIso(diaAntigo) && tend.fotosNaSerie >= 2)
    const hojeParaComparar: FotoComparavel = { data: dataIso(agora), tarefasAbertas: 9, processosAtivos: 7, semDono: 4, vencidas: 1 }
    const tv = tendenciaVsSemana(hojeParaComparar, tend.referencia as unknown as FotoComparavel)
    ok("só os campos antigos têm tendência; os novos NÃO (a foto de referência é anterior à M4)", tv.semDono?.delta === -5 && tv.vencidas?.delta === -2 && !("tarefasAbertas" in tv) && !("processosAtivos" in tv))
    // E com uma foto de 7 dias JÁ com as colunas novas, a tendência aparece.
    const dia7 = new Date(dia.getTime() - 7 * DIA)
    await prisma.torreIndicadorDiario.create({ data: { data: dia7, vencidas: 0, vencemEm7Dias: 0, semDono: 1, aguardandoTerceiro: 0, cobrancasPendentes: 0, escaladas: 0, emRisco: 0, backlogAbertas: 0, backlogFechadasNaSemana: 0, processosAtivos: 3, tarefasAbertas: 4, comEquipe: 2, comCartorio: 1 } })
    const tend2 = await tendenciasDaTorre(agora)
    const tv2 = tendenciaVsSemana({ data: dataIso(agora), processosAtivos: 5, tarefasAbertas: 6, comEquipe: 3, comCartorio: 1 }, tend2.referencia as unknown as FotoComparavel)
    ok("com foto de 7 dias que TEM as colunas: +2 processos, +2 tarefas abertas, +1 com a equipe, = aguardando terceiros", tv2.processosAtivos?.delta === 2 && tv2.tarefasAbertas?.delta === 2 && tv2.comEquipe?.delta === 1 && tv2.comCartorio?.direcao === "igual", JSON.stringify(tv2))
  } finally {
    await limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
