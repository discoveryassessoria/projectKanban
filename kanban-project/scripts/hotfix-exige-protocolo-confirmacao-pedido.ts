// scripts/hotfix-exige-protocolo-confirmacao-pedido.ts
// ============================================================================
// BUG 2 (rodada de ajustes Operação v3, 26/09/2026) — liga
// `exigeProtocolo=true` em "receber_confirmacao_pedido" (StepSubtaskDefinition
// #130, Biblioteca de Tarefas "Solicitar certidão"). Sem isto, o cadastro
// não pede protocolo nenhum — `concluirSubtarefaCorrentePeloPasso`
// (subtarefas-da-etapa.ts) só recusa concluir sem protocolo quando a
// subtarefa está marcada assim.
//
// --dry por padrão. --aplicar exige --prod + EU_CONFIRMO_ESCRITA_EM_PRODUCAO.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"

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
  const antes = await prisma.stepSubtaskDefinition.findUnique({ where: { id: 130 }, select: { id: true, key: true, exigeProtocolo: true } })
  if (!antes || antes.key !== "receber_confirmacao_pedido") { console.error(`Estado inesperado: ${JSON.stringify(antes)}`); process.exit(1) }
  console.log("antes:", JSON.stringify(antes))
  if (!APLICAR) { console.log("[dry-run] exigeProtocolo: false → true"); await prisma.$disconnect(); return }
  await prisma.stepSubtaskDefinition.update({ where: { id: 130 }, data: { exigeProtocolo: true } })
  const depois = await prisma.stepSubtaskDefinition.findUnique({ where: { id: 130 }, select: { id: true, key: true, exigeProtocolo: true } })
  console.log("depois:", JSON.stringify(depois))
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
