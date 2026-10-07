// scripts/menu-admin-sem-tarefas-distribuicao.test.ts
// Torre de Controle (30/09/2026; consolidada em 06/10/2026): "Tarefas e Projetos" e "Distribuição" saíram do menu de TODOS;
// a regra pura escondeParaAdmin segue válida; as rotas continuam existindo e redirecionando (nada apagado).
import { readFileSync, existsSync } from "node:fs"
import { itemDeMenuVisivel } from "../src/lib/menu-visibilidade"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}`) } }

const tarefas = { permissao: "tarefas.editar", soAdmin: true, escondeParaAdmin: true }
const distrib = { permissao: "tarefas.editar", escondeParaAdmin: true }
const antesTarefas = { permissao: "tarefas.editar", soAdmin: true }
const antesDistrib = { permissao: "tarefas.editar" }
const adm = { pode: () => true, isAdmin: true }
const comEditar = { pode: (p: string) => p === "tarefas.editar", isAdmin: false }
const semNada = { pode: () => false, isAdmin: false }

ok("admin NÃO vê Tarefas e Projetos", !itemDeMenuVisivel(tarefas, adm))
ok("admin NÃO vê Distribuição", !itemDeMenuVisivel(distrib, adm))
for (const [nome, u] of [["não-admin com tarefas.editar", comEditar], ["não-admin sem permissão", semNada]] as const) {
  ok(`${nome}: Tarefas e Projetos idêntico ao de antes`, itemDeMenuVisivel(tarefas, u) === itemDeMenuVisivel(antesTarefas, u))
  ok(`${nome}: Distribuição idêntica à de antes`, itemDeMenuVisivel(distrib, u) === itemDeMenuVisivel(antesDistrib, u))
}
ok("não-admin com tarefas.editar continua vendo a Distribuição", itemDeMenuVisivel(distrib, comEditar))
ok("item comum (sem a marca) continua visível ao admin", itemDeMenuVisivel({ permissao: "tarefas.ver" }, adm))

const side = readFileSync("src/components/bitrix-sidebar.tsx", "utf8")
const bloco = (url: string) => side.slice(side.indexOf(`url: "${url}"`), side.indexOf(`url: "${url}"`) + 400)
// Consolidação 06/10/2026: os dois itens SAÍRAM do menu de TODOS (não só do admin); a Operação aparece para o admin também.
ok("o menu NÃO tem mais 'Tarefas e Projetos' nem 'Distribuição' (nem url /tarefas, nem /operacao/distribuicao)", !side.includes('url: "/tarefas"') && !side.includes('url: "/operacao/distribuicao"') && !/title: "Tarefas e Projetos"/.test(side) && !/title: "Distribui[cç][aã]o"/.test(side))
ok("a Operação segue no menu, sem soAdmin e sem escondeParaAdmin (o admin também a vê)", side.includes('url: "/operacao"') && !/soAdmin|escondeParaAdmin/.test(bloco("/operacao").split("},")[0]))
ok("a Torre segue no menu só para o admin", /soAdmin: true/.test(bloco("/torre")))
ok("o menu filtra pela função única", side.includes("itemDeMenuVisivel(item"))
ok("as rotas continuam existindo (nada apagado)", existsSync("src/app/tarefas/page.tsx") && existsSync("src/app/operacao/distribuicao/page.tsx"))
const tp = readFileSync("src/app/tarefas/page.tsx", "utf8"), dp = readFileSync("src/app/operacao/distribuicao/page.tsx", "utf8")
ok("e redirecionam para a aba Tarefas da Torre (Lei da Torre, L4)", /redirect\("\/torre\?aba=tarefas"\)/.test(tp) && /redirect\("\/torre\?aba=tarefas"\)/.test(dp) && /\/torre/.test(readFileSync("src/lib/torre-absorcao.ts", "utf8")))

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
