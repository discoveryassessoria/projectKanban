// scripts/limpar-familias-orfas.ts
//
// FAMÍLIA ÓRFÃ É RESÍDUO — e resíduo sai.
//
// Órfã aqui é literal: sem processo E sem árvore. Ninguém a alcança por porta
// nenhuma do sistema, e ela só aparece somando no relatório — que passa a dizer
// "63 famílias" quando existem duas.
//
// Elas nasceram porque criar uma árvore criava uma família, copiando o nome da
// árvore ("Árvore do Processo 458"). Essa porta foi fechada em
// `src/services/familia.ts`; isto aqui limpa o que ela já produziu.
//
// SÓ APAGA O QUE NÃO TEM VÍNCULO NENHUM. Conta processo e árvore por família,
// uma a uma, e mostra tudo antes. Sem `--aplicar` não escreve nada.
//
//   Ver:      npx tsx scripts/limpar-familias-orfas.ts
//   Aplicar:  EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/limpar-familias-orfas.ts --aplicar

import { prisma } from "@/lib/prisma"

const APLICAR = process.argv.includes("--aplicar")

async function comRetry<T>(f: () => Promise<T>, n = 20): Promise<T> {
  for (let i = 0; i < n; i++) {
    try { return await f() } catch (e) {
      if (i === n - 1) throw e
      await new Promise((r) => setTimeout(r, Math.min(15000, 1500 * (i + 1))))
    }
  }
  throw new Error("sem conexão")
}

async function main() {
  const familias = await comRetry(() => prisma.familia.findMany({
    select: {
      id: true, nome: true, createdAt: true,
      _count: { select: { processos: true, arvores: true } },
    },
    orderBy: { id: "asc" },
  }))

  const orfas = familias.filter((f) => f._count.processos === 0 && f._count.arvores === 0)
  const vinculadas = familias.filter((f) => f._count.processos > 0 || f._count.arvores > 0)

  console.log(`FAMÍLIAS — ${familias.length} no cadastro\n`)
  console.log(`  COM vínculo (ficam) ..... ${vinculadas.length}`)
  for (const f of vinculadas) {
    console.log(`     #${f.id} "${f.nome}" — ${f._count.processos} processo(s), ${f._count.arvores} árvore(s)`)
  }
  console.log(`\n  ÓRFÃS (sem processo e sem árvore) ..... ${orfas.length}`)
  for (const f of orfas) {
    console.log(`     #${String(f.id).padStart(3)} "${f.nome}"`)
  }

  if (orfas.length === 0) {
    console.log("\n✅ Nada a limpar.")
    return
  }

  if (!APLICAR) {
    console.log(`\nDRY-RUN: nada foi escrito. ${orfas.length} família(s) seriam removidas.`)
    console.log("Para aplicar:\n  EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/limpar-familias-orfas.ts --aplicar")
    return
  }

  if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "1") {
    console.error("\n❌ Escrita não confirmada. Defina EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1.")
    process.exit(1)
  }

  // Uma a uma, e cada uma RECONFERIDA no instante da exclusão: entre a leitura
  // acima e agora alguém pode ter vinculado um processo a ela.
  let removidas = 0
  const pulou: number[] = []
  for (const f of orfas) {
    const ok = await comRetry(async () => {
      const [p, a] = await Promise.all([
        prisma.processo.count({ where: { familiaId: f.id } }),
        prisma.arvore.count({ where: { familiaId: f.id } }),
      ])
      if (p > 0 || a > 0) return false
      await prisma.familia.delete({ where: { id: f.id } })
      return true
    })
    if (ok) removidas++
    else pulou.push(f.id)
  }

  const restam = await comRetry(() => prisma.familia.count())
  console.log(`\n✅ ${removidas} família(s) órfã(s) removida(s).`)
  if (pulou.length) console.log(`   ${pulou.length} pulada(s) por terem ganhado vínculo no meio: ${pulou.join(", ")}`)
  console.log(`   Restam ${restam} família(s) — todas com processo ou árvore.`)
}

main().finally(() => prisma.$disconnect())
