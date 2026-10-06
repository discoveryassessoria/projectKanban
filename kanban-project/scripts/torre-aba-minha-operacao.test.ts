// scripts/torre-aba-minha-operacao.test.ts
// ============================================================================
// GUARDA — aba "Minha operação" da Torre (06/10/2026). Quem acessa a Torre e também executa tarefa usa a MESMA tela de Operação da equipe,
// só com as tarefas dele.
//   npx tsx scripts/torre-aba-minha-operacao.test.ts
// ============================================================================
import { readFileSync } from "node:fs"
import { ABAS_DA_TORRE, ehAbaDaTorre } from "../lib/operacional/torre-abas"
import { seloVisivel } from "../lib/operacional/torre-casca"
import { destinoDaOperacaoParaAdmin, temAcessoATorre, linkDoAvisoParaAdmin } from "../src/lib/torre-absorcao"
import { contagemDaVisao, type LinhaParaVisao } from "../lib/operacional/torre-tarefas-tela"
import { VISOES_TORRE } from "../lib/operacional/torre-visoes"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const ler = (p: string) => readFileSync(p, "utf8")

console.log("A aba")
const ids = ABAS_DA_TORRE.map(([id]) => id)
ok("«Minha operação» existe, logo depois de Tarefas", ids[ids.indexOf("tarefas") + 1] === "minha" && ABAS_DA_TORRE.find(([id]) => id === "minha")?.[1] === "Minha operação", ids.join(","))
ok("?aba=minha é válida; o selo (contador) aparece na Visão geral, em Tarefas e nela mesma", ehAbaDaTorre("minha") && seloVisivel("minha", "visao") && seloVisivel("minha", "tarefas") && seloVisivel("minha", "minha") && !seloVisivel("minha", "equipe"))

console.log("\nO MESMO componente, só as tarefas do usuário logado")
const torre = ler("src/components/torre/Torre.tsx")
ok("a Torre importa OperacaoV3 do módulo da Operação (não uma cópia) e o monta na aba", /import \{ OperacaoV3 \} from "@\/src\/components\/operacao\/operacao-v3"/.test(torre) && /aba === "minha" && <OperacaoV3 gestor naTorre/.test(torre))
const op = ler("src/components/operacao/operacao-v3.tsx")
const pg = ler("src/app/operacao/page.tsx")
ok("/operacao monta o MESMO OperacaoV3", /import \{ OperacaoV3 \} from "@\/src\/components\/operacao\/operacao-v3"/.test(pg) && pg.includes("<OperacaoV3 gestor="))
ok("a leitura é a fila do TOKEN (visao=minha_fila, sem usuarioId/escopo na query): nunca a de outra pessoa", /visao=minha_fila&porPagina=500/.test(op) && !/usuarioId=|escopo=/.test(op.slice(op.indexOf("function useOperacaoV3Dados"), op.indexOf("// ── TIPO DE ABA"))))
const rota = ler("src/app/api/operacao/tarefas/route.ts")
ok("a rota só aceita outro usuário com escopo de equipe autorizado (token manda)", /Sempre o usuário do TOKEN/.test(rota))
ok("dentro da Torre a URL é da Torre: ?aba=/?processo= não mexem na Operação", /naTorre \? abaDaUrl\(abaInicial\)/.test(op) && /const processoFiltro = naTorre \? null/.test(op))

console.log("\nO contador")
const lin = (o: Partial<LinhaParaVisao>) => ({ responsavelId: null, ...o }) as LinhaParaVisao
const linhas = [lin({ responsavelId: 7 }), lin({ responsavelId: 7 }), lin({ responsavelId: 9 }), lin({ responsavelId: null })]
ok("conta só as minhas abertas (mesmo predicado da visão «Minhas»)", contagemDaVisao("minhas", linhas, 7, new Date()) === 2 && contagemDaVisao("minhas", linhas, null, new Date()) === 0)
ok("a Torre usa esse predicado no selo da aba", /k === "minha"\) return linhas \? \{ txt: String\(contagemDaVisao\("minhas"/.test(torre))

console.log("\n/operacao abre a aba")
ok("sem parâmetro → /torre?aba=minha", destinoDaOperacaoParaAdmin("") === "/torre?aba=minha")
ok("?aba=aguardando → mesma aba, interna Aguardando", destinoDaOperacaoParaAdmin("aba=aguardando") === "/torre?aba=minha&op=aguardando")
ok("aviso de família continua na página do processo; tarefa continua no drawer", destinoDaOperacaoParaAdmin("processo=651") === "/torre/processo/651" && destinoDaOperacaoParaAdmin("taskId=9") === "/torre?aba=tarefas&tarefa=9")
ok("acesso à Torre = admin ou operacao.distribuirTarefas", temAcessoATorre("admin", () => false) && temAcessoATorre("gerente", (c) => c === "operacao.distribuirTarefas") && !temAcessoATorre("assistente", () => false) && !temAcessoATorre(null, () => false))
ok("a página decide por temAcessoATorre; sem acesso, nada muda (a tela fica)", /temAcessoATorre\(user\.tipo, pode\) \? destinoDaOperacaoParaAdmin\(parametros\) : null/.test(pg))
ok("link do sino de quem NÃO é admin volta como veio", linkDoAvisoParaAdmin("/operacao?aba=fila", "assistente") === "/operacao?aba=fila")

console.log("\nO resto da Torre não muda")
ok("a visão «Minhas» da aba Tarefas continua existindo", (VISOES_TORRE as readonly string[]).includes("minhas") && /\['minhas', 'Minhas'\]/.test(ler("lib/operacional/torre-tarefas-tela.ts")))
ok("a leitura da Torre (/api/torre/tarefas) segue sem filtrar o administrador: nada de `usuarioId !==` para esconder tarefa dele", !/responsavelId !== (usuarioId|permissoes)/.test(torre))

console.log(`\n${passou} ok, ${falhou} falha(s)`)
if (falhou) { console.log(falhas.join("\n")); process.exit(1) }
