// scripts/torre-foco-um-so-comportamento.test.ts
// "Foco" na Torre tem UM comportamento só: link de verdade (href) para /torre/processo/[id]. Nenhum botão abre mais a janela "Foco da família".
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}`) } }
const ler = (p: string) => readFileSync(p, "utf8")
const dir = "src/components/torre"

const tabela = ler(join(dir, "TarefasTabela.tsx"))
ok('aba Tarefas: "Foco ›" é <Link href="/torre/processo/{id}">', /<Link[^>]*className="foco"[^>]*href=\{`\/torre\/processo\/\$\{processoId\}`\}[^>]*>Foco ›<\/Link>/.test(tabela))
ok('aba Tarefas: não sobrou botão "Foco" nem a propriedade onFocoDaFamilia', !/<button[^>]*className="foco"/.test(tabela) && !tabela.includes("onFocoDaFamilia"))
const procs = ler(join(dir, "TorreProcessos.tsx"))
ok('aba Processos: "Foco" é <Link href="/torre/processo/{id}">', /<Link href=\{`\/torre\/processo\/\$\{p\.processoId\}`\}[^>]*>Foco<\/Link>/.test(procs))

const usos: string[] = []
for (const f of readdirSync(dir)) {
  if (!/\.tsx?$/.test(f) || f === "torre-base.tsx" || f === "Torre.tsx") continue
  if (/abrirFoco\s*[(,}=)]|onFocoDaFamilia/.test(ler(join(dir, f)))) usos.push(f)
}
ok("nenhum componente da Torre chama abrirFoco (a janela não abre por botão)", usos.length === 0 && !/abrirFoco/.test(ler(join(dir, "TorreTarefas.tsx"))))
ok("a janela segue no código (FocoFamilia) — só abre por ?processo= na URL, sem botão", ler(join(dir, "Torre.tsx")).includes("<FocoFamilia"))
console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
