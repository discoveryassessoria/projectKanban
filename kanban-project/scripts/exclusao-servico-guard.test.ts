// scripts/exclusao-servico-guard.test.ts
//
// GUARD ARQUITETURAL PERMANENTE da exclusão de Serviços (§16).
//
// Congela três invariantes que só podem ser quebradas por decisão explícita:
//   1. Nenhuma entidade de CONFIGURAÇÃO pode ser classificada como fato histórico.
//   2. `deletionAllowed` sai de historicalFacts e de mais nada — nunca de configDependencies.
//   3. Não existe `servicoProduto.delete/deleteMany` (nem o equivalente de config/item) em
//      runtime fora do motor canônico: um segundo caminho de delete é um segundo motor.
//
// Roda sem banco.

import { readFileSync, readdirSync, statSync } from "fs"
import { join, relative } from "path"
import {
  ENTIDADES_CONFIGURACAO,
  ENTIDADES_FATO_HISTORICO,
  classificar,
  permiteExclusaoDefinitiva,
  exigeInativacao,
} from "../lib/gerenciamento/classificacao-exclusao"

const RAIZ = join(__dirname, "..")
const MOTOR = "src/services/exclusao-definitiva.ts"
const CLASSIFICADOR = "lib/gerenciamento/classificacao-exclusao.ts"

let passed = 0
let failed = 0
function ok(nome: string, cond: boolean, detalhe = "") {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; console.log(`  ❌ ${nome}${detalhe ? `\n     ${detalhe}` : ""}`) }
}

function varrer(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === ".next" || nome === ".git") continue
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) varrer(p, acc)
    else if (/\.(ts|tsx)$/.test(nome)) acc.push(p)
  }
  return acc
}

console.log("\n🛡️  GUARD — exclusão definitiva de Serviços\n")

// ── 1. CONFIGURAÇÃO nunca é FATO HISTÓRICO ───────────────────────────────────
console.log("1) Classificação canônica")
const DEVEM_SER_CONFIGURACAO = [
  "RegraAplicabilidadeEconomica",
  "ConfiguracaoFinanceira",
  "RegraDePreco",
  "VinculoTabelaPreco",
  "AutomacaoFinanceiraDeFase",
  "VinculoCondicaoPagamento",
  "VinculoTipoDocumento",
  "VinculoTipoServico",
]
for (const e of DEVEM_SER_CONFIGURACAO) {
  ok(`${e} é CONFIGURACAO`, classificar(e) === "CONFIGURACAO")
}
ok(
  "nenhuma chave de configuração aparece na lista de fatos históricos",
  Object.keys(ENTIDADES_CONFIGURACAO).every((k) => !(k in ENTIDADES_FATO_HISTORICO)),
)
ok(
  "nenhuma chave de fato histórico aparece na lista de configuração",
  Object.keys(ENTIDADES_FATO_HISTORICO).every((k) => !(k in ENTIDADES_CONFIGURACAO)),
)
ok("entidade não classificada é ERRO explícito (nunca vira histórico por omissão)", (() => {
  try { classificar("EntidadeQueNinguemClassificou"); return false } catch { return true }
})())

// ── 2. A REGRA é literal ─────────────────────────────────────────────────────
console.log("\n2) deletionAllowed = historicalFacts.total === 0")
ok("zero fatos → permite excluir", permiteExclusaoDefinitiva({ total: 0 }) === true)
ok("um fato → proíbe excluir", permiteExclusaoDefinitiva({ total: 1 }) === false)
ok("um fato → exige inativação", exigeInativacao({ total: 1 }) === true)
ok("zero fatos → não exige inativação", exigeInativacao({ total: 0 }) === false)

const fonteClassificador = readFileSync(join(RAIZ, CLASSIFICADOR), "utf8")
ok(
  "a regra é escrita literalmente no classificador",
  /return fatos\.total === 0/.test(fonteClassificador),
)

const fonteMotor = readFileSync(join(RAIZ, MOTOR), "utf8")
// Toda ATRIBUIÇÃO de deletionAllowed (fora da declaração do tipo) tem de vir da função pura.
const atribuicoes = [...fonteMotor.matchAll(/deletionAllowed:\s*([^,\n]+)/g)]
  .map((m) => m[1].trim())
  .filter((v) => v !== "boolean")
ok(
  "o motor não recalcula a regra (só chama permiteExclusaoDefinitiva)",
  atribuicoes.length > 0 && atribuicoes.every((v) => v.startsWith("permiteExclusaoDefinitiva(")),
  `atribuições encontradas: ${JSON.stringify(atribuicoes)}`,
)
ok(
  "deactivationRequired também vem da fonte única",
  [...fonteMotor.matchAll(/deactivationRequired:\s*([^,\n]+)/g)]
    .map((m) => m[1].trim())
    .filter((v) => v !== "boolean")
    .every((v) => v.startsWith("exigeInativacao(")),
)
ok(
  "configDependencies NUNCA entra no cálculo de deletionAllowed",
  !/deletionAllowed[^\n]*configDependencies/.test(fonteMotor) &&
    !/configDependencies[^\n]*\.total\s*===\s*0/.test(fonteMotor),
)

// ── 3. Motor único: sem delete paralelo em runtime ───────────────────────────
console.log("\n3) Motor único (sem delete paralelo em runtime)")
const ALVOS = [
  { modelo: "servicoProduto", rotulo: "Serviço" },
  { modelo: "produtoFinanceiro", rotulo: "Configuração Financeira" },
  { modelo: "itemCatalogo", rotulo: "Item do Cadastro Mestre" },
  { modelo: "phaseEconomicRule", rotulo: "Regra de Aplicabilidade Econômica" },
]
// Runtime = src/ + lib/ + app/. Scripts de teste/seed limpam os PRÓPRIOS dados e ficam de fora.
const ARQUIVOS_RUNTIME = [
  ...varrer(join(RAIZ, "src")),
  ...varrer(join(RAIZ, "lib")),
].map((p) => relative(RAIZ, p))

const PERMITIDOS = new Set<string>([
  MOTOR,
  // A tela de Aplicabilidade Econômica é o CRUD legítimo da própria regra (não é exclusão de serviço).
  "src/app/api/gerenciamento/aplicabilidade-economica/[id]/route.ts",
])

for (const alvo of ALVOS) {
  const re = new RegExp(`\\b(prisma|tx|db)\\.${alvo.modelo}\\.delete(Many)?\\b`)
  const violacoes = ARQUIVOS_RUNTIME.filter(
    (rel) => !PERMITIDOS.has(rel) && re.test(readFileSync(join(RAIZ, rel), "utf8")),
  )
  ok(
    `nenhum delete paralelo de ${alvo.rotulo} fora do motor canônico`,
    violacoes.length === 0,
    violacoes.join("\n     "),
  )
}

// ── 4. Prévia e execução usam o MESMO analisador ─────────────────────────────
console.log("\n4) Prévia e execução compartilham o analisador")
const ROTA_SVC = "src/app/api/gerenciamento/produtos-servicos/[id]/exclusao-definitiva/route.ts"
const fonteRota = readFileSync(join(RAIZ, ROTA_SVC), "utf8")
ok("GET usa analyzeServiceDeletion", /analyzeServiceDeletion\(servicoId\)/.test(fonteRota))
ok("DELETE usa deleteService", /deleteService\(servicoId/.test(fonteRota))
ok(
  "deleteService re-roda analyzeServiceDeletion DENTRO da transação",
  /\$transaction[\s\S]*analyzeServiceDeletion\(servicoId, tx\)/.test(fonteMotor),
)
ok(
  "a execução trava a linha do serviço antes de reanalisar",
  /FOR UPDATE/.test(fonteMotor),
)
ok(
  "permissão de exclusão definitiva é exigida no backend",
  /exigirPermissao\(request, "sistema\.exclusaoDefinitiva"\)/.test(fonteRota),
)

// ── 5. A rota simples não exclui ─────────────────────────────────────────────
console.log("\n5) A rota simples de Serviço apenas inativa")
const fonteRotaSimples = readFileSync(join(RAIZ, "src/app/api/gerenciamento/produtos-servicos/[id]/route.ts"), "utf8")
ok("DELETE simples chama deactivateService", /deactivateService\(id/.test(fonteRotaSimples))
ok("DELETE simples não apaga fisicamente", !/servicoProduto\.delete\b/.test(fonteRotaSimples))

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passaram, ${failed} falharam\n`)
process.exit(failed === 0 ? 0 : 1)
