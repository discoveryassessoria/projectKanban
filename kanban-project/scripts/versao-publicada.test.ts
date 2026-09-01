// scripts/versao-publicada.test.ts
//
// GATE 1 — A VERSÃO PUBLICADA É IMUTÁVEL.
//
// O que este arquivo prova: editar um workflow publicado NÃO reinterpreta a execução
// de quem já estava rodando. Antes, `versao` nunca era incrementada e a edição
// apagava e recriava os passos: a instância guardava `workflowVersion: 1` e esse "1"
// passava a significar outra coisa. O ponteiro existia; faltava o alvo.
//
// (A) GUARDAS ESTÁTICAS — a publicação congela antes de alterar; nada reescreve uma
//     versão congelada; a leitura de SLA usa a versão da instância.
// (B) COMPORTAMENTO — banco real: V1 → editar → V2, processo antigo × processo novo.
//
// A parte (B) só roda no BANCO DE TESTE LOCAL:
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   DIRECT_DATABASE_URL=... npx tsx scripts/versao-publicada.test.ts

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { PrismaClient } from "@prisma/client"
import {
  congelarVersaoVigente, publicarNovaVersao, lerVersaoPublicada, versaoDaInstancia,
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
console.log("\n(A) A publicação congela ANTES de alterar")
// ============================================================

const svc = semComentarios(read("src/services/versao-publicada.ts"))
check("existe o serviço de versão publicada", svc.includes("export async function publicarNovaVersao"))
check("publicar congela a vigente e só então incrementa",
  svc.indexOf("congelarVersaoVigente") < svc.indexOf("versao: { increment: 1 }"))
check("congelar é idempotente por chave única", svc.includes("skipDuplicates: true"))
check("NADA atualiza uma versão congelada",
  !/phaseInternalWorkflowVersao\.(update|updateMany|delete|deleteMany)/.test(svc),
  "há escrita sobre versão congelada")

const rota = semComentarios(read("src/app/api/gerenciamento/workflows-fase/[id]/route.ts"))
check("a edição publica versão nova", rota.includes("publicarNovaVersao"))
check("congelar/alterar/incrementar acontecem na MESMA transação",
  /\$transaction\(async \(tx\) => \{[\s\S]*publicarNovaVersao\(id, tx[\s\S]*deleteMany[\s\S]*createMany[\s\S]*congelarVersaoVigente/.test(rota))
check("a versão nova nasce congelada", rota.includes('congelarVersaoVigente(id, "PUBLICACAO", tx'))
check("a publicação é auditada", rota.includes("WORKFLOW_VERSION_PUBLISHED"))

const criacao = semComentarios(read("src/app/api/gerenciamento/workflows-fase/route.ts"))
check("workflow novo nasce com a V1 congelada", criacao.includes("congelarVersaoVigente(criado.id, 'CRIACAO')"))

const ciclo = semComentarios(read("lib/operacional/tarefa-ciclo.ts"))
check("a política de SLA lê a versão DA INSTÂNCIA", ciclo.includes("versaoDaInstancia(workflowInstanceId)"))
check("e só cai na definição viva quando não há versão congelada",
  ciclo.indexOf("versaoDaInstancia") < ciclo.indexOf("phaseInternalWorkflow.findUnique"))

const migration = read("prisma/migrations/20260820100000_versao_publicada_imutavel/migration.sql")
check("a migration é aditiva — cria tabela, não altera nada",
  migration.includes("CREATE TABLE") && !/ALTER TABLE "Phase(WorkflowInstance|InternalWorkflow)"/.test(migration) && !migration.includes("DROP"))
check("a identidade é o par que a instância já guarda",
  migration.includes('"PhaseInternalWorkflowVersao_workflowId_versao_key"'))
check("nenhuma coluna nova foi criada na instância (sem duplicar o ponteiro)",
  !migration.includes('ALTER TABLE "PhaseWorkflowInstance"'))

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
const UID = "all::teste_versao"

async function limpar() {
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: UID }, select: { id: true } })
  if (wf) {
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
}

/** Reproduz o que a rota de edição faz — congelar, alterar, incrementar, congelar. */
async function editarEPublicar(workflowId: number, novosPassos: Array<{ key: string; label: string; ordem: number; slaDays?: number; required?: boolean }>) {
  return prisma.$transaction(async (tx) => {
    const r = await publicarNovaVersao(workflowId, tx)
    await tx.phaseInternalWorkflowStep.deleteMany({ where: { workflowId } })
    await tx.phaseInternalWorkflowStep.createMany({
      data: novosPassos.map((p) => ({
        workflowId, key: p.key, label: p.label, ordem: p.ordem,
        createsTask: true, required: p.required ?? true, slaDays: p.slaDays ?? 3, cardinalidade: "PROCESSO",
      })),
    })
    await congelarVersaoVigente(workflowId, "PUBLICACAO", tx)
    return r
  })
}

async function main() {
  await limpar()

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B1) V1 nasce e é congelada")
  // ══════════════════════════════════════════════════════════════════════════
  const wf = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: UID, phaseKey: "analise_documental", name: "WF de teste", tipoProcessoId: null,
      versao: 1, execucao: "SEQUENCIAL", pausarSlaEmEsperaExterna: false,
      passos: { create: [
        { key: "a", label: "A", ordem: 1, createsTask: true, required: true, slaDays: 3, cardinalidade: "PROCESSO" },
        { key: "b", label: "B", ordem: 2, createsTask: true, required: true, slaDays: 3, cardinalidade: "PROCESSO" },
        { key: "c", label: "C", ordem: 3, createsTask: true, required: true, slaDays: 3, cardinalidade: "PROCESSO" },
      ] },
    },
    select: { id: true },
  })
  await congelarVersaoVigente(wf.id, "CRIACAO")
  const v1 = await lerVersaoPublicada(wf.id, 1)
  check("V1 congelada existe", v1 != null)
  check("V1 tem os três passos A→B→C", JSON.stringify(v1?.passos.map((p) => p.key)) === '["a","b","c"]',
    JSON.stringify(v1?.passos.map((p) => p.key)))
  check("congelar de novo não duplica", (await congelarVersaoVigente(wf.id, "CRIACAO")) === false)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B2) O processo P1 registra a versão que usou")
  // ══════════════════════════════════════════════════════════════════════════
  const tipo = await prisma.tipoProcessoNacionalidade.findFirst({ where: { ativo: true }, select: { id: true, countryKey: true } })
  const arv = await prisma.arvore.create({ data: { nome: "TESTE-VERSAO árvore" }, select: { id: true } })
  const p1 = await prisma.processo.create({
    data: { nome: "TESTE-VERSAO P1", arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: "analise_documental", tipoProcessoMotorId: tipo?.id ?? null },
    select: { id: true },
  })
  const instP1 = await prisma.phaseWorkflowInstance.create({
    data: {
      processoId: p1.id, faseMacroKey: "analise_documental", ciclo: 1, status: "ATIVO",
      workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `TESTE-VERSAO-p1`,
    },
    select: { id: true },
  })
  const daP1 = await versaoDaInstancia(instP1.id)
  check("a instância de P1 resolve a V1", daP1?.versao === 1)
  check("e enxerga o conteúdo de V1", JSON.stringify(daP1?.passos.map((p) => p.key)) === '["a","b","c"]')

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B3) Editar publica V2 — e V1 não muda")
  // ══════════════════════════════════════════════════════════════════════════
  const r = await editarEPublicar(wf.id, [
    { key: "a", label: "A renomeado", ordem: 1, slaDays: 99 },
    { key: "x", label: "X novo", ordem: 2 },
    { key: "b", label: "B", ordem: 3 },
    { key: "c", label: "C", ordem: 4, required: false },
  ])
  check("a edição publicou a V2", r.anterior === 1 && r.nova === 2, JSON.stringify(r))
  const v1depois = await lerVersaoPublicada(wf.id, 1)
  check("V1 continua com A→B→C", JSON.stringify(v1depois?.passos.map((p) => p.key)) === '["a","b","c"]',
    JSON.stringify(v1depois?.passos.map((p) => p.key)))
  check("V1 continua com o rótulo antigo", v1depois?.passos.find((p) => p.key === "a")?.label === "A")
  check("V1 continua com o SLA antigo", v1depois?.passos.find((p) => p.key === "a")?.slaDays === 3)
  check("V1 continua com C obrigatório", v1depois?.passos.find((p) => p.key === "c")?.required === true)
  const v2 = await lerVersaoPublicada(wf.id, 2)
  check("V2 tem A→X→B→C", JSON.stringify(v2?.passos.map((p) => p.key)) === '["a","x","b","c"]',
    JSON.stringify(v2?.passos.map((p) => p.key)))
  check("V2 tem o SLA novo", v2?.passos.find((p) => p.key === "a")?.slaDays === 99)
  check("V2 tem C opcional", v2?.passos.find((p) => p.key === "c")?.required === false)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B4) P1 continua em V1 — a edição não o alcançou")
  // ══════════════════════════════════════════════════════════════════════════
  const daP1depois = await versaoDaInstancia(instP1.id)
  check("a instância de P1 continua na V1", daP1depois?.versao === 1)
  check("e continua lendo A→B→C", JSON.stringify(daP1depois?.passos.map((p) => p.key)) === '["a","b","c"]',
    JSON.stringify(daP1depois?.passos.map((p) => p.key)))
  check("o ponteiro de P1 no banco não foi tocado",
    (await prisma.phaseWorkflowInstance.findUnique({ where: { id: instP1.id }, select: { workflowVersion: true } }))?.workflowVersion === 1)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B5) P2, criado depois, usa V2")
  // ══════════════════════════════════════════════════════════════════════════
  const vigente = await prisma.phaseInternalWorkflow.findUnique({ where: { id: wf.id }, select: { versao: true } })
  check("a definição viva está na V2", vigente?.versao === 2)
  const p2 = await prisma.processo.create({
    data: { nome: "TESTE-VERSAO P2", arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: "analise_documental", tipoProcessoMotorId: tipo?.id ?? null },
    select: { id: true },
  })
  const instP2 = await prisma.phaseWorkflowInstance.create({
    data: {
      processoId: p2.id, faseMacroKey: "analise_documental", ciclo: 1, status: "ATIVO",
      workflowDefinitionId: wf.id, workflowVersion: vigente!.versao, chaveIdempotencia: `TESTE-VERSAO-p2`,
    },
    select: { id: true },
  })
  const daP2 = await versaoDaInstancia(instP2.id)
  check("a instância de P2 resolve a V2", daP2?.versao === 2)
  check("e enxerga A→X→B→C", JSON.stringify(daP2?.passos.map((p) => p.key)) === '["a","x","b","c"]')
  check("as duas instâncias leem versões DIFERENTES do mesmo workflow",
    daP1depois?.versao !== daP2?.versao && daP1depois?.workflowId === daP2?.workflowId)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B6) A política de SLA de P1 é a de V1, mesmo depois de mudada")
  // ══════════════════════════════════════════════════════════════════════════
  const { politicaDeSla } = await import("../lib/operacional/tarefa-ciclo")
  const antes = await politicaDeSla(instP1.id)
  check("V1 não pausava o relógio na espera externa", antes.pausaEspera === false)
  await prisma.$transaction(async (tx) => {
    await publicarNovaVersao(wf.id, tx)
    await tx.phaseInternalWorkflow.update({ where: { id: wf.id }, data: { pausarSlaEmEsperaExterna: true } })
    await congelarVersaoVigente(wf.id, "PUBLICACAO", tx)
  })
  const depois = await politicaDeSla(instP1.id)
  check("mudar a política publicou a V3",
    (await prisma.phaseInternalWorkflow.findUnique({ where: { id: wf.id }, select: { versao: true } }))?.versao === 3)
  check("e a tarefa de P1 continua sob a regra de V1 — o prazo dela não mudou",
    depois.pausaEspera === false, JSON.stringify(depois))
  const instP3 = await prisma.phaseWorkflowInstance.create({
    data: { processoId: p2.id, faseMacroKey: "analise_documental", ciclo: 2, status: "ATIVO", workflowDefinitionId: wf.id, workflowVersion: 3, chaveIdempotencia: `TESTE-VERSAO-p3` },
    select: { id: true },
  })
  check("já uma execução nova, em V3, pausa", (await politicaDeSla(instP3.id)).pausaEspera === true)

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n(B7) Versão congelada é imutável e o histórico é append-only")
  // ══════════════════════════════════════════════════════════════════════════
  const todas = await prisma.phaseInternalWorkflowVersao.findMany({ where: { workflowId: wf.id }, orderBy: { versao: "asc" }, select: { versao: true, origem: true, congeladoEm: true } })
  check("as três versões estão registradas", todas.length === 3, JSON.stringify(todas.map((t) => t.versao)))
  check("com a origem de cada uma", JSON.stringify(todas.map((t) => t.origem)) === '["CRIACAO","PUBLICACAO","PUBLICACAO"]',
    JSON.stringify(todas.map((t) => t.origem)))
  const dup = await prisma.phaseInternalWorkflowVersao.createMany({
    data: [{ workflowId: wf.id, versao: 1, phaseKey: "x", name: "tentativa de sobrescrever", execucao: "SEQUENCIAL", passos: [], origem: "PUBLICACAO" }],
    skipDuplicates: true,
  })
  check("o banco recusa uma segunda linha para a mesma versão", dup.count === 0)
  check("e a V1 continua intacta depois da tentativa",
    (await lerVersaoPublicada(wf.id, 1))?.name === "WF de teste")

  // limpeza do palco
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: [p1.id, p2.id] } } })
  await prisma.processo.deleteMany({ where: { id: { in: [p1.id, p2.id] } } })
  await prisma.arvore.delete({ where: { id: arv.id } })
  await limpar()

  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`) }
  await prisma.$disconnect()
  process.exit(falhas.length ? 1 : 0)
}

void main()
