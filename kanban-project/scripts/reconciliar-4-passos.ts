// scripts/reconciliar-4-passos.ts
// ============================================================================
// RECONCILIAÇÃO — CORREÇÃO FINAL (Emissão Documental, 4 passos operacionais).
//
// Depois que `unificar-conferir-validar.ts` + publicarWorkflow trocam o
// CADASTRO (conferir_certidao+validar_certidao → conferir_e_validar_certidao),
// as Tarefas ABERTAS que já tinham os 2 PhaseWorkflowStepInstance antigos
// materializados (criados no início, junto com os outros 3 — SEQUENCIAL
// cria todos os 5 de uma vez) continuam com a estrutura antiga até serem
// reconciliadas.
//
// ESCOPO SEGURO: só toca Tarefas cujos dois passos antigos (ordem 4 e 5)
// estão 100% NÃO INICIADOS (status PENDENTE ou DISPONIVEL, sem startedAt,
// sem nenhuma SubtaskExecution) — ou seja, nenhum fato foi registrado neles
// ainda. Nada além disso é elegível: Tarefas concluídas, canceladas, ou com
// qualquer um dos dois passos já iniciado ficam INTOCADAS e são listadas
// como "fora do escopo seguro" — não travam a reconciliação das outras.
//
// DRY-RUN por padrão: só relata o que faria. `--apply` escreve de verdade,
// numa transação por Tarefa (tudo ou nada).
//
// USO:
//   npx tsx scripts/reconciliar-4-passos.ts                 (dry-run, banco atual do .env)
//   npx tsx scripts/reconciliar-4-passos.ts --apply          (aplica de verdade)
// ============================================================================
import { prisma } from "@/lib/prisma"

interface Elegivel {
  tarefaId: number
  documentoId: number
  workflowInstanceId: number
  conferirId: number
  validarId: number
  conferirStatus: string
  tarefaApontaParaConferir: boolean
}
interface ForaDeEscopo {
  tarefaId: number | null
  documentoId: number
  motivo: string
}

export async function planejar(): Promise<{ elegiveis: Elegivel[]; foraDeEscopo: ForaDeEscopo[] }> {
  const unificadoDefs = await prisma.phaseInternalWorkflowStep.findMany({ where: { key: "conferir_e_validar_certidao" }, select: { id: true, workflowId: true, slaDays: true } })

  const elegiveis: Elegivel[] = []
  const foraDeEscopo: ForaDeEscopo[] = []

  // Passos VIVOS "conferir_certidao"/"validar_certidao" só continuam existindo se
  // a unificação AINDA NÃO rodou para aquele workflow — nada a reconciliar aqui.
  // O que precisamos encontrar são as INSTÂNCIAS já materializadas (criadas
  // ANTES da unificação, quando o cadastro vivo ainda tinha os 2 passos), que
  // continuam existindo mesmo depois do cadastro mudar (stepDefinitionId é
  // ponteiro frágil, não FK forte — não são apagadas pela unificação).
  const conferirInstancias = await prisma.phaseWorkflowStepInstance.findMany({
    where: { stepKey: "conferir_certidao" },
    select: {
      id: true, status: true, startedAt: true, completedAt: true, documentoId: true, workflowInstanceId: true,
      processoId: true, faseMacroKey: true, ciclo: true, necessidadeId: true, pessoaId: true, papel: true,
      dependeDeStepKeys: true, ordem: true,
    },
  })

  for (const c of conferirInstancias) {
    // PAREAMENTO POR documentoId — não só workflowInstanceId: várias Tarefas
    // (documentos distintos) podem compartilhar a MESMA PhaseWorkflowInstance,
    // então pareá-las só pela instância pegaria o validar_certidao ERRADO
    // (de outro documento). documentoId é a chave real de correspondência
    // 1:1 entre o conferir e o validar do MESMO documento.
    const v = await prisma.phaseWorkflowStepInstance.findFirst({
      where: { workflowInstanceId: c.workflowInstanceId, stepKey: "validar_certidao", documentoId: c.documentoId },
      select: { id: true, status: true, startedAt: true, completedAt: true },
    })
    if (!v) { foraDeEscopo.push({ tarefaId: null, documentoId: c.documentoId ?? -1, motivo: `instância ${c.workflowInstanceId}: conferir_certidao existe mas validar_certidao não foi encontrado` }); continue }

    const inst = await prisma.phaseWorkflowInstance.findUnique({ where: { id: c.workflowInstanceId }, select: { workflowDefinitionId: true } })
    const unifDoWorkflow = unificadoDefs.find((u) => u.workflowId === inst?.workflowDefinitionId)
    if (!unifDoWorkflow) { foraDeEscopo.push({ tarefaId: null, documentoId: c.documentoId ?? -1, motivo: `workflow ${inst?.workflowDefinitionId} ainda não foi unificado — rode unificar-conferir-validar.ts primeiro` }); continue }

    const naoIniciado = (s: { status: string; startedAt: Date | null; completedAt: Date | null }) =>
      ["PENDENTE", "DISPONIVEL"].includes(s.status) && s.startedAt == null && s.completedAt == null

    if (!naoIniciado(c) || !naoIniciado(v)) {
      foraDeEscopo.push({
        tarefaId: null, documentoId: c.documentoId ?? -1,
        motivo: `conferir(status=${c.status}) ou validar(status=${v.status}) já tem progresso registrado — fora do escopo seguro, requer decisão manual`,
      })
      continue
    }

    // SubtaskExecution não deveria existir (regra antiga era ACAO_DO_PASSO,
    // sem subtarefas) — checagem defensiva extra.
    const execExistente = await prisma.subtaskExecution.findFirst({ where: { stepInstanceId: { in: [c.id, v.id] } }, select: { id: true } })
    if (execExistente) {
      foraDeEscopo.push({ tarefaId: null, documentoId: c.documentoId ?? -1, motivo: `existe SubtaskExecution para ${c.id}/${v.id} — inesperado, requer investigação manual` })
      continue
    }

    const tarefa = await prisma.tarefa.findFirst({
      where: { documentoId: c.documentoId ?? undefined, workflowInstanceId: c.workflowInstanceId },
      select: { id: true, workflowStepInstanceId: true },
    })
    if (!tarefa) { foraDeEscopo.push({ tarefaId: null, documentoId: c.documentoId ?? -1, motivo: `nenhuma Tarefa encontrada para documentoId=${c.documentoId}` }); continue }

    elegiveis.push({
      tarefaId: tarefa.id,
      documentoId: c.documentoId!,
      workflowInstanceId: c.workflowInstanceId!,
      conferirId: c.id,
      validarId: v.id,
      conferirStatus: c.status,
      tarefaApontaParaConferir: tarefa.workflowStepInstanceId === c.id,
    })
  }

  return { elegiveis, foraDeEscopo }
}

export async function aplicar(e: Elegivel) {
  const c = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({
    where: { id: e.conferirId },
    select: { processoId: true, faseMacroKey: true, ciclo: true, necessidadeId: true, pessoaId: true, papel: true, slaDays: true, tipo: true, obrigatorio: true, geraTarefa: true },
  })
  const inst = await prisma.phaseWorkflowInstance.findUniqueOrThrow({ where: { id: e.workflowInstanceId }, select: { workflowDefinitionId: true, workflowVersion: true } })
  if (inst.workflowDefinitionId == null) throw new Error(`instância ${e.workflowInstanceId} sem workflowDefinitionId`)
  const unificado = await prisma.phaseInternalWorkflowStep.findFirstOrThrow({ where: { workflowId: inst.workflowDefinitionId, key: "conferir_e_validar_certidao" }, select: { id: true, slaDays: true } })

  // A INSTÂNCIA PRECISA APONTAR PARA A VERSÃO QUE REALMENTE CONTÉM O PASSO
  // UNIFICADO — sem isto, `definicaoHistoricaDoPasso` (que resolve pela
  // versão da INSTÂNCIA, não por passo) recusa qualquer ação no step novo
  // com SEM_CONFIGURACAO_HISTORICA, porque a versão antiga da instância não
  // conhece "conferir_e_validar_certidao". Os passos 1-3 (já concluídos)
  // não são afetados de fato: são a MESMA definição (chave, ações, campos)
  // na versão nova — só o passo 4/5 mudou nesta publicação.
  const versoes = await prisma.phaseInternalWorkflowVersao.findMany({
    where: { workflowId: inst.workflowDefinitionId },
    orderBy: { versao: "desc" },
    select: { versao: true, passos: true },
  })
  const versaoComUnificado = versoes.find((v) => Array.isArray(v.passos) && (v.passos as Array<{ key?: string }>).some((p) => p?.key === "conferir_e_validar_certidao"))
  if (!versaoComUnificado) throw new Error(`nenhuma versão publicada de workflow ${inst.workflowDefinitionId} contém "conferir_e_validar_certidao" — rode unificar-conferir-validar.ts + publicarWorkflow primeiro`)
  const novaVersao = versaoComUnificado.versao

  await prisma.$transaction(async (tx) => {
    const novo = await tx.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: e.workflowInstanceId, processoId: c.processoId, faseMacroKey: c.faseMacroKey, ciclo: c.ciclo,
        stepKey: "conferir_e_validar_certidao", ordem: 4, tipo: c.tipo, obrigatorio: c.obrigatorio, geraTarefa: c.geraTarefa,
        status: e.conferirStatus as never,
        necessidadeId: c.necessidadeId, documentoId: e.documentoId, pessoaId: c.pessoaId, papel: c.papel,
        slaDays: unificado.slaDays,
        dependeDeStepKeys: ["receber_certidao"] as never,
        stepDefinitionId: unificado.id, stepDefinitionVersion: novaVersao,
        chaveIdempotencia: `reconciliacao-4passos|doc${e.documentoId}|inst${e.workflowInstanceId}`,
      },
      select: { id: true },
    })
    await tx.phaseWorkflowInstance.update({ where: { id: e.workflowInstanceId }, data: { workflowVersion: novaVersao } })
    if (e.tarefaApontaParaConferir) {
      await tx.tarefa.update({ where: { id: e.tarefaId }, data: { workflowStepInstanceId: novo.id } })
    }
    await tx.phaseWorkflowStepInstance.delete({ where: { id: e.validarId } })
    await tx.phaseWorkflowStepInstance.delete({ where: { id: e.conferirId } })
    return novo
  })
}

async function main() {
  const apply = process.argv.includes("--apply")
  const { elegiveis, foraDeEscopo } = await planejar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`RECONCILIAÇÃO 4-PASSOS — ${apply ? "APLICANDO" : "DRY-RUN"}`)
  console.log("=".repeat(70))
  console.log(`\nElegíveis (${elegiveis.length}):`)
  for (const e of elegiveis) {
    console.log(`  Tarefa ${e.tarefaId} · documento ${e.documentoId} · instância ${e.workflowInstanceId} · status atual do conferir=${e.conferirStatus} · Tarefa aponta p/ conferir=${e.tarefaApontaParaConferir}`)
    console.log(`    → apagar step ${e.conferirId} (conferir_certidao) + ${e.validarId} (validar_certidao)`)
    console.log(`    → criar 1 step novo "conferir_e_validar_certidao" (ordem 4, status=${e.conferirStatus})`)
  }
  console.log(`\nFora do escopo seguro (${foraDeEscopo.length}) — INTOCADOS:`)
  for (const f of foraDeEscopo) console.log(`  documento ${f.documentoId}: ${f.motivo}`)

  if (!apply) {
    console.log("\n[dry-run] Nenhuma escrita foi feita. Rode com --apply para aplicar de verdade.")
    return
  }

  console.log("\nAplicando...")
  let ok = 0
  for (const e of elegiveis) {
    await aplicar(e)
    ok++
    console.log(`  ✅ Tarefa ${e.tarefaId} reconciliada`)
  }
  console.log(`\n${ok}/${elegiveis.length} Tarefas reconciliadas.`)
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
}
