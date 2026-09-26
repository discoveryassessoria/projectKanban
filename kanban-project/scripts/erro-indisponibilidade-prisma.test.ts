// scripts/erro-indisponibilidade-prisma.test.ts
// ============================================================================
// TESTE UNITÁRIO PURO (sem banco) — `respostaSeIndisponibilidade`/
// `codigoPrismaDoErro`, Etapa 2 (fechamento, 26/09/2026), item 2.
//
// Simula os erros Prisma que a contenção/timeout de pool realmente produz
// (diagnóstico da Etapa 1: ~3,1s por chamada em minhaFila→visaoGerencial) —
// nunca contra o banco de verdade, só instanciando as classes de erro.
// Rodar: npx tsx scripts/erro-indisponibilidade-prisma.test.ts
// ============================================================================
import { Prisma } from "@prisma/client"
import { codigoPrismaDoErro, respostaSeIndisponibilidade } from "@/lib/operacional/erro-indisponibilidade-prisma"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function corpoDaResposta(r: ReturnType<typeof respostaSeIndisponibilidade>) {
  if (!r) return null
  return r.json() as Promise<{ erro: string; retryAfterMs: number }>
}

async function main() {
  console.log("ERRO DE INDISPONIBILIDADE PRISMA → 503 DIAGNOSTICÁVEL\n")

  secao("1) P2024 (pool de conexões esgotado) — o erro real do diagnóstico da Etapa 1")
  const p2024 = new Prisma.PrismaClientKnownRequestError("Timed out fetching a new connection from the pool.", {
    code: "P2024", clientVersion: "6.0.0",
  })
  ok("1.1) codigoPrismaDoErro reconhece P2024", codigoPrismaDoErro(p2024) === "P2024")
  const resp1 = respostaSeIndisponibilidade(p2024)
  ok("1.2) responde 503 (não deixa virar 500 genérico)", resp1?.status === 503)
  const corpo1 = await corpoDaResposta(resp1)
  ok("1.3) corpo tem erro='indisponivel' e retryAfterMs=1500", corpo1?.erro === "indisponivel" && corpo1?.retryAfterMs === 1500, JSON.stringify(corpo1))

  secao("2) P1001/P1008/P1017 (conexão inalcançável/timeout/encerrada) — PrismaClientInitializationError")
  for (const codigo of ["P1001", "P1008", "P1017"] as const) {
    const e = new Prisma.PrismaClientInitializationError(`erro de conexão ${codigo}`, "6.0.0", codigo)
    ok(`2.${codigo}) codigoPrismaDoErro reconhece ${codigo}`, codigoPrismaDoErro(e) === codigo)
    const resp = respostaSeIndisponibilidade(e)
    ok(`2.${codigo}) responde 503`, resp?.status === 503)
  }

  secao("3) NEGATIVOS — erro Prisma de outra classe, e erro comum, NÃO viram 503")
  const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6.0.0" })
  ok("3.1) P2002 (erro de negócio real) NÃO é tratado como indisponibilidade", respostaSeIndisponibilidade(p2002) === null)
  ok("3.2) Error comum NÃO é tratado como indisponibilidade", respostaSeIndisponibilidade(new Error("bug qualquer")) === null)
  ok("3.3) codigoPrismaDoErro devolve null para erro não-Prisma", codigoPrismaDoErro(new Error("bug qualquer")) === null)

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) })
