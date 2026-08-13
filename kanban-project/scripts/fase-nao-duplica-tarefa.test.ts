// scripts/fase-nao-duplica-tarefa.test.ts
// ============================================================================
// MUDAR DE FASE MOVE O TRABALHO — NÃO O MULTIPLICA.
//
//   npx tsx scripts/fase-nao-duplica-tarefa.test.ts
//
// Este é o caso do Ademir, reproduzido em laboratório. Em produção, a certidão
// de nascimento dele (documento 2111) virou DUAS tarefas vivas, ambas com a
// Daniela, ambas em andamento:
//
//   #3358  tarefa::proc:523::nec:190::pes:2692::ciclo:1   fase genealogia (SUPERSEDIDO)
//   #3359  unidade|proc523|doc2111|pes0|roleprincipal|c1  fase emissao_documental (ATIVO)
//
// A mesma certidão. A mesma pessoa. Dois cartões na fila, e ninguém conseguia
// dizer qual era "a" tarefa.
//
// A prova aqui é sobre IDENTIDADE, não sobre contagem: avançar, voltar e
// avançar de novo tem de devolver o MESMO taskId, com o histórico intacto e a
// tarefa apontando para o roteiro que agora vale.
//
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { prisma } from '../lib/prisma'
import { exigirBancoDeTeste } from './_banco-de-teste'
import { materializarExecucaoDaFase } from '../src/services/materializar-fase'
import { movePhaseManual } from '../src/lib/motor/phase-advance'
import { chaveDaUnidade, tarefaVivaDaUnidade } from '../lib/operacional/identidade-da-tarefa'

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = 'FASEDUP'
const FASES = ['genealogia', 'emissao_documental'] as const

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: 'Tarefa', entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: ts.map((t) => t.id) } } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateId: { in: ts.map((t) => t.id) }, aggregateType: 'Tarefa' } })
  await prisma.workflowEvento.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { descricao: { startsWith: MARCA } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  const wfs = await prisma.phaseInternalWorkflow.findMany({ where: { wfUid: { startsWith: MARCA } }, select: { id: true } })
  await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: { in: wfs.map((w) => w.id) } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { id: { in: wfs.map((w) => w.id) } } })
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({ where: { code: { startsWith: MARCA } }, select: { id: true } })
  const macros = await prisma.macroWorkflow.findMany({ where: { tipoProcessoId: { in: tipos.map((t) => t.id) } }, select: { id: true } })
  await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
  await prisma.macroWorkflow.deleteMany({ where: { id: { in: macros.map((m) => m.id) } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: { in: tipos.map((t) => t.id) } } })
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@fasedup.test' } } })
}

async function main() {
  exigirBancoDeTeste('monta o palco da mudança de fase')
  console.log('MUDAR DE FASE MOVE O TRABALHO — o caso do Ademir, em laboratório\n')
  await limpar()

  // ── palco: um processo, uma certidão, duas fases ──────────────────────────
  const admin = await prisma.usuario.create({
    data: { nome: 'Admin FaseDup', email: 'admin@fasedup.test', senha: 'x', tipo: 'admin' },
    select: { id: true },
  })
  const tipo = await prisma.tipoProcessoNacionalidade.create({
    data: {
      code: `${MARCA}_ESP`, name: `${MARCA} Espanha`, countryKey: 'espanha', countryLabel: 'Espanha',
      nationalityKey: 'espanhola', nationalityLabel: 'Espanhola',
      modalityKey: 'administrativa', modalityLabel: 'Administrativa',
    },
    select: { id: true },
  })
  const macro = await prisma.macroWorkflow.create({
    data: { tipoProcessoId: tipo.id, name: `${MARCA} macro`, versao: 1 }, select: { id: true },
  })
  for (const [i, phaseKey] of FASES.entries()) {
    await prisma.faseMacro.create({
      data: { macroWorkflowId: macro.id, phaseKey, label: phaseKey, ordem: i, versao: 1 },
    })
    const wf = await prisma.phaseInternalWorkflow.create({
      data: { wfUid: `${MARCA}::${phaseKey}`, phaseKey, name: `WF ${phaseKey}`, tipoProcessoId: tipo.id, versao: 1 },
      select: { id: true },
    })
    // Passo por NECESSIDADE nas duas fases: é a MESMA certidão que atravessa.
    await prisma.phaseInternalWorkflowStep.create({
      data: {
        workflowId: wf.id, key: `${phaseKey}_passo`, label: `Trabalhar em ${phaseKey}`,
        ordem: 1, createsTask: true, required: true, owner: 'equipe_documental', slaDays: 5,
        cardinalidade: 'NECESSIDADE',
      },
    })
  }
  const item = await prisma.itemCatalogo.create({
    data: { code: `${MARCA}_NASC`, name: 'Certidão de Nascimento', natureza: 'DOCUMENTO' }, select: { id: true },
  })
  // A fase opera sobre CERTIDÕES: sem o tipo documental de natureza `certidao`
  // apontando para o item, a necessidade não é alvo de localização registral e o
  // motor recusa materializar — corretamente, e dizendo por quê.
  await prisma.tipoDocumentoCadastro.create({
    data: { code: `${MARCA}_NASC_TIPO`, name: 'Certidão de Nascimento', itemCatalogoId: item.id, nature: 'certidao' },
  })
  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const ademir = await prisma.pessoa.create({
    data: { nome: 'Ademir', sobrenome: 'Matheus', arvoreId: arvore.id, linhaReta: true }, select: { id: true },
  })
  const processo = await prisma.processo.create({
    data: {
      nome: `${MARCA} Família`, pais: 'espanha', arvoreId: arvore.id, workflowRuntime: 'v2',
      faseAtualKey: 'genealogia', tipoProcessoMotorId: tipo.id,
    },
    select: { id: true },
  })
  const nec = await prisma.necessidadeDocumental.create({
    data: {
      processoId: processo.id, itemCatalogoId: item.id, pessoaId: ademir.id, ciclo: 1,
      chaveIdempotencia: `${MARCA}-nec-1`,
    },
    select: { id: true },
  })

  // ══════════════════════════════════════════════════════════════════════════
  secao('1) Materializar: a obrigação vira UMA tarefa')
  // ══════════════════════════════════════════════════════════════════════════
  const rel1 = await materializarExecucaoDaFase({ processoId: processo.id, fonte: 'PROCESSO_CRIADO' })
  ok('a fase materializou', rel1.passosTotais > 0, `${rel1.estado} · ${rel1.passosTotais} passo(s)`)

  const vivas = async () => prisma.tarefa.findMany({
    where: {
      processoId: processo.id,
      statusTarefa: { notIn: ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI', 'CANCELADA'] },
    },
    orderBy: { id: 'asc' },
    select: {
      id: true, chaveIdempotencia: true, workflowInstanceId: true, faseMacroKey: true,
      necessidadeId: true, documentoId: true, pessoaId: true, statusTarefa: true, dataInicio: true,
      responsavelId: true,
    },
  })

  let t = await vivas()
  ok('nasceu exatamente UMA tarefa', t.length === 1, `${t.length}`)
  const taskIdOriginal = t[0]?.id
  ok('e a identidade dela é a da obrigação',
    t[0]?.chaveIdempotencia === chaveDaUnidade({ processoId: processo.id, necessidadeId: nec.id, pessoaId: ademir.id, ciclo: 1 }),
    t[0]?.chaveIdempotencia ?? '—')

  // Alguém trabalhou: é isto que torna a duplicação cara.
  await prisma.tarefa.update({
    where: { id: taskIdOriginal },
    data: { statusTarefa: 'EM_ANDAMENTO', dataInicio: new Date(), responsavelId: admin.id },
  })

  // ══════════════════════════════════════════════════════════════════════════
  secao('2) Avançar de fase: a MESMA tarefa segue o trabalho')
  // ══════════════════════════════════════════════════════════════════════════
  const mov1 = await movePhaseManual(processo.id, {
    faseAlvo: 'emissao_documental', justificativa: 'o trabalho continua na emissão',
    motivoCodigo: 'CORRECAO_OPERACIONAL', solicitadoPorId: admin.id,
  })
  ok('a movimentação foi aceita', mov1.success, mov1.success ? mov1.resultado : `${mov1.code}: ${mov1.message}`)
  await materializarExecucaoDaFase({ processoId: processo.id, fonte: 'MOVIMENTACAO_MANUAL' })

  t = await vivas()
  ok('continua UMA tarefa viva — não duas', t.length === 1,
    t.map((x) => `#${x.id} ${x.faseMacroKey} ${x.statusTarefa}`).join(' | '))
  ok('e é a MESMA tarefa', t[0]?.id === taskIdOriginal, `#${t[0]?.id} (era #${taskIdOriginal})`)
  ok('que agora aponta para a fase nova', t[0]?.faseMacroKey === 'emissao_documental', t[0]?.faseMacroKey ?? '—')
  ok('o trabalho já feito foi preservado',
    t[0]?.statusTarefa === 'EM_ANDAMENTO' && t[0]?.dataInicio != null && t[0]?.responsavelId === admin.id)

  const reancoragem = await prisma.logAuditoria.count({
    where: { entidade: 'Tarefa', entidadeId: taskIdOriginal, acao: 'TAREFA_REANCORADA' },
  })
  ok('e a mudança de âncora ficou auditada', reancoragem >= 1, `${reancoragem} registro(s)`)

  // ══════════════════════════════════════════════════════════════════════════
  secao('3) Voltar e avançar de novo: zero duplicação, zero reset')
  // ══════════════════════════════════════════════════════════════════════════
  const volta = await movePhaseManual(processo.id, {
    faseAlvo: 'genealogia', justificativa: 'faltou um dado na genealogia',
    motivoCodigo: 'CORRECAO_OPERACIONAL', solicitadoPorId: admin.id,
  })
  ok('voltar de fase é aceito', volta.success, volta.success ? volta.resultado : `${volta.code}: ${volta.message}`)
  await materializarExecucaoDaFase({ processoId: processo.id, fonte: 'MOVIMENTACAO_MANUAL' })

  const mov2 = await movePhaseManual(processo.id, {
    faseAlvo: 'emissao_documental', justificativa: 'resolvido, seguindo',
    motivoCodigo: 'CORRECAO_OPERACIONAL', solicitadoPorId: admin.id,
  })
  ok('avançar de novo é aceito', mov2.success, mov2.success ? mov2.resultado : `${mov2.code}: ${mov2.message}`)
  await materializarExecucaoDaFase({ processoId: processo.id, fonte: 'MOVIMENTACAO_MANUAL' })

  t = await vivas()
  ok('depois de avançar-voltar-avançar continua UMA', t.length === 1,
    t.map((x) => `#${x.id} ${x.faseMacroKey}`).join(' | '))
  ok('com o MESMO taskId do começo', t[0]?.id === taskIdOriginal, `#${t[0]?.id} (era #${taskIdOriginal})`)
  ok('e sem reset do que já tinha sido feito',
    t[0]?.statusTarefa === 'EM_ANDAMENTO' && t[0]?.dataInicio != null)

  // ══════════════════════════════════════════════════════════════════════════
  secao('4) A busca pela unidade acha a tarefa por QUALQUER lado')
  // ══════════════════════════════════════════════════════════════════════════
  // É esta simetria que faltava: #3358 conhecia a necessidade, #3359 conhecia
  // só o documento, e nenhuma das duas encontrava a outra.
  const doc = await prisma.documento.create({
    data: { pessoaId: ademir.id, descricao: `${MARCA} Certidão`, necessidadeId: nec.id },
    select: { id: true },
  })
  await prisma.tarefa.update({ where: { id: taskIdOriginal }, data: { documentoId: doc.id } })

  const porNecessidade = await tarefaVivaDaUnidade(prisma, { processoId: processo.id, necessidadeId: nec.id, ciclo: 1 })
  const porDocumento = await tarefaVivaDaUnidade(prisma, { processoId: processo.id, documentoId: doc.id, ciclo: 1 })
  ok('quem conhece a NECESSIDADE acha a tarefa', porNecessidade?.id === taskIdOriginal, `#${porNecessidade?.id ?? '—'}`)
  ok('quem conhece o DOCUMENTO acha a MESMA', porDocumento?.id === taskIdOriginal, `#${porDocumento?.id ?? '—'}`)
  ok('e as duas chaves normalizadas coincidem',
    chaveDaUnidade({ processoId: processo.id, necessidadeId: nec.id, pessoaId: ademir.id, ciclo: 1 })
    === chaveDaUnidade({ processoId: processo.id, necessidadeId: nec.id, documentoId: doc.id, pessoaId: ademir.id, ciclo: 1 }))

  // Tarefa ENCERRADA não é reaproveitada como se fosse pendência aberta.
  await prisma.tarefa.update({ where: { id: taskIdOriginal }, data: { statusTarefa: 'CONCLUIDO_RECEBIDO' } })
  const depoisDeConcluir = await tarefaVivaDaUnidade(prisma, { processoId: processo.id, necessidadeId: nec.id, ciclo: 1 })
  ok('tarefa concluída não volta como pendência', depoisDeConcluir === null)

  await limpar()
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhou === 0
    ? 'Uma obrigação, uma tarefa — atravessando as fases sem se multiplicar.'
    : 'A mudança de fase voltou a duplicar trabalho.')
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

void main()
