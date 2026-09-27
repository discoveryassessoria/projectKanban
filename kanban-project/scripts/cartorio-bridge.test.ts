// scripts/cartorio-bridge.test.ts
// ============================================================================
// BUG 3 (rodada de ajustes Operação v3, 26/09/2026) — a ponte
// Cartório→OrgaoProtocolo (src/lib/cartorio-bridge.ts).
//
// A identidade composta (nome + município/UF) existe porque cartórios
// brasileiros repetem nome genérico entre cidades — casar só por nome
// (como `resolverOrganizacao` faz pra outras organizações) colapsaria
// cartórios de cidades DIFERENTES no mesmo OrgaoProtocolo. Prova os 3
// estados pedidos:
//   1. cartório com OrgaoProtocolo já cadastrado sob a identidade composta
//      → resolve o id
//   2. cartório sem NENHUM OrgaoProtocolo mapeado → null, nunca cria
//   3. dois cartórios com o MESMO nome em cidades diferentes → identidades
//      compostas diferentes, nunca colidem
//
// ESCREVE NO BANCO (só o OrgaoProtocolo de fixture) — só roda no banco de
// teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { identidadeCompostaDoCartorio, resolverOrgaoDoCartorio } from "@/src/lib/cartorio-bridge"

const MARCA = "CARTORIOBRIDGE"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  await prisma.orgaoProtocolo.deleteMany({ where: { name: { startsWith: MARCA } } })
}

async function main() {
  exigirBancoDeTeste("cartorio-bridge.test.ts")
  await limpar()
  console.log("BUG 3 — ponte Cartório→OrgaoProtocolo (identidade composta)\n")

  // ══════════════════════════════════════════════════════════════════════
  secao("1) cartório MAPEADO — resolve o orgaoId certo")
  // ══════════════════════════════════════════════════════════════════════
  const cartorioBage = { nome: `${MARCA} 1º Ofício de Registro Civil`, municipio: "Bagé", uf: "RS" }
  const identidadeBage = identidadeCompostaDoCartorio(cartorioBage)
  ok("1.1) identidade composta inclui nome + cidade/UF", identidadeBage === `${cartorioBage.nome} - Bagé/RS`, identidadeBage)
  const orgaoBage = await prisma.orgaoProtocolo.create({ data: { name: identidadeBage, type: "cartorio" }, select: { id: true } })
  const r1 = await resolverOrgaoDoCartorio(cartorioBage)
  ok("1.2) resolve o orgaoId cadastrado", r1 === orgaoBage.id, String(r1))

  // ══════════════════════════════════════════════════════════════════════
  secao("2) cartório SEM órgão mapeado — null, nunca cria")
  // ══════════════════════════════════════════════════════════════════════
  const antesDaContagem = await prisma.orgaoProtocolo.count({ where: { name: { startsWith: MARCA } } })
  const cartorioSemMapa = { nome: `${MARCA} Cartório Nunca Cadastrado`, municipio: "Nowhere", uf: "XX" }
  const r2 = await resolverOrgaoDoCartorio(cartorioSemMapa)
  ok("2.1) retorna null (gap real, não erro)", r2 === null, String(r2))
  const depoisDaContagem = await prisma.orgaoProtocolo.count({ where: { name: { startsWith: MARCA } } })
  ok("2.2) NÃO criou nenhum OrgaoProtocolo novo", depoisDaContagem === antesDaContagem, `${antesDaContagem} → ${depoisDaContagem}`)

  // ══════════════════════════════════════════════════════════════════════
  secao("3) MESMO nome, cidades diferentes — nunca colidem")
  // ══════════════════════════════════════════════════════════════════════
  const nomeGenerico = `${MARCA} 1º Ofício de Registro Civil (genérico)`
  const cartorioA = { nome: nomeGenerico, municipio: "Bagé", uf: "RS" }
  const cartorioB = { nome: nomeGenerico, municipio: "Santa Clara do Sul", uf: "RS" }
  ok("3.1) identidades compostas diferentes pro mesmo nome", identidadeCompostaDoCartorio(cartorioA) !== identidadeCompostaDoCartorio(cartorioB))
  const orgaoA = await prisma.orgaoProtocolo.create({ data: { name: identidadeCompostaDoCartorio(cartorioA), type: "cartorio" }, select: { id: true } })
  const r3a = await resolverOrgaoDoCartorio(cartorioA)
  const r3b = await resolverOrgaoDoCartorio(cartorioB)
  ok("3.2) cartório A resolve o órgão dele", r3a === orgaoA.id, String(r3a))
  ok("3.3) cartório B (nome igual, cidade diferente) NÃO resolve o de A — ainda sem mapa", r3b === null, String(r3b))

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch(async (e) => { console.error(e); await limpar().catch(() => {}); process.exit(1) }).finally(() => prisma.$disconnect())
