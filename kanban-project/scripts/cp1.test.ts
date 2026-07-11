/**
 * CP-1 — testes (unitários, sem servidor/DB).
 * Rodar: npm run test:cp1
 *
 * Cobre:
 *  - chaveDedupPessoa (dedup por CPF forte / nome+nascimento fraco);
 *  - migration ADITIVA (sem DROP) contendo Familia + personId + arvoreId nullable;
 *  - schema com model Familia e vínculos novos.
 */

import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { chaveDedupPessoa, normalizarTexto, apenasDigitos } from "../src/services/identity"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

function run() {
  console.log("CP-1 — testes\n")

  // 1) Dedup de identidade
  console.log("1) chaveDedupPessoa:")
  const a = chaveDedupPessoa({ cpf: "123.456.789-09", nome: "João Silva" })
  const b = chaveDedupPessoa({ cpf: "12345678909", nome: "OUTRO NOME" })
  ok(a === b && a.startsWith("cpf:"), "mesmo CPF (formatos/nomes diferentes) => mesma chave")

  const c = chaveDedupPessoa({ cpf: null, nome: "Maria de Fátima", dataNascimento: "1980-05-10" })
  const d = chaveDedupPessoa({ cpf: "", nome: "maria de fatima", dataNascimento: new Date("1980-05-10") })
  ok(c === d && c.startsWith("nome:"), "sem CPF: nome normalizado + nascimento => mesma chave")

  const e = chaveDedupPessoa({ cpf: null, nome: "Ana", dataNascimento: "1990-01-01" })
  const f = chaveDedupPessoa({ cpf: null, nome: "Ana", dataNascimento: "1991-01-01" })
  ok(e !== f, "mesmo nome, nascimento diferente => chaves diferentes")

  ok(chaveDedupPessoa({ cpf: null, nome: null }) === "", "sem CPF e sem nome => chave vazia (não deduplica)")
  ok(apenasDigitos("12.3-45") === "12345", "apenasDigitos remove não-dígitos")
  ok(normalizarTexto("  José  DA   Silva ") === "jose da silva", "normalizarTexto: sem acento, minúsculo, colapsa espaços")

  // 2) Migration aditiva
  console.log("\n2) Migration CP-1 (aditiva/não-destrutiva):")
  const mig = readFileSync(
    join(ROOT, "prisma/migrations/20260711120000_cp1_familia_identidade/migration.sql"),
    "utf8"
  )
  ok(!/DROP\s+TABLE/i.test(mig), "não contém DROP TABLE")
  ok(!/DROP\s+COLUMN/i.test(mig), "não contém DROP COLUMN")
  ok(/CREATE TABLE "Familia"/.test(mig), "cria tabela Familia")
  ok(/ALTER TABLE "Processo" ADD COLUMN\s+"familiaId"/.test(mig), "adiciona Processo.familiaId")
  ok(/ALTER TABLE "Arvore" ADD COLUMN\s+"familiaId"/.test(mig), "adiciona Arvore.familiaId")
  ok(/ALTER TABLE "Contratante" ADD COLUMN\s+"personId"/.test(mig), "adiciona Contratante.personId")
  ok(/ALTER TABLE "Requerente" ADD COLUMN\s+"personId"/.test(mig), "adiciona Requerente.personId")
  ok(/ALTER TABLE "Pessoa" ALTER COLUMN "arvoreId" DROP NOT NULL/.test(mig), "torna Pessoa.arvoreId nullable")

  // 3) Schema
  console.log("\n3) Schema:")
  const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8")
  ok(/model Familia \{/.test(schema), "schema tem model Familia")
  ok(/personId\s+Int\?/.test(schema), "schema tem personId nos papéis")
  ok(/arvoreId\s+Int\?/.test(schema), "schema: Pessoa.arvoreId opcional")

  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
  console.log("CP-1: todos os testes verdes ✅")
}

run()
