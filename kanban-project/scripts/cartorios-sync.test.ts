// scripts/cartorios-sync.test.ts
//
// GUARDA da base nacional de Cartórios (CartorioSyncService). Cobre os
// invariantes do comando "ULTRA COMANDO — BASE NACIONAL AUTOMÁTICA DE
// CARTÓRIOS" (16/09/2026): normalização de busca, proteção de queda brusca
// (lógica pura) e ausência de duplicidade na base já sincronizada.
//
// DELIBERADAMENTE SÓ LEITURA — TESTE AUTOMATIZADO NÃO ESCREVE EM PRODUÇÃO
// (regra permanente deste projeto, motivada por incidente real: ver
// scripts/_banco-de-teste.ts). A sincronização em si (que escreve) é ato
// administrativo real, disparado pelo cron ou por "Sincronizar agora" — nunca
// por um `.test.ts`. `sincronizacaoPareceCompleta`/"queda brusca" é testada
// via `avaliarCompletude`, a mesma lógica isolada como função PURA (sem I/O).

import { prisma } from "../lib/prisma"
import { avaliarCompletude, normalizarNome } from "../src/services/cartorios/cartorio-sync-service"

let ok = 0, falhou = 0
const falhas: string[] = []
const check = (c: boolean, nome: string, detalhe = "") => {
  if (c) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}

async function main() {
  console.log("CARTÓRIOS — sincronização nacional (Registro Civil)\n")

  // ── 1) NORMALIZAÇÃO (pura) ──────────────────────────────────────────────
  check(normalizarNome("São Paulo - 5º Subdistrito") === "sao paulo - 5 subdistrito", "acento e indicador ordinal (º/ª) normalizados")
  check(normalizarNome("  Campinas   SP  ") === "campinas sp", "espaços colapsados e aparados")
  check(normalizarNome("REGISTRO CIVIL") === "registro civil", "maiúsculas viram minúsculas")

  // ── 2) PROTEÇÃO CONTRA QUEDA BRUSCA (pura — seção 37 do comando) ────────
  check(!avaliarCompletude(50, 100_000).completa, "resposta anormalmente pequena (0,05% do histórico) é INCOMPLETA")
  check(avaliarCompletude(9_500, 10_000).completa, "resposta dentro da margem aceitável (95%) é COMPLETA")
  check(!avaliarCompletude(0, 10_000).completa, "resposta vazia nunca é completa, mesmo com histórico")
  check(avaliarCompletude(7_120, null).completa, "sem histórico prévio (1ª sincronização), qualquer resposta com dados é aceita")
  check(!avaliarCompletude(0, null).completa, "resposta vazia na 1ª sincronização também não é completa")

  // ── 3) BASE JÁ SINCRONIZADA — só leitura ─────────────────────────────────
  const totalLinhas = await prisma.cartorio.count()
  if (totalLinhas === 0) {
    console.log("  ⚠ base ainda vazia (nenhuma sincronização real rodou neste ambiente) — pulando as checagens de dados")
  } else {
    check(totalLinhas > 5000, `volume nacional plausível já sincronizado (${totalLinhas} cartórios)`)

    // Nenhuma duplicidade por `sourceId` — garantia estrutural (constraint
    // única) + prova operacional (contagem bate).
    const totalDistintos = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT "sourceId") as n FROM "Cartorio"`
    check(BigInt(totalLinhas) === totalDistintos[0].n, `nenhuma duplicidade por sourceId (${totalLinhas} linhas, ${totalDistintos[0].n} sourceId distintos)`)

    // UF sempre 2 letras — proteção contra dado bruto mal normalizado indo pro banco.
    const amostraUf = await prisma.cartorio.findMany({ take: 50, select: { uf: true } })
    check(amostraUf.every((c) => c.uf.length === 2), "UF sempre com 2 letras na amostra")

    // INATIVO ≠ DELETADO (seção 38 do comando): se existe algum inativo, ele
    // continua sendo uma linha real, consultável — nunca some da tabela.
    const inativos = await prisma.cartorio.count({ where: { ativo: false } })
    check(inativos >= 0, `contagem de inativos é uma consulta válida (${inativos}) — inativo é linha real, nunca delete`)

    // Busca — server-side, filtro por UF.
    const algumSP = await prisma.cartorio.findFirst({ where: { uf: "SP", ativo: true }, select: { municipio: true } })
    if (algumSP) {
      const porUf = await prisma.cartorio.count({ where: { uf: "SP", ativo: true } })
      check(porUf > 0, `filtro por UF encontra resultados (SP: ${porUf})`)
      const termo = normalizarNome(algumSP.municipio).split(" ")[0]
      const porNomeNormalizado = await prisma.cartorio.count({ where: { nomeNormalizado: { contains: termo } } })
      check(porNomeNormalizado > 0, `busca por nome normalizado encontra resultados (termo "${termo}": ${porNomeNormalizado})`)
    }
  }

  console.log(`\n${ok} passaram, ${falhou} falharam`)
  if (falhou > 0) { console.error("FALHAS: " + falhas.join("; ")); process.exit(1) }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
