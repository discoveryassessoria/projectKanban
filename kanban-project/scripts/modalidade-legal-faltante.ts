// scripts/modalidade-legal-faltante.ts
//
// MODALIDADE LEGAL DE PORTUGAL E ALEMANHA.
//
// As duas eram nacionalidades OFERTADAS sem base jurídica cadastrada. Sem ela o
// processo nasce sem enquadramento, e o relatório de Protocolos não consegue
// afirmar o que é uma linha para aquele país.
//
// ─── A CARDINALIDADE NÃO FOI DEDUZIDA ───────────────────────────────────────
// Ela é fato jurídico, não algo que eu possa inferir do banco. Foi informada
// pelo usuário em 02/09/2026: "Portugal, o protocolo é individual... na Alemanha
// também". INDIVIDUAL quer dizer um requerimento por requerente — cinco pessoas
// protocoladas são cinco protocolos, e cinco linhas no relatório.
//
// Para comparação, o que já estava cadastrado:
//   Itália  · Processo Judicial ........ COLETIVO   (um ricorso cobre a família)
//   Itália  · Processo Administrativo .. INDIVIDUAL (via consular, por pessoa)
//   Espanha · Lei da Memória Democrática INDIVIDUAL
//
//   Ver:      npx tsx scripts/modalidade-legal-faltante.ts
//   Aplicar:  EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/modalidade-legal-faltante.ts --aplicar

import { prisma } from "@/lib/prisma"

const APLICAR = process.argv.includes("--aplicar")

/** Informado pelo usuário. Nada aqui é inferido. */
const A_CADASTRAR = [
  { countryKey: "portugal", code: "PT_ADMINISTRATIVO", nome: "Processo Administrativo", cardinalidade: "INDIVIDUAL" },
  { countryKey: "alemanha", code: "DE_ADMINISTRATIVO", nome: "Processo Administrativo", cardinalidade: "INDIVIDUAL" },
] as const

async function r<T>(f: () => Promise<T>, n = 25): Promise<T> {
  for (let i = 0; i < n; i++) {
    try { return await f() } catch (e) {
      if (i === n - 1) throw e
      await new Promise((x) => setTimeout(x, Math.min(15000, 1500 * (i + 1))))
    }
  }
  throw new Error("sem conexão")
}

async function main() {
  console.log("MODALIDADE LEGAL — o que falta cadastrar\n")
  const plano: { paisId: number; rotulo: string; code: string; nome: string; cardinalidade: string }[] = []

  for (const m of A_CADASTRAR) {
    const pais = await r(() => prisma.catalogoPais.findUnique({
      where: { countryKey: m.countryKey },
      select: { id: true, countryLabel: true, modalidadesLegais: { select: { code: true, cardinalidadeRequerimento: true } } },
    }))
    if (!pais) { console.log(`  ⚠ ${m.countryKey} não existe no cadastro de países — pulado`); continue }
    if (pais.modalidadesLegais.length) {
      console.log(`  · ${pais.countryLabel}: já tem ${pais.modalidadesLegais.map((x) => `${x.code}/${x.cardinalidadeRequerimento}`).join(", ")} — não mexo`)
      continue
    }
    console.log(`  + ${pais.countryLabel}: ${m.code} "${m.nome}" · ${m.cardinalidade}`)
    plano.push({ paisId: pais.id, rotulo: pais.countryLabel, code: m.code, nome: m.nome, cardinalidade: m.cardinalidade })
  }

  if (!plano.length) { console.log("\n✅ Nada a cadastrar."); return }
  if (!APLICAR) { console.log("\nDRY-RUN: nada foi escrito."); return }
  if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "1") {
    console.error("\n❌ Escrita não confirmada. Defina EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1.")
    process.exit(1)
  }

  for (const p of plano) {
    await r(() => prisma.modalidadeLegal.create({
      data: {
        code: p.code, nome: p.nome, paisId: p.paisId,
        cardinalidadeRequerimento: p.cardinalidade, ordem: 0, ativo: true,
      },
    }))
    console.log(`  ✅ ${p.rotulo}: ${p.code} · ${p.cardinalidade}`)
  }

  console.log("\n  Como o relatório de Protocolos passa a responder:")
  for (const k of ["italia", "espanha", "portugal", "alemanha"]) {
    const mods = await r(() => prisma.modalidadeLegal.findMany({
      where: { ativo: true, pais: { countryKey: k } }, select: { cardinalidadeRequerimento: true },
    }))
    const c = new Set(mods.map((m) => m.cardinalidadeRequerimento))
    console.log(`     ${k.padEnd(10)} [${[...c].join(", ") || "—"}]`)
  }
}

main().finally(() => prisma.$disconnect())
