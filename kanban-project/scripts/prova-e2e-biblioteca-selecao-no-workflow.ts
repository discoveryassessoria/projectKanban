// scripts/prova-e2e-biblioteca-selecao-no-workflow.ts
// ============================================================================
// PROVA DE PONTA A PONTA — SELECIONAR TAREFA DA BIBLIOTECA NO WORKFLOW
// INTERNO (mandato "separação Biblioteca × Workflow Interno", 22/09/2026).
//
// Cenário sintético, marcado com o prefixo BIBSEL, contra o BANCO DE TESTE
// local (nunca produção) — NUNCA toca a Nacionalidade Italiana nem qualquer
// tipo/modalidade real. Cobre:
//
//   1) publicar um Modelo na Biblioteca;
//   2) SELECIONAR esse Modelo num passo de um Workflow Interno de fase REAL
//      (via a mesma rota HTTP que a tela usa — PUT /workflows-fase/[id]),
//      nunca criando conteúdo próprio no passo;
//   3) a leitura (GET) devolve o conteúdo EFETIVO resolvido da Biblioteca
//      (subtarefas/campos/ações), nunca vazio;
//   4) validar/publicar o Workflow da fase aplica a competência de efeito da
//      FASE REAL ao conteúdo da Biblioteca (EFEITO_FORA_DE_COMPETENCIA
//      voltaria a valer se a fase não declarasse o efeito usado);
//   5) a versão CONGELADA do Workflow da fase contém o conteúdo resolvido —
//      não um ponteiro vazio;
//   6) a Biblioteca (GET /modelos) lista esta fase em "usadoEm";
//   7) reordenar/remover o passo continua funcionando (mecanismo genérico,
//      não específico de Biblioteca);
//   8) limpeza completa ao final — zero rastro sintético, zero Modalidade/
//      Tipo/CatalogoFase real tocado.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("prova-e2e-biblioteca-selecao-no-workflow.ts")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { criarModelo, publicarModelo } from "../src/services/biblioteca-tarefas/modelo"

const MARCA = "BIBSEL"
const PHASE_KEY = `${MARCA.toLowerCase()}_fase_sintetica`

let ok = 0, falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.error(`  ❌ ${nome}${detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""}`) }
}

async function limpar() {
  const modelos = await prisma.bibliotecaModeloTarefa.findMany({ where: { chave: { startsWith: `${MARCA.toLowerCase()}_` } }, select: { id: true, workflowId: true } })
  const wfsDaFase = await prisma.phaseInternalWorkflow.findMany({ where: { phaseKey: PHASE_KEY }, select: { id: true } })
  const wfIds = [...modelos.map((m) => m.workflowId), ...wfsDaFase.map((w) => w.id)]
  await prisma.bibliotecaModeloTarefa.deleteMany({ where: { id: { in: modelos.map((m) => m.id) } } })
  await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: { in: wfIds } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { id: { in: wfIds } } })
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: PHASE_KEY } })
  await prisma.usuario.deleteMany({ where: { email: `admin@${MARCA.toLowerCase()}.test` } })
}

async function chamar(handler: (req: NextRequest, ctx?: any) => Promise<Response>, method: string, path: string, token: string, body?: unknown, params?: Record<string, string>) {
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }
  if (body !== undefined) init.body = JSON.stringify(body)
  const req = new NextRequest(`http://localhost${path}`, init)
  return params ? handler(req, { params: Promise.resolve(params) }) : handler(req)
}

async function main() {
  console.log(`\n=== Biblioteca de Tarefas — prova e2e SELEÇÃO no Workflow Interno (${MARCA}) ===\n`)
  await limpar()
  const admin = await prisma.usuario.create({ data: { nome: `Admin ${MARCA}`, email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" } })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })

  console.log("0) Fase sintética — CatalogoFase com competência declarada (nunca Italiana)")
  await prisma.catalogoFase.create({
    data: { phaseKey: PHASE_KEY, label: `[${MARCA}] Fase sintética`, escopo: "PROCESSO", ordemPadrao: 1, status: "PUBLICADA", ativo: true, efeitosPermitidos: ["COMPLETE_STEP"] },
  })
  check("0.1) CatalogoFase sintética criada, nunca 'italiana'", PHASE_KEY.includes(MARCA.toLowerCase()))

  console.log("\n1) MODELO — criar e publicar (mesmo caminho da tela Biblioteca)")
  const criado = await criarModelo({ chave: `${MARCA.toLowerCase()}_solicitar_certidao`, nome: "[BIBSEL] Solicitar certidão", criadoPorId: null })
  check("1.1) modelo criado", criado.ok, criado)
  if (!criado.ok) throw new Error("aborta — modelo não criado")

  const passoVivo = await prisma.phaseInternalWorkflowStep.findFirstOrThrow({ where: { workflowId: criado.workflowId } })
  await prisma.phaseInternalWorkflowStep.update({ where: { id: passoVivo.id }, data: { label: "Solicitar certidão", regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS" } })
  const subs = await Promise.all(["enviar_requerimento_cartorio", "receber_confirmacao_pedido", "receber_certidao", "conferir_validar_certidao"].map((key, i) =>
    prisma.stepSubtaskDefinition.create({ data: { stepId: passoVivo.id, key, label: key, ordem: i, obrigatoria: true } })))
  for (const s of subs) await prisma.stepAction.create({ data: { stepId: passoVivo.id, subtaskId: s.id, key: "concluir", label: "Concluir", effectKey: "COMPLETE_STEP", ordem: 0 } })

  const pub = await publicarModelo(criado.modeloId, null)
  check("1.2) modelo publicado", pub.ok, pub)
  const modeloPublicado = await prisma.bibliotecaModeloTarefa.findUniqueOrThrow({ where: { id: criado.modeloId } })
  check("1.3) versaoPublicada existe", modeloPublicado.versaoPublicada != null, modeloPublicado)

  console.log("\n2) WORKFLOW INTERNO DA FASE — criar vazio (mesma porta da tela)")
  const { POST: postWorkflows } = await import("../src/app/api/gerenciamento/workflows-fase/route")
  const rCriar = await chamar(postWorkflows, "POST", "/api/gerenciamento/workflows-fase", token, { criar: true, phaseKey: PHASE_KEY, phaseLabel: "Fase sintética", tipoProcessoId: null })
  const jCriar = await rCriar.json()
  check("2.1) workflow da fase criado", rCriar.status === 201 || rCriar.status === 200, jCriar)
  const workflowId = jCriar.workflow.id as number

  console.log("\n3) SELECIONAR A TAREFA DA BIBLIOTECA — PUT com bibliotecaModeloId, sem conteúdo próprio")
  const { PUT: putWorkflow, GET: getWorkflow, POST: postPublicar } = await import("../src/app/api/gerenciamento/workflows-fase/[id]/route")
  const rSelecionar = await chamar(putWorkflow, "PUT", `/api/gerenciamento/workflows-fase/${workflowId}`, token, {
    steps: [{ key: modeloPublicado.chave, label: modeloPublicado.nome, ordem: 1, createsTask: true, required: true, bibliotecaModeloId: criado.modeloId, bibliotecaModeloVersao: modeloPublicado.versaoPublicada }],
  }, { id: String(workflowId) })
  const jSelecionar = await rSelecionar.json()
  check("3.1) PUT aceito (não recusado por SUBTAREFA_SEM_ACAO/EFEITO_FORA_DE_COMPETENCIA — a fase sintética declara COMPLETE_STEP)", rSelecionar.status === 200, jSelecionar)
  if (rSelecionar.status !== 200) throw new Error(`aborta — PUT falhou: ${JSON.stringify(jSelecionar)}`)

  const passoSelecionado = jSelecionar.workflow.passos[0]
  check("3.2) passo tem bibliotecaModeloId/Versao gravados", passoSelecionado.bibliotecaModeloId === criado.modeloId && passoSelecionado.bibliotecaModeloVersao === modeloPublicado.versaoPublicada)
  const acoesNoPasso = await prisma.stepAction.count({ where: { stepId: passoSelecionado.id } })
  const subsNoPasso = await prisma.stepSubtaskDefinition.count({ where: { stepId: passoSelecionado.id } })
  check("3.3) o passo da FASE não tem nenhuma ação/subtarefa própria gravada (zero cópia editável)", acoesNoPasso === 0 && subsNoPasso === 0, { acoesNoPasso, subsNoPasso })

  console.log("\n4) LEITURA (GET) — conteúdo EFETIVO resolvido, nunca vazio")
  const rGet = await chamar(getWorkflow, "GET", `/api/gerenciamento/workflows-fase/${workflowId}`, token, undefined, { id: String(workflowId) })
  const jGet = await rGet.json()
  const passoLido = jGet.workflow.passos[0]
  check("4.1) conteudoDaBiblioteca resolvido com as 4 subtarefas", passoLido.conteudoDaBiblioteca?.subtarefas?.length === 4, passoLido.conteudoDaBiblioteca?.subtarefas?.map((s: any) => s.key))
  check("4.2) bibliotecaModeloInfo tem o nome/versão do modelo", passoLido.bibliotecaModeloInfo?.chave === modeloPublicado.chave)

  console.log("\n5) PUBLICAR O WORKFLOW DA FASE — congela o conteúdo resolvido, não um ponteiro vazio")
  const rPublicar = await chamar(postPublicar, "POST", `/api/gerenciamento/workflows-fase/${workflowId}?acao=publicar`, token, {}, { id: String(workflowId) })
  const jPublicar = await rPublicar.json()
  check("5.1) publicação aceita", rPublicar.ok, jPublicar)

  const wfAtual = await prisma.phaseInternalWorkflow.findUniqueOrThrow({ where: { id: workflowId } })
  const versaoCongelada = await prisma.phaseInternalWorkflowVersao.findUnique({ where: { workflowId_versao: { workflowId, versao: wfAtual.versao } } })
  const passosCongelados = (versaoCongelada?.passos as any[]) ?? []
  check("5.2) versão congelada do Workflow da FASE tem o conteúdo resolvido (4 subtarefas), não vazio",
    passosCongelados[0]?.subtarefas?.length === 4, passosCongelados[0]?.subtarefas)
  check("5.3) key do passo congelado é a chave do modelo", passosCongelados[0]?.key === modeloPublicado.chave)

  console.log("\n6) A BIBLIOTECA LISTA ESTA FASE EM 'usadoEm'")
  const { GET: getModelos } = await import("../src/app/api/gerenciamento/biblioteca-tarefas/modelos/route")
  const rModelos = await chamar(getModelos, "GET", "/api/gerenciamento/biblioteca-tarefas/modelos", token)
  const jModelos = await rModelos.json()
  const modeloNaLista = jModelos.modelos.find((m: any) => m.id === criado.modeloId)
  check("6.1) modelo aparece com usadoEm contendo esta fase", modeloNaLista?.usadoEm?.some((u: any) => u.phaseKey === PHASE_KEY), modeloNaLista?.usadoEm)

  console.log("\n7) REMOVER O PASSO — mecanismo genérico continua funcionando")
  const rRemover = await chamar(putWorkflow, "PUT", `/api/gerenciamento/workflows-fase/${workflowId}`, token, { steps: [] }, { id: String(workflowId) })
  check("7.1) remover o passo selecionado funciona (PUT com steps:[])", rRemover.status === 200, await rRemover.clone().json().catch(() => null))

  console.log(`\n=== ${ok} passaram, ${falhou} falharam ===`)
  if (falhou > 0) console.error("Falhas:", falhas)

  await limpar()
  console.log("Limpeza concluída — cenário sintético removido. Nenhum Tipo/Modalidade/CatalogoFase real foi tocado.")
  await prisma.$disconnect()
  if (falhou > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  try { await limpar() } catch { /* melhor esforço */ }
  await prisma.$disconnect()
  process.exit(1)
})
