// scripts/restaurar-macro-sintetico-mandato3.ts
//
// MANDATO "MÓDULO DE FASES" (21/09/2026), Mandato #3 — "restaure o Workflow
// Macro sintético à composição original" ao final da prova de produção do
// Defeito 1. A fase sintética `auditoria_final_fase_sintetica` foi inserida
// na posição 2 da composição do macro TESTEVIS_TIPO_AUDITORIA especificamente
// para reproduzir o Defeito 1; este script a REMOVE da composição pelo mesmo
// endpoint canônico (PUT /api/gerenciamento/workflow-macro/[id]) que o
// Gerenciamento usa, devolvendo a composição a TESTEVIS_fase(1) →
// teste_visual_auditoria_integral_fases(2) → finalizado(3) — o estado ao
// final do mandato #1 (scripts/auditoria-integral-catalogo-fases.ts).
//
// REMOVER da COMPOSIÇÃO (configuração) nunca apaga as PhaseWorkflowInstance/
// Tarefa já materializadas para 632/633/635/637 — isso é fato histórico
// (ver `exclusao-configuracao-vs-fato`); a fase sintética em si e seu
// Workflow Interno permanecem intactos no Catálogo, só saem da composição.
//
// Uso:
//   EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/restaurar-macro-sintetico-mandato3.ts
import { exigirConfirmacaoDeEscritaEmProducao } from "./_banco-de-teste"
exigirConfirmacaoDeEscritaEmProducao(
  "mandato Módulo de Fases 21/09/2026, Mandato #3 — restaurar a composição original do Workflow Macro sintético (TESTEVIS_TIPO_AUDITORIA), removendo auditoria_final_fase_sintetica inserida para a prova do Defeito 1",
  "restaurar-macro-sintetico-mandato3.ts",
)

import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { resolverMacroWorkflowDoTipo } from "../src/lib/motor/resolver-macro-workflow"

async function main() {
  const tipo = await prisma.tipoProcessoNacionalidade.findUniqueOrThrow({ where: { code: "TESTEVIS_TIPO_AUDITORIA" } })
  if (!tipo.name.startsWith("[TESTE VISUAL]")) throw new Error("SEGURANÇA: tipo não é sintético — abortando")

  // Script de tooling — resolução ao nível do Tipo é aceitável aqui (nunca no motor real).
  const antes = await resolverMacroWorkflowDoTipo(tipo.id)
  if (!antes) throw new Error(`MacroWorkflow não encontrado para o tipo ${tipo.id}`)
  console.log("ANTES:", JSON.stringify(antes.fases.map((f) => f.phaseKey)))

  const admin = await prisma.usuario.findFirstOrThrow({ where: { tipo: "admin" }, orderBy: { id: "asc" }, select: { id: true, email: true } })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })
  const { PUT: putWorkflowMacro } = await import("../src/app/api/gerenciamento/workflow-macro/[id]/route")
  const { NextRequest } = await import("next/server")

  const composicaoOriginal = antes.fases
    .filter((f) => f.phaseKey !== "auditoria_final_fase_sintetica")
    .map((f) => ({ phaseKey: f.phaseKey, label: f.label, required: f.required, conditional: f.conditional }))

  const res = await putWorkflowMacro(
    new NextRequest(`http://localhost/api/gerenciamento/workflow-macro/${tipo.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fases: composicaoOriginal }),
    }),
    { params: Promise.resolve({ id: String(tipo.id) }) },
  )
  const j = await res.json()
  console.log("PUT status:", res.status, JSON.stringify(j?.macroWorkflow?.fases?.map((f: { phaseKey: string }) => f.phaseKey)))

  const depois = await resolverMacroWorkflowDoTipo(tipo.id)
  if (!depois) throw new Error(`MacroWorkflow não encontrado para o tipo ${tipo.id} (depois)`)
  console.log("DEPOIS:", JSON.stringify(depois.fases.map((f) => f.phaseKey)))

  const esperado = JSON.stringify(["TESTEVIS_fase", "teste_visual_auditoria_integral_fases", "finalizado"])
  const encontrado = JSON.stringify(depois.fases.map((f) => f.phaseKey))
  if (res.status === 200 && encontrado === esperado) {
    console.log("\n✅ Composição restaurada com sucesso.")
  } else {
    console.error(`\n❌ Restauração NÃO ficou como esperado.\n   esperado : ${esperado}\n   encontrado: ${encontrado}`)
    process.exitCode = 1
  }

  // Materializações já feitas para 632/633/635/637 continuam intocadas — prova.
  for (const pid of [632, 633, 635, 637]) {
    const c = await prisma.phaseWorkflowInstance.count({ where: { processoId: pid, faseMacroKey: "auditoria_final_fase_sintetica" } })
    console.log(`  processo ${pid}: ${c} instância(s) de auditoria_final_fase_sintetica preservada(s) (fato histórico, não apagado pela mudança de composição)`)
  }
}

main().finally(() => prisma.$disconnect())
