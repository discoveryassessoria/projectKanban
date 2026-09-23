// scripts/prova-biblioteca-salvar-sem-competencia-de-fase.test.ts
// ============================================================================
// PROVA — a Biblioteca de Tarefas pode cadastrar e publicar suas próprias
// ações sem depender de "competência" de fase (mandato "corrija a separação
// entre Biblioteca de Tarefas e Workflow Interno", 23/09/2026, item 1).
//
// ─── O BUG REAL ─────────────────────────────────────────────────────────
// Ao editar um Modelo (ex.: "Solicitar certidão", 4 subtarefas, cada uma com
// uma ação "Concluir" → COMPLETE_STEP), a tela mostrava "Concluir —
// indisponível" e SALVAR recusava com "a fase não tem competência para
// executar" os resultados das subtarefas.
//
// A "casca" do Modelo nasce com `phaseKey="biblioteca"`, que NUNCA tem
// `CatalogoFase` correspondente (deliberado — fica fora do catálogo
// oficial). `efeitosDaFase` já seguia a regra "ausência não autoriza" —
// então phaseKey="biblioteca" sempre devolvia `[]`, e QUALQUER efeito virava
// "fora de competência". O mecanismo para isto já existia
// (`pularCompetenciaDeEfeito`, usado por `publicarModelo`) — mas dois outros
// chamadores da MESMA validação nunca o receberam:
//
//   1. `PUT /api/gerenciamento/workflows-fase/[id]` — a porta real de SALVAR
//      o conteúdo do passo (chamada pelo editor a cada "Salvar rascunho"),
//      que roda `validarWorkflowParaPublicar` SEM a flag. Este é o bloqueio
//      que a usuária via ao tentar salvar.
//   2. `GET .../workflows-fase/[id]?preview=1` — a prévia de publicação.
//   3. `GET /api/gerenciamento/catalogo-execucao?phaseKey=biblioteca` — de
//      onde a tela lê quais efeitos oferecer; SEM o desvio, TODO efeito
//      chegava marcado `permitidoNestaFase: false`, e é daí que vinha
//      "Concluir — indisponível" no dropdown da subtarefa.
//
// Os dois scripts e2e existentes (`prova-e2e-biblioteca-modelos.ts`,
// `prova-e2e-biblioteca-selecao-no-workflow.ts`) NUNCA pegaram este bug
// porque os dois escrevem o conteúdo do passo (`StepAction`/
// `StepSubtaskDefinition`) DIRETO no Prisma — nunca passam pela rota PUT
// real que o editor usa. Este teste passa pela ROTA REAL (o mesmo caminho
// que a tela percorre), porque é exatamente aí que o bug vivia.
//
// ─── O QUE ESTE TESTE PROVA ─────────────────────────────────────────────
//   1) Salvar (PUT) um Modelo com 4 subtarefas COMPLETE_STEP — mesmo
//      desenho de "Solicitar certidão" — não é mais recusado por
//      EFEITO_FORA_DE_COMPETENCIA.
//   2) O catálogo de execução (GET) devolve COMPLETE_STEP como
//      `permitidoNestaFase: true` para phaseKey="biblioteca".
//   3) Publicar o Modelo continua funcionando (sem apagar nada).
//   4) "Não há alteração para publicar" é mensagem SEPARADA de erro de
//      validação — nunca mascara um problema real.
//   5) CONTROLE — a mesma configuração, numa fase REAL sem o efeito
//      declarado em `CatalogoFase.efeitosPermitidos`, CONTINUA recusada
//      por EFEITO_FORA_DE_COMPETENCIA: a correção não desligou a
//      validação, só a resolveu para o caso da Biblioteca.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("prova-biblioteca-salvar-sem-competencia-de-fase.test.ts")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { criarModelo, publicarModelo } from "../src/services/biblioteca-tarefas/modelo"
import { PUT, GET } from "../src/app/api/gerenciamento/workflows-fase/[id]/route"
import { GET as GET_CATALOGO } from "../src/app/api/gerenciamento/catalogo-execucao/route"

const MARCA = "BIBCOMP"
const PHASE_KEY_CONTROLE = `${MARCA.toLowerCase()}_fase_controle`

let ok = 0, falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.error(`  ❌ ${nome}${detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""}`) }
}

async function limpar() {
  const modelos = await prisma.bibliotecaModeloTarefa.findMany({ where: { chave: { startsWith: `${MARCA.toLowerCase()}_` } }, select: { id: true, workflowId: true } })
  await prisma.bibliotecaModeloTarefa.deleteMany({ where: { id: { in: modelos.map((m) => m.id) } } })
  await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: { in: modelos.map((m) => m.workflowId) } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { id: { in: modelos.map((m) => m.workflowId) } } })
  const wfControle = await prisma.phaseInternalWorkflow.findMany({ where: { phaseKey: PHASE_KEY_CONTROLE }, select: { id: true } })
  await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: { in: wfControle.map((w) => w.id) } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { phaseKey: PHASE_KEY_CONTROLE } })
  await prisma.usuario.deleteMany({ where: { email: `admin@${MARCA.toLowerCase()}.test` } })
}

/** O corpo de 4 subtarefas "Solicitar certidão", cada uma com Concluir=COMPLETE_STEP. */
function corpoDoPasso(chaveOuLabel: { key: string; label: string }) {
  const subKeys = ["enviar_requerimento", "receber_confirmacao_pedido", "receber_certidao", "conferir_validar_certidao"]
  return {
    steps: [{
      key: chaveOuLabel.key, label: chaveOuLabel.label, createsTask: true, required: true,
      regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS", slaDays: 15,
      subtarefas: subKeys.map((k, i) => ({
        key: k, label: k, ordem: i, obrigatoria: true,
        dependeDe: i > 0 ? [subKeys[i - 1]] : [],
        acoes: [{ key: "concluir", label: "Concluir", effectKey: "COMPLETE_STEP", ordem: 0 }],
      })),
    }],
  }
}

async function main() {
  console.log(`\n=== PROVA — Biblioteca salva/publica sem competência de fase (${MARCA}) ===\n`)
  await limpar()
  const admin = await prisma.usuario.create({ data: { nome: MARCA, email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" } })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })
  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${token}` }

  console.log("1) SALVAR (PUT real) um Modelo com 4 subtarefas COMPLETE_STEP — o desenho de 'Solicitar certidão'")
  const chave = `${MARCA.toLowerCase()}_solicitar_certidao`
  const criado = await criarModelo({ chave, nome: "[BIBCOMP] Solicitar certidão", descricao: "prova", criadoPorId: admin.id })
  check("1.1) modelo criado", criado.ok, criado)
  if (!criado.ok) throw new Error("aborta — modelo não criado")

  const resSalvar = await PUT(new NextRequest(`http://localhost/api/gerenciamento/workflows-fase/${criado.workflowId}`, {
    method: "PUT", headers: auth,
    body: JSON.stringify(corpoDoPasso({ key: chave, label: "Solicitar certidão" })),
  }), { params: Promise.resolve({ id: String(criado.workflowId) }) })
  const bodySalvar = await resSalvar.json().catch(() => null)
  check("1.2) SALVAR aceita (200) — antes era 422 EFEITO_FORA_DE_COMPETENCIA", resSalvar.status === 200, { status: resSalvar.status, body: bodySalvar })

  console.log("\n2) CATÁLOGO DE EXECUÇÃO — COMPLETE_STEP disponível para phaseKey=biblioteca")
  const resCat = await GET_CATALOGO(new NextRequest("http://localhost/api/gerenciamento/catalogo-execucao?phaseKey=biblioteca", { headers: auth }))
  const catalogo = await resCat.json()
  const completeStep = (catalogo.efeitos as Array<{ key: string; permitidoNestaFase: boolean }>).find((e) => e.key === "COMPLETE_STEP")
  check("2.1) COMPLETE_STEP existe no catálogo devolvido", !!completeStep, catalogo.efeitos?.map((e: { key: string }) => e.key))
  check("2.2) COMPLETE_STEP permitidoNestaFase=true (antes vinha false, e a tela mostrava 'indisponível')", completeStep?.permitidoNestaFase === true, completeStep)

  console.log("\n3) PRÉVIA (GET ?preview=1) — sem EFEITO_FORA_DE_COMPETENCIA")
  const resPreview = await GET(new NextRequest(`http://localhost/api/gerenciamento/workflows-fase/${criado.workflowId}?preview=1`, { headers: auth }),
    { params: Promise.resolve({ id: String(criado.workflowId) }) })
  const preview = (await resPreview.json()).preview
  const problemasCompetencia = (preview?.problemas ?? []).filter((p: { codigo: string }) => p.codigo === "EFEITO_FORA_DE_COMPETENCIA")
  check("3.1) prévia sem problema de competência", problemasCompetencia.length === 0, preview?.problemas)
  check("3.2) prévia tem alteração pendente para publicar (temRascunho)", preview?.temRascunho === true, preview)
  check("3.3) prévia diz que PODE publicar", preview?.podePublicar === true, preview)

  console.log("\n4) PUBLICAR — continua funcionando, nada foi apagado para 'resolver' o erro")
  const pub = await publicarModelo(criado.modeloId, admin.id)
  check("4.1) publica com sucesso", pub.ok, pub)
  if (pub.ok) {
    const subs = await prisma.stepSubtaskDefinition.count({ where: { step: { workflowId: criado.workflowId } } })
    check("4.2) as 4 subtarefas continuam cadastradas (nada foi apagado)", subs === 4, subs)
    const acoes = await prisma.stepAction.count({ where: { step: { workflowId: criado.workflowId } }, })
    check("4.3) as 4 ações COMPLETE_STEP continuam cadastradas", acoes === 4, acoes)
  }

  console.log("\n5) 'NÃO HÁ ALTERAÇÃO PARA PUBLICAR' é mensagem separada, nunca mascara erro de validação")
  const resPreview2 = await GET(new NextRequest(`http://localhost/api/gerenciamento/workflows-fase/${criado.workflowId}?preview=1`, { headers: auth }),
    { params: Promise.resolve({ id: String(criado.workflowId) }) })
  const preview2 = (await resPreview2.json()).preview
  check("5.1) sem mudança desde a publicação: temRascunho=false", preview2?.temRascunho === false, preview2)
  check("5.2) sem mudança E sem problema: podePublicar=false só por falta de rascunho, não por erro escondido", preview2?.podePublicar === false && (preview2?.problemas ?? []).length === 0, preview2)
  // A rejeição de publicar-sem-mudança é uma mensagem PRÓPRIA, nunca lida a
  // partir de `problemas` — ver `publicarWorkflow`: `preview.problemas.length > 0`
  // é checado ANTES de `!preview.temRascunho`, então um problema real nunca
  // fica escondido atrás de "sem alteração".
  const pub2 = await publicarModelo(criado.modeloId, admin.id)
  check("5.3) publicar de novo sem mudança nenhuma: aceito como SEM_ALTERACOES (versão não anda), não um erro de competência disfarçado", pub2.ok && pub2.versaoNova === pub2.versaoAnterior, pub2)

  console.log("\n6) CONTROLE — a mesma configuração, numa fase REAL sem o efeito declarado, CONTINUA recusada")
  const wfControle = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `all::${PHASE_KEY_CONTROLE}`, phaseKey: PHASE_KEY_CONTROLE, name: `[${MARCA}] Fase de controle`, tipoProcessoId: null, execucao: "SEQUENCIAL" },
  })
  // Fase de controle SEM `CatalogoFase` (e portanto sem `efeitosPermitidos`)
  // — `efeitosDaFase` devolve `[]`, exatamente como a Biblioteca ANTES do
  // desvio. Se o PUT aceitasse isto também, a correção teria desligado a
  // validação de competência por completo, em vez de resolvê-la só para a
  // Biblioteca — o que o mandato proíbe explicitamente.
  const resControle = await PUT(new NextRequest(`http://localhost/api/gerenciamento/workflows-fase/${wfControle.id}`, {
    method: "PUT", headers: auth,
    body: JSON.stringify(corpoDoPasso({ key: "passo_controle", label: "Passo de controle" })),
  }), { params: Promise.resolve({ id: String(wfControle.id) }) })
  const bodyControle = await resControle.json().catch(() => null)
  check("6.1) SALVAR recusado (422) numa fase real sem competência declarada", resControle.status === 422, { status: resControle.status, body: bodyControle })
  const temCompetenciaNoErro = Array.isArray(bodyControle?.problemas) && bodyControle.problemas.some((p: { codigo: string }) => p.codigo === "EFEITO_FORA_DE_COMPETENCIA")
  check("6.2) o motivo é EFEITO_FORA_DE_COMPETENCIA — a validação real continua ativa fora da Biblioteca", temCompetenciaNoErro, bodyControle?.problemas)

  console.log(`\n=== ${ok} passaram, ${falhou} falharam ===`)
  if (falhou > 0) console.error("Falhas:", falhas)

  await limpar()
  console.log("Limpeza concluída — cenário sintético removido.")
  await prisma.$disconnect()
  if (falhou > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  try { await limpar() } catch { /* melhor esforço */ }
  await prisma.$disconnect()
  process.exit(1)
})
