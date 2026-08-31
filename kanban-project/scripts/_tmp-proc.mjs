import { readdirSync, statSync, readFileSync } from "node:fs"
import { join } from "node:path"
const RAIZ = process.cwd()
const varrer = (d, out = []) => { for (const f of readdirSync(join(RAIZ, d))) { const r = `${d}/${f}`
  if (statSync(join(RAIZ, r)).isDirectory()) varrer(r, out); else if (/\.(ts|tsx)$/.test(r)) out.push(r) } return out }
const fontes = [...varrer("src"), ...varrer("lib")]
const semCom = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "")
// Só o que vem de um PROCESSO
const PADROES = [
  [/\bprocesso\??\.pais\b/, "acesso processo.pais"],
  [/\bproc\??\.pais\b/, "acesso proc.pais"],
  [/\.processo\??\.pais\b/, "acesso X.processo.pais"],
  [/prisma\.processo[\s\S]{0,200}?\bpais\b/, "query processo"],
  [/where\.pais\s*=/, "where.pais"],
  [/where:\s*\{\s*pais\b/, "where {pais}"],
]
const achados = []
for (const f of fontes) {
  const bruto = readFileSync(join(RAIZ, f), "utf8"); const src = semCom(bruto)
  if (!/\bpais\b/.test(src)) continue
  const linhas = bruto.split("\n")
  src.split("\n").forEach((l, i) => {
    for (const [re, tipo] of PADROES) {
      if (re.test(l)) { achados.push({ f, i: i + 1, tipo, txt: linhas[i]?.trim().slice(0, 95) ?? "" }); break }
    }
  })
}
console.log("OCORRÊNCIAS DE Processo.pais EM PRODUÇÃO:", achados.length, "em", new Set(achados.map(a=>a.f)).size, "arquivos\n")
for (const a of achados) console.log(`${a.f}:${a.i}  [${a.tipo}]  ${a.txt}`)
