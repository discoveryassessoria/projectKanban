// scripts/fase-aguardando-fechamento-motor.test.ts
// ============================================================================
// FASE "AGUARDANDO FECHAMENTO" (phaseKey `a_iniciar`) — O MOTOR. Autorização do usuário (texto dele): "Autorizo mexer no Catálogo de
// Fases (fechado desde 22/09) SOMENTE para este pedido."
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/fase-aguardando-fechamento-motor.test.ts
//
// PROVA, contra o banco de TESTE (nada de produção):
//   1) todo processo novo NASCE em a_iniciar, SEM Tarefa/Documento/StepInstance e SEM erro SEM_WORKFLOW_INTERNO / SEM_WORKFLOW_PUBLICADO
//      (a fase é SEM tarefas por desenho — não existe Workflow Interno dela, e a criação não depende de existir);
//   2) NADA automático tira o processo dela, MESMO com o gate "aberto" (0 exigido = 100%): advance() sem origem humana, o reconciliador,
//      o auto-avanço e o cron horário (/api/cron/reconciliar-fases) — trava AVANCO_MANUAL_OBRIGATORIO;
//   3) o humano SAI dela: movimentação manual e avanço humano (botão/arrastar) levam para Genealogia, que materializa NORMALMENTE;
//   4) o DADO do macro (`required=false, conditional=false`): proximaFaseDoCaminho vai a Genealogia, a publicação pela rota PUT NÃO enfileira
//      materialização retroativa para processo em andamento, e a finalização desses processos NÃO é bloqueada (OBRIGACAO_RETROATIVA_PENDENTE);
//   5) a extensão não é fase do enum: phaseKeyToFaseCode é null, mas o rótulo é "Aguardando fechamento" e `fasesAnterioresA` é [].
// ============================================================================
import { exigirBancoDeTeste } from './_banco-de-teste'
exigirBancoDeTeste('fase-aguardando-fechamento-motor.test.ts')

import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { signAuthToken } from '../lib/auth-jwt'
import { garantirOferta } from './_fixture-oferta'
import { criarProcessoV2 } from '../src/services/criar-processo'
import { advance, movePhaseManual } from '../src/lib/motor/phase-advance'
import { reconciliarMotorDeFases } from '../src/lib/motor/reconciliar-motor-fases'
import { tentarAvancoAutomatico } from '../src/lib/motor/auto-avanco'
import { calcularPendencias } from '../src/lib/motor/blocking-engine'
import { materializarExecucaoDaFase } from '../src/services/materializar-fase'
import { instanciarWorkflowDaFase } from '../src/services/phase-workflow'
import { enqueueReconciliacaoFaseMacro, calcularObrigacoesRetroativasPendentes } from '../src/lib/motor/reconciliar-fase-macro'
import { proximaFaseDoCaminho, primeiraFasePorOrdem } from '../src/lib/motor/phase-advance-helpers'
import { phaseKeyToFaseCode, labelDaFasePorPhaseKey, phaseKeyConhecidaDoCatalogo } from '../src/lib/process-stage/fases-catalog'
import { PHASEKEY_A_INICIAR, ROTULO_AGUARDANDO_FECHAMENTO, ORDEM_AGUARDANDO_FECHAMENTO, ehFaseAguardandoFechamento, avancoHumano } from '../src/lib/process-stage/fase-pre-contrato'
import { fasesAnterioresA } from '../src/services/regularizacao-historica'
import { PUT as putMacro } from '../src/app/api/gerenciamento/workflow-macro/[id]/route'
import { GET as cronReconciliar } from '../src/app/api/cron/reconciliar-fases/route'

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = '') => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ''}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ''}`) } }
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = 'AGFECH'
const GEN = 'genealogia'
const FIM = 'finalizado'

async function limpar() {
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({ where: { code: { startsWith: MARCA } }, select: { id: true } })
  const tipoIds = tipos.map((t) => t.id)
  const procs = await prisma.processo.findMany({ where: { OR: [{ tipoProcessoMotorId: { in: tipoIds } }, { nome: { startsWith: MARCA } }] }, select: { id: true } })
  const procIds = procs.map((p) => p.id)
  const tarefas = await prisma.tarefa.findMany({ where: { processoId: { in: procIds } }, select: { id: true } })
  await prisma.logAuditoria.deleteMany({ where: { entidadeId: { in: [...procIds, ...tarefas.map((t) => t.id)] } } })
  await prisma.notificacaoOperacional.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: tarefas.map((t) => t.id) } } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'Processo', aggregateId: { in: procIds } } })
  await prisma.phaseAdvanceLog.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.workflowEvento.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: { in: procIds } } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
  const wfs = await prisma.phaseInternalWorkflow.findMany({ where: { wfUid: { startsWith: MARCA } }, select: { id: true } })
  await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: { in: wfs.map((w) => w.id) } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { id: { in: wfs.map((w) => w.id) } } })
  const macros = await prisma.macroWorkflow.findMany({ where: { tipoProcessoId: { in: tipoIds } }, select: { id: true } })
  await prisma.macroWorkflowVersao.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
  await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
  await prisma.macroWorkflow.deleteMany({ where: { id: { in: macros.map((m) => m.id) } } })
  await prisma.tipoProcessoModalidadeHabilitada.deleteMany({ where: { tipoProcessoId: { in: tipoIds } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: { in: tipoIds } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@agfech.test' } } })
}

const contagens = async (processoId: number) => ({
  tarefas: await prisma.tarefa.count({ where: { processoId } }),
  passos: await prisma.phaseWorkflowStepInstance.count({ where: { processoId } }),
  documentos: await prisma.documento.count({ where: { OR: [{ necessidade: { processoId } }, { solicitacoes: { some: { processoId } } }] } }),
  necessidades: await prisma.necessidadeDocumental.count({ where: { processoId } }),
})

async function main() {
  console.log('FASE AGUARDANDO FECHAMENTO (a_iniciar) — o motor\n')
  await limpar()

  secao('0) A extensão: fora do enum, com rótulo oficial e ordem anterior a Genealogia')
  ok('a chave é a.iniciar canônica', PHASEKEY_A_INICIAR === 'a_iniciar' && ehFaseAguardandoFechamento('a_iniciar') && !ehFaseAguardandoFechamento('A_INICIAR') && !ehFaseAguardandoFechamento(null))
  ok('NÃO é fase do enum FaseCode: phaseKeyToFaseCode é null (sem migration, sem alterar o enum)', phaseKeyToFaseCode('a_iniciar') === null)
  ok('mas é conhecida do catálogo canônico (guard de phaseKeys)', phaseKeyConhecidaDoCatalogo('a_iniciar') && phaseKeyConhecidaDoCatalogo('genealogia') && !phaseKeyConhecidaDoCatalogo('qualquer_coisa') && !phaseKeyConhecidaDoCatalogo(null))
  ok('rótulo oficial "Aguardando fechamento" (nunca "A iniciar", nunca a chave crua)', labelDaFasePorPhaseKey('a_iniciar') === 'Aguardando fechamento' && ROTULO_AGUARDANDO_FECHAMENTO === 'Aguardando fechamento')
  ok('a ordem em código é ANTERIOR à de Genealogia (a primeira da sequência)', ORDEM_AGUARDANDO_FECHAMENTO < 0)
  ok('fasesAnterioresA(a_iniciar) = [] e fasesAnterioresA(genealogia) não a inclui', fasesAnterioresA('a_iniciar').length === 0 && fasesAnterioresA('genealogia').length === 0)
  ok('origens HUMANAS de avanço: lista fechada (cron/reconciliação/ausente NÃO são humanas)',
    avancoHumano('avancar-fase') && avancoHumano('kanban-drag') && avancoHumano('advance-route') && !avancoHumano('cron-reconciliacao') && !avancoHumano('reconciliacao') && !avancoHumano(undefined) && !avancoHumano(''))

  // ── palco ──────────────────────────────────────────────────────────────
  const admin = await prisma.usuario.create({ data: { nome: 'Admin AgFech', email: 'admin@agfech.test', senha: 'x', tipo: 'admin' }, select: { id: true, email: true, tipo: true } })
  const oferta = await garantirOferta(prisma, { countryKey: `${MARCA}_PAIS`, countryLabel: 'País AgFech', modalityKey: 'administrativa', modalityLabel: 'Administrativa' })
  const pais = await prisma.catalogoPais.findUniqueOrThrow({ where: { id: oferta.paisId }, select: { countryKey: true } })
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })

  async function montarTipo(sufixo: string, comAIniciar: boolean) {
    const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: `${MARCA}_${sufixo}`, name: `${MARCA} ${sufixo}`, paisId: oferta.paisId }, select: { id: true } })
    await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, ativo: true } })
    const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, name: `${MARCA} macro ${sufixo}`, versao: 1 }, select: { id: true } })
    // A composição do DADO que o script de ativação grava: a_iniciar de MENOR ordem (0), required=false, conditional=false.
    const fases = [
      ...(comAIniciar ? [{ phaseKey: PHASEKEY_A_INICIAR, ordem: 0, required: false, label: 'Aguardando fechamento' }] : []),
      { phaseKey: GEN, ordem: 1, required: true, label: 'Genealogia' },
      { phaseKey: FIM, ordem: 2, required: true, label: 'Finalizado' },
    ]
    for (const f of fases) await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: f.phaseKey, label: f.label, ordem: f.ordem, required: f.required, conditional: false } })
    await prisma.macroWorkflowVersao.create({ data: { macroWorkflowId: macro.id, versao: 1, tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, cardinalidadeRequerimento: 'INDIVIDUAL', name: `${MARCA} macro ${sufixo}`, fases: fases.map(({ phaseKey, ordem, required }) => ({ phaseKey, ordem, required })), origem: 'CRIACAO' } })
    // Workflow Interno SÓ de Genealogia e Finalizado — a_iniciar NÃO tem (é o ponto).
    for (const phaseKey of [GEN, FIM]) {
      const wf = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `${MARCA}::${sufixo}::${phaseKey}`, phaseKey, name: `WF ${phaseKey}`, tipoProcessoId: tipo.id, versao: 1 }, select: { id: true } })
      await prisma.phaseInternalWorkflowStep.create({ data: { workflowId: wf.id, key: `${phaseKey}_passo`, label: `Passo ${phaseKey}`, ordem: 1, createsTask: true, required: false, owner: null, slaDays: 0, cardinalidade: 'PROCESSO' } })
    }
    return { tipoId: tipo.id, macroId: macro.id }
  }

  const novo = await montarTipo('NOVO', true)
  ok('PRÉ-CONDIÇÃO: não existe Workflow Interno de a_iniciar (por desenho)', (await prisma.phaseInternalWorkflow.count({ where: { phaseKey: PHASEKEY_A_INICIAR } })) === 0)
  const fasesNovo = (await prisma.faseMacro.findMany({ where: { macroWorkflowId: novo.macroId } })).map((f) => ({ phaseKey: f.phaseKey, ordem: f.ordem, required: f.required, conditional: f.conditional }))
  ok('a primeira fase do macro (menor ordem, incl. ordem 0) é a_iniciar', primeiraFasePorOrdem(fasesNovo) === PHASEKEY_A_INICIAR)

  secao('1) Criação: todo processo novo nasce em a_iniciar, parado, SEM tarefa/documento/passo e sem SEM_WORKFLOW_*')
  const chave = `${MARCA}-idem-1`
  const r1 = await criarProcessoV2({ nome: `${MARCA} processo 1`, pais: pais.countryKey, tipoProcessoMotorId: novo.tipoId, modalidadeId: oferta.modalidadeId, idempotencyKey: chave, solicitadoPorId: admin.id })
  ok('criarProcessoV2 SUCESSO (sem SEM_WORKFLOW_INTERNO nem INSTANCIACAO_FALHOU)', r1.success, r1.success ? r1.processCode : `${r1.code}: ${r1.message}`)
  if (!r1.success) throw new Error('criação falhou — o resto não faz sentido')
  const pid = r1.processId
  ok('nasceu em a_iniciar', r1.currentPhaseKey === PHASEKEY_A_INICIAR && (await prisma.processo.findUniqueOrThrow({ where: { id: pid }, select: { faseAtualKey: true } })).faseAtualKey === PHASEKEY_A_INICIAR)
  ok('tarefasIniciais = 0 e há UMA instância ATIVA da fase (ciclo 1), a currentPhaseInstanceId', r1.tarefasIniciais === 0 && r1.currentPhaseInstanceId > 0 &&
    (await prisma.phaseWorkflowInstance.count({ where: { processoId: pid, faseMacroKey: PHASEKEY_A_INICIAR, status: 'ATIVO', ciclo: 1 } })) === 1)
  const c1 = await contagens(pid)
  ok('NENHUMA Tarefa, StepInstance, Documento ou Necessidade criados', c1.tarefas === 0 && c1.passos === 0 && c1.documentos === 0 && c1.necessidades === 0, JSON.stringify(c1))
  const instVazia = await prisma.phaseWorkflowInstance.findFirstOrThrow({ where: { processoId: pid, faseMacroKey: PHASEKEY_A_INICIAR } })
  ok('a instância não aponta para workflow publicado nenhum (workflowDefinitionId nulo)', instVazia.workflowDefinitionId === null && instVazia.workflowVersion === null)
  const r1b = await criarProcessoV2({ nome: `${MARCA} processo 1`, pais: pais.countryKey, tipoProcessoMotorId: novo.tipoId, modalidadeId: oferta.modalidadeId, idempotencyKey: chave, solicitadoPorId: admin.id })
  ok('idempotência: mesma chave ⇒ MESMO processo, sem duplicar instância', r1b.success && r1b.processId === pid && !r1b.created &&
    (await prisma.phaseWorkflowInstance.count({ where: { processoId: pid } })) === 1)

  secao('1b) Materializar a fase = sucesso com 0 passos; idempotente; nunca cria nada')
  const m1 = await materializarExecucaoDaFase({ processoId: pid, fonte: 'RECONCILIACAO' })
  ok('materializarExecucaoDaFase(a_iniciar): ok, MATERIALIZADO, 0 passos, 0 tarefas, sem motivo de erro', m1.ok && m1.estado === 'MATERIALIZADO' && m1.passosTotais === 0 && m1.tarefasCriadas === 0 && m1.motivos.length === 0 && m1.mensagemAdministrativa === null,
    `${m1.estado} / ${m1.mensagemAdministrativa}`)
  const m2 = await materializarExecucaoDaFase({ processoId: pid, faseMacroKey: PHASEKEY_A_INICIAR, fonte: 'MOVIMENTACAO_MANUAL' })
  ok('de novo: mesmo resultado, ainda UMA instância e nada novo', m2.ok && m2.estado === 'MATERIALIZADO' && (await prisma.phaseWorkflowInstance.count({ where: { processoId: pid } })) === 1 && JSON.stringify(await contagens(pid)) === JSON.stringify(c1))
  const i2 = await instanciarWorkflowDaFase({ processoId: pid, faseMacroKey: PHASEKEY_A_INICIAR, ciclo: 1 })
  ok('instanciarWorkflowDaFase(a_iniciar) é idempotente: created=false, 0 passos', i2.success && !i2.created && i2.stepInstances.length === 0)
  ok('os três novos caminhos NÃO tocam Tarefa/Documento/Passo', JSON.stringify(await contagens(pid)) === JSON.stringify(c1))

  secao('2) NADA automático tira o processo de a_iniciar — mesmo com o gate aberto')
  const gate = await calcularPendencias(pid, PHASEKEY_A_INICIAR)
  ok('PRÉ-CONDIÇÃO do teste: o gate está ABERTO (0 exigido = 100% — o que empurraria sozinho)', gate.canAdvance === true && gate.blocking.length === 0)
  for (const origem of ['cron-reconciliacao', 'reconciliacao', 'recalcular', 'auto-avanco', undefined]) {
    const r = await advance(pid, origem ? { origem } : {})
    ok(`advance(origem=${origem ?? '(ausente)'}) → REJEITADO AVANCO_MANUAL_OBRIGATORIO`, !r.success && r.code === 'AVANCO_MANUAL_OBRIGATORIO', r.success ? 'AVANÇOU' : `${r.code}`)
  }
  const rec = await reconciliarMotorDeFases(pid, { origem: 'cron-reconciliacao' })
  ok('reconciliarMotorDeFases (origem do cron): nenhuma transição, fase final a_iniciar', rec.transicoes.length === 0 && rec.faseFinal === PHASEKEY_A_INICIAR && rec.code === 'AVANCO_MANUAL_OBRIGATORIO', `${rec.code} / ${rec.faseFinal}`)
  const rec2 = await reconciliarMotorDeFases(pid, {})
  ok('reconciliarMotorDeFases (sem origem): idem', rec2.transicoes.length === 0 && rec2.faseFinal === PHASEKEY_A_INICIAR)
  await tentarAvancoAutomatico(pid)
  const cron = await cronReconciliar(new NextRequest('http://localhost/api/cron/reconciliar-fases', { headers: { 'x-vercel-cron': '1' } }))
  const cronJson = await cron.json() as { ok: boolean; movimentos: Array<{ processoId: number }>; barrados: Array<{ processoId: number }> }
  ok('o cron horário roda e NÃO move o processo (nem sequer o varre: a_iniciar fica fora do lote)', cron.status === 200 && cronJson.ok && !cronJson.movimentos.some((m) => m.processoId === pid) && !cronJson.barrados.some((b) => b.processoId === pid))
  const cronEnsaio = await cronReconciliar(new NextRequest('http://localhost/api/cron/reconciliar-fases?ensaio=1', { headers: { 'x-vercel-cron': '1' } }))
  const ensaioJson = await cronEnsaio.json() as { movimentos: Array<{ processoId: number }> }
  ok('o ENSAIO do cron também não anuncia "avançaria" para ele', !ensaioJson.movimentos.some((m) => m.processoId === pid))
  const aindaLa = await prisma.processo.findUniqueOrThrow({ where: { id: pid }, select: { faseAtualKey: true, lockVersion: true } })
  ok('depois de tudo isso o processo continua em a_iniciar, sem nenhum log de avanço', aindaLa.faseAtualKey === PHASEKEY_A_INICIAR &&
    (await prisma.phaseAdvanceLog.count({ where: { processoId: pid, resultado: { in: ['AVANCADO', 'FORCADO', 'MOVIDO'] } } })) === 0)
  ok('e continua sem tarefa/passo/documento', JSON.stringify(await contagens(pid)) === JSON.stringify(c1))

  secao('3) O humano SAI: mover manual (e avanço humano) para Genealogia — que materializa NORMALMENTE')
  const mv = await movePhaseManual(pid, { faseAlvo: GEN, justificativa: 'contrato fechado', motivoCodigo: 'CORRECAO_OPERACIONAL', solicitadoPorId: admin.id })
  ok('movePhaseManual a_iniciar → genealogia: SUCESSO', mv.success, mv.success ? mv.resultado : `${mv.code}: ${mv.message}`)
  const depois = await prisma.processo.findUniqueOrThrow({ where: { id: pid }, select: { faseAtualKey: true } })
  ok('o processo está em genealogia', depois.faseAtualKey === GEN)
  const instAI = await prisma.phaseWorkflowInstance.findFirstOrThrow({ where: { processoId: pid, faseMacroKey: PHASEKEY_A_INICIAR } })
  ok('a instância de a_iniciar foi ENCERRADA (CONCLUIDO), nunca apagada', instAI.status === 'CONCLUIDO' && instAI.completedAt != null)
  const instGen = await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: pid, faseMacroKey: GEN } })
  const passosGen = await prisma.phaseWorkflowStepInstance.count({ where: { processoId: pid, faseMacroKey: GEN } })
  const tarefasGen = await prisma.tarefa.count({ where: { processoId: pid, faseMacroKey: GEN } })
  ok('Genealogia MATERIALIZOU normalmente: instância ATIVA + passo + tarefa (o workflow dela é publicado)', instGen?.status === 'ATIVO' && passosGen >= 1 && tarefasGen >= 1, `passos=${passosGen} tarefas=${tarefasGen}`)
  ok('a mudança está no log de avanço (MOVIDO) com quem e por quê', (await prisma.phaseAdvanceLog.count({ where: { processoId: pid, faseAtual: PHASEKEY_A_INICIAR, fasePretendida: GEN, resultado: 'MOVIDO', solicitadoPorId: admin.id, justificativa: 'contrato fechado' } })) === 1)
  ok('mover para fora NÃO vira "fase concluída" no sino do gestor (não é trabalho concluído)', (await prisma.notificacaoOperacional.count({ where: { processoId: pid, tipo: 'FASE_CONCLUIDA' } })) === 0)
  ok('o fato phase.completed continua registrado no outbox', (await prisma.domainOutbox.count({ where: { aggregateType: 'Processo', aggregateId: pid, tipo: 'phase.completed' } })) >= 1)

  // avanço HUMANO (botão "Avançar", arrastar o card) — outro processo
  const r2 = await criarProcessoV2({ nome: `${MARCA} processo 2`, pais: pais.countryKey, tipoProcessoMotorId: novo.tipoId, modalidadeId: oferta.modalidadeId, solicitadoPorId: admin.id })
  if (!r2.success) throw new Error('criação do 2º falhou')
  const av = await advance(r2.processId, { origem: 'avancar-fase', solicitadoPorId: admin.id })
  ok('avanço HUMANO (origem avancar-fase) leva a_iniciar → genealogia', av.success && av.faseAtual === GEN, av.success ? av.faseAtual : `${av.code}: ${av.message}`)
  ok('…e materializa Genealogia (tarefa criada)', (await prisma.tarefa.count({ where: { processoId: r2.processId, faseMacroKey: GEN } })) >= 1)

  secao('4) O DADO do macro: required=false, conditional=false')
  ok('proximaFaseDoCaminho(a_iniciar) = genealogia (required não entra no caminho; conditional=false não pula)', proximaFaseDoCaminho(fasesNovo, PHASEKEY_A_INICIAR, false) === GEN && proximaFaseDoCaminho(fasesNovo, PHASEKEY_A_INICIAR, true) === GEN)
  ok('…e genealogia → finalizado segue igual (a nova fase não muda o resto do caminho)', proximaFaseDoCaminho(fasesNovo, GEN, false) === FIM)

  // Um macro ANTIGO (sem a_iniciar) com processos em andamento recebe a_iniciar pela rota PUT real — a publicação do script.
  const antigo = await montarTipo('ANTIGO', false)
  const emGen = await prisma.processo.create({ data: { nome: `${MARCA} velho em genealogia`, workflowRuntime: 'v2', faseAtualKey: GEN, tipoProcessoMotorId: antigo.tipoId, modalidadeId: oferta.modalidadeId, macroWorkflowVersion: 1, dataInicio: new Date() }, select: { id: true } })
  await materializarExecucaoDaFase({ processoId: emGen.id, fonte: 'PROCESSO_CRIADO' })
  const emFim = await prisma.processo.create({ data: { nome: `${MARCA} velho em finalizado`, workflowRuntime: 'v2', faseAtualKey: GEN, tipoProcessoMotorId: antigo.tipoId, modalidadeId: oferta.modalidadeId, macroWorkflowVersion: 1 }, select: { id: true } })
  await materializarExecucaoDaFase({ processoId: emFim.id, fonte: 'PROCESSO_CRIADO' })
  const antes = await Promise.all([emGen.id, emFim.id].map(async (id) => ({ id, ...(await contagens(id)), instancias: await prisma.phaseWorkflowInstance.count({ where: { processoId: id } }) })))

  // O cadastro precede a operação: a fase existe e está PUBLICADA no catálogo (é o que o script de ativação garante).
  await prisma.catalogoFase.upsert({
    where: { phaseKey: PHASEKEY_A_INICIAR },
    update: { label: ROTULO_AGUARDANDO_FECHAMENTO, ordemPadrao: 0, ativo: true, status: 'PUBLICADA', escopo: 'PROCESSO', requiredPadrao: false, conditionalPadrao: false },
    create: { phaseKey: PHASEKEY_A_INICIAR, label: ROTULO_AGUARDANDO_FECHAMENTO, ordemPadrao: 0, ativo: true, status: 'PUBLICADA', escopo: 'PROCESSO', requiredPadrao: false, conditionalPadrao: false, efeitosPermitidos: [] },
  })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: admin.tipo, sessaoInicio: Date.now() })
  const corpoPut = {
    fases: [
      { phaseKey: PHASEKEY_A_INICIAR, label: ROTULO_AGUARDANDO_FECHAMENTO, required: false, conditional: false, showInKanban: true },
      { phaseKey: GEN, label: 'Genealogia', required: true, conditional: false, showInKanban: true },
      { phaseKey: FIM, label: 'Finalizado', required: true, conditional: false, showInKanban: true },
    ],
  }
  const resp = await putMacro(new NextRequest(`http://localhost/api/gerenciamento/workflow-macro/${antigo.macroId}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corpoPut) }), { params: Promise.resolve({ id: String(antigo.macroId) }) })
  const respJson = await resp.json() as { publicacao?: { versao: number; reconciliacao: { processosAlcancados: number; outboxRegistrados: number } | null } | null; error?: string }
  ok('a publicação pela rota PUT real é ACEITA (a fase é utilizável: catálogo PUBLICADA com escopo)', resp.status === 200, respJson.error ?? '')
  ok('é uma publicação estrutural: versão do macro sobe para 2', respJson.publicacao?.versao === 2)
  ok('a reconciliação retroativa NÃO alcança ninguém (required=false ⇒ nada enfileirado)', (respJson.publicacao?.reconciliacao?.outboxRegistrados ?? 0) === 0 && (respJson.publicacao?.reconciliacao?.processosAlcancados ?? 0) === 0, JSON.stringify(respJson.publicacao?.reconciliacao))
  ok('nenhum outbox fase.macro.reconciliar para os processos em andamento', (await prisma.domainOutbox.count({ where: { tipo: 'fase.macro.reconciliar', aggregateId: { in: [emGen.id, emFim.id] } } })) === 0)
  const macroDepois = await prisma.faseMacro.findMany({ where: { macroWorkflowId: antigo.macroId }, orderBy: { ordem: 'asc' } })
  ok('o macro ficou com a_iniciar em PRIMEIRO (menor ordem), required=false, conditional=false', macroDepois[0]?.phaseKey === PHASEKEY_A_INICIAR && macroDepois[0].required === false && macroDepois[0].conditional === false && macroDepois.length === 3)
  const depoisEstado = await Promise.all([emGen.id, emFim.id].map(async (id) => ({ id, ...(await contagens(id)), instancias: await prisma.phaseWorkflowInstance.count({ where: { processoId: id } }) })))
  ok('os processos em andamento ficaram EXATAMENTE como estavam (mesmas tarefas, passos e instâncias; nenhuma instância de a_iniciar)', JSON.stringify(antes) === JSON.stringify(depoisEstado) &&
    (await prisma.phaseWorkflowInstance.count({ where: { processoId: { in: [emGen.id, emFim.id] }, faseMacroKey: PHASEKEY_A_INICIAR } })) === 0)
  ok('ninguém foi movido de fase', (await prisma.processo.count({ where: { id: { in: [emGen.id, emFim.id] }, faseAtualKey: GEN } })) === 2)
  const fasesAntigoDepois = macroDepois.map((f) => ({ phaseKey: f.phaseKey, ordem: f.ordem, required: f.required, conditional: f.conditional }))
  const retro = await calcularObrigacoesRetroativasPendentes(emGen.id, fasesAntigoDepois, GEN)
  ok('calcularObrigacoesRetroativasPendentes NÃO conta a_iniciar (posição ≠ obrigação, e ela não é obrigatória)', retro.length === 0, JSON.stringify(retro))
  const fin = await movePhaseManual(emFim.id, { faseAlvo: FIM, justificativa: 'finalizar o velho', motivoCodigo: 'CORRECAO_OPERACIONAL', solicitadoPorId: admin.id })
  ok('a FINALIZAÇÃO do processo em andamento NÃO é bloqueada por a_iniciar (sem OBRIGACAO_RETROATIVA_PENDENTE)', fin.success || fin.code !== 'OBRIGACAO_RETROATIVA_PENDENTE', fin.success ? 'finalizou' : `${fin.code}: ${fin.message}`)
  ok('…e finalizou de fato', fin.success && (await prisma.processo.findUniqueOrThrow({ where: { id: emFim.id }, select: { faseAtualKey: true } })).faseAtualKey === FIM)
  // CONTRAPROVA: era isto que um `required=true` faria — e por isso o script grava required=false.
  const contra = await enqueueReconciliacaoFaseMacro({ macroWorkflowId: antigo.macroId, tipoProcessoId: antigo.tipoId, versaoAnterior: 1, versaoNova: 3, fasesNovas: [{ phaseKey: PHASEKEY_A_INICIAR, required: true, conditional: false }], publicadoPorId: admin.id })
  ok('CONTRAPROVA: com required=true a publicação ENFILEIRARIA trabalho retroativo (por isso o dado é required=false)', contra.processosAlcancados >= 1 && contra.outboxRegistrados >= 1, JSON.stringify(contra))
  const semEnq = await enqueueReconciliacaoFaseMacro({ macroWorkflowId: antigo.macroId, tipoProcessoId: antigo.tipoId, versaoAnterior: 1, versaoNova: 4, fasesNovas: [{ phaseKey: PHASEKEY_A_INICIAR, required: false, conditional: false }], publicadoPorId: admin.id })
  ok('com required=false: 0 processos alcançados, 0 outbox', semEnq.processosAlcancados === 0 && semEnq.outboxRegistrados === 0)
  // Mesmo que um reconciliador pedisse a_iniciar para quem já passou dela, nada nasce.
  const retroMat = await materializarExecucaoDaFase({ processoId: emGen.id, faseMacroKey: PHASEKEY_A_INICIAR, fonte: 'RECONCILIACAO' })
  ok('materializar a_iniciar para processo que JÁ a deixou é no-op (não cria instância ativa numa fase deixada)', retroMat.ok && (await prisma.phaseWorkflowInstance.count({ where: { processoId: emGen.id, faseMacroKey: PHASEKEY_A_INICIAR } })) === 0)

  console.log(`\n${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log('Falhas:', falhas.join(' | ')); process.exitCode = 1 }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: PHASEKEY_A_INICIAR } }).catch(() => null)
  await limpar()
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
