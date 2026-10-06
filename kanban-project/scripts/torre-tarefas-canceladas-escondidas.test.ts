// scripts/torre-tarefas-canceladas-escondidas.test.ts
// GUARDA (06/10/2026) — Torre › aba Tarefas: cancelada / não exigida NÃO aparece por padrão; o número do cabeçalho do grupo é SEMPRE o das linhas mostradas;
// o controle do grupo («+ 4 canceladas / não exigidas») as mostra, riscadas, na posição da regra de ordem. Mesmo comportamento da página do processo.
// + árvore: o aviso dos ajustes manuais não cobre o cartão do requerente (fica logo abaixo dele, em qualquer largura).
import { readFileSync } from "node:fs"
import { textoDoCabecalho } from "../src/components/torre/TarefasTabela"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const ler = (p: string) => readFileSync(p, "utf8")

console.log("Cabeçalho do grupo = linhas mostradas")
ok("por padrão (canceladas escondidas): «7 tarefas» com 7 linhas", textoDoCabecalho(7, 7, 4, false) === "7 tarefas")
ok("singular", textoDoCabecalho(1, 1, 3, false) === "1 tarefa")
ok("com as canceladas à mostra: «11 (7 ativas + 4 canceladas / não exigidas)» com 11 linhas", textoDoCabecalho(11, 7, 4, true) === "11 (7 ativas + 4 canceladas / não exigidas)")
ok("uma cancelada só: singular", textoDoCabecalho(8, 7, 1, true) === "8 (7 ativas + 1 cancelada / não exigida)")

const t = ler("src/components/torre/TarefasTabela.tsx")
console.log("\nA tela")
ok("canceladas escondidas por padrão (estado vazio) e o grupo mostra só o trabalho", /useState<Set<string>>\(\(\) => new Set\(\)\)/.test(t) && /const mostradas = mostrarCanc \? itens : trabalho/.test(t))
ok("o número do cabeçalho vem das linhas mostradas (textoDoCabecalho com mostradas.length)", /textoDoCabecalho\(mostradas\.length, trabalho\.length, nCanceladas, mostrarCanc\)/.test(t))
ok("as linhas desenhadas são as mostradas (o resumo e o «dentro da família» também)", /: mostradas\.map\(renderLinha\)/.test(t) && /agruparDentroDaFamilia\(mostradas, dentro\)/.test(t))
ok("o controle do grupo: «+ N canceladas / não exigidas» / «Ocultar …»", /`\+ \$\{nCanceladas\} /.test(t) && /Ocultar \$\{nCanceladas\}/.test(t))
ok("a posição é a da regra de ordem: o agrupamento ordena TODAS (inclui canceladas) pela regra fixa, sem «canceladas no fim»", /ordenarLinhasDeCertidao\(itens\)/.test(ler("lib/operacional/torre-tarefas-tela.ts")) && !/filter\(\(x\) => x\.statusTarefa === 'CANCELADA'\)/.test(ler("lib/operacional/torre-tarefas-tela.ts")))

console.log("\nÁrvore: o aviso não cobre o cartão do requerente")
const arv = ler("src/components/arvore/react-flow-tree.tsx"), cartao = ler("src/components/arvore/inteligencia/cartoes-flutuantes.tsx")
ok("os dois estados do cartão (resumo e chip) são marcados para medição", (cartao.match(/data-cartao-requerente/g) ?? []).length === 2)
ok("o aviso mede o cartão e fica logo abaixo (ResizeObserver + janela), sem posição fixa", /querySelector<HTMLElement>\("\[data-cartao-requerente\]"\)/.test(arv) && /new ResizeObserver\(medir\)/.test(arv) && /top: topoDoAviso/.test(arv))

console.log(`\n${passou} ok, ${falhou} falha(s)`)
if (falhou) { console.log(falhas.join("\n")); process.exit(1) }
