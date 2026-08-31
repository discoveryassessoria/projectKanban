import { readdirSync, statSync, readFileSync } from "node:fs"
import { join } from "node:path"
const RAIZ = process.cwd()
const varrer = (d, out = []) => {
  for (const f of readdirSync(join(RAIZ, d))) {
    const rel = `${d}/${f}`
    if (statSync(join(RAIZ, rel)).isDirectory()) varrer(rel, out)
    else if (/\.(ts|tsx|mjs)$/.test(rel)) out.push(rel)
  }
  return out
}
const fontes = [...varrer("src"), ...varrer("lib"), ...varrer("scripts"), ...varrer("prisma")]
const semCom = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "")

const cat = (linha, arquivo) => {
  const l = linha.trim()
  if (/^\s*\*|^\s*\/\//.test(l)) return null
  // G — WRITERS
  if (/\bpais:\s*['"`]/.test(l) && /create|update|upsert|data:/.test(l)) return "G_WRITER"
  if (/\bpais:\s*\w+[,}]/.test(l) && /data:\s*\{|create\(|update\(/.test(l)) return "G_WRITER"
  // B — FILTRO/QUERY
  if (/where[^\n]*\bpais\b|pais:\s*\{\s*(in|equals|contains)|by:\s*\[['"]pais/.test(l)) return "B_FILTRO"
  // A — DECISÃO
  if (/\bpais\s*(===|!==|==|!=)|switch\s*\([^)]*pais|\?\s*.*pais.*:/.test(l) && !/\?\?/.test(l)) return "A_DECISAO"
  if (/if\s*\([^)]*\bpais\b/.test(l)) return "A_DECISAO"
  // C — JOIN IMPROVISADO
  if (/\.find\([^)]*pais|includes\([^)]*pais|toLowerCase\(\)[^\n]*pais|pais[^\n]*toLowerCase\(\)/.test(l)) return "C_JOIN"
  // D — SERIALIZAÇÃO
  if (/pais:\s*\w+\.pais|pais:\s*true/.test(l)) return "D_SERIAL"
  // E — UI
  if (/\{[^}]*\.pais[^}]*\}/.test(l) && arquivo.includes("components")) return "E_UI"
  return "E_UI"
}

const matriz = []
for (const f of fontes) {
  const bruto = readFileSync(join(RAIZ, f), "utf8")
  const src = semCom(bruto)
  if (!/\bpais\b/.test(src)) continue
  const linhas = bruto.split("\n")
  src.split("\n").forEach((linha, i) => {
    if (!/\bpais\b/.test(linha)) return
    // exclui pais de OUTRAS entidades
    if (/paisId|paisCanonico|catalogoPais|CatalogoPais|countryKey|countryLabel|paisesPermitidos|PaisKanban|PaisKey|paisSelecionado|paisOutro|focarPais|ambiente/i.test(linha)) return
    if (/requerente|contratante|banco|uniao|Uniao|endereco|fornecedor|organiza|orgao/i.test(linha)) return
    const c = cat(linha, f)
    if (c) matriz.push({ f, i: i + 1, c, txt: linhas[i]?.trim().slice(0, 90) ?? "" })
  })
}
const porCat = {}
for (const m of matriz) (porCat[m.c] ??= []).push(m)
const isTeste = (f) => f.startsWith("scripts/") || f.includes(".test.") || f.startsWith("prisma/")
console.log("TOTAL:", matriz.length, "| produção:", matriz.filter(m => !isTeste(m.f)).length, "| testes/fixtures:", matriz.filter(m => isTeste(m.f)).length)
for (const [c, arr] of Object.entries(porCat).sort((a,b)=>b[1].length-a[1].length)) {
  console.log(`\n══ ${c}: ${arr.length} (prod ${arr.filter(m=>!isTeste(m.f)).length})`)
  for (const m of arr.filter(m => !isTeste(m.f)).slice(0, 14)) console.log(`   ${m.f}:${m.i}  ${m.txt}`)
}
