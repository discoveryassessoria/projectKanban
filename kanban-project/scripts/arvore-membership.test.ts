// scripts/arvore-membership.test.ts
// ============================================================================
// REQUERENTE DO PROCESSO ≠ MEMBRO DA ÁRVORE.
//
// São dois vínculos independentes, e confundi-los tem uma consequência concreta:
// o requerente some da lista de disponíveis e fica impossível de colocar na
// árvore, sem nenhuma mensagem dizendo por quê.
//
// O predicado antigo perguntava só `Pessoa.arvoreId === arvore do processo`. Isso
// erra num caso real: a remoção de pessoa é SOFT (`removidaEm`), porque fato
// histórico protegido precisa continuar apontando para alguém. Quem fosse
// removido da árvore continuava contando como membro — para sempre.
//
// Este arquivo prova o predicado corrigido nos quatro estados que importam:
// fora da árvore, dentro, removido, e reinserido.
//
// TRAVA DE SEGURANÇA: recusa rodar fora de `kanban_test`. Este teste ESCREVE.
//
// Rodar:
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5432/kanban_test \
//   PRISMA_DATABASE_URL=$DATABASE_URL DIRECT_DATABASE_URL=$DATABASE_URL \
//   npx tsx scripts/arvore-membership.test.ts
// ============================================================================

import { prisma } from "@/lib/prisma"
import { vincularRequerente } from "@/lib/genealogia/vincular-requerente"

const MARCA = "__TEST_MEMBERSHIP__"

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

async function exigirBancoDeTeste() {
  const [{ db }] = await prisma.$queryRaw<Array<{ db: string }>>`select current_database() as db`
  if (db !== "kanban_test") {
    console.error(`\n⛔ ABORTADO: conectado a "${db}". Este teste ESCREVE.\n`)
    process.exit(2)
  }
  console.log(`  banco: ${db} ✓\n`)
}

/**
 * O PREDICADO EM TESTE — a mesma regra que a rota
 * `/api/processos/:id/requerentes-disponiveis` aplica.
 *
 * Reproduzido aqui em vez de chamado por HTTP porque o que se quer provar é a
 * REGRA, não o transporte: subir servidor para testar um predicado esconderia
 * a falha atrás de auth, rota e serialização.
 */
async function disponiveisParaArvore(processoId: number) {
  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { arvoreId: true },
  })
  const vinculos = await prisma.processoRequerente.findMany({
    where: { processoId, removidoEm: null },
    include: { requerente: { include: { pessoa: true } } },
  })
  return vinculos.map(({ requerente }) => {
    const p = requerente.pessoa
    const membroAtivo =
      processo?.arvoreId != null && p?.arvoreId === processo.arvoreId && p?.removidaEm == null
    return {
      requerenteId: requerente.id,
      nome: requerente.nome,
      personId: requerente.personId,
      alreadyInTree: membroAtivo,
      availableForTree: !membroAtivo,
    }
  })
}

interface Cenario {
  processoId: number
  arvoreId: number
  requerenteIds: number[]
}

async function semear(quantos: number): Promise<Cenario> {
  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} arvore` } })
  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} processo`, arvoreId: arvore.id,},
  })
  const requerenteIds: number[] = []
  for (let i = 0; i < quantos; i++) {
    const r = await prisma.requerente.create({
      data: { nome: `${MARCA} Req${String.fromCharCode(65 + i)}`, sexo: i % 2 ? "Feminino" : "Masculino" },
    })
    await prisma.processoRequerente.create({ data: { processoId: processo.id, requerenteId: r.id } })
    requerenteIds.push(r.id)
  }
  return { processoId: processo.id, arvoreId: arvore.id, requerenteIds }
}

async function limpar(c: Cenario | null) {
  if (!c) return
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: c.processoId } }).catch(() => {})
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: c.processoId } }).catch(() => {})
  await prisma.tarefa.deleteMany({ where: { processoId: c.processoId } }).catch(() => {})
  await prisma.processoRequerente.deleteMany({ where: { processoId: c.processoId } }).catch(() => {})
  await prisma.arvore.update({ where: { id: c.arvoreId }, data: { pessoaPrincipalId: null } }).catch(() => {})
  await prisma.processo.delete({ where: { id: c.processoId } }).catch(() => {})
  await prisma.pessoa.deleteMany({ where: { arvoreId: c.arvoreId } }).catch(() => {})
  await prisma.requerente.deleteMany({ where: { id: { in: c.requerenteIds } } }).catch(() => {})
  await prisma.arvore.delete({ where: { id: c.arvoreId } }).catch(() => {})
}

async function main() {
  console.log("\n══ MEMBERSHIP: requerente do processo ≠ membro da árvore ══\n")
  await exigirBancoDeTeste()

  let c: Cenario | null = null
  let c10: Cenario | null = null
  try {
    // ── §16: 4 requerentes, só A na árvore ────────────────────────────────
    console.log("1) quatro requerentes, apenas A na árvore")
    c = await semear(4)
    const [A, B, C, D] = c.requerenteIds

    let lista = await disponiveisParaArvore(c.processoId)
    ok(lista.length === 4, "os 4 requerentes do processo aparecem", lista.length)
    ok(lista.every((r) => r.availableForTree), "nenhum está na árvore ainda")

    await vincularRequerente({ arvoreId: c.arvoreId, requerenteId: A })
    lista = await disponiveisParaArvore(c.processoId)
    const disp = lista.filter((r) => r.availableForTree).map((r) => r.requerenteId)
    ok(disp.length === 3, "sobram 3 disponíveis", disp.length)
    ok(!disp.includes(A), "A saiu da lista (está na árvore)")
    ok(disp.includes(B) && disp.includes(C) && disp.includes(D), "B, C e D continuam disponíveis")
    ok(
      lista.find((r) => r.requerenteId === A)!.alreadyInTree,
      "A é marcado como já na árvore",
    )

    // ── §17: todos na árvore ──────────────────────────────────────────────
    console.log("\n2) todos na árvore")
    for (const id of [B, C, D]) await vincularRequerente({ arvoreId: c.arvoreId, requerenteId: id })
    lista = await disponiveisParaArvore(c.processoId)
    ok(lista.filter((r) => r.availableForTree).length === 0, "nenhum disponível")
    ok(lista.every((r) => r.alreadyInTree), "todos marcados como na árvore")
    console.log("     (só AQUI a mensagem 'todos já estão na árvore' é verdadeira)")

    // ── §18: removido volta a ficar disponível ────────────────────────────
    console.log("\n3) removido volta a ficar disponível")
    const pessoaB = (await prisma.requerente.findUnique({ where: { id: B }, select: { personId: true } }))!.personId!
    // Remoção SOFT — é assim que o domínio remove pessoa com histórico.
    await prisma.pessoa.update({ where: { id: pessoaB }, data: { removidaEm: new Date() } })
    lista = await disponiveisParaArvore(c.processoId)
    ok(
      lista.find((r) => r.requerenteId === B)!.availableForTree,
      "B, removido da árvore, volta a ficar DISPONÍVEL",
    )
    ok(
      lista.filter((r) => r.availableForTree).length === 1,
      "e é o único disponível — os outros três continuam membros",
    )
    // Este é o defeito que o predicado antigo tinha: `arvoreId` sozinho.
    const predicadoAntigo = (
      await prisma.pessoa.findUnique({ where: { id: pessoaB }, select: { arvoreId: true } })
    )!.arvoreId === c.arvoreId
    ok(predicadoAntigo, "o predicado ANTIGO ainda diria 'está na árvore' (era o bug)")

    // ── §19: reinserção NÃO duplica pessoa nem requerente ─────────────────
    console.log("\n4) reinserção não duplica")
    const antesPessoas = await prisma.pessoa.count()
    const antesReq = await prisma.requerente.count()
    await prisma.pessoa.update({ where: { id: pessoaB }, data: { removidaEm: null } })
    const r2 = await vincularRequerente({ arvoreId: c.arvoreId, requerenteId: B })
    ok(r2.ok, "reinserção pelo serviço canônico funciona")
    ok((await prisma.pessoa.count()) === antesPessoas, "nenhuma Pessoa criada")
    ok((await prisma.requerente.count()) === antesReq, "nenhum Requerente criado")
    lista = await disponiveisParaArvore(c.processoId)
    ok(lista.filter((r) => r.availableForTree).length === 0, "e B volta a ser membro")

    // ── §20: tortura com 10 requerentes ───────────────────────────────────
    console.log("\n5) tortura — 10 requerentes, um a um")
    c10 = await semear(10)
    const pessoasAntes = await prisma.pessoa.count()
    let esperado = 10
    let tudoCerto = true
    for (const id of c10.requerenteIds) {
      await vincularRequerente({ arvoreId: c10.arvoreId, requerenteId: id })
      esperado--
      const atual = (await disponiveisParaArvore(c10.processoId)).filter((r) => r.availableForTree).length
      if (atual !== esperado) {
        tudoCerto = false
        ok(false, `após incluir #${id}, restam ${atual} (esperado ${esperado})`)
        break
      }
    }
    if (tudoCerto) ok(true, "cada inclusão reduz a lista em exatamente 1, de 10 até 0")
    ok(
      (await prisma.pessoa.count()) === pessoasAntes + 10,
      "exatamente 10 Pessoas criadas — uma por requerente, nenhuma duplicada",
    )
    const naArvore10 = await prisma.pessoa.findMany({
      where: { arvoreId: c10.arvoreId }, select: { id: true },
    })
    ok(naArvore10.length === 10, "10 membros na árvore", naArvore10.length)
    const personIds = (
      await prisma.requerente.findMany({
        where: { id: { in: c10.requerenteIds } }, select: { personId: true },
      })
    ).map((r) => r.personId)
    ok(new Set(personIds).size === 10, "cada requerente aponta para uma Pessoa distinta")

    // remover 3 → voltam a ficar disponíveis
    const remover = c10.requerenteIds.slice(0, 3)
    for (const id of remover) {
      const pid = (await prisma.requerente.findUnique({ where: { id }, select: { personId: true } }))!.personId!
      await prisma.pessoa.update({ where: { id: pid }, data: { removidaEm: new Date() } })
    }
    let l10 = await disponiveisParaArvore(c10.processoId)
    ok(l10.filter((r) => r.availableForTree).length === 3, "os 3 removidos voltam a ficar disponíveis")
    ok(
      l10.filter((r) => r.alreadyInTree).length === 7,
      "e os outros 7 continuam indisponíveis",
    )

    // reinserir os 3 → zero duplicação
    const pessoasAntesRe = await prisma.pessoa.count()
    for (const id of remover) {
      const pid = (await prisma.requerente.findUnique({ where: { id }, select: { personId: true } }))!.personId!
      await prisma.pessoa.update({ where: { id: pid }, data: { removidaEm: null } })
      await vincularRequerente({ arvoreId: c10.arvoreId, requerenteId: id })
    }
    l10 = await disponiveisParaArvore(c10.processoId)
    ok(l10.filter((r) => r.availableForTree).length === 0, "após reinserir, nenhum disponível")
    ok((await prisma.pessoa.count()) === pessoasAntesRe, "reinserção não criou Pessoa nova")
    const ativos = await prisma.pessoa.count({ where: { arvoreId: c10.arvoreId, removidaEm: null } })
    ok(ativos === 10, "exatamente 10 membros ativos — nenhum membership duplicado", ativos)
  } finally {
    await limpar(c)
    await limpar(c10)
    await prisma.$disconnect()
  }

  console.log("\n" + "─".repeat(60))
  if (failed === 0) {
    console.log(`${passed} verificações · MEMBERSHIP ÍNTEGRO ✅\n`)
    process.exit(0)
  }
  console.log(`${passed} passaram, ${failed} falharam:`)
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}

main().catch(async (e) => {
  console.error("ERRO FATAL:", e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
