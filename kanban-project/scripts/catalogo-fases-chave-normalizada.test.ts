// scripts/catalogo-fases-chave-normalizada.test.ts
//
// MANDATO "MÓDULO DE FASES" — item 3 da matriz de blindagem: "Chave canônica
// normalizada e duplicidade case-insensitive." Prova o comportamento REAL
// já implementado em POST /api/gerenciamento/catalogo-fases (slug() +
// findFirst com mode:'insensitive') — nasceu do achado real "TESTEVIS_fase"
// (maiúsculas inconsistentes) descrito no próprio código da rota. Este
// arquivo fecha a lacuna: aquele comportamento nunca tinha um teste
// dedicado provando os dois lados — normalização e duplicidade — juntos.
//
// Fixture 100% genérica e sintética própria — nunca TESTEVIS_fase.
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("catalogo-fases-chave-normalizada.test.ts")

import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { POST } from "../src/app/api/gerenciamento/catalogo-fases/route"
import { NextRequest } from "next/server"

const MARCA = "CHAVENORM"
let ok = 0, falhou = 0
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; console.error(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function limpar() {
  // `mode:'insensitive'` de propósito: o passo 6 insere uma chave legada em
  // CAIXA MISTA direto no banco (fora do slug) — sem isto, a limpeza a
  // ignorava por diferença de caixa e a segunda execução do arquivo colidia
  // em unique(phaseKey) ao tentar recriá-la.
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: MARCA.toLowerCase(), mode: "insensitive" } } })
  await prisma.usuario.deleteMany({ where: { email: `admin@${MARCA.toLowerCase()}.test` } })
}

async function criar(body: Record<string, unknown>, token: string) {
  const res = await POST(new NextRequest("http://localhost/api/gerenciamento/catalogo-fases", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  }))
  const j = await res.json().catch(() => ({}))
  return { status: res.status, j }
}

async function main() {
  await limpar()
  const admin = await prisma.usuario.create({ data: { nome: MARCA, email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" } })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })

  console.log("\n1) Chave gerada a partir do label — normalizada (minúsculas, snake_case, sem acento)")
  const r1 = await criar({ label: `${MARCA} Fase Á — Emissão!!`, escopo: "PROCESSO" }, token)
  check("criação aceita", r1.status === 201, `status=${r1.status}`)
  const chaveGerada = r1.j.fase?.phaseKey as string
  check("chave só com minúsculas/dígitos/underscore, sem acento nem pontuação", /^[a-z0-9_]+$/.test(chaveGerada ?? ""), chaveGerada)
  check("chave reflete o label normalizado", chaveGerada === `${MARCA.toLowerCase()}_fase_a_emissao`, chaveGerada)

  console.log("\n2) MESMO label de novo — mesma chave normalizada, 409 (duplicidade exata)")
  const r2 = await criar({ label: `${MARCA} Fase Á — Emissão!!`, escopo: "PROCESSO" }, token)
  check("recusado 409", r2.status === 409, `status=${r2.status}`)
  check("mensagem cita a chave já existente", typeof r2.j.error === "string" && r2.j.error.includes(chaveGerada), r2.j.error)

  console.log("\n3) Label DIFERENTE mas que normaliza para a MESMA chave — ainda 409 (duplicidade por normalização)")
  const r3 = await criar({ label: `  ${MARCA}   FASE   á   EMISSÃO  ` }, token)
  check("recusado 409 mesmo com label escrito diferente", r3.status === 409, `status=${r3.status}`)

  console.log("\n4) phaseKey EXPLÍCITO só variando CAIXA da chave já existente — 409 case-insensitive")
  const r4 = await criar({ label: `${MARCA} Outro Nome Qualquer`, phaseKey: chaveGerada.toUpperCase(), escopo: "PROCESSO" }, token)
  check("recusado 409 (case-insensitive, mesmo com label e phaseKey explícito diferentes)", r4.status === 409, `status=${r4.status}`)
  const totalComEssaChave = await prisma.catalogoFase.count({ where: { phaseKey: { equals: chaveGerada, mode: "insensitive" } } })
  check("nenhuma segunda linha foi criada no banco (duplicidade de verdade barrada, não só na resposta)", totalComEssaChave === 1, `total=${totalComEssaChave}`)

  console.log("\n5) phaseKey explícito MISTO em caixa (nunca existiu) — normalizado para minúsculas na criação")
  const r5 = await criar({ label: `${MARCA} Fase Mista`, phaseKey: `${MARCA}_FaseMista_Nova`, escopo: "PROCESSO" }, token)
  check("criação aceita", r5.status === 201, `status=${r5.status}`)
  check("phaseKey persistido em minúsculas (nunca preserva a caixa enviada)", r5.j.fase?.phaseKey === `${MARCA.toLowerCase()}_fasemista_nova`, r5.j.fase?.phaseKey)

  console.log("\n6) Chave LEGADA em caixa mista já no banco (simula TESTEVIS_fase) — nova chave que normaliza pro mesmo valor é barrada")
  // `slug()` SEMPRE devolve minúsculas — então o `findFirst(mode:'insensitive')`
  // da rota só faz diferença de verdade contra uma linha LEGADA que nasceu
  // ANTES desta normalização existir (o próprio motivo do código, citado no
  // comentário da rota). Simula isso inserindo direto no banco, sem passar
  // pelo slug — exatamente como a fase real "TESTEVIS_fase" existe hoje.
  const chaveLegadaMista = `${MARCA}_LegadaMista`
  await prisma.catalogoFase.create({
    data: { phaseKey: chaveLegadaMista, label: `${MARCA} Legada`, escopo: "PROCESSO", ordemPadrao: 0, requiredPadrao: true, conditionalPadrao: false, ativo: false, status: "RASCUNHO", revisaoAtual: 1, efeitosPermitidos: [] },
  })
  const rLegada = await criar({ label: `${MARCA} Legada Mista Nova`, phaseKey: chaveLegadaMista.toLowerCase(), escopo: "PROCESSO" }, token)
  check("recusado 409 — nova chave minúscula colide com a legada em caixa mista", rLegada.status === 409, `status=${rLegada.status}`)
  const totalLegada = await prisma.catalogoFase.count({ where: { phaseKey: { equals: chaveLegadaMista, mode: "insensitive" } } })
  check("continua existindo só UMA linha (a legada original, intocada)", totalLegada === 1, `total=${totalLegada}`)

  console.log("\n7) Chave genuinamente DIFERENTE — aceita normalmente, sem colisão nenhuma")
  const r6 = await criar({ label: `${MARCA} Fase Completamente Distinta`, escopo: "PROCESSO" }, token)
  check("criação aceita (não é uma duplicidade disfarçada)", r6.status === 201, `status=${r6.status}`)
  check("chave distinta da primeira", r6.j.fase?.phaseKey !== chaveGerada, r6.j.fase?.phaseKey)

  await limpar()
  console.log(`\n=== RESULTADO: ${ok} ok, ${falhou} falhas ===`)
  if (falhou > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
