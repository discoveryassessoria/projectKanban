// scripts/arvore-arquitetura-guard.test.ts
// ============================================================================
// FRONTEIRA DE DOMÍNIO DA ÁRVORE GENEALÓGICA — congelada em CI.
//
// A Árvore é: visualização, navegação, diagnóstico, agregação e simulação
// read-only. Ela NÃO é fonte da verdade de documento, workflow, tarefa ou
// dinheiro. Este arquivo transforma essa frase em falha de build.
//
// Por que um guard e não uma convenção: a fronteira já foi rompida uma vez sem
// ninguém perceber. A árvore lia `Pessoa.documentos` e pintava semáforo
// documental por conta própria — regra do Sistema Documental dentro da árvore,
// duas fontes para a mesma verdade, e nada quebrava. Convenção não pega isso;
// build vermelho pega.
//
// SEIS FRONTEIRAS:
//   1. ESCRITA      — nenhuma escrita direta em entidade de dono alheio
//   2. IMPORTS      — a UI não importa prisma, repositório nem materializador
//   3. PROJEÇÃO     — a árvore não reconstrói entidade de domínio localmente
//   4. OWNER ÚNICO  — cada entidade protegida tem um dono declarado
//   5. DIREÇÃO      — a dependência anda num sentido só
//   6. PREVIEW      — a simulação reusa os resolvers da execução real
//
// Rodar: npm run test:arvore-arquitetura
// ============================================================================

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { OWNERS_CANONICOS } from "@/src/lib/genealogia/contratos"

const RAIZ = process.cwd()
let falhas = 0
let passos = 0

function ok(desc: string, extra?: string) {
  passos++
  console.log(`  ✅ ${desc}${extra ? ` — ${extra}` : ""}`)
}
function falhar(desc: string, detalhe: string) {
  falhas++
  console.log(`  ❌ ${desc}`)
  console.log(`     ${detalhe}`)
}
function ler(rel: string): string {
  const c = join(RAIZ, rel)
  return existsSync(c) ? readFileSync(c, "utf-8") : ""
}

/**
 * Código executável, sem comentários.
 *
 * Necessário porque estes arquivos EXPLICAM por escrito o que não fazem — e um
 * guard ingênuo casa com a explicação e reprova o código que está certo e bem
 * documentado. Já aconteceu nesta suíte.
 */
function codigo(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n")
}

function arquivos(dir: string, out: string[] = []): string[] {
  const abs = join(RAIZ, dir)
  if (!existsSync(abs)) return out
  for (const nome of readdirSync(abs)) {
    const rel = join(dir, nome)
    if (statSync(join(RAIZ, rel)).isDirectory()) arquivos(rel, out)
    else if (/\.tsx?$/.test(nome)) out.push(rel)
  }
  return out
}

// ── O MÓDULO DA ÁRVORE ──────────────────────────────────────────────────────
//
// Definido por inclusão explícita, não por "tudo que tem genealogia no nome".
// `lib/genealogia/registral/` é o Motor Registral — outro subsistema, com outro
// dono, que só divide a pasta. Varrê-lo aqui reprovaria código alheio e faria o
// guard perder credibilidade.
const UI_DA_ARVORE = arquivos("src/components/arvore")
const MOTORES_PUROS = [
  ...arquivos("src/lib/genealogia/motor"),
  ...arquivos("src/lib/genealogia/navegacao"),
  ...arquivos("src/lib/genealogia/operacional"),
  ...arquivos("src/lib/genealogia/documental"),
  "src/lib/genealogia/contratos.ts",
]
const MODULO = [...UI_DA_ARVORE, ...MOTORES_PUROS]

console.log("\n══ ÁRVORE GENEALÓGICA — FRONTEIRA DE DOMÍNIO ══\n")
console.log(`  módulo: ${UI_DA_ARVORE.length} arquivos de UI + ${MOTORES_PUROS.length} de motor puro\n`)

// ── 1) ESCRITA ──────────────────────────────────────────────────────────────
console.log("1) escrita direta em domínio alheio")

const PROTEGIDAS = Object.keys(OWNERS_CANONICOS)
/** Nome do model como o Prisma Client o expõe (primeira letra minúscula). */
const comoNoClient = (m: string) => m.charAt(0).toLowerCase() + m.slice(1)
const ESCRITAS = [
  "create", "createMany", "createManyAndReturn",
  "update", "updateMany", "upsert",
  "delete", "deleteMany",
]

const violacoesEscrita: string[] = []
for (const rel of MODULO) {
  const src = codigo(ler(rel))
  for (const modelo of PROTEGIDAS) {
    for (const escrita of ESCRITAS) {
      // Casa `prisma.tarefa.create(`, `tx.custo.update(`, `db.documento.delete(`.
      const orm = new RegExp(`\\b(prisma|tx|db|client)\\s*\\.\\s*${comoNoClient(modelo)}\\s*\\.\\s*${escrita}\\s*\\(`)
      if (orm.test(src)) violacoesEscrita.push(`${rel} → ${modelo}.${escrita}()`)
    }
    // SQL cru é o desvio mais fácil de esconder do ORM.
    const sql = new RegExp(`\\$(?:execute|query)Raw(?:Unsafe)?[\\s\\S]{0,400}?(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+"?${modelo}"?`, "i")
    if (sql.test(src)) violacoesEscrita.push(`${rel} → SQL cru em ${modelo}`)
  }
}
if (violacoesEscrita.length === 0) {
  ok(`zero escrita direta em ${PROTEGIDAS.length} entidades protegidas`)
} else {
  for (const v of violacoesEscrita) falhar(`escrita direta: ${v}`, "a árvore é consumidora, não dona")
}

// A árvore também não pode CHAMAR o endpoint de escrita de domínio alheio.
// Foi assim que a exclusão de Documento sobreviveu: sem `prisma` à vista,
// invisível para um guard que só olha ORM.
const ROTAS_ALHEIAS: Array<[RegExp, string]> = [
  [/authFetch\(\s*[`'"]\/api\/documentos\//, "Documento (Sistema Documental)"],
  [/authFetch\(\s*[`'"]\/api\/tarefas\//, "Tarefa (motor de workflow)"],
  [/authFetch\(\s*[`'"]\/api\/necessidades?\//, "NecessidadeDocumental"],
  [/authFetch\(\s*[`'"][^`'"]*\/(custos|receitas|financeiro|v3)\//, "Financeiro"],
]
const violacoesRota: string[] = []
for (const rel of UI_DA_ARVORE) {
  const src = codigo(ler(rel))
  for (const [padrao, dono] of ROTAS_ALHEIAS) {
    if (!padrao.test(src)) continue
    // Só reprova quando há verbo de escrita no arquivo — ler é permitido.
    if (/method:\s*['"`](POST|PUT|PATCH|DELETE)/i.test(src)) {
      violacoesRota.push(`${rel} → escreve em ${dono} por HTTP`)
    }
  }
}
if (violacoesRota.length === 0) ok("nenhuma escrita por HTTP em rota de domínio alheio")
else for (const v of violacoesRota) falhar(v, "escrever é do módulo dono — a árvore leva o operador até ele")

// ── 2) IMPORTS ──────────────────────────────────────────────────────────────
console.log("\n2) imports proibidos na UI e nos motores")

const IMPORTS_PROIBIDOS: Array<[RegExp, string]> = [
  [/from ["'][^"']*\/prisma["']/, "cliente Prisma"],
  [/from ["']@prisma\/client["']/, "@prisma/client"],
  [/from ["'][^"']*materializar[^"']*["']/, "materializador"],
  [/from ["'][^"']*reconciliar[^"']*["']/, "reconciliador"],
  [/from ["'][^"']*\/repositor(y|ies|io)[^"']*["']/, "repositório"],
  [/from ["'][^"']*lib\/financeiro\/[^"']*["']/, "implementação financeira"],
  [/from ["'][^"']*services\/(phase-workflow|workflow)[^"']*["']/, "motor de workflow"],
]
const violacoesImport: string[] = []
for (const rel of MODULO) {
  const src = codigo(ler(rel))
  for (const [padrao, oque] of IMPORTS_PROIBIDOS) {
    if (padrao.test(src)) violacoesImport.push(`${rel} → importa ${oque}`)
  }
}
if (violacoesImport.length === 0) {
  ok("UI e motores não importam prisma, repositório, materializador nem financeiro")
} else {
  for (const v of violacoesImport) falhar(v, "a árvore importa contratos e serviços de aplicação, não implementação")
}

// ── 3) PROJEÇÃO ─────────────────────────────────────────────────────────────
console.log("\n3) nenhuma projeção paralela de domínio")

const PROJECOES_PARALELAS: Array<[RegExp, string]> = [
  [/avaliarRegrasDocumentais|matrizDocumental|regrasGenealogiaDoProcesso/, "avaliação de Regra Documental"],
  [/TabelaValor|resolverPreco|calcularPreco|aplicarHonorarios/, "resolução de preço"],
  [/registrarOcorrencia|LedgerEntry|lancarNoLedger/, "escrituração no Ledger"],
  [/garantirNecessidade|dispensarNecessidade|reativarNecessidade/, "ciclo de vida de necessidade"],
  [/criarTarefa|gerarTarefa|projetarTarefaDoPasso/, "criação de tarefa"],
]
const violacoesProjecao: string[] = []
for (const rel of MODULO) {
  const src = codigo(ler(rel))
  for (const [padrao, oque] of PROJECOES_PARALELAS) {
    if (padrao.test(src)) violacoesProjecao.push(`${rel} → ${oque}`)
  }
}
if (violacoesProjecao.length === 0) {
  ok("a árvore não reconstrói documento, tarefa, preço nem lançamento")
} else {
  for (const v of violacoesProjecao) falhar(v, "isso pertence ao módulo dono; a árvore consome a projeção pronta")
}

// O contrato precisa ser ESTREITO: campos que permitiriam reavaliar a regra
// documental não podem entrar nele. Com `condicoes`/`publicoAlvo` em mãos, a
// árvore conseguiria decidir sozinha o que é exigido — e voltaria a ser motor.
const contratos = codigo(ler("src/lib/genealogia/contratos.ts"))
const VAZAMENTOS = ["condicoes", "publicoAlvo", "varianteKey", "matrizSnapshot", "documentosAceitos", "pricingRuleId"]
const vazou = VAZAMENTOS.filter((c) => new RegExp(`\\b${c}\\b`).test(contratos))
if (vazou.length === 0) ok("o contrato não expõe insumo de regra (condição, público-alvo, variante)")
else falhar(`contrato expõe ${vazou.join(", ")}`, "com esses campos a árvore reavalia a regra e vira motor")

// ── 4) OWNER ÚNICO ──────────────────────────────────────────────────────────
console.log("\n4) owner único por entidade")

if (PROTEGIDAS.length >= 10) ok(`${PROTEGIDAS.length} entidades com dono declarado`)
else falhar("o mapa de owners encolheu", "toda entidade que a árvore lê precisa de dono nomeado")

const semDono = Object.entries(OWNERS_CANONICOS).filter(([, dono]) => !dono || dono.trim().length < 5)
if (semDono.length === 0) ok("nenhuma entidade protegida sem dono nomeado")
else falhar(`sem dono: ${semDono.map(([e]) => e).join(", ")}`, "dono vazio é o mesmo que dono nenhum")

// O dono da NecessidadeDocumental tem de existir de fato — não basta o texto.
const donoNecessidade = OWNERS_CANONICOS.NecessidadeDocumental
if (existsSync(join(RAIZ, donoNecessidade))) ok(`dono de NecessidadeDocumental existe (${donoNecessidade})`)
else falhar(`dono declarado não existe: ${donoNecessidade}`, "owner precisa apontar para código real")

// ── 5) DIREÇÃO DA DEPENDÊNCIA ───────────────────────────────────────────────
console.log("\n5) direção da dependência")

// Domínio nunca conhece a UI da árvore.
const DOMINIO = [
  ...arquivos("src/services"),
  ...arquivos("lib/financeiro"),
]
const inversoes = DOMINIO.filter((f) => /from ["'][^"']*components\/arvore/.test(codigo(ler(f))))
if (inversoes.length === 0) ok(`${DOMINIO.length} arquivos de domínio, nenhum importa a UI da árvore`)
else for (const f of inversoes) falhar(`${f} importa a UI da árvore`, "a dependência anda num sentido só")

// Os motores puros não podem depender da UI — é o que os mantém testáveis.
const motorPuxaUi = MOTORES_PUROS.filter((f) => /from ["'][^"']*components\//.test(codigo(ler(f))))
if (motorPuxaUi.length === 0) ok("motores puros não dependem de componente")
else for (const f of motorPuxaUi) falhar(`${f} importa componente`, "o motor tem de rodar sem React")

// ── 6) PREVIEW REUSA OS RESOLVERS DA EXECUÇÃO ───────────────────────────────
console.log("\n6) preview × execução: uma regra só")

const simulador = ler("src/services/genealogia/simular-impacto.ts")
const codSim = codigo(simulador)

if (/materializarGenealogia\s*\(\s*entrada\.processoId\s*,\s*tx\s*\)/.test(codSim)) {
  ok("a simulação chama o materializador OFICIAL, com o transaction client")
} else {
  falhar("a simulação não usa mais o materializador oficial", "seria a segunda implementação da regra documental")
}
if (/class RollbackDaSimulacao/.test(codSim) && /throw new RollbackDaSimulacao/.test(codSim)) {
  ok("a simulação termina sempre em rollback (read-only por construção)")
} else {
  falhar("o rollback da simulação sumiu", "sem o throw a transação COMMITA e o preview passa a gravar")
}
// A simulação só pode tocar o que é do domínio da ÁRVORE.
const tocados = new Set([...codSim.matchAll(/\bdb\.([a-zA-Z]+)\.(create|update|updateMany|delete|deleteMany|upsert)\s*\(/g)].map((m) => m[1]))
const excedentes = [...tocados].filter((m) => !["pessoa", "uniao"].includes(m))
if (excedentes.length === 0) ok("a simulação só escreve em Pessoa e Uniao (e reverte)")
else falhar(`a simulação escreve em ${excedentes.join(", ")}`, "só o domínio da árvore entra na proposta")

// Nenhuma regra documental reimplementada dentro do simulador.
const regraNoSimulador = ["avaliarRegrasDocumentais", "publicoAlvoAplica", "avaliarConjunto", "condicoes"]
  .filter((t) => new RegExp(`\\b${t}\\b`).test(codSim))
if (regraNoSimulador.length === 0) ok("o simulador não reimplementa avaliação de regra")
else falhar(`simulador com ${regraNoSimulador.join(", ")}`, "a regra vive no motor documental, e só lá")

// ── veredito ────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(64))
if (falhas === 0) {
  console.log(`${passos} verificações · FRONTEIRA DA ÁRVORE ÍNTEGRA ✅\n`)
  process.exit(0)
}
console.log(`${passos - falhas} passaram, ${falhas} falharam`)
console.log(`
A FRONTEIRA DE DOMÍNIO DA ÁRVORE FOI ROMPIDA.

A Árvore é visualização, navegação, diagnóstico, agregação e simulação
read-only. Escrever em documento, workflow, tarefa ou financeiro é do módulo
dono — ver OWNERS_CANONICOS em src/lib/genealogia/contratos.ts e o
ADR-12 em docs/adr/.

Se você chegou aqui por causa de outra tarefa, a resposta quase certa NÃO é
afrouxar o guard: é chamar o serviço canônico.
`)
process.exit(1)
