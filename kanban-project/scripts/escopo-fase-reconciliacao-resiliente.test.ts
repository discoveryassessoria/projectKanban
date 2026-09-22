// scripts/escopo-fase-reconciliacao-resiliente.test.ts
//
// MANDATO "MÓDULO DE FASES" (21/09/2026), Mandato #3 — Defeito 2, causa raiz
// REAL encontrada com evidência forense em produção: a fase
// `auditoria_final_fase_sintetica` tinha uma CatalogoFaseRevisao #8 (escopo
// DOCUMENTO) gravada no banco SEM NENHUM LogAuditoria/DomainOutbox
// correspondente — prova de que a transação que salva a fase comitou, mas o
// código DEPOIS dela (a chamada a `enqueueReconciliacaoCatalogoFase`) lançou
// uma exceção que caiu no catch genérico da rota (500 "Erro ao salvar a
// fase"), sem nunca escrever o log nem o outbox. Do ponto de vista do admin:
// clicou Salvar, o botão ficou ocupado por alguns segundos, depois nada —
// nem sucesso nem erro — mesmo a fase já tendo sido alterada de verdade.
//
// A correção: a chamada a `enqueueReconciliacaoCatalogoFase` agora está
// isolada em seu próprio try/catch — uma falha ali NUNCA reverte nem esconde
// o fato já commitado. Este teste prova a FORMA da resposta (o contrato que
// o cliente passa a poder confiar): `fase` sempre presente quando a revisão
// foi salva, `reconciliacaoErro` sempre um campo explícito (null no caminho
// feliz), e o LogAuditoria sempre escrito com o mesmo campo.
//
// Fixture 100% genérica e sintética própria — nunca TESTEVIS_fase nem
// auditoria_final_fase_sintetica (essas só em produção, conforme mandato).
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("escopo-fase-reconciliacao-resiliente.test.ts")

import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { PUT } from "../src/app/api/gerenciamento/catalogo-fases/[id]/route"
import { NextRequest } from "next/server"

const MARCA = "RESILIENCIAESCOPO"
const CHAVE = `${MARCA.toLowerCase()}_fase`

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
  const fase = await prisma.catalogoFase.findUnique({ where: { phaseKey: CHAVE } })
  if (fase) {
    await prisma.logAuditoria.deleteMany({ where: { entidade: "CatalogoFase", entidadeId: fase.id } })
    await prisma.domainOutbox.deleteMany({ where: { payload: { path: ["catalogoFaseId"], equals: fase.id } } })
    await prisma.catalogoFaseRevisao.deleteMany({ where: { catalogoFaseId: fase.id } })
    await prisma.catalogoFase.delete({ where: { id: fase.id } })
  }
}

async function main() {
  await limpar()
  const admin = await prisma.usuario.create({ data: { nome: MARCA, email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" } })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })
  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${token}` }

  await prisma.catalogoFase.create({
    data: { phaseKey: CHAVE, label: `[${MARCA}] Fase`, escopo: "PROCESSO", ordemPadrao: 1, requiredPadrao: true, conditionalPadrao: false, ativo: true, status: "PUBLICADA", revisaoAtual: 1, efeitosPermitidos: ["REGISTER_ONLY"] },
  })
  const fase = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: CHAVE } })

  console.log("\n1) Mudar escopo de fase SEM uso: 200, fase persistida, reconciliacaoErro explicitamente null")
  const res = await PUT(
    new NextRequest(`http://localhost/api/gerenciamento/catalogo-fases/${fase.id}`, {
      method: "PUT", headers: auth,
      body: JSON.stringify({ phaseKey: fase.phaseKey, label: fase.label, escopo: "DOCUMENTO", efeitosPermitidos: fase.efeitosPermitidos, ordemPadrao: fase.ordemPadrao, requiredPadrao: fase.requiredPadrao, conditionalPadrao: fase.conditionalPadrao, ativo: fase.ativo, id: fase.id }),
    }),
    { params: Promise.resolve({ id: String(fase.id) }) },
  )
  const j = await res.json()
  check("status 200", res.status === 200, String(res.status))
  check("fase presente na resposta com o novo escopo", j.fase?.escopo === "DOCUMENTO", JSON.stringify(j.fase?.escopo))
  check("reconciliacao presente (caminho feliz)", j.reconciliacao != null, JSON.stringify(j.reconciliacao))
  // O CAMPO EXISTE E É EXPLICITAMENTE null — nunca `undefined` silencioso — é
  // esse contrato que o cliente passa a poder checar (`if (j.reconciliacaoErro)`)
  // sem depender de "a chave nem existe" também significar "deu tudo certo".
  check("reconciliacaoErro é EXPLICITAMENTE null no caminho feliz (campo sempre presente)", "reconciliacaoErro" in j && j.reconciliacaoErro === null, JSON.stringify(j.reconciliacaoErro))

  const persistido = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: CHAVE }, select: { escopo: true, revisaoAtual: true } })
  check("persistiu de verdade no banco", persistido.escopo === "DOCUMENTO" && persistido.revisaoAtual === 2, JSON.stringify(persistido))

  console.log("\n2) LogAuditoria escrito com o mesmo campo — o histórico nunca fica vazio pra uma revisão real")
  const log = await prisma.logAuditoria.findFirst({ where: { entidade: "CatalogoFase", entidadeId: fase.id }, orderBy: { id: "desc" } })
  check("existe log para esta revisão", log != null, log ? `#${log.id} ${log.acao}` : "null")
  const detalhes = log?.detalhes as { reconciliacaoErro?: unknown; revisao?: number } | null
  check("log.detalhes.reconciliacaoErro é null (não omitido)", detalhes != null && "reconciliacaoErro" in detalhes && detalhes.reconciliacaoErro === null, JSON.stringify(detalhes?.reconciliacaoErro))
  check("log referencia a revisão 2 (a que acabou de ser salva)", detalhes?.revisao === 2, String(detalhes?.revisao))

  await limpar()
  console.log(`\n=== RESULTADO: ${ok} ok, ${falhou} falhas ===`)
  if (falhou > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
