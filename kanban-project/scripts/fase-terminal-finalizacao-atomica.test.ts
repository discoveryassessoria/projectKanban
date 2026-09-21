// scripts/fase-terminal-finalizacao-atomica.test.ts
//
// DEFEITO 3 do mandato "Módulo de Fases" (21/09/2026): processo posicionado
// na fase TERMINAL de um Workflow Macro continuava contado em "processos em
// andamento" porque nada setava o campo canônico de encerramento
// (`Processo.dataConclusao`) ao entrar nela.
//
// Este teste usa fases e chaves 100% GENÉRICAS e sintéticas próprias — nunca
// TESTEVIS_fase — e determina "fase terminal" pela COMPOSIÇÃO (maior `ordem`
// do Workflow Macro), nunca por comparar a chave com a string "finalizado".
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("fase-terminal-finalizacao-atomica.test.ts")

import { prisma } from "../lib/prisma"
import { movePhaseManual } from "../src/lib/motor/phase-advance"
import { GET as getHomeProcessos } from "../src/app/api/home/processos/route"
import { NextRequest } from "next/server"
import { signAuthToken } from "../lib/auth-jwt"

const MARCA = "FASETERMINAL"
let ok = 0, falhou = 0
function check(nome: string, cond: boolean) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) } else { falhou++; console.error(`  ❌ ${nome}`) }
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: `[${MARCA}]` } }, select: { id: true } })
  const ids = procs.map((p) => p.id)
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.faseMacro.deleteMany({ where: { macroWorkflow: { tipoProcesso: { code: { startsWith: MARCA } } } } })
  await prisma.macroWorkflow.deleteMany({ where: { tipoProcesso: { code: { startsWith: MARCA } } } })
  await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflow: { tipoProcesso: { code: { startsWith: MARCA } } } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { tipoProcesso: { code: { startsWith: MARCA } } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } })
}

async function main() {
  await limpar()

  const pm = await prisma.modalidadePais.findFirst({ select: { id: true, paisId: true } })
  if (!pm) throw new Error("nenhuma modalidade de país no banco de teste")
  const admin = await prisma.usuario.create({ data: { nome: MARCA, email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" } })
  const cfg = await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
  void cfg

  const tipo = await prisma.tipoProcessoNacionalidade.create({
    data: { code: `${MARCA}_TIPO`, name: `[${MARCA}] Tipo`, paisId: pm.paisId, modalidadeId: pm.id, ativo: true },
  })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: `[${MARCA}] Macro`, ativo: true } })
  // 3 fases genéricas, próprias deste teste — nenhuma se chama "finalizado".
  const CHAVE_A = `${MARCA.toLowerCase()}_a`, CHAVE_B = `${MARCA.toLowerCase()}_b`, CHAVE_C_TERMINAL = `${MARCA.toLowerCase()}_c_ultima`
  await prisma.faseMacro.createMany({
    data: [
      { macroWorkflowId: macro.id, phaseKey: CHAVE_A, label: "Fase A", ordem: 1, required: true, conditional: false },
      { macroWorkflowId: macro.id, phaseKey: CHAVE_B, label: "Fase B", ordem: 2, required: true, conditional: false },
      { macroWorkflowId: macro.id, phaseKey: CHAVE_C_TERMINAL, label: "Fase C (última, terminal por ordem)", ordem: 3, required: true, conditional: false },
    ],
  })
  for (const [fk, ordem] of [[CHAVE_A, 1], [CHAVE_B, 2], [CHAVE_C_TERMINAL, 3]] as const) {
    const wf = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `${MARCA}::${fk}`, phaseKey: fk, name: `WF ${fk}`, tipoProcessoId: tipo.id, versao: 1, active: true } })
    await prisma.phaseInternalWorkflowStep.create({ data: { workflowId: wf.id, key: "passo", label: "Passo", ordem: 1, createsTask: true, required: true, owner: null, slaDays: 0, cardinalidade: null } })
    void ordem
  }

  const proc = await prisma.processo.create({ data: { nome: `[${MARCA}] processo de teste`, faseAtualKey: CHAVE_B, tipoProcessoMotorId: tipo.id, paisId: pm.paisId } })

  console.log("\n1) Processo na fase B (não-terminal): dataConclusao continua null")
  const antes = await prisma.processo.findUniqueOrThrow({ where: { id: proc.id }, select: { dataConclusao: true } })
  check("dataConclusao null antes de alcançar a terminal", antes.dataConclusao === null)

  console.log("\n2) Mover para a fase C — a de MAIOR ORDEM da composição (terminal por estrutura, não por nome)")
  const mv = await movePhaseManual(proc.id, { faseAlvo: CHAVE_C_TERMINAL, justificativa: "teste automatizado", motivoCodigo: "REGULARIZACAO_ADMINISTRATIVA", solicitadoPorId: admin.id })
  check("movimentação aceita", mv.success === true)
  const depois = await prisma.processo.findUniqueOrThrow({ where: { id: proc.id }, select: { faseAtualKey: true, dataConclusao: true } })
  check("faseAtualKey = fase terminal", depois.faseAtualKey === CHAVE_C_TERMINAL)
  check("dataConclusao setada ATOMICAMENTE na mesma escrita — nenhuma chave 'finalizado' envolvida", depois.dataConclusao !== null)

  console.log("\n3) Processo some de 'processos em andamento' (Home)")
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })
  const req = new NextRequest("http://localhost/api/home/processos?limite=50", { headers: { Authorization: `Bearer ${token}` } })
  const res = await getHomeProcessos(req)
  const j = await res.json()
  const presente = (j.processos ?? []).some((p: { id: number }) => p.id === proc.id)
  check("excluído de 'processos em andamento'", presente === false)

  console.log("\n4) Continua consultável (não foi apagado, não perdeu histórico)")
  const aindaExiste = await prisma.processo.findUnique({ where: { id: proc.id } })
  check("processo continua existindo com todos os dados", aindaExiste != null && aindaExiste.faseAtualKey === CHAVE_C_TERMINAL)

  await limpar()
  console.log(`\n=== RESULTADO: ${ok} ok, ${falhou} falhas ===`)
  if (falhou > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
