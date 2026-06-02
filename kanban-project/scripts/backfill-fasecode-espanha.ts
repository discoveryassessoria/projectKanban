// scripts/backfill-fasecode-espanha.ts
//
// ETAPA 3 — backfill do faseCode das colunas (Status) da ESPANHA.
//
// Preenche o campo faseCode (que nasceu null na migration da Etapa 1) nas
// 10 colunas do kanban espanhol, mapeando cada uma para o código de fase
// correspondente do catálogo.
//
// SEGURO: só atualiza o campo faseCode de linhas específicas (por id).
// Não cria, não apaga, não reseta nada. Roda uma vez.
//
// Os ids vieram do Prisma Studio (tabela Status, país ESPANHA):
//   40 Genealogia · 11 Emissão documental · 12 Análise Documental ·
//   13 Retificação de registros · 15 Emissão documental retificada ·
//   16 Tradução juramentada · 17 Apostilamento · 43 Aguardando protocolo ·
//   52 Protocolado · 53 Finalizado
//
// COMO RODAR:
//   npx tsx scripts/backfill-fasecode-espanha.ts
// (ou o runner de TS que vocês já usam para seeds, ex: ts-node)

import { PrismaClient, type FaseCode } from "@prisma/client"

const prisma = new PrismaClient()

// Mapa id-da-coluna → faseCode. Por ID (não por nome) porque é à prova de
// renome: mesmo que alguém mude o nome da coluna na tela, o id não muda.
const MAP: Array<{ id: number; faseCode: FaseCode; nomeEsperado: string }> = [
  { id: 40, faseCode: "GENEALOGIA",                     nomeEsperado: "Genealogia" },
  { id: 11, faseCode: "EMISSAO_DOCUMENTAL",             nomeEsperado: "Emissão documental" },
  { id: 12, faseCode: "ANALISE_DOCUMENTAL",             nomeEsperado: "Análise Documental" },
  { id: 13, faseCode: "RETIFICACAO_REGISTROS",          nomeEsperado: "Retificação de registros" },
  { id: 15, faseCode: "EMISSAO_DOCUMENTAL_RETIFICADA",  nomeEsperado: "Emissão documental retificada" },
  { id: 16, faseCode: "TRADUCAO_JURAMENTADA",           nomeEsperado: "Tradução juramentada" },
  { id: 17, faseCode: "APOSTILAMENTO",                  nomeEsperado: "Apostilamento" },
  { id: 43, faseCode: "AGUARDANDO_PROTOCOLO",           nomeEsperado: "Aguardando protocolo" },
  { id: 52, faseCode: "PROTOCOLADO",                    nomeEsperado: "Protocolado" },
  { id: 53, faseCode: "FINALIZADO",                     nomeEsperado: "Finalizado" },
]

async function main() {
  console.log("Backfill faseCode — Espanha\n")

  for (const item of MAP) {
    // Lê a coluna pra conferir que o id existe e bater o nome (segurança extra)
    const status = await prisma.status.findUnique({ where: { id: item.id } })

    if (!status) {
      console.warn(`  ⚠ id ${item.id} não existe — pulando (${item.nomeEsperado})`)
      continue
    }
    if (status.pais !== "ESPANHA") {
      console.warn(`  ⚠ id ${item.id} não é da ESPANHA (é ${status.pais}) — pulando por segurança`)
      continue
    }
    // Aviso (não bloqueia) se o nome divergir do esperado — só pra você notar
    if (status.nome.trim() !== item.nomeEsperado) {
      console.warn(`  ⚠ id ${item.id}: nome no banco "${status.nome}" ≠ esperado "${item.nomeEsperado}" — atualizando faseCode mesmo assim`)
    }

    await prisma.status.update({
      where: { id: item.id },
      data: { faseCode: item.faseCode },
    })
    console.log(`  ✓ id ${item.id} "${status.nome}" → ${item.faseCode}`)
  }

  console.log("\nConcluído. Conferindo resultado:\n")
  const espanha = await prisma.status.findMany({
    where: { pais: "ESPANHA" },
    orderBy: { ordem: "asc" },
    select: { id: true, nome: true, ordem: true, faseCode: true },
  })
  for (const s of espanha) {
    const marca = s.faseCode ? "✓" : "·"
    console.log(`  ${marca} [${s.id}] ordem ${s.ordem} · ${s.nome} → ${s.faseCode ?? "(vazio)"}`)
  }
}

main()
  .catch((e) => {
    console.error("Erro no backfill:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })