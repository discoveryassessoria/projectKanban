// scripts/backfill-codigo-cliente.ts
//
// Atribui código público aos CLIENTES que ficaram sem — e só a eles.
//
// Requerente e Contratante compartilham a sequência CLI. O backfill NÃO
// renumera ninguém, não reaproveita número e não toca em código existente:
// usa o mesmo CodeGeneratorService da criação, que só avança o contador.
//
//   npx tsx scripts/backfill-codigo-cliente.ts            # relatório
//   npx tsx scripts/backfill-codigo-cliente.ts --execute  # atribui
import { prisma } from "@/lib/prisma"
import { gerarCodigoPublico, sincronizarSequenciaComTabela } from "@/lib/codigos/code-generator"
import { registrarAuditoria } from "@/lib/gerenciamento/auditoria"

const EXECUTAR = process.argv.includes("--execute")

async function main() {
  console.log(`\n== Backfill do código de cliente ${EXECUTAR ? "(EXECUTANDO)" : "(somente relatório)"} ==\n`)

  // 1) A sequência precisa estar À FRENTE do maior código já gravado, senão o
  //    gerador devolveria número em uso e o unique estouraria.
  if (EXECUTAR) {
    for (const t of ["Requerente", "Contratante"] as const) {
      const ate = await sincronizarSequenciaComTabela(prisma, t, "publicCode", "CLIENT")
      console.log(`  sequência CLI sincronizada com ${t}: >= ${ate}`)
    }
  }

  const requerentes = await prisma.requerente.findMany({
    where: { publicCode: null },
    select: { id: true, nome: true, createdAt: true, _count: { select: { processos: true } } },
    orderBy: { id: "asc" },
  })
  const contratantes = await prisma.contratante.findMany({
    where: { publicCode: null },
    select: { id: true, nome: true, createdAt: true },
    orderBy: { id: "asc" },
  })

  console.log(`\n  clientes sem código: ${requerentes.length} requerente(s) · ${contratantes.length} contratante(s)\n`)
  for (const r of requerentes) {
    console.log(`  [Requerente ${r.id}] ${r.nome} · criado ${r.createdAt.toISOString().slice(0, 10)} · ${r._count.processos} processo(s) · código atual: —`)
  }
  for (const c of contratantes) {
    console.log(`  [Contratante ${c.id}] ${c.nome} · criado ${c.createdAt.toISOString().slice(0, 10)} · código atual: —`)
  }

  if (!EXECUTAR) {
    if (requerentes.length + contratantes.length > 0) console.log("\n  Rode com --execute para atribuir.")
    else console.log("  Nada a fazer.")
    return
  }

  const atribuidos: { entidade: string; id: number; codigo: string }[] = []
  for (const r of requerentes) {
    // Sequência e gravação na MESMA transação — nunca deixa registro a meio caminho.
    const codigo = await prisma.$transaction(async (tx) => {
      const c = await gerarCodigoPublico(tx, "CLIENT")
      await tx.requerente.update({ where: { id: r.id }, data: { publicCode: c } })
      return c
    })
    atribuidos.push({ entidade: "Requerente", id: r.id, codigo })
    console.log(`  ✓ Requerente ${r.id} (${r.nome}) → ${codigo}`)
  }
  for (const c of contratantes) {
    const codigo = await prisma.$transaction(async (tx) => {
      const cod = await gerarCodigoPublico(tx, "CLIENT")
      await tx.contratante.update({ where: { id: c.id }, data: { publicCode: cod } })
      return cod
    })
    atribuidos.push({ entidade: "Contratante", id: c.id, codigo })
    console.log(`  ✓ Contratante ${c.id} (${c.nome}) → ${codigo}`)
  }

  if (atribuidos.length) {
    await registrarAuditoria(null as never, {
      acao: "EDITAR", entidade: "BackfillCodigoCliente", entidadeId: null,
      descricao: `Backfill de código público: ${atribuidos.length} cliente(s)`,
      detalhes: { atribuidos },
    }).catch((e) => console.log(`  (auditoria não registrada: ${e?.message ?? e})`))
  }
  console.log(`\n  ${atribuidos.length} código(s) atribuído(s). Nenhum código existente foi alterado.`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
