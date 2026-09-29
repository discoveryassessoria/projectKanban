// scripts/backfill-tarefa-orgao-id.ts
// ============================================================================
// TORRE DE CONTROLE, BLOCO C (29/09/2026) — vincula as Tarefas EXISTENTES ao
// OrgaoProtocolo que já aguardam, agora que `Tarefa.orgaoId` existe.
//
// DUAS FONTES, nesta ordem:
//   1. `Documento.orgaoId` já resolvido — cópia direta de FK, sem ambiguidade.
//   2. `Documento.cartorio` (texto livre) sem `orgaoId` — casa por NOME
//      normalizado contra `OrgaoProtocolo` (`chaveDeNome`/`similaridade`,
//      `src/services/organizacao-identidade.ts` — o mesmo motor que o
//      cadastro de Órgãos já usa pra evitar duplicidade). SÓ aplica quando
//      há candidato inequívoco (score alto e sem segundo candidato próximo);
//      o resto fica listado como gap real, nunca um chute.
//
// Tarefas sem `documentoId` nenhum ficam de fora — nada a vincular ainda
// (fora do escopo deste backfill; a porta operacional segue existindo para
// vincular na hora, quando fizer sentido).
//
// --dry por padrão (mostra a lista completa, escreve nada). --aplicar exige
// --prod + EU_CONFIRMO_ESCRITA_EM_PRODUCAO, mesma trava de
// backfill-orgao-cartorio-brasileiro.ts.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import { chaveDeNome, similaridade } from "@/src/services/organizacao-identidade"

const APLICAR = process.argv.includes("--aplicar")
const PROD = process.argv.includes("--prod")
// Abaixo disto, a diferença entre "cartório X" e um nome parecido de verdade
// não é confiável o suficiente pra gravar sozinho — vira gap listado.
const LIMIAR_SCORE = 0.5
// A distância mínima entre o 1º e o 2º candidato pra considerar "sem ambiguidade".
const LIMIAR_MARGEM = 0.15

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

  const orgaos = await prisma.orgaoProtocolo.findMany({ select: { id: true, name: true, nomeFantasia: true } })

  const tarefas = await prisma.tarefa.findMany({
    where: { orgaoId: null, documentoId: { not: null } },
    select: { id: true, titulo: true, documento: { select: { id: true, orgaoId: true, cartorio: true } } },
  })

  console.log(`\n${tarefas.length} tarefa(s) com documento e sem orgaoId vinculado.\n`)

  // ── 1) CÓPIA DIRETA — Documento.orgaoId já resolvido ──────────────────────
  const diretas = tarefas.filter((t) => t.documento?.orgaoId != null)
  console.log(`── 1) Cópia direta (Documento.orgaoId já resolvido): ${diretas.length}`)
  for (const t of diretas) {
    console.log(`  tarefa ${t.id} (${t.titulo}): documento ${t.documento!.id} → orgaoId ${t.documento!.orgaoId}${APLICAR ? "" : " [dry-run]"}`)
    if (APLICAR) await prisma.tarefa.update({ where: { id: t.id }, data: { orgaoId: t.documento!.orgaoId } })
  }

  // ── 2) CASAR POR NOME — Documento.cartorio livre, sem orgaoId ─────────────
  const porNome = tarefas.filter((t) => t.documento?.orgaoId == null && t.documento?.cartorio?.trim())
  const nomesDistintos = [...new Set(porNome.map((t) => t.documento!.cartorio!.trim()))]
  console.log(`\n── 2) Casar por nome (Documento.cartorio sem orgaoId): ${porNome.length} tarefa(s), ${nomesDistintos.length} nome(s) distinto(s)`)

  const orgaoIdPorNomeTexto = new Map<string, number | null>()
  for (const nomeTexto of nomesDistintos) {
    const candidatos = orgaos
      .map((o) => ({ o, score: Math.max(similaridade(nomeTexto, o.name), o.nomeFantasia ? similaridade(nomeTexto, o.nomeFantasia) : 0) }))
      .sort((a, b) => b.score - a.score)
    const [melhor, segundo] = candidatos
    const margem = melhor ? melhor.score - (segundo?.score ?? 0) : 0
    const inequivoco = melhor && melhor.score >= LIMIAR_SCORE && margem >= LIMIAR_MARGEM
    console.log(`\n  "${nomeTexto}" (chave: "${chaveDeNome(nomeTexto)}")`)
    for (const c of candidatos.slice(0, 3)) {
      console.log(`    candidato: ${c.o.name}${c.o.nomeFantasia ? ` (${c.o.nomeFantasia})` : ""} #${c.o.id} — score ${c.score.toFixed(2)}`)
    }
    if (inequivoco) {
      console.log(`    → MATCH: orgaoId ${melhor!.o.id} (score ${melhor!.score.toFixed(2)}, margem ${margem.toFixed(2)})`)
      orgaoIdPorNomeTexto.set(nomeTexto, melhor!.o.id)
    } else {
      console.log(`    → SEM MATCH CONFIÁVEL (gap real — cadastre/ajuste em Órgãos e Organizações, ou vincule manualmente)`)
      orgaoIdPorNomeTexto.set(nomeTexto, null)
    }
  }
  for (const t of porNome) {
    const nomeTexto = t.documento!.cartorio!.trim()
    const orgaoId = orgaoIdPorNomeTexto.get(nomeTexto) ?? null
    if (orgaoId == null) continue
    console.log(`  tarefa ${t.id} (${t.titulo}): "${nomeTexto}" → orgaoId ${orgaoId}${APLICAR ? "" : " [dry-run]"}`)
    if (APLICAR) await prisma.tarefa.update({ where: { id: t.id }, data: { orgaoId } })
  }

  // ── 3) SEM NADA PRA CASAR ──────────────────────────────────────────────────
  const semNada = tarefas.filter((t) => t.documento?.orgaoId == null && !t.documento?.cartorio?.trim())
  console.log(`\n── 3) Sem orgaoId nem cartório de texto: ${semNada.length} (ficam null — nada a vincular ainda)`)
  for (const t of semNada) console.log(`  tarefa ${t.id} (${t.titulo}): documento ${t.documento!.id}, nada pra casar`)

  const porNomeVinculadas = porNome.filter((t) => orgaoIdPorNomeTexto.get(t.documento!.cartorio!.trim()) != null).length
  const porNomeGaps = porNome.length - porNomeVinculadas
  console.log(`\n${diretas.length + porNomeVinculadas} vinculada(s) no total, ${semNada.length + porNomeGaps} gap(s) real(is).`)
  if (!APLICAR) console.log("\nRode com --aplicar (e --prod) para escrever de verdade.")
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
