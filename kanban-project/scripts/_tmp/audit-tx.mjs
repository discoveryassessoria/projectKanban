// Audita: uso do cliente GLOBAL `prisma` DENTRO do corpo de uma transação.
// Com connection_limit=1 isso exige uma 2ª conexão enquanto a 1ª está retida → deadlock.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
const RAIZ = process.cwd()
const arquivos = []
const andar = (d) => { for (const i of readdirSync(d)) { const p = join(d, i); if (statSync(p).isDirectory()) { if (i === 'node_modules' || i === '.next' || i === '_tmp') continue; andar(p) } else if (/\.tsx?$/.test(i)) arquivos.push(p) } }
for (const d of ['src', 'lib']) andar(join(RAIZ, d))

const achados = []
for (const f of arquivos) {
  const src = readFileSync(f, 'utf8')
  const re = /\$transaction\(\s*(?:async\s*)?\(?\s*(\w+)\s*\)?\s*=>\s*\{/g
  let m
  while ((m = re.exec(src))) {
    const nomeTx = m[1]
    // varre o corpo balanceado
    let i = src.indexOf('{', m.index + m[0].length - 1)
    let nivel = 0, fim = -1
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') nivel++
      else if (src[j] === '}') { nivel--; if (nivel === 0) { fim = j; break } }
    }
    if (fim < 0) continue
    const corpo = src.slice(i, fim)
    const usos = [...corpo.matchAll(/\bprisma\.\w+/g)].map((x) => x[0])
    if (usos.length) achados.push({ f: relative(RAIZ, f), linha: src.slice(0, m.index).split('\n').length, tx: nomeTx, usos: [...new Set(usos)] })
  }
}
if (!achados.length) console.log('✅ nenhum uso do prisma global dentro de corpo de transação')
for (const a of achados) console.log(`❌ ${a.f}:${a.linha} (tx=${a.tx}) → ${a.usos.join(', ')}`)
