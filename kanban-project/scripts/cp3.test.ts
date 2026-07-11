/**
 * CP-3 — testes (unitários/estruturais, sem servidor/DB).
 * Rodar: npm run test:cp3
 */

import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import {
  montarChaveIdempotencia,
  sujeitoValido,
} from "../src/services/necessidade-documental-helpers"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}
function throws(fn: () => unknown): boolean {
  try { fn(); return false } catch { return true }
}

function run() {
  console.log("CP-3 — testes\n")

  // 1) Chave idempotente
  console.log("1) Chave de idempotência:")
  const base = { processoId: 10, itemCatalogoId: 5, pessoaId: 3, varianteKey: "padrao", ciclo: 1 }
  ok(montarChaveIdempotencia(base) === montarChaveIdempotencia({ ...base }), "mesma combinação => mesma chave (geração repetida não duplica)")
  ok(montarChaveIdempotencia(base) !== montarChaveIdempotencia({ ...base, itemCatalogoId: 6 }), "item diferente => chave diferente")
  ok(montarChaveIdempotencia(base) !== montarChaveIdempotencia({ ...base, processoId: 11 }), "processo diferente => chave diferente")

  // 2) pessoaId XOR uniaoId
  console.log("\n2) Sujeito pessoaId XOR uniaoId:")
  ok(sujeitoValido({ pessoaId: 1 }) === true, "só pessoa => válido")
  ok(sujeitoValido({ uniaoId: 2 }) === true, "só união => válido")
  ok(sujeitoValido({ pessoaId: 1, uniaoId: 2 }) === false, "ambos => inválido")
  ok(sujeitoValido({}) === false, "nenhum => inválido")
  ok(throws(() => montarChaveIdempotencia({ processoId: 1, itemCatalogoId: 1, pessoaId: 1, uniaoId: 2 })), "chave lança com sujeito ambíguo")
  ok(throws(() => montarChaveIdempotencia({ processoId: 1, itemCatalogoId: 1 })), "chave lança sem sujeito")
  ok(
    montarChaveIdempotencia({ processoId: 1, itemCatalogoId: 1, pessoaId: 9 }) !==
      montarChaveIdempotencia({ processoId: 1, itemCatalogoId: 1, uniaoId: 9 }),
    "pessoa vs união (mesmo id) => chaves distintas"
  )

  // 3) Variantes legítimas e reabertura (ciclo)
  console.log("\n3) Variantes e reabertura:")
  ok(
    montarChaveIdempotencia({ ...base, varianteKey: "inteiro_teor" }) !== montarChaveIdempotencia({ ...base, varianteKey: "plurilingue" }),
    "variantes legítimas => chaves distintas"
  )
  ok(montarChaveIdempotencia(base) !== montarChaveIdempotencia({ ...base, ciclo: 2 }), "reabertura (ciclo+1) => nova chave, sem sobrescrever")

  // 4) Migration aditiva + CHECK XOR
  console.log("\n4) Migration CP-3 (aditiva/não-destrutiva):")
  const mig = readFileSync(join(ROOT, "prisma/migrations/20260711140000_cp3_necessidade_documental/migration.sql"), "utf8")
  ok(!/DROP\s+TABLE/i.test(mig), "não contém DROP TABLE")
  ok(!/DROP\s+COLUMN/i.test(mig), "não contém DROP COLUMN")
  ok(/CREATE TABLE "NecessidadeDocumental"/.test(mig), "cria NecessidadeDocumental")
  ok(/CREATE TABLE "NecessidadeDocumentalEvento"/.test(mig), "cria NecessidadeDocumentalEvento (histórico)")
  ok(/ALTER TABLE "Documento" ADD COLUMN\s+"necessidadeId" INTEGER;/.test(mig), "Documento.necessidadeId nullable (sem NOT NULL prematuro)")
  ok(/"versao" INTEGER NOT NULL DEFAULT 1/.test(mig), "MatrizDocumental.versao com default (versionamento)")
  ok(/CHECK \(\(\("pessoaId" IS NOT NULL\)::int \+ \("uniaoId" IS NOT NULL\)::int\) = 1\)/.test(mig), "CHECK XOR do sujeito")

  // 5) Schema/estrutura
  console.log("\n5) Schema/estrutura:")
  const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8")
  ok(/model NecessidadeDocumental \{/.test(schema), "schema tem NecessidadeDocumental")
  ok(/model NecessidadeDocumentalEvento \{/.test(schema), "schema tem NecessidadeDocumentalEvento (append-only)")
  ok(/matrizRegraVersao\s+Int\?/.test(schema) && /matrizSnapshot\s+Json\?/.test(schema), "snapshot da regra da Matriz (versão+parâmetros)")
  ok(/documentos\s+Documento\[\]/.test(schema), "1 necessidade -> N documentos (múltiplas vias)")

  // 6) Service: dual-read encapsulado
  console.log("\n6) Service:")
  const svc = readFileSync(join(ROOT, "src/services/necessidade-documental.ts"), "utf8")
  ok(/export async function resolverNecessidadeDeDocumento/.test(svc), "dual-read encapsulado (resolverNecessidadeDeDocumento)")
  ok(/export async function reabrir/.test(svc), "reabertura após não localizado")
  const bf = readFileSync(join(ROOT, "prisma/backfill-cp3-necessidades.ts"), "utf8")
  ok(/unresolvedCount/.test(bf), "backfill reporta unresolvedCount")

  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
  console.log("CP-3: todos os testes verdes ✅")
}

run()
