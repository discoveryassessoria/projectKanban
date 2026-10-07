// scripts/torre-casca-integracao.test.ts — Torre nova, INTEGRAÇÃO DO CASCO (01/10/2026): selos das abas (T004–T008), clique em
// "Precisa de você" (T009/T010), rolar ao topo (T011), `?fase=` com dois donos, toast FIXO (T013–T015), Visão geral → onRevisar,
// inicioDaSemana única, cabeçalho (T034/T042).
//   npx tsx scripts/torre-casca-integracao.test.ts   (sem banco)
import { readFileSync } from "node:fs"
import { ABAS_DA_TORRE, type Aba } from "../lib/operacional/torre-abas"
import { seloVisivel, separarFaseDaUrl, preservarFaseDeTarefas, filtrosNaQueryDaAba } from "../lib/operacional/torre-casca"
import { filtrosDaQuery, filtrosVazios, aplicarFiltros, type FiltrosTorre } from "../lib/operacional/torre-filtros"
import { hrefDaFase } from "../lib/operacional/torre-funil-puro"
import { inicioDaSemana } from "../lib/operacional/torre-tendencias"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const ler = (p: string) => readFileSync(p, "utf8")
const sem = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")
const ABAS = ABAS_DA_TORRE.map(([a]) => a)
const ondeAparece = (selo: Aba) => ABAS.filter((a) => seloVisivel(selo, a)).join(",")

console.log("T004–T008 — onde cada selo aparece")
ok("Precisa de você: Visão geral, Processos, Tarefas (nunca Radar, Equipe, Terceiros)", ondeAparece("precisa") === "visao,processos,tarefas")
ok("Processos: Visão geral e Processos", ondeAparece("processos") === "visao,processos")
ok("Tarefas: Visão geral e dentro de Tarefas", ondeAparece("tarefas") === "visao,tarefas")
ok("Equipe: só a Visão geral · Terceiros ('N a cobrar'): só a Visão geral", ondeAparece("equipe") === "visao" && ondeAparece("terceiros") === "visao")
ok("Visão geral e Radar não têm selo em tela nenhuma", ondeAparece("visao") === "" && ondeAparece("radar") === "")

const torre = ler("src/components/torre/Torre.tsx")
const cod = sem(torre)
console.log("\nT009–T011 — clique em 'Precisa de você' e rolar ao topo")
ok("o casco decide o selo por seloVisivel(aba, abaAtual)", /seloVisivel\(k, aba\)/.test(cod))
ok("clique em 'Precisa de você' na Visão geral rola suave até #pdv e NÃO troca de aba", /if \(aba === "visao"\) \{ document\.getElementById\("pdv"\)\?\.scrollIntoView\(\{ behavior: "smooth" \}\); return \}/.test(cod))
ok("clique em 'Precisa de você' nas outras abas vai à Visão geral", /setAba\("visao"\)\s*\n\s*\}/.test(cod) && /onClick=\{\(\) => clicarNaAba\(k\)\}/.test(cod))
ok("as demais abas só trocam de aba", /if \(k !== "precisa"\) \{ setAba\(k\); return \}/.test(cod))
ok("toda troca de aba (clique, link, 'ver equipe') rola a página ao topo; não rola na montagem", /abaAnterior\.current === aba\) return/.test(cod) && /rolarAoTopo\(\)/.test(cod) && /window\.scrollTo\(\{ top: 0 \}\)/.test(cod))
ok("a aba 'precisa' segue existindo (links antigos ?aba=precisa) — leitura: o protótipo a trata como âncora, o casco a mantém como tela de compatibilidade", /aba === "precisa" && <TorrePrecisaDeVoce/.test(cod))

console.log("\nVisão geral → onRevisar (sem contingência de DOM)")
const vg = ler("src/components/torre/TorreVisaoGeral.tsx")
ok("o casco passa onRevisar à Visão geral", /irParaAba=\{setAba\} onRevisar=\{\(\) => itensPrecisaPais && setRevisao\(\[\.\.\.itensPrecisaPais\]\)\}/.test(cod))
ok("a contingência ABRIR_REVISAO_DO_CABECALHO e o querySelector do botão do cabeçalho saíram", !/ABRIR_REVISAO_DO_CABECALHO|tor-cab-btns/.test(vg) && /onRevisar: \(\) => void/.test(vg))

console.log("\n?fase= — filtro de TAREFAS na aba Tarefas, seleção de fase na aba Processos")
const href = hrefDaFase("emissao_documental", { pais: null, q: null })
const q = new URL(`http://x${href}`).searchParams
ok("o funil navega para ?aba=processos&fase=<phaseKey>", q.get("aba") === "processos" && q.get("fase") === "emissao_documental")
const lidos = filtrosDaQuery(q)
ok("(a leitura crua da URL põe a fase em filtros.fase — por isso o casco separa)", lidos.fase.join() === "emissao_documental")
const emProc = separarFaseDaUrl("processos", lidos)
ok("em Processos: a fase vira SELEÇÃO e filtros.fase fica vazio (o selo da aba Tarefas não encolhe)", emProc.faseProcessos === "emissao_documental" && emProc.filtros.fase.length === 0)
const emTar = separarFaseDaUrl("tarefas", lidos)
ok("em Tarefas: segue filtro de tarefas e nada é seleção de Processos", emTar.faseProcessos === null && emTar.filtros.fase.join() === "emissao_documental")
const f0: FiltrosTorre = { ...filtrosVazios(), fase: ["genealogia"] }
ok("reler a URL em Processos preserva o filtro 'Fase' que as Tarefas já tinham", preservarFaseDeTarefas("processos", emProc.filtros, f0).fase.join() === "genealogia" && preservarFaseDeTarefas("tarefas", lidos, f0).fase.join() === "emissao_documental")
ok("o casco NÃO grava filtros.fase na URL quando a aba é Processos; grava nas Tarefas", !new URLSearchParams(filtrosNaQueryDaAba(new URLSearchParams("aba=processos"), "processos", f0)).has("fase") && new URLSearchParams(filtrosNaQueryDaAba(new URLSearchParams("aba=tarefas"), "tarefas", f0)).get("fase") === "genealogia")
ok("fase com formato inválido nunca vira seleção", separarFaseDaUrl("processos", { ...filtrosVazios(), fase: ["a b;c"] }).faseProcessos === null)
// O selo da aba Tarefas (a MESMA aplicarFiltros) não encolhe ao abrir Processos pelo funil.
const linhaBase = (id: number, fase: string) => ({
  id, responsavelId: 1, dataPrazo: null, criadaEm: null, atribuidaEm: null, iniciouEm: null, familiaNome: "Fam", processoNome: null, statusTarefa: "A_FAZER", categoriaDoc: null,
  faseMacroKey: fase, passoCorrente: null, etapaAtual: null, orgaoId: null, terceiroNome: null, prioridade: "MEDIA", atrasada: false, escalada: false,
}) as unknown as Parameters<typeof aplicarFiltros>[0][number]
const linhas = [linhaBase(1, "genealogia"), linhaBase(2, "emissao_documental"), linhaBase(3, "emissao_documental")]
const contexto = { usuarioId: 1, agora: new Date("2026-10-01T15:00:00Z") }
const nSelo = (f: FiltrosTorre) => aplicarFiltros(linhas, f, contexto).mostrando
ok("selo de Tarefas: sem filtro = 3; ao chegar pelo funil em Processos continua 3 (antes encolhia para 2)", nSelo(emProc.filtros) === 3 && nSelo(lidos) === 2)
ok("a aba Processos recebe o pedido: memória de Processos + remontagem por pedido (key)", /pedirFaseDeProcessos\(u\.faseProcessos\)/.test(cod) && /<TorreProcessos key=\{pedidoFase\.n\}/.test(cod))

console.log("\nT013–T015 — toast FIXO")
const base = ler("src/components/torre/torre-base.tsx")
const bc = sem(base)
ok("a Torre usa o provedor com `fixo`", /<TorreProvider\s[^>]*\bfixo\b/.test(cod.replace(/\n/g, " ")))
ok("com `fixo` NÃO há timer: só o ✕ ou outro aviso encerram o toast; sem `fixo` mantém os 6 s (Gerenciamento › Saúde)", /timer\.current = fixo \? null : setTimeout\(\(\) => setToast\(null\), TOAST_AUTOMATICO_MS\)/.test(bc) && /TOAST_AUTOMATICO_MS = 6000/.test(bc))
ok("o ✕ (aria-label 'Fechar aviso') continua", /aria-label="Fechar aviso" onClick=\{\(\) => setToast\(null\)\}/.test(bc))
ok("o toast fica acima de modais e gaveta (z-index 10080 > popover 10060 > gaveta 10002)", /\.tor-toast \{[^}]*z-index: 10080/.test(ler("src/components/torre/torre.css")) && /toast: 10080/.test(ler("src/lib/ui/layers.ts")))
const servico = ler("src/services/torre-acoes-lote.ts")
const janela = sem(ler("lib/operacional/torre-desfazer.ts"))
ok("a janela do cliente = a do servidor = UMA constante (24 h, a do protótipo), em lib/operacional/torre-desfazer.ts", /JANELA_DO_DESFAZER_MS = 24 \* 60 \* 60 \* 1000/.test(janela) && /from "@\/lib\/operacional\/torre-desfazer"/.test(bc) && /from '@\/lib\/operacional\/torre-desfazer'/.test(servico) && !/JANELA_DO_DESFAZER_MS = \d/.test(bc) && !/JANELA_DO_DESFAZER_MS = \d/.test(servico))
ok("Desfazer depois da janela FALHA com mensagem clara (nunca em silêncio) e não chama o servidor à toa", /Date\.now\(\) - toast\.em > JANELA_DO_DESFAZER_MS/.test(bc) && /Não foi possível desfazer: passaram mais de/.test(bc))
ok("Desfazer que o servidor recusa por inteiro mostra a causa", /Não foi possível desfazer: \$\{falha\.mensagem\}/.test(bc))
ok("o relógio só é lido dentro do callback do aviso/clique (nunca no corpo de render)", !/^\s*const \w+ = Date\.now\(\)/m.test(bc))

console.log("\ninicioDaSemana — UMA definição (de São Paulo, não do servidor)")
const funil = ler("lib/operacional/torre-funil.ts"), tend = ler("lib/operacional/torre-tendencias.ts"), semana = ler("lib/operacional/torre-semana.ts"), diario = ler("lib/operacional/indicadores-diarios.ts"), faseDados = ler("lib/operacional/torre-fase-dados.ts")
ok("definida UMA vez (torre-semana.ts → tempo-operacional.ts); funil, tendência, foto diária e Saúde da fase usam a MESMA, sem cópia",
  /export const inicioDaSemana/.test(semana) && /from '\.\/torre-semana'/.test(funil) && /from '\.\/torre-semana'/.test(diario) && /from '\.\/torre-semana'/.test(tend)
  && !/function inicioDaSemana|const inicioDaSemana =/.test(funil + diario + tend) && /import \{[^}]*inicioDaSemanaOperacional[^}]*\} from '\.\/tempo-operacional'/.test(faseDados) && !/function inicioDaSemanaOperacional/.test(faseDados))
const iso = (d: Date) => d.toISOString()
ok("quinta 01/10 → segunda 28/09 00:00 de SP (03:00Z), qualquer que seja o fuso da máquina", iso(inicioDaSemana(new Date("2026-10-01T15:00:00Z"))) === "2026-09-28T03:00:00.000Z")
ok("domingo (inclusive à noite em SP) → a segunda anterior", iso(inicioDaSemana(new Date("2026-10-04T10:00:00Z"))) === "2026-09-28T03:00:00.000Z" && iso(inicioDaSemana(new Date("2026-10-05T01:30:00Z"))) === "2026-09-28T03:00:00.000Z")
ok("segunda 00:30 em SP já é a semana nova", iso(inicioDaSemana(new Date("2026-09-28T03:30:00Z"))) === "2026-09-28T03:00:00.000Z" && iso(inicioDaSemana(new Date("2026-09-28T02:00:00Z"))) === "2026-09-21T03:00:00.000Z")

console.log("\nCabeçalho (T034/T042)")
const cab = ler("src/components/torre/TorreCabecalho.tsx")
ok("busca: 'Buscar família, pessoa, cartório…' (igual ao protótipo)", /placeholder="Buscar família, pessoa, cartório…"/.test(cab))
ok("seletor de país: ordenado por tamanho, sem bandeira no rótulo ('Itália 280')", /paisesPorTamanho\(paises\)\.map/.test(cab) && !/bandeira \?/.test(sem(cab)))

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou === 0 ? 0 : 1)
