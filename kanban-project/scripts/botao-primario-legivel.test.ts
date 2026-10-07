// scripts/botao-primario-legivel.test.ts
// ============================================================================
// BOTÃO LEGÍVEL (07/10/2026). Neste tema `text-white` é a TINTA do vidro (graphite), não o branco: `bg-[var(--accent-primary)] text-white` saía graphite sobre
// azul-marinho (ilegível) e `disabled:opacity-50` apagava o resto. Regras no globals.css: texto branco de verdade sobre o fundo primário e desabilitado legível.
// Esta guarda também proíbe `text-white` sobre fundo colorido forte (bg-red-600 …): ali o branco é `text-pure`.
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
let ok = 0, falhou = 0
const check = (c: boolean, n: string, d = "") => { if (c) { ok++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`) } }
const css = readFileSync("src/app/globals.css", "utf8")
check(/\[class\*="bg-\[var\(--accent-primary\)\]"\]\.text-white[\s\S]{0,300}color: var\(--color-pure\) !important/.test(css), "texto branco de verdade sobre o fundo primário (--accent-primary e --action-primary)")
check(/--action-primary\)\]"\]\.text-white/.test(css), "o mesmo para --action-primary")
check(/button:disabled\[class\*="bg-\[var\(--accent-primary\)\]"\][\s\S]{0,400}opacity: 1 !important/.test(css), "botão primário desabilitado fica legível (sem opacity-50 apagando o texto)")
const varrer = (d: string, o: string[] = []): string[] => { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) varrer(f, o); else if (f.endsWith(".tsx")) o.push(f) } return o }
const cor = /bg-(red|green|blue|emerald|amber|orange|indigo|violet|purple|rose|sky|teal|cyan)-[5-9]00/
const ruins: string[] = []
for (const f of varrer("src")) for (const m of readFileSync(f, "utf8").matchAll(/(["'`])([^"'`]*)\1/g)) if (cor.test(m[2]) && /(?<![\w/-])text-white(?![\w/-])/.test(m[2])) ruins.push(f)
check(ruins.length === 0, "nenhum fundo colorido forte usa text-white (usa text-pure)", [...new Set(ruins)].join(", "))
console.log(`\n${falhou === 0 ? "✅" : "❌"} BOTÃO LEGÍVEL — ${ok} ok, ${falhou} falhas`)
if (falhou) process.exit(1)
