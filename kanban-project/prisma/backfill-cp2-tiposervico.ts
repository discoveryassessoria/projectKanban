// prisma/backfill-cp2-tiposervico.ts
// CP-2 — backfill aditivo de TipoServico -> ItemCatalogo. IDEMPOTENTE.
//
// Tenta casar cada TipoServico (sem itemCatalogoId) a um ItemCatalogo pelo
// NOME normalizado (direto, ou via ServicoProduto que já aponta ao mestre).
// Não casou => unresolvedCount (revisão manual futura). Não remove nada, não
// altera comportamento operacional, escreve só o campo novo (sem dual-write).
//
// Rodar: npm run backfill:cp2:tiposervico   (exige env de banco)

import { PrismaClient } from "@prisma/client"
import { normalizarTexto } from "../src/services/identity"

const prisma = new PrismaClient()

async function main() {
  console.log("🌱 CP-2 backfill — TipoServico -> ItemCatalogo")

  // Mapa nome-normalizado -> itemCatalogoId
  const mapa = new Map<string, number>()

  const itens = await prisma.itemCatalogo.findMany({ select: { id: true, name: true } })
  for (const it of itens) {
    const k = normalizarTexto(it.name)
    if (k && !mapa.has(k)) mapa.set(k, it.id)
  }
  // ServicoProduto que já aponta ao mestre reforça o mapa (nome do serviço).
  const servicos = await prisma.servicoProduto.findMany({
    where: { itemCatalogoId: { not: null } },
    select: { name: true, itemCatalogoId: true },
  })
  for (const sp of servicos) {
    const k = normalizarTexto(sp.name)
    if (k && sp.itemCatalogoId && !mapa.has(k)) mapa.set(k, sp.itemCatalogoId)
  }

  const tipos = await prisma.tipoServico.findMany({
    where: { itemCatalogoId: null },
    select: { id: true, nome: true },
  })

  let vinculados = 0
  let unresolvedCount = 0
  for (const t of tipos) {
    const id = mapa.get(normalizarTexto(t.nome))
    if (id) {
      await prisma.tipoServico.update({ where: { id: t.id }, data: { itemCatalogoId: id } })
      vinculados++
    } else {
      unresolvedCount++
    }
  }

  console.log(`   TipoServico vinculados:   ${vinculados}`)
  console.log(`   unresolvedCount:          ${unresolvedCount}`)
  console.log(
    "ℹ️ unresolvedCount > 0 é esperado (nomes livres). São pendências de revisão " +
      "manual — o fallback de leitura legado permanece. Nenhum legado removido."
  )
}

main()
  .catch((e) => {
    console.error("❌ Erro no backfill de TipoServico:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
