/**
 * B7 + B10 — a Central do processo não chama /api/usuarios (403 para assistente); cabeçalho de pessoa sem repetição.
 * Sem banco. Rodar: node scripts/ci/gate-build.mjs --so central-sem-usuarios-403-e-rotulo-grupo
 */
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { rotuloGrupoPessoa } from "../src/lib/documentos/rotulo-grupo-pessoa"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8")
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
let falhas = 0
function ok(c: boolean, n: string) { if (c) console.log(`  ✅ ${n}`); else { falhas++; console.log(`  ❌ ${n}`) } }

// B10
ok(rotuloGrupoPessoa({ lineage: "Linha reta", generation: 1, role: "Geração 1" }) === "Geração 1 · Linha reta", "Geração 1 · Linha reta (uma vez só)")
ok(rotuloGrupoPessoa({ lineage: "Linha reta", generation: 0, role: "Requerente" }) === "Geração 0 · Linha reta · Requerente", "requerente mantém o papel")
ok(rotuloGrupoPessoa({ lineage: "Fora da linha", generation: "—", role: "Cônjuge" }) === "Fora da linha · Cônjuge", "fora da linha não repete")
ok(rotuloGrupoPessoa({ lineage: "Linha reta", generation: "—", role: "Linha reta" }) === "Geração — · Linha reta", "papel igual à linhagem não repete")
const bib = semComentarios(ler("src/components/kanban/ProcessoDocumentosBiblioteca.tsx"))
ok(/rotuloGrupoPessoa\(/.test(bib) && !/\{genTxt\} · \{g\.lineage\} · \{g\.role\}/.test(bib), "aba Documentos usa a função de rótulo")

// B7
const nomes = ["src/components/kanban/ProcessoCentralOperacional.tsx", "src/components/kanban/DocumentoOperationalDrawer.tsx", "src/components/kanban/InitOperationModal.tsx"]
for (const f of nomes) {
  const s = semComentarios(ler(f))
  ok(!/"\/api\/usuarios"/.test(s), `${f.split("/").pop()}: não chama /api/usuarios (usuarios.gerenciar)`)
}
const central = semComentarios(ler(nomes[0]))
ok(/\/api\/operacao\/atribuiveis/.test(central) && /if \(!podeEditarTarefas\) return/.test(central), "Central usa atribuíveis só com tarefas.editar")
for (const f of nomes.slice(1)) {
  const s = semComentarios(ler(f))
  if (f.endsWith("DocumentoOperationalDrawer.tsx")) {
    // Lei da Torre (L4): a gaveta não atribui mais — não busca a lista de atribuíveis.
    ok(!/\/api\/operacao\/atribuiveis/.test(s), `${f.split("/").pop()}: não busca atribuíveis (só a Torre atribui)`)
    continue
  }
  ok(/pode\("tarefas\.editar"\) \? "\/api\/operacao\/atribuiveis" : null/.test(s), `${f.split("/").pop()}: atribuíveis condicionado à permissão (sem chamada sem permissão)`)
}
ok(/verificarPermissao\(request, 'tarefas\.editar'\)/.test(ler("src/app/api/operacao/atribuiveis/route.ts")), "a rota de atribuíveis exige tarefas.editar (a mesma que a UI checa)")

console.log(falhas === 0 ? "\n✅ PASSOU" : `\n❌ FALHOU (${falhas})`)
if (falhas) process.exit(1)
