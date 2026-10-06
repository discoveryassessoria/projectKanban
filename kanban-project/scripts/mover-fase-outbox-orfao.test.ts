// scripts/mover-fase-outbox-orfao.test.ts
// ============================================================================
// GUARDA — "Conflito de concorrência na mudança de fase" (Antão, ES-2, 06/10/2026).
// Causa: a chave do evento `phase-workflow.instanced` do outbox NÃO levava o id da instância; processo cuja instância foi apagada e que reentra
// na mesma fase/ciclo/versão batia na linha ENVIADA da instância antiga (unique) e a transação inteira abortava.
// PROVA (banco de teste): com a linha de outbox da instância antiga ainda lá, reinstanciar a fase SUCEDE, cria a instância e grava um evento NOVO
// com chave distinta; repetir a mesma chamada é idempotente (created=false, sem 2º evento).
// ============================================================================
import { exigirBancoDeTeste } from './_banco-de-teste'
exigirBancoDeTeste('mover-fase-outbox-orfao.test.ts')

import { prisma } from '../lib/prisma'
import { garantirOferta } from './_fixture-oferta'
import { criarProcessoV2 } from '../src/services/criar-processo'
import { instanciarWorkflowDaFase } from '../src/services/phase-workflow'

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = '') => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ''}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ''}`) } }

const MARCA = 'OBORF'
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
  const insts = await prisma.phaseWorkflowInstance.findMany({ where: { processoId: { in: procIds } }, select: { id: true } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'PhaseWorkflowInstance', aggregateId: { in: insts.map((i) => i.id) } } })
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
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@oborf.test' } } })
}

async function main() {
  console.log('MOVER FASE — outbox órfão não pode abortar a instanciação\n')
  await limpar()
  const admin = await prisma.usuario.create({ data: { nome: 'Admin Oborf', email: 'admin@oborf.test', senha: 'x', tipo: 'admin' }, select: { id: true } })
  const oferta = await garantirOferta(prisma, { countryKey: `${MARCA}_PAIS`, countryLabel: 'País Oborf', modalityKey: 'administrativa', modalityLabel: 'Administrativa' })
  const pais = await prisma.catalogoPais.findUniqueOrThrow({ where: { id: oferta.paisId }, select: { countryKey: true } })
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })

  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: `${MARCA}_T`, name: `${MARCA} T`, paisId: oferta.paisId }, select: { id: true } })
  await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, ativo: true } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, name: `${MARCA} macro`, versao: 1 }, select: { id: true } })
  const fases = [{ phaseKey: GEN, ordem: 1, required: true, label: 'Genealogia' }, { phaseKey: FIM, ordem: 2, required: true, label: 'Finalizado' }]
  for (const f of fases) await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: f.phaseKey, label: f.label, ordem: f.ordem, required: f.required, conditional: false } })
  await prisma.macroWorkflowVersao.create({ data: { macroWorkflowId: macro.id, versao: 1, tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, cardinalidadeRequerimento: 'INDIVIDUAL', name: `${MARCA} macro`, fases: fases.map(({ phaseKey, ordem, required }) => ({ phaseKey, ordem, required })), origem: 'CRIACAO' } })
  for (const phaseKey of [GEN, FIM]) {
    const wf = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `${MARCA}::${phaseKey}`, phaseKey, name: `WF ${phaseKey}`, tipoProcessoId: tipo.id, versao: 1 }, select: { id: true } })
    await prisma.phaseInternalWorkflowStep.create({ data: { workflowId: wf.id, key: `${phaseKey}_passo`, label: `Passo ${phaseKey}`, ordem: 1, createsTask: true, required: false, owner: null, slaDays: 0, cardinalidade: 'PROCESSO' } })
  }

  const r = await criarProcessoV2({ nome: `${MARCA} processo`, pais: pais.countryKey, tipoProcessoMotorId: tipo.id, modalidadeId: oferta.modalidadeId, idempotencyKey: `${MARCA}-1`, solicitadoPorId: admin.id })
  ok('processo criado (nasce em genealogia, já instanciada)', r.success, r.success ? r.processCode : `${r.code}: ${r.message}`)
  if (!r.success) throw new Error('criação falhou')
  const pid = r.processId

  const antiga = await prisma.phaseWorkflowInstance.findFirstOrThrow({ where: { processoId: pid, faseMacroKey: GEN, ciclo: 1 }, select: { id: true } })
  const outboxAntes = await prisma.domainOutbox.findMany({ where: { tipo: 'phase-workflow.instanced', aggregateId: antiga.id }, select: { chaveIdempotencia: true } })
  ok('a instância original gravou UM evento de outbox cuja chave leva o id da instância', outboxAntes.length === 1 && (outboxAntes[0].chaveIdempotencia ?? '').endsWith(`|wfi${antiga.id}`), outboxAntes[0]?.chaveIdempotencia ?? '')

  // Reinício: a instância some (e seus passos/tarefas); a linha do outbox FICA — é o estado real do Antão.
  await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: pid } } })
  await prisma.tarefa.deleteMany({ where: { processoId: pid } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: pid } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: pid } })
  ok('PRÉ-CONDIÇÃO: instância apagada, evento órfão permanece', (await prisma.phaseWorkflowInstance.count({ where: { processoId: pid } })) === 0 && (await prisma.domainOutbox.count({ where: { tipo: 'phase-workflow.instanced', aggregateId: antiga.id } })) === 1)

  const nova = await instanciarWorkflowDaFase({ processoId: pid, faseMacroKey: GEN, ciclo: 1 })
  ok('reinstanciar a MESMA fase/ciclo/versão NÃO aborta (era o "Conflito de concorrência")', nova.success && nova.created, nova.success ? '' : JSON.stringify(nova))
  if (nova.success) {
    const evNovo = await prisma.domainOutbox.findMany({ where: { tipo: 'phase-workflow.instanced', aggregateType: 'PhaseWorkflowInstance', aggregateId: { not: antiga.id }, payload: { path: ['processoId'], equals: pid } }, select: { chaveIdempotencia: true } })
    ok('a nova instância grava seu PRÓPRIO evento, com chave distinta da órfã', evNovo.length === 1 && !outboxAntes.some((o) => o.chaveIdempotencia === evNovo[0].chaveIdempotencia), evNovo[0]?.chaveIdempotencia ?? '')
    const de = await instanciarWorkflowDaFase({ processoId: pid, faseMacroKey: GEN, ciclo: 1 })
    ok('repetir é idempotente: created=false e nenhum evento a mais', de.success && !de.created && (await prisma.domainOutbox.count({ where: { tipo: 'phase-workflow.instanced', payload: { path: ['processoId'], equals: pid } } })) === 2)
  }

  await limpar()
  console.log(`\n${passou} ok, ${falhou} falha(s)`)
  if (falhou) { console.log(falhas.join('\n')); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
