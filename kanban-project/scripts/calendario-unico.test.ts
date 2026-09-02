// scripts/calendario-unico.test.ts
//
// UM SÓ SELETOR DE DATA, E ELE DEIXA ESCOLHER O ANO.
//
// `<input type="date">` entrega o desenho ao navegador. No Safari vira um
// stepper: para chegar em 1912 são oitenta cliques na setinha. Num sistema onde
// data de registro civil de bisavô é rotina, isso é inviável — e o formato
// exibido ainda muda com o idioma do navegador (mm/dd/yyyy num sistema em
// português).
//
// Este guard falha se alguém voltar a usar o nativo.

import { readFileSync, readdirSync, statSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
let ok = 0, falhou = 0
const falhas: string[] = []
const check = (c: boolean, nome: string, detalhe = "") => {
  if (c) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}

const varrer = (dir: string, out: string[] = []): string[] => {
  let itens: string[] = []
  try { itens = readdirSync(join(RAIZ, dir)) } catch { return out }
  for (const f of itens) {
    const rel = `${dir}/${f}`
    if (statSync(join(RAIZ, rel)).isDirectory()) varrer(rel, out)
    else if (rel.endsWith(".tsx")) out.push(rel)
  }
  return out
}

console.log("CALENDÁRIO — um só, e com ano escolhível\n")

const COMPONENTE = "src/components/ui/campo-data.tsx"
const telas = varrer("src").filter((f) => f !== COMPONENTE)

// `<input type="date">` nativo não pode voltar. `type="date"` como PROP de um
// componente próprio é legítimo — o que importa é quem desenha o calendário.
const nativos = telas.filter((f) => {
  const src = readFileSync(join(RAIZ, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "")
  return /<input[^>]*type\s*=\s*["']date["']/.test(src)
})
check(nativos.length === 0, "nenhum <input type=\"date\"> nativo", nativos.join(", "))

const comp = readFileSync(join(RAIZ, COMPONENTE), "utf8")
check(/<select[\s\S]*aria-label="Ano"/.test(comp), "o seletor deixa escolher o ANO direto")
check(/<select[\s\S]*aria-label="Mês"/.test(comp), "o seletor deixa escolher o MÊS direto")
check(/anoMinimo\s*\?\?\s*18\d\d/.test(comp), "a faixa de anos alcança o século XIX (genealogia)")
// `new Date("2023-01-01")` é meia-noite UTC — 21h do dia anterior no Brasil.
check(/Sem `new Date`: ele desloca por fuso/.test(comp) && !/new Date\(iso\)/.test(comp),
  "o valor ISO é lido sem passar por new Date (fuso não desloca o dia)")
check(/export function CampoData/.test(comp), "existe UM componente exportado")

const usam = telas.filter((f) => /<CampoData/.test(readFileSync(join(RAIZ, f), "utf8")))
check(usam.length >= 15, `as telas usam o seletor único (${usam.length} arquivos)`)

console.log(`\n${ok} passaram, ${falhou} falharam`)
if (falhou > 0) { console.error("FALHAS: " + falhas.join("; ")); process.exit(1) }
