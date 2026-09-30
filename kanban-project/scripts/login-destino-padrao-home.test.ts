/**
 * E2 — login novo vai à Página Inicial (/dashboard, a Home; "/" redireciona para ela) e nenhum código
 * restaura "última página". Sem banco. Rodar: node scripts/ci/gate-build.mjs --so login-destino-padrao-home
 */
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8")
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
let falhas = 0
function ok(c: boolean, n: string) { if (c) console.log(`  ✅ ${n}`); else { falhas++; console.log(`  ❌ ${n}`) } }

const auth = semComentarios(ler("src/components/auth.tsx"))
ok(/redirectTo = "\/dashboard"/.test(auth), "destino padrão do login = /dashboard (Home)")
ok(/window\.location\.href = redirectTo/.test(auth), "login bem-sucedido navega para o destino padrão")
ok(!/\/kanban/.test(auth), "auth.tsx não navega para /kanban")
ok(!/<AuthComponent[^>]*redirectTo/.test(ler("src/app/login/page.tsx")), "a página de login não sobrescreve o destino")
ok(/router\.replace\("\/dashboard"\)/.test(semComentarios(ler("src/app/page.tsx"))), "'/' redireciona para a Home (/dashboard)")
const mw = semComentarios(ler("middleware.ts"))
ok(!/\/kanban/.test(mw), "middleware não redireciona para /kanban")
const dash = ler("src/app/dashboard/page.tsx")
ok(/HomeContent|Meu Trabalho/.test(dash), "/dashboard é a Página Inicial (Home)")
// nenhum mecanismo de "restaurar última página"
import { readdirSync, statSync } from "fs"
function walk(d: string): string[] { return readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] }) }
const fontes = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "lib"))].filter((p) => /\.(ts|tsx)$/.test(p) && !p.includes("/scripts/"))
const restaura = fontes.filter((p) => /ultimaRota|lastPath|lastVisited|ultimaPagina|returnTo|callbackUrl/.test(readFileSync(p, "utf8")))
ok(restaura.length === 0, `nenhuma restauração de última página no código (${restaura.length} ocorrências)`)

console.log(falhas === 0 ? "\n✅ PASSOU" : `\n❌ FALHOU (${falhas})`)
if (falhas) process.exit(1)
