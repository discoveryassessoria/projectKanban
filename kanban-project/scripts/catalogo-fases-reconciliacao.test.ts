// scripts/catalogo-fases-reconciliacao.test.ts
// ============================================================================
// CATÁLOGO DE FASES — RECONCILIAÇÃO RETROATIVA (mandato 20/09/2026).
//
// A prova central: publicar uma fase obrigatória nova NUNCA exige excluir,
// recriar ou reconstruir processo nenhum. Um processo em andamento, com fases
// já concluídas, recebe a fase nova incorporada — sem perder o que já
// aconteceu, sem duplicar ao reprocessar, e sem poder ser finalizado enquanto
// a obrigação nova estiver pendente.
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/catalogo-fases-reconciliacao.test.ts
//
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { prisma } from '../lib/prisma'
import { exigirBancoDeTeste } from './_banco-de-teste'
import { garantirOferta } from './_fixture-oferta'
import { materializarExecucaoDaFase } from '../src/services/materializar-fase'
import { movePhaseManual, advance } from '../src/lib/motor/phase-advance'
import {
  enqueueReconciliacaoFaseMacro,
  processarReconciliacaoFaseMacro,
  calcularObrigacoesRetroativasPendentes,
} from '../src/lib/motor/reconciliar-fase-macro'
import { efeitosDaFase } from '../src/lib/motor/catalogo-de-efeitos'

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = 'RECFASE'
const FASE_A = `${MARCA}_a`
const FASE_B = `${MARCA}_b`
const FASE_X = `${MARCA}_x` // a fase NOVA, inserida DEPOIS que o processo já passou por onde ela cairia
const FASE_FIM = 'finalizado' // chave canônica real — necessária p/ exercitar o gate de finalização

async function limpar() {
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({ where: { code: { startsWith: MARCA } }, select: { id: true } })
  const tipoIds = tipos.map((t) => t.id)
  const procs = await prisma.processo.findMany({ where: { tipoProcessoMotorId: { in: tipoIds } }, select: { id: true } })
  const procIds = procs.map((p) => p.id)
  const tarefas = await prisma.tarefa.findMany({ where: { processoId: { in: procIds } }, select: { id: true } })
  await prisma.logAuditoria.deleteMany({ where: { entidadeId: { in: [...procIds, ...tarefas.map((t) => t.id)] } } })
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: tarefas.map((t) => t.id) } } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'Processo', aggregateId: { in: procIds } } })
  await prisma.phaseAdvanceLog.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.workflowEvento.deleteMany({ where: { processoId: { in: procIds } } })
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
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: { in: tipoIds } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@recfase.test' } } })
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: MARCA } } })
}

async function main() {
  exigirBancoDeTeste('monta o palco da reconciliação retroativa')
  console.log('CATÁLOGO DE FASES — reconciliação retroativa, idempotência e gate de finalização\n')
  await limpar()

  // ── EFEITOS: prova isolada, sem depender do palco ─────────────────────────
  secao('0) Catálogo de efeitos — ausência de declaração NÃO autoriza nada')
  {
    const semDeclaracao = efeitosDaFase('qualquer_fase_sem_cadastro', null)
    ok('fase sem efeitosPermitidos declarado recebe lista VAZIA (nunca "tudo")', semDeclaracao.length === 0, JSON.stringify(semDeclaracao))
    const declarada = efeitosDaFase(FASE_A, ['COMPLETE_STEP', 'REGISTER_ONLY'])
    ok('fase com lista declarada recebe EXATAMENTE a lista', declarada.length === 2 && declarada.includes('COMPLETE_STEP'), JSON.stringify(declarada))
    // Achado real corrigido: a chave correta é "emissao_documental_retificada".
    const retificadaSemCadastro = efeitosDaFase('emissao_documental_retificada', null)
    ok('emissao_documental_retificada sem cadastro NÃO herda GO_RETIFICATION (bug corrigido)', !retificadaSemCadastro.includes('GO_RETIFICATION'), JSON.stringify(retificadaSemCadastro))
  }

  // ── palco ──────────────────────────────────────────────────────────────
  const admin = await prisma.usuario.create({
    data: { nome: 'Admin RecFase', email: 'admin@recfase.test', senha: 'x', tipo: 'admin' },
    select: { id: true },
  })
  const oferta = await garantirOferta(prisma, { countryKey: `${MARCA}_pais`, countryLabel: 'País RecFase', modalityKey: `${MARCA}_modal`, modalityLabel: 'Modalidade RecFase' })
  const tipo = await prisma.tipoProcessoNacionalidade.create({
    data: { code: `${MARCA}_TIPO`, name: `${MARCA} Tipo`, paisId: oferta.paisId },
    select: { id: true },
  })
  await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId } })
  const macro = await prisma.macroWorkflow.create({
    data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, name: `${MARCA} macro`, versao: 1 }, select: { id: true },
  })
  // Composição INICIAL: fase_a → fase_b → finalizado. fase_x AINDA NÃO EXISTE.
  const composicaoInicial = [
    { phaseKey: FASE_A, ordem: 1 },
    { phaseKey: FASE_B, ordem: 2 },
    { phaseKey: FASE_FIM, ordem: 3 },
  ]
  for (const f of composicaoInicial) {
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: f.phaseKey, label: f.phaseKey, ordem: f.ordem, required: true, conditional: false } })
  }
  await prisma.macroWorkflowVersao.create({
    data: { macroWorkflowId: macro.id, versao: 1, tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, cardinalidadeRequerimento: 'INDIVIDUAL', name: `${MARCA} macro`, fases: composicaoInicial, origem: 'CRIACAO' },
  })
  // Passo único por fase, PROCESSO (1 instância/fase), OPCIONAL — isola o teste
  // do gate de conclusão de tarefa (não é o que esta suíte prova) do gate NOVO
  // de obrigação retroativa (que é).
  for (const phaseKey of [FASE_A, FASE_B, FASE_FIM]) {
    const wf = await prisma.phaseInternalWorkflow.create({
      data: { wfUid: `${MARCA}::${phaseKey}`, phaseKey, name: `WF ${phaseKey}`, tipoProcessoId: tipo.id, versao: 1 },
      select: { id: true },
    })
    await prisma.phaseInternalWorkflowStep.create({
      data: { workflowId: wf.id, key: `${phaseKey}_passo`, label: `Passo ${phaseKey}`, ordem: 1, createsTask: true, required: false, owner: null, slaDays: 0, cardinalidade: 'PROCESSO' },
    })
  }

  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} Processo`, workflowRuntime: 'v2', faseAtualKey: FASE_A, tipoProcessoMotorId: tipo.id, modalidadeId: oferta.modalidadeId, macroWorkflowVersion: 1 },
    select: { id: true },
  })

  secao('1) Processo em andamento avança até fase_b (histórico real, sem fase_x)')
  const relA = await materializarExecucaoDaFase({ processoId: processo.id, fonte: 'PROCESSO_CRIADO' })
  ok('fase_a materializou', relA.estado === 'MATERIALIZADO', relA.estado)
  const movB = await movePhaseManual(processo.id, { faseAlvo: FASE_B, justificativa: 'segue para fase_b', motivoCodigo: 'CORRECAO_OPERACIONAL', solicitadoPorId: admin.id })
  ok('moveu para fase_b', movB.success, movB.success ? movB.resultado : `${movB.code}: ${movB.message}`)
  const relB = await materializarExecucaoDaFase({ processoId: processo.id, fonte: 'MOVIMENTACAO_MANUAL' })
  ok('fase_b materializou', relB.estado === 'MATERIALIZADO', relB.estado)
  // Regulariza fase_a antes de seguir — isola fase_x como a ÚNICA obrigação
  // retroativa do cenário (fase_a com obrigação genuinamente aberta é OUTRO
  // caso, já coberto pela regra geral: qualquer fase obrigatória anterior não
  // concluída bloqueia, não só a recém-publicada).
  const instA = await prisma.phaseWorkflowInstance.findFirstOrThrow({ where: { processoId: processo.id, faseMacroKey: FASE_A } })
  await prisma.phaseWorkflowInstance.update({ where: { id: instA.id }, data: { status: 'CONCLUIDO' } })

  const tarefasAntes = await prisma.tarefa.findMany({ where: { processoId: processo.id, faseMacroKey: { not: null } }, select: { id: true, faseMacroKey: true } })
  ok('duas tarefas vivas até aqui (fase_a e fase_b)', tarefasAntes.length === 2, tarefasAntes.map((t) => t.faseMacroKey).join(', '))

  secao('2) PUBLICAÇÃO: fase_x é inserida ENTRE fase_a e fase_b, versão 1 → 2')
  // Simula exatamente o que a rota PUT /workflow-macro/[id] faz: recompõe a
  // ordem, cria a linha nova, congela a versão, e ENFILEIRA a reconciliação —
  // sem processar nenhum processo dentro desta "requisição".
  await prisma.$transaction(async (tx) => {
    await tx.faseMacro.update({ where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: FASE_B } }, data: { ordem: 3 } })
    await tx.faseMacro.update({ where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: FASE_FIM } }, data: { ordem: 4 } })
    await tx.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASE_X, label: FASE_X, ordem: 2, required: true, conditional: false } })
    await tx.macroWorkflow.update({ where: { id: macro.id }, data: { versao: 2 } })
    const fasesFinais = await tx.faseMacro.findMany({ where: { macroWorkflowId: macro.id }, orderBy: { ordem: 'asc' } })
    await tx.macroWorkflowVersao.create({
      data: {
        macroWorkflowId: macro.id, versao: 2, tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, cardinalidadeRequerimento: 'INDIVIDUAL', name: `${MARCA} macro`,
        fases: fasesFinais.map((f) => ({ phaseKey: f.phaseKey, ordem: f.ordem, required: f.required, conditional: f.conditional })),
        congeladoPorId: admin.id, origem: 'PUBLICACAO',
      },
    })
  })
  const wfX = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}::${FASE_X}`, phaseKey: FASE_X, name: `WF ${FASE_X}`, tipoProcessoId: tipo.id, versao: 1 }, select: { id: true },
  })
  await prisma.phaseInternalWorkflowStep.create({
    data: { workflowId: wfX.id, key: `${FASE_X}_passo`, label: `Passo ${FASE_X}`, ordem: 1, createsTask: true, required: false, owner: null, slaDays: 0, cardinalidade: 'PROCESSO' },
  })

  const enq = await enqueueReconciliacaoFaseMacro({
    macroWorkflowId: macro.id, tipoProcessoId: tipo.id, versaoAnterior: 1, versaoNova: 2,
    fasesNovas: [{ phaseKey: FASE_X, required: true, conditional: false }], publicadoPorId: admin.id,
  })
  ok('enqueue alcançou exatamente o processo em andamento', enq.processosAlcancados === 1, `${enq.processosAlcancados}`)
  ok('enqueue registrou exatamente 1 outbox (1 processo × 1 fase nova)', enq.outboxRegistrados === 1, `${enq.outboxRegistrados}`)

  const outboxRows = await prisma.domainOutbox.findMany({ where: { tipo: 'fase.macro.reconciliar', aggregateId: processo.id } })
  ok('a chave de idempotência é determinística', outboxRows[0]?.chaveIdempotencia === `fase.macro.reconciliar::${processo.id}::${FASE_X}::v2`, outboxRows[0]?.chaveIdempotencia ?? '—')

  secao('3) Reconciliação: fase_x é incorporada SEM tocar o que já existia')
  await processarReconciliacaoFaseMacro({ processoId: processo.id, phaseKey: FASE_X, versaoNova: 2 })

  const procDepois1 = await prisma.processo.findUnique({ where: { id: processo.id }, select: { faseAtualKey: true, macroWorkflowVersion: true } })
  ok('faseAtualKey NÃO foi tocado pela reconciliação (segue fase_b)', procDepois1?.faseAtualKey === FASE_B, procDepois1?.faseAtualKey ?? '—')
  ok('macroWorkflowVersion foi atualizado (bookkeeping) para 2', procDepois1?.macroWorkflowVersion === 2, `${procDepois1?.macroWorkflowVersion}`)

  const tarefasDepois1 = await prisma.tarefa.findMany({ where: { processoId: processo.id, faseMacroKey: { not: null } }, select: { id: true, faseMacroKey: true } })
  ok('as 2 tarefas anteriores continuam intactas + 1 nova de fase_x = 3', tarefasDepois1.length === 3, tarefasDepois1.map((t) => `${t.id}:${t.faseMacroKey}`).join(', '))
  ok('as tarefas de fase_a e fase_b são as MESMAS de antes (mesmos IDs)',
    tarefasAntes.every((antiga) => tarefasDepois1.some((nova) => nova.id === antiga.id)))

  const instanciaX = await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: processo.id, faseMacroKey: FASE_X } })
  ok('fase_x foi materializada (PhaseWorkflowInstance criada)', instanciaX != null)

  secao('4) Reconciliar DE NOVO: zero duplicação (idempotência)')
  await processarReconciliacaoFaseMacro({ processoId: processo.id, phaseKey: FASE_X, versaoNova: 2 })
  const tarefasDepois2 = await prisma.tarefa.findMany({ where: { processoId: processo.id, faseMacroKey: { not: null } } })
  const instanciasX = await prisma.phaseWorkflowInstance.findMany({ where: { processoId: processo.id, faseMacroKey: FASE_X } })
  ok('reconciliar 2x não cria tarefa a mais', tarefasDepois2.length === 3, `${tarefasDepois2.length}`)
  ok('reconciliar 2x não cria instância a mais', instanciasX.length === 1, `${instanciasX.length}`)

  secao('5) Obrigação retroativa: fase_x pendente bloqueia — "posição atual" ≠ "obrigação cumprida"')
  const fasesAtuais = (await prisma.faseMacro.findMany({ where: { macroWorkflowId: macro.id }, orderBy: { ordem: 'asc' } }))
    .map((f) => ({ phaseKey: f.phaseKey, ordem: f.ordem, required: f.required, conditional: f.conditional }))
  const pendentesAntes = await calcularObrigacoesRetroativasPendentes(processo.id, fasesAtuais, FASE_B)
  ok('fase_x aparece como obrigação retroativa pendente (materializada, não concluída)',
    pendentesAntes.length === 1 && pendentesAntes[0].phaseKey === FASE_X, JSON.stringify(pendentesAntes))

  // move para fase_b→fim exigiria estar EM fase_b's ordem penúltima; como
  // inserimos fase_x entre a e b, o "próximo" de fase_b já é finalizado.
  const tentativaFinalizar1 = await advance(processo.id)
  ok('advance() para finalizado é REJEITADO por obrigação retroativa pendente',
    !tentativaFinalizar1.success && tentativaFinalizar1.code === 'OBRIGACAO_RETROATIVA_PENDENTE',
    tentativaFinalizar1.success ? 'aceito (não deveria)' : `${tentativaFinalizar1.code}: ${tentativaFinalizar1.message}`)
  const procAindaEmB = await prisma.processo.findUnique({ where: { id: processo.id }, select: { faseAtualKey: true } })
  ok('processo NÃO avançou (faseAtualKey preservado)', procAindaEmB?.faseAtualKey === FASE_B, procAindaEmB?.faseAtualKey ?? '—')

  secao('6) Concluindo fase_x: obrigação some, finalização passa a ser aceita')
  const instX = await prisma.phaseWorkflowInstance.findFirstOrThrow({ where: { processoId: processo.id, faseMacroKey: FASE_X } })
  await prisma.phaseWorkflowInstance.update({ where: { id: instX.id }, data: { status: 'CONCLUIDO' } })

  const pendentesDepois = await calcularObrigacoesRetroativasPendentes(processo.id, fasesAtuais, FASE_B)
  ok('nenhuma obrigação retroativa pendente depois de concluir fase_x', pendentesDepois.length === 0, JSON.stringify(pendentesDepois))

  const tentativaFinalizar2 = await advance(processo.id)
  ok('advance() para finalizado agora é ACEITO', tentativaFinalizar2.success, tentativaFinalizar2.success ? tentativaFinalizar2.resultado : `${tentativaFinalizar2.code}: ${tentativaFinalizar2.message}`)
  if (tentativaFinalizar2.success) {
    ok('a fase de destino é a canônica "finalizado"', tentativaFinalizar2.faseAtual === FASE_FIM || tentativaFinalizar2.faseDestino === FASE_FIM,
      `faseDestino=${tentativaFinalizar2.faseDestino}`)
  }
  const procFinal = await prisma.processo.findUnique({ where: { id: processo.id }, select: { faseAtualKey: true, id: true } })
  ok('MESMO processoId do início ao fim — nenhum processo foi excluído/recriado', procFinal?.id === processo.id)
  ok('processo alcançou finalizado preservando fase_a/fase_b/fase_x já executadas',
    procFinal?.faseAtualKey === FASE_FIM, procFinal?.faseAtualKey ?? '—')

  const tarefasFinais = await prisma.tarefa.findMany({ where: { processoId: processo.id, faseMacroKey: { not: null } } })
  ok('nenhuma tarefa anterior foi apagada ao longo de todo o cenário (3 + a de finalizado)', tarefasFinais.length >= 3, `${tarefasFinais.length}`)

  // ── RESUMO ────────────────────────────────────────────────────────────
  console.log(`\n${passou} ok, ${falhou} falhas`)
  if (falhou > 0) {
    console.log('Falhas:', falhas.join(' | '))
    process.exitCode = 1
  }
  await limpar()
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
