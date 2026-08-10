/**
 * GUARD ARQUITETURAL OBRIGATÓRIO — ESCRITA EM NecessidadeDocumental.
 * Rodar: npm run test:guard-necessidade   (obrigatório no CI)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A REGRA
 * ═══════════════════════════════════════════════════════════════════════════
 * Nenhum código de runtime pode criar, atualizar ou fazer upsert de
 * NecessidadeDocumental fora do serviço canônico
 * `src/services/necessidade-documental.ts`.
 *
 * Quem decide QUE obrigação deve existir é um só:
 *   materializarExecucaoDaFase → materializarGenealogia → Regras PUBLICADAS
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE GUARD EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 * O Discovery já teve DOIS materializadores. O segundo
 * (`garantirNecessidadesArvoreDoProcesso`, regras hardcoded) rodava escondido
 * dentro do primeiro, em `carregarContextoEscopo`. Cada um gravava um
 * `varianteKey` diferente para a MESMA obrigação; como a chave de idempotência
 * inclui a variante, o banco aceitava as duas e a mesma pessoa recebia a
 * certidão de nascimento duas vezes.
 *
 * Ninguém percebeu por meses porque nada quebrava: o sistema respondia, os
 * testes passavam, só a contagem estava errada. Um guard que falha no CI é a
 * única coisa que impede isso de voltar por descuido.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO ESTE TESTE FALHA
 * ═══════════════════════════════════════════════════════════════════════════
 * Ele varre TODO o repositório. Qualquer ponto de escrita novo — em runtime,
 * script ou backfill — reprova até ser adicionado à allowlist ABAIXO, com
 * justificativa. A allowlist é código: crescer exige commit e revisão.
 *
 * Se você chegou aqui porque o CI reprovou: a resposta quase certa NÃO é
 * adicionar seu arquivo à lista. É chamar o serviço canônico.
 */
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative } from "node:path"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")

// ═══════════════════════════════════════════════════════════════════════════
// ALLOWLIST — quem pode escrever, e por quê.
// ═══════════════════════════════════════════════════════════════════════════

/** RUNTIME: dono ÚNICO da escrita. Não existe segundo autorizado. */
const DONO_RUNTIME = "src/services/necessidade-documental.ts"

/**
 * FORA DO RUNTIME: backfills (ato administrativo pontual, com dry-run e
 * auditoria) e testes (precisam montar cenário). Cada entrada é nominal — não
 * há regra "tudo em scripts/ pode".
 */
const AUTORIZADOS_FORA_DO_RUNTIME: Record<string, string> = {
  "scripts/tarefa-unidade-operacional.test.ts":
    "unidade operacional da Tarefa: cria e derruba as PRÓPRIAS necessidades (marca TAREFA-OP) " +
    "só no banco de teste — o cenário precisa de uma obrigação real para a tarefa ter causa",
  "scripts/backfill-necessidade-duplicada-motor-legado.ts":
    "backfill: consolida duplicidades do motor legado; dry-run por padrão, audita o que move",
  "prisma/backfill-cp3-necessidades.ts":
    "backfill histórico CP-3: cria necessidades na migração inicial",
  "prisma/consolidar-itemcatalogo-duplicatas.ts":
    "backfill: repontar itemCatalogoId ao consolidar duplicatas do Catálogo",
  "scripts/motor-documental-idempotencia.test.ts": "teste: monta e limpa o cenário das 20 rodadas",
  "scripts/mrg-e2e.test.ts": "teste e2e do Motor Registral: monta cenário",
  "scripts/estrutura-operacional-integracao.test.ts": "teste de integração: monta cenário",
  "scripts/guard-necessidade-documental.test.ts": "este guard (cita os padrões que procura)",
  "scripts/backfill-residuos-pessoa.ts":
    "backfill: remove necessidade SEM SUJEITO (viola pessoaId XOR uniaoId); dry-run por padrão",
  "scripts/pessoa-tortura.test.ts": "teste de tortura do ciclo de vida da Pessoa: monta e limpa o cenário",
  "scripts/reconciliacao-derivada-requerente.test.ts":
    "cenários A–N da reconciliação do estado derivado: monta e limpa o próprio cenário (marca RECONC-DERIVADO)",
  "scripts/porta-unica-requerente.test.ts":
    "equivalência das três portas de inserção: monta e limpa o próprio cenário (marca PORTA-UNICA)",
  "scripts/matriz-estados-requerente.test.ts":
    "matriz de estados do requerente: monta e limpa o próprio cenário (marca MATRIZ-ESTADOS)",
  "scripts/planilha-documental-projecao.test.ts":
    "projeção da Planilha Documental: monta e limpa o próprio cenário (marca PLANILHA-PROJ)",
  "scripts/pessoa-equivalencia-rotas.test.ts": "teste de equivalência das duas rotas: monta dois cenários e limpa",
  "scripts/exclusao-servico.test.ts": "teste de exclusão definitiva de serviço: monta e limpa o cenário",
  "scripts/arvore-membership.test.ts":
    "teste de membership: monta e limpa o próprio cenário; prova que requerente do processo ≠ membro da árvore",
  "scripts/arvore-preview-impacto.test.ts":
    "teste do preview de impacto: só LIMPA o cenário que ele mesmo criou — quem cria a necessidade no teste é o materializador oficial",
}

/** Diretórios de RUNTIME — onde a regra é absoluta. */
const RUNTIME = ["src", "lib"]
/** Demais diretórios versionados que também são varridos. */
const OUTROS = ["scripts", "prisma"]

const IGNORAR = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage", "tmp"])

// ═══════════════════════════════════════════════════════════════════════════

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

/** Código executável: comentários fora, para citar o padrão em doc não reprovar. */
const semComentarios = (texto: string) =>
  texto
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")

function varrer(dir: string, out: string[] = []): string[] {
  const abs = join(RAIZ, dir)
  if (!existsSync(abs)) return out
  for (const entrada of readdirSync(abs)) {
    if (IGNORAR.has(entrada)) continue
    const rel = `${dir}/${entrada}`
    if (statSync(join(RAIZ, rel)).isDirectory()) varrer(rel, out)
    else if (/\.(ts|tsx|mts|cts|mjs|js)$/.test(entrada)) out.push(rel)
  }
  return out
}

/** Operações de ESCRITA do Prisma sobre o modelo. */
const ESCRITAS = ["create", "createMany", "createManyAndReturn", "upsert", "update", "updateMany", "delete", "deleteMany"]
const PADRAO_ESCRITA = new RegExp(`\\bnecessidadeDocumental\\s*\\.\\s*(${ESCRITAS.join("|")})\\b`, "g")
/** SQL cru que toca a tabela — o desvio mais fácil de esconder do ORM. */
const PADRAO_SQL = /\$(?:execute|query)Raw(?:Unsafe)?[\s\S]{0,400}?(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?NecessidadeDocumental"?/gi

console.log("GUARD ARQUITETURAL — escrita em NecessidadeDocumental\n")

const arquivosRuntime = RUNTIME.flatMap((d) => varrer(d))
const arquivosOutros = OUTROS.flatMap((d) => varrer(d))
const todos = [...arquivosRuntime, ...arquivosOutros]
console.log(`  varridos: ${todos.length} arquivos (${arquivosRuntime.length} de runtime)`)

interface Ocorrencia { arquivo: string; linha: number; trecho: string; tipo: "orm" | "sql" }

function escritasEm(rel: string): Ocorrencia[] {
  const bruto = readFileSync(join(RAIZ, rel), "utf8")
  const limpo = semComentarios(bruto)
  const achados: Ocorrencia[] = []
  const linhasLimpo = limpo.split("\n")
  linhasLimpo.forEach((linha, i) => {
    PADRAO_ESCRITA.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PADRAO_ESCRITA.exec(linha)) != null) achados.push({ arquivo: rel, linha: i + 1, trecho: m[0], tipo: "orm" })
  })
  PADRAO_SQL.lastIndex = 0
  if (PADRAO_SQL.test(limpo)) achados.push({ arquivo: rel, linha: 0, trecho: "SQL cru sobre NecessidadeDocumental", tipo: "sql" })
  return achados
}

const ocorrencias = todos.flatMap(escritasEm)
const porArquivo = new Map<string, Ocorrencia[]>()
for (const o of ocorrencias) porArquivo.set(o.arquivo, [...(porArquivo.get(o.arquivo) ?? []), o])

// ── 1) RUNTIME: um dono, sem exceção ───────────────────────────────────────
secao("1) Runtime (src/, lib/) — dono ÚNICO")

const escritoresRuntime = [...porArquivo.keys()].filter((f) => arquivosRuntime.includes(f)).sort()
console.log(`  escritores em runtime: ${escritoresRuntime.join(", ") || "(nenhum)"}`)
ok("existe EXATAMENTE um escritor de runtime", escritoresRuntime.length === 1, escritoresRuntime.join(", "))
ok(`o escritor é ${DONO_RUNTIME}`, escritoresRuntime[0] === DONO_RUNTIME)

const invasores = escritoresRuntime.filter((f) => f !== DONO_RUNTIME)
for (const f of invasores) {
  for (const o of porArquivo.get(f) ?? []) {
    ok(`ESCRITA DIRETA PROIBIDA — ${f}:${o.linha} (${o.trecho})`, false,
      "chame o serviço canônico src/services/necessidade-documental.ts")
  }
}

// ── 2) Fora do runtime: só quem está na allowlist ──────────────────────────
secao("2) Scripts e backfills — allowlist nominal")

const escritoresFora = [...porArquivo.keys()].filter((f) => arquivosOutros.includes(f)).sort()
for (const f of escritoresFora) {
  const motivo = AUTORIZADOS_FORA_DO_RUNTIME[f]
  ok(`autorizado: ${f}`, !!motivo, motivo ?? "NÃO está na allowlist — justifique no guard ou use o serviço canônico")
}
// allowlist não pode acumular entradas mortas: quem saiu da lista tem de sair do código
// Entrada MORTA = o arquivo existe e deixou de escrever (a exceção virou depósito).
// Arquivo AUSENTE não é entrada morta: ele não autoriza nada enquanto não existir,
// e some sozinho do repositório. Reprovar por ausência quebraria o build de quem
// não tem o arquivo — que é justamente quem não precisa da exceção.
const mortas = Object.keys(AUTORIZADOS_FORA_DO_RUNTIME).filter(
  (f) => f !== "scripts/guard-necessidade-documental.test.ts" &&
         !escritoresFora.includes(f) &&
         existsSync(join(RAIZ, f)),
)
ok("a allowlist não tem entrada morta", mortas.length === 0, mortas.join(", ") || "—")

// ── 3) Nada de SQL cru contornando o ORM ───────────────────────────────────
secao("3) Sem desvio por SQL cru")

const sql = ocorrencias.filter((o) => o.tipo === "sql")
ok("nenhum INSERT/UPDATE/DELETE cru em NecessidadeDocumental", sql.length === 0,
  sql.map((o) => o.arquivo).join(", ") || "—")

// ── 4) Os motores legados continuam mortos ─────────────────────────────────
secao("4) Motores eliminados não voltaram")

const SIMBOLOS_MORTOS = [
  "garantirNecessidadesArvoreDoProcesso",
  "garantirNecessidadesDaMatriz",
  "reconcileDocsForPessoa",
  "reconcileAllForArvore",
  "DOCUMENT_RULES",
  "analyzePessoa",
]
const ressuscitados: string[] = []
for (const f of [...arquivosRuntime]) {
  const limpo = semComentarios(readFileSync(join(RAIZ, f), "utf8"))
  for (const s of SIMBOLOS_MORTOS) if (new RegExp(`\\b${s}\\b`).test(limpo)) ressuscitados.push(`${f}: ${s}`)
}
ok("nenhum símbolo de motor legado em runtime", ressuscitados.length === 0, ressuscitados.join(" | ") || "—")
ok("src/lib/document-generator.ts continua removido", !existsSync(join(RAIZ, "src/lib/document-generator.ts")))

// ── 5) O caminho oficial continua ligado ───────────────────────────────────
secao("5) O materializador oficial continua na cadeia")

const mat = semComentarios(readFileSync(join(RAIZ, "src/services/materializar-fase.ts"), "utf8"))
ok("materializarExecucaoDaFase chama materializarGenealogia", /await materializarGenealogia\(/.test(mat))
ok("a chamada vem antes de instanciar o workflow",
  mat.indexOf("materializarGenealogia(") < mat.indexOf("instanciarWorkflowDaFase("))

const gen = semComentarios(readFileSync(join(RAIZ, "src/services/genealogia/materializar-genealogia.ts"), "utf8"))
ok("o motor oficial só lê regra PUBLICADA e não arquivada", /status: "PUBLICADA", arquivado: false/.test(gen))

// ── Resultado ──────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(64)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhou > 0) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  console.log(`\nA regra: NecessidadeDocumental se escreve por ${DONO_RUNTIME}.`)
  console.log("Quem decide o que deve existir é materializarExecucaoDaFase → materializarGenealogia.")
  process.exit(1)
}
console.log(`Escrita em NecessidadeDocumental: um dono, ${Object.keys(AUTORIZADOS_FORA_DO_RUNTIME).length - 1} exceções nomeadas.\n`)
void relative
