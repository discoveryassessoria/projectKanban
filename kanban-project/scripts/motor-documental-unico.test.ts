/**
 * GUARDA — EXISTE APENAS UM MATERIALIZADOR DOCUMENTAL.
 * Rodar: npm run test:motor-unico
 *
 * O QUE ISTO IMPEDE
 * -----------------
 * O Discovery tinha DOIS motores criando NecessidadeDocumental:
 *
 *   1. materializarExecucaoDaFase → materializarGenealogia
 *      (Regras Documentais PUBLICADAS, condições avaliadas, varianteKey `rd:<regra>:v<n>`)
 *
 *   2. carregarContextoEscopo → garantirNecessidadesArvoreDoProcesso
 *      (DOCUMENT_RULES hardcoded, sem condição, varianteKey "padrao")
 *      + POST /necessidades {acao: gerar_matriz|gerar_arvore}
 *
 * Como a chave de idempotência inclui `varianteKey`, o banco via duas obrigações
 * distintas onde havia uma. A mesma pessoa recebia a certidão de nascimento duas
 * vezes — uma por motor. Não era bug de tela: eram dois registros.
 *
 * O motor 2 foi ELIMINADO. Esta guarda impede que volte.
 */
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const existe = (p: string) => existsSync(join(RAIZ, p))
const ler = (p: string) => (existe(p) ? readFileSync(join(RAIZ, p), "utf8") : "")
/** Código executável: sem comentários de linha e de bloco. */
const semComentarios = (p: string) =>
  ler(p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

console.log("Motor documental único\n")

// ── 1) Os motores legados não existem ──────────────────────────────────────
secao("1) Motores legados ELIMINADOS (não desativados)")

const SERVICO = semComentarios("src/services/necessidade-documental.ts")
ok("garantirNecessidadesArvoreDoProcesso não existe", !/garantirNecessidadesArvoreDoProcesso/.test(SERVICO))
ok("garantirNecessidadesDaMatriz não existe", !/garantirNecessidadesDaMatriz/.test(SERVICO))
ok("o serviço não importa DOCUMENT_RULES", !/DOCUMENT_RULES/.test(SERVICO))
ok("o serviço não importa analyzePessoa", !/analyzePessoa/.test(SERVICO))
ok("src/lib/document-generator.ts foi removido", !existe("src/lib/document-generator.ts"))
ok("a rota /pessoas/[id]/reconcile foi removida", !existe("src/app/api/pessoas/[id]/reconcile/route.ts"))

// nenhum arquivo de runtime pode citar os símbolos eliminados em CÓDIGO
const RUNTIME = [
  "src/services/phase-workflow.ts",
  "src/services/materializar-fase.ts",
  "src/services/genealogia/materializar-genealogia.ts",
  "src/app/api/processos/[processoId]/necessidades/route.ts",
  "src/app/api/pessoas/route.ts",
  "src/app/api/pessoas/[id]/route.ts",
]
for (const f of RUNTIME) {
  const src = semComentarios(f)
  ok(`${f} não chama motor legado`, !/garantirNecessidadesArvoreDoProcesso|garantirNecessidadesDaMatriz|reconcileDocsForPessoa|reconcileAllForArvore|analyzePessoa|DOCUMENT_RULES/.test(src))
}

// ── 2) A rota não materializa mais ─────────────────────────────────────────
secao("2) POST /necessidades — ações de materialização eliminadas")

const ROTA = semComentarios("src/app/api/processos/[processoId]/necessidades/route.ts")
ok("gerar_arvore e gerar_matriz respondem 410 (eliminadas)", /acao === "gerar_arvore" \|\| acao === "gerar_matriz"[\s\S]{0,400}status: 410/.test(ROTA))
ok("a resposta nomeia o motor oficial", /materializarExecucaoDaFase/.test(ler("src/app/api/processos/[processoId]/necessidades/route.ts")))
ok("a rota não importa mais os motores legados", !/garantirNecessidadesArvoreDoProcesso|garantirNecessidadesDaMatriz/.test(ROTA))
ok("criar_manual continua (necessidade avulsa é ato administrativo, não materialização)", /acao === "criar_manual"/.test(ROTA))

// ── 3) O caminho canônico está ligado ──────────────────────────────────────
secao("3) materializarExecucaoDaFase → materializarGenealogia")

const MAT = semComentarios("src/services/materializar-fase.ts")
ok("materializar-fase importa materializarGenealogia", /import \{ materializarGenealogia \}/.test(MAT))
ok("materializar-fase CHAMA materializarGenealogia", /await materializarGenealogia\(input\.processoId\)/.test(MAT))
ok("a chamada vem ANTES de instanciarWorkflowDaFase (alvo antes do passo)",
  MAT.indexOf("materializarGenealogia(input.processoId)") < MAT.indexOf("instanciarWorkflowDaFase({"))

const PWF = semComentarios("src/services/phase-workflow.ts")
ok("carregarContextoEscopo NÃO cria necessidade", !/necessidadeDocumental\.(create|upsert|createMany)/.test(PWF))
ok("phase-workflow apenas LÊ necessidades", /necessidadeDocumental\.findMany/.test(PWF))

// ── 4) Um único ponto de escrita ───────────────────────────────────────────
secao("4) Quem pode gravar NecessidadeDocumental")

// A varredura é sobre src/ inteiro: qualquer create fora do serviço canônico é
// um motor novo nascendo.
import { readdirSync, statSync } from "node:fs"
const varrer = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(join(RAIZ, dir))) {
    const rel = `${dir}/${e}`
    if (statSync(join(RAIZ, rel)).isDirectory()) varrer(rel, out)
    else if (/\.tsx?$/.test(e)) out.push(rel)
  }
  return out
}
const arquivos = varrer("src")
const criadores = arquivos.filter((f) => /necessidadeDocumental\.(create|upsert|createMany)\b/.test(semComentarios(f)))
console.log(`  criadores encontrados: ${criadores.join(", ") || "(nenhum)"}`)
ok("existe EXATAMENTE um criador de NecessidadeDocumental", criadores.length === 1, criadores.join(", "))
ok("o criador é o serviço canônico garantirNecessidade", criadores[0] === "src/services/necessidade-documental.ts")

// e o serviço canônico só grava por chave de idempotência
ok("garantirNecessidade grava sempre com chaveIdempotencia", /chaveIdempotencia,\n/.test(ler("src/services/necessidade-documental.ts")))

// ── 5) Quem chama o criador canônico ───────────────────────────────────────
secao("5) Chamadores de garantirNecessidade — todos canônicos")

const chamadores = arquivos.filter((f) =>
  f !== "src/services/necessidade-documental.ts" && /\bgarantirNecessidade\s*\(/.test(semComentarios(f)))
console.log(`  chamadores: ${chamadores.join(", ")}`)
// MATERIALIZADOR ≠ ATO ADMINISTRATIVO.
//
// Materializador percorre regras × pessoas e decide sozinho o que deve existir —
// é dele que nasce duplicidade quando há mais de um. Ato administrativo cria UMA
// necessidade a partir de uma decisão humana explícita, já auditada.
//
// Só o motor oficial materializa. Os outros dois criam um registro por ato:
//  · criar_manual — necessidade avulsa pedida na tela;
//  · CRIAR_NECESSIDADE — operação de proposta APROVADA no Motor Registral,
//    dentro da transação que versiona, audita e permite reversão.
const PERMITIDOS = new Set([
  "src/services/genealogia/materializar-genealogia.ts",              // MOTOR OFICIAL
  "src/app/api/processos/[processoId]/necessidades/route.ts",        // ato administrativo
  "src/services/registral/aplicar.ts",                              // ato administrativo (proposta aprovada)
])
for (const c of chamadores) ok(`chamador autorizado: ${c}`, PERMITIDOS.has(c))
ok("o motor oficial está entre os chamadores", chamadores.includes("src/services/genealogia/materializar-genealogia.ts"))
// nenhum ato administrativo pode virar materializador disfarçado: só o motor
// oficial pode LER a Matriz Documental para decidir o que criar.
const leemMatriz = arquivos.filter((f) => /matrizDocumental\.findMany/.test(semComentarios(f)) && /garantirNecessidade\s*\(/.test(semComentarios(f)))
ok("só o motor oficial lê a Matriz e cria necessidade no mesmo arquivo", leemMatriz.length === 1 && leemMatriz[0] === "src/services/genealogia/materializar-genealogia.ts", leemMatriz.join(", ") || "(nenhum)")

// ── 6) O motor oficial só usa regra PUBLICADA ──────────────────────────────
secao("6) O motor oficial obedece às Regras Documentais publicadas")

const GEN = semComentarios("src/services/genealogia/materializar-genealogia.ts")
ok("filtra status PUBLICADA", /status: "PUBLICADA"/.test(GEN))
ok("ignora regra ARQUIVADA (v1 arquivada + v2 publicada não materializam as duas)", /status: "PUBLICADA", arquivado: false/.test(GEN))
ok("avalia as condições da regra", /avaliarRegrasDocumentais\(/.test(GEN))
ok("aplica a política de natureza da fase", /naturezaPermitidaNaFase\(/.test(GEN))
ok("grava varianteKey derivada do código+versão da regra", /varianteKey = `rd:\$\{codigo\}:v\$\{regra\.versao\}`/.test(GEN))

// ── Resultado ──────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(62)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhou > 0) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
console.log("Existe apenas um materializador documental no Discovery.\n")
