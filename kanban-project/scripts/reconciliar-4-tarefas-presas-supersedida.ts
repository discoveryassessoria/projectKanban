/**
 * RECONCILIAÇÃO PONTUAL — 4 Tarefas presas em SUPERSEDIDA (achadas na validação
 * pós-deploy de 19/09/2026: #3644, #3646, #3649, #3651), anteriores ao fix
 * `d5d604f8` (criadas 17/09, fix subiu 19/09 — não se autocuraram).
 *
 * Chama `reancorarTarefaNaUnidade` — a MESMA função já corrigida e testada
 * (23/23) — passando exatamente os ponteiros que a própria Tarefa já tem hoje
 * (workflowInstanceId/workflowStepInstanceId/chaveIdempotencia/faseMacroKey/
 * necessidadeId/documentoId/pessoaId). Não move a tarefa para lugar nenhum
 * novo: só corrige o status impossível (SUPERSEDIDA), preservando dataInicio/
 * responsavelId/histórico, exatamente como a função já garante.
 *
 * Escopo FECHADO: só estas 4. As outras 11 SUPERSEDIDA da auditoria têm irmã
 * viva — são legítimas, intocadas.
 *
 * `--aplicar` para escrever. Sem a flag, roda em modo leitura mostrando o que
 * faria.
 */
import { PrismaClient } from "@prisma/client"
import { reancorarTarefaNaUnidade } from "../lib/operacional/tarefa-canonica"
import { resolveDocumentOperationalProjection } from "../src/lib/process-stage/document-operational-projection"

const prisma = new PrismaClient()
const ALVOS = [3644, 3646, 3649, 3651]
const aplicar = process.argv.includes("--aplicar")

async function estadoAntes(tarefaId: number) {
  const t = await prisma.tarefa.findUniqueOrThrow({
    where: { id: tarefaId },
    select: {
      id: true, statusTarefa: true, workflowInstanceId: true, workflowStepInstanceId: true,
      faseMacroKey: true, chaveIdempotencia: true, necessidadeId: true, documentoId: true,
      pessoaId: true, dataInicio: true, responsavelId: true, lockVersion: true,
    },
  })
  if (t.workflowInstanceId == null || t.workflowStepInstanceId == null || t.chaveIdempotencia == null) {
    throw new Error(`Tarefa #${tarefaId}: ponteiros essenciais nulos — fora do escopo previsto, abortando`)
  }
  return t
}

async function projecao(documentoId: number | null) {
  if (documentoId == null) return "sem documentoId"
  try {
    const proj = await resolveDocumentOperationalProjection(documentoId)
    const t = (proj as unknown as { tarefa?: { taskId?: number; statusTarefa?: string; rotuloDoPrazo?: string } })?.tarefa
    return t ? `taskId=${t.taskId} status=${t.statusTarefa} rotulo="${t.rotuloDoPrazo}"` : "null (NENHUMA TAREFA CANÔNICA)"
  } catch (e) {
    return `ERRO: ${(e as Error).message}`
  }
}

async function main() {
  console.log(`Modo: ${aplicar ? "APLICAR (vai escrever)" : "SECO (só leitura)"}`)

  for (const tarefaId of ALVOS) {
    console.log(`\n── Tarefa #${tarefaId} ──`)
    const antes = await estadoAntes(tarefaId)
    console.log(`  ANTES: status=${antes.statusTarefa} wfInst=${antes.workflowInstanceId} stepInst=${antes.workflowStepInstanceId} chave=${antes.chaveIdempotencia} dataInicio=${antes.dataInicio?.toISOString() ?? null} responsavelId=${antes.responsavelId} lockVersion=${antes.lockVersion}`)
    console.log(`  ANTES: projeção canônica → ${await projecao(antes.documentoId)}`)

    const irmaAntes = await prisma.tarefa.findFirst({
      where: {
        id: { not: tarefaId }, documentoId: antes.documentoId,
        statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA"] as never },
      },
      select: { id: true },
    })
    if (irmaAntes) throw new Error(`Tarefa #${tarefaId}: já existe irmã viva (#${irmaAntes.id}) — não é uma das 4 presas, abortando por segurança`)

    if (!aplicar) {
      console.log("  (seco — nenhuma escrita)")
      continue
    }

    await prisma.$transaction(async (tx) => {
      await reancorarTarefaNaUnidade(tx, {
        tarefaId: antes.id,
        workflowInstanceId: antes.workflowInstanceId!,
        workflowStepInstanceId: antes.workflowStepInstanceId!,
        faseMacroKey: antes.faseMacroKey,
        chaveIdempotencia: antes.chaveIdempotencia!,
        necessidadeId: antes.necessidadeId,
        documentoId: antes.documentoId,
        pessoaId: antes.pessoaId,
        deInstanciaId: antes.workflowInstanceId,
        chaveAnterior: antes.chaveIdempotencia,
      })
    })

    const depois = await estadoAntes(tarefaId)
    console.log(`  DEPOIS: status=${depois.statusTarefa} wfInst=${depois.workflowInstanceId} stepInst=${depois.workflowStepInstanceId} chave=${depois.chaveIdempotencia} dataInicio=${depois.dataInicio?.toISOString() ?? null} responsavelId=${depois.responsavelId} lockVersion=${depois.lockVersion}`)
    console.log(`  DEPOIS: projeção canônica → ${await projecao(depois.documentoId)}`)

    const irmaDepois = await prisma.tarefa.findMany({
      where: { documentoId: antes.documentoId },
      select: { id: true, statusTarefa: true },
    })
    console.log(`  DEPOIS: todas as Tarefas deste documento (deve continuar sendo só 1, a mesma): ${irmaDepois.map(t => `#${t.id}[${t.statusTarefa}]`).join(", ")}`)
    if (irmaDepois.length !== 1) throw new Error(`Tarefa #${tarefaId}: pós-reconciliação existe mais de 1 Tarefa para o documento — DUPLICAÇÃO, investigar antes de seguir`)

    const pontosPreservados = depois.dataInicio?.getTime() === antes.dataInicio?.getTime() && depois.responsavelId === antes.responsavelId
    console.log(`  dataInicio/responsavelId preservados: ${pontosPreservados}`)
    if (!pontosPreservados) throw new Error(`Tarefa #${tarefaId}: dataInicio/responsavelId MUDOU — não deveria`)
  }

  console.log(`\nFIM. ${aplicar ? "Escrita aplicada às 4 tarefas alvo." : "Nenhuma escrita — rode com --aplicar."}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
