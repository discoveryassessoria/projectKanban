/**
 * INTEGRAÇÃO — o invariante "uma transação nunca pede uma segunda conexão", provado
 * contra um banco REAL com o pool de produção (connection_limit=1).
 *
 * Rodar (banco LOCAL de teste — nunca produção):
 *   dotenv -e .env.test -- npx tsx scripts/tx-conexao-unica-integracao.test.ts
 *   ou:  PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:5432/kanban_test" \
 *        npx tsx scripts/tx-conexao-unica-integracao.test.ts
 *
 * SÓ LEITURA: abre uma transação e faz consultas. Não cria, não altera, não apaga.
 *
 * O que prova:
 *   POSITIVO — dentro de uma transação, `resolverWorkflowAplicavel(..., tx)` responde
 *              de imediato. É o caminho que a criação de processo e o avanço de fase
 *              usam.
 *   NEGATIVO — dentro da MESMA transação, uma leitura pelo cliente GLOBAL fica esperando
 *              uma conexão que não vem e estoura no primeiro limite que vencer (o da
 *              transação ou o do pool). É o defeito que derrubou "criar processo" em
 *              produção e reteve a única conexão da instância, deixando a Central
 *              Operacional na fila. Roda com POOL_NEGATIVO=1 (leva alguns segundos).
 *
 * TRAVA DE SEGURANÇA: recusa qualquer URL que não seja de host local.
 */
export {}

import { PrismaClient } from "@prisma/client"
import { resolverWorkflowAplicavel } from "@/src/services/phase-workflow"

const URL_BRUTA = process.env.PRISMA_DATABASE_URL ?? ""
const LOCAIS = new Set(["localhost", "127.0.0.1", "::1"])
const host = (() => { try { return new URL(URL_BRUTA.replace(/^postgres(ql)?:/, "http:")).hostname } catch { return "" } })()
if (!URL_BRUTA || !LOCAIS.has(host)) {
  console.error(`\n❌ Este teste só roda contra banco LOCAL. PRISMA_DATABASE_URL aponta para "${host || "(vazio)"}".\n`)
  process.exit(1)
}

// MESMO pool do runtime de produção: uma conexão por instância, espera de 20 s.
const separador = URL_BRUTA.includes("?") ? "&" : "?"
const url = /connection_limit=/.test(URL_BRUTA) ? URL_BRUTA : `${URL_BRUTA}${separador}connection_limit=1&pool_timeout=20`
const prisma = new PrismaClient({ datasources: { db: { url } } })

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, detalhe?: unknown) => {
  if (cond) { passou++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${detalhe !== undefined ? ` → ${JSON.stringify(detalhe)}` : ""}`) }
}

async function main() {
  console.log("\nInvariante da conexão única — contra banco real\n")
  console.log(`  banco: ${host} · connection_limit=1 · pool_timeout=20\n`)

  // ── POSITIVO ──────────────────────────────────────────────────────────────
  console.log("1) Resolver o Workflow Interno DENTRO da transação")
  const t0 = Date.now()
  const r = await prisma.$transaction(async (tx) => {
    // O cast espelha o que instanciarWorkflowDaFase faz: `db = txExterno ?? prisma`.
    return await resolverWorkflowAplicavel(null, "genealogia", tx)
  })
  const ms = Date.now() - t0
  ok("a transação completou (não estourou)", r !== undefined)
  ok(`respondeu de imediato (${ms} ms < 5000)`, ms < 5000, ms)
  ok("devolveu resolução ou 'não encontrado', nunca erro de conexão", "erro" in r ? r.erro === "WORKFLOW_NAO_ENCONTRADO" : true, r)

  // ── NEGATIVO (opcional: ~20 s) ────────────────────────────────────────────
  if (process.env.POOL_NEGATIVO === "1") {
    console.log("\n2) Controle negativo — cliente GLOBAL dentro da transação")
    const t1 = Date.now()
    let estourou = false
    try {
      await prisma.$transaction(async () => {
        // De propósito: NÃO usa a tx. É o defeito original.
        await prisma.phaseInternalWorkflow.findFirst({ where: { phaseKey: "genealogia" } })
      })
    } catch { estourou = true }
    const ms1 = Date.now() - t1
    ok("a leitura pelo cliente global dentro da tx FALHA", estourou)
    // Não falha na hora: fica ESPERANDO uma conexão que não vem, até o primeiro
    // limite que vencer (o da transação ou o do pool). É essa espera que retém a
    // única conexão da instância e põe todas as outras requisições na fila.
    ok(`e só falha depois de esperar de verdade (${ms1} ms ≥ 2000)`, ms1 >= 2_000, ms1)
  } else {
    console.log("\n2) Controle negativo — pulado (POOL_NEGATIVO=1 para rodar; leva alguns segundos)")
  }

  console.log(`\n${"=".repeat(60)}`)
  console.log(`Integração conexão única: ${passou} passou, ${falhou} falhou`)
  if (falhou > 0) { console.log("\nFalhas:"); for (const f of falhas) console.log(`  · ${f}`); process.exitCode = 1 }
  else console.log("✅ A transação se basta na própria conexão.\n")
}

main()
  .catch((e) => { console.error("\n❌ erro inesperado:", e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
