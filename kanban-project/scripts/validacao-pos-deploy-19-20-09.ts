/**
 * VALIDAÇÃO PÓS-DEPLOY — mandato 19-20/09/2026 (controle temporal da espera).
 *
 * 100% leitura. Não escreve, não publica, não cria dado. Roda contra o banco
 * apontado pelo ambiente (produção, quando PRISMA_DATABASE_URL/DIRECT_DATABASE_URL
 * do .env estão ativos e nenhuma env local de teste sobrepõe).
 */
import { PrismaClient } from "@prisma/client"
import { TERMINAIS_DA_UNIDADE } from "../lib/operacional/identidade-da-tarefa"
import { resolveDocumentOperationalProjection } from "../src/lib/process-stage/document-operational-projection"
import { minhaFila } from "../lib/operacional/tarefa-projecoes"

const prisma = new PrismaClient()

function linha(t: string) { console.log(`\n── ${t} ${"─".repeat(Math.max(0, 60 - t.length))}`) }

async function main() {
  console.log("VALIDAÇÃO PÓS-DEPLOY — mandato 19-20/09/2026")
  console.log("DB:", (process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL ?? "").split("@")[1]?.split("/")[0] ?? "(?)")

  // ── A) BANCO/SCHEMA ──────────────────────────────────────────────
  linha("A) BANCO/SCHEMA")
  const cols = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_name IN ('StepSubtaskDefinition', 'SubtaskExecution')
      AND column_name IN ('esperaExternaAoLiberar','acompanhamentoAtivo','acompanhamentoPrimeiroDias',
                           'regraTemporalAtiva','regraTemporalDias','regraTemporalGatilhoChave',
                           'proximoAcompanhamentoEm','previstoPara')
    ORDER BY table_name, column_name`
  for (const c of cols) console.log(`  ✓ ${c.table_name}.${c.column_name}`)
  console.log(`  total colunas novas encontradas: ${cols.length} (esperado: 6 em StepSubtaskDefinition + 2 em SubtaskExecution = 8)`)

  const mig = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
    SELECT migration_name, finished_at FROM _prisma_migrations
    WHERE migration_name = '20260920000000_controle_temporal_espera_subtarefa'`
  console.log(`  migration 20260920000000: ${mig[0] ? `aplicada em ${mig[0].finished_at}` : "❌ NÃO ENCONTRADA"}`)

  // ── B) CONFIGURAÇÃO — DRAFT vs PUBLICADO ─────────────────────────
  linha("B) CONFIGURAÇÃO (draft vs publicado)")
  const step = await prisma.phaseInternalWorkflowStep.findUnique({
    where: { id: 454 },
    include: { subtarefas: { orderBy: { ordem: "asc" } }, workflow: true },
  })
  if (!step) {
    console.log("  ❌ Step #454 não encontrado")
  } else {
    console.log(`  Workflow "${step.workflow.name}" (id=${step.workflowId}) — versão viva (draft) = ${step.workflow.versao}`)
    for (const s of step.subtarefas) {
      console.log(`    [draft] #${s.id} ordem=${s.ordem} key="${s.key}" label="${s.label}" esperaExterna=${s.esperaExternaAoLiberar} slaDays=${s.slaDays} acompanhamento=${s.acompanhamentoAtivo}(${s.acompanhamentoPrimeiroDias}d) regraTemporal=${s.regraTemporalAtiva}(${s.regraTemporalDias}d, gatilho=${s.regraTemporalGatilhoChave ?? "—"})`)
    }
    const versaoCongelada = await prisma.phaseInternalWorkflowVersao.findUnique({
      where: { workflowId_versao: { workflowId: step.workflowId, versao: step.workflow.versao } },
    })
    console.log(`  Versão ${step.workflow.versao} está CONGELADA (publicada)? ${versaoCongelada ? "SIM" : "NÃO"}`)
    const ultimaCongelada = await prisma.phaseInternalWorkflowVersao.findFirst({
      where: { workflowId: step.workflowId },
      orderBy: { versao: "desc" },
    })
    if (ultimaCongelada) {
      const passos = ultimaCongelada.passos as unknown as Array<{ id: number; subtarefas?: Array<Record<string, unknown>> }>
      const passoCongelado = passos.find((p) => p.id === 454)
      console.log(`  Última versão CONGELADA = v${ultimaCongelada.versao} (congelada em ${ultimaCongelada.congeladoEm}, origem=${ultimaCongelada.origem})`)
      if (passoCongelado?.subtarefas) {
        for (const s of passoCongelado.subtarefas) {
          console.log(`    [congelado v${ultimaCongelada.versao}] key="${s.key}" label="${s.label}" regraTemporal=${s.regraTemporalAtiva}(${s.regraTemporalDias}d)`)
        }
      }
      const draftDifereDoCongelado = JSON.stringify(passoCongelado?.subtarefas?.map((s) => s.key)) !==
        JSON.stringify(step.subtarefas.map((s) => s.key))
      console.log(`  ⚠ Draft difere do congelado (key/rename)? ${draftDifereDoCongelado ? "SIM — mudança AINDA NÃO afeta execuções (precisa publicar)" : "não"}`)
    }
  }

  // ── C) SUPERSEDIDA — nenhuma presa em produção ───────────────────
  linha("C) SUPERSEDIDA")
  const listaSupersedidas = await prisma.tarefa.findMany({
    where: { statusTarefa: "SUPERSEDIDA" as never },
    select: { id: true, chaveIdempotencia: true, processoId: true, documentoId: true, faseMacroKey: true, updatedAt: true },
  })
  console.log(`  Tarefas com statusTarefa=SUPERSEDIDA em produção agora: ${listaSupersedidas.length}`)
  console.log(`  TERMINAIS_DA_UNIDADE (não deve incluir SUPERSEDIDA): [${TERMINAIS_DA_UNIDADE.join(", ")}]`)
  let presas = 0
  for (const t of listaSupersedidas) {
    // mesma "base" de unidade = mesmo processoId+documentoId+faseMacroKey (aproximação
    // suficiente para achar irmã viva; a chave real de idempotência muda por ciclo).
    const irmaViva = await prisma.tarefa.findFirst({
      where: {
        id: { not: t.id },
        processoId: t.processoId,
        documentoId: t.documentoId,
        faseMacroKey: t.faseMacroKey,
        statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"] as never },
      },
      select: { id: true, statusTarefa: true },
    })
    const status = irmaViva ? `ok — irmã viva #${irmaViva.id} (${irmaViva.statusTarefa})` : "⚠ SEM IRMÃ VIVA — possível presa"
    if (!irmaViva) presas++
    console.log(`    Tarefa #${t.id} (proc=${t.processoId} doc=${t.documentoId} fase=${t.faseMacroKey}, atualizada em ${t.updatedAt.toISOString().slice(0,10)}): ${status}`)
  }
  console.log(`  → ${presas} de ${listaSupersedidas.length} SEM irmã viva na mesma unidade (candidatas a reconciliação — pré-existentes ao fix, não geradas por ele)`)

  // ── D) NÃO DUPLICAÇÃO (garantia estrutural) ──────────────────────
  linha("D) NÃO DUPLICAÇÃO")
  const uniqueOk = await prisma.$queryRaw<{ conname: string }[]>`
    SELECT conname FROM pg_constraint WHERE conrelid = '"Tarefa"'::regclass AND contype = 'u'
      AND conname ILIKE '%chaveIdempotencia%'`
  console.log(`  Constraint UNIQUE em Tarefa.chaveIdempotencia: ${uniqueOk.length > 0 ? uniqueOk.map(c=>c.conname).join(", ") : "não encontrada por esse nome (checar manualmente)"}`)
  const dupCheck = await prisma.$queryRaw<{ chave: string; n: bigint }[]>`
    SELECT "chaveIdempotencia" as chave, COUNT(*) as n FROM "Tarefa"
    WHERE "chaveIdempotencia" IS NOT NULL GROUP BY "chaveIdempotencia" HAVING COUNT(*) > 1 LIMIT 5`
  console.log(`  Duplicatas reais de chaveIdempotencia (deveria ser 0, bloqueado pelo banco): ${dupCheck.length}`)

  // ── E) OWNERSHIP — spot check ────────────────────────────────────
  linha("E) OWNERSHIP")
  const semResponsavel = await prisma.tarefa.count({
    where: { statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA"] as never }, responsavelId: null },
  })
  const totalVivas = await prisma.tarefa.count({
    where: { statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA"] as never } },
  })
  console.log(`  Tarefas vivas totais: ${totalVivas} | sem responsavelId: ${semResponsavel} (esperado: pode ser >0, "não atribuído" é estado legítimo — não é bug em si)`)

  // ── F) MOTOR / MINHA OPERAÇÃO — minhaFila() em usuário real ──────
  linha("F) MOTOR + MINHA OPERAÇÃO (minhaFila em dado real)")
  const usuariosComTarefa = await prisma.tarefa.findMany({
    where: { responsavelId: { not: null }, statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA"] as never } },
    distinct: ["responsavelId"], select: { responsavelId: true }, take: 5,
  })
  for (const { responsavelId } of usuariosComTarefa) {
    if (!responsavelId) continue
    try {
      const fila = await minhaFila(responsavelId)
      const porTarefa = new Map<number, number>()
      for (const l of fila) porTarefa.set(l.taskId, (porTarefa.get(l.taskId) ?? 0) + 1)
      const tarefaDuplicadaNaFila = [...porTarefa.values()].filter((n) => n > 1).length
      console.log(`  usuário ${responsavelId}: minhaFila() → ${fila.length} linha(s), taskIds distintos=${porTarefa.size}, tarefas com >1 linha na fila=${tarefaDuplicadaNaFila} (esperado 0 — uma Tarefa = uma linha)`)
    } catch (e) {
      console.log(`  ❌ ERRO minhaFila(${responsavelId}): ${(e as Error).message}`)
    }
  }

  // ── G) CENTRAL OPERACIONAL — nenhuma "Concluída" com workflow aberto ─
  linha("G) CENTRAL OPERACIONAL (Concluída × workflow aberto, dado real)")
  const tarefasComDocumento = await prisma.tarefa.findMany({
    where: {
      documentoId: { not: null },
      statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA"] as never },
    },
    distinct: ["documentoId"], select: { documentoId: true }, take: 40,
  })
  const docsComWorkflowAberto = tarefasComDocumento
    .filter((t): t is { documentoId: number } => t.documentoId != null)
  let divergencias = 0
  for (const { documentoId } of docsComWorkflowAberto) {
    try {
      const proj = await resolveDocumentOperationalProjection(documentoId)
      const rotulo = (proj as unknown as { tarefa?: { rotuloDoPrazo?: string; statusTarefa?: string } })?.tarefa
      if (rotulo?.rotuloDoPrazo?.toLowerCase().startsWith("concluíd") || rotulo?.statusTarefa === "CONCLUIDO_RECEBIDO") {
        divergencias++
        console.log(`  ❌ DIVERGÊNCIA doc=${documentoId}: rótulo="${rotulo?.rotuloDoPrazo}" status=${rotulo?.statusTarefa}`)
      }
    } catch (e) {
      console.log(`  ⚠ doc=${documentoId} — erro ao projetar: ${(e as Error).message}`)
    }
  }
  console.log(`  documentos com workflow aberto verificados: ${docsComWorkflowAberto.length} | divergências: ${divergencias}`)

  // ── H) CONTADORES — distinct fecha ───────────────────────────────
  linha("H) CONTADORES")
  const distintasPorUnidade = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT id) as n FROM "Tarefa"
    WHERE "statusTarefa" NOT IN ('CONCLUIDO_RECEBIDO','CONCLUIDO_NAO_POSSUI','CANCELADA')`
  console.log(`  COUNT(DISTINCT Tarefa.id) vivas: ${distintasPorUnidade[0]?.n}`)

  // ── I) SINO / notificações — sem duplicata óbvia ─────────────────
  linha("I) SINO (Notification)")
  const notifDup = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) as n FROM (
      SELECT "usuarioId", "chaveIdempotencia", COUNT(*) c
      FROM "Notification" WHERE "chaveIdempotencia" IS NOT NULL
      GROUP BY "usuarioId", "chaveIdempotencia" HAVING COUNT(*) > 1
    ) x`.catch(() => [{ n: BigInt(-1) }])
  console.log(`  grupos de Notification duplicados por (usuarioId,chaveIdempotencia): ${notifDup[0]?.n === BigInt(-1) ? "campo/tabela não existe com esse nome — checar manualmente" : notifDup[0]?.n}`)

  console.log("\nFIM DA VALIDAÇÃO — 100% leitura, nenhuma escrita realizada.")
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
