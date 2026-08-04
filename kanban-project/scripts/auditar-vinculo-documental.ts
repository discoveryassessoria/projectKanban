// scripts/auditar-vinculo-documental.ts
//
// AUDITORIA DO VÍNCULO DOCUMENTAL — só lê, nunca escreve.
//
// Classifica cada passo e cada tarefa em três estados:
//   ÍNTEGRO      — tem documentoId; nada a fazer.
//   REPARÁVEL    — o documento é DEDUZÍVEL por relação existente (o passo tem
//                  necessidade, ou a tarefa tem passo com documento). Reparo
//                  determinístico, sem escolha.
//   AMBÍGUO      — não há de onde deduzir. NÃO É REPARADO. Vincular exigiria
//                  escolher um documento, e escolher é inventar.
//
// Por que auditar em vez de consertar: os cinco passos de "Emissão Documental" do
// processo 505 perderam `documentoId` por `ON DELETE SET NULL` quando o documento
// foi excluído junto com a pessoa. O documento não existe mais — não há vínculo
// correto a restabelecer, só um que pareceria certo.
//
// Rodar: npx tsx scripts/auditar-vinculo-documental.ts
//        npx tsx scripts/auditar-vinculo-documental.ts --json

import { prisma } from "@/lib/prisma"

const JSON_OUT = process.argv.includes("--json")

interface Achado {
  entidade: "StepInstance" | "Tarefa"
  id: number
  descricao: string
  processoId: number | null
  estado: "INTEGRO" | "REPARAVEL" | "AMBIGUO"
  motivo: string
  documentoIdAtual: number | null
  documentoIdDeduzido: number | null
}

async function main() {
  const [fp] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("select current_database() as db")
  const achados: Achado[] = []

  // ── Passos de workflow que DECLAROU exigir documento ─────────────────────
  const passos = await prisma.phaseWorkflowStepInstance.findMany({
    where: {
      workflowInstance: { is: {} },
    },
    select: {
      id: true, stepKey: true, status: true, processoId: true, ciclo: true,
      documentoId: true, necessidadeId: true, pessoaId: true, faseMacroKey: true,
      workflowInstance: { select: { workflowDefinitionId: true } },
    },
    orderBy: { id: "asc" },
  })

  const defIds = [...new Set(passos.map((p) => p.workflowInstance?.workflowDefinitionId).filter((v): v is number => v != null))]
  const defs = await prisma.phaseInternalWorkflow.findMany({
    where: { id: { in: defIds } },
    select: { id: true, exigeDocumento: true, escopoExecucao: true },
  })
  const exigePorDef = new Map(defs.map((d) => [d.id, d.exigeDocumento]))

  for (const p of passos) {
    const defId = p.workflowInstance?.workflowDefinitionId ?? null
    const documental = defId != null && exigePorDef.get(defId) === true
    if (!documental) continue

    if (p.documentoId != null) {
      achados.push({ entidade: "StepInstance", id: p.id, descricao: `${p.stepKey} (${p.status})`,
        processoId: p.processoId, estado: "INTEGRO", motivo: "já vinculado",
        documentoIdAtual: p.documentoId, documentoIdDeduzido: null })
      continue
    }
    // Deduzível só por NECESSIDADE: é a única relação que aponta para um
    // documento sem que alguém escolha qual.
    let deduzido: number | null = null
    if (p.necessidadeId != null) {
      const doc = await prisma.documento.findFirst({
        where: { necessidadeId: p.necessidadeId }, select: { id: true }, orderBy: { id: "asc" },
      })
      deduzido = doc?.id ?? null
    }
    achados.push({
      entidade: "StepInstance", id: p.id, descricao: `${p.stepKey} (${p.status}) ciclo ${p.ciclo}`,
      processoId: p.processoId,
      estado: deduzido != null ? "REPARAVEL" : "AMBIGUO",
      motivo: deduzido != null
        ? `documento ${deduzido} deduzido pela necessidade ${p.necessidadeId}`
        : p.necessidadeId != null
          ? `tem necessidade ${p.necessidadeId}, mas nenhum Documento aponta para ela`
          : "sem necessidade e sem documento — nada de onde deduzir",
      documentoIdAtual: null, documentoIdDeduzido: deduzido,
    })
  }

  // ── Tarefas ───────────────────────────────────────────────────────────────
  const tarefas = await prisma.tarefa.findMany({
    select: {
      id: true, titulo: true, processoId: true, documentoId: true,
      workflowStepInstanceId: true, faseMacroKey: true,
      workflowStepInstance: { select: { id: true, documentoId: true, stepKey: true } },
    },
    orderBy: { id: "asc" },
  })

  for (const t of tarefas) {
    if (t.documentoId != null) {
      achados.push({ entidade: "Tarefa", id: t.id, descricao: t.titulo.slice(0, 60),
        processoId: t.processoId, estado: "INTEGRO", motivo: "já vinculada",
        documentoIdAtual: t.documentoId, documentoIdDeduzido: null })
      continue
    }
    const doPasso = t.workflowStepInstance?.documentoId ?? null
    achados.push({
      entidade: "Tarefa", id: t.id, descricao: t.titulo.slice(0, 60), processoId: t.processoId,
      estado: doPasso != null ? "REPARAVEL" : "AMBIGUO",
      motivo: doPasso != null
        ? `herdaria o documento ${doPasso} do passo ${t.workflowStepInstanceId}`
        : t.workflowStepInstanceId == null
          ? "tarefa sem passo de workflow — origem não rastreável"
          : `o passo ${t.workflowStepInstanceId} também está sem documento`,
      documentoIdAtual: null, documentoIdDeduzido: doPasso,
    })
  }

  if (JSON_OUT) { console.log(JSON.stringify({ banco: fp.db, achados }, null, 1)); return }

  const por = (e: Achado["estado"]) => achados.filter((a) => a.estado === e)
  console.log(`AUDITORIA DO VÍNCULO DOCUMENTAL — banco ${fp.db}\n`)
  console.log(`  íntegros : ${por("INTEGRO").length}`)
  console.log(`  reparáveis: ${por("REPARAVEL").length}`)
  console.log(`  ambíguos : ${por("AMBIGUO").length}\n`)

  for (const estado of ["REPARAVEL", "AMBIGUO"] as const) {
    const lista = por(estado)
    if (!lista.length) continue
    console.log(`${estado === "REPARAVEL" ? "REPARÁVEIS (determinísticos)" : "AMBÍGUOS — NÃO reparados"}:`)
    for (const a of lista) {
      console.log(`  ${a.entidade} #${a.id} · processo ${a.processoId ?? "—"} · ${a.descricao}`)
      console.log(`      ${a.motivo}`)
    }
    console.log("")
  }

  if (por("REPARAVEL").length === 0) {
    console.log("Nenhum reparo determinístico disponível. Nada foi escrito — e nada")
    console.log("deve ser: vincular os ambíguos exigiria escolher um documento.")
  }
  console.log("\n(auditoria — este script NUNCA escreve.)")
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
