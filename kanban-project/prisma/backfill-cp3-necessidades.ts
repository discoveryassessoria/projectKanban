// prisma/backfill-cp3-necessidades.ts
// CP-3 — backfill: liga Documentos existentes à sua NecessidadeDocumental.
// IDEMPOTENTE e não-destrutivo. Não inventa vínculos ambíguos (Regra 11):
// documento sem processo único, sem itemCatalogo resolvível, ou (casamento)
// sem união única -> unresolvedCount (revisão manual). Escreve só campos novos
// (sem dual-write). Origem das necessidades criadas aqui = MIGRACAO.
//
// Rodar: npm run backfill:cp3:necessidades   (exige env de banco)

import { PrismaClient } from "@prisma/client"
import { montarChaveIdempotencia } from "../src/services/necessidade-documental-helpers"
import { codeDocumentoMestre } from "../src/services/catalogo-helpers"

const prisma = new PrismaClient()

function ehCasamento(tipo: string | null, ruleCode: string | null): boolean {
  if (ruleCode === "CAS_IT") return true
  return !!tipo && tipo.startsWith("CERTIDAO_CASAMENTO")
}

async function resolverItemCatalogo(documentTypeId: number | null, tipo: string | null): Promise<number | null> {
  if (documentTypeId != null) {
    const cad = await prisma.tipoDocumentoCadastro.findUnique({
      where: { id: documentTypeId },
      select: { itemCatalogoId: true },
    })
    if (cad?.itemCatalogoId) return cad.itemCatalogoId
  }
  if (tipo) {
    const cad = await prisma.tipoDocumentoCadastro.findUnique({
      where: { legacyEnumKey: tipo },
      select: { itemCatalogoId: true },
    })
    if (cad?.itemCatalogoId) return cad.itemCatalogoId
    const item = await prisma.itemCatalogo.findUnique({ where: { code: codeDocumentoMestre(tipo) }, select: { id: true } })
    if (item) return item.id
  }
  return null
}

async function main() {
  console.log("🌱 CP-3 backfill — Documentos -> NecessidadeDocumental")

  let linkados = 0
  let necessidadesCriadas = 0
  let unresolvedCount = 0
  const motivos: Record<string, number> = { sem_processo: 0, sem_item: 0, uniao_ambigua: 0 }

  const docs = await prisma.documento.findMany({
    where: { necessidadeId: null },
    select: {
      id: true,
      pessoaId: true,
      tipo: true,
      documentTypeId: true,
      ruleCode: true,
      pessoa: { select: { arvoreId: true, arvore: { select: { processos: { select: { id: true } } } } } },
    },
  })

  for (const d of docs) {
    const processos = d.pessoa?.arvore?.processos ?? []
    if (processos.length !== 1) {
      unresolvedCount++
      motivos.sem_processo++
      continue
    }
    const processoId = processos[0].id

    const itemCatalogoId = await resolverItemCatalogo(d.documentTypeId, d.tipo)
    if (!itemCatalogoId) {
      unresolvedCount++
      motivos.sem_item++
      continue
    }

    let pessoaId: number | null = d.pessoaId
    let uniaoId: number | null = null
    if (ehCasamento(d.tipo, d.ruleCode)) {
      const unioes = await prisma.uniao.findMany({
        where: { OR: [{ pessoa1Id: d.pessoaId }, { pessoa2Id: d.pessoaId }] },
        select: { id: true },
      })
      if (unioes.length !== 1) {
        unresolvedCount++
        motivos.uniao_ambigua++
        continue
      }
      uniaoId = unioes[0].id
      pessoaId = null
    }

    const chaveIdempotencia = montarChaveIdempotencia({
      processoId,
      itemCatalogoId,
      pessoaId,
      uniaoId,
      varianteKey: "padrao",
      ciclo: 1,
    })

    let necessidade = await prisma.necessidadeDocumental.findUnique({ where: { chaveIdempotencia } })
    if (!necessidade) {
      necessidade = await prisma.necessidadeDocumental.create({
        data: {
          processoId,
          itemCatalogoId,
          pessoaId,
          uniaoId,
          varianteKey: "padrao",
          ciclo: 1,
          chaveIdempotencia,
          origem: "MIGRACAO",
          obrigatoriedade: "OBRIGATORIA",
          status: "PENDENTE",
          arvoreId: d.pessoa?.arvoreId ?? null,
          ruleCode: d.ruleCode,
        },
      })
      await prisma.necessidadeDocumentalEvento.create({
        data: { necessidadeId: necessidade.id, tipo: "CRIADA", dados: { origem: "MIGRACAO" } },
      })
      necessidadesCriadas++
    }

    await prisma.documento.update({ where: { id: d.id }, data: { necessidadeId: necessidade.id } })
    linkados++
  }

  console.log(`   Documentos analisados:      ${docs.length}`)
  console.log(`   Documentos vinculados:      ${linkados}`)
  console.log(`   Necessidades criadas:       ${necessidadesCriadas}`)
  console.log(`   unresolvedCount:            ${unresolvedCount}`)
  console.log(`     - sem processo único:     ${motivos.sem_processo}`)
  console.log(`     - sem item de catálogo:   ${motivos.sem_item}`)
  console.log(`     - união ambígua:          ${motivos.uniao_ambigua}`)
  console.log("ℹ️ Ambíguos permanecem para revisão manual (não inventamos vínculo). Nenhum legado removido.")
}

main()
  .catch((e) => {
    console.error("❌ Erro no backfill CP-3:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
