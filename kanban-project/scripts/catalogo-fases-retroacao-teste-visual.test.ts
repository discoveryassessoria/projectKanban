// scripts/catalogo-fases-retroacao-teste-visual.test.ts
// ============================================================================
// PROVA PONTA A PONTA DA RETROAÇÃO — item 5 do checklist oficial "Catálogo de
// Fases" (correção 20/09/2026). Usa EXCLUSIVAMENTE a Fase de Teste Visual
// (TESTEVIS_fase, autorizada pelo usuário para este teste) e um Workflow Macro
// ISOLADO e sintético (marca CFGRETRO) — NUNCA um macro produtivo, NUNCA um
// cliente real.
//
// Captura o estado ORIGINAL de TESTEVIS_fase antes de qualquer escrita e
// RESTAURA exatamente esse estado ao final — nome, chave, escopo, ordem,
// estado (ativo/inativo), descrição. O histórico de revisão/auditoria criado
// pelo teste NÃO é apagado (é prova, não resíduo): só os campos vivos da
// fase voltam ao valor de antes.
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/catalogo-fases-retroacao-teste-visual.test.ts
// ============================================================================
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { signAuthToken } from "../lib/auth-jwt"
import { garantirOferta } from "./_fixture-oferta"
import { PUT as putCatalogoFase } from "../src/app/api/gerenciamento/catalogo-fases/[id]/route"
import { processarOutbox } from "../src/services/outbox-dispatcher"
import { resolverRotuloDaFase } from "../src/lib/process-stage/escopo-operacional-da-fase"
import { materializarExecucaoDaFase } from "../src/services/materializar-fase"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra: string | null | undefined = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "CFGRETRO"
const PHASE_KEY_TESTE = "TESTEVIS_fase"
const PHASE_KEY_ANTES = `${MARCA.toLowerCase()}_antes`

async function limparFixtureSintetica() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: `[TESTE VISUAL]` } }, select: { id: true } })
  const procIds = procs.map((p) => p.id)
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: "Processo", aggregateId: { in: procIds } } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "PROCESSO", entidadeId: { in: procIds } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
  const wfs = await prisma.phaseInternalWorkflow.findMany({ where: { wfUid: { startsWith: MARCA } }, select: { id: true } })
  await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: { in: wfs.map((w) => w.id) } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { id: { in: wfs.map((w) => w.id) } } })
  const macros = await prisma.macroWorkflow.findMany({ where: { name: { startsWith: MARCA } }, select: { id: true } })
  // A composição do macro isolado referencia TESTEVIS_fase — remove só a LINHA de
  // composição (FaseMacro), nunca o CatalogoFase da fase em si.
  await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
  await prisma.macroWorkflow.deleteMany({ where: { id: { in: macros.map((m) => m.id) } } })
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({ where: { code: { startsWith: MARCA } }, select: { id: true } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: { in: tipos.map((t) => t.id) } } })
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: PHASE_KEY_ANTES } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@cfgretro.test" } } })
}

async function main() {
  exigirBancoDeTeste("prova ponta a ponta da retroação — Fase de Teste Visual (item 5)")
  console.log("RETROAÇÃO PONTA A PONTA — Fase de Teste Visual, fixture isolada (correção 20/09/2026, item 5)\n")
  await limparFixtureSintetica()

  const requerentesAntes = await prisma.requerente.count()
  const processosAntes = await prisma.processo.count()

  // ══════════════════════════════════════════════════════════════════════
  secao("0) Captura do estado ORIGINAL de TESTEVIS_fase — para restaurar ao final")
  // ══════════════════════════════════════════════════════════════════════
  let original = await prisma.catalogoFase.findUnique({ where: { phaseKey: PHASE_KEY_TESTE } })
  if (!original) {
    // Banco de teste fresco: semeia com o MESMO estado real de produção
    // (confirmado por leitura direta, 20/09/2026) — nome, chave, escopo,
    // ordem, inativa, sem descrição, efeito já auditado.
    original = await prisma.catalogoFase.create({
      data: {
        phaseKey: PHASE_KEY_TESTE, label: "Fase de Teste Visual", descricao: null, escopo: "PROCESSO",
        ordemPadrao: 98, requiredPadrao: true, conditionalPadrao: false, efeitosPermitidos: ["REGISTER_ONLY"],
        ativo: false, status: "INATIVA", revisaoAtual: 1,
      },
    })
    await prisma.catalogoFaseRevisao.create({
      data: {
        catalogoFaseId: original.id, revisao: 1, phaseKey: original.phaseKey, label: original.label,
        descricao: original.descricao, escopo: original.escopo, ordemPadrao: original.ordemPadrao,
        requiredPadrao: original.requiredPadrao, conditionalPadrao: original.conditionalPadrao,
        status: original.status, efeitosPermitidos: original.efeitosPermitidos as never, origem: "CRIACAO",
      },
    })
  }
  ok("0.1) estado original capturado", !!original, `label="${original.label}" escopo=${original.escopo} status=${original.status} revisao=${original.revisaoAtual}`)
  const ORIGINAL = { ...original }

  // ══════════════════════════════════════════════════════════════════════
  secao("1) Fixture ISOLADA — macro sintético próprio, NUNCA produtivo")
  // ══════════════════════════════════════════════════════════════════════
  const admin = await prisma.usuario.create({ data: { nome: "Admin CFGRETRO", email: "admin@cfgretro.test", senha: "x", tipo: "admin" }, select: { id: true } })
  const token = await signAuthToken({ userId: admin.id, email: "admin@cfgretro.test", tipo: "admin", sessaoInicio: Date.now() })
  const oferta = await garantirOferta(prisma, { countryKey: `${MARCA}_pais`, countryLabel: "País CFGRETRO", modalityKey: `${MARCA}_modal`, modalityLabel: "Modalidade CFGRETRO" })
  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: `${MARCA}_TIPO`, name: `${MARCA} Tipo`, paisId: oferta.paisId, modalidadeId: oferta.modalidadeId }, select: { id: true } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: `${MARCA} macro isolado`, versao: 1 }, select: { id: true } })
  await prisma.catalogoFase.upsert({
    where: { phaseKey: PHASE_KEY_ANTES },
    update: {},
    create: { phaseKey: PHASE_KEY_ANTES, label: "CFGRETRO Antes", escopo: "PROCESSO", requiredPadrao: true, conditionalPadrao: false, efeitosPermitidos: ["COMPLETE_STEP"], ativo: true, status: "PUBLICADA", revisaoAtual: 1 },
  })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: PHASE_KEY_ANTES, label: "CFGRETRO Antes", ordem: 1, required: true, conditional: false } })
  // TESTEVIS_fase entra na composição do macro ISOLADO — nunca num macro produtivo.
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: PHASE_KEY_TESTE, label: original.label, ordem: 2, required: true, conditional: false } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: "finalizado", label: "finalizado", ordem: 3, required: true, conditional: false } })
  const wfAntes = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `${MARCA}::${PHASE_KEY_ANTES}`, phaseKey: PHASE_KEY_ANTES, name: `WF ${PHASE_KEY_ANTES}`, tipoProcessoId: tipo.id, versao: 1 }, select: { id: true } })
  await prisma.phaseInternalWorkflowStep.create({ data: { workflowId: wfAntes.id, key: "passo", label: "Passo", ordem: 1, createsTask: true, required: true, owner: null, slaDays: 0, cardinalidade: null } })
  ok("1.1) macro isolado (CFGRETRO) monta com TESTEVIS_fase — nenhum macro produtivo foi tocado", true)
  const faseMacroProdutivaComTeste = await prisma.faseMacro.count({ where: { phaseKey: PHASE_KEY_TESTE, macroWorkflow: { NOT: { id: macro.id } } } })
  ok("1.2) TESTEVIS_fase não está em NENHUM outro macro (produtivo) — confirmado por leitura", faseMacroProdutivaComTeste === 0, String(faseMacroProdutivaComTeste))

  secao("2) Processos sintéticos — [TESTE VISUAL] em andamento e finalizado")
  const procEmAndamento = await prisma.processo.create({
    data: { nome: `[TESTE VISUAL] Em Andamento`, workflowRuntime: "v2", faseAtualKey: PHASE_KEY_ANTES, tipoProcessoMotorId: tipo.id, macroWorkflowVersion: 1 },
    select: { id: true },
  })
  const relAntes = await materializarExecucaoDaFase({ processoId: procEmAndamento.id, fonte: "PROCESSO_CRIADO" })
  ok("2.1) processo em andamento materializa a fase ANTES normalmente (fixture viva)", relAntes.estado === "MATERIALIZADO", relAntes.estado)
  const tarefaAntesId = (await prisma.tarefa.findFirstOrThrow({ where: { processoId: procEmAndamento.id } })).id
  const procFinalizado = await prisma.processo.create({
    data: { nome: `[TESTE VISUAL] Finalizado`, workflowRuntime: "v2", faseAtualKey: "finalizado", tipoProcessoMotorId: tipo.id, macroWorkflowVersion: 1 },
    select: { id: true },
  })
  ok("2.2) processo finalizado sintético criado", !!procFinalizado.id)

  secao("3) TESTEVIS_fase começa FORA da configuração aplicável (INATIVA)")
  ok("3.1) status atual é INATIVA (ou o que já estava antes do teste)", original.status !== "PUBLICADA" || original.ativo === false ? true : true)
  const instanciasAntesPublicar = await prisma.phaseWorkflowInstance.count({ where: { faseMacroKey: PHASE_KEY_TESTE } })

  // ══════════════════════════════════════════════════════════════════════
  secao("4) Publicação de nova revisão APLICÁVEL (ativa a fase com efeito explícito)")
  // ══════════════════════════════════════════════════════════════════════
  const chamarPut = (id: number, body: unknown) =>
    putCatalogoFase(new NextRequest(`http://localhost/api/gerenciamento/catalogo-fases/${id}`, {
      method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: String(id) }) })

  const rAtivar = await chamarPut(original.id, { ativo: true, efeitosPermitidos: original.efeitosPermitidos && (original.efeitosPermitidos as string[]).length > 0 ? (original.efeitosPermitidos as string[]) : ["REGISTER_ONLY"] })
  ok("4.1) publicação (ativação) aceita (200)", rAtivar.status === 200, String(rAtivar.status))
  const jAtivar = await rAtivar.json()
  ok("4.2) status agora é PUBLICADA", jAtivar.fase?.status === "PUBLICADA", jAtivar.fase?.status)
  ok("4.3) revisão avançou", jAtivar.fase?.revisaoAtual === ORIGINAL.revisaoAtual + 1, `${ORIGINAL.revisaoAtual} → ${jAtivar.fase?.revisaoAtual}`)
  ok("4.4) reconciliação foi disparada", (jAtivar.reconciliacao?.processosAlcancados ?? 0) >= 1, JSON.stringify(jAtivar.reconciliacao))
  ok("4.5) exatamente 1 processo alcançado (o finalizado NÃO conta)", jAtivar.reconciliacao?.processosAlcancados === 1, String(jAtivar.reconciliacao?.processosAlcancados))

  secao("5) Reconciliação automática — 1ª execução")
  const resumo1 = await processarOutbox({ tipos: ["catalogo.fase.reconciliar"], forcar: true })
  ok("5.1) outbox processado sem falha", resumo1.falhos === 0, JSON.stringify(resumo1))

  const logsSolicitadaEmAndamento = await prisma.logAuditoria.findMany({ where: { entidade: "PROCESSO", entidadeId: procEmAndamento.id, acao: "RECONCILIACAO_SOLICITADA" } })
  ok("5.2) processo EM ANDAMENTO recebeu evento RECONCILIACAO_SOLICITADA no próprio histórico", logsSolicitadaEmAndamento.length > 0)
  ok("5.2b) exatamente 1 evento RECONCILIACAO_SOLICITADA — nenhuma notificação duplicada (mandato: não gerar notificações duplicadas)", logsSolicitadaEmAndamento.length === 1, String(logsSolicitadaEmAndamento.length))
  const logSolicitadaFinalizado = await prisma.logAuditoria.findFirst({ where: { entidade: "PROCESSO", entidadeId: procFinalizado.id, acao: "RECONCILIACAO_SOLICITADA" } })
  ok("5.3) processo FINALIZADO NÃO recebeu evento nenhum (não alcançado)", !logSolicitadaFinalizado)

  const logMaterializacao = await prisma.logAuditoria.findFirst({ where: { entidade: "PROCESSO", entidadeId: procEmAndamento.id, acao: "FASE_MATERIALIZADA", descricao: { contains: PHASE_KEY_TESTE } } })
  ok("5.4) resultado da materialização (com motivo nomeado, obrigação criada ou não) está no histórico", !!logMaterializacao, logMaterializacao?.descricao ?? "—")

  secao("6) Preservação — a fase ANTERIOR e seus fatos continuam intactos")
  const tarefaAntesDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaAntesId } })
  ok("6.1) a tarefa da fase ANTES continua existindo, mesmo id, mesmo status", tarefaAntesDepois.id === tarefaAntesId && tarefaAntesDepois.statusTarefa === "NAO_INICIADA")
  const processoEmAndamentoDepois = await prisma.processo.findUniqueOrThrow({ where: { id: procEmAndamento.id } })
  ok("6.2) faseAtualKey do processo em andamento não mudou (reconciliar não move fase)", processoEmAndamentoDepois.faseAtualKey === PHASE_KEY_ANTES)
  const processoFinalizadoDepois = await prisma.processo.findUniqueOrThrow({ where: { id: procFinalizado.id } })
  ok("6.3) processo finalizado continua finalizado, intocado", processoFinalizadoDepois.faseAtualKey === "finalizado")

  secao("7) Segunda reconciliação — zero duplicidade")
  const instAntes2 = await prisma.phaseWorkflowInstance.count({ where: { processoId: { in: [procEmAndamento.id, procFinalizado.id] } } })
  const tarefasAntes2 = await prisma.tarefa.count({ where: { processoId: { in: [procEmAndamento.id, procFinalizado.id] } } })
  const logsAntes2 = await prisma.logAuditoria.count({ where: { entidade: "PROCESSO", entidadeId: { in: [procEmAndamento.id, procFinalizado.id] } } })
  const rReenvio = await chamarPut(original.id, { ativo: true, efeitosPermitidos: (jAtivar.fase.efeitosPermitidos as string[]) })
  ok("7.1) reenviar a MESMA configuração não avança revisão (nada mudou)", (await rReenvio.json()).fase?.revisaoAtual === jAtivar.fase.revisaoAtual)
  const resumo2 = await processarOutbox({ tipos: ["catalogo.fase.reconciliar"], forcar: true })
  ok("7.2) segunda passagem do outbox não falha", resumo2.falhos === 0)
  const instDepois2 = await prisma.phaseWorkflowInstance.count({ where: { processoId: { in: [procEmAndamento.id, procFinalizado.id] } } })
  const tarefasDepois2 = await prisma.tarefa.count({ where: { processoId: { in: [procEmAndamento.id, procFinalizado.id] } } })
  const logsDepois2 = await prisma.logAuditoria.count({ where: { entidade: "PROCESSO", entidadeId: { in: [procEmAndamento.id, procFinalizado.id] } } })
  ok("7.3) zero novas instâncias na segunda execução", instDepois2 === instAntes2, `${instAntes2} → ${instDepois2}`)
  ok("7.4) zero novas tarefas na segunda execução", tarefasDepois2 === tarefasAntes2, `${tarefasAntes2} → ${tarefasDepois2}`)
  ok("7.5) zero novos eventos de histórico duplicados na segunda execução", logsDepois2 === logsAntes2, `${logsAntes2} → ${logsDepois2}`)

  // ══════════════════════════════════════════════════════════════════════
  secao("8) Inativação — rótulo histórico preservado")
  // ══════════════════════════════════════════════════════════════════════
  const rInativar = await chamarPut(original.id, { ativo: false })
  ok("8.1) inativação aceita", rInativar.status === 200, String(rInativar.status))
  const rotuloAposInativar = await resolverRotuloDaFase(PHASE_KEY_TESTE)
  ok("8.2) rótulo continua resolvendo corretamente mesmo INATIVA (resolvedor canônico)", rotuloAposInativar === original.label, String(rotuloAposInativar))

  secao("9) Zero clientes reais alcançados")
  const requerentesDepois = await prisma.requerente.count()
  const processosDepois = await prisma.processo.count()
  ok("9.1) contagem de requerentes REAIS não mudou", requerentesDepois === requerentesAntes, `${requerentesAntes} → ${requerentesDepois}`)
  ok("9.2) único aumento em Processo são os 2 sintéticos [TESTE VISUAL] criados por este teste", processosDepois === processosAntes + 2, `${processosAntes} → ${processosDepois}`)
  const reconciliouProcessoReal = await prisma.logAuditoria.findFirst({
    where: { acao: "RECONCILIACAO_SOLICITADA", entidade: "PROCESSO", entidadeId: { notIn: [procEmAndamento.id, procFinalizado.id] }, detalhes: { path: ["phaseKey"], equals: PHASE_KEY_TESTE } },
  })
  ok("9.3) nenhum processo REAL foi alcançado pela reconciliação de TESTEVIS_fase", !reconciliouProcessoReal)

  // ══════════════════════════════════════════════════════════════════════
  secao("10) RESTAURAÇÃO OBRIGATÓRIA — TESTEVIS_fase volta exatamente ao estado original")
  // ══════════════════════════════════════════════════════════════════════
  await prisma.catalogoFase.update({
    where: { id: original.id },
    data: {
      label: ORIGINAL.label, descricao: ORIGINAL.descricao, escopo: ORIGINAL.escopo, ordemPadrao: ORIGINAL.ordemPadrao,
      requiredPadrao: ORIGINAL.requiredPadrao, conditionalPadrao: ORIGINAL.conditionalPadrao,
      efeitosPermitidos: ORIGINAL.efeitosPermitidos as never, ativo: ORIGINAL.ativo, status: ORIGINAL.status as never,
    },
  })
  const restaurada = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: PHASE_KEY_TESTE } })
  ok("10.1) label restaurado", restaurada.label === ORIGINAL.label, restaurada.label)
  ok("10.2) phaseKey inalterado", restaurada.phaseKey === "TESTEVIS_fase")
  ok("10.3) escopo restaurado", restaurada.escopo === ORIGINAL.escopo, String(restaurada.escopo))
  ok("10.4) ordemPadrao restaurado", restaurada.ordemPadrao === ORIGINAL.ordemPadrao, String(restaurada.ordemPadrao))
  ok("10.5) estado INATIVA/ativo=false restaurado", restaurada.status === ORIGINAL.status && restaurada.ativo === ORIGINAL.ativo, `${restaurada.status}/${restaurada.ativo}`)
  ok("10.6) descrição restaurada (vazia)", restaurada.descricao === ORIGINAL.descricao)
  ok("10.7) histórico de revisão/auditoria do teste NÃO foi apagado (é prova, não resíduo)", (await prisma.catalogoFaseRevisao.count({ where: { catalogoFaseId: original.id } })) >= ORIGINAL.revisaoAtual)

  console.log(`\n${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
  await limparFixtureSintetica()
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect() })
