// scripts/torre-previsao-soma-fecha-com-abertas.test.ts
// ============================================================================
// TORRE, ABA EQUIPE — A PREVISÃO DE 4 SEMANAS FECHA COM O TOTAL DE ABERTAS (30/09/2026).
//
// Achado real: a previsão somava 19 contra 31 abertas, porque as tarefas SEM PRAZO (e as já vencidas e as de
// depois da 4ª semana) ficavam de fora sem aviso. Agora cada tarefa aberta cai em EXATAMENTE um balde —
// uma das 4 semanas, vencidas, depois, sem prazo — e a soma dos baldes é o total de abertas da pessoa
// (a mesma conta de `ativas`), inclusive na linha "Sem responsável".
//
//   npx tsx scripts/torre-previsao-soma-fecha-com-abertas.test.ts   (banco de teste)
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-previsao-soma-fecha-com-abertas.test.ts")

import { readFileSync } from "node:fs"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { quadroDaEquipe, distribuirNaPrevisao, semanasDaPrevisao } from "../lib/operacional/torre-equipe"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORRE_PREV_SOMA"
const DIA = 86_400_000

async function main() {
  secao("A FUNÇÃO PURA — cada tarefa aberta cai em um balde só")
  const agora = new Date("2026-09-30T15:00:00.000Z")
  const semanas = semanasDaPrevisao(agora)
  const l = (responsavelId: number | null, dias: number | null, estadoOperacao = "FILA") =>
    ({ responsavelId, estadoOperacao, dataPrazo: dias == null ? null : new Date(agora.getTime() + dias * DIA).toISOString() }) as never
  const linhas = [
    l(1, 1), l(1, 8), l(1, 15), l(1, 22),          // uma em cada semana
    l(1, -5), l(1, -40),                            // vencidas
    l(1, 60), l(1, 29),                             // depois da 4ª semana
    l(1, null), l(1, null), l(1, null),             // sem prazo
    l(1, 2, "CONCLUIDA"),                           // concluída nunca conta
    l(2, 3), l(null, null), l(null, 10),            // outra pessoa · sem dono
  ]
  const d = distribuirNaPrevisao(linhas, 1, semanas)
  ok("4 semanas: 1 em cada", JSON.stringify(d.porSemana) === "[1,1,1,1]", JSON.stringify(d.porSemana))
  ok("vencidas = 2 · depois = 2 · sem prazo = 3", d.vencidas === 2 && d.depois === 2 && d.semPrazo === 3, JSON.stringify(d))
  ok("total = 11 abertas (a concluída fica de fora) e a SOMA DOS BALDES FECHA", d.total === 11 && d.porSemana.reduce((a, b) => a + b, 0) + d.vencidas + d.depois + d.semPrazo === d.total)
  const dSem = distribuirNaPrevisao(linhas, null, semanas)
  ok("'Sem responsável': 2 abertas (uma sem prazo, uma na semana 2) e fecha", dSem.total === 2 && dSem.semPrazo === 1 && JSON.stringify(dSem.porSemana) === "[0,1,0,0]")

  secao("NO QUADRO DA EQUIPE (banco) — a linha da previsão fecha com as ativas da pessoa e com a Operação")
  const c = await montarCenario(MARCA)
  try {
    const mk = (nome: string) => prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase()}@t.com`, senha: "x", tipo: "assistente", permissoesCustom: { "tarefas.iniciar_concluir": true, "tarefas.ver": true } } })
    const ana = await mk("Ana")
    const hoje = Date.now()
    const prazos: Array<Date | null> = [new Date(hoje + 2 * DIA), new Date(hoje + 9 * DIA), null, null, new Date(hoje - 4 * DIA), new Date(hoje + 70 * DIA)]
    for (const p of prazos) await c.novaObrigacao({ responsavelId: ana.id, dataPrazo: p })
    await c.novaObrigacao({ dataPrazo: null })                     // sem dono e sem prazo
    await c.novaObrigacao({ dataPrazo: new Date(hoje + 10 * DIA) }) // sem dono, semana 2

    const linhasDaTorre = (await listarTarefasDaTorre()).linhas
    const { pessoas, previsao } = await quadroDaEquipe(linhasDaTorre)
    const pAna = pessoas.find((p) => p.usuarioId === ana.id)!
    const vAna = previsao.linhas.find((x) => x.usuarioId === ana.id)!
    const soma = (x: typeof vAna) => x.porSemana.reduce((s, w) => s + w.n, 0) + x.vencidas + x.depois + x.semPrazo
    ok("Ana: 6 abertas; as 4 semanas somam só 2 (era a soma que 'não fechava')", pAna.ativas === 6 && vAna.porSemana.reduce((s, w) => s + w.n, 0) === 2, JSON.stringify(vAna))
    ok("Ana: vencidas 1 · depois 1 · sem prazo 2", vAna.vencidas === 1 && vAna.depois === 1 && vAna.semPrazo === 2)
    ok("Ana: semanas + vencidas + depois + sem prazo = total = ativas da linha da equipe", soma(vAna) === vAna.total && vAna.total === pAna.ativas)
    ok("TODA linha da previsão fecha (soma dos baldes = total)", previsao.linhas.every((x) => soma(x) === x.total))
    const abertasSemDono = linhasDaTorre.filter((x) => x.responsavelId == null && x.estadoOperacao !== "CONCLUIDA").length
    const vSem = previsao.linhas.find((x) => x.usuarioId === null)!
    ok("'Sem responsável': total = as abertas sem dono da Operação, incluindo as sem prazo", vSem.total === abertasSemDono && vSem.semPrazo >= 1, JSON.stringify({ total: vSem.total, abertasSemDono, semPrazo: vSem.semPrazo }))
    const totalDaTela = previsao.linhas.reduce((s, x) => s + x.total, 0)
    const abertasDaOperacao = linhasDaTorre.filter((x) => x.estadoOperacao !== "CONCLUIDA").length
    const executam = new Set(pessoas.map((p) => p.usuarioId))
    const foraDaAba = linhasDaTorre.filter((x) => x.estadoOperacao !== "CONCLUIDA" && x.responsavelId != null && !executam.has(x.responsavelId)).length
    ok("a soma da tela inteira fecha com as abertas da Operação (menos as de quem não é da aba)", totalDaTela + foraDaAba === abertasDaOperacao, `${totalDaTela} + ${foraDaAba} = ${abertasDaOperacao}`)

    secao("A TELA MOSTRA 'sem prazo (N)' e as colunas que fazem fechar")
    const tela = readFileSync("src/components/torre/TorreEquipe.tsx", "utf8")
    ok("célula 'sem prazo (N)' por pessoa", /sem prazo \(\$\{linha\.semPrazo\}\)/.test(tela))
    ok("colunas Vencidas · Depois · Sem prazo · Abertas no cabeçalho", ["Vencidas", "Depois", "Sem prazo", "Abertas"].every((t) => tela.includes(`>${t}<`) || tela.includes(`<b>${t}</b>`)))
  } finally {
    await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
    await c.limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
