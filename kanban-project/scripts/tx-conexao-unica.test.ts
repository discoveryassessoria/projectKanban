/**
 * GUARDA — uma transação NUNCA pede uma conexão a mais.
 * Rodar: npm run test:tx-conexao
 *
 * DEFEITO QUE ISTO TRAVA (produção, 31/07): "Erro ao criar processo" (HTTP 500 após
 * 20 s) e, por tabela, a Central Operacional presa no spinner.
 *
 * O runtime mantém um pool PEQUENO e explícito por instância (lib/prisma.ts) — em
 * serverless o total de conexões é governado pelo número de instâncias, não pelo
 * tamanho do pool de cada uma. Daí um invariante duro:
 *
 *     enquanto uma transação interativa estiver aberta, nenhum código dentro dela
 *     pode falar com o banco pelo cliente GLOBAL — a conexão extra pode não existir.
 *
 * `instanciarWorkflowDaFase` chamava `resolverWorkflowAplicavel`, que lia pelo cliente
 * global. Dentro da transação de criação (e da de avanço de fase) isso virava
 * auto-deadlock: a transação segurava a conexão, a leitura esperava o `pool_timeout`
 * inteiro e a transação estourava. Pior: durante essa espera a conexão ficava retida,
 * e toda outra requisição da mesma instância — inclusive
 * `/api/processos/[id]/central-operacional` — ia para a fila. Medido com o pool no
 * valor de então (1): a Central passou de 0,6 s para 19 s (uma criação concorrente) e
 * para 39 s + HTTP 500 (três criações concorrentes).
 *
 * Aumentar o pool alivia, não cura: N transações simultâneas pedindo uma conexão extra
 * cada esgotam qualquer N. A cura é a transação se bastar na própria conexão.
 *
 * Ler pela MESMA transação também é o correto por consistência: é a única forma de
 * enxergar o que a própria transação acabou de escrever.
 *
 * Este arquivo é ESTÁTICO (não precisa de banco). A prova dinâmica contra banco real
 * está em `npm run test:tx-conexao:integracao`.
 */
export {}

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const RAIZ = process.cwd()
let passou = 0
let falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, detalhe?: unknown) => {
  if (cond) { passou++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${detalhe !== undefined ? ` → ${JSON.stringify(detalhe)}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const src = (p: string) => readFileSync(join(RAIZ, p), "utf8")

/** Remove comentários de linha/bloco — evita acusar prosa como se fosse código. */
function semComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function arquivosTs(dir: string): string[] {
  const out: string[] = []
  const andar = (d: string) => {
    let itens: string[]
    try { itens = readdirSync(d) } catch { return }
    for (const item of itens) {
      const p = join(d, item)
      if (statSync(p).isDirectory()) {
        if (item === "node_modules" || item === ".next" || item === "_tmp") continue
        andar(p)
      } else if (/\.tsx?$/.test(item)) out.push(relative(RAIZ, p))
    }
  }
  andar(join(RAIZ, dir))
  return out
}

/** Corpos de `$transaction(async (tx) => { ... })`, com chaves balanceadas. */
function corposDeTransacao(codigo: string): Array<{ linha: number; corpo: string }> {
  const out: Array<{ linha: number; corpo: string }> = []
  const re = /\$transaction\(\s*(?:async\s*)?\(?\s*\w+\s*\)?\s*=>\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(codigo))) {
    const inicio = codigo.indexOf("{", m.index + m[0].length - 1)
    let nivel = 0
    let fim = -1
    for (let j = inicio; j < codigo.length; j++) {
      if (codigo[j] === "{") nivel++
      else if (codigo[j] === "}") { nivel--; if (nivel === 0) { fim = j; break } }
    }
    if (fim < 0) continue
    out.push({ linha: codigo.slice(0, m.index).split("\n").length, corpo: codigo.slice(inicio, fim) })
  }
  return out
}

console.log("\nUma transação nunca pede uma conexão a mais\n")

// ── 1) O invariante existe porque o pool é PEQUENO ───────────────────────────
secao("1) Por que o invariante é obrigatório")
{
  const prismaTs = src("lib/prisma.ts")
  const limite = Number(/connection_limit=(\d+)/.exec(prismaTs)?.[1] ?? NaN)
  ok("o pool por instância é pequeno e explícito", Number.isFinite(limite) && limite <= 10, limite)
  ok("com espera pela vez (pool_timeout), não falha imediata", /pool_timeout=\d+/.test(prismaTs))
  // Aumentar o pool alivia, não cura: N transações simultâneas que peçam uma
  // conexão extra cada esgotam qualquer N. O invariante abaixo é o que cura.
  ok("e o pool é pequeno o bastante para o invariante importar", Number.isFinite(limite) && limite < 50, limite)
}

// ── 2) Ninguém usa o cliente GLOBAL dentro do corpo de uma transação ─────────
secao("2) Nenhum uso do cliente global dentro de transação")
{
  const suspeitos: string[] = []
  for (const f of [...arquivosTs("src"), ...arquivosTs("lib")]) {
    if (f.endsWith("tx-conexao-unica.test.ts")) continue
    for (const { linha, corpo } of corposDeTransacao(semComentarios(src(f)))) {
      const usos = [...corpo.matchAll(/(?<![.\w])prisma\.\w+/g)].map((x) => x[0])
      if (usos.length) suspeitos.push(`${f}:${linha} → ${[...new Set(usos)].join(", ")}`)
    }
  }
  ok("nenhum `prisma.` no corpo de um $transaction", suspeitos.length === 0, suspeitos)
}

// ── 3) Quem compõe dentro de transação RECEBE o cliente ──────────────────────
secao("3) Os serviços que compõem dentro de transação threadam o cliente")
{
  const pw = src("src/services/phase-workflow.ts")
  const resolver = pw.slice(pw.indexOf("export async function resolverWorkflowAplicavel"), pw.indexOf("export async function instanciarWorkflowDaFase"))

  ok("resolverWorkflowAplicavel recebe o cliente do chamador", /db:\s*Prisma\.TransactionClient\s*\|\s*typeof prisma\s*=\s*prisma/.test(resolver))
  ok("e lê SÓ por esse cliente (nenhum `prisma.` solto)", !/(?<![.\w])prisma\.\w+/.test(semComentarios(resolver)))
  ok("as três leituras passaram para `db`", (semComentarios(resolver).match(/\bdb\.phaseInternal/g) ?? []).length === 3)
  ok("instanciarWorkflowDaFase repassa o seu `db`", /resolverWorkflowAplicavel\(processo\.tipoProcessoMotorId,\s*input\.faseMacroKey,\s*db\)/.test(pw))
  ok("e `db` é a tx externa quando existe", /const db = txExterno \?\? prisma/.test(pw))
  ok("a razão está escrita no código", /connection_limit/.test(pw) && /pool_timeout/.test(pw))

  const pt = src("src/services/passo-tarefa.ts")
  ok("garantirTarefaDePasso já lia pela tx externa (segue assim)", /const db = txExterno \?\? prisma/.test(pt))
}

// ── 4) Os dois caminhos que quebraram em produção continuam cobertos ─────────
secao("4) Criação e avanço de fase compõem na MESMA transação")
{
  const criar = src("src/services/criar-processo.ts")
  ok("criar processo instancia o Workflow Interno com a tx", /instanciarWorkflowDaFase\([\s\S]{0,600}?\n\s*tx,\n\s*\)/.test(criar))
  ok("criar processo gera o código público com a tx", /gerarCodigoPublico\(tx,/.test(criar))
  ok("criar processo gera as tarefas iniciais com a tx", /garantirTarefaDePasso\([\s\S]{0,400}?\n\s*tx,\n\s*\)/.test(criar))

  const advance = src("src/lib/motor/phase-advance.ts")
  ok("avanço de fase instancia o Workflow Interno com a tx", /instanciarWorkflowDaFase\([\s\S]{0,600}?tx,/.test(advance))
}

console.log(`\n${"=".repeat(60)}`)
console.log(`Transação x conexão: ${passou} passou, ${falhou} falhou`)
if (falhou > 0) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
console.log("✅ Pool pequeno por instância — e nenhuma transação pedindo uma conexão a mais.\n")
