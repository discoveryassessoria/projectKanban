// HOMOLOGAÇÃO — GUARDA: componente CLIENTE não pode importar módulo de servidor.
// Um componente "use client" que importe (direta ou indiretamente) `@/lib/prisma` faz o
// bundle do navegador carregar o PrismaClient e a tela QUEBRA em runtime — falha que
// nenhum teste de unidade pega e que o tsc não vê. Foi exatamente o que aconteceu quando
// a lista de Custos importou uma constante de um módulo de AÇÃO (que fala com o banco).
// Regra: constantes/tipos compartilhados com a UI vivem em módulos PUROS de domínio.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const RAIZ = join(__dirname, '..')

function arquivos(dir: string, exts = ['.tsx', '.ts']): string[] {
  const abs = join(RAIZ, dir)
  let entradas: string[] = []
  try { entradas = readdirSync(abs) } catch { return [] }
  const out: string[] = []
  for (const e of entradas) {
    const p = join(dir, e)
    if (statSync(join(RAIZ, p)).isDirectory()) out.push(...arquivos(p, exts))
    else if (exts.some((x) => e.endsWith(x))) out.push(p)
  }
  return out
}

/** Resolve um import relativo/aliased para um caminho de arquivo do projeto. */
function resolver(deQuem: string, esp: string): string | null {
  let base: string
  if (esp.startsWith('@/')) base = esp.slice(2)
  else if (esp.startsWith('.')) base = relative(RAIZ, resolve(join(RAIZ, dirname(deQuem)), esp))
  else return null
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    try { if (statSync(join(RAIZ, cand)).isFile()) return cand } catch { /* segue */ }
  }
  return null
}

const cache = new Map<string, boolean>()
/** O módulo alcança o Prisma (direta ou transitivamente)? */
function alcancaPrisma(arq: string, caminho: string[] = []): string[] | null {
  if (cache.get(arq) === false) return null
  if (caminho.includes(arq)) return null // ciclo
  let src: string
  try { src = readFileSync(join(RAIZ, arq), 'utf8') } catch { return null }
  if (/from ['"]@\/lib\/prisma['"]|from ['"]@prisma\/client['"]/.test(src)) return [...caminho, arq]
  for (const m of src.matchAll(/from ['"]([^'"]+)['"]/g)) {
    const alvo = resolver(arq, m[1])
    if (!alvo) continue
    const r = alcancaPrisma(alvo, [...caminho, arq])
    if (r) return r
  }
  cache.set(arq, false)
  return null
}

async function main() {
  const clientes = arquivos('src/components/financeiro', ['.tsx']).filter((f) => /^["']use client["']/m.test(readFileSync(join(RAIZ, f), 'utf8')))
  chk(clientes.length > 10, `componentes cliente do Financeiro varridos (${clientes.length})`)

  const contaminados: string[] = []
  for (const c of clientes) {
    const src = readFileSync(join(RAIZ, c), 'utf8')
    for (const m of src.matchAll(/from ['"]([^'"]+)['"]/g)) {
      const alvo = resolver(c, m[1])
      if (!alvo) continue
      const cadeia = alcancaPrisma(alvo)
      if (cadeia) { contaminados.push(`${c} → ${cadeia.join(' → ')}`); break }
    }
  }
  if (contaminados.length) { console.log('\n  Componentes cliente que alcançam o Prisma:'); for (const c of contaminados) console.log('    •', c) }
  chk(contaminados.length === 0, `nenhum componente cliente alcança o Prisma (${contaminados.length})`)

  console.log(`\n${ok} passaram, ${fail} falharam`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
