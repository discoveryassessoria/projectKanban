/**
 * GUARD ARQUITETURAL OBRIGATÓRIO — CADASTRO NO PROCESSO ≠ DENTRO DA ÁRVORE.
 * Rodar: npm run test:guard-cadastro-arvore   (obrigatório no CI)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A REGRA
 * ═══════════════════════════════════════════════════════════════════════════
 *   EXISTIR NO PROCESSO ≠ PARTICIPAR DA ÁRVORE.
 *
 * Cadastrar um requerente é ato administrativo e NÃO é gatilho genealógico.
 * O ciclo começa numa transição explícita: FORA_DA_ARVORE → NA_ARVORE.
 * Um requerente pode ficar fora da árvore indefinidamente — isso é estado
 * legítimo de negócio, não pendência técnica.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE GUARD EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 * O contrato já foi violado três vezes, em três formas diferentes:
 *   · a rota era dona do efeito (duas portas, dois estados finais);
 *   · o motor econômico não tinha o inverso da entrada;
 *   · cinco consultas contavam requerente por régua de flag própria — sem 'sim'
 *     e sem excluir removidos. Medido no processo 513: régua local 0, régua
 *     canônica 1. O gate da fase e o honorário agregado enxergavam ZERO
 *     requerente num processo que tem um.
 *
 * E a auditoria de 09/08 encontrou 49 testes que escrevem em banco sem verificar
 * ambiente — rodando com o `.env` do projeto, que aponta para produção.
 *
 * Regra escrita em documento é combinada. Regra verificada no CI é contrato.
 */
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative } from "node:path"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const ESTE = "scripts/guard-cadastro-nao-e-arvore.test.ts"
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8")

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const IGNORAR = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage", "tmp", "capturas", "public", "_tmp"])
const arquivos: string[] = []
;(function varrer(dir: string) {
  for (const nome of readdirSync(dir)) {
    if (IGNORAR.has(nome)) continue
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) varrer(caminho)
    else if (/\.(tsx?|mjs)$/.test(nome)) arquivos.push(relative(RAIZ, caminho).replace(/\\/g, "/"))
  }
})(RAIZ)
const conteudo = new Map(arquivos.map((f) => [f, readFileSync(join(RAIZ, f), "utf8")]))
const quemUsa = (re: RegExp, exceto: string[] = []) =>
  arquivos.filter((f) => !exceto.includes(f) && re.test(conteudo.get(f)!))

console.log("GUARD — CADASTRO NO PROCESSO ≠ DENTRO DA ÁRVORE\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("1) O contrato existe como CÓDIGO, não como combinado")
// ═══════════════════════════════════════════════════════════════════════════
const contrato = ler("lib/genealogia/estados-requerente.ts")
for (const estado of ["FORA_DA_ARVORE", "NA_ARVORE", "REMOVIDO_DA_ARVORE", "FORA_DO_PROCESSO"]) {
  ok(`o estado ${estado} está declarado`, contrato.includes(estado))
}
ok("existe matriz de efeitos por estado", /EFEITOS_POR_ESTADO/.test(contrato))
ok("existe tabela de transições com gatilho e porta", /TRANSICOES/.test(contrato) && /gatilho:/.test(contrato) && /porta:/.test(contrato))
ok("nenhuma transição para NA_ARVORE nasce de cadastro",
  !/para: "NA_ARVORE"[\s\S]{0,200}gatilho: "cadastr/i.test(contrato))
ok("o contrato é PURO — não importa Prisma", !/from ["']@prisma\/client["']|lib\/prisma/.test(contrato))

// ═══════════════════════════════════════════════════════════════════════════
secao("2·A–D) Cadastrar requerente não dispara nada genealógico")
// ═══════════════════════════════════════════════════════════════════════════
// As portas de CADASTRO: onde o vínculo comercial nasce.
const PORTAS_CADASTRO = [
  "src/app/api/requerentes/route.ts",
  "src/app/api/requerentes/[id]/route.ts",
  "src/app/api/processos/[processoId]/route.ts",
  "src/services/criar-processo.ts",
]
const EFEITO_GENEALOGICO = [
  ["emitir o evento", /enfileirarEventoRequerente\s*\(|emitirEDrenarEventoRequerente\s*\(|["']requerente\.adicionado["']/],
  ["criar membership", /vincularRequerente(Tx)?\s*\(/],
  ["chamar o financeiro genealógico", /processarRequerenteAdicionado\s*\(|aplicarHonorarios/],
  ["chamar o materializador", /dispararMaterializacaoPorArvore\s*\(|materializarGenealogia\s*\(/],
] as const
for (const porta of PORTAS_CADASTRO) {
  if (!existsSync(join(RAIZ, porta))) { ok(`porta de cadastro existe: ${porta}`, false, "arquivo sumiu — atualize o guard"); continue }
  const src = ler(porta)
  for (const [oque, re] of EFEITO_GENEALOGICO) {
    ok(`${porta.replace("src/app/api/", "")} não ${oque}`, !re.test(src))
  }
}

// ═══════════════════════════════════════════════════════════════════════════
secao("3·E–G) Membership só nasce pela porta canônica")
// ═══════════════════════════════════════════════════════════════════════════
const CANONICO = "lib/genealogia/vincular-requerente.ts"
// CRIAR NÓ DE ÁRVORE é legítimo em mais de um lugar: `POST /api/pessoas` é como
// se adiciona um ASCENDENTE (pai, mãe, avô), que não é requerente de nada. O que
// só o serviço canônico pode fazer é criar nó MARCADO COMO REQUERENTE — é esse
// ato que carrega efeito financeiro e documental.
const criamRequerenteNaArvore = quemUsa(
  /pessoa\.create\s*\(\s*\{[\s\S]{0,500}requerente:\s*(flagRequerente|['"](sim|maior|menor)['"])/,
  [CANONICO, ESTE, ...arquivos.filter((f) => f.startsWith("scripts/") || f.startsWith("prisma/"))],
)
ok("nenhum runtime cria nó REQUERENTE fora do serviço canônico",
  criamRequerenteNaArvore.length === 0, criamRequerenteNaArvore.join(", ") || "nenhum desvio")
ok("POST /api/pessoas normaliza requerente para 'nao' (ascendente não é requerente)",
  /requerente:\s*ehRequerente\(requerente\)\s*\?\s*'nao'/.test(ler("src/app/api/pessoas/route.ts")),
  "requerente é definido pelo vínculo com o Processo, não por este endpoint")
ok("PUT /api/pessoas/[id] recusa marcar requerente sem vínculo com o Processo",
  /Requerente é definido pelo vínculo com o Processo/.test(ler("src/app/api/pessoas/[id]/route.ts")))

// ═══════════════════════════════════════════════════════════════════════════
secao("4·H–I) personId não é membership; requerente do processo não é membro")
// ═══════════════════════════════════════════════════════════════════════════
// O recorte de "quem está na árvore" tem UMA fonte. Régua local — contar flag à
// mão — foi o defeito medido no 513.
const REGUA_LOCAL = /requerente:\s*\{\s*in:\s*\[\s*['"]maior['"]\s*,\s*['"]menor['"]/
const comReguaPropria = quemUsa(REGUA_LOCAL, [ESTE, "src/lib/genealogia/vinculo-ativo.ts", "lib/genealogia/requerente-flag.ts"])
  .filter((f) => f.startsWith("src/") || f.startsWith("lib/"))
ok("nenhum runtime conta requerente da árvore por régua própria",
  comReguaPropria.length === 0,
  comReguaPropria.join(", ") || "todos usam requerentesAtivosDaArvore / REQUERENTE_ATIVO")
ok("o recorte canônico exclui removidos",
  /REQUERENTE_ATIVO[\s\S]{0,200}PESSOA_ATIVA/.test(ler("src/lib/genealogia/vinculo-ativo.ts")))
ok("o recorte canônico inclui 'sim' (fonte única do flag)",
  /REQUERENTE_VALORES/.test(ler("src/lib/genealogia/vinculo-ativo.ts")))

// `ProcessoRequerente` NÃO pode ser lido como se fosse membership pelos motores.
const MOTORES = ["src/lib/motor/blocking-engine.ts", "src/lib/process-stage/operational-projection.ts", "src/services/genealogia/materializar-genealogia.ts"]
for (const m of MOTORES) {
  ok(`${m.split("/").pop()} não deriva genealogia de ProcessoRequerente`,
    !/processoRequerente\.(count|findMany|groupBy)/.test(ler(m)))
}

// ═══════════════════════════════════════════════════════════════════════════
secao("5·28) Nenhum health check trata 'fora da árvore' como corrupção")
// ═══════════════════════════════════════════════════════════════════════════
// Requerente ativo sem nó é ESTADO VÁLIDO. Alertar sobre isso ensinaria a
// equipe a ignorar o alerta — e o próximo alerta real morre junto.
const SUSPEITO = /personId:\s*null[\s\S]{0,200}(orfa|órfã|inconsist|corromp|erro|invalid)/i
const alertamForaDaArvore = quemUsa(SUSPEITO, [ESTE]).filter((f) => f.startsWith("src/") || f.startsWith("lib/"))
ok("nenhuma verificação de saúde classifica requerente sem nó como problema",
  alertamForaDaArvore.length === 0, alertamForaDaArvore.join(", ") || "nenhuma")

// ═══════════════════════════════════════════════════════════════════════════
secao("6·34) Teste automatizado não escreve em produção")
// ═══════════════════════════════════════════════════════════════════════════
const ESCRITA = /\b(prisma|tx|db)\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\$executeRaw/
const USA_PRISMA = /from ["'][^"']*(lib\/prisma|@prisma\/client)["']/
const TEM_TRAVA = /exigirBancoDeTeste|exigirConfirmacaoDeEscritaEmProducao|127\.0\.0\.1|localhost|kanban_test|discovery_test/

/** Atos administrativos deliberados em produção — nominais, com confirmação exigida. */
const ATOS_EM_PRODUCAO: Record<string, string> = {
  "scripts/smoke-ui-setup.ts": "cenário marcado dentro do processo 513 real; exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO",
  "scripts/usuario-smoke-tecnico.ts": "cria a identidade técnica de smoke; auditado; exige confirmação",
  "scripts/prod-smoke-tabela-valores.ts": "alterna o tipo do usuário técnico; auditado; exige confirmação",
}

const testesQueEscrevem = arquivos.filter((f) => {
  if (!/^scripts\//.test(f)) return false
  if (!/\.test\.tsx?$|integration|smoke/.test(f)) return false
  const s = conteudo.get(f)!
  return USA_PRISMA.test(s) && ESCRITA.test(s)
})
const semTrava = testesQueEscrevem.filter((f) => !TEM_TRAVA.test(conteudo.get(f)!))
ok("todo teste/smoke que escreve tem trava de ambiente",
  semTrava.length === 0,
  semTrava.join(", ") || `${testesQueEscrevem.length} arquivos varridos, todos travados`)

for (const [f, motivo] of Object.entries(ATOS_EM_PRODUCAO)) {
  if (!existsSync(join(RAIZ, f))) { ok(`ato em produção declarado existe: ${f}`, false, "entrada morta"); continue }
  ok(`${f.replace("scripts/", "")} exige confirmação para escrever em produção`,
    /exigirConfirmacaoDeEscritaEmProducao\s*\(/.test(ler(f)), motivo)
}
const naoDeclarados = testesQueEscrevem
  .filter((f) => /exigirConfirmacaoDeEscritaEmProducao/.test(conteudo.get(f)!))
  .filter((f) => !ATOS_EM_PRODUCAO[f])
ok("nenhum script novo usa a porta de produção sem estar declarado aqui",
  naoDeclarados.length === 0, naoDeclarados.join(", ") || "—")

ok("a trava recusa por padrão (host local E database de teste, as duas)",
  /hostLocal[\s\S]{0,200}\/test\/i\.test\(database\)/.test(ler("scripts/_banco-de-teste.ts")))

// ── Resultado ──────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhou > 0) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  console.log("\nA regra: cadastrar não é participar. Só a entrada explícita na árvore dispara efeito.")
  process.exit(1)
}
console.log("Existir no processo não é participar da árvore — e o CI passa a saber disso.\n")
