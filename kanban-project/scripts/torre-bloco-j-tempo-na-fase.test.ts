// scripts/torre-bloco-j-tempo-na-fase.test.ts
// ============================================================================
// TORRE DE CONTROLE, BLOCO J (correção 30/09/2026) — "há quanto tempo na fase" nunca finge.
//
//   npx tsx scripts/torre-bloco-j-tempo-na-fase.test.ts   (banco de teste)
//
// O achado: Radar/Foco mostravam "0 d" para as 3 famílias. Os 0 eram REAIS (entradas há < 24 h), mas o texto "0 d"
// não diz isso, e o código só reconhecia MOVIDO como entrada de fase (ignorava AVANCADO/FORCADO) e tomava a abertura
// do processo como entrada em QUALQUER fase. PROVA agora:
//   • sem data real de entrada → `null` e "—" — NUNCA "0 d" e nunca "agora";
//   • antes de fechar 1 dia aparece em HORAS ("5 h"), não "0 d";
//   • AVANCADO/FORCADO/MOVIDO contam como entrada; BLOQUEADO não;
//   • a abertura do processo só vale como entrada quando a fase atual é a PRIMEIRA do macrofluxo;
//   • "Dias na fase" (aba Processos), a célula do Radar e o Foco leem a MESMA função; E11 usa o mesmo conjunto de resultados.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-bloco-j-tempo-na-fase.test.ts")

import { readFileSync } from "node:fs"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { diasNaFaseAtual, tempoMedioRealPorFase, RESULTADOS_QUE_MOVEM_DE_FASE } from "../lib/operacional/metricas-processo"
import { textoTempoNaFase } from "../lib/operacional/torre-predicados"
import { processosDaTorre } from "../lib/operacional/torre-processos"
import { focoDaFamilia } from "../lib/operacional/torre-foco"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREJT"
const H = 3_600_000

async function main() {
  const c = await montarCenario(MARCA)
  try {
    secao("O texto: '—' sem data; horas antes de 1 dia; nunca '0 d'")
    ok("sem data → '—'", textoTempoNaFase(null) === "—" && textoTempoNaFase({ dias: null, horas: null }) === "—" && textoTempoNaFase({ dias: 0, horas: null }) === "—")
    ok("menos de 1 h → 'menos de 1 hora'; 1 h → '1 hora'; 5 h → '5 horas'; 23 h → '23 horas'", textoTempoNaFase({ dias: 0, horas: 0 }) === "menos de 1 hora" && textoTempoNaFase({ dias: 0, horas: 1 }) === "1 hora" && textoTempoNaFase({ dias: 0, horas: 5 }) === "5 horas" && textoTempoNaFase({ dias: 0, horas: 23 }) === "23 horas")
    ok("1 dia ou mais → 'N dias' (singular com 1)", textoTempoNaFase({ dias: 1, horas: 26 }) === "1 dia" && textoTempoNaFase({ dias: 9, horas: 220 }) === "9 dias")
    ok("NENHUMA combinação com dia zero produz '0 d'", [null, 0, 1, 5, 23].every((h) => textoTempoNaFase({ dias: 0, horas: h }) !== "0 d" && textoTempoNaFase({ dias: 0, horas: h }) !== "0 dias"))
    ok("os resultados que movem de fase são MOVIDO, AVANCADO e FORCADO (BLOQUEADO não)", JSON.stringify([...RESULTADOS_QUE_MOVEM_DE_FASE]) === '["MOVIDO","AVANCADO","FORCADO"]')

    // ── um macrofluxo com a fixture como PRIMEIRA fase e 'emissao_documental' depois ──
    const macro = await prisma.macroWorkflow.findFirstOrThrow({ where: { tipoProcessoId: c.tipoId }, select: { id: true } })
    await prisma.faseMacro.upsert({ where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: "emissao_documental" } }, update: { ordem: 2 }, create: { macroWorkflowId: macro.id, phaseKey: "emissao_documental", label: "emissao_documental", ordem: 2 } })
    await prisma.faseMacro.upsert({ where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: "apostilamento" } }, update: { ordem: 3 }, create: { macroWorkflowId: macro.id, phaseKey: "apostilamento", label: "apostilamento", ordem: 3 } })
    const agora = new Date()

    secao("PRIMEIRA fase do macrofluxo: a abertura do processo vale (ele nasceu nela) — com horas reais")
    const a = await c.novaObrigacao({})
    await prisma.processo.update({ where: { id: a.processoId }, data: { dataInicio: new Date(agora.getTime() - 30 * H) } })
    const da = await diasNaFaseAtual(a.processoId, agora)
    ok("origem CADASTRO_DO_PROCESSO, 30 h = 1 dia completo", da.origem === "CADASTRO_DO_PROCESSO" && da.horas === 30 && da.dias === 1 && textoTempoNaFase(da) === "1 dia")
    await prisma.processo.update({ where: { id: a.processoId }, data: { dataInicio: new Date(agora.getTime() - 5 * H) } })
    const da5 = await diasNaFaseAtual(a.processoId, agora)
    ok("entrou há 5 h: dias=0 mas o texto é '5 h' (não '0 d')", da5.dias === 0 && da5.horas === 5 && textoTempoNaFase(da5) === "5 horas")

    secao("fase que NÃO é a primeira e SEM nenhum registro de entrada: sem data, sem número")
    const b = await c.novaObrigacao({})
    await prisma.processo.update({ where: { id: b.processoId }, data: { faseAtualKey: "emissao_documental", dataInicio: new Date(agora.getTime() - 400 * H) } })
    const db = await diasNaFaseAtual(b.processoId, agora)
    ok("a abertura do processo NÃO vale como entrada numa fase que não é a primeira → desde/dias/horas = null", db.desde === null && db.dias === null && db.horas === null && db.origem === null, JSON.stringify(db))
    ok("o texto é '—' (nunca '0 d')", textoTempoNaFase(db) === "—")
    await prisma.phaseAdvanceLog.create({ data: { processoId: b.processoId, faseAtual: "genealogia", fasePretendida: "emissao_documental", regrasAvaliadas: [], pendencias: [], resultado: "BLOQUEADO", origem: "teste", correlationId: `${MARCA}-1`, chaveIdempotencia: `${MARCA}-bloq-1`, criadoEm: new Date(agora.getTime() - 3 * H) } })
    ok("um BLOQUEADO (não moveu nada) NÃO conta como entrada", (await diasNaFaseAtual(b.processoId, agora)).desde === null)

    secao("AVANCADO / FORCADO / MOVIDO contam; o mais recente vence")
    let seq = 0
    const log = (processoId: number, resultado: "AVANCADO" | "FORCADO" | "MOVIDO", de: string, para: string, quando: Date) =>
      prisma.phaseAdvanceLog.create({ data: { processoId, faseAtual: de, fasePretendida: para, regrasAvaliadas: [], pendencias: [], resultado, origem: "teste", correlationId: `${MARCA}-${++seq}`, chaveIdempotencia: `${MARCA}-mov-${seq}`, criadoEm: quando } })
    await log(b.processoId, "AVANCADO", "genealogia", "emissao_documental", new Date(agora.getTime() - 50 * H))
    const dAv = await diasNaFaseAtual(b.processoId, agora)
    ok("AVANCADO (como o de 28/09 do 651) é a entrada → 50 h", dAv.origem === "AVANCO_DE_FASE" && dAv.horas === 50 && dAv.dias === 2, JSON.stringify(dAv))
    await log(b.processoId, "FORCADO", "genealogia", "emissao_documental", new Date(agora.getTime() - 20 * H))
    ok("FORCADO mais recente vence → 20 h", (await diasNaFaseAtual(b.processoId, agora)).horas === 20)
    await log(b.processoId, "MOVIDO", "apostilamento", "emissao_documental", new Date(agora.getTime() - 4 * H))
    const dMv = await diasNaFaseAtual(b.processoId, agora)
    ok("MOVIDO ainda mais recente vence → 4 h, texto '4 h'", dMv.horas === 4 && textoTempoNaFase(dMv) === "4 horas")
    ok("a data NUNCA é o relógio de agora (a entrada é sempre anterior)", dMv.desde !== null && Date.parse(dMv.desde) < agora.getTime())

    secao("a aba Processos, o Radar e o Foco leem a MESMA função")
    const { processos } = await processosDaTorre(agora)
    const pb = processos.find((p) => p.processoId === b.processoId)!
    const colunas = (await processosDaTorre(agora)).colunas
    const celula = pb.celulas[colunas.findIndex((x) => x.key === "emissao_documental")]
    ok("Processos: 'Dias na fase' = a função (4 h; dias 0)", pb.naFase.horas === 4 && pb.naFase.dias === 0 && pb.diasNaFase === 0 && textoTempoNaFase(pb.naFase) === "4 horas")
    ok("Radar: a célula da fase atual traz os MESMOS dias/horas", celula.estado === "atual" && celula.dias === pb.naFase.dias && celula.horas === pb.naFase.horas)
    const foco = await focoDaFamilia(b.processoId, agora)
    ok("Foco: os MESMOS valores e a origem", foco!.faseAtual.horas === 4 && foco!.faseAtual.dias === 0 && foco!.faseAtual.origem === "AVANCO_DE_FASE")

    secao("sem data, Processos/Radar/Foco entregam null (a tela mostra '—')")
    const s = await c.novaObrigacao({})
    await prisma.processo.update({ where: { id: s.processoId }, data: { faseAtualKey: "apostilamento" } })
    const rr = await processosDaTorre(agora)
    const ps = rr.processos.find((p) => p.processoId === s.processoId)!
    const cs = ps.celulas[rr.colunas.findIndex((x) => x.key === "apostilamento")]
    ok("Processos: diasNaFase e naFase nulos", ps.diasNaFase === null && ps.naFase.desde === null && ps.naFase.horas === null && textoTempoNaFase(ps.naFase) === "—")
    ok("Radar: a célula atual tem dias/horas nulos → texto '—'", cs.estado === "atual" && (cs.dias ?? null) === null && (cs.horas ?? null) === null && textoTempoNaFase({ dias: cs.dias ?? null, horas: cs.horas ?? null }) === "—")
    const fs = await focoDaFamilia(s.processoId, agora)
    ok("Foco: desde nulo (a tela diz 'sem registro de quando entrou na fase')", fs!.faseAtual.desde === null && fs!.faseAtual.dias === null)

    secao("E11 (tempo médio real por fase) usa o MESMO conjunto de resultados")
    const t = await c.novaObrigacao({})
    await log(t.processoId, "AVANCADO", "genealogia", "analise_documental", new Date(agora.getTime() - 10 * 86_400_000))
    await log(t.processoId, "MOVIDO", "analise_documental", "emissao_documental", new Date(agora.getTime() - 8 * 86_400_000))
    const tm = (await tempoMedioRealPorFase(t.processoId)).find((x) => x.fase === "analise_documental")
    ok("a entrada por AVANCADO e a saída por MOVIDO fecham uma permanência de 2 dias (antes o AVANCADO era ignorado)", tm?.amostras === 1 && tm.mediaDias === 2, JSON.stringify(tm))

    secao("a legenda do Radar não promete o que não existe")
    const radar = readFileSync("src/components/torre/TorreRadar.tsx", "utf8")
    ok("nenhuma regra 'parado 7+ dias' (ela não existe no score — o protótipo só a cita na legenda)", !/parado 7\+/.test(radar))
    // Torre nova: a legenda segue o TEXTO do protótipo; a regra real (pontuação 3 a 5 / 6 ou mais / 15+ dias com cobrança vencida) está na dica de cada pílula.
    ok("a legenda descreve a regra real nas dicas (3 a 5 / 6 ou mais / parado 15+ dias com cobrança vencida)", /Pontuação 3 a 5/.test(radar) && /Pontuação 6 ou mais/.test(radar) && /15\+ dias sem cobrança em dia/.test(radar))
    const ui = ["src/components/torre/TorreRadar.tsx", "src/components/torre/TorreProcessos.tsx", "src/components/torre/ProcessoCabecalho.tsx"].map((p) => readFileSync(p, "utf8"))
    // Torre nova: Radar e Processos formatam por `torre-fase.ts`, que DELEGA a `textoTempoNaFase` (só acrescenta "meses" a partir de 100 d).
    const fase = readFileSync("lib/operacional/torre-fase.ts", "utf8")
    ok("as três telas formatam pelo MESMO textoTempoNaFase (nenhuma monta '{n} d' à mão)", /textoTempoNaFase/.test(fase) && /textoDuracao|textoNaFase|textoDaCelulaAtual/.test(ui[0] + readFileSync("lib/operacional/torre-radar.ts", "utf8")) && /textoNaFase/.test(ui[1]) && ui[2].includes("textoTempoNaFase") && !/\{c\.dias \?\? "—"\} d/.test(ui[0]) && !/diasNaFase\} d/.test(ui[1]))

    secao("Distribuição: Lei da Torre (L4) — a rota só redireciona para a aba Tarefas da Torre")
    const dist = readFileSync("src/app/operacao/distribuicao/page.tsx", "utf8")
    ok("redireciona para /torre?aba=tarefas (a Torre confere a permissão)", /redirect\("\/torre\?aba=tarefas"\)/.test(dist))
  } finally {
    await prisma.phaseAdvanceLog.deleteMany({ where: { correlationId: { startsWith: MARCA } } })
    await c.limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
