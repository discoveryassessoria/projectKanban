// scripts/hotfix-familia-e-acompanhamento-cibils.ts
// ============================================================================
// DOIS AJUSTES PONTUAIS — família Cibils (26/09/2026), depois do hotfix da
// régua de 4 passos:
//
// 1. Processo 651 (Cibils) não tem `familiaId` — nunca existiu NENHUMA
//    `Familia` cadastrada no sistema (achado: `Familia.count() === 0`).
//    Cria a Familia "Cibils" (só o nome) e vincula `Processo.familiaId`.
//
// 2. As 16 `SubtaskExecution` de `enviar_requerimento_cartorio` (realinhadas
//    por `realinhar-emissao-4-passos.ts`) ficaram com `proximoAcompanhamentoEm:
//    null` — não porque a régua "2 dias corridos" não esteja cadastrada (ESTÁ:
//    `PhaseInternalWorkflowStep#570, diasParaIniciar: 2`, workflow 12 em
//    versão 20), mas porque essas 16 instâncias estão ancoradas na
//    `workflowVersion: 18` — publicada ANTES de `diasParaIniciar` ter passado
//    a ser gravado no snapshot congelado (`versao-publicada.ts:419`). O
//    snapshot de v18 simplesmente não carrega o campo; `materializarSubtarefas`
//    não tinha o que ler. O catálogo vivo está certo — só essas 16 instâncias
//    herdaram um snapshot anterior à mudança (mesma classe do prazo antigo).
//
//    Backfill pontual, usando o valor VIVO (2) só porque é o mesmo valor que
//    JÁ estava cadastrado quando essas tarefas foram atribuídas — não é uma
//    segunda fonte de verdade, é a mesma conta que `materializarSubtarefas`
//    teria feito se o snapshot de v18 tivesse o campo.
//
// --dry por padrão. --aplicar exige --prod + EU_CONFIRMO_ESCRITA_EM_PRODUCAO.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import { prazoOperacional } from "@/lib/operacional/tempo-operacional"

const APLICAR = process.argv.includes("--aplicar")
const PROD = process.argv.includes("--prod")
const DIAS_PARA_INICIAR = 2

async function main() {
  const url = process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL ?? ""
  const id = identificador(url)
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`Banco: ${id} — classificado como ${classe}`)

  if (APLICAR) {
    if (classe === CLASSE.PRODUCAO && !PROD) {
      console.error("Banco classifica como PRODUÇÃO mas --prod não foi passado. Abortando.")
      process.exit(1)
    }
    if (PROD) {
      if (classe !== CLASSE.PRODUCAO) {
        console.error("--prod pedido mas o banco não classifica como PRODUÇÃO. Abortando.")
        process.exit(1)
      }
      if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO") {
        console.error("Falta EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'. Abortando.")
        process.exit(1)
      }
    }
  }

  // ── 1. Família ────────────────────────────────────────────────────────
  console.log("\n=== 1. Família ===")
  const processo = await prisma.processo.findUnique({ where: { id: 651 }, select: { id: true, nome: true, familiaId: true, familia: { select: { nome: true } } } })
  if (!processo) { console.error("Processo 651 não encontrado."); process.exit(1) }
  console.log(`Processo 651 (${processo.nome}) — familiaId ANTES: ${processo.familiaId} (${processo.familia?.nome ?? "nenhuma"})`)

  let familiaExistente = await prisma.familia.findFirst({ where: { nome: "Cibils" } })
  if (!familiaExistente) {
    console.log(APLICAR ? "Criando Familia 'Cibils'..." : "[dry-run] criaria Familia 'Cibils'")
    if (APLICAR) familiaExistente = await prisma.familia.create({ data: { nome: "Cibils" } })
  } else {
    console.log(`Familia 'Cibils' já existe (id=${familiaExistente.id}) — reaproveitando.`)
  }

  if (APLICAR && familiaExistente) {
    await prisma.processo.update({ where: { id: 651 }, data: { familiaId: familiaExistente.id } })
    const depois = await prisma.processo.findUnique({ where: { id: 651 }, select: { familiaId: true, familia: { select: { nome: true } } } })
    console.log(`Processo 651 — familiaId DEPOIS: ${depois?.familiaId} (${depois?.familia?.nome})`)
  } else if (!APLICAR) {
    console.log(`[dry-run] vincularia Processo 651 à Familia '${familiaExistente?.nome ?? "Cibils (nova)"}'`)
  }

  // ── 2. Acompanhamento "a iniciar" das 16 subtarefas de entrada ─────────
  console.log("\n=== 2. Acompanhamento (proximoAcompanhamentoEm) ===")
  const stepInstances = await prisma.phaseWorkflowStepInstance.findMany({
    where: { faseMacroKey: "emissao_documental" },
    select: { id: true },
    orderBy: { id: "asc" },
  })
  let alvos = 0
  for (const si of stepInstances) {
    const exec = await prisma.subtaskExecution.findFirst({
      where: { stepInstanceId: si.id, subtaskKey: "enviar_requerimento_cartorio", supersededAt: null },
      select: { id: true, proximoAcompanhamentoEm: true, status: true },
    })
    if (!exec || exec.proximoAcompanhamentoEm != null) continue
    const tarefa = await prisma.tarefa.findFirst({ where: { workflowStepInstanceId: si.id }, select: { dataAtribuicao: true, createdAt: true } })
    const base = tarefa?.dataAtribuicao ?? tarefa?.createdAt ?? new Date()
    const novo = prazoOperacional(DIAS_PARA_INICIAR, base)
    alvos++
    if (!APLICAR) {
      console.log(`  [dry-run] stepInstance ${si.id}, execução ${exec.id}: proximoAcompanhamentoEm null → ${novo?.toISOString()} (base ${base.toISOString()} + ${DIAS_PARA_INICIAR}d)`)
    } else {
      await prisma.subtaskExecution.update({ where: { id: exec.id }, data: { proximoAcompanhamentoEm: novo } })
      console.log(`  stepInstance ${si.id}, execução ${exec.id}: proximoAcompanhamentoEm → ${novo?.toISOString()}`)
    }
  }
  console.log(`\n${alvos} execução(ões) ${APLICAR ? "atualizadas" : "mudariam"}.`)
  if (!APLICAR) console.log("\nRode com --aplicar (e --prod, se for o caso) para escrever de verdade.")

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
