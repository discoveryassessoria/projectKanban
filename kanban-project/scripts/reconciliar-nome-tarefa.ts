// scripts/reconciliar-nome-tarefa.ts
// ============================================================================
// CORRIGE OS TÍTULOS QUE NASCERAM DA ETAPA, NÃO DO TRABALHO.
//
//   npx tsx scripts/reconciliar-nome-tarefa.ts            (dry-run)
//   npx tsx scripts/reconciliar-nome-tarefa.ts --execute
//
// Só toca em tarefas cujo título é IGUAL ao de uma das etapas do próprio
// workflow — a assinatura da regra defeituosa — e cuja unidade de trabalho tem
// mais de uma etapa. Um workflow de passo único legitimamente se chama pelo
// passo, e não entra aqui.
//
// NÃO toca em tarefa MANUAL: ali o título foi escolhido por uma pessoa, e
// "parece o nome de uma etapa" não é motivo para reescrever a decisão dela.
//
// Idempotente: rodar de novo não muda nada, porque o título corrigido deixa de
// casar com o nome da etapa.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { nomeDaTarefa, nomeVeioDaEtapa } from "@/lib/operacional/nome-da-tarefa"

const EXECUTAR = process.argv.includes("--execute")

async function main() {
  const tarefas = await prisma.tarefa.findMany({
    where: { workflowInstanceId: { not: null }, origem: { not: "MANUAL" } },
    select: {
      id: true, titulo: true, origem: true, pessoaId: true,
      necessidadeId: true, documentoId: true, workflowInstanceId: true,
    },
    orderBy: { id: "asc" },
  })

  console.log(`${EXECUTAR ? "EXECUÇÃO" : "DRY-RUN"} · ${tarefas.length} tarefa(s) automáticas analisadas\n`)
  let corrigidas = 0, intactas = 0

  for (const t of tarefas) {
    // As etapas da MESMA unidade de trabalho — não as da fase inteira.
    const etapas = await prisma.phaseWorkflowStepInstance.findMany({
      where: {
        workflowInstanceId: t.workflowInstanceId!,
        ...(t.necessidadeId != null
          ? { necessidadeId: t.necessidadeId }
          : t.documentoId != null
            ? { documentoId: t.documentoId }
            : { id: -1 }),
      },
      select: { stepKey: true, snapshot: true, ordem: true },
      orderBy: { ordem: "asc" },
    })
    const titulosDasEtapas = etapas.map((e) => {
      const s = e.snapshot as { titulo?: string; label?: string } | null
      return s?.titulo ?? s?.label ?? e.stepKey
    })

    if (!nomeVeioDaEtapa(t.titulo, titulosDasEtapas, etapas.length)) {
      intactas++
      continue
    }

    const necessidade = t.necessidadeId != null
      ? await prisma.necessidadeDocumental.findUnique({
          where: { id: t.necessidadeId },
          select: { pessoaId: true, itemCatalogo: { select: { name: true } } },
        })
      : null
    const documento = t.documentoId != null
      ? await prisma.documento.findUnique({
          where: { id: t.documentoId },
          select: { descricao: true, pessoaId: true, documentType: { select: { name: true } } },
        })
      : null
    const pessoaId = necessidade?.pessoaId ?? documento?.pessoaId ?? t.pessoaId ?? null
    const pessoa = pessoaId != null
      ? await prisma.pessoa.findUnique({ where: { id: pessoaId }, select: { nome: true, sobrenome: true } })
      : null

    const novo = nomeDaTarefa({
      itemDaNecessidade: necessidade?.itemCatalogo?.name ?? null,
      nomeDoDocumento: documento?.documentType?.name ?? documento?.descricao ?? null,
      pessoa: pessoa ? [pessoa.nome, pessoa.sobrenome].filter(Boolean).join(" ") : null,
      tituloDaEtapa: titulosDasEtapas[0] ?? null,
      etapasDaUnidade: etapas.length,
    })

    if (novo === t.titulo) { intactas++; continue }

    console.log(`  #${t.id}  "${t.titulo}"`)
    console.log(`      →  "${novo}"   (${etapas.length} etapas, origem ${t.origem})`)
    corrigidas++

    if (EXECUTAR) {
      // SÓ O TÍTULO. O taskId, o workflow, as etapas, o responsável e o prazo
      // seguem intactos — corrigir o nome não é criar outro trabalho.
      await prisma.tarefa.update({ where: { id: t.id }, data: { titulo: novo } })
      await prisma.logAuditoria.create({
        data: {
          acao: "TAREFA_TITULO_RECONCILIADO",
          entidade: "Tarefa",
          entidadeId: t.id,
          descricao: `Título corrigido de "${t.titulo}" para "${novo}" — o anterior era o nome de uma etapa do workflow.`,
          detalhes: { de: t.titulo, para: novo, etapas: etapas.length, origem: t.origem },
        },
      })
    }
  }

  console.log(`\n${corrigidas} a corrigir · ${intactas} já corretas`)
  if (!EXECUTAR && corrigidas > 0) console.log("Rode com --execute para aplicar.")
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
