/**
 * AUDITORIA READ-ONLY — decompor os 27 registros físicos de Tarefa que a
 * validação pós-deploy contou como "vivos" e provar a identidade lógica real.
 * 100% leitura. Nenhuma escrita, nenhum efeito colateral.
 */
import { PrismaClient } from "@prisma/client"
import { normalizarUnidade, chaveDaUnidade, tarefasVivasDasUnidades, TERMINAIS_DA_UNIDADE } from "../lib/operacional/identidade-da-tarefa"
import { resolveDocumentOperationalProjection } from "../src/lib/process-stage/document-operational-projection"
import { minhaFila } from "../lib/operacional/tarefa-projecoes"

const prisma = new PrismaClient()

async function main() {
  // ── 1) O FILTRO EXATO usado na validação anterior para "vivas" ──────────
  console.log("═".repeat(78))
  console.log("1) DEFINIÇÃO TÉCNICA EXATA usada para contar 27")
  console.log("═".repeat(78))
  console.log(`
  Tabela: "Tarefa"
  WHERE: "statusTarefa" NOT IN ('CONCLUIDO_RECEBIDO','CONCLUIDO_NAO_POSSUI','CANCELADA')
  (= TERMINAIS_DA_UNIDADE, de lib/operacional/identidade-da-tarefa.ts)
  Sem JOIN. Sem filtro de ownership, fase, processo, versão ou execução.
  Sem DISTINCT sobre outra coisa que não Tarefa.id (SELECT COUNT(DISTINCT id)).

  Isso é a definição de "registro físico não-terminal" — NÃO é a definição de
  "tarefa lógica canônica". A definição lógica correta do motor é
  SELECIONAVEL_COMO_VIVA = TERMINAIS_DA_UNIDADE + ['SUPERSEDIDA'], usada por
  tarefasVivasDasUnidades()/tarefaVivaDaUnidade() — a ÚNICA porta que decide
  "qual é a tarefa canônica desta unidade" no motor. A contagem de 27 NÃO usou
  essa porta: usou o filtro mais simples, que inclui SUPERSEDIDA. Essa é a
  causa-raiz suspeita a confirmar abaixo com os dados reais.
  `)

  const rows = await prisma.tarefa.findMany({
    where: { statusTarefa: { notIn: [...TERMINAIS_DA_UNIDADE] as never } },
    select: {
      id: true, processoId: true, documentoId: true, necessidadeId: true, pessoaId: true,
      ciclo: true, chaveIdempotencia: true, statusTarefa: true, responsavelId: true,
      workflowInstanceId: true, workflowStepInstanceId: true, faseMacroKey: true,
      origem: true, tipo: true, titulo: true, createdAt: true, updatedAt: true,
      dataInicio: true, dataPrazo: true, motivoCodigo: true,
      responsavel: { select: { nome: true } },
    },
    orderBy: { id: "asc" },
  })

  console.log(`Total de registros físicos não-terminais agora: ${rows.length}`)

  // ── enriquecimento: workflow instance / step instance / versão ──────────
  const wfInstIds = [...new Set(rows.map((r) => r.workflowInstanceId).filter((x): x is number => x != null))]
  const wfInsts = await prisma.phaseWorkflowInstance.findMany({
    where: { id: { in: wfInstIds } },
    select: { id: true, status: true, workflowDefinitionId: true, workflowVersion: true, processoId: true },
  })
  const wfInstMap = new Map(wfInsts.map((w) => [w.id, w]))

  const stepInstIds = [...new Set(rows.map((r) => r.workflowStepInstanceId).filter((x): x is number => x != null))]
  const stepInsts = await prisma.phaseWorkflowStepInstance.findMany({
    where: { id: { in: stepInstIds } },
    select: { id: true, status: true, stepKey: true, workflowInstanceId: true },
  })
  const stepInstMap = new Map(stepInsts.map((s) => [s.id, s]))

  const processoIds = [...new Set(rows.map((r) => r.processoId).filter((x): x is number => x != null))]
  const processos = await prisma.processo.findMany({
    where: { id: { in: processoIds } },
    select: { id: true, nome: true, familiaId: true, familia: { select: { nome: true } } },
  })
  const processoMap = new Map(processos.map((p) => [p.id, p]))

  // subtask executions vigentes ligadas ao stepInstance
  const subtaskExecs = await prisma.subtaskExecution.findMany({
    where: { stepInstanceId: { in: stepInstIds } },
    select: { id: true, stepInstanceId: true, subtaskKey: true, status: true },
  })
  const subtaskByStep = new Map<number, typeof subtaskExecs>()
  for (const s of subtaskExecs) {
    const arr = subtaskByStep.get(s.stepInstanceId) ?? []
    arr.push(s)
    subtaskByStep.set(s.stepInstanceId, arr)
  }

  // ── unidade lógica RECALCULADA pelo código real (não a chave gravada) ────
  type Enriched = typeof rows[number] & {
    unidadeChaveReal: string
    processoNome: string | null
    familiaNome: string | null
    wfInstStatus: string | null
    wfVersaoUsada: number | null
    stepStatus: string | null
    stepKey: string | null
    subtareas: string
  }
  const enriched: Enriched[] = []
  for (const r of rows) {
    const unidade = await normalizarUnidade(prisma, {
      processoId: r.processoId!,
      necessidadeId: r.necessidadeId,
      documentoId: r.documentoId,
      pessoaId: r.pessoaId,
      ciclo: r.ciclo ?? 1,
    })
    const unidadeChaveReal = chaveDaUnidade(unidade)
    const wi = r.workflowInstanceId != null ? wfInstMap.get(r.workflowInstanceId) : undefined
    const si = r.workflowStepInstanceId != null ? stepInstMap.get(r.workflowStepInstanceId) : undefined
    const proc = r.processoId != null ? processoMap.get(r.processoId) : undefined
    const subs = r.workflowStepInstanceId != null ? (subtaskByStep.get(r.workflowStepInstanceId) ?? []) : []
    enriched.push({
      ...r,
      unidadeChaveReal,
      processoNome: proc?.nome ?? null,
      familiaNome: proc?.familia?.nome ?? null,
      wfInstStatus: wi?.status ?? null,
      wfVersaoUsada: wi?.workflowVersion ?? null,
      stepStatus: si?.status ?? null,
      stepKey: si?.stepKey ?? null,
      subtareas: subs.map((s) => `${s.subtaskKey}:${s.status}`).join(",") || "—",
    })
  }

  // ── 2) TABELA 1 — todos os registros físicos ─────────────────────────────
  console.log("\n" + "═".repeat(78))
  console.log("TABELA 1 — todos os registros físicos não-terminais")
  console.log("═".repeat(78))
  for (const r of enriched) {
    console.log(`
#${r.id} | proc=${r.processoId} (${r.processoNome ?? "?"}, família=${r.familiaNome ?? "—"}) | doc=${r.documentoId} nec=${r.necessidadeId} pessoa=${r.pessoaId} ciclo=${r.ciclo}
  chaveIdempotencia(gravada)="${r.chaveIdempotencia}"
  chave(recalculada)        ="${r.unidadeChaveReal}"  ${r.chaveIdempotencia !== r.unidadeChaveReal ? "⚠ DIFERE DA GRAVADA" : "(igual)"}
  statusTarefa=${r.statusTarefa} origem=${r.origem ?? "—"} tipo=${r.tipo ?? "—"} titulo="${r.titulo}"
  responsavel=${r.responsavelId ?? "—"} (${r.responsavel?.nome ?? "sem responsável"})
  createdAt=${r.createdAt.toISOString()} updatedAt=${r.updatedAt.toISOString()} dataInicio=${r.dataInicio?.toISOString() ?? null} dataPrazo=${r.dataPrazo?.toISOString() ?? null}
  workflowInstance=${r.workflowInstanceId}(status=${r.wfInstStatus ?? "?"}, versaoUsada=${r.wfVersaoUsada ?? "?"}) stepInstance=${r.workflowStepInstanceId}(status=${r.stepStatus ?? "?"}, key=${r.stepKey ?? "?"})
  subtarefas do step: ${r.subtareas}
  motivoCodigo=${r.motivoCodigo ?? "—"}`)
  }

  // ── 3) agrupar por unidade lógica RECALCULADA ────────────────────────────
  console.log("\n" + "═".repeat(78))
  console.log("TABELA 2 — agrupado por unidade lógica recalculada")
  console.log("═".repeat(78))
  const grupos = new Map<string, Enriched[]>()
  for (const r of enriched) {
    const arr = grupos.get(r.unidadeChaveReal) ?? []
    arr.push(r)
    grupos.set(r.unidadeChaveReal, arr)
  }
  console.log(`Unidades lógicas distintas entre os ${rows.length} registros físicos: ${grupos.size}`)

  // canônica real segundo tarefasVivasDasUnidades (SELECIONAVEL_COMO_VIVA).
  // CRÍTICO: precisa passar pela MESMA normalizarUnidade usada para computar
  // r.unidadeChaveReal acima — senão a chave interna calculada por
  // tarefasVivasDasUnidades (a partir da unidade CRUA) diverge da chave usada
  // para agrupar aqui, e o cruzamento erra sistematicamente (bug já achado e
  // corrigido nesta própria rodada de auditoria, não é bug de produção).
  const todasUnidadesCruas = [...grupos.keys()].map((k) => {
    const amostra = grupos.get(k)!.find((m) => m.necessidadeId != null || m.pessoaId != null) ?? grupos.get(k)![0]
    return { processoId: amostra.processoId!, necessidadeId: amostra.necessidadeId, documentoId: amostra.documentoId, pessoaId: amostra.pessoaId, ciclo: amostra.ciclo ?? 1 }
  })
  const todasUnidades = []
  for (const u of todasUnidadesCruas) todasUnidades.push(await normalizarUnidade(prisma, u))
  const vivasCanonicas = await tarefasVivasDasUnidades(prisma, todasUnidades)

  let unidadesComExcedente = 0
  let excedentesTotal = 0
  const classificacao: { tarefaId: number; classe: string; motivo: string }[] = []

  for (const [chave, membros] of grupos) {
    const canonica = vivasCanonicas.get(chave)
    console.log(`\nUNIDADE ${chave} — ${membros.length} registro(s) físico(s)`)
    if (membros.length > 1) { unidadesComExcedente++; excedentesTotal += membros.length - 1 }
    for (const m of membros) {
      const ehCanonica = canonica?.id === m.id
      let classe = ""
      let motivo = ""
      if (ehCanonica) {
        classe = "CANÔNICA"
        motivo = "selecionada por tarefasVivasDasUnidades (SELECIONAVEL_COMO_VIVA)"
      } else if (m.statusTarefa === "SUPERSEDIDA" && canonica) {
        classe = "A) histórico SUPERSEDIDA legítimo"
        motivo = `irmã canônica viva é #${canonica.id} (${canonica.statusTarefa})`
      } else if (m.statusTarefa === "SUPERSEDIDA" && !canonica) {
        classe = "B) SUPERSEDIDA presa sem irmã canônica"
        motivo = "nenhuma outra tarefa da unidade é selecionável como viva"
      } else if (!canonica) {
        classe = "F) órfã / motivo a investigar"
        motivo = "não-SUPERSEDIDA mas também não é a canônica — nenhuma canônica encontrada para a unidade"
      } else {
        classe = "C) possível duplicação de materialização"
        motivo = `existe outra Tarefa não-SUPERSEDIDA (#${canonica.id}) considerada canônica pela mesma unidade`
      }
      if (!ehCanonica) classificacao.push({ tarefaId: m.id, classe, motivo })
      console.log(`  #${m.id} status=${m.statusTarefa} ${ehCanonica ? "→ CANÔNICA" : `→ ${classe} (${motivo})`}`)
    }
  }

  // ── 4) cruzamento com SUPERSEDIDA (15 originais) ─────────────────────────
  console.log("\n" + "═".repeat(78))
  console.log("6) CRUZAMENTO COM SUPERSEDIDA")
  console.log("═".repeat(78))
  const todasSupersedidasAgora = enriched.filter((r) => r.statusTarefa === "SUPERSEDIDA")
  console.log(`SUPERSEDIDA dentro dos ${rows.length} físicos analisados: ${todasSupersedidasAgora.length} — IDs: ${todasSupersedidasAgora.map((r) => r.id).join(", ")}`)
  console.log(`(as 4 reconciliadas #3644/#3646/#3649/#3651 já não aparecem aqui como SUPERSEDIDA — status foi restaurado para NAO_INICIADA antes desta auditoria)`)

  // ── 5) minhaFila — antes/depois da projeção ──────────────────────────────
  console.log("\n" + "═".repeat(78))
  console.log("12) MINHA OPERAÇÃO — minhaFila() por responsável real")
  console.log("═".repeat(78))
  const responsaveis = [...new Set(rows.map((r) => r.responsavelId).filter((x): x is number => x != null))]
  const taskIdsNaFila = new Set<number>()
  for (const uid of responsaveis) {
    const fila = await minhaFila(uid)
    for (const l of fila) taskIdsNaFila.add(l.taskId)
    console.log(`  responsável ${uid}: ${fila.length} linha(s) → taskIds: ${fila.map((l) => l.taskId).join(", ") || "—"}`)
  }
  console.log(`Total de Tarefa.id distintos que aparecem em alguma Minha Operação: ${taskIdsNaFila.size}`)
  const físicasSemResponsavel = rows.filter((r) => r.responsavelId == null).length
  console.log(`Físicas sem responsável (não entram em nenhuma minhaFila): ${físicasSemResponsavel}`)

  // ── 6) Central Operacional — por unidade ─────────────────────────────────
  console.log("\n" + "═".repeat(78))
  console.log("13) CENTRAL OPERACIONAL — resolveDocumentOperationalProjection por documento")
  console.log("═".repeat(78))
  const docIds = [...new Set(rows.map((r) => r.documentoId).filter((x): x is number => x != null))]
  for (const docId of docIds) {
    const rowsDoDoc = enriched.filter((r) => r.documentoId === docId)
    let proj
    try {
      const p = await resolveDocumentOperationalProjection(docId)
      proj = (p as unknown as { tarefa?: { taskId?: number; statusTarefa?: string } })?.tarefa ?? null
    } catch (e) {
      proj = `ERRO: ${(e as Error).message}`
    }
    console.log(`  doc ${docId}: físicas=[${rowsDoDoc.map((r) => `#${r.id}(${r.statusTarefa})`).join(", ")}] → projeção Central: ${proj === null ? "null" : JSON.stringify(proj)}`)
  }

  // ── RESUMO FINAL ──────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(78))
  console.log("RESUMO")
  console.log("═".repeat(78))
  const totalFisicoGeral = await prisma.tarefa.count()
  console.log(`A) Registros físicos totais na tabela Tarefa (qualquer status): ${totalFisicoGeral}`)
  console.log(`B) Registros físicos não-terminais (filtro usado nos "27"): ${rows.length}`)
  console.log(`C) Unidades lógicas canônicas abertas (agrupado por chave recalculada): ${grupos.size}`)
  console.log(`   Unidades com >1 registro físico: ${unidadesComExcedente} | registros excedentes somados: ${excedentesTotal}`)
  console.log(`D) Tarefa.id distintos que aparecem em alguma Minha Operação real: ${taskIdsNaFila.size}`)
  console.log(`\nClassificação dos ${classificacao.length} registros não-canônicos:`)
  const porClasse = new Map<string, number>()
  for (const c of classificacao) porClasse.set(c.classe, (porClasse.get(c.classe) ?? 0) + 1)
  for (const [classe, n] of porClasse) console.log(`  ${classe}: ${n}`)
  for (const c of classificacao) console.log(`    #${c.tarefaId} → ${c.classe} (${c.motivo})`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
