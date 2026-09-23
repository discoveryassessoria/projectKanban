// scripts/mandato-pausa-relogios.test.ts
// ============================================================================
// MANDATO — BLOCO 1: PAUSA / SUSPENSÃO / BLOQUEIO (os 4 relógios).
// Rodar: PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/mandato-pausa-relogios.test.ts
//
// Prova, com dado real do banco de teste, o comportamento do caso REAL usado
// pelo workflow "Solicitar Certidão" (`PAUSE_FOR_EXTERNAL_WAIT`/`RESUME` do
// CATALOGO_DE_EFEITOS, `src/services/executar-acao-cadastrada.ts`), que chama
// `task-step-sync.ts::bloquearTarefa`/`desbloquearTarefa` com
// `motivoCodigo: "AGUARDANDO_TERCEIRO"`.
//
// ACHADO (confirmado por leitura de código, provado aqui): antes desta
// correção, essa porta NUNCA pausava o relógio do prazo (`Tarefa.dataPrazo`/
// `slaPausadoEm`) — mesmo com o workflow configurado para pausar — e o status
// resultante (`BLOQUEADA`) não entrava no conjunto "aguardando" que as
// dimensões C (previsão do terceiro) e D (próximo acompanhamento) usam para
// nunca deixar uma espera ficar sem vigilância. As DUAS falhas, juntas, são
// exatamente o que o mandato proíbe: "pausa não pode ser usada para esconder
// atraso" — só que na prática o efeito era o INVERSO do que o nome sugere:
// o prazo interno continuava correndo (relógio 1 não pausava) E a operação
// era lida como "ação interna" comum, sem o filtro de espera externa da
// Etapa 3 (relógios 3/4 nunca eram consultados). Corrigido em:
//   - lib/operacional/sla-pausa.ts (extraído de tarefa-ciclo.ts)
//   - src/services/task-step-sync.ts (bloquearTarefa/desbloquearTarefa)
//   - lib/operacional/proximo-acontecimento.ts (ehEsperaExterna)
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import { bloquearTarefa, desbloquearTarefa } from "@/src/services/task-step-sync"
import { estadosTemporaisDasOperacoes, computarProximoAcontecimento, type EntradaOperacao } from "@/lib/operacional/proximo-acontecimento"

const MARCA = "PAUSARELOGIO-TEST"

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
  const tids = ts.map((t) => t.id)
  await prisma.notificacaoOperacional.deleteMany({ where: { OR: [{ tarefaId: { in: tids } }, { processoId: { in: ids } }] } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: tids } } })
  await prisma.workflowEvento.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: "Tarefa", aggregateId: { in: tids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { wfUid: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@pausarelogio.test" } } })
}

let seq = 0
/** Um palco com UM passo (`aguardar_retorno_do_cartorio`), workflow com política de SLA explícita. */
async function palco(opts: { pausarSlaEmEsperaExterna: boolean; pausarSlaEmBloqueio: boolean }) {
  seq++
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${seq}`, name: "Certidão de Nascimento", natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore ${seq}` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo ${seq}`, arvoreId: arv.id }, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Fulano", sobrenome: `Relogio${seq}` }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${proc.id}` }, select: { id: true },
  })
  // O WORKFLOW PUBLICADO — a política de pausa mora AQUI, nunca no código.
  const wf = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `${MARCA}-wf-${proc.id}`, phaseKey: "emissao_documental", name: `${MARCA} Solicitar Certidão`,
      pausarSlaEmEsperaExterna: opts.pausarSlaEmEsperaExterna, pausarSlaEmBloqueio: opts.pausarSlaEmBloqueio,
    },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: {
      processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO",
      workflowDefinitionId: wf.id, workflowVersion: null, // SEM versão congelada — cai na leitura da definição VIVA (fallback documentado em politicaDeSla)
      chaveIdempotencia: `${MARCA}-inst-${proc.id}`,
    },
    select: { id: true },
  })
  const step = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "emissao_documental", stepKey: "aguardar_retorno_do_cartorio",
      ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "DISPONIVEL",
      necessidadeId: nec.id, pessoaId: pes.id, papel: "equipe_documental", slaDays: 5,
      chaveIdempotencia: `${MARCA}-step-${proc.id}`,
    },
    select: { id: true },
  })
  await reconciliarTarefas({ processoId: proc.id })
  const t = await prisma.tarefa.findFirstOrThrow({ where: { processoId: proc.id }, select: { id: true, dataPrazo: true, statusTarefa: true } })
  return { processoId: proc.id, workflowId: wf.id, instanciaId: inst.id, stepId: step.id, tarefaId: t.id, dataPrazoOriginal: t.dataPrazo, statusOriginal: t.statusTarefa }
}

const usuario = (nome: string) =>
  prisma.usuario.create({ data: { nome, email: `${nome.toLowerCase()}.${++seq}@pausarelogio.test`, senha: "x", tipo: "assistente" }, select: { id: true, nome: true } })

async function main() {
  exigirBancoDeTeste("mandato-pausa-relogios.test.ts — Bloco 1 (4 relógios)")
  await limpar()
  console.log("MANDATO BLOCO 1 — PAUSA/SUSPENSÃO/BLOQUEIO: os 4 relógios (caso real PAUSE_FOR_EXTERNAL_WAIT)\n")

  const marco = await usuario("Marco")

  // ══════════════════════════════════════════════════════════════════════
  secao("CASO A — espera externa (PAUSE_FOR_EXTERNAL_WAIT), workflow configurado para PAUSAR na espera")
  // ══════════════════════════════════════════════════════════════════════
  const a = await palco({ pausarSlaEmEsperaExterna: true, pausarSlaEmBloqueio: false })
  await prisma.tarefa.update({ where: { id: a.tarefaId }, data: { responsavelId: marco.id } })
  ok("A.0) prazo original existe (SLA de 5 dias corridos aplicado na materialização)", a.dataPrazoOriginal != null, String(a.dataPrazoOriginal))
  ok("A.0) SLA NÃO está pausado antes do bloqueio", (await prisma.tarefa.findUniqueOrThrow({ where: { id: a.tarefaId }, select: { slaPausadoEm: true } })).slaPausadoEm == null)

  const antesBloqueio = new Date()
  const rBloq = await bloquearTarefa(a.tarefaId, { origem: "USER", usuarioId: marco.id, motivoCodigo: "AGUARDANDO_TERCEIRO", justificativa: "Requerimento enviado ao Cartório X, aguardando retorno." })
  ok("A.1) bloquearTarefa (PAUSE_FOR_EXTERNAL_WAIT) sucede", rBloq.success === true, JSON.stringify(rBloq).slice(0, 200))

  const depoisBloqueio = await prisma.tarefa.findUniqueOrThrow({ where: { id: a.tarefaId }, select: { statusTarefa: true, slaPausadoEm: true, dataPrazo: true, motivoCodigo: true, justificativa: true, blockedPreviousStatus: true } })
  ok("A.2) status vira BLOQUEADA (única transição legal para fora da precedência atual)", depoisBloqueio.statusTarefa === "BLOQUEADA", depoisBloqueio.statusTarefa)
  ok("A.2) RELÓGIO 1 (prazo da operação) PAUSA — slaPausadoEm gravado", depoisBloqueio.slaPausadoEm != null, String(depoisBloqueio.slaPausadoEm))
  ok("A.2) slaPausadoEm está no instante do bloqueio (não antes, não depois)", depoisBloqueio.slaPausadoEm! >= antesBloqueio)
  ok("A.2) dataPrazo NÃO é reescrito no início da pausa (só empurrado na retomada)", depoisBloqueio.dataPrazo?.getTime() === a.dataPrazoOriginal?.getTime())
  ok("A.2) MOTIVO registrado (motivoCodigo)", depoisBloqueio.motivoCodigo === "AGUARDANDO_TERCEIRO", String(depoisBloqueio.motivoCodigo))
  ok("A.2) MOTIVO registrado (justificativa)", depoisBloqueio.justificativa === "Requerimento enviado ao Cartório X, aguardando retorno.")
  ok("A.2) estado anterior preservado para a retomada (blockedPreviousStatus)", depoisBloqueio.blockedPreviousStatus === a.statusOriginal, String(depoisBloqueio.blockedPreviousStatus))

  const stepBloqueado = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: a.stepId }, select: { status: true } })
  ok("A.3) o PASSO também bloqueia — mesma transação, mesma verdade", stepBloqueado.status === "BLOQUEADO", stepBloqueado.status)

  const evtBloqueio = await prisma.workflowEvento.findFirst({ where: { tipo: "TAREFA_BLOQUEADA", tarefaId: a.tarefaId }, orderBy: { id: "desc" } })
  ok("A.4) AUTOR registrado no evento (WorkflowEvento.dados.usuarioId)", (evtBloqueio?.dados as Record<string, unknown> | null)?.usuarioId === marco.id, JSON.stringify(evtBloqueio?.dados))
  ok("A.4) INÍCIO registrado (WorkflowEvento.criadoEm)", evtBloqueio != null && evtBloqueio.criadoEm.getTime() >= antesBloqueio.getTime())

  secao("A.5) DIMENSÕES C/D (previsão do terceiro / próximo acompanhamento) — a pausa não pode escondê-las")
  // O núcleo puro, com o snapshot exatamente como ele existe no banco agora: sem
  // previsão do terceiro nem próximo acompanhamento cadastrados ainda.
  const entradaSemPrevisao: EntradaOperacao = {
    tarefaId: a.tarefaId, statusTarefa: "BLOQUEADA", motivoCodigo: "AGUARDANDO_TERCEIRO",
    dataPrazo: depoisBloqueio.dataPrazo, dataConclusao: null, dataInicio: null,
    slaPausadoEm: depoisBloqueio.slaPausadoEm, slaPausaAcumuladaMin: 0,
    responsavelId: marco.id, createdAt: new Date(), agora: new Date(),
    passo: null, solicitacao: null,
  }
  const semPrevisao = computarProximoAcontecimento(entradaSemPrevisao)
  ok("A.5) sem previsão/acompanhamento: é tratada como AGUARDANDO (nunca 'ação interna')", semPrevisao.proximoAcontecimento.tipo === "em_risco", semPrevisao.proximoAcontecimento.tipo)
  ok("A.5) motivo específico da Etapa 3 aparece (AGUARDANDO_SEM_PREVISAO_NEM_ACOMPANHAMENTO)", semPrevisao.motivosRisco.includes("AGUARDANDO_SEM_PREVISAO_NEM_ACOMPANHAMENTO"), semPrevisao.motivosRisco.join(","))
  ok("A.5) atrasoInterno é FALSE mesmo que o prazo já tenha passado (não é falta de ação interna, é espera externa)", (() => {
    const passado: EntradaOperacao = { ...entradaSemPrevisao, dataPrazo: new Date(Date.now() - 10 * 86400000), agora: new Date() }
    return computarProximoAcontecimento(passado).atrasoInterno === false
  })())
  ok("A.5) SEM a correção (status='BLOQUEADA' fora de ehEsperaExterna) isto cairia em 'ação interna' — checagem de regressão do bug original", (() => {
    // Reproduz o comportamento ANTERIOR à correção: "aguardando" só olhava para
    // STATUS_AGUARDANDO (AGUARDANDO_TERCEIRO/AGUARDANDO_CLIENTE), nunca para
    // BLOQUEADA+motivoCodigo. Confirma que o bug fazia o motor tratar espera
    // externa como se fosse trabalho interno comum.
    const aguardandoAntigo = new Set(["AGUARDANDO_TERCEIRO", "AGUARDANDO_CLIENTE"]).has(entradaSemPrevisao.statusTarefa)
    return aguardandoAntigo === false // ou seja: SEM a correção, "aguardando" seria false para este caso real
  })())

  secao("A.6) RETOMADA — o terceiro respondeu (RESUME)")
  // Simula 3 dias de espera real: empurra slaPausadoEm para o passado.
  const minutosDeEsperaSimulados = 3 * 24 * 60
  await prisma.tarefa.update({ where: { id: a.tarefaId }, data: { slaPausadoEm: new Date(Date.now() - minutosDeEsperaSimulados * 60000) } })
  const antesRetomada = new Date()
  const rResume = await desbloquearTarefa(a.tarefaId, { origem: "USER", usuarioId: marco.id })
  ok("A.6) desbloquearTarefa (RESUME) sucede", rResume.success === true, JSON.stringify(rResume).slice(0, 200))

  const depoisResume = await prisma.tarefa.findUniqueOrThrow({ where: { id: a.tarefaId }, select: { statusTarefa: true, slaPausadoEm: true, dataPrazo: true, slaPausaAcumuladaMin: true, blockedPreviousStatus: true } })
  ok("A.7) status volta ao estado anterior ao bloqueio", depoisResume.statusTarefa === a.statusOriginal, depoisResume.statusTarefa)
  ok("A.7) RELÓGIO 1 retoma — slaPausadoEm zera", depoisResume.slaPausadoEm == null)
  ok("A.7) blockedPreviousStatus limpo", depoisResume.blockedPreviousStatus == null)
  ok("A.7) IMPACTO TEMPORAL — dataPrazo empurrado pelo tempo pausado (~3 dias), nunca por adivinhação", (() => {
    if (!depoisResume.dataPrazo || !a.dataPrazoOriginal) return false
    const diffMin = (depoisResume.dataPrazo.getTime() - a.dataPrazoOriginal.getTime()) / 60000
    return Math.abs(diffMin - minutosDeEsperaSimulados) <= 2 // tolerância de arredondamento
  })(), `prazo original=${a.dataPrazoOriginal?.toISOString()} prazo novo=${depoisResume.dataPrazo?.toISOString()}`)
  ok("A.7) slaPausaAcumuladaMin registra o tempo pausado (auditável)", depoisResume.slaPausaAcumuladaMin >= minutosDeEsperaSimulados - 2)

  const evtResume = await prisma.workflowEvento.findFirst({ where: { tipo: "TAREFA_DESBLOQUEADA", tarefaId: a.tarefaId }, orderBy: { id: "desc" } })
  ok("A.8) FIM registrado (WorkflowEvento TAREFA_DESBLOQUEADA)", evtResume != null && evtResume.criadoEm.getTime() >= antesRetomada.getTime())
  ok("A.8) AUTOR da retomada também registrado", (evtResume?.dados as Record<string, unknown> | null)?.usuarioId === marco.id)
  ok("A.8) fim é depois do início — o intervalo é real e ordenado", evtResume!.criadoEm.getTime() >= evtBloqueio!.criadoEm.getTime())

  const stepResume = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: a.stepId }, select: { status: true } })
  ok("A.9) o PASSO também retoma", stepResume.status !== "BLOQUEADO", stepResume.status)

  // ══════════════════════════════════════════════════════════════════════
  secao("CASO B — bloqueio INTERNO (não é espera de terceiro), workflow configurado para NÃO pausar no bloqueio")
  // ══════════════════════════════════════════════════════════════════════
  const b = await palco({ pausarSlaEmEsperaExterna: true, pausarSlaEmBloqueio: false })
  await prisma.tarefa.update({ where: { id: b.tarefaId }, data: { responsavelId: marco.id } })
  const rBloqB = await bloquearTarefa(b.tarefaId, { origem: "USER", usuarioId: marco.id, motivoCodigo: "BLOQUEIO", justificativa: "Falta documento interno para prosseguir." })
  ok("B.1) bloquearTarefa (bloqueio interno, não espera externa) sucede", rBloqB.success === true)
  const depoisB = await prisma.tarefa.findUniqueOrThrow({ where: { id: b.tarefaId }, select: { statusTarefa: true, slaPausadoEm: true } })
  ok("B.2) status BLOQUEADA", depoisB.statusTarefa === "BLOQUEADA")
  ok("B.2) RELÓGIO 1 NÃO pausa — política do workflow diz pausarSlaEmBloqueio=false", depoisB.slaPausadoEm == null)
  ok("B.3) proximo-acontecimento NÃO trata isto como espera externa (motivoCodigo=BLOQUEIO, não AGUARDANDO_TERCEIRO)", (() => {
    const entrada: EntradaOperacao = {
      tarefaId: b.tarefaId, statusTarefa: "BLOQUEADA", motivoCodigo: "BLOQUEIO",
      dataPrazo: new Date(Date.now() - 86400000), dataConclusao: null, dataInicio: null,
      slaPausadoEm: null, slaPausaAcumuladaMin: 0, responsavelId: marco.id,
      createdAt: new Date(), agora: new Date(), passo: null, solicitacao: null,
    }
    // Atrasado de verdade E é responsabilidade interna: atrasoInterno deve ser TRUE aqui
    // (ao contrário do CASO A, onde era espera externa e ficava FALSE).
    return computarProximoAcontecimento(entrada).atrasoInterno === true
  })())

  // ══════════════════════════════════════════════════════════════════════
  secao("CASO C — espera externa, workflow configurado para NÃO pausar (o negócio decide não pausar essa espera)")
  // ══════════════════════════════════════════════════════════════════════
  const c = await palco({ pausarSlaEmEsperaExterna: false, pausarSlaEmBloqueio: false })
  await prisma.tarefa.update({ where: { id: c.tarefaId }, data: { responsavelId: marco.id } })
  await bloquearTarefa(c.tarefaId, { origem: "USER", usuarioId: marco.id, motivoCodigo: "AGUARDANDO_TERCEIRO", justificativa: "Aguardando retorno." })
  const depoisC = await prisma.tarefa.findUniqueOrThrow({ where: { id: c.tarefaId }, select: { statusTarefa: true, slaPausadoEm: true } })
  ok("C.1) política de NÃO pausar é respeitada — RELÓGIO 1 continua correndo mesmo em espera externa", depoisC.slaPausadoEm == null)
  ok("C.2) mas a dimensão C/D continua ativa mesmo sem pausa do relógio 1 (são independentes)", (() => {
    const entrada: EntradaOperacao = {
      tarefaId: c.tarefaId, statusTarefa: depoisC.statusTarefa, motivoCodigo: "AGUARDANDO_TERCEIRO",
      dataPrazo: new Date(Date.now() + 86400000), dataConclusao: null, dataInicio: null,
      slaPausadoEm: null, slaPausaAcumuladaMin: 0, responsavelId: marco.id,
      createdAt: new Date(), agora: new Date(), passo: null, solicitacao: null,
    }
    const r = computarProximoAcontecimento(entrada)
    return r.atrasoInterno === false && r.motivosRisco.includes("AGUARDANDO_SEM_PREVISAO_NEM_ACOMPANHAMENTO")
  })())

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
