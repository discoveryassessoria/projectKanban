// scripts/etapa2b-editor-rascunho-nao-vaza.test.ts
// ============================================================================
// ETAPA 2b-EDITOR — Etapa 2, fechamento (26/09/2026), item 4.
// Rodar: PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//        DIRECT_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//        npx tsx scripts/etapa2b-editor-rascunho-nao-vaza.test.ts
//
// A REGRA: salvar RASCUNHO nunca pode alterar o que a produção lê. A forma
// mais simples e segura que já vale (item 1 desta Etapa): `resolverWorkflowAplicavel`
// ancora INCONDICIONALMENTE na versão publicada — não mais só "quando há
// rascunho pendente". Isso torna a tabela viva, por definição, área de
// RASCUNHO: o que ela tem não importa pro runtime enquanto existir uma
// versão publicada.
//
// Prova o exato padrão do editor real (`workflows-fase/[id]/route.ts`):
// delete-then-recreate-from-client-payload — 4 Steps publicados, "salva"
// (delete + recria) um payload de rascunho com só 1, e confirma que
// `resolverWorkflowAplicavel` continua devolvendo os 4 publicados. NUNCA
// chama a rota HTTP (auth/permissão fora de escopo aqui) — exercita direto
// a mesma primitiva que a rota usa por baixo (`marcarRascunho` +
// delete/recreate em `PhaseInternalWorkflowStep`).
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { publicarWorkflow, marcarRascunho } from "@/src/services/publicacao-de-workflow"
import { resolverWorkflowAplicavel } from "@/src/services/phase-workflow"

const MARCA = "ETAPA2BEDITOR"
const PHASE_KEY = `${MARCA.toLowerCase()}_fase`

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  await prisma.phaseInternalWorkflow.deleteMany({ where: { wfUid: { startsWith: MARCA } } })
}

async function main() {
  exigirBancoDeTeste("etapa2b-editor-rascunho-nao-vaza.test.ts")
  await limpar()
  console.log("ETAPA 2b-EDITOR — RASCUNHO NUNCA VAZA PRO QUE A PRODUÇÃO LÊ\n")

  const tipo = await prisma.tipoProcessoNacionalidade.findFirst({ select: { id: true } })
  if (!tipo) throw new Error("Banco de teste sem nenhum TipoProcessoNacionalidade — rode o seed base primeiro.")

  // ══════════════════════════════════════════════════════════════════════
  secao("1) CADASTRO — 4 Steps publicados (a forma antiga, pré-14/09, pra testar reduzir contagem de STEP)")
  // ══════════════════════════════════════════════════════════════════════
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}-wf`, phaseKey: PHASE_KEY, name: `${MARCA} wf`, active: true, tipoProcessoId: tipo.id, escopoExecucao: "PROCESSO" },
    select: { id: true },
  })
  const CHAVES = ["passo1", "passo2", "passo3", "passo4"]
  for (let i = 0; i < CHAVES.length; i++) {
    const step = await prisma.phaseInternalWorkflowStep.create({
      data: { workflowId: wf.id, key: CHAVES[i], label: `Passo ${i + 1}`, ordem: i + 1, slaDays: 1, cardinalidade: "PROCESSO" },
      select: { id: true },
    })
    await prisma.stepAction.create({ data: { stepId: step.id, key: "concluir", label: "Concluir", ordem: 1, effectKey: "COMPLETE_STEP" } })
  }
  const pub = await publicarWorkflow({ workflowId: wf.id, actorId: null, pularCompetenciaDeEfeito: true })
  ok("1.1) publicação com 4 Steps sucede", pub.ok === true, JSON.stringify(pub).slice(0, 150))

  const antes = await resolverWorkflowAplicavel(tipo.id, PHASE_KEY)
  ok("1.2) resolverWorkflowAplicavel devolve os 4 Steps publicados", "steps" in antes && antes.steps.length === 4, JSON.stringify("steps" in antes ? antes.steps.map((s) => s.key) : antes))

  // ══════════════════════════════════════════════════════════════════════
  secao("2) 'SALVAR RASCUNHO' — o MESMO padrão do editor real: apaga todos os Steps vivos e recria só 1")
  // ══════════════════════════════════════════════════════════════════════
  await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: wf.id } })
  const stepRascunho = await prisma.phaseInternalWorkflowStep.create({
    data: { workflowId: wf.id, key: "passo1", label: "Passo 1 (editado no rascunho)", ordem: 1, slaDays: 999, cardinalidade: "PROCESSO" },
    select: { id: true },
  })
  await prisma.stepAction.create({ data: { stepId: stepRascunho.id, key: "concluir", label: "Concluir", ordem: 1, effectKey: "COMPLETE_STEP" } })
  await marcarRascunho(wf.id, null)

  const contagemViva = await prisma.phaseInternalWorkflowStep.count({ where: { workflowId: wf.id } })
  ok("2.1) a tabela viva agora tem só 1 Step (reproduz o 'salvar' do editor)", contagemViva === 1, `Steps na tabela viva: ${contagemViva}`)
  const wfRascunho = await prisma.phaseInternalWorkflow.findUniqueOrThrow({ where: { id: wf.id }, select: { rascunhoAlteradoEm: true } })
  ok("2.2) rascunho pendente está marcado", wfRascunho.rascunhoAlteradoEm != null)

  // ══════════════════════════════════════════════════════════════════════
  secao("3) A PROVA CENTRAL: resolverWorkflowAplicavel NÃO muda — continua devolvendo os 4 publicados")
  // ══════════════════════════════════════════════════════════════════════
  const depois = await resolverWorkflowAplicavel(tipo.id, PHASE_KEY)
  ok("3.1) resolverWorkflowAplicavel AINDA devolve 4 Steps (o rascunho de 1 não vazou)", "steps" in depois && depois.steps.length === 4, JSON.stringify("steps" in depois ? depois.steps.map((s) => s.key) : depois))
  ok(
    "3.2) os 4 Steps são exatamente os publicados, com o slaDays PUBLICADO (não o 999 do rascunho)",
    "steps" in depois && depois.steps.every((s) => s.slaDays === 1) && depois.steps.map((s) => s.key).sort().join(",") === CHAVES.slice().sort().join(","),
  )

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch(async (e) => { console.error(e); await limpar().catch(() => {}); process.exit(1) }).finally(() => prisma.$disconnect())
