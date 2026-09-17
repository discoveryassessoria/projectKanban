// scripts/backfill-obrigacao-atribuicao.ts
//
// A OBRIGAÇÃO ADMINISTRATIVA ATRIBUIR_RESPONSAVEL só nasce por EVENTO
// (materialização, atribuição, devolução à fila — ver
// lib/operacional/obrigacao-atribuicao.ts). Toda Tarefa NORMAL que já estava
// sem responsável ANTES desse motor existir nunca disparou nenhum desses
// eventos depois — a obrigação correspondente simplesmente nunca nasceu.
// Achado real (leitura de produção, 17/09/2026): a Grisotto tinha 15 Tarefa
// NORMAL sem responsável e ZERO Tarefa ADMINISTRATIVA. Minha Operação e Home
// sempre estiveram corretos — faltava reconciliar o dado que já existia.
//
// Este script varre TODO processo com pelo menos 1 Tarefa NORMAL ativa sem
// responsável e chama `reconciliarObrigacaoDeAtribuicao` — a MESMA porta
// idempotente que qualquer evento real já chama. Rodar de novo sem nada ter
// mudado não faz nada (idempotente por desenho).
//
// Seco por padrão. Só escreve com `--aplicar`.
// Rodar em produção: npx tsx scripts/backfill-obrigacao-atribuicao.ts --aplicar

import { prisma } from "@/lib/prisma"
import { reconciliarObrigacaoDeAtribuicao } from "@/lib/operacional/obrigacao-atribuicao"
import { STATUS_ATIVOS } from "@/lib/operacional/tarefa-canonica"

async function main() {
  const aplicar = process.argv.includes("--aplicar")

  const grupos = await prisma.tarefa.groupBy({
    by: ["processoId"],
    where: {
      tipo: "NORMAL",
      responsavelId: null,
      statusTarefa: { in: STATUS_ATIVOS as never },
      processoId: { not: null },
    },
    _count: { _all: true },
  })

  console.log(`${grupos.length} processo(s) com Tarefa NORMAL sem responsável agora.\n`)

  for (const g of grupos) {
    if (g.processoId == null) continue
    const processo = await prisma.processo.findUnique({ where: { id: g.processoId }, select: { nome: true } })
    const jaTinha = await prisma.tarefa.findFirst({
      where: { processoId: g.processoId, tipo: "ADMINISTRATIVA", origem: "obrigacao-atribuicao", concluida: false },
      select: { id: true },
    })
    console.log(
      `  ${jaTinha ? "—" : "+"} processo ${g.processoId} (${processo?.nome ?? "?"}): ${g._count._all} sem responsável` +
        (jaTinha ? " (já tinha obrigação aberta)" : " (obrigação FALTANTE)"),
    )
    if (aplicar) await reconciliarObrigacaoDeAtribuicao(prisma, g.processoId)
  }

  console.log(aplicar ? "\nAplicado." : "\nModo seco — rode com --aplicar para escrever.")
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
