// scripts/torre-aguardando-vocabulario.test.ts — "Bola com" virou "Aguardando"; o valor interno "Nossa" é exibido como "Equipe" (sem banco).
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { BOLA_NOSSA, VALORES_DE_BOLA, rotuloDoLado } from "../lib/operacional/torre-bola"
import { textoDaBola } from "../lib/operacional/torre-tarefas-tela"
let passou = 0, falhou = 0
const ok = (n: string, c: boolean, x = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${x}`) } }

ok("o lado interno aparece como 'Equipe' e os valores listados começam por ele", BOLA_NOSSA === "Equipe" && VALORES_DE_BOLA[0] === "Equipe")
ok("lado: 'Aguardando a equipe' / 'Aguardando terceiros' (vocabulário oficial no plural)", rotuloDoLado("Equipe") === "Aguardando a equipe" && rotuloDoLado("Tradutor") === "Aguardando terceiros")
const agora = new Date("2026-10-05T12:00:00Z")
ok("equipe: texto 'Equipe'", textoDaBola({ bolaCom: "Equipe", bolaDesde: null, terceiroNome: null, esperandoDe: null, estadoOperacao: "FILA" }, agora).texto === "Equipe")
const t = textoDaBola({ bolaCom: "Tradutor", bolaDesde: null, terceiroNome: "Tradutora Ana", esperandoDe: "terceiro", estadoOperacao: "AGUARDANDO" }, agora)
ok("terceiro: o TIPO no texto; o nome do órgão à parte", t.texto === "Tradutor" && t.orgao === "Tradutora Ana")

// nenhum texto de tela diz "Bola com" / "bola nossa" / 'Nossa' como valor exibido
const varre = (dir: string, out: string[] = []): string[] => { for (const n of readdirSync(dir)) { const p = join(dir, n); const st = statSync(p); if (st.isDirectory()) { if (n !== "node_modules" && n !== ".next") varre(p, out) } else if (/\.(ts|tsx)$/.test(n)) out.push(p) } return out }
const arquivos = [...varre("src/components/torre"), ...varre("lib/operacional"), "src/lib/gerenciamento/cadastros-registry.ts"]
const ruins: string[] = []
for (const p of arquivos) {
  const linhas = readFileSync(p, "utf8").split("\n")
  linhas.forEach((l, i) => {
    const t = l.trim(); if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return
    if (/Bola com|Bola nossa|bola nossa|bola com |de quem é a bola|["'`>]Nossa["'`<]/.test(l)) ruins.push(`${p}:${i + 1}`)
  })
}
ok("nenhum texto de tela diz 'Bola com', 'Bola nossa' ou 'Nossa'", ruins.length === 0, ruins.slice(0, 5).join(" | "))
console.log(`\n${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
