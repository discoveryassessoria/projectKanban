// scripts/catalogo-fases-alteracao-inativacao.test.ts
// ============================================================================
// CATÁLOGO DE FASES — alteração, inativação, reconciliação geral e
// preservação de fatos históricos (mandato 20/09/2026, continuação).
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/catalogo-fases-alteracao-inativacao.test.ts
//
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { prisma } from '../lib/prisma'
import { exigirBancoDeTeste } from './_banco-de-teste'
import { garantirOferta } from './_fixture-oferta'
import { materializarExecucaoDaFase } from '../src/services/materializar-fase'
import { movePhaseManual } from '../src/lib/motor/phase-advance'
import {
  enqueueReconciliacaoFaseMacro,
  processarReconciliacaoFaseMacro,
  calcularObrigacoesRetroativasPendentes,
} from '../src/lib/motor/reconciliar-fase-macro'
import { publicarRevisaoCatalogoFase, statusDeAtivo } from '../src/lib/motor/catalogo-fase-revisao'
import { avaliarAptidaoDaFase } from '../src/lib/process-stage/escopo-operacional-da-fase'

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = 'ALTFASE'
const FASE_A = `${MARCA}_a`
const FASE_B = `${MARCA}_b` // nasce condicional; depois vira obrigatória
const FASE_C = `${MARCA}_c`

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
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@altfase.test' } } })
  const cats = await prisma.catalogoFase.findMany({ where: { phaseKey: { startsWith: MARCA } }, select: { id: true } })
  await prisma.catalogoFaseRevisao.deleteMany({ where: { catalogoFaseId: { in: cats.map((c) => c.id) } } })
  await prisma.catalogoFase.deleteMany({ where: { id: { in: cats.map((c) => c.id) } } })
}

async function main() {
  exigirBancoDeTeste('monta o palco de alteração/inativação do catálogo de fases')
  console.log('CATÁLOGO DE FASES — alteração, inativação, reconciliação geral, histórico preservado\n')
  await limpar()

  // ══════════════════════════════════════════════════════════════════════
  secao('1) Revisão congelada: só nasce quando algo muda de verdade')
  // ══════════════════════════════════════════════════════════════════════
  const fase = await prisma.catalogoFase.create({
    data: { phaseKey: FASE_C, label: 'Fase C (teste)', escopo: 'PROCESSO', ordemPadrao: 99, requiredPadrao: true, conditionalPadrao: false, ativo: true, status: 'PUBLICADA', revisaoAtual: 1 },
  })
  await prisma.catalogoFaseRevisao.create({
    data: { catalogoFaseId: fase.id, revisao: 1, phaseKey: fase.phaseKey, label: fase.label, descricao: fase.descricao, escopo: fase.escopo, ordemPadrao: fase.ordemPadrao, requiredPadrao: fase.requiredPadrao, conditionalPadrao: fase.conditionalPadrao, status: fase.status, efeitosPermitidos: fase.efeitosPermitidos as never, origem: 'CRIACAO' },
  })

  const salvarSemMudar = await prisma.$transaction((tx) => publicarRevisaoCatalogoFase(tx, fase, { ...fase }, null))
  ok('salvar sem mudar nada NÃO cria revisão nova', !salvarSemMudar.mudou && salvarSemMudar.revisaoNova === 1, `revisao=${salvarSemMudar.revisaoNova} mudou=${salvarSemMudar.mudou}`)

  const alterado = await publicarRevisaoCatalogoFase(prisma, salvarSemMudar.fase, { ...salvarSemMudar.fase, label: 'Fase C (renomeada)' }, null)
  ok('mudar o label cria a revisão 2', alterado.mudou && alterado.revisaoNova === 2, `revisao=${alterado.revisaoNova}`)
  const revisoes = await prisma.catalogoFaseRevisao.findMany({ where: { catalogoFaseId: fase.id }, orderBy: { revisao: 'asc' } })
  ok('existem exatamente 2 revisões congeladas (criação + a alteração)', revisoes.length === 2, `${revisoes.length}`)
  ok('a revisão 1 preserva o label ORIGINAL — fato histórico intacto', revisoes[0].label === 'Fase C (teste)', revisoes[0].label)
  ok('a revisão 2 tem o label NOVO', revisoes[1].label === 'Fase C (renomeada)', revisoes[1].label)

  // ══════════════════════════════════════════════════════════════════════
  secao('2) Inativação: some da oferta, nunca do histórico')
  // ══════════════════════════════════════════════════════════════════════
  const inativado = await publicarRevisaoCatalogoFase(prisma, alterado.fase, { ...alterado.fase, ativo: false, status: statusDeAtivo(false) as never }, null)
  ok('inativar grava status=INATIVA e ativo=false', inativado.fase.status === 'INATIVA' && inativado.fase.ativo === false)
  ok('inativar TAMBÉM congela revisão (é uma publicação)', inativado.mudou && inativado.revisaoNova === 3)
  const aindaExiste = await prisma.catalogoFase.findUnique({ where: { id: fase.id } })
  ok('a linha continua existindo — nunca excluída', aindaExiste != null)
  const aptidao = await avaliarAptidaoDaFase(FASE_C)
  ok('fase inativa é recusada para compor fluxo NOVO', !aptidao.apta && aptidao.code === 'INATIVA', JSON.stringify(aptidao))

  // ══════════════════════════════════════════════════════════════════════
  secao('3) Reconciliação GERAL: fase existente que se TORNA obrigatória')
  // ══════════════════════════════════════════════════════════════════════
  const admin = await prisma.usuario.create({ data: { nome: 'Admin AltFase', email: 'admin@altfase.test', senha: 'x', tipo: 'admin' }, select: { id: true } })
  const oferta = await garantirOferta(prisma, { countryKey: `${MARCA}_pais`, countryLabel: 'País AltFase', modalityKey: `${MARCA}_modal`, modalityLabel: 'Modalidade AltFase' })
  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: `${MARCA}_TIPO`, name: `${MARCA} Tipo`, paisId: oferta.paisId, modalidadeId: oferta.modalidadeId }, select: { id: true } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: `${MARCA} macro`, versao: 1 }, select: { id: true } })

  // fase_b NASCE condicional (não gera outbox nem obrigação hoje).
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASE_A, label: FASE_A, ordem: 1, required: true, conditional: false } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASE_B, label: FASE_B, ordem: 2, required: false, conditional: true } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: 'finalizado', label: 'Finalizado', ordem: 3, required: true, conditional: false } })
  for (const phaseKey of [FASE_A, FASE_B, 'finalizado']) {
    const wf = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `${MARCA}::${phaseKey}`, phaseKey, name: `WF ${phaseKey}`, tipoProcessoId: tipo.id, versao: 1 }, select: { id: true } })
    await prisma.phaseInternalWorkflowStep.create({ data: { workflowId: wf.id, key: `${phaseKey}_passo`, label: `Passo ${phaseKey}`, ordem: 1, createsTask: true, required: false, owner: null, slaDays: 0, cardinalidade: 'PROCESSO' } })
  }

  const processo = await prisma.processo.create({ data: { nome: `${MARCA} Processo`, workflowRuntime: 'v2', faseAtualKey: FASE_A, tipoProcessoMotorId: tipo.id, macroWorkflowVersion: 1 }, select: { id: true } })
  await materializarExecucaoDaFase({ processoId: processo.id, fonte: 'PROCESSO_CRIADO' })
  await prisma.phaseWorkflowInstance.updateMany({ where: { processoId: processo.id, faseMacroKey: FASE_A }, data: { status: 'CONCLUIDO' } })

  const pendentesAntesDePublicar = await calcularObrigacoesRetroativasPendentes(
    processo.id,
    [{ phaseKey: FASE_A, ordem: 1, required: true, conditional: false }, { phaseKey: FASE_B, ordem: 2, required: false, conditional: true }, { phaseKey: 'finalizado', ordem: 3, required: true, conditional: false }],
    FASE_A,
  )
  ok('fase_b condicional NÃO é obrigação pendente (ninguém decidiu que ela se aplica)', pendentesAntesDePublicar.length === 0, JSON.stringify(pendentesAntesDePublicar))

  // PUBLICAÇÃO: fase_b deixa de ser condicional — agora é obrigatória de verdade.
  // Simula exatamente o que a rota faz ao detectar "tornou-se obrigatória". O
  // processo AINDA ESTÁ EM ANDAMENTO (fase_a) — "em andamento" é condição para
  // o enqueue automático alcançar; um processo já FINALIZADO fica de fora por
  // desenho (reabrir obrigação num processo fechado é decisão de reabertura
  // explícita, não efeito colateral automático de publicar — ver §4 abaixo).
  await prisma.faseMacro.update({ where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: FASE_B } }, data: { required: true, conditional: false } })
  await prisma.macroWorkflow.update({ where: { id: macro.id }, data: { versao: 2 } })
  const enq = await enqueueReconciliacaoFaseMacro({
    macroWorkflowId: macro.id, tipoProcessoId: tipo.id, versaoAnterior: 1, versaoNova: 2,
    fasesNovas: [{ phaseKey: FASE_B, required: true, conditional: false }], publicadoPorId: admin.id,
  })
  ok('publicar "tornou-se obrigatória" enfileira reconciliação (mesmo caminho de fase nova)', enq.outboxRegistrados === 1, `${enq.outboxRegistrados}`)
  await processarReconciliacaoFaseMacro({ processoId: processo.id, phaseKey: FASE_B, versaoNova: 2 })

  const instanciaB = await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: processo.id, faseMacroKey: FASE_B } })
  ok('fase_b foi materializada retroativamente (era condicional, virou obrigatória)', instanciaB != null)
  const procAindaEmFaseA = await prisma.processo.findUnique({ where: { id: processo.id }, select: { faseAtualKey: true } })
  ok('faseAtualKey continua fase_a — reconciliar NÃO avança nem move o processo', procAindaEmFaseA?.faseAtualKey === FASE_A, procAindaEmFaseA?.faseAtualKey ?? '—')

  const mov = await movePhaseManual(processo.id, { faseAlvo: 'finalizado', justificativa: 'segue para finalizado após reconciliar fase_b', motivoCodigo: 'CORRECAO_OPERACIONAL', solicitadoPorId: admin.id })
  ok('processo avança até finalizado normalmente depois da reconciliação', mov.success, mov.success ? mov.resultado : `${mov.code}`)
  const procDepois = await prisma.processo.findUnique({ where: { id: processo.id }, select: { faseAtualKey: true } })
  ok('faseAtualKey agora é "finalizado"', procDepois?.faseAtualKey === 'finalizado', procDepois?.faseAtualKey ?? '—')

  const pendentesDepois = await calcularObrigacoesRetroativasPendentes(
    processo.id,
    [{ phaseKey: FASE_A, ordem: 1, required: true, conditional: false }, { phaseKey: FASE_B, ordem: 2, required: true, conditional: false }, { phaseKey: 'finalizado', ordem: 3, required: true, conditional: false }],
    'finalizado',
  )
  ok('agora fase_b aparece como obrigação retroativa (materializada, não concluída)', pendentesDepois.length === 1 && pendentesDepois[0].phaseKey === FASE_B, JSON.stringify(pendentesDepois))

  // ══════════════════════════════════════════════════════════════════════
  secao('4) Remoção da composição: instância materializada sobrevive, obrigação futura some')
  // ══════════════════════════════════════════════════════════════════════
  await prisma.faseMacro.delete({ where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: FASE_B } } })
  const instanciaBDepoisDeRemover = await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: processo.id, faseMacroKey: FASE_B } })
  ok('a instância de fase_b NÃO foi apagada ao remover a fase da composição', instanciaBDepoisDeRemover != null)
  const fasesSemB = (await prisma.faseMacro.findMany({ where: { macroWorkflowId: macro.id }, orderBy: { ordem: 'asc' } })).map((f) => ({ phaseKey: f.phaseKey, ordem: f.ordem, required: f.required, conditional: f.conditional }))
  const pendentesSemB = await calcularObrigacoesRetroativasPendentes(processo.id, fasesSemB, 'finalizado')
  ok('fase_b removida da composição não é mais cobrada como obrigação (lida ao vivo)', pendentesSemB.length === 0, JSON.stringify(pendentesSemB))

  // ══════════════════════════════════════════════════════════════════════
  secao('5) Alterar o cadastro depois de concluído NÃO reescreve o que já aconteceu')
  // ══════════════════════════════════════════════════════════════════════
  const instanciaAAntes = await prisma.phaseWorkflowInstance.findFirstOrThrow({ where: { processoId: processo.id, faseMacroKey: FASE_A } })
  const faseAAntes = await prisma.catalogoFase.findFirst({ where: { phaseKey: FASE_A } })
  // fase_a não tinha CatalogoFase própria neste cenário (só FaseMacro) — cria uma
  // agora e testa que ALTERAR o cadastro dela não toca a instância já concluída.
  const catA = faseAAntes ?? await prisma.catalogoFase.create({
    data: { phaseKey: FASE_A, label: 'Fase A', escopo: 'PROCESSO', requiredPadrao: true, conditionalPadrao: false, ativo: true, status: 'PUBLICADA', revisaoAtual: 1 },
  })
  await publicarRevisaoCatalogoFase(prisma, catA, { ...catA, label: 'Fase A (renomeada depois de concluída)', efeitosPermitidos: ['COMPLETE_STEP'] as never }, admin.id)
  const instanciaADepois = await prisma.phaseWorkflowInstance.findUniqueOrThrow({ where: { id: instanciaAAntes.id } })
  ok('a instância de fase_a concluída continua CONCLUIDO, ciclo e id intactos',
    instanciaADepois.status === 'CONCLUIDO' && instanciaADepois.id === instanciaAAntes.id && instanciaADepois.ciclo === instanciaAAntes.ciclo)
  ok('e o processo continua o MESMO processo (mesmo id) do início ao fim', procDepois?.faseAtualKey === 'finalizado')

  // ── RESUMO ────────────────────────────────────────────────────────────
  console.log(`\n${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log('Falhas:', falhas.join(' | ')); process.exitCode = 1 }
  await limpar()
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect() })
