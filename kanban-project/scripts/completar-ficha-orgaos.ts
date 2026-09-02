// scripts/completar-ficha-orgaos.ts
//
// COMPLETA A FICHA DOS ÓRGÃOS COM O QUE JÁ É DEDUTÍVEL DO CADASTRO.
//
// Duas lacunas que o motor de saúde acusa, e que NÃO exigem decisão de negócio
// nenhuma — a resposta já está no cadastro, só não foi copiada para a ficha:
//
// 1) CATEGORIA dos tribunais italianos. Os 21 que entraram pelo seed nasceram
//    sem categoria; os tribunais que já existiam têm "tribunais" e "justica".
//    A categoria é a MESMA por definição — é a mesma espécie de órgão. Aqui ela
//    é COPIADA dos iguais, nunca escolhida por mim.
//
// 2) MOEDA dos fornecedores. `CatalogoPais.defaultCurrency` já diz qual é a
//    moeda de cada país; um fornecedor italiano cobra em euro porque a Itália
//    usa euro. A moeda é DERIVADA do país canônico do próprio órgão — não é
//    arbitrada.
//
// O que este script NÃO faz: inventar preço, categoria que ninguém usa, ou
// moeda de órgão sem país. Onde o cadastro não responde, ele não escreve.
//
//   Ver:      npx tsx scripts/completar-ficha-orgaos.ts
//   Aplicar:  EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/completar-ficha-orgaos.ts --aplicar

import { prisma } from "@/lib/prisma"

const APLICAR = process.argv.includes("--aplicar")

async function r<T>(f: () => Promise<T>, n = 20): Promise<T> {
  for (let i = 0; i < n; i++) {
    try { return await f() } catch (e) {
      if (i === n - 1) throw e
      await new Promise((x) => setTimeout(x, Math.min(15000, 1500 * (i + 1))))
    }
  }
  throw new Error("sem conexão")
}

async function main() {
  // ── 1) CATEGORIA, copiada dos órgãos do mesmo tipo ────────────────────────
  console.log("CATEGORIA — copiada de quem já tem, pelo mesmo tipo de órgão\n")

  const semCategoria = await r(() => prisma.orgaoProtocolo.findMany({
    where: { ativo: true, categorias: { none: {} }, type: { not: null } },
    select: { id: true, name: true, type: true },
    orderBy: { id: "asc" },
  }))

  // Para cada TIPO, qual conjunto de categorias os órgãos daquele tipo usam.
  const referencia = new Map<string, number[]>()
  for (const tipo of [...new Set(semCategoria.map((o) => o.type!))]) {
    const iguais = await r(() => prisma.orgaoProtocolo.findMany({
      where: { type: tipo, categorias: { some: {} } },
      select: { categorias: { select: { categoriaId: true } } },
      take: 20,
    }))
    // Só usa a categoria que a MAIORIA dos iguais usa: uma exceção isolada não
    // vira regra para os outros vinte.
    const contagem = new Map<number, number>()
    for (const o of iguais) for (const c of o.categorias) contagem.set(c.categoriaId, (contagem.get(c.categoriaId) ?? 0) + 1)
    const maioria = [...contagem.entries()].filter(([, n]) => n > iguais.length / 2).map(([id]) => id)
    if (maioria.length) referencia.set(tipo, maioria)
    console.log(`  tipo "${tipo}": ${iguais.length} igual(is) com categoria → ${maioria.length ? `categorias ${maioria.join(", ")}` : "SEM MAIORIA — não copio"}`)
  }

  const aCategorizar = semCategoria.filter((o) => referencia.has(o.type!))
  const semReferencia = semCategoria.filter((o) => !referencia.has(o.type!))
  console.log(`\n  ${aCategorizar.length} órgão(s) receberiam categoria; ${semReferencia.length} ficam sem (nenhum igual para copiar)`)
  for (const o of aCategorizar.slice(0, 5)) console.log(`     #${o.id} ${o.name}`)
  if (aCategorizar.length > 5) console.log(`     … e mais ${aCategorizar.length - 5}`)

  // ── 2) MOEDA, derivada do país canônico ───────────────────────────────────
  console.log("\nMOEDA — derivada de CatalogoPais.defaultCurrency\n")
  const semMoeda = await r(() => prisma.orgaoProtocolo.findMany({
    where: { funcoes: { has: "FORNECEDOR" }, OR: [{ moeda: null }, { moeda: "" }] },
    select: { id: true, name: true, pais: { select: { countryLabel: true, defaultCurrency: true } } },
  }))
  const comPais = semMoeda.filter((o) => o.pais?.defaultCurrency)
  const semPais = semMoeda.filter((o) => !o.pais?.defaultCurrency)
  const porMoeda = new Map<string, number>()
  for (const o of comPais) porMoeda.set(o.pais!.defaultCurrency, (porMoeda.get(o.pais!.defaultCurrency) ?? 0) + 1)
  for (const [m, n] of porMoeda) console.log(`  ${n} fornecedor(es) → ${m}`)
  if (semPais.length) console.log(`  ${semPais.length} sem país cadastrado — ficam sem moeda (não invento)`)

  if (!APLICAR) {
    console.log(`\nDRY-RUN: nada foi escrito.`)
    console.log(`  ${aCategorizar.length} categoria(s) e ${comPais.length} moeda(s) seriam preenchidas.`)
    return
  }
  if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "1") {
    console.error("\n❌ Escrita não confirmada. Defina EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1.")
    process.exit(1)
  }

  let cats = 0
  for (const o of aCategorizar) {
    const ids = referencia.get(o.type!)!
    await r(() => prisma.organizacaoCategoria.createMany({
      data: ids.map((categoriaId) => ({ orgaoId: o.id, categoriaId })),
      skipDuplicates: true,
    }))
    cats++
  }
  let moedas = 0
  for (const o of comPais) {
    await r(() => prisma.orgaoProtocolo.update({ where: { id: o.id }, data: { moeda: o.pais!.defaultCurrency } }))
    moedas++
  }

  const restaCat = await r(() => prisma.orgaoProtocolo.count({ where: { ativo: true, categorias: { none: {} } } }))
  const restaMoeda = await r(() => prisma.orgaoProtocolo.count({
    where: { funcoes: { has: "FORNECEDOR" }, OR: [{ moeda: null }, { moeda: "" }] } }))
  console.log(`\n✅ ${cats} órgão(s) categorizado(s) · ${moedas} moeda(s) preenchida(s)`)
  console.log(`   Restam sem categoria: ${restaCat} · sem moeda: ${restaMoeda}`)
}

main().finally(() => prisma.$disconnect())
