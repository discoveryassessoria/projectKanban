// scripts/catalogo-fases-projecoes-nao-hardcoded.test.ts
// ============================================================================
// TELAS E PROJEÇÕES — uma fase nova, com phaseKey NUNCA antes conhecido pelo
// frontend, precisa aparecer sem alterar nenhuma lista hardcoded (mandato
// "Catálogo de Fases", 20/09/2026, continuação 20/09/2026).
//
// Prova em duas camadas:
//   1) LÓGICA PURA da trilha (getActivePath/getPhaseStatus,
//      src/components/kanban/WorkflowMacroTrilha.tsx) — sem backend, sem DOM.
//   2) API REAL (GET /api/processos/[processoId]/phases) — cria um
//      MacroWorkflow com uma fase cujo phaseKey não existe em
//      src/lib/process-stage/fases-catalog.ts, e prova que a rota devolve
//      exatamente esse phaseKey, com rótulo real (nunca "—"), sem editar
//      nenhum arquivo de código para isso.
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/catalogo-fases-projecoes-nao-hardcoded.test.ts
// ============================================================================
import { prisma } from "../lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { garantirOferta } from "./_fixture-oferta"
import { signAuthToken } from "../lib/auth-jwt"
import { materializarExecucaoDaFase } from "../src/services/materializar-fase"
import { GET as getPhases } from "../src/app/api/processos/[processoId]/phases/route"
import { getActivePath, getPhaseStatus, type FaseTrilha } from "../src/components/kanban/WorkflowMacroTrilha"
import { FASES } from "../src/lib/process-stage/fases-catalog"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "PROJNOVA"
const FASE_NOVA = `${MARCA}_fase_nunca_vista` // phaseKey que NUNCA existiu em FASES

async function limpar() {
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({ where: { code: { startsWith: MARCA } }, select: { id: true } })
  const tipoIds = tipos.map((t) => t.id)
  const procs = await prisma.processo.findMany({ where: { tipoProcessoMotorId: { in: tipoIds } }, select: { id: true } })
  const procIds = procs.map((p) => p.id)
  await prisma.tarefa.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
  const wfs = await prisma.phaseInternalWorkflow.findMany({ where: { wfUid: { startsWith: MARCA } }, select: { id: true } })
  await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: { in: wfs.map((w) => w.id) } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { id: { in: wfs.map((w) => w.id) } } })
  const macros = await prisma.macroWorkflow.findMany({ where: { tipoProcessoId: { in: tipoIds } }, select: { id: true } })
  await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
  await prisma.macroWorkflow.deleteMany({ where: { id: { in: macros.map((m) => m.id) } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: { in: tipoIds } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@projnova.test" } } })
}

async function main() {
  exigirBancoDeTeste("prova de fase nova sem alteração de lista hardcoded")
  console.log("TELAS E PROJEÇÕES — fase nova aparece sem tocar em lista hardcoded\n")
  await limpar()

  // ══════════════════════════════════════════════════════════════════════
  secao("0) A chave nunca existiu no catálogo em código (garante que o teste prova algo real)")
  // ══════════════════════════════════════════════════════════════════════
  ok("FASE_NOVA não é nenhuma das 10 fases canônicas hardcoded", !Object.values(FASES).some((f) => f.phaseKey === FASE_NOVA))

  // ══════════════════════════════════════════════════════════════════════
  secao("1) LÓGICA PURA da trilha — getActivePath/getPhaseStatus reconhecem a fase nova")
  // ══════════════════════════════════════════════════════════════════════
  const fasesTrilha: FaseTrilha[] = [
    { phaseKey: "a", label: "A" },
    { phaseKey: FASE_NOVA, label: "Fase Nunca Vista" },
    { phaseKey: "c", label: "C" },
  ]
  const path = getActivePath(fasesTrilha, null)
  ok("1.1) fase nova ENTRA no caminho ativo (não precisa ser condicional)", path.includes(FASE_NOVA))

  const stFutura = getPhaseStatus(fasesTrilha, FASE_NOVA, "a", [], path, null)
  ok("1.2) status calculado é um valor real (\"futura\"), nunca vazio/indefinido", stFutura === "futura", stFutura)

  const stAtual = getPhaseStatus(fasesTrilha, FASE_NOVA, FASE_NOVA, [], path, null)
  ok("1.3) quando é a fase ATUAL do processo, o status reflete isso (\"atual\")", stAtual === "atual", stAtual)

  const stConcluida = getPhaseStatus(fasesTrilha, FASE_NOVA, "c", [FASE_NOVA], path, null)
  ok("1.4) quando concluída, o status reflete isso (\"concluida\") — não \"pulada\", não \"—\"", stConcluida === "concluida", stConcluida)

  // ══════════════════════════════════════════════════════════════════════
  secao("2) API REAL — GET /api/processos/[id]/phases devolve a fase nova")
  // ══════════════════════════════════════════════════════════════════════
  const admin = await prisma.usuario.create({ data: { nome: "Admin ProjNova", email: "admin@projnova.test", senha: "x", tipo: "admin" }, select: { id: true } })
  const token = await signAuthToken({ userId: admin.id, email: "admin@projnova.test", tipo: "admin", sessaoInicio: Date.now() })
  const oferta = await garantirOferta(prisma, { countryKey: `${MARCA}_pais`, countryLabel: "País ProjNova", modalityKey: `${MARCA}_modal`, modalityLabel: "Modalidade ProjNova" })
  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: `${MARCA}_TIPO`, name: `${MARCA} Tipo`, paisId: oferta.paisId, modalidadeId: oferta.modalidadeId }, select: { id: true } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: `${MARCA} macro`, versao: 1 }, select: { id: true } })

  // Composição: fase "a" (canônica-like, mas custom) → FASE_NOVA (nunca vista) → finalizado.
  // NENHUM arquivo de código é tocado para isto existir — é só INSERT no cadastro,
  // exatamente o que o Admin faria via Gerenciamento › Workflow Macro.
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: `${MARCA}_a`, label: "Fase A", ordem: 1, required: true, conditional: false } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASE_NOVA, label: "Fase Nunca Vista Pelo Frontend", ordem: 2, required: true, conditional: false } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: "finalizado", label: "Finalizado", ordem: 3, required: true, conditional: false } })

  for (const phaseKey of [`${MARCA}_a`, FASE_NOVA, "finalizado"]) {
    const wf = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `${MARCA}::${phaseKey}`, phaseKey, name: `WF ${phaseKey}`, tipoProcessoId: tipo.id, versao: 1 }, select: { id: true } })
    await prisma.phaseInternalWorkflowStep.create({ data: { workflowId: wf.id, key: `${phaseKey}_passo`, label: `Passo ${phaseKey}`, ordem: 1, createsTask: true, required: false, owner: null, slaDays: 0, cardinalidade: "PROCESSO" } })
  }

  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} Processo`, workflowRuntime: "v2", faseAtualKey: FASE_NOVA, tipoProcessoMotorId: tipo.id, macroWorkflowVersion: 1 },
    select: { id: true },
  })
  await materializarExecucaoDaFase({ processoId: processo.id, fonte: "PROCESSO_CRIADO" })

  const req = new Request(`http://localhost/api/processos/${processo.id}/phases`, { headers: { Authorization: `Bearer ${token}` } })
  const res = await getPhases(req, { params: Promise.resolve({ processoId: String(processo.id) }) })
  ok("2.1) a rota responde 200", res.status === 200, String(res.status))
  const corpo = await res.json() as { phases: Array<{ phaseKey: string; label: string; ordem: number; state: string; conditional: boolean }> }

  const itemNovo = corpo.phases.find((p) => p.phaseKey === FASE_NOVA)
  ok("2.2) a fase nova APARECE na resposta (não foi filtrada por não constar em catálogo hardcoded)", itemNovo != null,
    corpo.phases.map((p) => p.phaseKey).join(", "))
  ok("2.3) o rótulo é o REAL do cadastro — nunca \"—\", nunca vazio", !!itemNovo?.label && itemNovo.label !== "—" && itemNovo.label === "Fase Nunca Vista Pelo Frontend", itemNovo?.label)
  ok("2.4) a ordem é a REAL da composição (2, entre fase_a e finalizado)", itemNovo?.ordem === 2, String(itemNovo?.ordem))
  ok("2.5) é a fase ATIVA do processo (state=ACTIVE) — reconhecida corretamente", itemNovo?.state === "ACTIVE", itemNovo?.state)
  ok("2.6) TODAS as 3 fases da composição aparecem — nenhuma \"desaparece\" (nem ao process ter só 3 de 10)",
    corpo.phases.length === 3, `${corpo.phases.length}: ${corpo.phases.map((p) => p.phaseKey).join(", ")}`)

  // ══════════════════════════════════════════════════════════════════════
  secao("3) MESMO ID em todas as camadas — Processo, FaseMacro e resposta da API")
  // ══════════════════════════════════════════════════════════════════════
  const procDb = await prisma.processo.findUniqueOrThrow({ where: { id: processo.id }, select: { faseAtualKey: true } })
  const faseMacroDb = await prisma.faseMacro.findFirstOrThrow({ where: { macroWorkflowId: macro.id, phaseKey: FASE_NOVA }, select: { phaseKey: true } })
  ok("3.1) Processo.faseAtualKey === phaseKey da API === FaseMacro.phaseKey (mesma identidade, ponta a ponta)",
    procDb.faseAtualKey === FASE_NOVA && itemNovo?.phaseKey === FASE_NOVA && faseMacroDb.phaseKey === FASE_NOVA,
    `processo=${procDb.faseAtualKey} api=${itemNovo?.phaseKey} faseMacro=${faseMacroDb.phaseKey}`)

  // ══════════════════════════════════════════════════════════════════════
  secao("4) Nenhuma lista hardcoded precisou mudar")
  // ══════════════════════════════════════════════════════════════════════
  ok("4.1) FASE_NOVA continua fora do catálogo em código depois do teste inteiro (prova que nada dependeu dele)",
    !Object.values(FASES).some((f) => f.phaseKey === FASE_NOVA))

  console.log(`\n${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
  await limpar()
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect() })
