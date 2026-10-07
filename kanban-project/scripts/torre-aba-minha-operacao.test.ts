// scripts/torre-aba-minha-operacao.test.ts
// ============================================================================
// GUARDA — "Minha operação" SAIU da Torre (consolidação de 06/10/2026, Lei da Torre). Antes (mesmo dia, mais cedo) ela era uma aba que montava o
// OperacaoV3 dentro da Torre; agora a Torre tem 5 abas (Hoje · Tarefas · Famílias · Equipe · Terceiros) e a tela de quem EXECUTA mora só em
// `/operacao`, aberta também para o administrador, sem redirecionamento. (O nome do arquivo ficou: é a guarda dessa aba.)
//   npx tsx scripts/torre-aba-minha-operacao.test.ts
// ============================================================================
import { existsSync, readFileSync } from "node:fs"
import { ABAS_DA_TORRE, IDS_DAS_ABAS, ABA_ANTIGA_PARA_NOVA, abaDaUrl, destinoDeAbaQueSaiu, ehAbaDaTorre } from "../lib/operacional/torre-abas"
import { destinoDaOperacaoParaAdmin, temAcessoATorre, linkDoAvisoParaAdmin } from "../src/lib/torre-absorcao"
import { contagemDaVisao, type LinhaParaVisao } from "../lib/operacional/torre-tarefas-tela"
import { VISOES_TORRE } from "../lib/operacional/torre-visoes"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const ler = (p: string) => readFileSync(p, "utf8")
const sem = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")

console.log("A aba saiu da Torre")
const ids = ABAS_DA_TORRE.map(([id]) => id as string)
ok("«Minha operação» NÃO é aba: as 5 abas são hoje, tarefas, familias, equipe, terceiros", !ids.includes("minha") && !ABAS_DA_TORRE.some(([, r]) => /Minha opera/i.test(r)) && ids.join(",") === "hoje,tarefas,familias,equipe,terceiros")
ok("?aba=minha não é aba da Torre, não tem selo e leva para FORA da Torre (/operacao)", !ehAbaDaTorre("minha") && !(IDS_DAS_ABAS as readonly string[]).includes("minha") && "fora" in ABA_ANTIGA_PARA_NOVA.minha && destinoDeAbaQueSaiu("minha") === "/operacao" && abaDaUrl("minha") === "hoje")

console.log("\nO casco não monta mais a Operação")
const torre = ler("src/components/torre/Torre.tsx")
const codTorre = sem(torre)
ok("a Torre não importa OperacaoV3 nem monta aba 'minha'; o selo de 'minha' (contagemDaVisao) saiu do casco", !/OperacaoV3|aba === "minha"|k === "minha"/.test(codTorre) && !/contagemDaVisao\("minhas"/.test(codTorre))
ok("a Torre leva o ?aba=minha ao endereço de fora (router.replace) em vez de montar tela", /destinoDeAbaQueSaiu\(params\.get\("aba"\)\)/.test(codTorre) && /router\.replace\(destinoAntigo\)/.test(codTorre))

console.log("\n/operacao é a tela de quem executa — para TODOS, sem redirecionar")
const pg = ler("src/app/operacao/page.tsx")
ok("/operacao monta o OperacaoV3 (a fila do usuário logado), também para o administrador", /import \{ OperacaoV3 \} from "@\/src\/components\/operacao\/operacao-v3"/.test(pg) && pg.includes("<OperacaoV3 gestor="))
ok("/operacao NÃO redireciona mais ninguém para a Torre (sem temAcessoATorre/destinoDaOperacaoParaAdmin/router.replace)", !/temAcessoATorre|destinoDaOperacaoParaAdmin|router\.replace/.test(sem(pg)))
const menu = ler("src/components/bitrix-sidebar.tsx")
const blocoOp = menu.slice(menu.indexOf('url: "/operacao"'), menu.indexOf('url: "/operacao"') + 400).split("},")[0]
ok("o menu mostra a Operação também ao administrador (sem escondeParaAdmin nem soAdmin)", menu.includes('url: "/operacao"') && !/escondeParaAdmin|soAdmin/.test(blocoOp))
const op = ler("src/components/operacao/operacao-v3.tsx")
const rota = ler("src/app/api/operacao/tarefas/route.ts")
ok("a leitura é a fila do TOKEN (visao=minha_fila, sem usuarioId/escopo na query): nunca a de outra pessoa", /visao=minha_fila&porPagina=500/.test(op) && !/usuarioId=|escopo=/.test(op.slice(op.indexOf("function useOperacaoV3Dados"), op.indexOf("// ── TIPO DE ABA"))))
ok("a rota só aceita outro usuário com escopo de equipe autorizado (token manda)", /Sempre o usuário do TOKEN/.test(rota))

console.log("\nLinks: o caso 'minha' cai em /operacao; o resto da absorção não mudou")
ok("sem parâmetro → /operacao", destinoDaOperacaoParaAdmin("") === "/operacao")
ok("?aba=aguardando → /operacao?aba=aguardando (aba interna da Operação)", destinoDaOperacaoParaAdmin("aba=aguardando") === "/operacao?aba=aguardando")
ok("aviso de família continua na página do processo; tarefa continua no drawer", destinoDaOperacaoParaAdmin("processo=651") === "/torre/processo/651" && destinoDaOperacaoParaAdmin("taskId=9") === "/torre?aba=tarefas&tarefa=9")
ok("acesso à Torre = admin ou operacao.distribuirTarefas", temAcessoATorre("admin", () => false) && temAcessoATorre("gerente", (c) => c === "operacao.distribuirTarefas") && !temAcessoATorre("assistente", () => false) && !temAcessoATorre(null, () => false))
ok("link do sino de quem NÃO é admin volta como veio; o do admin para /operacao também fica em /operacao", linkDoAvisoParaAdmin("/operacao?aba=fila", "assistente") === "/operacao?aba=fila" && linkDoAvisoParaAdmin("/operacao?aba=fila", "admin") === "/operacao")

console.log("\nO resto da Torre não muda")
const lin = (o: Partial<LinhaParaVisao>) => ({ responsavelId: null, ...o }) as LinhaParaVisao
const linhas = [lin({ responsavelId: 7 }), lin({ responsavelId: 7 }), lin({ responsavelId: 9 }), lin({ responsavelId: null })]
ok("a visão «Minhas» da aba Tarefas continua existindo e conta só as minhas abertas", (VISOES_TORRE as readonly string[]).includes("minhas") && /\['minhas', 'Minhas'\]/.test(ler("lib/operacional/torre-tarefas-tela.ts")) && contagemDaVisao("minhas", linhas, 7, new Date()) === 2 && contagemDaVisao("minhas", linhas, null, new Date()) === 0)
ok("a leitura da Torre (/api/torre/tarefas) segue sem filtrar o administrador: nada de `usuarioId !==` para esconder tarefa dele", !/responsavelId !== (usuarioId|permissoes)/.test(torre))
ok("o arquivo da Operação (operacao-v3.tsx) segue existindo — ela só mudou de lugar de montagem", existsSync("src/components/operacao/operacao-v3.tsx"))

console.log(`\n${passou} ok, ${falhou} falha(s)`)
if (falhou) { console.log(falhas.join("\n")); process.exit(1) }
