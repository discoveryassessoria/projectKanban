// scripts/operacao-tela-ajustes-b-c.test.ts
// ============================================================================
// OPERAÇÃO (Daniela, assistente) E TORRE — ajustes de tela B1–B6 e C1–C4 (30/09/2026).
//   B1 aba Radar = SOMA dos cartões que a pessoa vê    B2 "Pendência de fase anterior" só de fase ANTERIOR
//   B3 aba Famílias: número = famílias listadas         B4 fase da família = fase ATUAL REAL do processo
//   B5 gargalo pela MESMA precisaDeOrgaoEmissor; marco = próxima fase (ou omitido)
//   B6 "Escaladas ao gestor" só para gestor, texto é a REGRA
//   C1 coluna Documento só o TIPO      C2 Passo atual só o nome + coluna Status (mapa único)
//   C3 "Fila" -> "A fazer" em tudo que o usuário lê      C4 o mesmo na Torre (aba Tarefas e drawer)
// Funções puras com cenários + renderização real (react-dom/server) dos cartões/tabelas + verificação estática.
//   npx tsx scripts/operacao-tela-ajustes-b-c.test.ts
// ============================================================================
import { readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  somaDosCartoesDoRadar, pendenciaDeFaseAnterior, linhasDoRadar, ehGestorDaOperacao, familiasDaAba, chaveDaFamilia,
  faseAtualDaFamilia, gargaloDaFamilia, proximoMarcoDaFamilia, precisaDeOrgaoEmissor, docTipoTxt, passoLabelDe,
  statusTarefaTxt, ROTULO_STATUS_TAREFA, emAndamentoSemDono,
} from "../src/components/operacao/operacao-v3-derivacoes"
import { AbaRadar, AbaFamilias, AbaAguardando, textoDaEscalada, textoDaPendenciaDeFaseAnterior } from "../src/components/operacao/operacao-v3-abas"
import type { LinhaOperacaoV3 } from "../src/components/operacao/operacao-v3-tipos"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n── ${t}`)
const ler = (p: string) => readFileSync(p, "utf8")

const L = (o: Partial<LinhaOperacaoV3>): LinhaOperacaoV3 => ({
  taskId: 1, titulo: "Certidão de Casamento - Inteiro Teor · Maria del Consuelo Perez Alvarez", documentoId: 10, processoId: 675, processoNome: "Antão", pais: "Espanha",
  familiaNome: "Antão", pessoaId: 5, pessoaNome: "Maria del Consuelo Perez Alvarez", numeroLinhagem: 3, linhaReta: true, casalNomes: null, conjugeNome: "José Antão",
  faseAnteriorAFaseAtual: false, faseAtualDoProcessoLabel: "Genealogia", categoriaDoc: "CASAMENTO", origem: "DOCUMENTO", faseMacroKey: "genealogia",
  etapaAtual: "Localizar registro da certidão", statusTarefa: "NAO_INICIADA", equipeKey: null, responsavelId: 12, responsavelNome: "Daniela", prioridade: "MEDIA",
  dataPrazo: null, atrasada: false, rotuloDoPrazo: "—", diasParaPrazo: null, aguardandoDependencia: false, requerDecisao: false, executavelAgora: true,
  terceiroNome: null, terceiroEmail: null, terceiroTelefone: null, servico: null, criadaEm: null, atribuidaEm: null, passoAtual: { ordem: 0, total: 4 },
  regraTemporalPasso: null, acompanhamentoPasso: null, emRisco: false, motivosRisco: [], atrasoInterno: false, atrasoTerceiro: false, acompanhamentoVencido: false,
  retornoRecebido: false, proximoAcontecimento: null, escalada: false, totalCobrancas: 0, estadoOperacao: "FILA", aIniciar: true, passoCorrente: { chave: "localizar", label: "Localizar registro da certidão" },
  venceHoje: false, coluna: "x", esperandoDe: null, esperandoDesde: null, esperandoHaDias: null, motivoBloqueio: null, concluidaEm: null, ...o,
}) as LinhaOperacaoV3
const nada = () => {}
const reais = (xs: unknown[]): LinhaOperacaoV3[] => xs.map((_, i) => L({ taskId: 900 + i }))
const nCols = (g: string) => g.replace(/\([^)]*\)/g, "X").trim().split(/\s+/).length

// ── B1 ───────────────────────────────────────────────────────────────────────
secao("B1 — a aba Radar é a SOMA dos números dos cartões (0 se nenhum)")
const v = { atras: [] as unknown[], acompVenc: [] as unknown[], decis: [] as unknown[], noOrg: [] as unknown[], genOpen: [] as unknown[] }
ok("todos zero → 0 (o `+ 1` fixo que dava 1/2 morreu)", somaDosCartoesDoRadar(v, { verEscaladas: true }) === 0)
ok("caso da Daniela: um cartão com 1 → 1 (era 2)", somaDosCartoesDoRadar({ ...v, genOpen: [1] }, { verEscaladas: false }) === 1)
ok("3 atrasadas + 2 sem órgão → 5", somaDosCartoesDoRadar({ ...v, atras: [1, 2, 3], noOrg: [1, 2] }, { verEscaladas: true }) === 5)
ok("os quatro cartões fixos nunca somam (a função nem os recebe)", !/fixos|inconsistentes/.test(String(somaDosCartoesDoRadar)))
ok("escaladas ESCONDIDAS não somam (a aba não conta o que a pessoa não vê)", somaDosCartoesDoRadar({ ...v, decis: [1, 2], atras: [1] }, { verEscaladas: false }) === 1)
ok("escaladas visíveis (gestor) somam", somaDosCartoesDoRadar({ ...v, decis: [1, 2], atras: [1] }, { verEscaladas: true }) === 3)
const cenariosSoma: Array<[string, typeof v, boolean]> = [
  ["vazio", v, true], ["um", { ...v, acompVenc: [1] }, false], ["misto", { ...v, atras: [1], acompVenc: [1, 2], decis: [1], noOrg: [1], genOpen: [1, 2, 3] }, true],
  ["misto sem gestor", { ...v, atras: [1], acompVenc: [1, 2], decis: [1], noOrg: [1], genOpen: [1, 2, 3] }, false],
]
for (const [nome, c, g] of cenariosSoma) {
  const html = renderToStaticMarkup(createElement(AbaRadar, { atras: reais(c.atras), acompVenc: reais(c.acompVenc), decis: reais(c.decis), noOrg: reais(c.noOrg), genOpen: reais(c.genOpen), verEscaladas: g, escaladaLimiar: 2, onKAtras: nada, onGoAcomp: nada, onKEsc: nada, onNoOrg: nada, onFaseAnterior: nada, onNaoLigado: nada }))
  // soma dos números que aparecem nos 5 cartões da fila renderizados (os 4 fixos são "0")
  const numeros = [...html.matchAll(/<span class="opv3-pill opv3-p-(?:red|grn)">(\d+)<\/span>/g)].map((m) => Number(m[1]))
  const somaTela = numeros.reduce((a, b) => a + b, 0)
  ok(`renderizado (${nome}): soma dos cartões na tela = número da aba`, somaTela === somaDosCartoesDoRadar(c, { verEscaladas: g }), `tela ${somaTela}`)
}
const v3 = ler("src/components/operacao/operacao-v3.tsx"), abas = ler("src/components/operacao/operacao-v3-abas.tsx"), der = ler("src/components/operacao/operacao-v3-derivacoes.ts")
ok("a aba usa a função pura (sem `+ 1` fixo)", /const nRadar = somaDosCartoesDoRadar\(/.test(v3) && !/genOpen\.length \? 1 : 0\) \+ 1/.test(v3))

// ── B2 ───────────────────────────────────────────────────────────────────────
secao("B2 — Pendência de fase anterior: só tarefa de fase ANTERIOR à fase atual")
const antao = L({ taskId: 100, faseAnteriorAFaseAtual: false, faseMacroKey: "genealogia" })
const antiga = L({ taskId: 101, faseAnteriorAFaseAtual: true, faseMacroKey: "genealogia", faseAtualDoProcessoLabel: "Emissão documental" })
const transv = L({ taskId: 102, faseAnteriorAFaseAtual: true, origem: "TRANSVERSAL" })
ok("Certidão de Casamento do Antão (fase ATUAL = Genealogia, faseAnteriorAFaseAtual=false) NÃO conta", !pendenciaDeFaseAnterior(antao))
ok("tarefa de Genealogia com o processo já em Emissão documental conta", pendenciaDeFaseAnterior(antiga))
ok("transversal nunca é 'de fase anterior'", !pendenciaDeFaseAnterior(transv))
const abertas = [antao, antiga, transv, L({ taskId: 103, estadoOperacao: "AGUARDANDO", faseAnteriorAFaseAtual: true, terceiroNome: "Cartório X" })]
const cartao = abertas.filter(pendenciaDeFaseAnterior)
const lista = linhasDoRadar("faseant", abertas, abertas.filter((l) => l.estadoOperacao === "FILA"))
ok("número do cartão = tamanho da lista que ele abre (mesma função)", cartao.length === lista.length && cartao.every((l, i) => l.taskId === lista[i].taskId), `${cartao.length}`)
ok("a lista traz as de Aguardando também (cartão conta abertas)", lista.some((l) => l.estadoOperacao === "AGUARDANDO"))
ok("texto do cartão: sem 'trava a família'; diz 'fase anterior ainda aberta'", !/trava a família/.test(textoDaPendenciaDeFaseAnterior(antiga)) && /fase anterior ainda aberta/.test(textoDaPendenciaDeFaseAnterior(antiga)) && textoDaPendenciaDeFaseAnterior(undefined) === "nenhuma")
ok("texto do cartão usa só o TIPO do documento (sem '· com', sem Inteiro Teor)", !/Inteiro Teor/.test(textoDaPendenciaDeFaseAnterior(antiga)) && /Certidão de Casamento · Maria/.test(textoDaPendenciaDeFaseAnterior(antiga)))
ok("a tela não usa mais faseMacroKey==='genealogia' para o cartão", !/genOpen = useMemo\(\(\) => abertosVisiveis\.filter\(\(l\) => l\.faseMacroKey/.test(v3) && /abertosVisiveis\.filter\(pendenciaDeFaseAnterior\)/.test(v3))
ok("radar==='noorg' segue a mesma lista de precisaDeOrgaoEmissor", linhasDoRadar("noorg", [], [L({ documentoId: 1, faseMacroKey: "emissao_documental" }), L({ documentoId: 2 })]).length === 1)

// ── B3 / B4 ──────────────────────────────────────────────────────────────────
secao("B3 — aba Famílias: o número é o de famílias LISTADAS")
const aberA = L({ taskId: 1, familiaNome: "Antão" })
const feitoC = L({ taskId: 2, familiaNome: "Cibils", processoNome: "Cibils", estadoOperacao: "CONCLUIDA", statusTarefa: "CONCLUIDO_RECEBIDO", faseAtualDoProcessoLabel: "Emissão documental", faseMacroKey: "genealogia" })
const nomes = familiasDaAba([aberA], [feitoC])
ok("Antão (aberta) + Cibils (só concluída recente) → 2 famílias", nomes.length === 2 && nomes[0] === "Antão" && nomes[1] === "Cibils")
ok("sem duplicar: mesma família aberta e concluída → 1", familiasDaAba([aberA], [L({ taskId: 9, familiaNome: "Antão" })]).length === 1)
ok("sem família cadastrada cai no nome do processo", chaveDaFamilia({ familiaNome: null, processoNome: "Proc 7" }) === "Proc 7")
const htmlFam = renderToStaticMarkup(createElement(AbaFamilias, { abertos: [aberA], feito: [feitoC], famOpen: null, setFamOpen: nada, famUltimo: {}, setFamUltimo: nada, onAbrir: nada, onNaoLigado: nada }))
const nCards = (htmlFam.match(/Gargalo:/g) ?? []).length
ok("renderizado: nº de famílias na aba = familiasDaAba().length", nCards === nomes.length, `${nCards}`)
ok("a tela da aba usa a MESMA função para o número", /familiasDaAba\(abertosVisiveis, feitoVisivel\)\.length/.test(v3) && /familiasDaAba\(abertos, feito\)/.test(abas))

secao("B4 — fase da família = fase ATUAL REAL do processo (não a da tarefa)")
ok("Cibils: tarefa em 'genealogia' mas processo em Emissão documental → 'Emissão documental'", faseAtualDaFamilia([feitoC]) === "Emissão documental")
ok("sem rótulo em nenhuma linha → '—' (nunca a chave crua)", faseAtualDaFamilia([L({ faseAtualDoProcessoLabel: null })]) === "—")
ok("renderizado: o selo da família mostra 'Emissão documental' e nunca 'genealogia'", htmlFam.includes("Emissão documental") && !/>genealogia</.test(htmlFam))
ok("a aba não lê mais faseMacroKey para o selo", !/ts\[0\]\?\.faseMacroKey/.test(abas))

// ── B5 ───────────────────────────────────────────────────────────────────────
secao("B5 — Gargalo pela MESMA precisaDeOrgaoEmissor; marco = próxima fase do processo")
const genSemOrgao = L({ taskId: 1, faseMacroKey: "genealogia", documentoId: 10, terceiroNome: null })
ok("Genealogia sem órgão NÃO é gargalo (Localizar registro não exige órgão)", gargaloDaFamilia([genSemOrgao]) === "—" && !precisaDeOrgaoEmissor(genSemOrgao))
const emissaoSemOrgao = L({ taskId: 2, faseMacroKey: "emissao_documental", documentoId: 11, terceiroNome: null })
ok("Emissão sem órgão É gargalo, e o cartão 'Sem órgão emissor' conta a mesma", gargaloDaFamilia([emissaoSemOrgao]) === "órgão emissor não vinculado" && precisaDeOrgaoEmissor(emissaoSemOrgao))
ok("tarefa sem documento (gestor/manual) nunca é gargalo de órgão", gargaloDaFamilia([L({ documentoId: null, faseMacroKey: "emissao_documental" })]) === "—")
ok("órgão com mais escaladas ganha", gargaloDaFamilia([L({ escalada: true, terceiroNome: "Cartório A" }), L({ escalada: true, terceiroNome: "Cartório A" }), L({ escalada: true, terceiroNome: "B" })]) === "Cartório A (escalada)")
const htmlAntao = renderToStaticMarkup(createElement(AbaFamilias, { abertos: [genSemOrgao], feito: [], famOpen: null, setFamOpen: nada, famUltimo: {}, setFamUltimo: nada, onAbrir: nada, onNaoLigado: nada }))
ok("renderizado (Antão, Genealogia): 'Gargalo: —' e NÃO diz 'órgão emissor não vinculado'", /Gargalo:[^<]*<b>—<\/b>/.test(htmlAntao) && !/órgão emissor não vinculado/.test(htmlAntao))
ok("sem o dado da próxima fase: o 'Próximo marco' é OMITIDO (nunca 'Análise documental' fixo)", !/Próximo marco/.test(htmlAntao) && !/Análise documental/.test(abas))
const comMarco = L({ proximaFaseDoProcessoLabel: "Emissão documental" })
ok("com o dado da próxima fase, mostra o marco", proximoMarcoDaFamilia([comMarco]) === "Emissão documental" && /Próximo marco: <b>Emissão documental<\/b>/.test(renderToStaticMarkup(createElement(AbaFamilias, { abertos: [comMarco], feito: [], famOpen: null, setFamOpen: nada, famUltimo: {}, setFamUltimo: nada, onAbrir: nada, onNaoLigado: nada }))))
ok("a aba usa gargaloDaFamilia (não a conta própria aIniciar && documentoId && !terceiroNome)", /gargaloDaFamilia\(abertosDaFam\)/.test(abas) && !/aIniciarEfetivo\(l\) && l\.documentoId != null && !l\.terceiroNome/.test(abas))

// ── B6 ───────────────────────────────────────────────────────────────────────
secao("B6 — 'Escaladas ao gestor' só para gestor; texto é a regra")
ok("admin é gestor", ehGestorDaOperacao({ isAdmin: true, pode: () => false }))
ok("quem tem operacao.distribuirTarefas é gestor", ehGestorDaOperacao({ isAdmin: false, pode: (c) => c === "operacao.distribuirTarefas" }))
ok("assistente (Daniela) não é gestor", !ehGestorDaOperacao({ isAdmin: false, pode: () => false }))
ok("a chave existe em src/lib/permissoes.ts", /'operacao\.distribuirTarefas'/.test(ler("src/lib/permissoes.ts")))
const radarProps = { atras: [], acompVenc: [], decis: [L({ escalada: true })], noOrg: [], genOpen: [], escaladaLimiar: 2, onKAtras: nada, onGoAcomp: nada, onKEsc: nada, onNoOrg: nada, onFaseAnterior: nada, onNaoLigado: nada }
const htmlNaoGestor = renderToStaticMarkup(createElement(AbaRadar, { ...radarProps, verEscaladas: false }))
const htmlGestor = renderToStaticMarkup(createElement(AbaRadar, { ...radarProps, verEscaladas: true }))
ok("renderizado (não gestor): o cartão NÃO existe", !/Escaladas ao gestor/.test(htmlNaoGestor))
ok("renderizado (gestor): existe com a regra 'escala após 2 cobranças sem resposta'", /Escaladas ao gestor/.test(htmlGestor) && /escala após 2 cobranças sem resposta/.test(htmlGestor))
ok("o número 2 vem do limiar passado (3 → 'escala após 3 cobranças…')", textoDaEscalada(3) === "escala após 3 cobranças sem resposta")
ok("a página liga o cartão ao papel (usePermissoes → ehGestorDaOperacao → prop gestor → verEscaladas)", /ehGestorDaOperacao\(\{ isAdmin, pode \}\)/.test(ler("src/app/operacao/page.tsx")) && /<OperacaoV3 gestor=/.test(ler("src/app/operacao/page.tsx")) && /verEscaladas=\{gestor\}/.test(v3) && /\{ verEscaladas: gestor \}/.test(v3))

// ── C1 / C2 ──────────────────────────────────────────────────────────────────
secao("C1 — Documento só o TIPO; C2 — Passo atual só o nome + coluna Status")
ok("docTipoTxt: 'Certidão de Casamento' (sem Inteiro Teor, sem pessoa, sem '· com')", docTipoTxt(antao) === "Certidão de Casamento")
ok("passo atual: só o nome, sem prefixo nem subtítulo", passoLabelDe(L({ aIniciar: true, faseMacroKey: "genealogia" })).label === "Localizar registro da certidão" && passoLabelDe(L({})).sub === "")
ok("passo atual sem passoCorrente cai em etapaAtual; sem nada '—'", passoLabelDe(L({ passoCorrente: null })).label === "Localizar registro da certidão" && passoLabelDe(L({ passoCorrente: null, etapaAtual: null })).label === "—")
ok("passo atual nunca traz 'A iniciar', '(enviar ao cartório)', 'fase ', 'x/y ·'", [L({}), L({ faseMacroKey: "emissao_documental" }), L({ statusTarefa: "EM_ANDAMENTO", responsavelId: null }), L({ estadoOperacao: "CONCLUIDA" })].every((l) => { const p = passoLabelDe(l); return !/A iniciar|enviar ao cartório|fase |\d\/\d|Em andamento|Concluída/.test(p.label + p.sub) }))
const STATUS = ["NAO_INICIADA", "EM_ANDAMENTO", "AGUARDANDO_CLIENTE", "AGUARDANDO_TERCEIRO", "CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "BLOQUEADA", "SUPERSEDIDA", "CANCELADA"]
const esperado: Record<string, string> = { NAO_INICIADA: "A iniciar", EM_ANDAMENTO: "Em andamento", AGUARDANDO_TERCEIRO: "Aguardando terceiros", AGUARDANDO_CLIENTE: "Aguardando cliente", BLOQUEADA: "Bloqueada", CONCLUIDO_RECEBIDO: "Concluída", CONCLUIDO_NAO_POSSUI: "Concluída", CANCELADA: "Cancelada", SUPERSEDIDA: "Substituída" }
ok("o mapa cobre TODO o enum StatusTarefa do schema", (() => { const m = /enum StatusTarefa \{([^}]*)\}/.exec(ler("prisma/schema.prisma")); const doSchema = m![1].split("\n").map((x) => x.replace(/\/\/.*/, "").trim()).filter(Boolean); return doSchema.length === STATUS.length && doSchema.every((s) => s in ROTULO_STATUS_TAREFA) })())
for (const s of STATUS) ok(`Status ${s} → '${esperado[s]}'`, statusTarefaTxt({ statusTarefa: s }) === esperado[s])
ok("EM_ANDAMENTO (com ou sem dono) nunca 'A iniciar'", statusTarefaTxt(L({ statusTarefa: "EM_ANDAMENTO", responsavelId: null, aIniciar: true })) === "Em andamento" && statusTarefaTxt(L({ statusTarefa: "EM_ANDAMENTO", responsavelId: 12, aIniciar: true })) === "Em andamento" && emAndamentoSemDono(L({ statusTarefa: "EM_ANDAMENTO", responsavelId: null })))
ok("Status vem do statusTarefa, não do passo/aIniciar: NAO_INICIADA com aIniciar=false segue 'A iniciar'", statusTarefaTxt(L({ statusTarefa: "NAO_INICIADA", aIniciar: false })) === "A iniciar")

// renderização real: Aguardando (Documento, Passo atual, Status) e Famílias expandida
const emAnd = L({ taskId: 7, statusTarefa: "EM_ANDAMENTO", estadoOperacao: "AGUARDANDO", terceiroNome: "Cartório X", responsavelId: null, aIniciar: true, conjugeNome: "José Antão" })
const htmlAg = renderToStaticMarkup(createElement(AbaAguardando, { linhas: [emAnd], aguardPor: "familia", setAguardPor: nada, quick: null, clearQuick: nada, col: {}, setCol: nada, onAbrir: nada, onCobrar: nada, onVerFamilia: nada }))
ok("renderizado (Aguardando): cabeçalho 'Passo atual' seguido de 'Status'", /<span>Passo atual<\/span><span>Status<\/span>/.test(htmlAg))
ok("renderizado (Aguardando): tarefa EM_ANDAMENTO mostra 'Em andamento', nunca 'A iniciar'", />Em andamento</.test(htmlAg) && !/A iniciar/.test(htmlAg))
ok("renderizado (Aguardando): Documento só o tipo, sem '· com' nem 'Inteiro Teor'", />Certidão de Casamento</.test(htmlAg) && !/· com |Inteiro Teor/.test(htmlAg))
ok("renderizado (Aguardando): passo sem 'A iniciar ·' nem 'fase Genealogia'", !/A iniciar ·|fase Genealogia/.test(htmlAg) && /Localizar registro da certidão/.test(htmlAg))
const htmlFamAberta = renderToStaticMarkup(createElement(AbaFamilias, { abertos: [emAnd], feito: [], famOpen: { fam: "Antão", estagio: "cartorio" }, setFamOpen: nada, famUltimo: {}, setFamUltimo: nada, onAbrir: nada, onNaoLigado: nada }))
ok("renderizado (Famílias expandida): Passo atual → Status, 'Em andamento', sem '· com'", /<span>Passo atual<\/span><span>Status<\/span>/.test(htmlFamAberta) && />Em andamento</.test(htmlFamAberta) && !/· com /.test(htmlFamAberta))

// estático: nenhuma tela reintroduz o texto velho
secao("C1/C2 — estático: nenhuma tela da Operação/Torre reintroduz o texto velho")
const tt = ler("src/components/torre/TorreTarefas.tsx"), painel = ler("src/components/torre/PainelTorreTarefa.tsx"), feito = ler("src/components/torre/TorreFeito.tsx")
const codigo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1")
for (const [nome, src] of [["operacao-v3.tsx", v3], ["operacao-v3-abas.tsx", abas], ["operacao-v3-derivacoes.ts", der], ["TorreTarefas.tsx", tt], ["PainelTorreTarefa.tsx", painel], ["TorreFeito.tsx", feito]] as const) {
  const c = codigo(src)
  ok(`${nome}: sem '· com {cônjuge}'`, !/· com \$\{/.test(c) && !/conjugeNome \? ` · com/.test(c))
  ok(`${nome}: sem 'A iniciar ·' e sem '(enviar ao cartório)' como rótulo de passo`, !/A iniciar ·/.test(c) && !/label = .*A iniciar \(enviar ao cartório\)/.test(c) && !/"A iniciar \(enviar ao cartório\)"/.test(c))
  ok(`${nome}: sem 'Em andamento — sem responsável' nem 'fase Genealogia'`, !/Em andamento — sem responsável|fase Genealogia/.test(c))
}
ok("Operação: colunas 'Status' presentes em Fila(A fazer)/Aguardando/Acompanhamento/Famílias", (v3.match(/<span>Passo atual<\/span><span>Status<\/span>/g) ?? []).length >= 1 && (abas.match(/<span>Passo atual<\/span><span>Status<\/span>/g) ?? []).length >= 3)
ok("Operação: usa statusTarefaTxt (mapa único) em todas as tabelas", (v3.match(/statusTarefaTxt\(t\)/g) ?? []).length >= 1 && (abas.match(/statusTarefaTxt\(t\)/g) ?? []).length >= 3)
ok("CSS: as grades ganharam a coluna Status (9/9/8 colunas) com minmax(0,…) — sem overflow horizontal", (() => { const css = ler("src/components/operacao/operacao-v3.css"); const g = (n: string) => nCols(new RegExp(`\\.${n} \\{ grid-template-columns: ([^;]+);`).exec(css)![1]); return g("opv3-gF") === 9 && g("opv3-gA") === 9 && g("opv3-gC") === 8 })())

// ── C3 ───────────────────────────────────────────────────────────────────────
secao("C3 — 'Fila' -> 'A fazer' em tudo que o usuário lê na Operação")
const cv3 = codigo(v3), cabas = codigo(abas)
ok("aba e cartão do topo: 'A fazer'", /A fazer <span className="opv3-n">/.test(cv3) && /<span>A fazer<\/span>/.test(cv3) && !/<span>Fila<\/span>/.test(cv3) && !/>Fila <span/.test(cv3))
ok("botão '▶ Fazer agora (N)'", /▶ Fazer agora \(\{linhas\.length\}\)/.test(cv3) && !/Trabalhar a fila/.test(cv3))
ok("texto explicativo EXATO", v3.includes("A fazer = o que depende de você agora: certidões a iniciar (enviar ao cartório) e no passo 4 (conferir e validar). O que aguarda terceiros fica em Aguardando."))
ok("seletor Vista: 'A fazer' (valor interno 'minha' e visao=minha_fila intactos)", /<option value="minha">A fazer<\/option>/.test(cv3) && /visao=minha_fila/.test(cv3))
ok("mensagens: 'Nada a fazer.', 'Nenhuma a fazer com esse filtro.', '{n} a fazer', 'Navegação do A fazer'", /"Nada a fazer\."/.test(cv3) && /Nenhuma a fazer com esse filtro\./.test(cv3) && /a fazer ·/.test(cv3) && /Navegação do A fazer/.test(cv3))
ok("nenhum texto visível com 'fila' na Operação (fora chaves internas)", !/(Fila vazia|Nada na fila|na fila com esse|Navegação da fila|Minha fila|\d na fila| na fila ·|Inicie uma certidão na Fila|esteja na Fila)/.test(cv3 + cabas))
ok("chaves internas preservadas: Tab 'fila', estadoOperacao 'FILA', aba=fila, visao=minha_fila", /type Tab = "fila"/.test(v3) && /estadoOperacao === "FILA"/.test(v3) && /fila: "fila"/.test(v3))
ok("sino: 'saíram do seu A fazer' (aviso-texto.ts)", /do seu A fazer/.test(ler("lib/operacional/aviso-texto.ts")) && !/da sua fila/.test(ler("lib/operacional/aviso-texto.ts")))
ok("subtítulo da página /operacao", /subtitle="A fazer, aguardando/.test(ler("src/app/operacao/page.tsx")))

// ── C4 ───────────────────────────────────────────────────────────────────────
secao("C4 — Torre (aba Tarefas e drawer)")
const ctt = codigo(tt)
const tab = codigo(ler("src/components/torre/TarefasTabela.tsx")), gav = codigo(ler("src/components/torre/TarefasGaveta.tsx")), tela = ler("lib/operacional/torre-tarefas-tela.ts")
ok("cabeçalho (Torre nova): ... Passo | Status, ..., Responsável ...", /<div>Passo<\/div><div>Status<\/div>.*<div>Responsável<\/div>/.test(tab))
ok("linha: Passo = passoLabelDe().label; Status = statusDaLinha(l) (mapa único de rótulos)", /passoLabelDe\(l\)\.label/.test(tab) && /statusDaLinha\(l\)/.test(tab) && /import \{ ROTULO_STATUS \} from '@\/src\/lib\/home\/rotulo-status-tarefa'/.test(tela))
ok("grade .tor-gT tem 10 colunas (chk, cert, bola, etapa, status, resp, prazo, acomp, risco, ações)", nCols(/\.tor-gT \{ grid-template-columns: ([^;]+);/.exec(ler("src/components/torre/torre.css"))![1]) === 10)
ok("gaveta (TarefasGaveta): mostra o Status real", /statusTarefaTxt\(linha\)/.test(gav) && /<span className="k">Status<\/span>/.test(gav))
ok("botão '▶ Fazer agora (N)'; lista vazia não abre; Modo foco 'i de N'; sem 'fila'", /▶ Fazer agora \(\{nTrabalho\}\)/.test(ctt) && /lista vazia: nada abre/.test(tt) && /Modo foco · .* de \$\{focoIds\.length\}/.test(tt) && !/Trabalhar a fila|Fila vazia|Navegação da fila/.test(ctt + tab + gav))
ok("a aba Equipe NÃO foi tocada (coluna técnica 'Fila' de semanas)", !/A fazer/.test(ler("src/components/torre/TorreEquipe.tsx")))
ok("a Torre mostra a ação Continuar/Atribuir para EM_ANDAMENTO sem dono, sem rótulo na coluna Passo", /acoesDaLinha/.test(tab) && /Atribuir/.test(ctt) && !/Em andamento — sem responsável/.test(ctt + tab + codigo(der)))

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
if (falhou) process.exit(1)
