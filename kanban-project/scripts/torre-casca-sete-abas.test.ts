// scripts/torre-casca-sete-abas.test.ts
// ============================================================================
// TORRE NOVA, ETAPA A (01/10/2026), consolidada em 06/10/2026 — A CASCA: 5 abas (Hoje · Tarefas · Famílias · Equipe · Terceiros), contrato de URL
// (ids antigos traduzidos), contadores, cabeçalho, país em todas as abas, Hoje só com alarmes, a rota do Processo (página) e a aba
// Terceiros (órgãos, sem placar por cartório). (O nome do arquivo ficou: é o mesmo teste do casco.)
//
//   npx tsx scripts/torre-casca-sete-abas.test.ts   (banco de teste)
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-casca-sete-abas.test.ts")

import { existsSync, readFileSync } from "node:fs"
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import { ABAS_DA_TORRE, ABA_INICIAL, ABA_ANTIGA_PARA_NOVA, IDS_DAS_ABAS, IDS_ANTIGOS_DAS_ABAS, PERGUNTA_DA_ABA, abaDaUrl, destinoDeAbaQueSaiu, ehAbaDaTorre, rotuloDaAba } from "../lib/operacional/torre-abas"
import { seloVisivel } from "../lib/operacional/torre-casca"
import { ALARMES_DE_HOJE } from "../lib/operacional/torre-hoje"
import { itensDoPais, mapaDePaisPorProcesso, contagemDeProcessosPorPais } from "../lib/operacional/torre-pais"
import { destinoDaAbaAntigaDaTorre } from "../lib/operacional/navegacao"
import { destinoDaOperacaoParaAdmin, linkDoAvisoParaAdmin } from "../src/lib/torre-absorcao"
import { GET as getEquipe } from "../src/app/api/torre/equipe/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREA_CASCA"
const ler = (p: string) => readFileSync(p, "utf8")
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")
const req = (url: string, token: string) => new NextRequest(`http://localhost${url}`, { headers: { Authorization: `Bearer ${token}` } })

async function main() {
  secao("1 — CINCO abas, na ORDEM EXATA da consolidação (Lei da Torre)")
  ok("Hoje · Tarefas · Famílias · Equipe · Terceiros", ABAS_DA_TORRE.map(([, r]) => r).join(" · ") === "Hoje · Tarefas · Famílias · Equipe · Terceiros")
  ok("ids estáveis: hoje · tarefas · familias · equipe · terceiros", IDS_DAS_ABAS.join(",") === "hoje,tarefas,familias,equipe,terceiros")
  ok("cada aba responde UMA pergunta (L2), a do cabeçalho dela", PERGUNTA_DA_ABA.hoje === "O que está pegando hoje?" && PERGUNTA_DA_ABA.tarefas === "Quem faz o quê?" && PERGUNTA_DA_ABA.familias === "Como está cada família?" && PERGUNTA_DA_ABA.equipe === "A equipe dá conta?" && PERGUNTA_DA_ABA.terceiros === "O que estamos esperando de fora?" && IDS_DAS_ABAS.every((a) => !!PERGUNTA_DA_ABA[a]))
  const torre = ler("src/components/torre/Torre.tsx")
  ok("o casco usa a lista única (torre-abas.ts) — não reescreve a lista", /export const ABAS: Array<\[Aba, string\]> = ABAS_DA_TORRE/.test(torre) && !/\["precisa", "Precisa de você"\]/.test(torre))
  ok("as abas antigas não existem mais: nada de 'Visão geral', 'Precisa de você', 'Radar', 'Processos', 'Minha operação', 'Certidões' nem 'Equipe e Terceiros' na lista", !ABAS_DA_TORRE.some(([, r]) => /Vis[aã]o geral|Precisa de voc|Radar|^Processos$|Minha opera|certid|Equipe e Terceiros/i.test(r)) && rotuloDaAba("tarefas") === "Tarefas" && rotuloDaAba("familias") === "Famílias")
  ok("cada aba do casco tem a sua tela montada (hoje → TorreHoje, tarefas, equipe, familias → TorreFamilias, terceiros)", ["hoje", "tarefas", "equipe", "familias", "terceiros"].every((a) => new RegExp(`aba === "${a}"`).test(torre)) && /<TorreHoje/.test(torre) && /<TorreFamilias/.test(torre) && !/aba === "(visao|precisa|radar|processos|minha)"/.test(torre))
  ok("'Minha operação' não é mais montada na Torre (OperacaoV3 saiu); mora só em /operacao", !/OperacaoV3|MinhaOperacao/.test(torre))

  secao("2 — contrato de URL: ?aba= estável, valores ANTIGOS traduzidos, sem aba → Hoje")
  ok("sem ?aba= → hoje", ABA_INICIAL === "hoje" && abaDaUrl(null) === "hoje" && abaDaUrl(undefined) === "hoje" && abaDaUrl("") === "hoje")
  ok("valor desconhecido → hoje (não quebra)", abaDaUrl("xyz") === "hoje" && abaDaUrl("Radar") === "hoje")
  ok("ids ANTIGOS continuam válidos e são TRADUZIDOS (visao/precisa → hoje · processos → familias · radar → familias com ?vista=matriz · minha → /operacao)", IDS_ANTIGOS_DAS_ABAS.join(",") === "visao,precisa,radar,processos,minha" && abaDaUrl("visao") === "hoje" && abaDaUrl("precisa") === "hoje" && abaDaUrl("processos") === "familias" && abaDaUrl("radar") === "familias" && ABA_ANTIGA_PARA_NOVA.radar && "vista" in ABA_ANTIGA_PARA_NOVA.radar && ABA_ANTIGA_PARA_NOVA.radar.vista === "matriz")
  ok("'minha' sai da Torre: não é aba, cai na inicial e leva a /operacao", !ehAbaDaTorre("minha") && abaDaUrl("minha") === "hoje" && destinoDeAbaQueSaiu("minha") === "/operacao" && destinoDeAbaQueSaiu("hoje") === null && destinoDeAbaQueSaiu("radar") === null)
  ok("os ids antigos NÃO são abas (só os 5 novos são)", ["visao", "precisa", "radar", "processos", "minha"].every((a) => !ehAbaDaTorre(a)) && IDS_DAS_ABAS.every(ehAbaDaTorre))
  ok("?aba=regras|integridade|auditoria seguem indo para o Gerenciamento", ["regras", "integridade", "auditoria"].every((a) => !ehAbaDaTorre(a) && destinoDaAbaAntigaDaTorre(a) !== null))
  ok("o casco lê a aba pela lista única e abre em ABA_INICIAL; a URL omite 'aba' só na inicial; traduz os ids antigos e a matriz", /ehAbaDaTorre\(abaUrl\)/.test(torre) && /ABA_ANTIGA_PARA_NOVA\[abaUrl\]/.test(torre) && /useState<Aba>\(urlInicial\.aba \?\? ABA_INICIAL\)/.test(torre) && /if \(aba !== ABA_INICIAL\) q\.set\("aba", aba\)/.test(torre) && /q\.set\("vista", "matriz"\)/.test(torre))
  ok("os links que o sistema GERA (sino, absorção) apontam para abas válidas da Torre — ou, no caso da Operação, para /operacao (fora da Torre)", [destinoDaOperacaoParaAdmin("tarefa=5"), linkDoAvisoParaAdmin("/tarefas", "admin"), linkDoAvisoParaAdmin("/operacao/distribuicao", "admin")].every((u) => ehAbaDaTorre(new URL(`http://x${u}`).searchParams.get("aba"))) && ["aba=radar", "aba=familias", "aba=aguardando", ""].every((q) => destinoDaOperacaoParaAdmin(q).startsWith("/operacao")))
  ok("?tarefa= / ?visao= / ?processo= continuam levando à aba Tarefas", /tarefa != null \? "tarefas"/.test(torre) && /\(visao \|\| processo != null \? "tarefas"/.test(torre))

  secao("3 — contadores nas abas (números reais, o mesmo que a aba mostra)")
  ok("Tarefas N = a lista filtrada; Famílias N = processos da aba; Equipe N; Terceiros 'N aguardando' (a visão 'Aguardando terceiros')", /k === "tarefas"\) return linhas \? \{ txt: String\(nTarefas\)/.test(torre) && /k === "familias"\) return procs \? \{ txt: String\(processosDaAba\.length\)/.test(torre) && /k === "equipe"\) return nEquipe != null/.test(torre) && /k === "terceiros"\) return linhas \? \{ txt: String\(nTerceiros\)/.test(torre) && /nTerceiros = numeroDoKpi\("aguard"/.test(torre))
  ok("Hoje não tem contador (os números ficam DENTRO da aba, clicáveis)", !/k === "hoje"\) return \{/.test(torre) && seloVisivel("hoje", "tarefas") === false)

  secao("4 — cabeçalho: país (botões) e busca; 'Briefing do dia' virou a frase de Hoje e 'Revisar o dia' saiu")
  const cab = ler("src/components/torre/TorreCabecalho.tsx")
  ok("NÃO há mais botão 'Briefing do dia' nem 'Revisar o dia' no cabeçalho", !/Briefing do dia|Revisar o dia|onBriefing|onRevisar/.test(semComentarios(cab)) && !existsSync("src/components/torre/TorreBriefing.tsx") && !existsSync("src/components/torre/TorreRevisao.tsx"))
  ok("a busca existe, com o placeholder de sempre", /placeholder="Buscar família, pessoa, cartório…"/.test(cab))
  ok("o país são botões 'Todos' + um por país cadastrado, com a contagem de processos", /Todos/.test(cab) && /paises\)\.map|paises\.map/.test(cab) && /p\.n != null/.test(cab) && /aria-pressed/.test(cab))
  ok("todo botão do cabeçalho tem handler", [...cab.matchAll(/<button\b[^>]*>/g)].every((m) => /onClick=/.test(m[0])))
  const torreCod = semComentarios(torre)
  ok("o briefing não abre sozinho nem em modal: sem sessionStorage 'torre-briefing-visto', sem briefingAberto; a frase do dia é texto de Hoje (<TorreHoje frase=…>)", !/sessionStorage|torre-briefing-visto|briefingAberto|setBriefingAberto/.test(torreCod) && /<TorreHoje[^>]*frase=\{textoDoBriefing\}/.test(torreCod))
  ok("o sino é o do cabeçalho global da página (HeaderBarApp) — a Torre não duplica", /<HeaderBarApp/.test(ler("src/app/torre/page.tsx")) && !/sino/i.test(semComentarios(cab)))

  secao("5 — o PAÍS filtra TODAS as abas (regras puras)")
  const itens = [{ processoId: 1, t: "a" }, { processoId: 2, t: "b" }, { processoId: null, t: "carga" }, { processoId: 3, t: "c" }]
  const mapa = mapaDePaisPorProcesso([{ processoId: 1, pais: "Itália" }, { processoId: 2, pais: "Espanha" }], [{ processoId: 3, pais: "Itália" }, { processoId: 1, pais: "Outro" }])
  ok("o país do processo vem da lista de processos, e das linhas de tarefa quando o processo não está na lista (a 1ª fonte vence)", mapa.get(1) === "Itália" && mapa.get(3) === "Itália" && mapa.get(2) === "Espanha")
  ok("Decisões de Hoje: só as de processos do país; a sem processo (Carga) some", itensDoPais(itens, "Itália", mapa).map((i) => i.t).join() === "a,c" && itensDoPais(itens, "Espanha", mapa).map((i) => i.t).join() === "b")
  ok("sem país escolhido: todas (inclusive as sem processo)", itensDoPais(itens, null, mapa).length === 4)
  ok("contagem de processos por país (botões 'Itália 280')", (() => { const c = contagemDeProcessosPorPais([{ pais: "Itália" }, { pais: "Itália" }, { pais: "Espanha" }, { pais: null }]); return c.get("Itália") === 2 && c.get("Espanha") === 1 && c.size === 2 })())
  ok("Hoje · Tarefas · Terceiros recortam as linhas por país; Famílias (lista e matriz) os processos; Equipe pelo servidor; decisões de Hoje pelo país", /linhasPais = useMemo/.test(torre) && /<TorreHoje linhas=\{linhasPais\}/.test(torre) && /<TorreTerceiros linhas=\{linhasPais\}/.test(torre) && /processosFiltrados/.test(torre) && /<TorreFamilias[\s\S]{0,200}processos=\{processosDaAba\} processosTodos=\{processosFiltrados\}/.test(torre) && /<TorreEquipe versao=\{versao\} pais=\{pais\}/.test(torre) && /itensPrecisaPais/.test(torre))

  secao("6 — Hoje: só alarmes (no máx. 6 números clicáveis, sem botão de ação) e a frase do dia")
  const hoje = ler("src/components/torre/TorreHoje.tsx")
  ok("TorreHoje existe, mostra a pergunta da aba e a frase do dia", /export function TorreHoje/.test(hoje) && /PERGUNTA_DA_ABA\.hoje/.test(hoje) && /data-testid="frase-do-dia"/.test(hoje))
  ok("no máximo SEIS números, todos clicáveis e saídos da lista única de alarmes", ALARMES_DE_HOJE.length <= 6 && /ALARMES_DE_HOJE\.map/.test(hoje) && /onClick=\{\(e\) => \{ e\.preventDefault\(\); onAlarme\(a\.chave\) \}\}/.test(hoje))
  ok("Hoje NÃO tem botão de ação (L4): nenhum <button>; as decisões são LINHAS COM LINK para onde se resolve", !/<button\b/.test(semComentarios(hoje)) && /<Link className="onde"/.test(hoje))
  ok("a Visão geral, o 'Precisa de você', os KPIs e o Funil saíram: nenhum componente deles existe mais", ["TorreVisaoGeral", "TorrePrecisaDeVoce", "TorreKpis", "TorreFunil"].every((f) => !existsSync(`src/components/torre/${f}.tsx`)) && !/<TorreKpis|<TorreFunil/.test(torre))
  ok("o topo NÃO fica acima das abas", !/<TorreKpis/.test(torre))
  ok("Hoje não usa relógio no render (hidratação): o 'agora' vem do casco", !/new Date\(|Date\.now\(/.test(semComentarios(hoje)))

  secao("7 — o Processo é uma PÁGINA (/torre/processo/[id]) com o mesmo portão da Torre")
  const rota = "src/app/torre/processo/[id]/page.tsx"
  ok("a rota existe", existsSync(rota))
  const pag = semComentarios(ler(rota))
  ok("mesmo portão: useIsClient antes de renderizar; só admin/gerência operacional; volta para /operacao", /const mounted = useIsClient\(\)/.test(pag) && /if \(!mounted \|\| carregando \|\| !autorizado\) return CARREGANDO/.test(pag) && /user\.tipo === "admin" \|\| pode\("operacao\.distribuirTarefas"\)/.test(pag) && /router\.push\("\/operacao"\)/.test(pag))
  ok("nada é renderizado antes do portão (cabeçalho e página do processo)", pag.indexOf("<HeaderBarApp") > pag.indexOf("if (!mounted") && pag.indexOf("<TorreProcessoPagina") > pag.indexOf("if (!mounted"))
  const detalhe = ler("src/components/torre/TorreProcessoPagina.tsx") + ler("src/components/torre/ProcessoCabecalho.tsx")
  ok("o Detalhe mostra dados reais (/api/torre/foco/{id}?detalhe=1), a trilha até Famílias, o selo 'Pausado' e a página completa (cabeçalho + decisões + TorreTarefas + encerradas)", /\/api\/torre\/foco\/\$\{processoId\}\?detalhe=1/.test(detalhe) && /\/torre\?aba=familias/.test(detalhe) && !/\/torre\?aba=processos/.test(detalhe) && /Pausado/.test(detalhe) && /<ProcessoCabecalho/.test(detalhe) && /<ProcessoDecisoes/.test(detalhe) && /<TorreTarefas/.test(detalhe) && /<ProcessoEncerradas/.test(detalhe))
  ok("'ProcessoCertidoes' saiu: a página embute a MESMA tabela da aba Tarefas (L1) em vez de uma segunda lista de certidões", !existsSync("src/components/torre/ProcessoCertidoes.tsx") && !/ProcessoCertidoes/.test(detalhe))
  ok("o Foco é a PÁGINA do processo: mostra 'Pausado' e os 4 números (Abertas, Vencidas, Aguardando terceiros, Sem responsável)", /Pausado/.test(ler("src/components/torre/ProcessoCabecalho.tsx")) && /"Aguardando terceiros", d\.numeros\.comCartorio/.test(ler("src/components/torre/ProcessoCabecalho.tsx")))
  ok("a janela 'Foco da família' foi removida: nem o arquivo, nem o 'abrirFoco', e '?processo=' sozinho redireciona à página", !existsSync("src/components/torre/FocoFamilia.tsx") && !/FocoFamilia|abrirFoco/.test(torre) && /router\.replace\(`\/torre\/processo\/\$\{paraPaginaDoProcesso\}`\)/.test(torre))

  secao("8 — aba Terceiros: lista ÓRGÃOS (não tarefas), SEM placar por cartório (nem ranking, nem média por órgão)")
  const terc = ler("src/components/torre/TorreTerceiros.tsx")
  ok("saíram as colunas 'Sem resposta (dias)' e 'Não localizada' por cartório", !/Sem resposta \(dias\)/.test(terc) && !/Não localizada/.test(semComentarios(terc)) && !/semResposta\.tarefas|naoLocalizada/.test(semComentarios(terc).replace(/interface OrgaoTerceiro[\s\S]*?\n\}/, "")))
  ok("a nota diz que a aba lista ÓRGÃOS, não tarefas, e que não há ranking nem média por cartório", /lista ÓRGÃOS, não tarefas/.test(terc) && /Não há ranking nem média por cartório/.test(terc))
  const reguaTsx = ler("src/components/torre/TerceirosRegua.tsx")
  ok("saíram as colunas 'Sem resposta (dias)' e 'Não localizada' por cartório (também da régua)", !/Sem resposta \(dias\)/.test(terc + reguaTsx) && !/Não localizada/.test(semComentarios(terc + reguaTsx)) && !/semResposta|naoLocalizada/.test(semComentarios(terc + reguaTsx)))
  ok("a Régua, os Contatos do órgão, o tempo médio e o backlog continuam na aba", /<TerceirosRegua/.test(terc) && /Régua de cobrança por órgão/.test(reguaTsx) && /abrirContatos\(o\)/.test(reguaTsx) && /Tempo médio real por fase/.test(reguaTsx) && /Backlog/.test(reguaTsx))
  ok("a lista é POR ÓRGÃO (data-testid terceiros-orgaos, 'Órgão · Pedidos · A cobrar · Escaladas'); os pedidos (tarefas) moram em Tarefas via link; 'Cobrar este órgão' e 'Cobrar todos os vencidos' seguem ligados", /data-testid="terceiros-orgaos"/.test(terc) && /<span>Órgão<\/span><span>Pedidos<\/span><span>A cobrar<\/span><span>Escaladas<\/span>/.test(terc) && /\/torre\?aba=tarefas&visao=aguard&orgao=\$\{g\.orgaoId\}/.test(terc) && /cobrarCartorio\(g\.orgaoId!/.test(terc) && /\/api\/torre\/terceiros\/cobrar/.test(terc) && /\/api\/torre\/terceiros\/\$\{orgaoId\}\/cobrar/.test(terc))

  secao("9 — Equipe pelo país: o servidor recorta as MESMAS linhas antes de somar a carga")
  const c = await montarCenario(MARCA)
  try {
    const admin = await prisma.usuario.create({ data: { nome: `${MARCA} Admin`, email: `${MARCA.toLowerCase()}-admin@t.com`, senha: "x", tipo: "admin" } })
    const dono = await prisma.usuario.create({ data: { nome: `${MARCA} Dono`, email: `${MARCA.toLowerCase()}-dono@t.com`, senha: "x", tipo: "assistente", permissoesCustom: { "tarefas.iniciar_concluir": true } } })
    const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: admin.tipo, sessaoInicio: Date.now() })
    const itLabel = (await prisma.catalogoPais.findFirstOrThrow({ orderBy: { id: "asc" } }))
    const outroPais = await prisma.catalogoPais.upsert({ where: { countryKey: "torrea_casca" }, update: {}, create: { countryKey: "torrea_casca", countryLabel: `${MARCA} País B`, nationalityKey: "torrea_casca_n", nationalityLabel: "x" } })
    const a1 = await c.novaObrigacao({ responsavelId: dono.id }), a2 = await c.novaObrigacao({ responsavelId: dono.id }), b1 = await c.novaObrigacao({ responsavelId: dono.id })
    await prisma.processo.updateMany({ where: { id: { in: [a1.processoId, a2.processoId] } }, data: { paisId: itLabel.id } })
    await prisma.processo.update({ where: { id: b1.processoId }, data: { paisId: outroPais.id } })
    const pessoa = async (url: string) => ((await (await getEquipe(req(url, token))).json()).pessoas as Array<{ usuarioId: number; ativas: number; aptidoesPais: string[] }>).find((p) => p.usuarioId === dono.id)
    ok("sem país: a carga é o total (3 tarefas)", (await pessoa("/api/torre/equipe"))?.ativas === 3)
    ok("com ?pais=<país A>: só as 2 tarefas daquele país", (await pessoa(`/api/torre/equipe?pais=${itLabel.countryKey}`))?.ativas === 2)
    ok("com ?pais=<país B>: só 1", (await pessoa(`/api/torre/equipe?pais=${outroPais.countryKey}`))?.ativas === 1)
    ok("país que não existe: 0 (nada inventado)", (await pessoa("/api/torre/equipe?pais=nao_existe"))?.ativas === 0)
    ok("a linha da equipe já traz as aptidões por país (M3) para a tela do dono da Equipe", Array.isArray((await pessoa("/api/torre/equipe"))?.aptidoesPais))
    ok("TorreEquipe pede o recorte ao servidor com o país do cabeçalho", /\/api\/torre\/equipe\$\{pais \? `\?pais=\$\{encodeURIComponent\(pais\)\}` : ""\}/.test(ler("src/components/torre/TorreEquipe.tsx")))
  } finally {
    await c.limpar()
    await prisma.catalogoPais.deleteMany({ where: { countryKey: "torrea_casca" } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
