// scripts/operacao-v3-lote-endpoints.test.ts
// ============================================================================
// ETAPA C (fechamento Operação v3, 26/09/2026) — os 3 endpoints de lote, no
// padrão REAL já implementado (lido em src/app/api/operacao/tarefas/*):
//
//   iniciar-lote          — por ITEM: quem não está "a iniciar" (sem órgão,
//                           já tocado, não é o ponto de entrada) é IGNORADO
//                           e reportado; o resto do lote segue.
//   vincular-orgao-lote   — órgão é UM parâmetro do lote inteiro: órgão
//                           inválido/inexistente RECUSA O LOTE INTEIRO (nada
//                           é tocado). Item sem Documento na etapa é
//                           ignorado e reportado, órgão válido.
//   cobrar-todos-vencidos — grava 1 ContatoTerceiro por item chamado; a
//                           MESMA subtarefa escala (SubtaskExecution.escalada)
//                           quando o total de contatos atinge escalarApos
//                           (default 2 sem cadastro — confirmado em
//                           registrarCobranca) — ou seja, escala na 2ª.
//
// Os 3 fazem a MESMA checagem de dono por item: admin age em qualquer
// tarefa; assistente só nas que já são dele (as demais viram "não é o
// responsável", nunca um 403 do lote inteiro).
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { signAuthToken } from "@/lib/auth-jwt"
import { publicarWorkflow } from "@/src/services/publicacao-de-workflow"
import { instanciarWorkflowDaFase } from "@/src/services/phase-workflow"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"
import { materializarSubtarefas, concluirSubtarefaCorrentePeloPasso } from "@/src/services/subtarefas-da-etapa"
import { POST as postIniciarLote } from "@/src/app/api/operacao/tarefas/iniciar-lote/route"
import { POST as postVincularOrgaoLote } from "@/src/app/api/operacao/tarefas/vincular-orgao-lote/route"
import { POST as postCobrarTodosVencidos } from "@/src/app/api/operacao/tarefas/cobrar-todos-vencidos/route"

const MARCA = "OPV3LOTE"
const PHASE_KEY = `${MARCA.toLowerCase()}_fase`

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  const tarefaIds = ts.map((t) => t.id)
  const execs = await prisma.subtaskExecution.findMany({ where: { stepInstance: { processoId: { in: ids } } }, select: { id: true } })
  await prisma.contatoTerceiro.deleteMany({ where: { OR: [{ tarefaId: { in: tarefaIds } }, { subtaskExecutionId: { in: execs.map((e) => e.id) } }] } })
  await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: { in: ids } } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { pessoa: { arvoreId: { in: procs.map((p) => p.arvoreId).filter((x): x is number => x != null) } } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.faseMacro.deleteMany({ where: { phaseKey: PHASE_KEY } })
  await prisma.macroWorkflow.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { wfUid: { startsWith: MARCA } } })
  await prisma.orgaoProtocolo.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } })
}

async function tokenPara(userId: number, email: string, tipo: string): Promise<string> {
  return signAuthToken({ userId, email, tipo, sessaoInicio: Date.now() })
}

function reqPost(url: string, token: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function main() {
  exigirBancoDeTeste("operacao-v3-lote-endpoints.test.ts")
  await limpar()
  console.log("ETAPA C — endpoints de lote (iniciar / vincular-órgão / cobrar-todos-vencidos)\n")

  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
  const tipo = await prisma.tipoProcessoNacionalidade.findFirst({ select: { id: true } })
  if (!tipo) throw new Error("Banco de teste sem nenhum TipoProcessoNacionalidade — rode o seed base primeiro.")
  let habilitacao = await prisma.tipoProcessoModalidadeHabilitada.findFirst({ where: { tipoProcessoId: tipo.id } })
  if (!habilitacao) {
    const modalidade = await prisma.modalidadePais.findFirstOrThrow()
    habilitacao = await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: modalidade.id, ativo: true } })
  }
  const macro = await prisma.macroWorkflow.upsert({
    where: { tipoProcessoId_modalidadeId: { tipoProcessoId: tipo.id, modalidadeId: habilitacao.modalidadeId } },
    update: {}, create: { tipoProcessoId: tipo.id, modalidadeId: habilitacao.modalidadeId, name: `${MARCA} macro` },
    select: { id: true },
  })
  await prisma.faseMacro.upsert({
    where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: PHASE_KEY } },
    update: {}, create: { macroWorkflowId: macro.id, phaseKey: PHASE_KEY, label: PHASE_KEY, ordem: 1 },
    select: { id: true },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}-wf`, phaseKey: PHASE_KEY, name: `${MARCA} wf`, active: true, tipoProcessoId: tipo.id, escopoExecucao: "PROCESSO" },
    select: { id: true },
  })
  const step = await prisma.phaseInternalWorkflowStep.create({
    data: { workflowId: wf.id, key: "solicitar_certidao", label: "Solicitar certidão", ordem: 1, slaDays: 0, cardinalidade: "PROCESSO" },
    select: { id: true },
  })
  const SUBTAREFAS = [
    { key: "enviar", label: "Enviar requerimento", ordem: 1, dependeDe: [] as string[] },
    { key: "confirmar", label: "Confirmar pedido", ordem: 2, dependeDe: ["enviar"], esperaExternaAoLiberar: true, acompanhamentoAtivo: true, acompanhamentoPrimeiroDias: 1 },
    { key: "receber", label: "Receber certidão", ordem: 3, dependeDe: ["confirmar"], esperaExternaAoLiberar: true },
    { key: "conferir", label: "Conferir e validar", ordem: 4, dependeDe: ["receber"] },
  ]
  for (const s of SUBTAREFAS) {
    const criada = await prisma.stepSubtaskDefinition.create({
      data: {
        stepId: step.id, key: s.key, label: s.label, ordem: s.ordem, dependeDe: s.dependeDe,
        esperaExternaAoLiberar: s.esperaExternaAoLiberar ?? false,
        acompanhamentoAtivo: s.acompanhamentoAtivo ?? false,
        acompanhamentoPrimeiroDias: s.acompanhamentoPrimeiroDias ?? null,
      },
      select: { id: true },
    })
    await prisma.stepAction.create({ data: { stepId: step.id, subtaskId: criada.id, key: "concluir", label: "Concluir", ordem: 1, effectKey: "COMPLETE_STEP" } })
  }
  const pub = await publicarWorkflow({ workflowId: wf.id, actorId: null, pularCompetenciaDeEfeito: true })
  ok("0.1) publicação sucede", pub.ok === true, JSON.stringify(pub).slice(0, 150))

  // ── usuários ─────────────────────────────────────────────────────────
  const admin = await prisma.usuario.create({ data: { nome: "Admin Lote", email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" }, select: { id: true } })
  const assistente = await prisma.usuario.create({
    data: { nome: "Assistente Lote", email: `assist@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "assistente", permissoesCustom: { "tarefas.ver": true, "tarefas.editar": true } },
    select: { id: true },
  })
  const outroResponsavel = await prisma.usuario.create({ data: { nome: "Outro Lote", email: `outro@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "assistente" }, select: { id: true } })
  const tokenAdmin = await tokenPara(admin.id, `admin@${MARCA.toLowerCase()}.test`, "admin")
  const tokenAssistente = await tokenPara(assistente.id, `assist@${MARCA.toLowerCase()}.test`, "assistente")

  const orgao = await prisma.orgaoProtocolo.create({ data: { name: `${MARCA} Cartório`, type: "cartorio" }, select: { id: true } })

  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} proc`, arvoreId: arv.id, faseAtualKey: PHASE_KEY, workflowRuntime: "v2", tipoProcessoMotorId: tipo.id, modalidadeId: habilitacao.modalidadeId },
    select: { id: true },
  })
  const inst = await instanciarWorkflowDaFase({ processoId: proc.id, faseMacroKey: PHASE_KEY })
  if (!inst.success) { console.error(inst); await limpar(); process.exit(1) }
  const workflowInstanceId = inst.workflowInstance.id

  // 4 pessoas/documentos sob a MESMA workflowInstance — cada um com um
  // stepInstance/Tarefa próprios, como a Emissão Documental real faz.
  async function criarItem(nome: string, comOrgao: boolean, responsavelId: number): Promise<{ tarefaId: number; stepInstanceId: number; documentoId: number }> {
    const pessoa = await prisma.pessoa.create({ data: { nome, arvoreId: arv.id }, select: { id: true } })
    const documento = await prisma.documento.create({
      data: { pessoaId: pessoa.id, tipo: "CERTIDAO_NASCIMENTO_INTEIRO_TEOR", status: "SOLICITAR", orgaoId: comOrgao ? orgao.id : null },
      select: { id: true },
    })
    const si = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId, processoId: proc.id, faseMacroKey: PHASE_KEY,
        stepKey: "solicitar_certidao", stepDefinitionId: step.id, ordem: 1, documentoId: documento.id,
        status: "DISPONIVEL", chaveIdempotencia: `${MARCA}-si-${documento.id}`,
      },
      select: { id: true },
    })
    const g = await garantirTarefaDePasso({ stepInstanceId: si.id })
    if (!g.success) throw new Error(`garantirTarefaDePasso falhou: ${JSON.stringify(g)}`)
    await materializarSubtarefas({ stepInstanceId: si.id })
    await prisma.tarefa.update({ where: { id: g.tarefa.id }, data: { responsavelId } })
    return { tarefaId: g.tarefa.id, stepInstanceId: si.id, documentoId: documento.id }
  }

  const itemOk = await criarItem("Pessoa A iniciar", true, assistente.id)
  const itemSemOrgao = await criarItem("Pessoa sem orgao", false, assistente.id)
  const itemJaIniciado = await criarItem("Pessoa ja iniciada", true, assistente.id)
  const itemOutroDono = await criarItem("Pessoa outro dono", true, outroResponsavel.id)
  await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: itemJaIniciado.stepInstanceId, executadoPorId: assistente.id, payload: {} })

  // ══════════════════════════════════════════════════════════════════════
  secao("1) INICIAR-LOTE — por item: sem órgão / já iniciado / outro dono são ignorados, o resto segue")
  // ══════════════════════════════════════════════════════════════════════
  const respIniciar = await postIniciarLote(reqPost("/api/operacao/tarefas/iniciar-lote", tokenAssistente, {
    tarefaIds: [itemOk.tarefaId, itemSemOrgao.tarefaId, itemJaIniciado.tarefaId, itemOutroDono.tarefaId],
  }))
  const jsonIniciar = await respIniciar.json()
  ok("1.1) 200", respIniciar.status === 200, String(respIniciar.status))
  ok("1.2) 1 iniciada (só a que estava genuinamente 'a iniciar')", jsonIniciar.iniciadas === 1, JSON.stringify(jsonIniciar))
  ok("1.3) 3 ignoradas", jsonIniciar.ignoradas?.length === 3, JSON.stringify(jsonIniciar.ignoradas))
  const motivoSemOrgao = jsonIniciar.ignoradas?.find((i: { tarefaId: number }) => i.tarefaId === itemSemOrgao.tarefaId)?.motivo
  ok("1.4) sem órgão — motivo menciona órgão", typeof motivoSemOrgao === "string" && motivoSemOrgao.includes("órgão"), motivoSemOrgao)
  const motivoJaIniciado = jsonIniciar.ignoradas?.find((i: { tarefaId: number }) => i.tarefaId === itemJaIniciado.tarefaId)?.motivo
  ok("1.5) já iniciado — motivo diz que não está 'a iniciar'", typeof motivoJaIniciado === "string" && motivoJaIniciado.includes("a iniciar"), motivoJaIniciado)
  const motivoOutroDono = jsonIniciar.ignoradas?.find((i: { tarefaId: number }) => i.tarefaId === itemOutroDono.tarefaId)?.motivo
  ok("1.6) outro dono (assistente) — motivo 'não é o responsável'", motivoOutroDono === "não é o responsável", motivoOutroDono)

  secao("1b) INICIAR-LOTE como ADMIN — outro dono deixa de ser ignorado")
  const respIniciarAdmin = await postIniciarLote(reqPost("/api/operacao/tarefas/iniciar-lote", tokenAdmin, { tarefaIds: [itemOutroDono.tarefaId] }))
  const jsonIniciarAdmin = await respIniciarAdmin.json()
  ok("1b.1) admin inicia a tarefa de outro dono", jsonIniciarAdmin.iniciadas === 1, JSON.stringify(jsonIniciarAdmin))

  // ══════════════════════════════════════════════════════════════════════
  secao("2) VINCULAR-ORGAO-LOTE — órgão inválido recusa o LOTE INTEIRO, nada é tocado")
  // ══════════════════════════════════════════════════════════════════════
  const docsAntes = await prisma.documento.findMany({ where: { id: { in: [itemSemOrgao.documentoId] } }, select: { id: true, orgaoId: true } })
  const respOrgaoInvalido = await postVincularOrgaoLote(reqPost("/api/operacao/tarefas/vincular-orgao-lote", tokenAssistente, {
    tarefaIds: [itemSemOrgao.tarefaId], orgaoId: 999999,
  }))
  const jsonOrgaoInvalido = await respOrgaoInvalido.json()
  ok("2.1) 404 ORGAO_INEXISTENTE", respOrgaoInvalido.status === 404, `${respOrgaoInvalido.status} ${JSON.stringify(jsonOrgaoInvalido)}`)
  const docDepoisInvalido = await prisma.documento.findUnique({ where: { id: itemSemOrgao.documentoId }, select: { orgaoId: true } })
  ok("2.2) nada foi tocado (orgaoId continua null)", docDepoisInvalido?.orgaoId === docsAntes[0].orgaoId, JSON.stringify(docDepoisInvalido))

  secao("2b) VINCULAR-ORGAO-LOTE — órgão válido: vincula o Documento da tarefa")
  const respOrgaoValido = await postVincularOrgaoLote(reqPost("/api/operacao/tarefas/vincular-orgao-lote", tokenAssistente, {
    tarefaIds: [itemSemOrgao.tarefaId], orgaoId: orgao.id,
  }))
  const jsonOrgaoValido = await respOrgaoValido.json()
  ok("2b.1) 200, 1 vinculada", respOrgaoValido.status === 200 && jsonOrgaoValido.vinculadas === 1, JSON.stringify(jsonOrgaoValido))
  const docDepoisValido = await prisma.documento.findUnique({ where: { id: itemSemOrgao.documentoId }, select: { orgaoId: true } })
  ok("2b.2) Documento agora tem o órgão", docDepoisValido?.orgaoId === orgao.id, JSON.stringify(docDepoisValido))

  // ══════════════════════════════════════════════════════════════════════
  secao("3) COBRAR-TODOS-VENCIDOS — 1 ContatoTerceiro por chamada, escala na 2ª")
  // ══════════════════════════════════════════════════════════════════════
  // itemOk já concluiu 'enviar' (passo 1b, admin) — corrente agora é
  // 'confirmar' (espera externa), alvo real de cobrança.
  const r1 = await postCobrarTodosVencidos(reqPost("/api/operacao/tarefas/cobrar-todos-vencidos", tokenAssistente, { tarefaIds: [itemOk.tarefaId] }))
  const j1 = await r1.json()
  ok("3.1) 1ª cobrança sucede", r1.status === 200 && j1.cobradas === 1, JSON.stringify(j1))
  const execApos1 = await prisma.subtaskExecution.findFirst({ where: { stepInstanceId: itemOk.stepInstanceId, subtaskKey: "confirmar", supersededAt: null }, select: { id: true, escalada: true } })
  const contatosApos1 = await prisma.contatoTerceiro.count({ where: { subtaskExecutionId: execApos1?.id } })
  ok("3.2) 1 ContatoTerceiro gravado", contatosApos1 === 1, String(contatosApos1))
  ok("3.3) ainda não escalada (1ª)", execApos1?.escalada === false, String(execApos1?.escalada))

  const r2 = await postCobrarTodosVencidos(reqPost("/api/operacao/tarefas/cobrar-todos-vencidos", tokenAssistente, { tarefaIds: [itemOk.tarefaId] }))
  const j2 = await r2.json()
  ok("3.4) 2ª cobrança sucede", r2.status === 200 && j2.cobradas === 1, JSON.stringify(j2))
  const execApos2 = await prisma.subtaskExecution.findFirst({ where: { stepInstanceId: itemOk.stepInstanceId, subtaskKey: "confirmar", supersededAt: null }, select: { id: true, escalada: true } })
  const contatosApos2 = await prisma.contatoTerceiro.count({ where: { subtaskExecutionId: execApos2?.id } })
  ok("3.5) 2 ContatoTerceiro gravados (1 por chamada)", contatosApos2 === 2, String(contatosApos2))
  ok("3.6) escalada na 2ª", execApos2?.escalada === true, String(execApos2?.escalada))

  secao("3b) COBRAR-TODOS-VENCIDOS — assistente não cobra tarefa de outro dono")
  const rOutro = await postCobrarTodosVencidos(reqPost("/api/operacao/tarefas/cobrar-todos-vencidos", tokenAssistente, { tarefaIds: [itemOutroDono.tarefaId] }))
  const jOutro = await rOutro.json()
  ok("3b.1) 0 cobradas, ignorada 'não é o responsável'", jOutro.cobradas === 0 && jOutro.ignoradas?.[0]?.motivo === "não é o responsável", JSON.stringify(jOutro))

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch(async (e) => { console.error(e); await limpar().catch(() => {}); process.exit(1) }).finally(() => prisma.$disconnect())
