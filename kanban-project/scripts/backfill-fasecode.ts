// scripts/backfill-fasecode.ts
//
// Preenche o faseCode das colunas (Status) de TODOS os países onde ainda está vazio.
// Faz pelo NOME da coluna, então cobre Alemanha, Portugal, Itália e Espanha de uma vez.
// SEGURO: só mexe em colunas com faseCode vazio; não cria, não apaga, não sobrescreve.
//
// RODAR: npx tsx scripts/backfill-fasecode.ts

import { PrismaClient, type FaseCode } from "@prisma/client"

const prisma = new PrismaClient()

// nome da coluna (normalizado: minúsculo, sem acento) → faseCode
const MAPA: Record<string, FaseCode> = {
  "genealogia": "GENEALOGIA",
  "busca documental": "GENEALOGIA",
  "emissao documental": "EMISSAO_DOCUMENTAL",
  "emissao de documentos": "EMISSAO_DOCUMENTAL",
  "analise documental": "ANALISE_DOCUMENTAL",
  "retificacao de registros": "RETIFICACAO_REGISTROS",
  "retificacao judicial": "RETIFICACAO_REGISTROS",
  "retificacao": "RETIFICACAO_REGISTROS",
  "emissao documental retificada": "EMISSAO_DOCUMENTAL_RETIFICADA",
  "traducao juramentada": "TRADUCAO_JURAMENTADA",
  "traducao": "TRADUCAO_JURAMENTADA",
  "apostilamento": "APOSTILAMENTO",
  "aguardando protocolo": "AGUARDANDO_PROTOCOLO",
  "protocolado": "PROTOCOLADO",
  "finalizado": "FINALIZADO",
  "emissao de documental": "EMISSAO_DOCUMENTAL",
}

// tira acento e deixa minúsculo, pra bater o nome mesmo com variação de escrita
function normaliza(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase()
}

async function main() {
  console.log("Backfill faseCode — todos os países\n")

  const semFase = await prisma.status.findMany({
    where: { faseCode: null },
    orderBy: [{ pais: "asc" }, { ordem: "asc" }],
  })

  if (semFase.length === 0) {
    console.log("Nenhuma coluna sem faseCode. Nada a fazer.")
    return
  }

  let preenchidas = 0
  const naoReconhecidas: string[] = []

  for (const s of semFase) {
    const code = MAPA[normaliza(s.nome)]
    if (!code) {
      naoReconhecidas.push(`[${s.id}] ${s.pais} · "${s.nome}"`)
      continue
    }
    await prisma.status.update({ where: { id: s.id }, data: { faseCode: code } })
    console.log(`  ✓ [${s.id}] ${s.pais} · "${s.nome}" → ${code}`)
    preenchidas++
  }

  console.log(`\nPreenchidas: ${preenchidas}`)
  if (naoReconhecidas.length > 0) {
    console.log(`\n⚠ Não reconheci o nome destas ${naoReconhecidas.length} coluna(s) (ficaram vazias):`)
    naoReconhecidas.forEach((x) => console.log("   " + x))
    console.log('Se for "Concluído", pode ignorar (não é uma fase). Qualquer outro nome, me manda.')
  }
}

main()
  .catch((e) => { console.error("Erro no backfill:", e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })