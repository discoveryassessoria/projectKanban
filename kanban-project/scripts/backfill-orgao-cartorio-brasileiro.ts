// scripts/backfill-orgao-cartorio-brasileiro.ts
// ============================================================================
// BUG 3 (rodada de ajustes Operação v3, 26/09/2026) — usa a ponte
// (src/lib/cartorio-bridge.ts) pra resolver `Documento.orgaoId` dos
// documentos com cartório BRASILEIRO preenchido e órgão ainda faltando.
// NUNCA cria OrgaoProtocolo — só resolve o que já existe sob a identidade
// composta (nome + município/UF); cartório sem mapeamento fica documentado
// como gap real, não é erro deste script.
//
// --dry por padrão. --aplicar exige --prod + EU_CONFIRMO_ESCRITA_EM_PRODUCAO.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import { resolverOrgaoDoCartorio } from "@/src/lib/cartorio-bridge"

const APLICAR = process.argv.includes("--aplicar")
const PROD = process.argv.includes("--prod")

async function main() {
  const url = process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL ?? ""
  const id = identificador(url)
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`Banco: ${id} — classificado como ${classe}`)
  if (APLICAR) {
    if (classe === CLASSE.PRODUCAO && !PROD) { console.error("Banco é PRODUÇÃO mas --prod não foi passado."); process.exit(1) }
    if (PROD) {
      if (classe !== CLASSE.PRODUCAO) { console.error("--prod pedido mas o banco não é PRODUÇÃO."); process.exit(1) }
      if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO") { console.error("Falta EU_CONFIRMO_ESCRITA_EM_PRODUCAO."); process.exit(1) }
    }
  }

  // "Brasil" = pais_registro vazio/nulo (mesma convenção da tela e do route.ts).
  const alvos = await prisma.documento.findMany({
    where: { orgaoId: null, cartorio: { not: null }, pais_registro: null },
    select: { id: true, cartorio: true, cidade_registro: true, estado_registro: true, pais_registro: true, pessoa: { select: { nome: true } } },
  })
  console.log(`\n${alvos.length} documento(s) com cartório brasileiro sem orgaoId:`)
  let resolvidos = 0, gaps = 0
  for (const d of alvos) {
    if (!d.cartorio || !d.cidade_registro || !d.estado_registro) {
      console.log(`  documento ${d.id} (${d.pessoa?.nome}): faltam dados de cidade/estado pra resolver — skip`)
      continue
    }
    const uf = SIGLA_POR_ESTADO[d.estado_registro] ?? d.estado_registro
    const orgaoId = await resolverOrgaoDoCartorio({ nome: d.cartorio, municipio: d.cidade_registro, uf })
    if (orgaoId) {
      resolvidos++
      console.log(`  documento ${d.id} (${d.pessoa?.nome}): "${d.cartorio}" / ${d.cidade_registro}-${uf} → orgaoId ${orgaoId}${APLICAR ? "" : " [dry-run]"}`)
      if (APLICAR) await prisma.documento.update({ where: { id: d.id }, data: { orgaoId } })
    } else {
      gaps++
      console.log(`  documento ${d.id} (${d.pessoa?.nome}): "${d.cartorio}" / ${d.cidade_registro}-${uf} → SEM órgão mapeado (gap real, cadastre em Órgãos e Organizações)`)
    }
  }
  console.log(`\n${resolvidos} resolvido(s), ${gaps} gap(s) real(is) documentado(s).`)
  if (!APLICAR) console.log("\nRode com --aplicar (e --prod) para escrever de verdade.")
  await prisma.$disconnect()
}

// Conversão nome completo → sigla, só pros estados que aparecem nos dados
// (nunca uma tabela geográfica nova — a Base de Cartórios já trabalha com
// sigla, e o texto livre de registro grava o nome completo).
const SIGLA_POR_ESTADO: Record<string, string> = {
  "Rio Grande do Sul": "RS", "São Paulo": "SP", "Rio de Janeiro": "RJ", "Minas Gerais": "MG",
  "Bahia": "BA", "Paraná": "PR", "Santa Catarina": "SC", "Goiás": "GO", "Pernambuco": "PE",
  "Ceará": "CE", "Espírito Santo": "ES", "Distrito Federal": "DF",
}

main().catch((e) => { console.error(e); process.exit(1) })
