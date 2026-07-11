// prisma/backfill-cp2-catalogo.ts
// CP-2 — backfill do Documento Mestre. IDEMPOTENTE e não-destrutivo.
//
// 1) para cada valor do enum TipoDocumento, garante um ItemCatalogo
//    (natureza DOCUMENTO) e um TipoDocumentoCadastro (legacyEnumKey) apontando
//    para o mestre (itemCatalogoId);
// 2) para cada Documento com `tipo` (enum) mas sem `documentTypeId`, vincula o
//    documentTypeId à projeção correspondente.
// Escreve só vínculos/campos novos (sem dual-write). Não altera o enum legado.
//
// Rodar: npm run backfill:cp2:catalogo   (exige env de banco)

import { PrismaClient, TipoDocumento, NaturezaItem } from "@prisma/client"
import { codeDocumentoMestre, nomeDocumentoMestre } from "../src/services/catalogo-helpers"

const prisma = new PrismaClient()

async function main() {
  console.log("🌱 CP-2 backfill — Documento Mestre (ItemCatalogo)")

  let itensCriados = 0
  let tiposCriados = 0
  let tiposVinculados = 0
  let docsVinculados = 0

  for (const enumKey of Object.values(TipoDocumento)) {
    const code = codeDocumentoMestre(enumKey)
    const name = nomeDocumentoMestre(enumKey)

    // 1) ItemCatalogo mestre (por code único)
    const itemExistente = await prisma.itemCatalogo.findUnique({ where: { code } })
    const item = itemExistente
      ? itemExistente
      : await prisma.itemCatalogo.create({
          data: { code, name, natureza: NaturezaItem.DOCUMENTO },
        })
    if (!itemExistente) itensCriados++

    // 2) TipoDocumentoCadastro (projeção) por legacyEnumKey único
    const tipoExistente = await prisma.tipoDocumentoCadastro.findUnique({
      where: { legacyEnumKey: enumKey },
    })
    if (!tipoExistente) {
      await prisma.tipoDocumentoCadastro.create({
        data: { name, legacyEnumKey: enumKey, itemCatalogoId: item.id, ativo: true },
      })
      tiposCriados++
    } else if (tipoExistente.itemCatalogoId == null) {
      await prisma.tipoDocumentoCadastro.update({
        where: { id: tipoExistente.id },
        data: { itemCatalogoId: item.id },
      })
      tiposVinculados++
    }
  }

  // 3) Documentos com enum mas sem documentTypeId
  const docs = await prisma.documento.findMany({
    where: { documentTypeId: null, tipo: { not: null } },
    select: { id: true, tipo: true },
  })
  for (const d of docs) {
    if (!d.tipo) continue
    const cad = await prisma.tipoDocumentoCadastro.findUnique({
      where: { legacyEnumKey: String(d.tipo) },
    })
    if (cad) {
      await prisma.documento.update({ where: { id: d.id }, data: { documentTypeId: cad.id } })
      docsVinculados++
    }
  }

  // Reconciliação: documentos que não resolvem nenhum mestre.
  const unresolvedCount = await prisma.documento.count({
    where: { documentTypeId: null, tipo: null },
  })

  console.log(`   Itens de catálogo criados:     ${itensCriados}`)
  console.log(`   Tipos (projeção) criados:      ${tiposCriados}`)
  console.log(`   Tipos vinculados ao mestre:    ${tiposVinculados}`)
  console.log(`   Documentos vinculados:         ${docsVinculados}`)
  console.log(`   unresolvedCount (sem tipo):    ${unresolvedCount}`)
  console.log(
    unresolvedCount === 0
      ? "✅ Todos os documentos resolvem um Documento Mestre."
      : "ℹ️ Documentos sem tipo permanecem pendentes (revisão futura); nenhum dado alterado indevidamente."
  )
}

main()
  .catch((e) => {
    console.error("❌ Erro no backfill de catálogo:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
