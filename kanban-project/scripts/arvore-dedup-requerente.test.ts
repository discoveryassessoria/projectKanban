// scripts/arvore-dedup-requerente.test.ts
// ============================================================================
// GUARDA do INVARIANTE de DEDUP: a Árvore nunca cria uma 2ª Pessoa para um
// Requerente que já tem `personId`. Exercita a lógica de vínculo (service puro,
// sem HTTP) duas vezes e prova que:
//   - a 1ª chamada cria UMA Pessoa e grava Requerente.personId;
//   - a 2ª chamada REUSA a MESMA Pessoa (não cria uma segunda);
//   - uma Pessoa já vinculada a OUTRA árvore não é movida à força (409 lógico).
//
// Integração real contra o banco de TESTE (kanban_test). Cria dados marcados e os
// REMOVE ao fim. Rodar:
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5432/kanban_test \
//   PRISMA_DATABASE_URL=$DATABASE_URL DIRECT_DATABASE_URL=$DATABASE_URL \
//   FINANCEIRO_V3_POSICAO_READ=1 npx tsx scripts/arvore-dedup-requerente.test.ts
// ============================================================================

import { prisma } from "@/lib/prisma"
import { vincularRequerente } from "@/lib/genealogia/vincular-requerente"

const MARK = "__TEST_DEDUP_REQ__"

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (cond) {
    passed++
    console.log(`  ✅ ${nome}`)
  } else {
    failed++
    falhas.push(nome)
    console.log(`  ❌ ${nome}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`)
  }
}

async function limpar(ctx: {
  arvoreIds: number[]
  processoIds: number[]
  requerenteIds: number[]
}) {
  // Desamarra o principal para permitir excluir Pessoas sem violar FK.
  for (const id of ctx.arvoreIds) {
    await prisma.arvore.update({ where: { id }, data: { pessoaPrincipalId: null } }).catch(() => {})
  }
  await prisma.processoRequerente
    .deleteMany({ where: { processoId: { in: ctx.processoIds.length ? ctx.processoIds : [-1] } } })
    .catch(() => {})
  await prisma.processo
    .deleteMany({ where: { id: { in: ctx.processoIds.length ? ctx.processoIds : [-1] } } })
    .catch(() => {})
  // Pessoa.arvoreId → SetNull não é o caso (Cascade); apaga as pessoas da árvore.
  await prisma.pessoa
    .deleteMany({ where: { arvoreId: { in: ctx.arvoreIds.length ? ctx.arvoreIds : [-1] } } })
    .catch(() => {})
  await prisma.requerente
    .deleteMany({ where: { id: { in: ctx.requerenteIds.length ? ctx.requerenteIds : [-1] } } })
    .catch(() => {})
  await prisma.arvore
    .deleteMany({ where: { id: { in: ctx.arvoreIds.length ? ctx.arvoreIds : [-1] } } })
    .catch(() => {})
}

async function main() {
  console.log("\nÁrvore — dedup de requerente (invariante: 1 Pessoa por requerente)\n")

  const ctx = { arvoreIds: [] as number[], processoIds: [] as number[], requerenteIds: [] as number[] }

  try {
    // ── Setup ────────────────────────────────────────────────────────────────
    const arvore = await prisma.arvore.create({ data: { nome: MARK } })
    ctx.arvoreIds.push(arvore.id)

    const requerente = await prisma.requerente.create({
      data: {
        // nome-mestre limpo: o vínculo deriva nome/sobrenome dele (1ª palavra = nome).
        nome: "João Silva",
        observacoes: MARK,
        sexo: "Masculino",
        nacionalidade: "Brasileira",
        dataNascimento: new Date("1990-01-01"),
        personId: null,
      },
    })
    ctx.requerenteIds.push(requerente.id)

    const processo = await prisma.processo.create({
      data: { nome: MARK, pais: "alemanha", arvoreId: arvore.id },
    })
    ctx.processoIds.push(processo.id)
    await prisma.processoRequerente.create({
      data: { processoId: processo.id, requerenteId: requerente.id },
    })

    // ── 1ª chamada: cria UMA Pessoa e vincula ────────────────────────────────
    console.log("1) Primeira vinculação (deve CRIAR)")
    const r1 = await vincularRequerente({ arvoreId: arvore.id, requerenteId: requerente.id })
    ok(r1.ok, "vínculo bem-sucedido", r1)
    ok(r1.ok && r1.criada === true, "1ª chamada CRIA a Pessoa (criada=true)")

    const pessoaId1 = r1.ok ? r1.pessoaId : -1
    const reqApos1 = await prisma.requerente.findUnique({ where: { id: requerente.id } })
    ok(reqApos1?.personId === pessoaId1, "Requerente.personId gravado com a Pessoa criada", reqApos1?.personId)

    const pessoa1 = await prisma.pessoa.findUnique({ where: { id: pessoaId1 } })
    ok(pessoa1?.arvoreId === arvore.id, "Pessoa pertence a esta árvore")
    ok(pessoa1?.requerente === "maior", "Auto-principal: 1º requerente vira 'maior'", pessoa1?.requerente)
    ok(pessoa1?.nome === "João" && pessoa1?.sobrenome === "Silva", "nome/sobrenome derivados do Requerente", {
      nome: pessoa1?.nome,
      sobrenome: pessoa1?.sobrenome,
    })

    const count1 = await prisma.pessoa.count({ where: { arvoreId: arvore.id } })
    ok(count1 === 1, "exatamente 1 Pessoa na árvore após 1ª chamada", count1)

    // ── 2ª chamada: REUSA, não cria segunda Pessoa ───────────────────────────
    console.log("\n2) Segunda vinculação (deve REUSAR — invariante)")
    const r2 = await vincularRequerente({ arvoreId: arvore.id, requerenteId: requerente.id })
    ok(r2.ok && r2.criada === false, "2ª chamada NÃO cria (criada=false)", r2)
    ok(r2.ok && r2.pessoaId === pessoaId1, "2ª chamada retorna a MESMA Pessoa", r2)

    const count2 = await prisma.pessoa.count({ where: { arvoreId: arvore.id } })
    ok(count2 === 1, "AINDA exatamente 1 Pessoa na árvore após 2ª chamada", count2)

    const reqApos2 = await prisma.requerente.findUnique({ where: { id: requerente.id } })
    ok(reqApos2?.personId === pessoaId1, "personId inalterado após reuso", reqApos2?.personId)

    // ── Guarda: Pessoa já em OUTRA árvore não é movida ───────────────────────
    console.log("\n3) Requerente já vinculado a Pessoa de OUTRA árvore → 409 lógico")
    const arvore2 = await prisma.arvore.create({ data: { nome: `${MARK} 2` } })
    ctx.arvoreIds.push(arvore2.id)
    const r3 = await vincularRequerente({ arvoreId: arvore2.id, requerenteId: requerente.id })
    ok(!r3.ok && r3.code === "PESSOA_EM_OUTRA_ARVORE", "não move Pessoa entre árvores (PESSOA_EM_OUTRA_ARVORE)", r3)
    const countOutra = await prisma.pessoa.count({ where: { arvoreId: arvore2.id } })
    ok(countOutra === 0, "nenhuma Pessoa criada na 2ª árvore", countOutra)
  } finally {
    await limpar(ctx)
  }

  console.log(`\nResultado: ${passed} passaram, ${failed} falharam`)
  if (failed > 0) {
    console.log("Falhas:", falhas.join(" | "))
    process.exit(1)
  }
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
