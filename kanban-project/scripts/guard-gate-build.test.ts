// scripts/guard-gate-build.test.ts
// ============================================================================
// GUARD DO PRÓPRIO GATE — o que garante que "teste vermelho ⇒ deploy não sai" continua
// verdadeiro. SEM banco. Rodar: npx tsx scripts/guard-gate-build.test.ts
//
// Um gate que alguém consegue desligar sem perceber não é gate. Este guard trava:
//   1. a ORDEM do build: o gate roda ANTES do guard de migration e do prod-migrate-guard (que
//      escrevem no banco de produção) — falhou, nada foi migrado;
//   2. não existe variável de bypass no gate;
//   3. o executor monta o ambiente do teste (nunca herda a URL de produção do build);
//   4. o banco de teste é montado por migrations (nunca `db push`) e recusa banco não-teste;
//   5. o manifesto cobre as áreas obrigatórias e só cita arquivos que existem;
//   6. todo teste isolado tem justificativa escrita no próprio arquivo (nada de skip silencioso);
//   7. a regra está registrada no CLAUDE.md.
// ============================================================================
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"

const RAIZ = join(__dirname, "..")
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8")
const semComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

let ok = 0
const falhas: string[] = []
const check = (nome: string, cond: boolean, extra = "") => {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

console.log("\nGUARD — O GATE DO BUILD\n")

console.log("1. ordem do build")
const pkg = JSON.parse(ler("package.json")) as { scripts: Record<string, string>; devDependencies?: Record<string, string> }
const build = pkg.scripts.build
const pos = (t: string) => build.indexOf(t)
check("o build começa pelo guard de ambiente de produção", build.startsWith("node scripts/guard-env-producao.mjs"))
check("prisma generate roda antes do gate (os testes usam o client)", pos("prisma generate") > -1 && pos("prisma generate") < pos("gate-build.mjs"))
check("o gate roda ANTES do guard de migration", pos("gate-build.mjs") > -1 && pos("gate-build.mjs") < pos("migration-pendente-guard.mjs"))
check("o gate roda ANTES do prod-migrate-guard (que ESCREVE em produção)", pos("gate-build.mjs") < pos("prod-migrate-guard.mjs"))
check("o gate roda ANTES do next build", pos("gate-build.mjs") < pos("next build"))
check("o gate está encadeado com && (falhou, o build para)", /gate-build\.mjs\s*&&/.test(build))
check("dependências do gate declaradas (embedded-postgres, pg)", !!pkg.devDependencies?.["embedded-postgres"] && !!pkg.devDependencies?.["pg"])

console.log("2. sem bypass")
const gate = ler("scripts/ci/gate-build.mjs")
const runner = ler("scripts/ci/rodar-suite.mjs")
check("o gate não lê nenhuma variável de ambiente para se desligar", !/process\.env\.[A-Z_]*(SKIP|PULAR|BYPASS|IGNORAR|DESLIGAR|SEM_GATE)/i.test(gate + runner))
check("o gate propaga o código de saída da suíte (exit 1)", /process\.exit\(1\)/.test(gate) && /r\.status !== 0/.test(gate))
check("timeout por arquivo derruba o teste (SIGKILL) e conta como falha", /SIGKILL/.test(runner) && /TIMEOUT/.test(runner))

console.log("3. ambiente do teste montado, não herdado")
const corpoEnv = /const env = \{([\s\S]*?)\n    \}/.exec(runner)?.[1] ?? ""
check("o env do filho é montado (não faz spread de process.env)", corpoEnv.length > 0 && !/\.\.\.process\.env/.test(corpoEnv))
check("o filho recebe as URLs do banco de TESTE", /PRISMA_DATABASE_URL: url/.test(corpoEnv) && /DIRECT_DATABASE_URL: url/.test(corpoEnv))
check("segredos de produção não passam (JWT de CI fixo)", /JWT_SECRET: 'ci-suite-critica-nao-usar-em-producao'/.test(corpoEnv))

console.log("4. banco de teste = migrations de produção")
const criar = ler("scripts/ci/criar-banco-de-teste.mjs")
check("monta por baseline + migrate deploy, nunca `db push`", /migrate['"], 'deploy'|'migrate', 'deploy'/.test(criar) && !/db push/.test(semComentarios(criar).replace(/'db', 'push'/g, 'db push')))
check("prova zero diferença contra o schema.prisma", /migrate', 'diff'/.test(criar) && /empty migration/.test(criar))
check("recusa recriar banco que não seja local e de teste", /\/test\/i\.test\(BANCO\)/.test(criar) && /127\.0\.0\.1/.test(criar))
check("carrega o catálogo de fases de referência", /carregar-referencia\.ts/.test(criar) && existsSync(join(RAIZ, "scripts/ci/fixtures/catalogo-fase.json")))

console.log("5. manifesto da suíte crítica")
const man = JSON.parse(ler("scripts/ci/suite-critica.json")) as { grupos: Record<string, string[]>; arquivos: string[] }
const AREAS = [
  "fechamento do último passo", "correlationId", "retrocesso de fase", "reativação sem duplicar e sem responsável",
  "régua de cobrança", "repactuação / CERT-001", "sino agrupado", "guards de arquitetura",
]
for (const a of AREAS) {
  const g = Object.keys(man.grupos).find((k) => k.startsWith(a))
  check(`área obrigatória presente e não vazia: ${a}`, !!g && man.grupos[g].length > 0, g ?? "(ausente)")
}
const inexistentes = man.arquivos.filter((a) => !existsSync(join(RAIZ, a)))
check("todo arquivo do manifesto existe", inexistentes.length === 0, inexistentes.join(", "))
check("sem duplicata no manifesto", new Set(man.arquivos).size === man.arquivos.length)
check("o manifesto inclui o teste do sino agrupado e o guard do gate", man.arquivos.includes("scripts/sino-agrupado.test.ts") && man.arquivos.includes("scripts/guard-gate-build.test.ts"))

console.log("6. nada de skip silencioso")
const testes = readdirSync(join(RAIZ, "scripts")).filter((f) => f.endsWith(".test.ts"))
const isolados: Array<{ f: string; motivo: string }> = []
for (const f of testes) {
  const cab = ler(`scripts/${f}`).split("\n").slice(0, 40).join("\n")
  const m = /^\/\/\s*SUITE:\s*isolado\b\s*[—-]?\s*(.*)$/m.exec(cab)
  if (m) isolados.push({ f, motivo: m[1].trim() })
}
const semMotivo = isolados.filter((i) => i.motivo.length < 15)
check(`todo teste isolado tem justificativa escrita (${isolados.length} isolado(s))`, semMotivo.length === 0, semMotivo.map((i) => i.f).join(", "))
const isoNoManifesto = isolados.filter((i) => man.arquivos.includes(`scripts/${i.f}`))
check("teste isolado não está listado na suíte crítica (não pode ser 'crítico' e 'isolado')", isoNoManifesto.length === 0, isoNoManifesto.map((i) => i.f).join(", "))
const skipsMudos = testes.filter((f) => /\b(it|test|describe)\.(skip|only)\b|\bxit\(|\bxdescribe\(/.test(ler(`scripts/${f}`)))
check("nenhum .skip/.only escondido nos testes", skipsMudos.length === 0, skipsMudos.join(", "))

console.log("6b. pendências de decisão (achados de produto ainda sem dono)")
const pendencias: Array<{ f: string; motivo: string }> = []
for (const f of testes) {
  const src = ler(`scripts/${f}`)
  for (const m of src.matchAll(/(?<!function )pendenteDeDecisao\(\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[^,]+),[\s\S]*?,\s*"((?:[^"\\]|\\.){30,})"/g)) pendencias.push({ f, motivo: m[1] })
}
check(`toda pendência de decisão traz o motivo por extenso (${pendencias.length} registrada(s))`, pendencias.every((p) => p.motivo.length >= 30))
for (const p of pendencias) console.log(`     ⚠️ ${p.f}: ${p.motivo.slice(0, 110)}…`)

console.log("7. regra registrada")
const claude = ler("CLAUDE.md")
check("CLAUDE.md: 'todo deploy passa pela suíte crítica; teste novo para cada bug corrigido'", /todo deploy passa pela suíte crítica; teste novo para cada bug corrigido/i.test(claude))

console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
