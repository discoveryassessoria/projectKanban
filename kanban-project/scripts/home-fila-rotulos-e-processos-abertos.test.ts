/**
 * B8 + B9 — fila da Home sem status cru; "Meus processos" não existe onde a lista é por permissão.
 * Sem banco. Rodar: node scripts/ci/gate-build.mjs --so home-fila-rotulos-e-processos-abertos
 */
import { readFileSync, readdirSync, statSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { rotuloStatusTarefa, rotuloMotivoPendencia, ROTULO_STATUS } from "../src/lib/home/rotulo-status-tarefa"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8")
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
let falhas = 0
function ok(c: boolean, n: string) { if (c) console.log(`  ✅ ${n}`); else { falhas++; console.log(`  ❌ ${n}`) } }

// B8 — rótulos
ok(rotuloStatusTarefa("NAO_INICIADA") === "A iniciar", "NAO_INICIADA -> rótulo do vocabulário oficial (A iniciar, igual à coluna Status da Operação), nunca 'nao iniciada'")
ok(rotuloStatusTarefa("AGUARDANDO_TERCEIRO") === "Aguardando terceiros", "AGUARDANDO_TERCEIRO em português (mesmo da coluna Status da Operação)")
ok(rotuloStatusTarefa("CANCELADA") === "Cancelada", "CANCELADA != Concluída")
ok(rotuloStatusTarefa("XPTO") === null && rotuloStatusTarefa(null) === null, "status desconhecido não vaza cru")
ok(Object.values(ROTULO_STATUS).every((v) => !/_/.test(v) && v === v.charAt(0).toUpperCase() + v.slice(1)), "nenhum rótulo com underscore/minúscula")
ok(rotuloMotivoPendencia("SEM_PRECO") === "Sem preço" && !/_/.test(rotuloMotivoPendencia("QUALQUER_COISA")), "motivo de pendência financeira em português")
const kit = ler("src/components/operacao/kit-operacional.tsx")
ok(/export \{ ROTULO_STATUS \} from "@\/src\/lib\/home\/rotulo-status-tarefa"/.test(kit) && !/NAO_INICIADA: "A fazer"/.test(kit), "kit da Operação reexporta o MESMO mapa (um só)")
const coleta = semComentarios(ler("src/lib/home/coleta.ts"))
ok(/rotuloStatusTarefa\(t\.statusTarefa\)/.test(coleta), "coleta da fila usa o mapa")
ok(!/statusTarefa\??\.replace\(/.test(coleta) && !/motivo\.replace\(/.test(coleta), "coleta não faz replace('_',' ') de enum")

// varredura: nenhuma página /dashboard/fila/* nem componente de fila mostra enum cru
function walk(d: string): string[] { return readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] }) }
const paginasFila = walk(join(ROOT, "src/app/dashboard/fila")).filter((p) => /\.tsx?$/.test(p))
ok(paginasFila.length > 0, "há páginas de fila para varrer")
for (const p of [...paginasFila, join(ROOT, "src/components/home/fila-agrupada.tsx")]) {
  const s = semComentarios(readFileSync(p, "utf8"))
  ok(!/statusTarefa|\.status\b[^\n]*toLowerCase|replace\(\/_\/g/.test(s), `${p.replace(ROOT + "/", "")}: sem status cru/replace de enum`)
  ok(!/Centro Operacional/.test(s), `${p.replace(ROOT + "/", "")}: sem texto antigo "Centro Operacional"`)
}
ok(/Voltar à Operação/.test(ler("src/app/dashboard/fila/[key]/page.tsx")), "botão diz 'Voltar à Operação'")

// B9 — Home
const home = ler("src/components/home/home-content.tsx")
ok(!/titulo: "Meus processos"/.test(home), "Home não rotula a lista por permissão como 'Meus processos'")
ok(/titulo = "Processos abertos"/.test(ler("src/components/home/processos-andamento.tsx")), "título padrão: Processos abertos")
const rota = ler("src/app/api/home/processos/route.ts")
ok(/escopoProcesso\(escopoUsuario\)/.test(rota), "a rota lista por escopoProcesso (permissão de módulo), não por ownership")
ok(/export function escopoProcesso\([^)]*\)[^{]*\{\s*return \{\}\s*\}/.test(ler("src/lib/autorizacao/escopo-operacional.ts")), "escopoProcesso não filtra por responsável (CLAUDE.md §14)")

console.log(falhas === 0 ? "\n✅ PASSOU" : `\n❌ FALHOU (${falhas})`)
if (falhas) process.exit(1)
