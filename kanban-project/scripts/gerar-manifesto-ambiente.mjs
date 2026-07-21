// scripts/gerar-manifesto-ambiente.mjs
//
// Regenera src/lib/ambiente/manifest.generated.ts a partir das imagens em
// public/ambiente/<pais>/<enquadramento>/. Roda no prebuild.
//
// TOLERANTE A FALHAS: pasta/arquivo ausente NUNCA quebra o build — apenas gera
// listas vazias (o fundo cai no céu procedural). Ignora .gitkeep e não-imagens.
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BASE = join(ROOT, "public", "ambiente");
const OUT = join(ROOT, "src", "lib", "ambiente", "manifest.generated.ts");

const PAISES = ["italia", "espanha", "portugal", "franca", "alemanha", "polonia", "austria"];
const ENQ = ["aerea", "cidade", "consulado", "paisagem"];
const IMG = /\.(jpe?g|png|webp|avif)$/i;

function listar(pais, enq) {
  try {
    const dir = join(BASE, pais, enq);
    return readdirSync(dir)
      .filter((f) => IMG.test(f))
      .filter((f) => {
        try { return statSync(join(dir, f)).isFile(); } catch { return false; }
      })
      .sort();
  } catch {
    return []; // pasta ausente → vazio, sem quebrar
  }
}

const manifesto = {};
let total = 0;
for (const pais of PAISES) {
  manifesto[pais] = {};
  for (const enq of ENQ) {
    const arquivos = listar(pais, enq);
    manifesto[pais][enq] = arquivos;
    total += arquivos.length;
  }
}

const corpo = PAISES.map((p) => {
  const enqs = ENQ.map((e) => `${e}: ${JSON.stringify(manifesto[p][e])}`).join(", ");
  return `  ${p}: { ${enqs} },`;
}).join("\n");

const conteudo = `// src/lib/ambiente/manifest.generated.ts
//
// GERADO AUTOMATICAMENTE por scripts/gerar-manifesto-ambiente.mjs (prebuild).
// NÃO editar à mão.
import type { PaisKey } from "./paises"
import type { Enquadramento } from "./imagens"

export const MANIFESTO_AMBIENTE: Record<PaisKey, Record<Enquadramento, string[]>> = {
${corpo}
}
`;

try {
  writeFileSync(OUT, conteudo);
  console.log(`[ambiente] manifesto gerado: ${total} imagem(ns).`);
} catch (e) {
  console.warn(`[ambiente] não foi possível escrever o manifesto (${e?.message}); build segue com o existente.`);
}
