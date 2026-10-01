// scripts/torre-casca-sete-abas.test.ts
// ============================================================================
// TORRE NOVA, ETAPA A (01/10/2026) — A CASCA: 7 abas na ordem do protótipo, contrato de URL, contadores, cabeçalho, país em todas as
// abas, Briefing SÓ manual, a rota do Processo (página), a Visão geral e a aba Terceiros sem placar por cartório.
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
import { ABAS_DA_TORRE, ABA_INICIAL, IDS_DAS_ABAS, IDS_ANTIGOS_DAS_ABAS, abaDaUrl, ehAbaDaTorre, rotuloDaAba } from "../lib/operacional/torre-abas"
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
  secao("1 — SETE abas, na ORDEM EXATA do protótipo")
  ok("Visão geral · Precisa de você · Radar · Processos · Tarefas · Equipe · Terceiros", ABAS_DA_TORRE.map(([, r]) => r).join(" · ") === "Visão geral · Precisa de você · Radar · Processos · Tarefas · Equipe · Terceiros")
  ok("ids estáveis: visao · precisa · radar · processos · tarefas · equipe · terceiros", IDS_DAS_ABAS.join(",") === "visao,precisa,radar,processos,tarefas,equipe,terceiros")
  const torre = ler("src/components/torre/Torre.tsx")
  ok("o casco usa a lista única (torre-abas.ts) — não reescreve a lista", /export const ABAS: Array<\[Aba, string\]> = ABAS_DA_TORRE/.test(torre) && !/\["precisa", "Precisa de você"\]/.test(torre))
  ok("a aba 'Certidões' não existe (é 'Tarefas'); nem 'Equipe e Terceiros'", !ABAS_DA_TORRE.some(([, r]) => /certid/i.test(r)) && !ABAS_DA_TORRE.some(([, r]) => /Equipe e Terceiros/i.test(r)) && rotuloDaAba("tarefas") === "Tarefas")
  ok("cada aba do casco tem a sua tela montada (visao → TorreVisaoGeral, precisa, radar, processos, tarefas, equipe, terceiros)", ["visao", "precisa", "radar", "processos", "tarefas", "equipe", "terceiros"].every((a) => new RegExp(`aba === "${a}"`).test(torre)) && /<TorreVisaoGeral/.test(torre))

  secao("2 — contrato de URL: ?aba= estável, valores ANTIGOS continuam, sem aba → Visão geral")
  ok("sem ?aba= → visao", ABA_INICIAL === "visao" && abaDaUrl(null) === "visao" && abaDaUrl(undefined) === "visao" && abaDaUrl("") === "visao")
  ok("valor desconhecido → visao (não quebra)", abaDaUrl("xyz") === "visao" && abaDaUrl("Radar") === "visao")
  ok("TODOS os valores antigos continuam válidos (links antigos, avisos gravados, favoritos)", IDS_ANTIGOS_DAS_ABAS.join(",") === "precisa,radar,tarefas,equipe,processos,terceiros" && IDS_ANTIGOS_DAS_ABAS.every((a) => ehAbaDaTorre(a) && abaDaUrl(a) === a))
  ok("'visao' é a aba nova", ehAbaDaTorre("visao") && abaDaUrl("visao") === "visao")
  ok("?aba=regras|integridade|auditoria seguem indo para o Gerenciamento", ["regras", "integridade", "auditoria"].every((a) => !ehAbaDaTorre(a) && destinoDaAbaAntigaDaTorre(a) !== null))
  ok("o casco lê a aba pela lista única e abre em ABA_INICIAL; a URL omite 'aba' só na inicial", /ehAbaDaTorre\(abaUrl\)/.test(torre) && /useState<Aba>\(urlInicial\.aba \?\? ABA_INICIAL\)/.test(torre) && /if \(aba !== ABA_INICIAL\) q\.set\("aba", aba\)/.test(torre))
  ok("os links que o sistema GERA (sino, absorção) continuam apontando para abas válidas", [destinoDaOperacaoParaAdmin("aba=radar"), destinoDaOperacaoParaAdmin("aba=familias"), destinoDaOperacaoParaAdmin("aba=aguardando"), linkDoAvisoParaAdmin("/tarefas", "admin")].every((u) => { const a = new URL(`http://x${u}`).searchParams.get("aba"); return ehAbaDaTorre(a) }))
  ok("?tarefa= / ?visao= / ?processo= continuam levando à aba Tarefas", /tarefa != null \? "tarefas"/.test(torre) && /\(visao \|\| processo != null \? "tarefas"/.test(torre))

  secao("3 — contadores nas abas (números reais, o mesmo que a aba mostra)")
  ok("Precisa de você N = as decisões do país escolhido; Tarefas N = a lista filtrada; Processos N; Equipe N; Terceiros 'N a cobrar'", /k === "precisa"\) return itensPrecisaPais \? \{ txt: String\(itensPrecisaPais\.length\)/.test(torre) && /k === "tarefas"\) return linhas \? \{ txt: String\(nTarefas\)/.test(torre) && /k === "processos"\) return procs \? \{ txt: String\(processosDaAba\.length\)/.test(torre) && /k === "equipe"\) return nEquipe != null/.test(torre) && /`\$\{nCobrar\} a cobrar`/.test(torre))
  ok("Visão geral e Radar não têm contador (como no protótipo)", /return null\n  \}/.test(torre) && !/k === "visao"\) return \{/.test(torre) && !/k === "radar"\) return \{/.test(torre))

  secao("4 — cabeçalho: país (botões), busca, Briefing do dia SÓ manual, Revisar o dia")
  const cab = ler("src/components/torre/TorreCabecalho.tsx")
  ok("botão 'Briefing do dia' e botão 'Revisar o dia (N)'", /☀ Briefing do dia/.test(cab) && /Revisar o dia \(\{nPrecisa/.test(cab))
  ok("a busca existe, com o placeholder de sempre", /placeholder="Buscar família, pessoa, cartório…"/.test(cab))
  ok("o país são botões 'Todos' + um por país cadastrado, com a contagem de processos", /Todos/.test(cab) && /paises\.map/.test(cab) && /p\.n != null/.test(cab) && /aria-pressed/.test(cab))
  ok("todo botão do cabeçalho tem handler", [...cab.matchAll(/<button\b[^>]*>/g)].every((m) => /onClick=/.test(m[0])))
  const torreCod = semComentarios(torre)
  ok("o Briefing NÃO abre sozinho: nada de sessionStorage 'torre-briefing-visto' e setBriefingAberto(true) só no clique do botão", !/sessionStorage|torre-briefing-visto/.test(torreCod) && (torreCod.match(/setBriefingAberto\(true\)/g) ?? []).length === 1 && /onBriefing=\{\(\) => setBriefingAberto\(true\)\}/.test(torreCod))
  ok("o modal só renderiza com briefingAberto", /\{briefingAberto && precisa && \(/.test(torreCod))
  ok("o sino é o do cabeçalho global da página (HeaderBarApp) — a Torre não duplica", /<HeaderBarApp/.test(ler("src/app/torre/page.tsx")) && !/sino/i.test(semComentarios(cab)))

  secao("5 — o PAÍS filtra TODAS as abas (regras puras)")
  const itens = [{ processoId: 1, t: "a" }, { processoId: 2, t: "b" }, { processoId: null, t: "carga" }, { processoId: 3, t: "c" }]
  const mapa = mapaDePaisPorProcesso([{ processoId: 1, pais: "Itália" }, { processoId: 2, pais: "Espanha" }], [{ processoId: 3, pais: "Itália" }, { processoId: 1, pais: "Outro" }])
  ok("o país do processo vem da lista de processos, e das linhas de tarefa quando o processo não está na lista (a 1ª fonte vence)", mapa.get(1) === "Itália" && mapa.get(3) === "Itália" && mapa.get(2) === "Espanha")
  ok("Precisa de você: só as decisões de processos do país; a sem processo (Carga) some", itensDoPais(itens, "Itália", mapa).map((i) => i.t).join() === "a,c" && itensDoPais(itens, "Espanha", mapa).map((i) => i.t).join() === "b")
  ok("sem país escolhido: todas (inclusive as sem processo)", itensDoPais(itens, null, mapa).length === 4)
  ok("contagem de processos por país (botões 'Itália 280')", (() => { const c = contagemDeProcessosPorPais([{ pais: "Itália" }, { pais: "Itália" }, { pais: "Espanha" }, { pais: null }]); return c.get("Itália") === 2 && c.get("Espanha") === 1 && c.size === 2 })())
  ok("Tarefas · Terceiros · KPIs recortam as linhas por país; Radar · Processos os processos; Equipe pelo servidor", /linhasPais = useMemo/.test(torre) && /<TorreTerceiros linhas=\{linhasPais\}/.test(torre) && /processosFiltrados/.test(torre) && /<TorreEquipe versao=\{versao\} pais=\{pais\}/.test(torre) && /itensPrecisaPais/.test(torre))

  secao("6 — Visão geral: renderiza o topo de hoje (frase + Situação + Agenda via TorreKpis)")
  const visao = ler("src/components/torre/TorreVisaoGeral.tsx")
  ok("TorreVisaoGeral existe e delega ao TorreKpis (frase + faixas SITUAÇÃO e AGENDA)", /<TorreKpis/.test(visao) && /export function TorreVisaoGeral/.test(visao))
  ok("o contrato de props já traz o que o dono da aba vai precisar (linhas e processos do país, decisões, tendência, navegação)", ["linhas", "processos", "itensPrecisa", "agora", "tend", "filtrandoPais", "kpiAtivo", "onEscolherKpi", "onProcessos", "onRisco", "irParaAba"].every((p) => new RegExp(`\\b${p}\\b`).test(visao)))
  ok("o topo NÃO fica mais acima das abas (só na Visão geral)", !/<TorreKpis/.test(torre) && /<TorreVisaoGeral/.test(torre))
  ok("a Visão geral não usa relógio no render (hidratação)", !/new Date\(|Date\.now\(/.test(semComentarios(visao)))

  secao("7 — o Processo é uma PÁGINA (/torre/processo/[id]) com o mesmo portão da Torre")
  const rota = "src/app/torre/processo/[id]/page.tsx"
  ok("a rota existe", existsSync(rota))
  const pag = semComentarios(ler(rota))
  ok("mesmo portão: useIsClient antes de renderizar; só admin/gerência operacional; volta para /operacao", /const mounted = useIsClient\(\)/.test(pag) && /if \(!mounted \|\| carregando \|\| !autorizado\) return CARREGANDO/.test(pag) && /user\.tipo === "admin" \|\| pode\("operacao\.distribuirTarefas"\)/.test(pag) && /router\.push\("\/operacao"\)/.test(pag))
  ok("nada é renderizado antes do portão (cabeçalho e página do processo)", pag.indexOf("<HeaderBarApp") > pag.indexOf("if (!mounted") && pag.indexOf("<TorreProcessoPagina") > pag.indexOf("if (!mounted"))
  const detalhe = ler("src/components/torre/TorreProcessoPagina.tsx") + ler("src/components/torre/ProcessoCabecalho.tsx")
  ok("o Detalhe mostra dados reais (/api/torre/foco/{id}?detalhe=1), a trilha, o selo 'Pausado' e a página completa (a casca da Etapa A foi preenchida pela frente H)", /\/api\/torre\/foco\/\$\{processoId\}\?detalhe=1/.test(detalhe) && /href="\/torre\?aba=processos"|\/torre\?aba=processos/.test(detalhe) && /Pausado/.test(detalhe) && /<ProcessoCabecalho/.test(detalhe) && /<ProcessoCertidoes/.test(detalhe))
  ok("o Foco (modal) continua funcionando e mostra 'Pausado' quando o processo está pausado", /Pausado/.test(ler("src/components/torre/FocoFamilia.tsx")) && existsSync("src/components/torre/FocoFamilia.tsx"))
  ok("a aba Processos continua abrindo o Foco por 'abrirFoco' (nada quebrou)", /abrirFoco=\{setFoco\}/.test(torre) && /\{foco != null && <FocoFamilia/.test(torre))

  secao("8 — aba Terceiros: SEM placar por cartório (nem ranking, nem média por órgão)")
  const terc = ler("src/components/torre/TorreTerceiros.tsx")
  ok("saíram as colunas 'Sem resposta (dias)' e 'Não localizada' por cartório", !/Sem resposta \(dias\)/.test(terc) && !/Não localizada/.test(semComentarios(terc)) && !/semResposta\.tarefas|naoLocalizada/.test(semComentarios(terc).replace(/interface OrgaoTerceiro[\s\S]*?\n\}/, "")))
  ok("a nota diz que não há ranking nem média por cartório", /não há ranking nem média por cartório/.test(terc))
  const reguaTsx = ler("src/components/torre/TerceirosRegua.tsx")
  ok("saíram as colunas 'Sem resposta (dias)' e 'Não localizada' por cartório (também da régua)", !/Sem resposta \(dias\)/.test(terc + reguaTsx) && !/Não localizada/.test(semComentarios(terc + reguaTsx)) && !/semResposta|naoLocalizada/.test(semComentarios(terc + reguaTsx)))
  ok("a Régua, os Contatos do órgão, o tempo médio e o backlog continuam na aba", /<TerceirosRegua/.test(terc) && /Régua de cobrança por órgão/.test(reguaTsx) && /abrirContatos\(o\)/.test(reguaTsx) && /Tempo médio real por fase/.test(reguaTsx) && /Backlog/.test(reguaTsx))
  ok("a lista é POR PEDIDO e as ações (Cobrar / Ver / Contatos) seguem lá, ligadas", /setCobrar\(p\)/.test(terc) && /setContatos\(p\)/.test(terc) && /\/api\/torre\/terceiros\/cobrar/.test(terc) && /Ver<\/button>/.test(terc))

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
