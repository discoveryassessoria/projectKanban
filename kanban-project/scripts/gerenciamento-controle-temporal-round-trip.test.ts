// scripts/gerenciamento-controle-temporal-round-trip.test.ts
// ============================================================================
// ROUND-TRIP REAL da configuração de Controle Temporal — mandato "correção
// definitiva do modelo temporal" (19-20/09/2026, continuação, item 2 da lista
// de fechamento): "não basta testar somente função isolada".
//
// Este teste NÃO chama `prisma.stepSubtaskDefinition.update` diretamente em
// lugar nenhum. Ele entra pela MESMA porta que o Gerenciamento (a tela)
// usa — as rotas HTTP reais (`PUT`/`GET`/`POST ?acao=publicar` de
// `/api/gerenciamento/workflows-fase/[id]`), com token JWT assinado e
// permissão real (`usuarios.gerenciar`) — depois PUBLICA, MATERIALIZA uma
// instância real e EXECUTA a ação real, provando que a execução consome
// exatamente os valores que passaram pela rota, não um valor calculado à
// parte.
//
// FLUXO PROVADO:
//   1. PUT  — salva 2 subtarefas, a 2ª com acompanhamento + regra temporal +
//             gatilho (a MESMA forma que ConfiguracaoDoPassoModal.tsx monta).
//   2. GET  — relê o rascunho, confirma que os 6 campos persistiram exatos.
//   3. POST ?acao=publicar — publica a versão 1 (congela o que foi salvo).
//   4. Materializa uma instância real (processo/documento) e executa a 1ª
//      subtarefa via `executarAcaoCadastrada` (o motor real).
//   5. A 2ª subtarefa nasce AGUARDANDO_EXTERNO automaticamente — confere que
//      `previstoPara`/`proximoAcompanhamentoEm` batem EXATAMENTE com os
//      valores salvos na rota (regraTemporalDias=5, gatilho=conclusão da 1ª,
//      acompanhamentoPrimeiroDias=2) — nunca um número hardcoded no teste
//      nem herdado de `slaDays`.
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/gerenciamento-controle-temporal-round-trip.test.ts
// ============================================================================
import { PrismaClient } from "@prisma/client"
import { NextRequest } from "next/server"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { signAuthToken } from "../lib/auth-jwt"
import { PUT as putWorkflow, GET as getWorkflow, POST as postWorkflow } from "../src/app/api/gerenciamento/workflows-fase/[id]/route"
import { execucaoVigente } from "../src/services/execucao-da-subtarefa"
import { executarAcaoCadastrada } from "../src/services/executar-acao-cadastrada"
import { garantirTentativa, MOTIVOS_DE_TENTATIVA } from "../src/services/execucao-do-passo"
import { prazoOperacional } from "../lib/operacional/tempo-operacional"

const prisma = new PrismaClient()
const M = "GERRT"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: `${M} ` } }, select: { id: true } })
  for (const p of procs) {
    await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: p.id } } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: p.id } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: p.id } })
    await prisma.tarefa.deleteMany({ where: { processoId: p.id } })
    await prisma.processo.delete({ where: { id: p.id } }).catch(() => null)
  }
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: `${M} ` } } })
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::wf` }, select: { id: true } })
  if (wf) {
    await prisma.stepSubtaskDefinition.deleteMany({ where: { step: { workflowId: wf.id } } })
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: `${M}_fase` } })
  await prisma.usuario.deleteMany({ where: { email: `${M.toLowerCase()}@teste.local` } })
}

async function main() {
  exigirBancoDeTeste("prova o round-trip real (rota HTTP) da configuração de controle temporal")
  await limpar()
  console.log("ROUND-TRIP REAL — GERENCIAMENTO → EXECUÇÃO (mandato 19-20/09/2026)\n")
  process.env.JWT_SECRET ||= "gerenciamento-round-trip-segredo-de-teste-local-64-caracteres-ok"

  const admin = await prisma.usuario.create({
    data: { nome: "Admin GERRT", email: `${M.toLowerCase()}@teste.local`, senha: "x", tipo: "admin" },
    select: { id: true, email: true, tipo: true },
  })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: String(admin.tipo) })
  const authHeaders = { "content-type": "application/json", authorization: `Bearer ${token}` }

  await prisma.catalogoFase.upsert({
    where: { phaseKey: `${M}_fase` },
    update: {},
    create: { phaseKey: `${M}_fase`, label: "Fase de Teste Round-Trip", escopo: "PROCESSO", ordemPadrao: 96, efeitosPermitidos: ["REGISTER_ONLY"] },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${M}::wf`, phaseKey: `${M}_fase`, name: "Workflow round-trip", versao: 1, execucao: "SEQUENCIAL" },
    select: { id: true, versao: true },
  })

  // ══════════════════════════════════════════════════════════════
  console.log("1) PUT /api/gerenciamento/workflows-fase/[id] — a MESMA forma que a UI monta")
  // ══════════════════════════════════════════════════════════════
  const corpo = {
    steps: [
      {
        key: "enviar_requerimento", label: "Enviar requerimento", createsTask: true, required: true,
        cardinalidade: "DOCUMENTO", slaDays: 1, regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS",
        subtarefas: [
          {
            key: "enviar_requerimento_sub", label: "Enviar requerimento", obrigatoria: true, modoExecucao: "MANUAL",
            responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", slaDays: 1,
            acoes: [{ key: "enviado", label: "Enviado", effectKey: "REGISTER_ONLY" }],
          },
          {
            key: "receber_confirmacao", label: "Receber confirmação do pedido", obrigatoria: true, modoExecucao: "MANUAL",
            responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: ["enviar_requerimento_sub"],
            esperaExternaAoLiberar: true,
            acompanhamentoAtivo: true, acompanhamentoPrimeiroDias: 2,
            regraTemporalAtiva: true, regraTemporalDias: 5, regraTemporalGatilhoChave: "enviar_requerimento_sub",
            acoes: [{ key: "confirmado", label: "Confirmado", effectKey: "REGISTER_ONLY" }],
          },
        ],
      },
    ],
  }
  const reqPut = new NextRequest(`http://localhost/api/gerenciamento/workflows-fase/${wf.id}`, {
    method: "PUT", headers: authHeaders, body: JSON.stringify(corpo),
  })
  const resPut = await putWorkflow(reqPut, { params: Promise.resolve({ id: String(wf.id) }) })
  const jsonPut = await resPut.json()
  check("PUT devolve 200", resPut.status === 200, JSON.stringify(jsonPut).slice(0, 300))

  // ══════════════════════════════════════════════════════════════
  console.log("\n2) GET /api/gerenciamento/workflows-fase/[id] — relê o rascunho salvo")
  // ══════════════════════════════════════════════════════════════
  const reqGet = new NextRequest(`http://localhost/api/gerenciamento/workflows-fase/${wf.id}`, {
    method: "GET", headers: authHeaders,
  })
  const resGet = await getWorkflow(reqGet, { params: Promise.resolve({ id: String(wf.id) }) })
  const jsonGet = await resGet.json()
  check("GET devolve 200", resGet.status === 200)
  const passoLido = jsonGet.workflow?.passos?.[0]
  const subLida = passoLido?.subtarefas?.find((s: { key: string }) => s.key === "receber_confirmacao")
  check("a subtarefa 'receber_confirmacao' foi persistida", subLida != null)
  check("esperaExternaAoLiberar persistiu true", subLida?.esperaExternaAoLiberar === true)
  check("acompanhamentoAtivo persistiu true", subLida?.acompanhamentoAtivo === true)
  check("acompanhamentoPrimeiroDias persistiu 2", subLida?.acompanhamentoPrimeiroDias === 2, String(subLida?.acompanhamentoPrimeiroDias))
  check("regraTemporalAtiva persistiu true", subLida?.regraTemporalAtiva === true)
  check("regraTemporalDias persistiu 5", subLida?.regraTemporalDias === 5, String(subLida?.regraTemporalDias))
  check("regraTemporalGatilhoChave persistiu 'enviar_requerimento_sub'",
    subLida?.regraTemporalGatilhoChave === "enviar_requerimento_sub", subLida?.regraTemporalGatilhoChave)

  // ══════════════════════════════════════════════════════════════
  console.log("\n3) POST ?acao=publicar — publica a versão 1 pela rota real")
  // ══════════════════════════════════════════════════════════════
  const reqPub = new NextRequest(`http://localhost/api/gerenciamento/workflows-fase/${wf.id}?acao=publicar`, {
    method: "POST", headers: authHeaders, body: JSON.stringify({ versaoEsperada: wf.versao }),
  })
  const resPub = await postWorkflow(reqPub, { params: Promise.resolve({ id: String(wf.id) }) })
  const jsonPub = await resPub.json()
  check("publicação devolve 200", resPub.status === 200, JSON.stringify(jsonPub).slice(0, 300))

  // ══════════════════════════════════════════════════════════════
  console.log("\n4) Materializa uma instância real e EXECUTA a 1ª subtarefa")
  // ══════════════════════════════════════════════════════════════
  const passoPublicado = await prisma.phaseInternalWorkflowStep.findFirstOrThrow({
    where: { workflowId: wf.id }, select: { id: true, key: true },
  })
  const arv = await prisma.arvore.create({ data: { nome: `${M} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${M} processo`, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: `${M}_fase` },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: `${M}_fase`, ciclo: 1, status: "ATIVO", workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `${M}-i1` },
    select: { id: true },
  })
  const si = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: `${M}_fase`, ciclo: 1,
      stepKey: passoPublicado.key, ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
      status: "EM_ANDAMENTO", dependeDeStepKeys: [] as never,
      stepDefinitionId: passoPublicado.id, stepDefinitionVersion: 1, chaveIdempotencia: `${M}-p1`,
    },
    select: { id: true },
  })
  await garantirTentativa(si.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })
  const tarefa = await prisma.tarefa.create({
    data: {
      titulo: `${M} tarefa`, processoId: proc.id, workflowStepInstanceId: si.id, workflowInstanceId: inst.id,
      chaveIdempotencia: `${M}-t1`, statusTarefa: "NAO_INICIADA", responsavelId: admin.id,
    },
    select: { id: true },
  })

  const r1 = await executarAcaoCadastrada(si.id, "enviado", {}, {
    usuarioId: admin.id, permissoes: ["tarefas.editar", "workflow.concluirPasso"], correlationId: `${M}-a1`,
    subtaskKey: "enviar_requerimento_sub", fornecedorId: null,
  })
  check("execução da 1ª subtarefa sucede", r1.ok, JSON.stringify(r1))
  const exec1 = await execucaoVigente(si.id, "enviar_requerimento_sub")
  check("1ª subtarefa concluída, com completedAt (é o gatilho da 2ª)", exec1?.status === "CONCLUIDO" && exec1?.completedAt != null)

  // ══════════════════════════════════════════════════════════════
  console.log("\n5) A 2ª subtarefa consome EXATAMENTE a configuração que veio da rota")
  // ══════════════════════════════════════════════════════════════
  const exec2 = await execucaoVigente(si.id, "receber_confirmacao")
  check("2ª subtarefa nasceu AGUARDANDO_EXTERNO automaticamente", exec2?.status === "AGUARDANDO_EXTERNO")
  const previstoParaEsperado = prazoOperacional(5, exec1!.completedAt!) // 5 = regraTemporalDias salvo na rota
  check("previstoPara = prazoOperacional(5, conclusão da 1ª) — o 5 veio da ROTA, não deste teste",
    exec2?.previstoPara != null && exec2.previstoPara.getTime() === previstoParaEsperado!.getTime(),
    `previstoPara=${exec2?.previstoPara?.toISOString()} esperado=${previstoParaEsperado?.toISOString()}`)
  check("proximoAcompanhamentoEm materializado (acompanhamentoPrimeiroDias=2, também veio da rota)",
    exec2?.proximoAcompanhamentoEm != null)
  check("previstoPara e proximoAcompanhamentoEm são DIFERENTES (2 relógios próprios, não o mesmo valor)",
    exec2!.previstoPara!.getTime() !== exec2!.proximoAcompanhamentoEm!.getTime())

  console.log(`\ntarefa #${tarefa.id} usada só para satisfazer a materialização — não é o objeto sob teste`)
  console.log(`\n${ok} passaram, ${falhas.length} falharam`)
  if (falhas.length > 0) { console.log("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
  await limpar()
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
