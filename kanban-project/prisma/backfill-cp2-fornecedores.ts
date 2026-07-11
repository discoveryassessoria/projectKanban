// prisma/backfill-cp2-fornecedores.ts
// CP-2 — RELATÓRIO de deduplicação de Fornecedores. SOMENTE LEITURA.
//
// NÃO funde registros. NÃO escreve nada (idempotente e trivialmente reversível).
// Critérios seguros (aprovados):
//   - CPF/CNPJ normalizado idêntico  -> correspondência FORTE (candidato);
//   - identificador ausente/duvidoso -> unresolvedCount;
//   - mesmo nome sem id forte         -> revisão manual;
//   - dados bancários/país/contato divergentes -> NÃO fundir (conflito).
// Preserva todos os vínculos; produz relatório de conflitos e duplicidades.
//
// Rodar: npm run backfill:cp2:fornecedores   (exige env de banco)

import { PrismaClient } from "@prisma/client"
import { chaveFiscal } from "../src/services/fornecedor-helpers"
import { normalizarTexto } from "../src/services/identity"

const prisma = new PrismaClient()

async function main() {
  console.log("🔎 CP-2 relatório — deduplicação de Fornecedores (sem fundir)")

  const fs = await prisma.fornecedor.findMany({
    select: { id: true, nome: true, cpfCnpj: true, banco: true, conta: true, pais: true, email: true },
  })

  const porFiscal = new Map<string, typeof fs>()
  const porNome = new Map<string, number[]>()
  let unresolvedCount = 0

  for (const f of fs) {
    const cf = chaveFiscal(f.cpfCnpj)
    if (cf) {
      const arr = porFiscal.get(cf) ?? []
      arr.push(f)
      porFiscal.set(cf, arr)
    } else {
      unresolvedCount++
    }
    const kn = normalizarTexto(f.nome)
    if (kn) {
      const arr = porNome.get(kn) ?? []
      arr.push(f.id)
      porNome.set(kn, arr)
    }
  }

  const fortesDuplicados: { chave: string; ids: number[] }[] = []
  const conflitos: { chave: string; motivo: string; ids: number[] }[] = []
  for (const [cf, grupo] of porFiscal) {
    if (grupo.length < 2) continue
    fortesDuplicados.push({ chave: cf, ids: grupo.map((g) => g.id) })
    // divergências que impedem fusão automática
    const bancos = new Set(grupo.map((g) => g.banco ?? ""))
    const paises = new Set(grupo.map((g) => g.pais ?? ""))
    const emails = new Set(grupo.map((g) => g.email ?? ""))
    const motivos: string[] = []
    if (bancos.size > 1) motivos.push("banco divergente")
    if (paises.size > 1) motivos.push("país divergente")
    if (emails.size > 1) motivos.push("email divergente")
    if (motivos.length) conflitos.push({ chave: cf, motivo: motivos.join(", "), ids: grupo.map((g) => g.id) })
  }

  const revisaoManual: { nome: string; ids: number[] }[] = []
  for (const [kn, ids] of porNome) {
    if (ids.length < 2) continue
    // mesmo nome mas SEM chave fiscal forte comum -> revisão manual
    const semFiscalForte = ids.filter((id) => {
      const f = fs.find((x) => x.id === id)!
      return !chaveFiscal(f.cpfCnpj)
    })
    if (semFiscalForte.length >= 1) revisaoManual.push({ nome: kn, ids })
  }

  console.log(`   Fornecedores analisados:        ${fs.length}`)
  console.log(`   Duplicados fortes (CPF/CNPJ):   ${fortesDuplicados.length} grupo(s)`)
  console.log(`   Conflitos (não fundir):         ${conflitos.length}`)
  console.log(`   Revisão manual (mesmo nome):    ${revisaoManual.length}`)
  console.log(`   unresolvedCount (sem id forte): ${unresolvedCount}`)
  if (fortesDuplicados.length) console.log("   → fortes:", JSON.stringify(fortesDuplicados))
  if (conflitos.length) console.log("   → conflitos:", JSON.stringify(conflitos))
  if (revisaoManual.length) console.log("   → revisão:", JSON.stringify(revisaoManual))
  console.log("ℹ️ Relatório apenas. Nenhum registro foi fundido ou alterado.")
}

main()
  .catch((e) => {
    console.error("❌ Erro no relatório de fornecedores:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
