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
import { vincularRequerente, vincularPessoaExistenteAoRequerente } from "@/lib/genealogia/vincular-requerente"

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
  pessoaSoltaIds?: number[]
}) {
  // Desamarra o principal para permitir excluir Pessoas sem violar FK.
  for (const id of ctx.arvoreIds) {
    await prisma.arvore.update({ where: { id }, data: { pessoaPrincipalId: null } }).catch(() => {})
  }
  // Pessoa "solta" (arvoreId null no início do cenário) pode ter sido adotada por
  // uma árvore durante o teste — o filtro por arvoreId abaixo já cobre, mas apaga
  // explícito por id também, pro caso de ela continuar solta se o teste falhar cedo.
  if (ctx.pessoaSoltaIds?.length) {
    await prisma.pessoa.deleteMany({ where: { id: { in: ctx.pessoaSoltaIds } } }).catch(() => {})
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
      data: { nome: MARK, arvoreId: arvore.id },
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

    // ── 4) vincularPessoaExistenteAoRequerente — a pessoa JÁ existe (ex.: árvore
    //      importada), quem opera escolhe a qual requerente ela corresponde ──────
    console.log("\n4) Vincular pessoa JÁ existente na árvore (fluxo: árvore importada)")
    const arvoreImportada = await prisma.arvore.create({ data: { nome: `${MARK} importada` } })
    ctx.arvoreIds.push(arvoreImportada.id)
    // Simula uma pessoa vinda da importação: já é nó da árvore, sem NENHUM vínculo
    // de requerente (requerente: "nao", o default).
    const pessoaImportada = await prisma.pessoa.create({
      data: { nome: "Maria", sobrenome: "Importada", arvoreId: arvoreImportada.id, requerente: "nao" },
    })
    const requerente2 = await prisma.requerente.create({
      data: { nome: "Maria Importada", observacoes: MARK, personId: null },
    })
    ctx.requerenteIds.push(requerente2.id)
    const processo2 = await prisma.processo.create({ data: { nome: MARK, arvoreId: arvoreImportada.id } })
    ctx.processoIds.push(processo2.id)
    await prisma.processoRequerente.create({ data: { processoId: processo2.id, requerenteId: requerente2.id } })

    const antesCount = await prisma.pessoa.count({ where: { arvoreId: arvoreImportada.id } })
    const r4 = await vincularPessoaExistenteAoRequerente({
      arvoreId: arvoreImportada.id, requerenteId: requerente2.id, pessoaId: pessoaImportada.id,
    })
    ok(r4.ok && r4.pessoaId === pessoaImportada.id, "vincula a MESMA pessoa (não cria outra)", r4)
    const depoisCount = await prisma.pessoa.count({ where: { arvoreId: arvoreImportada.id } })
    ok(depoisCount === antesCount, "nenhuma pessoa nova foi criada", { antesCount, depoisCount })

    const reqApos4 = await prisma.requerente.findUnique({ where: { id: requerente2.id } })
    ok(reqApos4?.personId === pessoaImportada.id, "Requerente.personId aponta pra pessoa existente", reqApos4?.personId)
    const pessoaApos4 = await prisma.pessoa.findUnique({ where: { id: pessoaImportada.id } })
    ok(
      ["sim", "maior"].includes(String(pessoaApos4?.requerente ?? "").toLowerCase()),
      "Pessoa.requerente foi setado (não fica 'nao')", pessoaApos4?.requerente,
    )

    console.log("\n4b) Idempotência: repetir o MESMO par não duplica nem falha")
    const r4b = await vincularPessoaExistenteAoRequerente({
      arvoreId: arvoreImportada.id, requerenteId: requerente2.id, pessoaId: pessoaImportada.id,
    })
    ok(r4b.ok && r4b.pessoaId === pessoaImportada.id, "repetir o mesmo vínculo continua ok", r4b)

    console.log("\n4c) Requerente já vinculado a OUTRA pessoa → recusa")
    const outraPessoa = await prisma.pessoa.create({
      data: { nome: "Outra", sobrenome: "Pessoa", arvoreId: arvoreImportada.id, requerente: "nao" },
    })
    const r4c = await vincularPessoaExistenteAoRequerente({
      arvoreId: arvoreImportada.id, requerenteId: requerente2.id, pessoaId: outraPessoa.id,
    })
    ok(!r4c.ok && r4c.code === "REQUERENTE_JA_VINCULADO", "recusa trocar a pessoa de um requerente já vinculado", r4c)

    console.log("\n4d) Pessoa já é requerente de OUTRO vínculo → recusa")
    const requerente3 = await prisma.requerente.create({ data: { nome: "Terceiro Req", observacoes: MARK, personId: null } })
    ctx.requerenteIds.push(requerente3.id)
    const r4d = await vincularPessoaExistenteAoRequerente({
      arvoreId: arvoreImportada.id, requerenteId: requerente3.id, pessoaId: pessoaImportada.id,
    })
    ok(!r4d.ok && r4d.code === "PESSOA_JA_E_REQUERENTE", "recusa vincular pessoa que já é requerente de outro", r4d)
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
