// scripts/catalogo-fases-exclusao.test.ts
//
// EXCLUSÃO DE FASE DO CATÁLOGO — mandato "blindagem do Catálogo de Fases"
// (22/09/2026), itens 19 e 20 da matriz de regressão:
//   19) bloquear exclusão física de fase EM USO (comprometeria integridade
//       — algum FaseMacro ainda a referencia);
//   20) permitir exclusão segura de fase REALMENTE sem uso, com auditoria.
//
// Fixture 100% genérica e sintética própria (MARCA EXCLUSAOFASE) — nunca
// TESTEVIS_fase nem qualquer fase/processo real.
//
// Roda com:
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//     npx tsx scripts/catalogo-fases-exclusao.test.ts
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("catalogo-fases-exclusao.test.ts")

import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { DELETE } from "../src/app/api/gerenciamento/catalogo-fases/[id]/route"
import { NextRequest } from "next/server"

const MARCA = "EXCLUSAOFASE"
let ok = 0, falhou = 0
function check(nome: string, cond: boolean, detalhe?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${detalhe ? " — " + detalhe : ""}`) }
  else { falhou++; console.error(`  ❌ ${nome}${detalhe ? " — " + detalhe : ""}`) }
}

async function limpar() {
  const tipo = await prisma.tipoProcessoNacionalidade.findUnique({ where: { code: MARCA } })
  if (tipo) {
    await prisma.faseMacro.deleteMany({ where: { macroWorkflow: { tipoProcessoId: tipo.id } } })
    await prisma.macroWorkflow.deleteMany({ where: { tipoProcessoId: tipo.id } })
    await prisma.tipoProcessoNacionalidade.delete({ where: { id: tipo.id } })
  }
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

  const CHAVE_EM_USO = `${MARCA.toLowerCase()}_em_uso`
  const CHAVE_SEM_USO = `${MARCA.toLowerCase()}_sem_uso`
  const faseEmUso = await prisma.catalogoFase.create({
    data: { phaseKey: CHAVE_EM_USO, label: `[${MARCA}] Fase em uso`, escopo: "PROCESSO", ordemPadrao: 1, requiredPadrao: true, conditionalPadrao: false, ativo: true, status: "PUBLICADA", revisaoAtual: 1, efeitosPermitidos: ["REGISTER_ONLY"] },
  })
  const faseSemUso = await prisma.catalogoFase.create({
    data: { phaseKey: CHAVE_SEM_USO, label: `[${MARCA}] Fase sem uso`, escopo: "PROCESSO", ordemPadrao: 2, requiredPadrao: true, conditionalPadrao: false, ativo: true, status: "PUBLICADA", revisaoAtual: 1, efeitosPermitidos: ["REGISTER_ONLY"] },
  })

  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: MARCA, name: `[${MARCA}] tipo`, paisId: pm.paisId, modalidadeId: pm.id, ativo: true } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: `[${MARCA}] macro`, ativo: true } })
  const faseMacro = await prisma.faseMacro.create({
    data: { macroWorkflowId: macro.id, phaseKey: CHAVE_EM_USO, label: "Fase em uso", ordem: 1, required: true, conditional: false, entryRule: "process_created", showInKanban: true },
  })

  async function chamarDelete(id: number) {
    const res = await DELETE(new NextRequest(`http://localhost/api/gerenciamento/catalogo-fases/${id}`, { method: "DELETE", headers: auth }), { params: Promise.resolve({ id: String(id) }) })
    const j = await res.json().catch(() => ({}))
    return { status: res.status, j }
  }

  console.log("\n1) Item 19 — DELETE de fase EM USO é bloqueado")
  const r1 = await chamarDelete(faseEmUso.id)
  check("409 — recusado, não 200/500", r1.status === 409, JSON.stringify(r1.j))
  check("mensagem nomeia o uso real (1 fluxo)", /usada em 1 fluxo/i.test(r1.j.error ?? ""), r1.j.error)

  const faseAindaExiste = await prisma.catalogoFase.findUnique({ where: { id: faseEmUso.id } })
  check("a linha da fase CONTINUA existindo (nada foi apagado)", faseAindaExiste != null)

  const composicaoIntacta = await prisma.faseMacro.findUnique({ where: { id: faseMacro.id } })
  check("a composição do Workflow Macro que a usa continua intacta (nada parcial)", composicaoIntacta != null && composicaoIntacta.phaseKey === CHAVE_EM_USO)

  const logsAposFalha = await prisma.logAuditoria.count({ where: { entidade: "CatalogoFase", entidadeId: faseEmUso.id, acao: "PHASE_DELETED" } })
  check("nenhum log de exclusão foi criado para a tentativa recusada", logsAposFalha === 0)

  console.log("\n2) Item 20 — DELETE de fase SEM uso é aceito, com auditoria real")
  const usosAntes = await prisma.faseMacro.count({ where: { phaseKey: CHAVE_SEM_USO } })
  check("pré-condição: fase realmente sem uso (0 composições)", usosAntes === 0)

  const r2 = await chamarDelete(faseSemUso.id)
  check("200 — exclusão aceita", r2.status === 200 && r2.j.ok === true, JSON.stringify(r2.j))

  const faseSumiu = await prisma.catalogoFase.findUnique({ where: { id: faseSemUso.id } })
  check("a linha REALMENTE sumiu de CatalogoFase", faseSumiu === null)

  const logExclusao = await prisma.logAuditoria.findFirst({ where: { entidade: "CatalogoFase", entidadeId: faseSemUso.id, acao: "PHASE_DELETED" }, orderBy: { id: "desc" } })
  check("LogAuditoria PHASE_DELETED foi gravado", logExclusao != null, logExclusao ? logExclusao.descricao : "null")
  check("log referencia o usuário que executou", logExclusao?.usuarioId === admin.id)

  console.log("\n3) Segunda tentativa de excluir a fase EM USO continua bloqueada (nada mudou de estado)")
  const r3 = await chamarDelete(faseEmUso.id)
  check("409 de novo — a recusa é estável, não depende de tentativa anterior", r3.status === 409)

  await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: macro.id } })
  await prisma.macroWorkflow.delete({ where: { id: macro.id } })
  await prisma.tipoProcessoNacionalidade.delete({ where: { id: tipo.id } })
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: MARCA.toLowerCase() } } })
  await prisma.usuario.deleteMany({ where: { email: `admin@${MARCA.toLowerCase()}.test` } })

  console.log(`\n=== RESULTADO: ${ok} ok, ${falhou} falhas ===`)
  if (falhou > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
