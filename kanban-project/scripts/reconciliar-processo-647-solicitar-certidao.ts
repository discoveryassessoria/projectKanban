// scripts/reconciliar-processo-647-solicitar-certidao.ts
// ============================================================================
// RE-TENTATIVA pontual: após o fix de reconciliação (executorKey não é mais
// conflito — mandato 23/09/2026, "fase atual/futura recebe mudança segura"),
// chama de novo a MESMA porta real (`reconciliarNovaVersaoNaInstanciaAtual`)
// para o único processo real que ficou bloqueado por CONFLITO_DADOS_EXISTENTES
// (LogAuditoria id 10328) antes do fix. O outbox original já foi consumido
// (status ENVIADO) — não dispara sozinho de novo, por isso esta chamada manual.
//
// USO:
//   npx tsx scripts/reconciliar-processo-647-solicitar-certidao.ts                 → dry-run (só relatório, roda a função e não fecha)
//   npx tsx scripts/reconciliar-processo-647-solicitar-certidao.ts --aplicar --prod → só relata (a função já é o "aplicar" — dry-run = mesma chamada em ambiente não-prod)
// ============================================================================
import { prisma } from "../lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import { reconciliarNovaVersaoNaInstanciaAtual } from "../src/services/phase-workflow"

const APLICAR = process.argv.includes("--aplicar")
const ALVO_PROD = process.argv.includes("--prod")
const PROCESSO_ID = 647
const FASE_KEY = "emissao_documental"

async function main() {
  const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`[reconciliar-647] alvo ${identificador(url)} classificado como ${classe}`)
  if (APLICAR && ALVO_PROD) {
    if (classe !== CLASSE.PRODUCAO) { console.error("[reconciliar-647] RECUSADO: --prod passado mas alvo não é PRODUCAO."); process.exit(1) }
    if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO") { console.error("[reconciliar-647] RECUSADO: exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO."); process.exit(1) }
  }
  if (!APLICAR) {
    console.log("[reconciliar-647] DRY-RUN não é seguro para esta função (ela mesma decide aplicar ou não, com base em conflito real) — rode com --aplicar --prod diretamente; ela só ESCREVE se não houver conflito.")
    return
  }

  const antes = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId: PROCESSO_ID, faseMacroKey: FASE_KEY, status: { in: ["ATIVO", "BLOQUEADO", "AGUARDANDO"] } },
    orderBy: { ciclo: "desc" }, select: { id: true, workflowVersion: true },
  })
  console.log("[reconciliar-647] instância ANTES:", JSON.stringify(antes))

  const r = await reconciliarNovaVersaoNaInstanciaAtual({ processoId: PROCESSO_ID, faseMacroKey: FASE_KEY })
  console.log("[reconciliar-647] resultado:", JSON.stringify(r, null, 2))

  const depois = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId: PROCESSO_ID, faseMacroKey: FASE_KEY, status: { in: ["ATIVO", "BLOQUEADO", "AGUARDANDO"] } },
    orderBy: { ciclo: "desc" }, select: { id: true, workflowVersion: true },
  })
  console.log("[reconciliar-647] instância DEPOIS:", JSON.stringify(depois))
}

main().finally(() => prisma.$disconnect())
