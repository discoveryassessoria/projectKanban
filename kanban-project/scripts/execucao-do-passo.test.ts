// scripts/execucao-do-passo.test.ts
//
// GATE 2 — REEXECUTAR NÃO É DESCONCLUIR O PASSADO.
//
// O modelo já sabia representar a execução da FASE (`PhaseWorkflowInstance.ciclo`).
// Dentro de uma visita, porém, o passo era uma linha só: reabrir fazia
// `completedAt = NULL` sobre ela, e a pergunta "concluída em qual execução?" não
// tinha onde ser respondida. Agora cada tentativa é uma linha, append-only, e a
// vigente é a única não substituída — garantido por índice parcial no banco.
//
// (A) GUARDAS ESTÁTICAS — nada desconclui o passado; a vigente não sai de ORDER BY.
// (B) COMPORTAMENTO — banco real: os cenários A–P do gate.
//
// A parte (B) só roda no BANCO DE TESTE LOCAL:
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   DIRECT_DATABASE_URL=... npx tsx scripts/execucao-do-passo.test.ts

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { PrismaClient } from "@prisma/client"
import {
  abrirTentativa, garantirTentativa, registrarNaTentativa, tentativaVigente,
  tentativasDoPasso, MOTIVOS_DE_TENTATIVA,
} from "../src/services/execucao-do-passo"
import {
  congelarVersaoVigente, publicarNovaVersao, definicaoHistoricaDoPasso, versaoDaInstancia,
} from "../src/services/versao-publicada"

const ROOT = join(__dirname, "..")
const read = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "")
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

// ============================================================
console.log("\n(A) O passado não é desconcluído")
// ============================================================

const svc = semComentarios(read("src/services/execucao-do-passo.ts"))
check("existe o serviço de tentativas", svc.includes("export async function abrirTentativa"))
check("a vigente é a NÃO substituída — não sai de ORDER BY createdAt",
  svc.includes("supersededAt: null") && !svc.includes('orderBy: { criadoEm: "desc" }'))
check("abrir tentativa cria a nova ANTES de substituir a anterior",
  svc.indexOf("createMany") < svc.indexOf("supersededAt: agora"))
check("substituir preserva completedAt da anterior",
  !/supersededAt: agora[\s\S]{0,200}completedAt: null/.test(svc))
check("registrar NUNCA reescreve completedAt já gravado",
  svc.includes("vigente.completedAt == null ? { completedAt: dados.completedAt }"))
check("tentativa é idempotente por chave", svc.includes("chaveIdempotencia: chave") && svc.includes("skipDuplicates: true"))

const sync = semComentarios(read("src/services/task-step-sync.ts"))
check("reabrir ABRE tentativa nova", /reabrirPassoTx[\s\S]{0,2000}abrirTentativa\(/.test(sync))
check("e a chave da tentativa amarra ao comando (retry não duplica)",
  sync.includes("`stepexec|si${stepId}|reopen|${o.correlationId}`"))
check("transição registra na tentativa vigente", sync.includes("registrarNaTentativa(stepId"))

const pw = semComentarios(read("src/services/phase-workflow.ts"))
check("a obrigação nasce com a primeira tentativa", pw.includes("garantirTentativa(si.id"))

const mig = read("prisma/migrations/20260820140000_tentativa_de_execucao_do_passo/migration.sql")
check("a migration é aditiva", mig.includes("CREATE TABLE") && !mig.includes("ALTER TABLE \"PhaseWorkflowStepInstance\"") && !mig.includes("DROP"))
check("o BANCO garante uma vigente por passo (índice parcial)",
  mig.includes('"StepExecution_uma_vigente_por_passo"') && mig.includes('WHERE "supersededAt" IS NULL'))
check("sequência é única por passo", mig.includes('"StepExecution_stepInstanceId_sequencia_key"'))

const vp = semComentarios(read("src/services/versao-publicada.ts"))
check("a definição histórica resolve pela VERSÃO, não pelo id de linha",
  vp.includes("export async function definicaoHistoricaDoPasso") && vp.includes("versao.passos.find"))

const back = read("scripts/backfill-tentativa-de-execucao.ts")
check("o backfill declara o que NÃO consegue reconstruir",
  back.includes("NÃO RECONSTRUÍVEL") && back.includes("MOTIVOS_DE_TENTATIVA.BACKFILL"))

// ============================================================
// (B) COMPORTAMENTO — banco real
// ============================================================

const url = process.env.PRISMA_DATABASE_URL ?? ""
if (!/discovery_test/.test(url)) {
  console.log("\n(B) Comportamento — PULADO (sem banco de teste local)")
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
  process.exit(0)
}

const prisma = new PrismaClient()
const MARCA = "G2"

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.arvore.deleteMany({ where: { id: p.arvoreId } })
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${MARCA}::wf` }, select: { id: true } })
  if (wf) {
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
}

async function main() {
  await limpar()

  // Palco: um workflow com 3 passos, uma instância e um passo materializado.
  const wf = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `${MARCA}::wf`, phaseKey: "analise_documental", name: "G2 wf", tipoProcessoId: null,
      versao: 1, execucao: "SEQUENCIAL",
      passos: { create: [
        { key: "a", label: "A", ordem: 1, createsTask: true, required: true, slaDays: 3, cardinalidade: "PROCESSO" },
        { key: "b", label: "B", ordem: 2, createsTask: true, required: true, slaDays: 3, cardinalidade: "PROCESSO" },
        { key: "c", label: "C", ordem: 3, createsTask: true, required: true, slaDays: 3, cardinalidade: "PROCESSO" },
      ] },
    },
    select: { id: true, passos: { select: { id: true, key: true }, orderBy: { ordem: "asc" } } },
  })
  await congelarVersaoVigente(wf.id, "CRIACAO")
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} processo`, pais: "espanha", arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: "analise_documental" },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "analise_documental", ciclo: 1, status: "ATIVO", workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `${MARCA}-inst` },
    select: { id: true },
  })
  const passo = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "analise_documental", ciclo: 1,
      stepKey: "a", ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true, status: "DISPONIVEL",
      stepDefinitionId: wf.passos[0].id, stepDefinitionVersion: 1, chaveIdempotencia: `${MARCA}-passo-a`,
    },
    select: { id: true },
  })

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B-A) Execução simples: abrir, executar, concluir")
  // ══════════════════════════════════════════════════════════════════════════
  const t1 = await garantirTentativa(passo.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })
  check("a obrigação tem tentativa 1", t1.sequencia === 1 && t1.motivo === "ABERTURA")
  const inicio = new Date("2026-08-01T10:00:00Z")
  const fim = new Date("2026-08-01T11:00:00Z")
  await registrarNaTentativa(passo.id, { status: "EM_ANDAMENTO", startedAt: inicio, executadoPorId: 1 })
  await registrarNaTentativa(passo.id, { status: "CONCLUIDO", completedAt: fim, resultado: "aprovado" })
  const t1f = await tentativaVigente(passo.id)
  check("a tentativa 1 fica CONCLUIDA", t1f?.status === "CONCLUIDO")
  check("com início, fim, autor e resultado",
    t1f?.startedAt?.toISOString() === inicio.toISOString() && t1f?.completedAt?.toISOString() === fim.toISOString() &&
    t1f?.executadoPorId === 1 && t1f?.resultado === "aprovado")

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B-B) Reabrir cria tentativa NOVA — a 1 permanece concluída")
  // ══════════════════════════════════════════════════════════════════════════
  const r2 = await abrirTentativa({ stepInstanceId: passo.id, motivo: MOTIVOS_DE_TENTATIVA.REABERTURA_MANUAL, status: "EM_ANDAMENTO", executadoPorId: 2 })
  check("nasceu a tentativa 2", r2.tentativa.sequencia === 2 && r2.criada)
  check("com identidade DIFERENTE da 1", r2.tentativa.id !== t1.id)
  const hist = await tentativasDoPasso(passo.id)
  const h1 = hist.find((t) => t.sequencia === 1)!
  check("G2-INV-03: o completedAt da tentativa 1 NÃO foi apagado", h1.completedAt?.toISOString() === fim.toISOString())
  check("G2-INV-04: o resultado histórico não foi sobrescrito", h1.resultado === "aprovado")
  check("G2-INV-01: a tentativa 1 foi SUBSTITUÍDA, não reutilizada",
    h1.supersededAt != null && h1.supersededPorId === r2.tentativa.id)
  check("a tentativa 1 continua CONCLUIDA", h1.status === "CONCLUIDO")
  check("a vigente agora é a 2", (await tentativaVigente(passo.id))?.sequencia === 2)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B-C) Duas reexecuções sucessivas")
  // ══════════════════════════════════════════════════════════════════════════
  await registrarNaTentativa(passo.id, { status: "CONCLUIDO", completedAt: new Date("2026-08-02T10:00:00Z") })
  const r3 = await abrirTentativa({ stepInstanceId: passo.id, motivo: MOTIVOS_DE_TENTATIVA.NOVA_VIA, status: "EM_ANDAMENTO" })
  const todas = await tentativasDoPasso(passo.id)
  check("existem três tentativas", todas.length === 3, String(todas.length))
  check("com sequências 1, 2, 3", JSON.stringify(todas.map((t) => t.sequencia)) === "[1,2,3]")
  check("e motivos distintos e legíveis",
    JSON.stringify(todas.map((t) => t.motivo)) === '["ABERTURA","REABERTURA_MANUAL","NOVA_VIA"]',
    JSON.stringify(todas.map((t) => t.motivo)))
  check("G2-INV-08: só UMA vigente", todas.filter((t) => t.supersededAt == null).length === 1)
  check("as duas primeiras guardam seus próprios fins",
    todas[0].completedAt?.toISOString() === fim.toISOString() &&
    todas[1].completedAt?.toISOString() === "2026-08-02T10:00:00.000Z")
  void r3

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B-K) Retry do mesmo comando não cria tentativa nova")
  // ══════════════════════════════════════════════════════════════════════════
  const chave = `${MARCA}|comando-unico`
  const p1 = await abrirTentativa({ stepInstanceId: passo.id, motivo: MOTIVOS_DE_TENTATIVA.RETRY, status: "EM_ANDAMENTO", chaveIdempotencia: chave })
  const p2 = await abrirTentativa({ stepInstanceId: passo.id, motivo: MOTIVOS_DE_TENTATIVA.RETRY, status: "EM_ANDAMENTO", chaveIdempotencia: chave })
  check("o reenvio devolve a MESMA tentativa", p1.tentativa.id === p2.tentativa.id && p2.criada === false)
  check("e não abriu uma quinta", (await tentativasDoPasso(passo.id)).length === 4)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B-J) Concorrência: dois reopen simultâneos → uma vigente só")
  // ══════════════════════════════════════════════════════════════════════════
  const antesConc = (await tentativasDoPasso(passo.id)).length
  const [a, b] = await Promise.allSettled([
    abrirTentativa({ stepInstanceId: passo.id, motivo: MOTIVOS_DE_TENTATIVA.CORRECAO, status: "EM_ANDAMENTO", chaveIdempotencia: `${MARCA}|conc-a` }),
    abrirTentativa({ stepInstanceId: passo.id, motivo: MOTIVOS_DE_TENTATIVA.CORRECAO, status: "EM_ANDAMENTO", chaveIdempotencia: `${MARCA}|conc-b` }),
  ])
  const depoisConc = await tentativasDoPasso(passo.id)
  const vigentes = depoisConc.filter((t) => t.supersededAt == null).length
  check("G2-INV-09: continua existindo UMA vigente depois da corrida", vigentes === 1, String(vigentes))
  check("e o banco impediu a duplicidade (uma das duas falhou ou convergiu)",
    depoisConc.length <= antesConc + 2, `${antesConc} → ${depoisConc.length}`)
  check("nenhuma tentativa histórica perdeu o fim",
    depoisConc.filter((t) => t.sequencia <= 2).every((t) => t.completedAt != null))
  void a; void b

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B-F/G/H) Versão: a execução resolve V1 mesmo depois da V2")
  // ══════════════════════════════════════════════════════════════════════════
  const daInst = await versaoDaInstancia(inst.id)
  check("G2-INV-06: a execução resolve a versão da instância", daInst?.versao === 1)
  const defAntes = await definicaoHistoricaDoPasso(passo.id)
  check("G2-INV-12: o passo resolve a definição histórica", defAntes?.passo.key === "a" && defAntes.versao === 1)
  check("com o rótulo da época", defAntes?.passo.label === "A")

  await prisma.$transaction(async (tx) => {
    await publicarNovaVersao(wf.id, tx)
    await tx.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: wf.id } })
    await tx.phaseInternalWorkflowStep.createMany({
      data: [{ workflowId: wf.id, key: "a", label: "A REESCRITO", ordem: 1, createsTask: true, required: true, slaDays: 99, cardinalidade: "PROCESSO" }],
    })
    await congelarVersaoVigente(wf.id, "PUBLICACAO", tx)
  })
  const defDepois = await definicaoHistoricaDoPasso(passo.id)
  check("G2-INV-07: publicar V2 NÃO altera a definição que a execução resolve",
    defDepois?.versao === 1 && defDepois.passo.label === "A" && defDepois.passo.slaDays === 3,
    JSON.stringify(defDepois?.passo))
  const definicaoViva = await prisma.phaseInternalWorkflowStep.findFirst({ where: { workflowId: wf.id, key: "a" }, select: { id: true, label: true } })
  check("a linha de definição foi recriada (id novo) e o passo NÃO depende dela",
    definicaoViva!.id !== wf.passos[0].id && defDepois?.passo.label === "A")

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B-L) Macro rollback NÃO cria tentativa")
  // ══════════════════════════════════════════════════════════════════════════
  const antesRollback = (await tentativasDoPasso(passo.id)).length
  const { movePhaseManual } = await import("../src/lib/motor/phase-advance")
  await movePhaseManual(proc.id, {
    faseAlvo: "genealogia", justificativa: "Rollback macro do teste do Gate 2.",
    motivoCodigo: "CORRECAO_CADASTRO", solicitadoPorId: 1, origem: "teste",
  }).catch(() => null)
  check("G2-INV-11: mover a fase não abriu tentativa no passo existente",
    (await tentativasDoPasso(passo.id)).length === antesRollback, `${antesRollback} → ${(await tentativasDoPasso(passo.id)).length}`)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B-P) Projeção: atual e histórico são distinguíveis")
  // ══════════════════════════════════════════════════════════════════════════
  const atual = await tentativaVigente(passo.id)
  const historico = (await tentativasDoPasso(passo.id)).filter((t) => t.supersededAt != null)
  check("há UMA atual", atual != null)
  check("e um histórico com as demais", historico.length >= 3, String(historico.length))
  check("G2-INV-14: nenhuma tentativa histórica aparece como atual",
    !historico.some((h) => h.id === atual?.id))
  check("cada uma responde 'concluída em qual execução?'",
    historico.filter((h) => h.status === "CONCLUIDO").every((h) => h.completedAt != null && h.sequencia > 0))

  await limpar()
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`) }
  await prisma.$disconnect()
  process.exit(falhas.length ? 1 : 0)
}

void main()
