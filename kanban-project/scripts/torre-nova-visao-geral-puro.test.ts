// scripts/torre-nova-visao-geral-puro.test.ts — regras PURAS (frente B1) do funil, da frase do dia e dos detalhes da Situação.
// CONSOLIDAÇÃO 06/10/2026: a Visão geral (TorreVisaoGeral/TorreKpis/TorreFunil) saiu da Torre e virou a aba HOJE (só alarmes). As regras puras
// (lib/operacional/torre-funil-puro.ts, torre-topo.ts, torre-kpis.ts) seguem valendo e são provadas aqui; o que era TELA virou a prova de que
// a tela saiu e de que o número de cada alarme de Hoje = a lista que ele abre.
//   npx tsx scripts/torre-nova-visao-geral-puro.test.ts   (sem banco)
import { existsSync, readFileSync } from "node:fs"
import {
  permanenciasConcluidas, tempoMedioPorFase, textoDaAmostra, maiorGargalo, textoDoGargalo, textoDoTempoMedio, textoDaMeta, estourouAMeta, classeDoFunil,
  funilDasFases, gargaloDaSemana, sentidoDoBacklog, hrefDaFase, textoDaFaseNasPalavras, ESCOPO_VAZIO,
  type LinhaParaGargalo, type DadosDoFunilPorEscopo,
} from "../lib/operacional/torre-funil-puro"
import { fraseDoDia, textoDaFrase, milhar, distribuicaoPorPais, detalheDosTerceiros, familiasSemResponsavel, corDaTendencia, rotuloDecisoes } from "../lib/operacional/torre-topo"
import { ALARMES_DE_HOJE, numeroDoAlarme, linhasDoAlarme, urlDoAlarme } from "../lib/operacional/torre-hoje"
import { CARTOES_DA_AGENDA, CARTOES_DA_SITUACAO, KPI_POR_CHAVE, numeroDoKpi, linhasDoKpi, type LinhaParaKpi } from "../lib/operacional/torre-kpis"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const ler = (p: string) => readFileSync(p, "utf8")
const d = (s: string) => new Date(s)

console.log("tempo médio real = média das permanências CONCLUÍDAS")
const logs = [
  { processoId: 1, faseAtual: "a", fasePretendida: "b", criadoEm: d("2026-01-01T00:00:00Z") },
  { processoId: 1, faseAtual: "b", fasePretendida: "c", criadoEm: d("2026-01-11T00:00:00Z") },   // b: 10 dias
  { processoId: 2, faseAtual: "a", fasePretendida: "b", criadoEm: d("2026-01-01T00:00:00Z") },
  { processoId: 2, faseAtual: "b", fasePretendida: "c", criadoEm: d("2026-01-05T00:00:00Z") },   // b: 4 dias
  { processoId: 3, faseAtual: "a", fasePretendida: "b", criadoEm: d("2026-01-01T00:00:00Z") },   // ainda em b: NÃO entra
]
const t = tempoMedioPorFase(permanenciasConcluidas(logs))
ok("b = média de 10 e 4 = 7 dias, 2 amostras; o processo ainda na fase não entra", t.b.mediaDias === 7 && t.b.amostras === 2)
ok("fase sem permanência concluída não tem tempo", t.a === undefined && t.c === undefined)
ok("entrada de um processo não casa com a saída de outro", permanenciasConcluidas([logs[0], logs[3]]).length === 0)

console.log("\namostra: quantos PROCESSOS entraram na média (a regra da média não mudou)")
ok("a média e as permanências continuam as mesmas; agora b também diz 2 processos distintos", t.b.mediaDias === 7 && t.b.amostras === 2 && t.b.processos === 2)
ok("amostra 0: nenhuma permanência → nenhuma fase, e o texto é —", Object.keys(tempoMedioPorFase([])).length === 0 && textoDoTempoMedio(undefined, null) === "—" && textoDoTempoMedio({ mediaDias: 0, amostras: 0, processos: 0 }, null) === "—")
const um = tempoMedioPorFase(permanenciasConcluidas([
  { processoId: 7, faseAtual: "a", fasePretendida: "b", criadoEm: d("2026-01-01T00:00:00Z") },
  { processoId: 7, faseAtual: "b", fasePretendida: "c", criadoEm: d("2026-01-05T00:00:00Z") },   // 4 dias
]))
ok("amostra 1: '4 dias · 1 processo' (singular)", um.b.processos === 1 && textoDoTempoMedio(um.b, null) === "4 dias · 1 processo", textoDoTempoMedio(um.b, null))
ok("amostra 1, menos de um dia: 'menos de 1 dia · 1 processo'", textoDoTempoMedio({ mediaDias: 0.3, amostras: 1, processos: 1 }, null) === "menos de 1 dia · 1 processo")
ok("vários processos: '7 dias · 2 processos' (plural)", textoDoTempoMedio(t.b, null) === "7 dias · 2 processos" && textoDaAmostra(3) === "3 processos" && textoDaAmostra(1) === "1 processo")
const mesmo = tempoMedioPorFase(permanenciasConcluidas([
  { processoId: 9, faseAtual: "a", fasePretendida: "b", criadoEm: d("2026-01-01T00:00:00Z") },
  { processoId: 9, faseAtual: "b", fasePretendida: "c", criadoEm: d("2026-01-03T00:00:00Z") },   // 1ª passagem: 2 dias
  { processoId: 9, faseAtual: "c", fasePretendida: "b", criadoEm: d("2026-01-10T00:00:00Z") },
  { processoId: 9, faseAtual: "b", fasePretendida: "d", criadoEm: d("2026-01-16T00:00:00Z") },   // 2ª passagem: 6 dias
]))
ok("dois registros do MESMO processo na fase: 2 permanências (amostras) mas 1 processo; média continua 4", mesmo.b.amostras === 2 && mesmo.b.processos === 1 && mesmo.b.mediaDias === 4 && textoDoTempoMedio(mesmo.b, null) === "4 dias · 1 processo", JSON.stringify(mesmo.b))
const doFunil = funilDasFases({ fases: [{ key: "e", label: "Emissão", condicional: false }], processos: [], linhas: [], escopo: { tempos: { e: { mediaDias: 3.9, amostras: 1, processos: 1 } }, metas: { e: null }, semana: { processosAbertos: 0, protocolados: 0, tarefasAbertas: 0, tarefasFechadas: 0 } } })
ok("a linha do funil já traz o texto com a amostra (é o que a tela imprime)", doFunil.linhas[0].tempoTexto === "4 dias · 1 processo", doFunil.linhas[0].tempoTexto)
ok("leitor antigo da rota (sem o campo processos): mostra só a média, como antes", textoDoTempoMedio({ mediaDias: 12.4, amostras: 3 }, 15) === "12 dias")
ok("o componente do funil saiu da Torre (TorreFunil não existe mais); o texto pronto continua vindo da lib pura", !existsSync("src/components/torre/TorreFunil.tsx") && doFunil.linhas[0].tempoTexto === "4 dias · 1 processo")

console.log("\ntexto: tempo, meta, estouro")
ok("sem amostra → —", textoDoTempoMedio(undefined, 30) === "—" && textoDoTempoMedio({ mediaDias: 0, amostras: 0 }, 30) === "—")
ok("12,4 → 12 dias; 1 → 1 dia; 0,3 → menos de 1 dia", textoDoTempoMedio({ mediaDias: 12.4, amostras: 3 }, 15) === "12 dias" && textoDoTempoMedio({ mediaDias: 1, amostras: 1 }, 15) === "1 dia" && textoDoTempoMedio({ mediaDias: 0.3, amostras: 1 }, 15) === "menos de 1 dia")
ok("sem meta e ≥ 90 dias → meses com vírgula (4,1 meses)", textoDoTempoMedio({ mediaDias: 123, amostras: 2 }, null) === "4,1 meses")
ok("com meta, 123 dias continuam em dias", textoDoTempoMedio({ mediaDias: 123, amostras: 2 }, 60) === "123 dias")
ok("meta sem cadastro → —", textoDaMeta(null) === "—" && textoDaMeta(15) === "15 dias")
ok("estouro só com meta numérica e média acima dela (34 > 30; 30 não; sem meta nunca)", estourouAMeta({ mediaDias: 34, amostras: 2 }, 30) && !estourouAMeta({ mediaDias: 30.2, amostras: 2 }, 30) && !estourouAMeta({ mediaDias: 400, amostras: 2 }, null))

console.log("\nbarra: a MESMA palavra de risco do Radar")
ok("ok→ritmo, atencao→atenção, critico/parado→parado", classeDoFunil("ok") === "ritmo" && classeDoFunil("no_ritmo") === "ritmo" && classeDoFunil("atencao") === "atencao" && classeDoFunil("critico") === "parado" && classeDoFunil("parado") === "parado")

console.log("\ngargalo")
const L = (o: Partial<LinhaParaGargalo> = {}): LinhaParaGargalo => ({ faseMacroKey: "e", estadoOperacao: "AGUARDANDO", statusTarefa: "AGUARDANDO_TERCEIRO", esperandoHaDias: 3, passoCorrente: { chave: "x", label: "Aguardar retorno" }, ...o })
const gl = [L(), L({ esperandoHaDias: 40 }), L({ passoCorrente: { chave: "y", label: "Conferir" }, estadoOperacao: "FILA", statusTarefa: "BLOQUEADA" }), L({ estadoOperacao: "FILA", statusTarefa: "EM_ANDAMENTO" }), L({ faseMacroKey: "g" })]
const g = maiorGargalo(gl, "e")
ok("o passo com mais PARADAS na fase (aguardando ou bloqueada); fila normal e outra fase não contam", g?.passo === "Aguardar retorno" && g.paradas === 2 && g.antigas === 1)
ok("texto da coluna e da frase", textoDoGargalo(g) === "2 tarefas em “Aguardar retorno” · 1 há 30+ dias" && textoDoGargalo(null) === "—")
ok("fase sem nada parado → null", maiorGargalo(gl, "zzz") === null)

console.log("\nfunil: total, barra, Σ, fora do funil")
const fases = [{ key: "e", label: "Emissão", condicional: false }, { key: "g", label: "Genealogia", condicional: false }]
const procs = [
  { faseAtual: { key: "e" }, risco: "ok" }, { faseAtual: { key: "e" }, risco: "atencao" }, { faseAtual: { key: "e" }, risco: "critico" }, { faseAtual: { key: "e" }, risco: "ok" },
  { faseAtual: { key: "g" }, risco: "ok" }, { faseAtual: { key: "zz" }, risco: "ok" },
]
const escopo: DadosDoFunilPorEscopo = { tempos: { e: { mediaDias: 34, amostras: 5 } }, metas: { e: 30, g: 15 }, semana: { processosAbertos: 1, protocolados: 0, tarefasAbertas: 5, tarefasFechadas: 2 } }
const f = funilDasFases({ fases, processos: procs, linhas: gl, escopo })
const e = f.linhas[0]
ok("Emissão: 4 processos = 2 no ritmo + 1 atenção + 1 parado; barra proporcional", e.total === 4 && e.ritmo === 2 && e.atencao === 1 && e.parados === 1 && e.pctRitmo === "50.0%" && e.pctAtencao === "25.0%" && e.pctParados === "25.0%")
ok("Emissão estourou (34 > 30), meta 30; Genealogia sem tempo = — e meta 15", e.estourou && e.tempoTexto === "34 dias" && e.metaTexto === "30 dias" && f.linhas[1].tempoTexto === "—" && f.linhas[1].metaTexto === "15 dias" && !f.linhas[1].estourou)
ok("selos 1..N na ordem; total do funil + fora do funil = processos", f.linhas.map((l) => l.n).join() === "1,2" && f.total + f.foraDoFunil === procs.length && f.foraDoFunil === 1)
ok("barra com total 0 não quebra (0.0%)", funilDasFases({ fases, processos: [], linhas: [], escopo: ESCOPO_VAZIO }).linhas[0].pctRitmo === "0.0%")
ok("gargalo da semana = a fase que estourou a meta", gargaloDaSemana(f.linhas)?.key === "e")
ok("sem estouro, a fase com mais parados; sem parados, nenhuma", gargaloDaSemana(funilDasFases({ fases, processos: procs, linhas: [], escopo: ESCOPO_VAZIO }).linhas)?.key === "e" && gargaloDaSemana(funilDasFases({ fases, processos: [procs[0]], linhas: [], escopo: ESCOPO_VAZIO }).linhas) === null)
ok("backlog: cresce / diminui / se mantém", sentidoDoBacklog({ tarefasAbertas: 212, tarefasFechadas: 186 }) === "cresce" && sentidoDoBacklog({ tarefasAbertas: 1, tarefasFechadas: 2 }) === "diminui" && sentidoDoBacklog({ tarefasAbertas: 2, tarefasFechadas: 2 }) === "estavel")
ok("link da fase: ?aba=familias&fase=<chave>, mantendo país e busca", hrefDaFase("emissao_documental") === "/torre?aba=familias&fase=emissao_documental" && hrefDaFase("x", { pais: "italia", q: "bel" }) === "/torre?aba=familias&fase=x&pais=italia&q=bel")
ok("'Fase = etapa do processo (primeira → última)' vem do cadastro", textoDaFaseNasPalavras(fases) === "etapa do processo (Emissão → Genealogia)" && textoDaFaseNasPalavras([]) === "etapa do processo")

console.log("\nfrase do dia")
const gar = f.linhas[0]
const dec = (tipo: string, n: number) => Array.from({ length: n }, () => ({ tipo }))
const fr = textoDaFrase(fraseDoDia({ processos: 500, noRitmo: 453, decisoes: [...dec("SEM_DONO", 14), ...dec("FASE_DEIXADA", 11), ...dec("ESCALADA", 9), ...dec("DIVERGENCIA", 6), ...dec("BLOQUEADA", 4), ...dec("CARGA", 3)], gargalo: gar }))
ok("estrutura do protótipo (500 processos ativos, 453 andando no ritmo, 47 decisões, tipos na ordem)", fr.startsWith("Hoje: 500 processos ativos, 453 andando no ritmo. 47 decisões precisam de você: 14 sem dono, 11 fases deixadas, 9 escaladas de cartório, 6 divergências, 4 bloqueadas, 3 de carga da equipe."), fr)
ok("gargalo: fase, média, meta e 'puxada por'", fr.includes("O gargalo da semana é a fase Emissão (média 34 dias, meta 30), puxada por 2 tarefas em “Aguardar retorno” (1 há mais de 30 dias).") , fr)
const tr = fraseDoDia({ processos: 500, noRitmo: 453, decisoes: dec("SEM_DONO", 1), gargalo: null })
ok("negrito: Hoje:, andando no ritmo, decisões precisam de você, a fase", tr.filter((x) => x.b).map((x) => x.t).join("|") === "Hoje:|453 andando no ritmo|1 decisão precisa de você")
ok("singular e vazio", textoDaFrase(fraseDoDia({ processos: 1, noRitmo: 0, decisoes: [], gargalo: null })) === "Hoje: 1 processo ativo, 0 andando no ritmo. Nenhuma decisão precisa de você." && rotuloDecisoes(1) === "1 decisão" && rotuloDecisoes(47) === "47 decisões")
ok("1 de cada tipo no singular", textoDaFrase(fraseDoDia({ processos: 2, noRitmo: 2, decisoes: ["FASE_DEIXADA", "ESCALADA", "DIVERGENCIA", "BLOQUEADA"].map((tipo) => ({ tipo })), gargalo: null })).includes("1 fase deixada, 1 escalada de cartório, 1 divergência, 1 bloqueada."))
ok("milhar com ponto, sem depender de ICU", milhar(3842) === "3.842" && milhar(96) === "96" && milhar(1000000) === "1.000.000")

console.log("\nSituação: detalhes que fecham com os cartões")
const K = (o: Partial<LinhaParaKpi & { bolaCom: string }>) => ({ processoId: 1, dataPrazo: null, responsavelId: 7, atrasada: false, diasParaPrazo: null, estadoOperacao: "FILA" as const, acompanhamentoVencido: false, escalada: false, faseMacroKey: "x", ...o })
const ls = [K({ estadoOperacao: "AGUARDANDO", bolaCom: "Cartório" }), K({ estadoOperacao: "AGUARDANDO", bolaCom: "Cartório" }), K({ estadoOperacao: "AGUARDANDO", bolaCom: "Cliente" }), K({ estadoOperacao: "AGUARDANDO", bolaCom: "Consulado" }),
  K({ responsavelId: null, processoId: 2 }), K({ responsavelId: null, processoId: 2 }), K({ responsavelId: null, processoId: 3, estadoOperacao: "AGUARDANDO", bolaCom: "Cartório" }), K({})]
const AG = new Date("2026-09-30T15:00:00Z")
ok("terceiros por lado: só quem tem tarefa, na ordem da bola, e a soma é o cartão", detalheDosTerceiros(ls) === "cartório 2 · cliente 1 · consulado 1" && 2 + 1 + 1 === numeroDoKpi("cartorio", ls, AG))
ok("sem responsável: famílias = processos distintos (aguardando sem dono conta aqui)", familiasSemResponsavel(ls) === 2 && numeroDoKpi("ninguem", ls, AG) === 3)
ok("Σ da partição = tarefas abertas", numeroDoKpi("ninguem", ls, AG) + numeroDoKpi("cartorio", ls, AG) + numeroDoKpi("equipe", ls, AG) === numeroDoKpi("abertas", ls, AG))
ok("processos por país, maior primeiro", distribuicaoPorPais([{ pais: "Espanha" }, { pais: "Itália" }, { pais: "Itália" }, { pais: null }]) === "Itália 2 · Espanha 1 · Sem país 1")
ok("tendência: cor é bom/ruim (processos↑ bom; sem responsável↑ ruim; abertas neutra)", corDaTendencia("processos", "up") === "boa" && corDaTendencia("ninguem", "down") === "boa" && corDaTendencia("cartorio", "up") === "ruim" && corDaTendencia("abertas", "up") === "neutra")

console.log("\ncada número de HOJE leva à lista que ele conta (os cartões da Visão geral viraram alarmes)")
ok("o clique vai para ?aba=tarefas&kpi=<chave> ou &visao=<chave>", urlDoAlarme(ALARMES_DE_HOJE.find((a) => a.chave === "atrasadas")!) === "/torre?aba=tarefas&kpi=venc" && urlDoAlarme(ALARMES_DE_HOJE.find((a) => a.chave === "bloqueadas")!) === "/torre?aba=tarefas&visao=bloqueadas")
ok("no máximo seis alarmes, todos com número = tamanho da lista que abrem (mesma função)", ALARMES_DE_HOJE.length <= 6 && ALARMES_DE_HOJE.every((a) => numeroDoAlarme(a, ls as never, AG) === linhasDoAlarme(a, ls as never, AG).length))
ok("todo alarme que abre um KPI usa uma chave aceita na URL (filtra=true)", ALARMES_DE_HOJE.every((a) => a.abre.tipo !== "kpi" || KPI_POR_CHAVE[a.abre.kpi].filtra))
ok("todo cartão da Situação e da Agenda (regras puras) tem número = tamanho da lista filtrada", [...CARTOES_DA_SITUACAO, ...CARTOES_DA_AGENDA].every((k) => numeroDoKpi(k, ls, AG) === linhasDoKpi(k, ls, AG).length))
ok("todo cartão que filtra tem chave aceita na URL (filtra=true) — o resto é a lista inteira", [...CARTOES_DA_SITUACAO, ...CARTOES_DA_AGENDA].every((k) => KPI_POR_CHAVE[k].filtra || k === "abertas"))

console.log("\nestático: a Visão geral saiu; a frase do dia vive em Hoje")
ok("TorreVisaoGeral, TorreKpis e TorreFunil não existem mais", ["TorreVisaoGeral", "TorreKpis", "TorreFunil", "TorreBriefing", "TorreRevisao"].every((f) => !existsSync(`src/components/torre/${f}.tsx`)))
const hoje = ler("src/components/torre/TorreHoje.tsx"), casco = ler("src/components/torre/Torre.tsx")
ok("Hoje mostra a frase do dia (o antigo Briefing) e os números clicáveis; o casco monta a frase com briefingDoDia sobre os MESMOS conjuntos", /data-testid="frase-do-dia"/.test(hoje) && /ALARMES_DE_HOJE\.map/.test(hoje) && /briefingDoDia\(/.test(casco) && /frase=\{textoDoBriefing\}/.test(casco))
ok("sem 'Revisar o dia', 'As 5 palavras da Torre' nem '#pdv' na Torre", ![hoje, casco, ler("src/components/torre/TorreCabecalho.tsx")].map((x) => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")).some((x) => /Revisar o dia|As 5 palavras da Torre|id="pdv"/.test(x)))
ok("sem 'sem histórico' nem 'Com o cartório'/'ninguém' visível em Hoje", !/sem hist[óo]rico|com o cart[óo]rio|sem ningu[ée]m|ningu[é]m/i.test(hoje.replace(/\/\/[^\n]*/g, "")))

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou === 0 ? 0 : 1)
