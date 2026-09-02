// scripts/limpar-arvores-orfas.ts
//
// Remove ÁRVORE que não pertence a processo nenhum — e, por cascata, as
// pessoas dentro dela (`Pessoa.arvoreId onDelete: Cascade`).
//
// POR QUE ELAS EXISTEM. A criação da árvore aceitava nascer sem processo: a
// tela montava o nome como `Árvore do Processo ${processoId}` e, com o id ainda
// indefinido, mandava a string literal "Árvore do Processo undefined". A árvore
// nascia solta, nenhum processo apontava para ela, e por isso ela SOBREVIVIA a
// toda exclusão de processo — a varredura de órfãs procura pelo vínculo, e
// vínculo era o que ela nunca teve. A porta foi fechada em
// `src/app/api/arvore/route.ts` (o processo passou a ser exigido e o nome sai
// do servidor); isto aqui é a limpeza do que ficou.
//
// Seco por padrão. Só escreve com `--aplicar`.

import { prisma } from '@/lib/prisma'

async function main() {
  const aplicar = process.argv.includes('--aplicar')

  const orfas = await prisma.arvore.findMany({
    where: { processos: { none: {} } },
    select: { id: true, nome: true, familiaId: true, _count: { select: { pessoas: true } } },
    orderBy: { id: 'asc' },
  })

  if (!orfas.length) {
    console.log('Nenhuma árvore órfã. Nada a fazer.')
    await prisma.$disconnect()
    return
  }

  const pessoas = orfas.reduce((s, a) => s + a._count.pessoas, 0)
  console.log(`${orfas.length} árvore(s) órfã(s), com ${pessoas} pessoa(s) dentro:`)
  for (const a of orfas) console.log(`  #${a.id} "${a.nome}" — ${a._count.pessoas} pessoa(s)`)

  if (!aplicar) {
    console.log('\nSECO. Rode de novo com --aplicar para excluir.')
    await prisma.$disconnect()
    return
  }

  for (const a of orfas) {
    // Confere de novo DENTRO da transação: entre a leitura e a escrita alguém
    // pode ter ligado um processo a esta árvore, e aí ela deixou de ser órfã.
    await prisma.$transaction(async (tx) => {
      const aindaOrfa = await tx.processo.count({ where: { arvoreId: a.id } })
      if (aindaOrfa > 0) {
        console.log(`  #${a.id} ganhou processo no meio do caminho — preservada.`)
        return
      }
      await tx.arvore.delete({ where: { id: a.id } })
      console.log(`  #${a.id} "${a.nome}" excluída (${a._count.pessoas} pessoa(s) por cascata).`)
    })
  }

  const restantes = await prisma.arvore.count({ where: { processos: { none: {} } } })
  console.log(`\nÁrvores órfãs restantes: ${restantes}`)
  console.log(`Pessoas no sistema: ${await prisma.pessoa.count()} · Árvores: ${await prisma.arvore.count()}`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
