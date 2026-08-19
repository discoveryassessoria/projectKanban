// scripts/palco-retrocesso-motor.ts
// ============================================================================
// O PALCO DO RETROCESSO — o ciclo A→B→A montado para ser visto no navegador.
//
//   npx tsx scripts/palco-retrocesso-motor.ts            (monta e imprime os ids)
//   npx tsx scripts/palco-retrocesso-motor.ts --limpar
//
// O estado que ele deixa de pé é exatamente o do caso real:
//
//   • o processo JÁ esteve na fase seguinte e fez parte do trabalho lá;
//   • o administrador o trouxe de volta pela porta canônica de movimentação;
//   • na fase anterior existe UMA obrigação nova, com UMA etapa a concluir;
//   • tudo o que foi feito antes continua onde estava.
//
// O que o navegador tem de mostrar depois: concluir essa última etapa pela tela
// devolve o processo à fase seguinte sozinho — e o trabalho parcial de lá continua
// parcial, não zerado.
//
// Todos os movimentos são feitos pelas PORTAS OFICIAIS (materializador, máquina de
// passos, movimentação manual). Um palco montado com INSERT à mão provaria a tela
// contra um estado que o sistema nunca produziria.
//
// Banco de TESTE, sempre.
// ============================================================================
import { prisma } from '../lib/prisma'
import { exigirBancoDeTeste } from './_banco-de-teste'
import { reconciliarFaseAtiva } from '../src/services/reconciliar-fase'
import { concluirPasso } from '../src/services/task-step-sync'
import { movePhaseManual } from '../src/lib/motor/phase-advance'
import { reconciliarTarefas } from '../lib/operacional/reconciliar-tarefas'
import { atribuirTarefa } from '../lib/operacional/tarefa-comandos'

const MARCA = 'PALCO-RETROCESSO'
/** A fase DOCUMENTAL é a de trabalho (tem Central, executor e etapas por documento). */
const FASE_A = 'emissao_documental'
/** A seguinte é de processo — é para lá que o motor tem de levar o processo sozinho. */
const FASE_B = 'analise_documental'

const PASSOS_A = [
  { key: 'solicitar_certidao', titulo: 'Solicitar certidão' },
  { key: 'aguardar_retorno_do_cartorio', titulo: 'Aguardar retorno do cartório' },
  { key: 'receber_certidao', titulo: 'Receber certidão' },
  { key: 'conferir_certidao', titulo: 'Conferir certidão' },
  { key: 'validar_certidao', titulo: 'Validar certidão' },
]
const PASSOS_B = ['preparar_pacote_de_analise', 'registrar_divergencias', 'concluir_analise']

const PERMISSOES_DO_EXECUTOR = {
  'tarefas.ver': true,
  'tarefas.iniciar_concluir': true,
  'processos.ver': true,
  'documentos.ver': true,
  'documentos.editar': true,
  'workflow.iniciarPasso': true,
  'workflow.concluirPasso': true,
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: ts.map((t) => t.id) } } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: 'Tarefa', entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.workflowEvento.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseAdvanceLog.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { descricao: { startsWith: MARCA } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { wfUid: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@palco-retrocesso.test' } } })
}

/**
 * O WORKFLOW PUBLICADO DA FASE, escrito pelo palco.
 *
 * Reaproveitar o que já estivesse no banco de teste faria o palco herdar os passos
 * de outra suíte — foi o que aconteceu: `all::emissao_documental` chegou aqui com
 * dois passos genéricos de escopo PROCESSO, e o palco montou um processo que não é
 * o que ele diz montar. Aqui a definição é REESCRITA, sempre.
 */
async function garantirWorkflow(phaseKey: string, passos: Array<{ key: string; label: string }>) {
  const documental = phaseKey === FASE_A
  const wf = await prisma.phaseInternalWorkflow.upsert({
    where: { wfUid: `all::${phaseKey}` },
    update: {
      phaseKey, name: `Workflow Interno · ${phaseKey}`, tipoProcessoId: null, active: true, arquivado: false,
      execucao: 'SEQUENCIAL',
      escopoExecucao: documental ? 'DOCUMENTO' : null,
      exigeDocumento: documental, exigePessoa: documental,
    },
    create: {
      wfUid: `all::${phaseKey}`, phaseKey, name: `Workflow Interno · ${phaseKey}`, tipoProcessoId: null,
      versao: 1, execucao: 'SEQUENCIAL',
      escopoExecucao: documental ? 'DOCUMENTO' : null,
      exigeDocumento: documental, exigePessoa: documental,
    },
    select: { id: true },
  })
  await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: wf.id } })
  await prisma.phaseInternalWorkflowStep.createMany({
    data: passos.map((p, i) => ({
      workflowId: wf.id, key: p.key, label: p.label, ordem: i + 1, createsTask: true, required: true,
      owner: 'equipe_documental', slaDays: 3, cardinalidade: documental ? 'DOCUMENTO' : 'PROCESSO',
    })),
  })
  return wf.id
}

/** Uma certidão do processo: item de catálogo + tipo documental + necessidade + documento. */
async function criarCertidao(processoId: number, arvoreId: number, pessoaId: number, i: number) {
  const item = await prisma.itemCatalogo.create({
    data: { code: `${MARCA}_${i}`, name: 'Certidão de Nascimento - Inteiro Teor', natureza: 'DOCUMENTO' },
    select: { id: true },
  })
  await prisma.tipoDocumentoCadastro.create({
    data: { code: `${MARCA}_T${i}`, name: 'Certidão de Nascimento - Inteiro Teor', nature: 'certidao', itemCatalogoId: item.id },
  })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId, itemCatalogoId: item.id, pessoaId, ciclo: 1, chaveIdempotencia: `${MARCA}-n-${i}` },
    select: { id: true },
  })
  const doc = await prisma.documento.create({
    data: { pessoaId, descricao: `${MARCA} Certidão ${i}`, necessidadeId: nec.id },
    select: { id: true },
  })
  return { necessidadeId: nec.id, documentoId: doc.id }
}

/** Conclui, pela porta canônica, os passos executáveis da fase — no máximo `n`. */
async function concluir(processoId: number, faseMacroKey: string, n: number, usuarioId: number, documentoId?: number) {
  let feitos = 0
  for (let volta = 0; volta < 12 && feitos < n; volta++) {
    const inst = await prisma.phaseWorkflowInstance.findFirst({ where: { processoId, faseMacroKey }, orderBy: { ciclo: 'desc' }, select: { id: true } })
    if (!inst) break
    const alvo = await prisma.phaseWorkflowStepInstance.findFirst({
      where: {
        workflowInstanceId: inst.id, status: { in: ['DISPONIVEL', 'EM_ANDAMENTO'] },
        ...(documentoId ? { documentoId } : {}),
      },
      orderBy: { ordem: 'asc' }, select: { id: true },
    })
    if (!alvo) break
    const r = await concluirPasso(alvo.id, { origem: 'USER', usuarioId })
    if (!r.success) break
    feitos++
  }
  return feitos
}

async function main() {
  if (process.argv.includes('--limpar')) { await limpar(); console.log('palco removido'); return }
  exigirBancoDeTeste('monta o palco do retrocesso de fase')
  await limpar()

  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })

  const daniela = await prisma.usuario.create({
    data: { nome: 'Daniela Brait', email: 'daniela@palco-retrocesso.test', senha: 'x', tipo: 'assistente', permissoesCustom: PERMISSOES_DO_EXECUTOR },
    select: { id: true },
  })
  const gestor = await prisma.usuario.create({
    data: { nome: 'Marco Rovatti', email: 'gestor@palco-retrocesso.test', senha: 'x', tipo: 'admin' },
    select: { id: true },
  })

  const tipo = await prisma.tipoProcessoNacionalidade.findFirst({ where: { ativo: true, arquivado: false }, orderBy: { id: 'asc' }, select: { id: true, countryKey: true } })
  if (!tipo) { console.error('❌ banco de teste sem TipoProcessoNacionalidade ativo'); process.exit(1) }

  // O MACRO define a matriz de fases — o motor lê dele, não de lista no código.
  const macro = await prisma.macroWorkflow.upsert({
    where: { tipoProcessoId: tipo.id },
    update: { ativo: true },
    create: { tipoProcessoId: tipo.id, name: `${MARCA} macro`, versao: 1 },
    select: { id: true },
  })
  // O MACRO É DO PALCO. Outras suítes rodam no mesmo banco e no mesmo tipo de
  // processo; herdar as fases delas faria o motor levar o processo para uma fase que
  // este palco não montou — e o palco mentiria sobre o que está provando.
  await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: macro.id, phaseKey: { notIn: [FASE_A, FASE_B] } } })
  for (const [i, phaseKey] of [FASE_A, FASE_B].entries()) {
    await prisma.faseMacro.upsert({
      where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey } },
      update: { ordem: i, required: true, conditional: false },
      create: { macroWorkflowId: macro.id, phaseKey, label: phaseKey, ordem: i, versao: 1, required: true, conditional: false },
    })
  }
  await garantirWorkflow(FASE_A, PASSOS_A.map((p) => ({ key: p.key, label: p.titulo })))
  await garantirWorkflow(FASE_B, PASSOS_B.map((k) => ({ key: k, label: k.replace(/_/g, ' ') })))

  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const pessoa = await prisma.pessoa.create({
    data: { arvoreId: arv.id, nome: 'Ademir', sobrenome: 'Matheus', linhaReta: true, requerente: 'maior' },
    select: { id: true },
  })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} Abellan`, pais: tipo.countryKey, tipoProcessoMotorId: tipo.id, arvoreId: arv.id, workflowRuntime: 'v2', faseAtualKey: FASE_A },
    select: { id: true },
  })

  // ── 1) A PRIMEIRA CERTIDÃO, e o trabalho dela concluído na fase A ──────────
  const cert1 = await criarCertidao(proc.id, arv.id, pessoa.id, 1)
  await reconciliarFaseAtiva(proc.id)
  await reconciliarTarefas({ processoId: proc.id })
  await concluir(proc.id, FASE_A, PASSOS_A.length, daniela.id, cert1.documentoId)

  // O motor levou o processo para B sozinho ao cair a última pendência de A.
  const posA = await prisma.processo.findUnique({ where: { id: proc.id }, select: { faseAtualKey: true } })
  if (posA?.faseAtualKey !== FASE_B) {
    console.error(`❌ o palco esperava o processo em ${FASE_B} depois de concluir ${FASE_A}; está em ${posA?.faseAtualKey}`)
    process.exit(1)
  }

  // ── 2) TRABALHO PARCIAL EM B — é ele que precisa sobreviver ao retrocesso ──
  await reconciliarTarefas({ processoId: proc.id })
  const feitosB = await concluir(proc.id, FASE_B, 2, daniela.id)

  // ── 3) UMA OBRIGAÇÃO NOVA NASCE NA FASE A ─────────────────────────────────
  // É a razão de o administrador voltar: apareceu uma segunda certidão.
  const cert2 = await criarCertidao(proc.id, arv.id, pessoa.id, 2)

  // ── 4) O RETROCESSO, pela porta canônica ──────────────────────────────────
  const mv = await movePhaseManual(proc.id, {
    faseAlvo: FASE_A,
    justificativa: 'Apareceu uma segunda certidão a emitir antes da análise.',
    motivoCodigo: 'CORRECAO_CADASTRO', solicitadoPorId: gestor.id, origem: 'palco',
  })
  if (!mv.success) { console.error('❌ movimentação manual falhou', JSON.stringify(mv)); process.exit(1) }

  // ── 5) QUASE TUDO DA CERTIDÃO NOVA JÁ FEITO — sobra a ÚLTIMA etapa ────────
  // A conclusão dessa última etapa é o gesto que o navegador vai executar.
  await reconciliarTarefas({ processoId: proc.id })
  await concluir(proc.id, FASE_A, PASSOS_A.length - 1, daniela.id, cert2.documentoId)
  await reconciliarTarefas({ processoId: proc.id })

  const tarefaDaCert2 = await prisma.tarefa.findFirst({
    where: { processoId: proc.id, documentoId: cert2.documentoId, statusTarefa: { notIn: ['CONCLUIDO_RECEBIDO', 'CANCELADA', 'SUPERSEDIDA'] } },
    orderBy: { id: 'desc' }, select: { id: true },
  })
  if (tarefaDaCert2) await atribuirTarefa({ tarefaId: tarefaDaCert2.id, responsavelId: daniela.id, autorId: gestor.id })

  const instB = await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: proc.id, faseMacroKey: FASE_B }, orderBy: { ciclo: 'desc' }, select: { id: true, ciclo: true } })
  const concluidosEmB = await prisma.phaseWorkflowStepInstance.count({
    where: { workflowInstanceId: instB!.id, status: { in: ['CONCLUIDO', 'DISPENSADO'] } },
  })
  const ultimaEtapa = await prisma.phaseWorkflowStepInstance.findFirst({
    where: { processoId: proc.id, faseMacroKey: FASE_A, documentoId: cert2.documentoId, status: { in: ['DISPONIVEL', 'EM_ANDAMENTO'] } },
    orderBy: { ordem: 'asc' }, select: { id: true, stepKey: true },
  })

  console.log(JSON.stringify({
    processoId: proc.id,
    faseAtual: FASE_A,
    faseSeguinte: FASE_B,
    pessoaId: pessoa.id,
    documentoConcluidoId: cert1.documentoId,
    documentoPendenteId: cert2.documentoId,
    tarefaPendenteId: tarefaDaCert2?.id ?? null,
    ultimaEtapaId: ultimaEtapa?.id ?? null,
    ultimaEtapaKey: ultimaEtapa?.stepKey ?? null,
    passosConcluidosEmB: concluidosEmB,
    passosTotaisEmB: PASSOS_B.length,
    feitosBnoPalco: feitosB,
    danielaId: daniela.id,
    danielaEmail: 'daniela@palco-retrocesso.test',
    gestorId: gestor.id,
    gestorEmail: 'gestor@palco-retrocesso.test',
  }))
}

void main().finally(() => prisma.$disconnect())
