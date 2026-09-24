// scripts/migrar-traducao-apostilamento-para-canonico.ts
// ============================================================================
// VIRA A CHAVE: `CatalogoFase.conduzidaPeloWorkflowInterno = true` para
// "traducao_juramentada" e "apostilamento" — mandato 24/09/2026.
//
// Pré-condições já confirmadas por leitura (não repetidas aqui, mas o script
// reconfirma antes de escrever):
//   - Biblioteca "traducao_juramentada" (modelo id 6) e "apostilamento" (id 7)
//     PUBLICADAS e vinculadas aos passos reais (bibliotecaModeloVersao bate
//     com a versão publicada).
//   - A versão CONGELADA do Workflow Interno real resolve as 4 subtarefas
//     (preparar_documentos → enviar_documentos → receber_documentos [espera
//     externa] → conferir_validar_documentos) — motorVigenteDaFase vai
//     calcular passosComCadastro > 0 assim que este flag virar true.
//
// Depois desta escrita, `recusarSeCanonicoAssumiu` passa a recusar as rotas
// bespoke antigas (.../traducao/etapas, .../apostilamento/etapas) — que já
// eram as únicas sobreviventes (a tela e a rota GET foram removidas do
// código nesta mesma mudança).
//
// USO:
//   npx tsx scripts/migrar-traducao-apostilamento-para-canonico.ts                 → dry-run
//   npx tsx scripts/migrar-traducao-apostilamento-para-canonico.ts --aplicar --prod → exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO
// ============================================================================
import { prisma } from "../lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import { motorVigenteDaFase } from "../src/services/motor-da-fase"

const APLICAR = process.argv.includes("--aplicar")
const ALVO_PROD = process.argv.includes("--prod")
const FASES = ["traducao_juramentada", "apostilamento"] as const

async function main() {
  const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`[migrar-canonico] alvo ${identificador(url)} classificado como ${classe}`)
  if (APLICAR && ALVO_PROD) {
    if (classe !== CLASSE.PRODUCAO) { console.error("[migrar-canonico] RECUSADO: --prod passado mas alvo não é PRODUCAO."); process.exit(1) }
    if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO") { console.error("[migrar-canonico] RECUSADO: exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO."); process.exit(1) }
  }

  for (const fase of FASES) {
    const antes = await motorVigenteDaFase(fase)
    console.log(`\n[${fase}] motor ANTES:`, JSON.stringify(antes))
    if (antes.canonico) { console.log(`  já é canônico — nada a fazer.`); continue }

    if (!APLICAR) {
      console.log(`  DRY-RUN — marcaria conduzidaPeloWorkflowInterno=true.`)
      continue
    }

    await prisma.catalogoFase.updateMany({ where: { phaseKey: fase }, data: { conduzidaPeloWorkflowInterno: true } })
    const depois = await motorVigenteDaFase(fase)
    console.log(`  motor DEPOIS:`, JSON.stringify(depois))
    if (!depois.canonico) {
      console.error(`  ⚠️  ATENÇÃO: mesmo após marcar o flag, motorVigenteDaFase ainda não considera canônico. Investigar antes de prosseguir.`)
      process.exit(1)
    }
  }
}
main().finally(() => prisma.$disconnect())
