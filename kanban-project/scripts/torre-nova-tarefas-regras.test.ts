// scripts/torre-nova-tarefas-regras.test.ts
// ============================================================================
// ABA TAREFAS DA TORRE NOVA (frente E) — as regras PURAS de tela (lib/operacional/torre-tarefas-tela.ts + o filtro "Iniciou").
// Sem banco. `agora` fixo (01/10/2026 12:00 em São Paulo); fuso America/Sao_Paulo.
//   npx tsx scripts/torre-nova-tarefas-regras.test.ts
// Cobre os itens T232–T240, T246–T253, T258–T269, T281–T302, T305–T311, T321–T324 do CHECKLIST-T.
// ============================================================================
import {
  VISOES_DA_TELA, CHAVES_DE_VISAO_DA_TELA, VISOES_ESCONDIDAS, predicadoDaVisao, contagemDaVisao, textoDaBola, textoDoCobrar, textoDoIniciou, casaIniciou,
  passosDaGaveta, resumoDoGrupo, acoesDaLinha, agruparParaTela, paginarGrupos, statusDaLinha, blocoDoFeito, textoConcluidaEm, prazoEraDoFeito, haQuantosDias,
  type LinhaParaVisao,
} from "../lib/operacional/torre-tarefas-tela"
import { aplicarFiltros, filtrosVazios, normalizarFiltros, aplicarFiltrosNaQuery, filtrosDaQuery, filtrosIguais, chipsDoFiltro, type FiltrosTorre } from "../lib/operacional/torre-filtros"
import { limparSpec } from "../lib/operacional/torre-visoes"
import { justificativaValida } from "../src/services/torre-tarefas-justificativa"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${extra}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const AGORA = new Date("2026-10-01T15:00:00.000Z") // 12:00 em SP
const iso = (dias: number, h = 15) => new Date(Date.UTC(2026, 9, 1 + dias, h)).toISOString()

const base = (o: Partial<LinhaParaVisao & Record<string, unknown>> = {}) => ({
  dataPrazo: iso(3), responsavelId: 7, atrasada: false, diasParaPrazo: 3, estadoOperacao: "FILA" as const, acompanhamentoVencido: false, escalada: false,
  faseMacroKey: "emissao_documental", coluna: "A_FAZER", cobravelVencida: false, processoId: 1, ...o,
})

secao("Visões — as oito do protótipo, na ordem, e os mesmos predicados dos cartões")
{
  ok("oito visões na ordem do protótipo", VISOES_DA_TELA.map(([, l]) => l).join("|") === "Todas as abertas|Minhas|Vencidas|Sem responsável|Aguardando terceiros|Cobrar hoje|Bloqueadas|Feito")
  ok("'Acompanhamentos vencidos' sai do segmentado mas segue válida por URL / visão salva", !VISOES_DA_TELA.some(([v]) => v === "acompvenc") && VISOES_ESCONDIDAS.includes("acompvenc") && CHAVES_DE_VISAO_DA_TELA.includes("acompvenc") && limparSpec({ visao: "bloqueadas" }).visao === "bloqueadas" && limparSpec({ visao: "acompvenc" }).visao === "acompvenc")
  const L = [
    base({ responsavelId: 1 }),                                                  // minha, em dia
    base({ responsavelId: 1, dataPrazo: iso(-1), atrasada: true, diasParaPrazo: -1 }), // minha, vencida (ontem)
    base({ responsavelId: null }),                                                 // sem responsável
    base({ estadoOperacao: "AGUARDANDO", coluna: "AGUARDANDO_TERCEIRO", cobravelVencida: true, acompanhamentoVencido: true }), // aguardando + cobrar
    base({ estadoOperacao: "AGUARDANDO", coluna: "AGUARDANDO_TERCEIRO", responsavelId: null }), // sem resp (precedência) 
    base({ coluna: "BLOQUEADA" }),                                                 // bloqueada de verdade
  ]
  const n = (v: Parameters<typeof contagemDaVisao>[0]) => contagemDaVisao(v, L, 1, AGORA)
  ok("Todas = 6 · Minhas = 2 · Vencidas = 1 · Sem responsável = 2 · Aguardando terceiros = 1 · Cobrar hoje = 1 · Bloqueadas = 1", n("todas") === 6 && n("minhas") === 2 && n("vencidas") === 1 && n("semdono") === 2 && n("aguard") === 1 && n("cobranca") === 1 && n("bloqueadas") === 1, [n("todas"), n("minhas"), n("vencidas"), n("semdono"), n("aguard"), n("cobranca"), n("bloqueadas")].join())
  ok("Minhas sem usuário logado = 0 (nunca 'todas')", contagemDaVisao("minhas", L, null, AGORA) === 0)
  ok("espera de terceiro NÃO é Bloqueada (coluna AGUARDANDO_TERCEIRO fica em Aguardando terceiros)", predicadoDaVisao("bloqueadas", 1, AGORA)(L[3]) === false && predicadoDaVisao("aguard", 1, AGORA)(L[3]) === true)
  ok("vencida = prazo antes de HOJE no dia operacional (ontem entra, hoje não)", predicadoDaVisao("vencidas", 1, AGORA)(base({ dataPrazo: iso(-1) })) === true && predicadoDaVisao("vencidas", 1, AGORA)(base({ dataPrazo: iso(0) })) === false)
}

secao("Textos da linha — bola, cobrar em, iniciou")
{
  const nossa = textoDaBola({ bolaCom: "Equipe", bolaDesde: null, terceiroNome: null, esperandoDe: null, estadoOperacao: "FILA" }, AGORA)
  ok("Nossa: só 'Equipe' (sem 'há N d' inventado)", nossa.texto === "Equipe" && nossa.haDias === null && !nossa.comTerceiro)
  const cart = textoDaBola({ bolaCom: "Cartório", bolaDesde: iso(-21), terceiroNome: "Cartório de Caxias do Sul", esperandoDe: "terceiro", estadoOperacao: "AGUARDANDO" }, AGORA)
  ok("com terceiro: o TIPO (Cartório) · há N d; o nome do órgão vai à parte (orgao)", cart.texto === "Cartório · há 21 d" && cart.orgao === "Cartório de Caxias do Sul")
  ok("Cliente: 'Cliente · há 14 d' (nunca o nome do órgão)", textoDaBola({ bolaCom: "Cliente", bolaDesde: iso(-14), terceiroNome: "Cartório X", esperandoDe: "cliente", estadoOperacao: "AGUARDANDO" }, AGORA).texto === "Cliente · há 14 d")
  ok("terceiro sem órgão cadastrado: o rótulo da categoria (Cartório, Tradutor…)", textoDaBola({ bolaCom: "Tradutor", bolaDesde: null, terceiroNome: null, esperandoDe: "terceiro", estadoOperacao: "AGUARDANDO" }, AGORA).texto === "Tradutor")
  ok("sem registro de 'desde quando': sem 'há N d'", textoDaBola({ bolaCom: "Cartório", bolaDesde: null, terceiroNome: "A", esperandoDe: "terceiro", estadoOperacao: "AGUARDANDO" }, AGORA).texto === "Cartório")
  ok("haQuantosDias conta dias CIVIS (21h de ontem = 1 dia) e nunca é negativo", haQuantosDias(iso(-1, 23), AGORA) === 1 && haQuantosDias(iso(2), AGORA) === 0 && haQuantosDias(null, AGORA) === null)

  ok("cobrar: ontem → vermelho", JSON.stringify(textoDoCobrar(iso(-1), AGORA)) === JSON.stringify({ texto: "cobrar: ontem", tom: "vermelho" }))
  ok("cobrar: hoje → âmbar", JSON.stringify(textoDoCobrar(iso(0), AGORA)) === JSON.stringify({ texto: "cobrar: hoje", tom: "ambar" }))
  ok("cobrar: amanhã → cinza · data futura dd/mm cinza · data vencida dd/mm vermelha", textoDoCobrar(iso(1), AGORA)?.texto === "cobrar: amanhã" && textoDoCobrar(iso(7), AGORA)?.texto === "cobrar: 08/10" && textoDoCobrar(iso(7), AGORA)?.tom === "cinza" && textoDoCobrar(iso(-9), AGORA)?.tom === "vermelho" && textoDoCobrar(iso(-9), AGORA)?.texto === "cobrar: 22/09")
  ok("sem cobrarEm: null ('—' na tela)", textoDoCobrar(null, AGORA) === null)

  ok("Iniciou: dd/mm do registro real", textoDoIniciou({ iniciouEm: iso(-22), statusTarefa: "EM_ANDAMENTO" }) === "09/09")
  ok("Iniciou: 'não iniciou' só para NAO_INICIADA; registro antigo sem valor = '—' (nunca inventado)", textoDoIniciou({ iniciouEm: null, statusTarefa: "NAO_INICIADA" }) === "não iniciou" && textoDoIniciou({ iniciouEm: null, statusTarefa: "EM_ANDAMENTO" }) === "—" && textoDoIniciou({ statusTarefa: "AGUARDANDO_TERCEIRO" }) === "—")
}

secao("Filtro 'Iniciou' (iniciouEm) — só considera quem TEM o registro")
{
  const F = (f: Partial<{ iniciou: "hoje" | "semana" | "30dias" | "nao" | null; iniciouDe: string | null; iniciouAte: string | null }>) => ({ iniciou: null, iniciouDe: null, iniciouAte: null, ...f })
  const hoje = { iniciouEm: iso(0, 13), statusTarefa: "EM_ANDAMENTO" }, h3 = { iniciouEm: iso(-3), statusTarefa: "EM_ANDAMENTO" }, h40 = { iniciouEm: iso(-40), statusTarefa: "EM_ANDAMENTO" }
  const antigo = { iniciouEm: null, statusTarefa: "EM_ANDAMENTO" }, nao = { iniciouEm: null, statusTarefa: "NAO_INICIADA" }
  ok("Hoje", casaIniciou(hoje, F({ iniciou: "hoje" }), AGORA) && !casaIniciou(h3, F({ iniciou: "hoje" }), AGORA))
  ok("Esta semana (últimos 7 dias, hoje incluído)", casaIniciou(hoje, F({ iniciou: "semana" }), AGORA) && casaIniciou(h3, F({ iniciou: "semana" }), AGORA) && !casaIniciou(h40, F({ iniciou: "semana" }), AGORA))
  ok("Há mais de 30 dias", casaIniciou(h40, F({ iniciou: "30dias" }), AGORA) && !casaIniciou(h3, F({ iniciou: "30dias" }), AGORA))
  ok("Ainda não iniciou = NAO_INICIADA (estado real); registro antigo sem valor NÃO entra", casaIniciou(nao, F({ iniciou: "nao" }), AGORA) && !casaIniciou(antigo, F({ iniciou: "nao" }), AGORA) && !casaIniciou(h3, F({ iniciou: "nao" }), AGORA))
  ok("registro antigo sem valor nunca casa Hoje / Esta semana / Há mais de 30 dias / Intervalo", ["hoje", "semana", "30dias"].every((k) => !casaIniciou(antigo, F({ iniciou: k as "hoje" }), AGORA)) && !casaIniciou(antigo, F({ iniciouDe: "2026-01-01" }), AGORA))
  ok("Intervalo de/até (inclusivo, dia operacional)", casaIniciou(h3, F({ iniciouDe: "2026-09-28", iniciouAte: "2026-09-28" }), AGORA) && !casaIniciou(h3, F({ iniciouDe: "2026-09-29" }), AGORA) && !casaIniciou(h3, F({ iniciouAte: "2026-09-27" }), AGORA))
  ok("sem filtro: todos passam (inclusive os antigos)", casaIniciou(antigo, F({}), AGORA) && casaIniciou(nao, F({}), AGORA))
  // integra com o filtro geral + URL + visão salva
  const linha = (o: Record<string, unknown>) => ({ responsavelId: 1, dataPrazo: null, criadaEm: null, atribuidaEm: null, familiaNome: "F", processoNome: "F", statusTarefa: "EM_ANDAMENTO", categoriaDoc: null, faseMacroKey: "x", passoCorrente: null, etapaAtual: null,
    terceiroNome: null, prioridade: "MEDIA", atrasada: false, escalada: false, emRisco: false, acompanhamentoVencido: false, acompanhamentoPasso: null, estadoOperacao: "FILA" as const, linhaReta: null, ...o })
  const ls = [linha({ iniciouEm: iso(0, 13) }), linha({ iniciouEm: iso(-40) }), linha({ iniciouEm: null }), linha({ iniciouEm: null, statusTarefa: "NAO_INICIADA" })]
  const f = (x: Partial<FiltrosTorre>) => ({ ...filtrosVazios(), ...x })
  ok("aplicarFiltros: Hoje → 1 · Há mais de 30 dias → 1 · Ainda não iniciou → 1", aplicarFiltros(ls, f({ iniciou: "hoje" }), { usuarioId: 1, agora: AGORA }).mostrando === 1 && aplicarFiltros(ls, f({ iniciou: "30dias" }), { usuarioId: 1, agora: AGORA }).mostrando === 1 && aplicarFiltros(ls, f({ iniciou: "nao" }), { usuarioId: 1, agora: AGORA }).mostrando === 1)
  const comIniciou = f({ iniciou: "semana", iniciouDe: "2026-09-01", iniciouAte: "2026-09-30" })
  const q = aplicarFiltrosNaQuery(new URLSearchParams("aba=tarefas"), comIniciou)
  ok("URL ida e volta (iniciou, iniciou_de, iniciou_ate) e idempotente", filtrosIguais(filtrosDaQuery(q), comIniciou) && q.get("iniciou") === "semana" && q.get("iniciou_de") === "2026-09-01")
  ok("valor inválido na URL é descartado", filtrosDaQuery(new URLSearchParams("iniciou=ontem&iniciou_de=2026-02-31")).iniciou === null && filtrosDaQuery(new URLSearchParams("iniciou_de=2026-02-31")).iniciouDe === null)
  ok("a visão salva guarda o 'Iniciou' (a pergunta, não o resultado)", filtrosIguais(limparSpec({ filtros: comIniciou }).filtros, comIniciou) && filtrosIguais(normalizarFiltros(JSON.parse(JSON.stringify(comIniciou))), comIniciou))
  ok("chip legível quando ativo", chipsDoFiltro(f({ iniciou: "hoje" })).some((c) => c.rotulo === "Iniciou: Hoje"))
}

secao("Status, risco e ações da linha")
{
  ok("A iniciar / Em andamento / Aguardando terceiros / Cancelada com os tons do protótipo", JSON.stringify(["NAO_INICIADA", "EM_ANDAMENTO", "AGUARDANDO_TERCEIRO", "CANCELADA"].map((s) => statusDaLinha({ statusTarefa: s, coluna: "X", esperandoDe: null })))
    === JSON.stringify([{ texto: "A iniciar", tom: "gry" }, { texto: "Em andamento", tom: "blu" }, { texto: "Aguardando terceiros", tom: "amb" }, { texto: "Cancelada", tom: "can" }]))
  ok("Bloqueada de verdade = vermelho; BLOQUEADA só por esperar terceiro = Aguardando (o selo diz o que a tarefa é)", statusDaLinha({ statusTarefa: "BLOQUEADA", coluna: "BLOQUEADA", esperandoDe: null }).tom === "red" && statusDaLinha({ statusTarefa: "BLOQUEADA", coluna: "AGUARDANDO_TERCEIRO", esperandoDe: "terceiro" }).texto === "Aguardando terceiros" && statusDaLinha({ statusTarefa: "AGUARDANDO_CLIENTE", coluna: "AGUARDANDO_TERCEIRO", esperandoDe: "cliente" }).texto === "Aguardando cliente")
  const A = (o: Record<string, unknown>) => acoesDaLinha({ statusTarefa: "NAO_INICIADA", coluna: "A_FAZER", responsavelId: 1, esperandoDe: null, estadoOperacao: "FILA", aIniciarEfetivo: false, podeIniciar: false, temAcompanhamento: false, acaoPadrao: "Abrir", ...o } as never).join(" / ")
  ok("cancelada: só 'Ver motivo'", A({ statusTarefa: "CANCELADA" }) === "Ver motivo")
  ok("sem responsável a iniciar: Atribuir / Iniciar (e Atribuir / Abrir se não pode iniciar)", A({ responsavelId: null, aIniciarEfetivo: true, podeIniciar: true }) === "Atribuir / Iniciar" && A({ responsavelId: null, aIniciarEfetivo: true, podeIniciar: false }) === "Atribuir / Abrir")
  ok("aguardando terceiros: Cobrar / Adiar (Adiar só com acompanhamento)", A({ esperandoDe: "terceiro", estadoOperacao: "AGUARDANDO", temAcompanhamento: true }) === "Cobrar / Adiar" && A({ esperandoDe: "terceiro", estadoOperacao: "AGUARDANDO" }) === "Cobrar / Abrir")
  ok("aguardando cliente: Cobrar cliente / Desbloquear (bloqueada) ou Abrir", A({ esperandoDe: "cliente", estadoOperacao: "AGUARDANDO", statusTarefa: "BLOQUEADA", coluna: "BLOQUEADA" }) === "Cobrar cliente / Desbloquear" && A({ esperandoDe: "cliente", estadoOperacao: "AGUARDANDO", statusTarefa: "AGUARDANDO_CLIENTE" }) === "Cobrar cliente / Abrir")
  ok("bloqueada interna: Desbloquear / Abrir · a iniciar com dono: Iniciar / Abrir · recebida a conferir: Conferir / Abrir", A({ coluna: "BLOQUEADA", statusTarefa: "BLOQUEADA" }) === "Desbloquear / Abrir" && A({ aIniciarEfetivo: true, podeIniciar: true }) === "Iniciar / Abrir" && A({ statusTarefa: "EM_ANDAMENTO", acaoPadrao: "Conferir" }) === "Conferir / Abrir" && A({ statusTarefa: "EM_ANDAMENTO" }) === "Abrir")
}

secao("Gaveta — passos reais, resumo do grupo, agrupar/paginar, Feito")
{
  const P = passosDaGaveta([{ titulo: "Solicitar", status: "CONCLUIDO", atual: false, ordem: 1 }, { titulo: "Aguardar", status: "AGUARDANDO", atual: true, ordem: 2 }, { titulo: "Conferir", status: "PENDENTE", atual: false, ordem: 3 }, { titulo: "Validar", status: "PENDENTE", atual: false, ordem: 4 }])
  ok("passo concluído = feito · o corrente = agora · os demais adiante", P.map((p) => p.estado).join() === "feito,agora,adiante,adiante" && P.map((p) => p.n).join() === "1,2,3,4")
  ok("sem passo marcado, o 'agora' é o primeiro que não terminou; sem passos a lista é vazia (nada de exemplo)", passosDaGaveta([{ titulo: "A", status: "CONCLUIDO", atual: false }, { titulo: "B", status: "PENDENTE", atual: false }]).map((p) => p.estado).join() === "feito,agora" && passosDaGaveta([]).length === 0)
  ok("passo cancelado nunca é 'feito'", passosDaGaveta([{ titulo: "A", status: "CANCELADO", atual: false }]).every((p) => p.estado !== "feito"))

  const proc = { pais: "Itália", faseAtual: { label: "Emissão documental" }, tarefasDaFase: { abertas: 11, concluidas: 3, ehCertidao: true }, numeros: { vencidas: 2, semResponsavel: 0 } }
  ok("resumo: País · Fase · X de Y prontas · N vencidas (sem 'sem responsável' quando 0)", resumoDoGrupo(proc, []) === "Itália · Emissão documental · 3 de 14 prontas · 2 vencidas")
  ok("resumo com vencida singular e sem responsável", resumoDoGrupo({ ...proc, numeros: { vencidas: 1, semResponsavel: 12 } }, []) === "Itália · Emissão documental · 3 de 14 prontas · 1 vencida · 12 sem responsável")
  ok("sem o processo carregado, cai no que as linhas sabem (sem inventar 'prontas')", resumoDoGrupo(null, [{ pais: "Espanha", faseAtualDoProcessoLabel: "Retificação", atrasada: true, responsavelId: null }]) === "Espanha · Retificação · 1 vencida · 1 sem responsável")

  const L = (id: number, fam: string, st = "NAO_INICIADA", resp: string | null = "A") => ({ taskId: id, statusTarefa: st, familiaNome: fam, processoNome: fam, responsavelNome: resp, faseAtualDoProcessoLabel: "Emissão documental", faseMacroKey: "e", terceiroNome: null })
  const g = agruparParaTela([L(1, "Antão"), L(2, "Antão", "CANCELADA"), L(3, "Antão"), L(4, "Bertolucci")], "fam")
  ok("grupos na ordem de primeira aparição; a CANCELADA vai para o FIM do grupo (riscada, nunca no meio)", g.map(([k]) => k).join() === "Antão,Bertolucci" && g[0][1].map((l) => l.taskId).join() === "1,3,2")
  ok("agrupar por responsável / fase / sem agrupamento", agruparParaTela([L(1, "A", "X", "Ana"), L(2, "B", "X", null)], "resp").map(([k]) => k).join() === "Ana,Sem responsável" && agruparParaTela([L(1, "A")], "fase")[0][0] === "Emissão documental" && agruparParaTela([L(1, "A"), L(2, "B")], "none").length === 1)
  const gr = Array.from({ length: 5 }, (_, i): [string, number[]] => [`F${i}`, Array.from({ length: i === 2 ? 70 : 20 }, (_, k) => k)])
  const pag = paginarGrupos(gr, 50)
  ok("50 por página, grupo nunca partido; grupo maior que a página fica sozinho", pag.map((p) => p.map(([k]) => k).join("+")).join("|") === "F0+F1|F2|F3+F4" && pag.every((p) => p.length === 1 || p.reduce((s, [, ls]) => s + ls.length, 0) <= 50))
  ok("sem grupos: nenhuma página", paginarGrupos([], 50).length === 0)

  ok("Feito: Hoje / Ontem / Antes no dia operacional (23:30 de ontem em SP é ontem, não hoje)", blocoDoFeito(iso(0, 13), AGORA) === "hoje" && blocoDoFeito(new Date("2026-10-01T02:30:00Z").toISOString(), AGORA) === "ontem" && blocoDoFeito(iso(-5), AGORA) === "antes" && blocoDoFeito(null, AGORA) === null)
  ok("Concluída em: 'hoje HH:MM' · 'ontem HH:MM' · 'dd/mm'", textoConcluidaEm(new Date("2026-10-01T13:40:00Z").toISOString(), AGORA) === "hoje 10:40" && textoConcluidaEm(new Date("2026-09-30T20:20:00Z").toISOString(), AGORA) === "ontem 17:20" && textoConcluidaEm(iso(-4), AGORA) === "27/09")
  ok("Prazo era: cumprido (verde) / depois do prazo (vermelho) / sem prazo", prazoEraDoFeito(iso(2), iso(0)).cumprido === true && prazoEraDoFeito(iso(-6), iso(-1)).cumprido === false && prazoEraDoFeito(null, iso(0)).cumprido === null && prazoEraDoFeito(iso(-6), iso(-1)).texto === "25/09")
}

secao("Justificativa — mínimo 5 letras depois do trim")
{
  ok("válida a partir de 5 letras", justificativaValida("abcde") === "abcde" && justificativaValida("  abcde  ") === "abcde")
  ok("inválida: 4 letras, só espaços, vazio, não-texto", justificativaValida("abcd") === null && justificativaValida("      ") === null && justificativaValida("") === null && justificativaValida(undefined) === null && justificativaValida(12345) === null)
  ok("limite de 300 caracteres", (justificativaValida("x".repeat(500)) ?? "").length === 300)
}

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
