/**
 * GUARD — SELETOR CSS TEM DE SER SELETOR CSS. Roda no build, sem banco.
 *
 * A exportação do PDF da árvore quebrava com
 *   '.shadow-[var(--elev-2)], …' is not a valid selector
 * porque o seletor era montado com os NOMES das classes do Tailwind, e uma
 * varredura de tokens trocou `shadow-lg` por `shadow-[var(--elev-2)]` dentro da
 * string do `querySelectorAll` também. Em CSS isso é sintaxe inválida — colchete
 * e parêntese precisariam de escape — e a chamada LANÇA, derrubando a função
 * inteira antes de qualquer trabalho.
 *
 * O erro é invisível em revisão: a string continua parecendo uma classe. Só
 * aparece em runtime, na mão de quem clicou.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")

let passou = 0
let falhou = 0
const falhas: string[] = []

function arquivos(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(join(RAIZ, dir))) {
    if (nome === "node_modules" || nome === ".next" || nome.startsWith(".")) continue
    const rel = join(dir, nome)
    if (statSync(join(RAIZ, rel)).isDirectory()) arquivos(rel, saida)
    else if (/\.(ts|tsx)$/.test(nome)) saida.push(rel)
  }
  return saida
}

console.log("SELETORES CSS — nenhum monta seletor com classe de valor arbitrário\n")

// `querySelector`/`querySelectorAll`/`closest`/`matches` com um literal que
// contenha `[` logo depois de um nome de classe, sem escape.
const CHAMADA = /\.(querySelectorAll|querySelector|closest|matches)\(\s*(['"`])((?:\\.|(?!\2)[^\\])*)\2/g

const encontrados: string[] = []
for (const rel of arquivos("src").concat(arquivos("lib"))) {
  const fonte = readFileSync(join(RAIZ, rel), "utf8")
  for (const m of fonte.matchAll(CHAMADA)) {
    const seletor = m[3]
    // `[data-x]` e `[aria-y]` são seletores de ATRIBUTO, legítimos. O problema é
    // colchete colado a um nome de classe/elemento — a marca da classe Tailwind
    // de valor arbitrário — e qualquer parêntese não escapado dentro dele.
    const classeComColchete = /\.[A-Za-z0-9_-]+\[/.test(seletor)
    const parenteseSolto = /\[[^\]]*\([^)]*\)/.test(seletor)
    if (classeComColchete || parenteseSolto) {
      const linha = fonte.slice(0, m.index).split("\n").length
      encontrados.push(`${rel}:${linha} → ${seletor.slice(0, 90)}`)
    }
  }
}

if (encontrados.length === 0) {
  passou++
  console.log("  ✅ nenhum seletor monta classe de valor arbitrário")
} else {
  falhou++
  console.log("  ❌ seletor inválido em runtime:")
  for (const e of encontrados) console.log(`      ${e}`)
  falhas.push(`${encontrados.length} seletor(es) inválido(s)`)
}

// A exportação da árvore não pode voltar a depender de nome de classe.
const arvore = readFileSync(join(RAIZ, "src/components/arvore/arvore-genealogica-view.tsx"), "utf8")
if (/getComputedStyle\(el\)[\s\S]{0,200}boxShadow/.test(arvore)) {
  passou++; console.log("  ✅ a exportação acha sombra pelo estilo calculado, não pelo nome da classe")
} else {
  falhou++; falhas.push("a exportação voltou a depender do nome da classe")
  console.log("  ❌ a exportação voltou a depender do nome da classe")
}

console.log(`\n${passou} passaram, ${falhou} falharam`)
if (falhou > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("\nSELETORES CSS ✅")
