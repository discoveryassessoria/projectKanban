#!/usr/bin/env node
// scripts/gerar-manifesto-ambiente.mjs
//
// Varre public/ambiente/<pais>/<enquadramento>/ e regenera
// src/lib/ambiente/manifest.generated.ts.
//
// Roda sozinho no `prebuild`. O fluxo pretendido é: soltar os JPGs na pasta,
// buildar, pronto — ninguém edita código para adicionar imagem.

import { readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..")
const baseImagens = join(raiz, "public", "ambiente")
const destino = join(raiz, "src", "lib", "ambiente", "manifest.generated.ts")

const PAISES = ["italia", "espanha", "portugal", "franca", "alemanha", "polonia", "austria"]
const ENQUADRAMENTOS = ["aerea", "cidade", "consulado", "paisagem"]
const EXTENSOES = /\.(jpe?g|png|webp|avif)$/i

const manifesto = {}
let total = 0

for (const pais of PAISES) {
  manifesto[pais] = {}
  for (const enq of ENQUADRAMENTOS) {
    const dir = join(baseImagens, pais, enq)
    const arquivos = existsSync(dir)
      ? readdirSync(dir).filter(f => EXTENSOES.test(f)).sort()
      : []
    manifesto[pais][enq] = arquivos
    total += arquivos.length
  }
}

const conteudo = `// GERADO AUTOMATICAMENTE por scripts/gerar-manifesto-ambiente.mjs — não editar à mão.
// Para adicionar imagens: solte os arquivos em public/ambiente/<pais>/<enquadramento>/
// e rode \`npm run build\` (ou \`node scripts/gerar-manifesto-ambiente.mjs\`).

import type { PaisKey } from "./paises"
import type { Enquadramento } from "./imagens"

export const MANIFESTO_AMBIENTE: Record<PaisKey, Record<Enquadramento, string[]>> =
${JSON.stringify(manifesto, null, 2)}
`

mkdirSync(dirname(destino), { recursive: true })
writeFileSync(destino, conteudo, "utf8")

console.log(`[ambiente] manifesto gerado: ${total} imagem(ns) em ${PAISES.length} países.`)
if (total === 0) {
  console.log("[ambiente] biblioteca vazia — o fundo usará o céu procedural da paleta de cada país.")
}
