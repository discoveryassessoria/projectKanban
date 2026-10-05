// scripts/torre-tarefas-blocos.test.ts — aba Tarefas: bloco por família, abrir/recolher e seleção (sem banco).
import { readFileSync } from "node:fs"
import { alternarGrupo, contarSelecionadas, estadoDaSelecaoDoGrupo, expandirTudo, grupoAberto, recolherTudo, textoSelecionadasNoGrupo } from "../lib/operacional/torre-tarefas-grupos"
let passou = 0, falhou = 0
const ok = (n: string, c: boolean, x = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${x}`) } }
const tab = readFileSync("src/components/torre/TarefasTabela.tsx", "utf8")
const css = readFileSync("src/components/torre/tarefas.css", "utf8")

console.log("ITEM 4 — cada família é um bloco")
ok("cada grupo é um bloco (classe tf-bloco) com a faixa como cabeçalho", /className="tf-bloco"/.test(tab) && /className="tf-grp/.test(tab))
ok("bloco: espaço entre blocos, borda forte e cantos", /\.tf-bloco \{[^}]*margin: 16px 12px[^}]*border: 2px solid[^}]*border-radius/.test(css))
ok("bloco usa overflow: clip (hidden quebraria as colunas fixas)", /\.tf-bloco \{[^}]*overflow: clip/.test(css))
ok("a faixa tem borda inferior mais forte que a das linhas", /\.tf-grp \{[^}]*border-bottom: 2px/.test(css))

console.log("ITEM 5 — abrir e recolher (lógica pura)")
const vazio = recolherTudo()
ok("padrão: tudo recolhido", !grupoAberto(vazio, "Fogli") && vazio.size === 0)
const a = alternarGrupo(vazio, "Fogli")
ok("clicar abre; clicar de novo recolhe; não muta o estado anterior", grupoAberto(a, "Fogli") && !grupoAberto(alternarGrupo(a, "Fogli"), "Fogli") && vazio.size === 0)
ok("expandir tudo abre todos; recolher tudo fecha todos", expandirTudo(["A", "B"]).size === 2 && grupoAberto(expandirTudo(["A", "B"]), "B") && recolherTudo().size === 0)
const sel = { 1: true, 3: true } as Record<number, true>
ok("conta só as selecionadas DO grupo", contarSelecionadas([1, 2, 3], sel) === 2 && contarSelecionadas([4, 5], sel) === 0)
ok("recolhido e selecionado: '2 selecionadas' / '1 selecionada'", textoSelecionadasNoGrupo(true, 2) === "2 selecionadas" && textoSelecionadasNoGrupo(true, 1) === "1 selecionada")
ok("aberto ou nada selecionado: sem aviso", textoSelecionadasNoGrupo(false, 2) === null && textoSelecionadasNoGrupo(true, 0) === null)
ok("estado da caixinha: todas / algumas / nenhuma", estadoDaSelecaoDoGrupo([1, 3], sel) === "todas" && estadoDaSelecaoDoGrupo([1, 2], sel) === "algumas" && estadoDaSelecaoDoGrupo([4], sel) === "nenhuma")
console.log(`\n${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
