// prisma/backfill-cp1-identidade.ts
// CP-1 — backfill de identidade (Regra 13). IDEMPOTENTE e não-destrutivo.
//
// Liga cada Contratante/Requerente sem personId a uma Pessoa canônica (a
// identidade humana única). Deduplica por CPF (forte) ou nome+nascimento
// (fraco) via chaveDedupPessoa. Papéis que compartilham a mesma chave apontam
// para a MESMA Pessoa. Escreve só nos campos novos (sem dual-write); não move
// nem apaga nada do legado.
//
// Rodar: npm run backfill:cp1:identidade   (exige env de banco)

import { PrismaClient } from "@prisma/client"
import { chaveDedupPessoa } from "../src/services/identity"

const prisma = new PrismaClient()

function nomePessoa(nome: string): string {
  return (nome || "Sem nome").trim().slice(0, 50)
}

async function main() {
  console.log("🌱 CP-1 backfill — Identidade (Pessoa canônica)")

  let pessoasCriadas = 0
  let papeisVinculados = 0
  let duplicatasResolvidas = 0
  let unresolved = 0

  // map: chaveDedup -> pessoaId canônico
  const mapa = new Map<string, number>()

  const contratantes = await prisma.contratante.findMany({
    select: { id: true, cpf: true, nome: true, dataNascimento: true, personId: true },
  })
  const requerentes = await prisma.requerente.findMany({
    select: { id: true, cpf: true, nome: true, dataNascimento: true, personId: true },
  })

  // Idempotência: semear o mapa com vínculos já existentes.
  for (const r of [...contratantes, ...requerentes]) {
    if (r.personId) {
      const k = chaveDedupPessoa(r)
      if (k && !mapa.has(k)) mapa.set(k, r.personId)
    }
  }

  async function processar(
    tipo: "contratante" | "requerente",
    lista: { id: number; cpf: string | null; nome: string; dataNascimento: Date | null; personId: number | null }[]
  ) {
    for (const r of lista) {
      if (r.personId) continue // já canonizado
      const chave = chaveDedupPessoa(r)
      if (!chave) {
        unresolved++
        continue
      }
      let pessoaId = mapa.get(chave)
      if (pessoaId) {
        duplicatasResolvidas++
      } else {
        // Pessoa canônica standalone (sem árvore — identidade universal).
        const pessoa = await prisma.pessoa.create({
          data: { nome: nomePessoa(r.nome), data_nasc: r.dataNascimento ?? null },
        })
        pessoaId = pessoa.id
        mapa.set(chave, pessoaId)
        pessoasCriadas++
      }
      if (tipo === "contratante") {
        await prisma.contratante.update({ where: { id: r.id }, data: { personId: pessoaId } })
      } else {
        await prisma.requerente.update({ where: { id: r.id }, data: { personId: pessoaId } })
      }
      papeisVinculados++
    }
  }

  await processar("contratante", contratantes)
  await processar("requerente", requerentes)

  console.log(`   Pessoas canônicas criadas:  ${pessoasCriadas}`)
  console.log(`   Papéis vinculados:          ${papeisVinculados}`)
  console.log(`   Duplicatas resolvidas:      ${duplicatasResolvidas}`)
  console.log(`   Não reconciliados:          ${unresolved}`)
  if (unresolved !== 0) {
    throw new Error(`Backfill incompleto: ${unresolved} papéis sem chave de identidade.`)
  }
  console.log("✅ Backfill de identidade concluído (0 não reconciliados).")
}

main()
  .catch((e) => {
    console.error("❌ Erro no backfill de identidade:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
