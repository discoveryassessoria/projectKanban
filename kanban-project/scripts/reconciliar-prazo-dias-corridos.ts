// scripts/reconciliar-prazo-dias-corridos.ts
// ============================================================================
// RECONCILIAÇÃO ÚNICA — corrige o prazo de Tarefas JÁ MATERIALIZADAS para a
// interpretação correta (dias CORRIDOS, decisão definitiva 23/09/2026),
// depois que `prazoOperacional` parou de pular fim de semana/feriado.
//
// NUNCA inventa uma nova data de início: recalcula `prazoOperacional(slaDays,
// Tarefa.createdAt)` com o MESMO slaDays e a MESMA origem (createdAt), só com
// a régua nova (corrida, não útil).
//
// SÓ TOCA uma Tarefa quando o valor gravado hoje bate com o que a régua
// ANTIGA (dias úteis) teria produzido a partir da mesma origem — a mesma
// trava de segurança que `reconciliarNovaVersaoNaInstanciaAtual` já usa para
// mudança de SLA: se o valor atual não bate com nenhuma conta conhecida
// (ex.: foi ajustado manualmente, ou não usa a régua canônica), a Tarefa é
// preservada e registrada como PENDENTE DE REVISÃO — nunca sobrescrita às
// cegas.
//
// Uso:
//   npx tsx scripts/reconciliar-prazo-dias-corridos.ts            (dry-run, só relatório)
//   npx tsx scripts/reconciliar-prazo-dias-corridos.ts --aplicar   (grava)
// ============================================================================
import { prisma } from "../lib/prisma"
import { prazoOperacional } from "../lib/operacional/tempo-operacional"
import { resolverConteudoDaBiblioteca } from "../src/services/versao-publicada"
import { isDiaUtil } from "../src/lib/diasUteis"

const APLICAR = process.argv.includes("--aplicar")

// A MESMA conta que `prazoOperacional` usava ANTES desta mudança (fim de
// semana E feriados nacionais, via `isDiaUtil` real) — só para reconhecer
// "este valor gravado veio da régua antiga", nunca para produzir um prazo
// novo.
function prazoDiasUteisAntigo(slaDays: number, inicio: Date): Date {
  const d = new Date(inicio.getTime())
  let restantes = slaDays
  while (restantes > 0) {
    d.setDate(d.getDate() + 1)
    if (isDiaUtil(d)) restantes--
  }
  return d
}

interface Linha {
  tarefaId: number
  slaDays: number
  createdAt: Date
  prazoGravado: Date
  prazoEsperadoAntigo: Date
  prazoNovo: Date
  bateComRegraAntiga: boolean
}

async function main() {
  console.log(`\n=== RECONCILIAÇÃO — prazo em dias corridos (${APLICAR ? "APLICANDO" : "DRY-RUN, só relatório"}) ===\n`)

  const tarefas = await prisma.tarefa.findMany({
    where: { concluida: false, dataPrazo: { not: null } },
    select: { id: true, titulo: true, dataPrazo: true, createdAt: true, workflowStepInstanceId: true },
  })
  console.log(`Tarefas não concluídas com prazo: ${tarefas.length}`)

  const siIds = [...new Set(tarefas.map((t) => t.workflowStepInstanceId).filter((x): x is number => x != null))]
  const sis = await prisma.phaseWorkflowStepInstance.findMany({
    where: { id: { in: siIds } }, select: { id: true, stepKey: true, stepDefinitionId: true },
  })
  const siPorId = new Map(sis.map((s) => [s.id, s]))
  const stepDefIds = [...new Set(sis.map((s) => s.stepDefinitionId).filter((x): x is number => x != null))]
  const stepDefs = await prisma.phaseInternalWorkflowStep.findMany({
    where: { id: { in: stepDefIds } },
    select: { id: true, slaDays: true, bibliotecaModeloId: true, bibliotecaModeloVersao: true },
  })
  const stepDefPorId = new Map(stepDefs.map((s) => [s.id, s]))

  const reconciliaveis: Linha[] = []
  const pendentesRevisao: { tarefaId: number; motivo: string }[] = []

  for (const t of tarefas) {
    if (!t.workflowStepInstanceId) { pendentesRevisao.push({ tarefaId: t.id, motivo: "sem workflowStepInstanceId — origem do prazo não determinável por esta reconciliação" }); continue }
    const si = siPorId.get(t.workflowStepInstanceId)
    if (!si?.stepDefinitionId) { pendentesRevisao.push({ tarefaId: t.id, motivo: "sem stepDefinitionId — passo cadastrado não encontrado" }); continue }
    const stepDef = stepDefPorId.get(si.stepDefinitionId)
    if (!stepDef) { pendentesRevisao.push({ tarefaId: t.id, motivo: "definição do passo não encontrada" }); continue }

    let slaDays: number | null = stepDef.slaDays
    if (stepDef.bibliotecaModeloId != null && stepDef.bibliotecaModeloVersao != null) {
      const conteudo = await resolverConteudoDaBiblioteca(stepDef.bibliotecaModeloId, stepDef.bibliotecaModeloVersao)
      slaDays = conteudo?.slaDays ?? null
    }
    if (!slaDays || slaDays <= 0) { pendentesRevisao.push({ tarefaId: t.id, motivo: "sem SLA resolvido (>0) no passo de origem" }); continue }

    const prazoGravado = new Date(t.dataPrazo!)
    const prazoEsperadoAntigo = prazoDiasUteisAntigo(slaDays, new Date(t.createdAt))
    const bate = Math.abs(prazoGravado.getTime() - prazoEsperadoAntigo.getTime()) < 1000
    const prazoNovo = prazoOperacional(slaDays, new Date(t.createdAt))!

    if (!bate) {
      pendentesRevisao.push({
        tarefaId: t.id,
        motivo: `o prazo gravado (${prazoGravado.toISOString()}) não bate com o que a régua antiga (dias úteis) produziria (${prazoEsperadoAntigo.toISOString()}) a partir do mesmo SLA/origem — pode já ter sido ajustado manualmente; preservado sem alteração`,
      })
      continue
    }

    reconciliaveis.push({ tarefaId: t.id, slaDays, createdAt: t.createdAt, prazoGravado, prazoEsperadoAntigo, prazoNovo, bateComRegraAntiga: bate })
  }

  console.log(`\nReconciliáveis (prazo gravado bate com a régua antiga, seguro recalcular): ${reconciliaveis.length}`)
  for (const l of reconciliaveis) {
    console.log(`  Tarefa ${l.tarefaId}: ${l.prazoGravado.toISOString().slice(0, 10)} → ${l.prazoNovo.toISOString().slice(0, 10)} (slaDays=${l.slaDays}, origem=${l.createdAt.toISOString().slice(0, 10)})`)
  }
  console.log(`\nPendentes de revisão (preservadas, NÃO tocadas por este script): ${pendentesRevisao.length}`)
  for (const p of pendentesRevisao) console.log(`  Tarefa ${p.tarefaId}: ${p.motivo}`)

  if (!APLICAR) {
    console.log("\n[dry-run] Nenhuma escrita realizada. Rode com --aplicar para gravar.")
    await prisma.$disconnect()
    return
  }

  let aplicadas = 0
  for (const l of reconciliaveis) {
    await prisma.tarefa.update({ where: { id: l.tarefaId }, data: { dataPrazo: l.prazoNovo } })
    await prisma.logAuditoria.create({
      data: {
        acao: "RECONCILIACAO_PRAZO_DIAS_CORRIDOS", entidade: "TAREFA", entidadeId: l.tarefaId,
        descricao: `Prazo recalculado de dias úteis para dias corridos (decisão definitiva 23/09/2026): ${l.prazoGravado.toISOString()} → ${l.prazoNovo.toISOString()}. Mesma origem (createdAt=${l.createdAt.toISOString()}), mesmo SLA (${l.slaDays} dias) — só a régua de contagem mudou.`,
        detalhes: { antes: l.prazoGravado.toISOString(), depois: l.prazoNovo.toISOString(), slaDays: l.slaDays, createdAt: l.createdAt.toISOString() } as never,
        usuarioId: null,
      },
    }).catch(() => null)
    aplicadas++
  }
  console.log(`\n[aplicado] ${aplicadas} Tarefa(s) recalculada(s).`)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
