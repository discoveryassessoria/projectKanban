// scripts/resync-macro-fase-ja-composta-inativa.test.ts
//
// Achado real, mandato "Módulo de Fases" (21/09/2026): reenviar a composição
// do Workflow Macro (o que "Salvar" SEMPRE faz — lista completa = verdade)
// ficava bloqueado assim que UMA fase já composta virasse INATIVA depois de
// publicada — mesmo sem estar sendo alterada. Isso travava reordenar,
// inserir OUTRA fase no meio, ou qualquer edição, sempre que a composição
// já tinha uma fase inativada.
//
// Fixture 100% genérica e sintética própria — nunca TESTEVIS_fase.
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("resync-macro-fase-ja-composta-inativa.test.ts")

import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { GET, PUT } from "../src/app/api/gerenciamento/workflow-macro/[id]/route"
import { PUT as putCatalogoFase } from "../src/app/api/gerenciamento/catalogo-fases/[id]/route"
import { NextRequest } from "next/server"

const MARCA = "RESYNCINATIVA"
let ok = 0, falhou = 0
function check(nome: string, cond: boolean) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) } else { falhou++; console.error(`  ❌ ${nome}`) }
}

async function limpar() {
  await prisma.faseMacro.deleteMany({ where: { macroWorkflow: { tipoProcesso: { code: MARCA } } } })
  await prisma.macroWorkflow.deleteMany({ where: { tipoProcesso: { code: MARCA } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { code: MARCA } })
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: MARCA.toLowerCase() } } })
  await prisma.usuario.deleteMany({ where: { email: `admin@${MARCA.toLowerCase()}.test` } })
}

async function main() {
  await limpar()
  const pm = await prisma.modalidadePais.findFirst({ select: { id: true, paisId: true } })
  if (!pm) throw new Error("nenhuma modalidade de país no banco de teste")
  const admin = await prisma.usuario.create({ data: { nome: MARCA, email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" } })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })
  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${token}` }

  const CHAVE_A = `${MARCA.toLowerCase()}_a`, CHAVE_B = `${MARCA.toLowerCase()}_b`
  await prisma.catalogoFase.createMany({
    data: [
      { phaseKey: CHAVE_A, label: "Fase A", escopo: "PROCESSO", ordemPadrao: 1, requiredPadrao: true, conditionalPadrao: false, ativo: true, status: "PUBLICADA", revisaoAtual: 1, efeitosPermitidos: ["REGISTER_ONLY"] },
      { phaseKey: CHAVE_B, label: "Fase B", escopo: "PROCESSO", ordemPadrao: 2, requiredPadrao: true, conditionalPadrao: false, ativo: true, status: "PUBLICADA", revisaoAtual: 1, efeitosPermitidos: ["REGISTER_ONLY"] },
    ],
  })
  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: MARCA, name: `[${MARCA}] tipo`, paisId: pm.paisId, ativo: true } })
  await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: pm.id, ativo: true } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, modalidadeId: pm.id, name: `[${MARCA}] macro`, ativo: true } })
  await prisma.faseMacro.createMany({
    data: [
      { macroWorkflowId: macro.id, phaseKey: CHAVE_A, label: "Fase A", ordem: 1, required: true, conditional: false, entryRule: "process_created", showInKanban: true },
      { macroWorkflowId: macro.id, phaseKey: CHAVE_B, label: "Fase B", ordem: 2, required: true, conditional: false, entryRule: "previous_phase_completed", showInKanban: true },
    ],
  })
  const faseBId = (await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: CHAVE_B } })).id

  console.log("\n1) Inativar a Fase B DEPOIS de já composta (fluxo real: publicada, depois inativada)")
  const resInativar = await putCatalogoFase(new NextRequest(`http://localhost/api/gerenciamento/catalogo-fases/${faseBId}`, { method: "PUT", headers: auth, body: JSON.stringify({ ativo: false }) }), { params: Promise.resolve({ id: String(faseBId) }) })
  check("inativação aceita", resInativar.status === 200)

  console.log("\n2) Reenviar a MESMA composição (o que 'Salvar' sempre faz) — ANTES do fix, 422")
  const resGet = await GET(new NextRequest(`http://localhost/api/gerenciamento/workflow-macro/${macro.id}`, { headers: auth }), { params: Promise.resolve({ id: String(macro.id) }) })
  const jGet = await resGet.json()
  const fasesAtuais = jGet.macroWorkflow.fases
  const resPut = await PUT(new NextRequest(`http://localhost/api/gerenciamento/workflow-macro/${macro.id}`, {
    method: "PUT", headers: auth,
    body: JSON.stringify({ fases: fasesAtuais.map((f: { phaseKey: string; label: string; ordem: number; required: boolean; conditional: boolean; entryRule: string; showInKanban: boolean }) => ({ phaseKey: f.phaseKey, label: f.label, ordem: f.ordem, required: f.required, conditional: f.conditional, entryRule: f.entryRule, showInKanban: f.showInKanban })) }),
  }), { params: Promise.resolve({ id: String(macro.id) }) })
  check("200 — resync com fase já composta inativa NÃO é bloqueado", resPut.status === 200)

  console.log("\n3) Adicionar chave NOVA que está inativa — continua BLOQUEADO (a regra vale pra chave nova)")
  const CHAVE_C_INATIVA = `${MARCA.toLowerCase()}_c_nova_inativa`
  await prisma.catalogoFase.create({ data: { phaseKey: CHAVE_C_INATIVA, label: "Fase C nova (inativa)", escopo: "PROCESSO", ordemPadrao: 3, requiredPadrao: true, conditionalPadrao: false, ativo: false, status: "INATIVA", revisaoAtual: 1, efeitosPermitidos: ["REGISTER_ONLY"] } })
  const resPutNova = await PUT(new NextRequest(`http://localhost/api/gerenciamento/workflow-macro/${macro.id}`, {
    method: "PUT", headers: auth,
    body: JSON.stringify({ fases: [...fasesAtuais.map((f: { phaseKey: string; label: string; ordem: number; required: boolean; conditional: boolean; entryRule: string; showInKanban: boolean }) => ({ phaseKey: f.phaseKey, label: f.label, ordem: f.ordem, required: f.required, conditional: f.conditional, entryRule: f.entryRule, showInKanban: f.showInKanban })), { phaseKey: CHAVE_C_INATIVA, label: "Fase C nova (inativa)", ordem: 3, required: true, conditional: false, entryRule: "previous_phase_completed", showInKanban: true }] }),
  }), { params: Promise.resolve({ id: String(macro.id) }) })
  check("422 — chave NOVA inativa continua recusada (regra preservada)", resPutNova.status === 422)

  await limpar()
  console.log(`\n=== RESULTADO: ${ok} ok, ${falhou} falhas ===`)
  if (falhou > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
