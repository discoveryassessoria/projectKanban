// scripts/corrigir-escopo-catalogo-fases.ts
// ============================================================================
// CORREÇÃO DE ESCOPO das 4 fases canônicas (mandato "Catálogo de Fases",
// correção 20/09/2026 — entrega isolada só ao Catálogo): retificacao_registros,
// emissao_documental_retificada, traducao_juramentada, apostilamento.
//
// Chama a MESMA função que a rota `PUT /api/gerenciamento/catalogo-fases/[id]`
// usa (`publicarRevisaoCatalogoFase` + `enqueueReconciliacaoCatalogoFase`) —
// não uma segunda lógica. É o operador de linha de comando para o que a tela
// faria, provado ponta a ponta em scripts/catalogo-fases-gerenciamento-completo.test.ts.
//
// USO:
//   npx tsx scripts/corrigir-escopo-catalogo-fases.ts                 → dry-run (só relatório)
//   npx tsx scripts/corrigir-escopo-catalogo-fases.ts --aplicar        → aplica no banco do PRISMA_DATABASE_URL atual
//   npx tsx scripts/corrigir-escopo-catalogo-fases.ts --aplicar --prod → exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'
// ============================================================================
import { prisma } from "../lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import { publicarRevisaoCatalogoFase } from "../src/lib/motor/catalogo-fase-revisao"
import { enqueueReconciliacaoCatalogoFase } from "../src/lib/motor/reconciliar-fase-macro"
import { processarOutbox } from "../src/services/outbox-dispatcher"

const APLICAR = process.argv.includes("--aplicar")
const ALVO_PROD = process.argv.includes("--prod")
const FASES_ALVO = ["retificacao_registros", "emissao_documental_retificada", "traducao_juramentada", "apostilamento"] as const

async function verificarAlvoSeguro() {
  const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`[corrigir-escopo] alvo ${identificador(url)} classificado como ${classe} (tabelas=${retrato.tabelas}, requerentes=${retrato.requerentes})`)
  if (APLICAR && ALVO_PROD) {
    if (classe !== CLASSE.PRODUCAO) { console.error(`[corrigir-escopo] RECUSADO: --prod passado mas alvo não é PRODUCAO (classe=${classe}).`); process.exit(1) }
    if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO") { console.error(`[corrigir-escopo] RECUSADO: --prod exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'.`); process.exit(1) }
  }
  if (APLICAR && !ALVO_PROD && classe === CLASSE.PRODUCAO) { console.error(`[corrigir-escopo] RECUSADO: alvo é PRODUCAO mas --prod não foi passado.`); process.exit(1) }
}

async function main() {
  await verificarAlvoSeguro()
  console.log(`[corrigir-escopo] modo: ${APLICAR ? "APLICAR" : "DRY-RUN (nada será escrito)"}`)

  const resultado: Array<Record<string, unknown>> = []
  for (const phaseKey of FASES_ALVO) {
    const atual = await prisma.catalogoFase.findUnique({ where: { phaseKey } })
    if (!atual) { resultado.push({ phaseKey, erro: "CatalogoFase não encontrada" }); continue }

    const usos = await prisma.faseMacro.count({ where: { phaseKey } })
    const linha: Record<string, unknown> = {
      phaseKey, escopoAntes: atual.escopo, usos, revisaoAntes: atual.revisaoAtual,
      backup: { id: atual.id, phaseKey: atual.phaseKey, escopo: atual.escopo, revisaoAtual: atual.revisaoAtual, label: atual.label, status: atual.status },
    }

    if (atual.escopo === "DOCUMENTO") { linha.acao = "JA_CORRIGIDO"; resultado.push(linha); continue }

    if (!APLICAR) { linha.acao = "PREVISTO"; resultado.push(linha); continue }

    const { fase, revisaoNova } = await prisma.$transaction((tx) =>
      publicarRevisaoCatalogoFase(tx, atual, { ...atual, escopo: "DOCUMENTO" }, null),
    )
    const reconciliacao = await enqueueReconciliacaoCatalogoFase({
      phaseKey, catalogoFaseId: fase.id, revisaoAnterior: atual.revisaoAtual, revisaoNova, escopoMudou: true, publicadoPorId: null,
    })
    await prisma.logAuditoria.create({
      data: {
        acao: "PHASE_UPDATED", entidade: "CatalogoFase", entidadeId: fase.id,
        descricao: `Fase "${fase.label}" (${phaseKey}): escopo PROCESSO→DOCUMENTO (correção 20/09/2026, mandato "Catálogo de Fases" — entrega isolada). Revisão ${atual.revisaoAtual}→${revisaoNova}.`,
        detalhes: { antes: atual, depois: fase, revisao: revisaoNova, reconciliacao } as never,
      },
    }).catch(() => null)
    linha.acao = "CORRIGIDO"
    linha.revisaoNova = revisaoNova
    linha.reconciliacao = reconciliacao
    resultado.push(linha)
  }

  console.log(JSON.stringify(resultado, null, 2))

  if (APLICAR) {
    console.log("\n[corrigir-escopo] drenando reconciliação (1ª execução)…")
    const r1 = await processarOutbox({ tipos: ["catalogo.fase.reconciliar"], forcar: true })
    console.log(JSON.stringify(r1, null, 2))
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect() })
