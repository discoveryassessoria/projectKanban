// scripts/torre-filtros-predicados.test.ts
// ============================================================================
// TORRE — SEÇÃO 3: OS FILTROS DA ABA TAREFAS (30/09/2026). Puro (sem banco): data FIXA, `agora` injetado.
//
//   npx tsx scripts/torre-filtros-predicados.test.ts
//
// PROVA: cada filtro isolado; AND entre filtros e OR dentro do multi-valor; o "Mostrando N de M" e os contadores saem da
// MESMA função que a tabela usa; URL ↔ estado idempotente; visão salva (limparSpec) ida e volta sem quebrar visão antiga;
// estático: a tela liga tudo (chips com ✕, Limpar filtros, Mais filtros, URL, placeholder da busca).
// ============================================================================
import { readFileSync } from "node:fs"
import {
  aplicarFiltros, aplicarFiltrosNaQuery, casaAcomp, casaCobranca, casaPrazo, chipsDoFiltro, contarEmMaisFiltros, contarFiltrosAtivos, contarPorPrazo,
  filtrosDaQuery, filtrosIguais, filtrosParaPares, filtrosVazios, linhaPassa, nivelDeRisco, normalizarFiltros, opcoesDosFiltros,
  ordenarLinhas, removerChip, sugestoesDeFamilia, textoMostrando, CHAVES_URL_FILTROS, PRAZOS_TORRE, type FiltrosTorre, type LinhaParaFiltro,
} from "../lib/operacional/torre-filtros"
import { limparSpec } from "../lib/operacional/torre-visoes"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")

// Segunda-feira 05/10/2026, 12:00 em São Paulo.
const AGORA = new Date("2026-10-05T15:00:00.000Z")
const CTX = { usuarioId: 7, agora: AGORA }
let seq = 0
type L = LinhaParaFiltro & { id: number }
const linha = (o: Partial<LinhaParaFiltro> = {}): L => ({
  id: ++seq, responsavelId: 7, responsavelNome: "Eu Mesma", dataPrazo: "2026-10-20T12:00:00.000Z", criadaEm: "2026-09-20T12:00:00.000Z", atribuidaEm: "2026-09-21T12:00:00.000Z",
  familiaNome: "Santin", processoNome: "Proc Santin", statusTarefa: "EM_ANDAMENTO", categoriaDoc: "NASCIMENTO", faseMacroKey: "emissao_documental",
  passoCorrente: { chave: "solicitar", label: "Solicitar certidão" }, etapaAtual: "Solicitar certidão", orgaoId: 10, terceiroNome: "Cartório A", prioridade: "MEDIA",
  atrasada: false, escalada: false, emRisco: false, acompanhamentoVencido: false, acompanhamentoPasso: null, cobravelVencida: false,
  estadoOperacao: "FILA", linhaReta: true, ...o,
})
const ids = (r: { linhas: L[] }) => r.linhas.map((l) => l.id).sort((a, b) => a - b)
const F = (o: Partial<FiltrosTorre>): FiltrosTorre => ({ ...filtrosVazios(), ...o })
const so = (linhas: L[], f: Partial<FiltrosTorre>) => aplicarFiltros(linhas, F(f), CTX)

// ═══ 3.1 Responsável ═══
secao("3.1 Responsável — pessoas, 'Eu' e 'Sem responsável' (responsavelId)")
{
  const eu = linha({ responsavelId: 7 }), outra = linha({ responsavelId: 9, responsavelNome: "Outra" }), sem = linha({ responsavelId: null, responsavelNome: null })
  const L3 = [eu, outra, sem]
  ok("'eu' = o usuário da sessão", ids(so(L3, { responsavel: ["eu"] })).join() === String(eu.id))
  ok("'sem' = sem responsável", ids(so(L3, { responsavel: ["sem"] })).join() === String(sem.id))
  ok("id de pessoa", ids(so(L3, { responsavel: ["9"] })).join() === String(outra.id))
  ok("OR dentro do filtro: eu + sem", ids(so(L3, { responsavel: ["eu", "sem"] })).join() === [eu.id, sem.id].sort((a, b) => a - b).join())
  ok("'eu' sem usuário logado não casa com ninguém (nunca com 'sem responsável')", aplicarFiltros(L3, F({ responsavel: ["eu"] }), { usuarioId: null, agora: AGORA }).mostrando === 0)
  ok("vazio = não filtra", so(L3, {}).mostrando === 3)
}

// ═══ 3.2 Prazo ═══
secao("3.2 Prazo — dia operacional (America/Sao_Paulo), `agora` injetável")
{
  const P = (iso: string | null) => linha({ dataPrazo: iso })
  const venc = P("2026-10-02T12:00:00.000Z"), hoje = P("2026-10-05T12:00:00.000Z"), amanha = P("2026-10-06T12:00:00.000Z"), d7 = P("2026-10-12T12:00:00.000Z"), d8 = P("2026-10-13T12:00:00.000Z")
  const d30 = P("2026-11-04T12:00:00.000Z"), d31 = P("2026-11-05T12:00:00.000Z"), sem = P(null)
  const noite = P("2026-10-06T02:00:00.000Z") // 05/10 23:00 em SP → HOJE (não amanhã)
  const todas = [venc, hoje, amanha, d7, d8, d30, d31, sem, noite]
  const q = (f: Partial<FiltrosTorre>) => ids(so(todas, f)).join()
  const de = (...x: L[]) => x.map((l) => l.id).sort((a, b) => a - b).join()
  ok("Vencidas", q({ prazo: ["vencidas"] }) === de(venc))
  ok("Hoje — inclui 23:00 de SP (o dia é o de São Paulo, não o UTC)", q({ prazo: ["hoje"] }) === de(hoje, noite))
  ok("Amanhã", q({ prazo: ["amanha"] }) === de(amanha))
  ok("7 dias = de hoje até +7 (sem vencidas)", q({ prazo: ["7dias"] }) === de(hoje, noite, amanha, d7))
  ok("30 dias = de hoje até +30 (sem vencidas)", q({ prazo: ["30dias"] }) === de(hoje, noite, amanha, d7, d8, d30))
  ok("Sem prazo", q({ prazo: ["sem"] }) === de(sem))
  ok("OR entre os botões: Vencidas + Sem prazo", q({ prazo: ["vencidas", "sem"] }) === de(venc, sem))
  ok("intervalo (inclusivo nas duas pontas, dia de SP)", q({ prazoDe: "2026-10-05", prazoAte: "2026-10-06" }) === de(hoje, noite, amanha))
  ok("só 'de' e só 'até'", q({ prazoDe: "2026-11-04" }) === de(d30, d31) && q({ prazoAte: "2026-10-02" }) === de(venc))
  ok("o intervalo exclui quem não tem prazo", !q({ prazoDe: "2000-01-01" }).includes(String(sem.id)))
  ok("botão + intervalo = AND (Hoje dentro de 06/10 a 12/10 = nada)", q({ prazo: ["hoje"], prazoDe: "2026-10-06", prazoAte: "2026-10-12" }) === "")
  ok("prazo com terceiro continua contando: o filtro só lê dataPrazo (estado AGUARDANDO não muda o resultado)", so([linha({ dataPrazo: "2026-10-02T12:00:00.000Z", estadoOperacao: "AGUARDANDO", statusTarefa: "AGUARDANDO_TERCEIRO" })], { prazo: ["vencidas"] }).mostrando === 1)
  ok("`agora` injetável: no dia seguinte, o que era 'amanhã' vira 'hoje'", casaPrazo(amanha, F({ prazo: ["hoje"] }), new Date("2026-10-06T15:00:00.000Z")) && !casaPrazo(amanha, F({ prazo: ["hoje"] }), AGORA))
  const c = contarPorPrazo(todas, CTX)
  ok("contadores dos botões = a MESMA função (aplicarFiltros com só aquele botão)", PRAZOS_TORRE.every((p) => c[p] === so(todas, { prazo: [p] }).mostrando) && c.vencidas === 1 && c.hoje === 2 && c.sem === 1, JSON.stringify(c))
}

// ═══ 3.3 Quando ═══
secao("3.3 Quando — Criada / Atribuída + intervalo (criadaEm, atribuidaEm); 'Iniciada' omitida")
{
  const a = linha({ criadaEm: "2026-09-10T12:00:00.000Z", atribuidaEm: "2026-09-25T12:00:00.000Z" })
  const b = linha({ criadaEm: "2026-09-30T12:00:00.000Z", atribuidaEm: null })
  const x = [a, b]
  ok("Criada entre 05/09 e 15/09", ids(so(x, { quando: "criada", quandoDe: "2026-09-05", quandoAte: "2026-09-15" })).join() === String(a.id))
  ok("Atribuída a partir de 20/09 (quem nunca foi atribuída não casa)", ids(so(x, { quando: "atribuida", quandoDe: "2026-09-20" })).join() === String(a.id))
  ok("'quando' sem data não restringe", so(x, { quando: "criada" }).mostrando === 2)
  ok("'iniciada' não existe na lista fechada: é descartada (Tarefa.dataInicio não é confiável)", normalizarFiltros({ quando: "iniciada", quandoDe: "2026-09-05" }).quando === null && normalizarFiltros({ quando: "iniciada", quandoDe: "2026-09-05" }).quandoDe === null)
  ok("as datas do 'quando' só valem com o tipo escolhido", normalizarFiltros({ quandoDe: "2026-09-05" }).quandoDe === null)
}

// ═══ 3.5 Família ═══
secao("3.5 Família — contém (sem acento/caixa) + sugestões só de famílias com tarefa aberta")
{
  const s = linha({ familiaNome: "Santin" }), c = linha({ familiaNome: "Cibils Gómez" }), sp = linha({ familiaNome: null, processoNome: "Processo Sem Família" })
  ok("contém, sem acento e sem caixa", ids(so([s, c, sp], { familia: "gomez" })).join() === String(c.id) && ids(so([s, c, sp], { familia: "SANT" })).join() === String(s.id))
  ok("sem família usa o nome do processo (o mesmo rótulo do agrupamento)", ids(so([s, c, sp], { familia: "sem fam" })).join() === String(sp.id))
  ok("sugestões: só o que está nas linhas recebidas (tarefas abertas), filtradas pelo digitado, ordenadas, sem repetir", sugestoesDeFamilia([s, s, c, sp], "san").join("|") === "Santin" && sugestoesDeFamilia([s, s, c, sp], "s").join("|") === "Cibils Gómez|Processo Sem Família|Santin" && sugestoesDeFamilia([s, c], "").join("|") === "Cibils Gómez|Santin")
  ok("família sem tarefa aberta nunca é sugerida", !sugestoesDeFamilia([s], "").includes("Cibils Gómez"))
}

// ═══ 3.6–3.11 ═══
secao("3.6 Status · 3.7 Tipo de certidão · 3.8 Fase · 3.9 Passo · 3.10 Cartório · 3.11 Prioridade")
{
  const a = linha({ statusTarefa: "NAO_INICIADA", categoriaDoc: "CASAMENTO", faseMacroKey: "genealogia", passoCorrente: { chave: "localizar", label: "Localizar registro" }, orgaoId: null, terceiroNome: null, prioridade: "ALTA" })
  const b = linha({ statusTarefa: "AGUARDANDO_TERCEIRO", categoriaDoc: null, faseMacroKey: "emissao_documental", orgaoId: 11, terceiroNome: "Cartório B", prioridade: "URGENTE" })
  const c = linha({ statusTarefa: "EM_ANDAMENTO", categoriaDoc: "OBITO", passoCorrente: null, etapaAtual: "Conferir", orgaoId: 10, prioridade: "BAIXA" })
  const x = [a, b, c]
  const de = (...l: L[]) => l.map((i) => i.id).sort((p, q) => p - q).join()
  ok("status (um e OR de dois)", ids(so(x, { status: ["NAO_INICIADA"] })).join() === de(a) && ids(so(x, { status: ["NAO_INICIADA", "AGUARDANDO_TERCEIRO"] })).join() === de(a, b))
  ok("status: valor fora do mapa único de rótulos é descartado", normalizarFiltros({ status: ["INVENTADO", "NAO_INICIADA"] }).status.join() === "NAO_INICIADA")
  ok("certidão: nascimento/casamento/óbito e 'outro' (categoriaDoc nula)", ids(so(x, { certidao: ["CASAMENTO"] })).join() === de(a) && ids(so(x, { certidao: ["OUTRO"] })).join() === de(b) && ids(so(x, { certidao: ["OBITO", "OUTRO"] })).join() === de(b, c))
  ok("fase (faseMacroKey)", ids(so(x, { fase: ["genealogia"] })).join() === de(a) && ids(so(x, { fase: ["genealogia", "emissao_documental"] })).join() === de(a, b, c))
  ok("passo atual (passoCorrente.label; senão etapaAtual)", ids(so(x, { passo: ["Localizar registro"] })).join() === de(a) && ids(so(x, { passo: ["Conferir"] })).join() === de(c))
  ok("cartório por id e 'sem cartório'", ids(so(x, { orgao: ["11"] })).join() === de(b) && ids(so(x, { orgao: ["sem"] })).join() === de(a) && ids(so(x, { orgao: ["sem", "11"] })).join() === de(a, b))
  ok("prioridade", ids(so(x, { prioridade: ["URGENTE", "ALTA"] })).join() === de(a, b))
}

// ═══ 3.12 Risco ═══
secao("3.12 Risco — o MESMO nível da coluna Risco (nivelDeRisco; riscoDe lê dele)")
{
  const crit = linha({ atrasada: true }), esc = linha({ escalada: true }), att = linha({ emRisco: true }), acv = linha({ acompanhamentoVencido: true }), blq = linha({ statusTarefa: "BLOQUEADA" }), rit = linha()
  ok("crítico = atrasada ou escalada; atenção = em risco, acompanhamento vencido ou bloqueada; senão no ritmo", [crit, esc].every((l) => nivelDeRisco(l) === "critico") && [att, acv, blq].every((l) => nivelDeRisco(l) === "atencao") && nivelDeRisco(rit) === "ritmo")
  const x = [crit, esc, att, acv, blq, rit]
  ok("filtro por nível", so(x, { risco: ["critico"] }).mostrando === 2 && so(x, { risco: ["atencao"] }).mostrando === 3 && so(x, { risco: ["ritmo"] }).mostrando === 1 && so(x, { risco: ["critico", "atencao"] }).mostrando === 5)
  const tipos = ler("src/components/torre/tipos.ts")
  ok("a coluna Risco (riscoDe) chama nivelDeRisco — uma regra, não duas", /nivelDeRisco\(l\)/.test(tipos) && !/l\.atrasada \|\| l\.escalada/.test(tipos))
}

// ═══ 3.13–3.15 ═══
secao("3.13 Linha reta · 3.14 Acompanhamento · 3.15 Cobrança")
{
  const reta = linha({ linhaReta: true }), conj = linha({ linhaReta: false }), nula = linha({ linhaReta: null })
  ok("só linha reta: linhaReta === true (cônjuge e desconhecido ficam de fora)", ids(so([reta, conj, nula], { linhaReta: true })).join() === String(reta.id) && so([reta, conj, nula], {}).mostrando === 3)
  const venc = linha({ acompanhamentoVencido: true, acompanhamentoPasso: { dueAt: "2026-10-01T12:00:00.000Z", semPrazo: false } })
  const em2 = linha({ acompanhamentoPasso: { dueAt: "2026-10-07T12:00:00.000Z", semPrazo: false } })
  const em3 = linha({ acompanhamentoPasso: { dueAt: "2026-10-08T12:00:00.000Z", semPrazo: false } })
  const em4 = linha({ acompanhamentoPasso: { dueAt: "2026-10-09T12:00:00.000Z", semPrazo: false } })
  const sem1 = linha({ acompanhamentoPasso: null }), sem2 = linha({ acompanhamentoPasso: { dueAt: null, semPrazo: true } })
  const x = [venc, em2, em3, em4, sem1, sem2]
  const de = (...l: L[]) => l.map((i) => i.id).sort((p, q) => p - q).join()
  ok("vencido = acompanhamentoVencido", ids(so(x, { acomp: ["vencido"] })).join() === de(venc))
  ok("3 dias = ainda não venceu e cai de hoje a +3 dias (não repete o vencido nem o de 4 dias)", ids(so(x, { acomp: ["3dias"] })).join() === de(em2, em3))
  ok("sem acompanhamento = sem data de acompanhamento (nula ou semPrazo)", ids(so(x, { acomp: ["sem"] })).join() === de(sem1, sem2))
  ok("OR: vencido + sem", ids(so(x, { acomp: ["vencido", "sem"] })).join() === de(venc, sem1, sem2))
  ok("casaAcomp é puro e recebe `agora`", casaAcomp(em2, ["3dias"], AGORA) && !casaAcomp(em2, ["3dias"], new Date("2026-10-20T15:00:00.000Z")))
  const cv = linha({ cobravelVencida: true }), esc = linha({ escalada: true }), nada = linha()
  ok("cobrança vencida = cobravelVencida; sem resposta = escalada (≥ 2 cobranças sem resposta)", ids(so([cv, esc, nada], { cobranca: ["vencida"] })).join() === String(cv.id) && ids(so([cv, esc, nada], { cobranca: ["semresposta"] })).join() === String(esc.id) && so([cv, esc, nada], { cobranca: ["vencida", "semresposta"] }).mostrando === 2)
  ok("sem `cobravelVencida` na linha, cai no predicado único ehCobravelVencido (não na Genealogia)", casaCobranca({ acompanhamentoVencido: true, faseMacroKey: "emissao_documental", estadoOperacao: "AGUARDANDO", escalada: false }, ["vencida"]) && !casaCobranca({ acompanhamentoVencido: true, faseMacroKey: "genealogia", estadoOperacao: "AGUARDANDO", escalada: false }, ["vencida"]))
}

// ═══ 3.16 Ordenar ═══
secao("3.16 Ordenar por — prazo · risco · família · responsável · criação")
{
  const a = linha({ dataPrazo: "2026-10-10T12:00:00.000Z", familiaNome: "Zeta", responsavelNome: "Bia", criadaEm: "2026-09-01T12:00:00.000Z" })
  const b = linha({ dataPrazo: "2026-10-03T12:00:00.000Z", familiaNome: "Alfa", responsavelNome: "Ana", criadaEm: "2026-09-15T12:00:00.000Z", atrasada: true })
  const c = linha({ dataPrazo: null, familiaNome: "Mira", responsavelId: null, responsavelNome: null, criadaEm: null })
  const d = linha({ dataPrazo: "2026-10-04T12:00:00.000Z", familiaNome: "Beta", responsavelNome: "Caio", criadaEm: "2026-09-20T12:00:00.000Z", emRisco: true })
  const x = [a, b, c, d]
  const ord = (o: Parameters<typeof ordenarLinhas>[1]) => ordenarLinhas(x, o).map((l) => l.id)
  ok("prazo: o mais próximo primeiro, sem prazo por último", ord("prazo").join() === [b, d, a, c].map((l) => l.id).join())
  ok("risco: crítico, atenção, no ritmo (empate pelo prazo)", ord("risco").join() === [b, d, a, c].map((l) => l.id).join())
  ok("família: A→Z", ord("familia").join() === [b, d, c, a].map((l) => l.id).join())
  ok("responsável: A→Z, sem responsável por último", ord("responsavel").join() === [b, a, d, c].map((l) => l.id).join())
  ok("criação: mais recentes primeiro, sem data por último", ord("criacao").join() === [d, b, a, c].map((l) => l.id).join())
  ok("ordenar não muda o conjunto e não altera o array de entrada; null mantém a ordem recebida", ordenarLinhas(x, null) === x && x[0] === a && ord("prazo").length === 4)
  ok("a ordenação entra no aplicarFiltros (a tabela e o Fazer agora leem a mesma ordem)", aplicarFiltros(x, F({ ordenar: "prazo" }), CTX).linhas.map((l) => l.id).join() === ord("prazo").join())
}

// ═══ COMBINADOS ═══
secao("Todos os filtros combinados — AND entre filtros, OR dentro de cada um")
{
  const alvo = linha({ responsavelId: 7, dataPrazo: "2026-10-06T12:00:00.000Z", criadaEm: "2026-09-20T12:00:00.000Z", familiaNome: "Santin", statusTarefa: "AGUARDANDO_TERCEIRO", categoriaDoc: "CASAMENTO", faseMacroKey: "emissao_documental",
    passoCorrente: { chave: "aguardar", label: "Aguardar retorno" }, orgaoId: 10, prioridade: "ALTA", atrasada: false, escalada: true, linhaReta: true, estadoOperacao: "AGUARDANDO",
    acompanhamentoVencido: true, acompanhamentoPasso: { dueAt: "2026-10-01T12:00:00.000Z", semPrazo: false }, cobravelVencida: true })
  const tudo: FiltrosTorre = {
    responsavel: ["eu", "9"], prazo: ["amanha", "sem"], prazoDe: "2026-10-01", prazoAte: "2026-10-30", quando: "criada", quandoDe: "2026-09-01", quandoAte: "2026-09-30", familia: "sant",
    status: ["AGUARDANDO_TERCEIRO", "NAO_INICIADA"], certidao: ["CASAMENTO"], fase: ["emissao_documental"], passo: ["Aguardar retorno"], orgao: ["10", "sem"], prioridade: ["ALTA", "URGENTE"],
    risco: ["critico"], linhaReta: true, acomp: ["vencido"], cobranca: ["vencida", "semresposta"], ordenar: "prazo",
  }
  ok("uma linha que satisfaz os 15 filtros ao mesmo tempo passa", linhaPassa(alvo, tudo, CTX) && aplicarFiltros([alvo], tudo, CTX).mostrando === 1)
  // Quebra UM filtro de cada vez: a linha tem de sair (AND).
  const quebras: Array<[string, Partial<L>]> = [
    ["responsável", { responsavelId: 3 }], ["prazo", { dataPrazo: "2026-10-20T12:00:00.000Z" }], ["quando", { criadaEm: "2026-08-01T12:00:00.000Z" }], ["família", { familiaNome: "Outra" }],
    ["status", { statusTarefa: "EM_ANDAMENTO" }], ["certidão", { categoriaDoc: "OBITO" }], ["fase", { faseMacroKey: "genealogia" }], ["passo", { passoCorrente: { chave: "x", label: "Outro passo" } }],
    ["cartório", { orgaoId: 99 }], ["prioridade", { prioridade: "BAIXA" }], ["risco", { escalada: false }], ["linha reta", { linhaReta: false }], ["acompanhamento", { acompanhamentoVencido: false }],
    ["cobrança", { cobravelVencida: false, escalada: false }],
  ]
  for (const [nome, q] of quebras) ok(`quebrar só o filtro "${nome}" tira a linha (AND)`, !linhaPassa({ ...alvo, ...q } as LinhaParaFiltro, tudo, CTX))
  ok("o intervalo de prazo também é AND com os botões", !linhaPassa({ ...alvo, dataPrazo: "2026-11-20T12:00:00.000Z" }, { ...tudo, prazo: [] }, CTX))
  ok("filtros vazios não filtram nem ordenam", aplicarFiltros([alvo, linha()], filtrosVazios(), CTX).mostrando === 2)
  // A regra de família/AND sobre conjunto: cada filtro isolado só pode AUMENTAR ou manter o conjunto se removido.
  const conjunto = [alvo, linha(), linha({ responsavelId: null }), linha({ statusTarefa: "NAO_INICIADA" })]
  const n = aplicarFiltros(conjunto, { ...tudo, ordenar: null }, CTX).mostrando
  ok("tirar um filtro inteiro (✕ sem valor) nunca diminui o resultado (monotonia do AND)", chipsDoFiltro(tudo).filter((c) => c.chave !== "ordenar").every((c) => aplicarFiltros(conjunto, removerChip({ ...tudo, ordenar: null }, { chave: c.chave, valor: null }), CTX).mostrando >= n))
  ok("o ✕ de um valor tira SÓ aquele valor do OR; o último valor tira o filtro", removerChip(tudo, { chave: "status", valor: "NAO_INICIADA" }).status.join() === "AGUARDANDO_TERCEIRO" && removerChip(F({ risco: ["critico"] }), { chave: "risco", valor: "critico" }).risco.length === 0 && removerChip(tudo, { chave: "prazoDe", valor: null }).prazoAte === null)
}

// ═══ MOSTRANDO N DE M ═══
secao("'Mostrando N de M' e contadores — a MESMA função da tabela")
{
  const x = Array.from({ length: 10 }, (_, i) => linha({ responsavelId: i < 4 ? 7 : 9, dataPrazo: i < 2 ? "2026-10-02T12:00:00.000Z" : "2026-10-25T12:00:00.000Z" }))
  const r = aplicarFiltros(x, F({ responsavel: ["eu"], prazo: ["vencidas"] }), CTX)
  ok("N = linhas que a tabela desenha; M = lista recebida", r.mostrando === 2 && r.linhas.length === 2 && r.total === 10)
  ok("o texto sai do mesmo objeto", textoMostrando(r) === "Mostrando 2 de 10")
  ok("sem filtro: N = M", textoMostrando(aplicarFiltros(x, filtrosVazios(), CTX)) === "Mostrando 10 de 10")
  const t = ler("src/components/torre/TorreTarefas.tsx"), f = ler("src/components/torre/TorreFiltros.tsx")
  ok("estático: a tabela (visiveis) e o texto leem `resumo` — o resultado de UM aplicarFiltros", /const resumo = useMemo\(\(\) => aplicarFiltros\(listaBase, filtros, ctxFiltro\)/.test(t) && /const l = resumo\.linhas/.test(t) && /mostrando=\{resumo\.mostrando\}/.test(t) && /textoMostrando\(\{ mostrando, total \}\)/.test(f))
  const torre = ler("src/components/torre/Torre.tsx")
  ok("estático: o número da aba Tarefas também passa por aplicarFiltros", /const nTarefas = aplicarFiltros\(/.test(torre))
}

// ═══ URL ═══
secao("URL ↔ estado — parse/serialize idempotente, compartilhável")
{
  const f = F({
    responsavel: ["eu", "9"], prazo: ["hoje", "7dias"], prazoDe: "2026-10-01", prazoAte: "2026-10-31", quando: "atribuida", quandoDe: "2026-09-01", quandoAte: "2026-09-30", familia: "Cibils Gómez",
    status: ["NAO_INICIADA"], certidao: ["NASCIMENTO", "OUTRO"], fase: ["emissao_documental"], passo: ["Aguardar, retorno", "Solicitar certidão"], orgao: ["sem", "10"],
    prioridade: ["ALTA"], risco: ["critico", "atencao"], linhaReta: true, acomp: ["3dias"], cobranca: ["semresposta"], ordenar: "risco",
  })
  const q1 = aplicarFiltrosNaQuery(new URLSearchParams("aba=tarefas&visao=minhas"), f)
  const volta = filtrosDaQuery(q1)
  ok("ida e volta: o estado lido da URL é igual ao que foi escrito (inclusive nome de passo com vírgula)", filtrosIguais(volta, f) && JSON.stringify(volta) === JSON.stringify(normalizarFiltros(f as unknown as Record<string, unknown>)))
  ok("idempotente: serializar → ler → serializar dá a mesma querystring", aplicarFiltrosNaQuery(new URLSearchParams("aba=tarefas&visao=minhas"), volta).toString() === q1.toString())
  ok("não toca em chave que não é de filtro (aba, visao, processo, tarefa, pais, q)", aplicarFiltrosNaQuery(new URLSearchParams("aba=tarefas&processo=651&pais=es&q=x&tarefa=5"), F({ prazo: ["hoje"] })).toString() === "aba=tarefas&processo=651&pais=es&q=x&tarefa=5&prazo=hoje")
  ok("estado vazio remove todas as chaves de filtro da URL", CHAVES_URL_FILTROS.every((k) => !aplicarFiltrosNaQuery(q1, filtrosVazios()).has(k)) && aplicarFiltrosNaQuery(q1, filtrosVazios()).get("aba") === "tarefas")
  ok("só o ativo vai para a URL", filtrosParaPares(F({ risco: ["critico"] })).length === 1 && filtrosParaPares(filtrosVazios()).length === 0)
  const lixo = filtrosDaQuery(new URLSearchParams("prazo=ontem,hoje&risco=x&status=FOO&certidao=NASCIMENTO&prazo_de=2026-02-31&prazo_ate=abc&quando=iniciada&quando_de=2026-01-01&resp=eu,abc,0,12&ordem=nada&orgao=sem,x,7&linha_reta=talvez&prio=ALTA,X"))
  ok("valor fora da lista é descartado, o válido fica", lixo.prazo.join() === "hoje" && lixo.risco.length === 0 && lixo.status.length === 0 && lixo.certidao.join() === "NASCIMENTO" && lixo.prazoDe === null && lixo.prazoAte === null
    && lixo.quando === null && lixo.quandoDe === null && lixo.responsavel.join() === "eu,12" && lixo.ordenar === null && lixo.orgao.join() === "sem,7" && lixo.linhaReta === false && lixo.prioridade.join() === "ALTA", JSON.stringify(lixo))
  ok("limites: lista longa é cortada e texto enorme também", normalizarFiltros({ responsavel: Array.from({ length: 100 }, (_, i) => String(i + 1)) }).responsavel.length === 30 && (normalizarFiltros({ familia: "x".repeat(500) }).familia ?? "").length === 80)
  ok("o estado inicial da tela vem da URL e a URL acompanha o estado (estático)", /lerUrl\(params\)/.test(ler("src/components/torre/Torre.tsx")) && /useState<FiltrosTorre>\(urlInicial\.filtros\)/.test(ler("src/components/torre/Torre.tsx")) && /aplicarFiltrosNaQuery\(q, filtros\)/.test(ler("src/components/torre/Torre.tsx")) && /history\.replaceState/.test(ler("src/components/torre/Torre.tsx")))
  ok("as chaves antigas da URL continuam lidas (aba, kpi, visao, processo, tarefa)", ["aba", "kpi", "visao", "processo", "tarefa"].every((k) => new RegExp(`params\\.get\\("${k}"\\)`).test(ler("src/components/torre/Torre.tsx"))))
}

// ═══ VISÃO SALVA ═══
secao("Visão salva — limparSpec com TODOS os filtros (ida e volta) e visão antiga intacta")
{
  const f = F({
    responsavel: ["eu"], prazo: ["vencidas"], prazoDe: "2026-10-01", prazoAte: "2026-10-31", quando: "criada", quandoDe: "2026-09-01", familia: "Santin", status: ["EM_ANDAMENTO"], certidao: ["CASAMENTO"],
    fase: ["genealogia"], passo: ["Localizar registro"], orgao: ["sem"], prioridade: ["URGENTE"], risco: ["critico"], linhaReta: true, acomp: ["vencido"], cobranca: ["vencida"], ordenar: "prazo",
  })
  const s = limparSpec({ visao: "minhas", agrupar: "resp", dentro: "none", kpi: "venc", pais: "Espanha", busca: "cibils", filtros: f })
  ok("guarda a pergunta completa", s.visao === "minhas" && s.agrupar === "resp" && s.kpi === "venc" && s.pais === "Espanha" && s.busca === "cibils" && filtrosIguais(s.filtros, f))
  const armazenado = JSON.parse(JSON.stringify(s))
  ok("ida e volta por JSON (o que o banco guarda) reproduz os mesmos filtros", filtrosIguais(normalizarFiltros(armazenado.filtros), f) && JSON.stringify(limparSpec(armazenado)) === JSON.stringify(s))
  ok("'eu' é guardado como 'eu' (a pergunta), nunca como o id de quem salvou — a visão compartilhada vale para quem abrir", armazenado.filtros.responsavel.join() === "eu")
  const antiga = limparSpec({ visao: "vencidas", agrupar: "fam", dentro: "pessoa", kpi: null, pais: null, busca: null })
  ok("visão salva ANTES da barra (sem `filtros`) continua válida e vira 'nenhum filtro'", antiga.visao === "vencidas" && antiga.dentro === "pessoa" && filtrosIguais(antiga.filtros, filtrosVazios()))
  const hostil = limparSpec({ filtros: { prazo: ["drop table"], risco: ["x"], status: ["FOO"], quando: "iniciada", responsavel: ["../../etc"], ordenar: "sql", extra: 1 } })
  ok("valor fora da lista fechada é normalizado na visão (e chave desconhecida some)", filtrosIguais(hostil.filtros, filtrosVazios()) && !("extra" in hostil.filtros))
  ok("filtros que não são objeto viram vazio", [null, "x", 3, [1, 2]].every((v) => filtrosIguais(limparSpec({ filtros: v }).filtros, filtrosVazios())))
  ok("contadores dos chips: intervalo conta 1; ordenar não é filtro; 'Mais filtros' conta só os escondidos", contarFiltrosAtivos(f) === chipsDoFiltro(f).length - 1 && contarEmMaisFiltros(f) === 7)
  ok("a visão guarda o estado que a tela aplica: TorreTarefas manda `filtros` no spec e aplica `spec.filtros` ao escolher a visão (estático)", /pais: paisChave \|\| null, busca: busca\.trim\(\) \|\| null, filtros \}/.test(ler("src/components/torre/TorreTarefas.tsx")) && /normalizarFiltros\(spec\.filtros/.test(ler("src/components/torre/TorreTarefas.tsx")))
}

// ═══ OPÇÕES ═══
secao("Opções da barra — só o que existe em tarefa aberta")
{
  const o = opcoesDosFiltros([linha({ responsavelId: 7, responsavelNome: "Ana", orgaoId: 10, terceiroNome: "Cartório A" }), linha({ responsavelId: null, responsavelNome: null, orgaoId: null, terceiroNome: null, statusTarefa: "NAO_INICIADA" })])
  ok("pessoas, cartórios, status, fases e passos vêm das linhas (sem 'sem responsável' inventado)", o.pessoas.length === 1 && o.pessoas[0].nome === "Ana" && o.orgaos.length === 1 && o.status.join() === "EM_ANDAMENTO,NAO_INICIADA" && o.fases.join() === "emissao_documental" && o.passos.join() === "Solicitar certidão")
}

// ═══ TELA ═══
secao("Tela — chips com ✕, Limpar filtros, Mais filtros, chip de nacionalidade, placeholder, 400 px")
{
  const f = ler("src/components/torre/TorreFiltros.tsx"), t = ler("src/components/torre/TorreTarefas.tsx"), css = ler("src/components/torre/torre.css"), cab = ler("src/components/torre/TorreCabecalho.tsx"), torre = ler("src/components/torre/Torre.tsx")
  ok("barra abaixo de Agrupar/Dentro/Visão e escondida no Feito", t.indexOf('aria-label="Dentro da família"') < t.indexOf("<TorreFiltros") && /visao !== "feito" && \(\s*<TorreFiltros/.test(t))
  ok("chips com ✕ (um por valor), 'Limpar filtros' e 'Mostrando N de M'", /aria-label=\{`Remover o filtro \$\{c\.rotulo\}`\}/.test(f) && />Limpar filtros</.test(f) && /textoMostrando/.test(f))
  ok("todo <button> da barra tem onClick (sem botão morto)", [...f.matchAll(/<button\b[^>]*>/g)].every((m) => /onClick=/.test(m[0])))
  const antesMais = f.slice(0, f.indexOf("{mais && ("))
  ok("visíveis: Responsável, Prazo, Família, Status, Certidão, Cartório, Risco, Ordenar por — e nenhum dos de 'Mais filtros'", ['rotulo="Responsável"', "Filtro Prazo", 'aria-label="Família"', 'rotulo="Status"', 'rotulo="Certidão"', 'rotulo="Cartório"', 'rotulo="Risco"', 'aria-label="Ordenar por"'].every((r) => antesMais.includes(r)) && ['rotulo="Fase"', 'rotulo="Passo atual"', 'rotulo="Prioridade"', "Só linha reta", 'rotulo="Acompanhamento"', 'rotulo="Cobrança"', 'aria-label="Quando"'].every((r) => !antesMais.includes(r)))
  const aposMais = f.slice(f.indexOf("{mais && ("))
  ok("'Mais filtros' guarda Quando, Fase, Passo atual, Prioridade, Só linha reta, Acompanhamento e Cobrança", ["Quando", 'rotulo="Fase"', 'rotulo="Passo atual"', 'rotulo="Prioridade"', "Só linha reta", 'rotulo="Acompanhamento"', 'rotulo="Cobrança"'].every((r) => aposMais.includes(r)))
  ok("o chip de nacionalidade é só exibição (o seletor do topo continua o dono) e tem ✕", /Nacionalidade: \{paisRotulo\}/.test(f) && /aria-label="Limpar a nacionalidade"/.test(f))
  ok("Família: campo com datalist alimentado por sugestoesDeFamilia", /list="tor-familias"/.test(f) && /sugestoesDeFamilia\(linhasTodas/.test(f))
  ok("rótulo de status pelo mapa único; fase pelo cadastro (rotularFase)", /ROTULO_STATUS\[s\]/.test(f) && /rotularFase\(f\)/.test(f) && !/NAO_INICIADA:\s*"/.test(f))
  ok("400 px: a barra quebra em linhas, o menu abre na largura da barra e nada tem largura fixa acima de 400 px", /\.tor-fxrow \{[^}]*flex-wrap: wrap/.test(css) && /\.tor-fx-pop \{[^}]*width: min\(340px, 100%\)/.test(css) && !/\.tor-fx[\w-]* \{[^}]*width: (\d{3,})px/.test(css.replace(/min\(340px, 100%\)/g, "")))
  ok("a busca do topo: 'Buscar pessoa, cartório ou tarefa…' (família tem campo próprio)", /placeholder="Buscar pessoa, cartório ou tarefa…"/.test(cab) && !/Buscar família/.test(cab))
  ok("a Torre repassa os filtros, o chip/limpar de país e de busca, e o estado da URL", /filtros=\{filtros\} onFiltros=\{setFiltros\}/.test(torre) && /onLimparPais=/.test(torre) && /onLimparBusca=/.test(torre) && /onEstadoUrl=\{onEstadoUrl\}/.test(torre))
}

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
