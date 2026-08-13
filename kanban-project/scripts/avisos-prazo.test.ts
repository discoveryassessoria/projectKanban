// scripts/avisos-prazo.test.ts
// ============================================================================
// A VARREDURA DE PRAZOS — um aviso por marco, e nunca dois.
//
//   npx tsx scripts/avisos-prazo.test.ts
//
// `avisarPrazosEAtrasos` existia, era testada e não tinha chamador: o prazo
// vencia e ninguém era avisado. Ao ligá-la, o risco deixa de ser o silêncio e
// passa a ser o ruído — um aviso por hora, um por dia, um por varredura, até
// alguém desligar o sino e voltar ao silêncio de antes.
//
// Esta suíte fixa o relógio (nunca `sleep`) e prova o contrato: dois marcos
// (prazo próximo e vencido), um aviso cada, para sempre; concluída não recebe;
// transferência redireciona; alterar o prazo cria marco novo e não ressuscita o
// antigo; execuções concorrentes produzem UMA notificação.
//
// Banco de TESTE, palco próprio. Não toca produção e não envia nada de verdade.
// ============================================================================
import { prisma } from '../lib/prisma'
import { exigirBancoDeTeste } from './_banco-de-teste'
import { avisarPrazosEAtrasos, marcoDoPrazo, atribuirTarefa } from '../lib/operacional/tarefa-comandos'
import { alterarPrazo, concluirTarefaSemWorkflow } from '../lib/operacional/tarefa-ciclo'
import { diaOperacional } from '../lib/operacional/tempo-operacional'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const RAIZ = join(__dirname, '..')
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8')
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const MARCA = 'AVISO'
/** Instantes EM SÃO PAULO — o fuso em que a operação vive. */
const emSp = (iso: string) => new Date(`${iso}-03:00`)
const HOJE = emSp('2026-08-14T10:00:00')

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: ts.map((t) => t.id) } } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: 'Tarefa', entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@aviso.test' } } })
}

async function main() {
  exigirBancoDeTeste('monta o palco dos avisos de prazo')
  console.log('OS AVISOS DO RELÓGIO — um por marco, nunca dois\n')
  await limpar()

  const executor = { 'tarefas.ver': true, 'tarefas.iniciar_concluir': true }
  const gestor = await prisma.usuario.create({
    data: { nome: 'Gestor Aviso', email: 'gestor@aviso.test', senha: 'x', tipo: 'admin' }, select: { id: true },
  })
  const dani = await prisma.usuario.create({
    data: { nome: 'Dani Aviso', email: 'dani@aviso.test', senha: 'x', tipo: 'assistente', permissoesCustom: executor },
    select: { id: true },
  })
  const gabriel = await prisma.usuario.create({
    data: { nome: 'Gabriel Aviso', email: 'gabriel@aviso.test', senha: 'x', tipo: 'assistente', permissoesCustom: executor },
    select: { id: true },
  })
  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} Família`, pais: 'espanha', arvoreId: arvore.id, workflowRuntime: 'v2', faseAtualKey: 'emissao_documental' },
    select: { id: true },
  })

  let seq = 0
  const tarefa = async (prazo: Date | null, over: Record<string, unknown> = {}) => {
    const t = await prisma.tarefa.create({
      data: {
        titulo: `${MARCA} Certidão ${seq}`,
        processoId: processo.id,
        chaveIdempotencia: `${MARCA}-t-${seq++}`,
        statusTarefa: 'NAO_INICIADA',
        responsavelId: dani.id,
        dataAtribuicao: HOJE,
        dataPrazo: prazo,
        ...over,
      },
      select: { id: true },
    })
    return t.id
  }
  const avisosDe = (tarefaId: number, tipo?: string) =>
    prisma.notificacaoOperacional.findMany({
      where: { tarefaId, ...(tipo ? { tipo } : {}) },
      select: { id: true, tipo: true, destinatarioId: true, link: true, chaveIdempotencia: true, mensagem: true },
      orderBy: { id: 'asc' },
    })

  // ══════════════════════════════════════════════════════════════════════════
  secao('A/B) DOIS DIAS ANTES NÃO AVISA — UM DIA ANTES, SIM')
  // ══════════════════════════════════════════════════════════════════════════
  // Um único marco de antecedência, de propósito. Uma escada 7d/5d/3d/1d ensina
  // as pessoas a ignorar o sino muito antes de o prazo importar.
  const daquiADois = await tarefa(emSp('2026-08-16T12:00:00'))
  const amanha = await tarefa(emSp('2026-08-15T12:00:00'))

  const r1 = await avisarPrazosEAtrasos({ agora: HOJE })
  ok('A) prazo em dois dias não gera aviso', (await avisosDe(daquiADois)).length === 0)
  ok('B) prazo amanhã gera UM aviso', (await avisosDe(amanha)).length === 1, `${r1.prazo} de prazo`)
  const aviso = (await avisosDe(amanha))[0]
  ok('B) do tipo PRAZO', aviso?.tipo === 'PRAZO', aviso?.tipo)
  ok('§3) com a data de conclusão esperada na mensagem',
    (aviso?.mensagem ?? '').includes('15/08/2026'), aviso?.mensagem ?? '—')

  // ══════════════════════════════════════════════════════════════════════════
  secao('C) RODAR DE NOVO NÃO AVISA DE NOVO')
  // ══════════════════════════════════════════════════════════════════════════
  // De hora em hora seriam 24 avisos por dia sobre o mesmo prazo.
  for (let i = 0; i < 5; i++) await avisarPrazosEAtrasos({ agora: HOJE })
  ok('C) cinco varreduras depois, continua UM aviso', (await avisosDe(amanha)).length === 1)
  const r2 = await avisarPrazosEAtrasos({ agora: HOJE })
  ok('C) e a varredura reporta o marco como já avisado', r2.deduplicados >= 1, `${r2.deduplicados} dedup`)
  ok('C) sem contar como novo', r2.prazo === 0 && r2.atraso === 0)

  // ══════════════════════════════════════════════════════════════════════════
  secao('D/E) VENCEU: UM ATRASO, E SÓ UM — nem no dia seguinte')
  // ══════════════════════════════════════════════════════════════════════════
  const depoisDoPrazo = emSp('2026-08-16T10:00:00')
  await avisarPrazosEAtrasos({ agora: depoisDoPrazo })
  ok('D) o vencimento gera aviso de ATRASO', (await avisosDe(amanha, 'ATRASO')).length === 1)
  ok('D) e o de prazo próximo continua único', (await avisosDe(amanha, 'PRAZO')).length === 1)

  // O TESTE QUE JUSTIFICA A CHAVE NÃO CARREGAR O DIA DA VARREDURA.
  for (const dia of ['2026-08-17', '2026-08-18', '2026-08-19', '2026-09-01']) {
    await avisarPrazosEAtrasos({ agora: emSp(`${dia}T10:00:00`) })
  }
  ok('E) quatro dias depois, o atraso continua sendo UM aviso',
    (await avisosDe(amanha, 'ATRASO')).length === 1,
    'um prazo vencido é um fato, não um fato por manhã')

  // ══════════════════════════════════════════════════════════════════════════
  secao('§13) O AVISO LEVA AO TRABALHO — deep-link canônico')
  // ══════════════════════════════════════════════════════════════════════════
  ok('§13) o link é o deep-link operacional',
    /^\/kanban\?processoId=\d+&tab=central&taskId=\d+$/.test(aviso?.link ?? ''), aviso?.link ?? '—')

  // ══════════════════════════════════════════════════════════════════════════
  secao('F/§8) CONCLUÍDA E TERMINAIS FICAM DE FORA')
  // ══════════════════════════════════════════════════════════════════════════
  const concluida = await tarefa(emSp('2026-08-15T12:00:00'))
  await concluirTarefaSemWorkflow({ tarefaId: concluida, autorId: dani.id, resultado: 'pronto' })
  await avisarPrazosEAtrasos({ agora: HOJE })
  ok('F) tarefa concluída não recebe aviso de prazo', (await avisosDe(concluida)).length === 0)
  await avisarPrazosEAtrasos({ agora: emSp('2026-09-01T10:00:00') })
  ok('F) nem de atraso depois de vencer', (await avisosDe(concluida)).length === 0,
    'concluir congela o relógio — o alerta não sobrevive ao fato')

  const cancelada = await tarefa(emSp('2026-08-15T12:00:00'), { statusTarefa: 'CANCELADA' })
  await avisarPrazosEAtrasos({ agora: emSp('2026-09-01T10:00:00') })
  ok('§8) estado terminal fica fora da varredura', (await avisosDe(cancelada)).length === 0)

  // ══════════════════════════════════════════════════════════════════════════
  secao('G/§9/§10) ESPERA E BLOQUEIO: a varredura LÊ o prazo efetivo')
  // ══════════════════════════════════════════════════════════════════════════
  // Ela não decide se o SLA pausa — quem decide é o workflow publicado, e a
  // retomada já empurra `dataPrazo`. Aqui se prova que ela respeita o que
  // encontrar, em vez de recalcular por conta própria.
  const esperando = await tarefa(emSp('2026-08-15T12:00:00'), { statusTarefa: 'AGUARDANDO_TERCEIRO' })
  await avisarPrazosEAtrasos({ agora: HOJE })
  ok('G) aguardando terceiro com prazo amanhã ainda é avisado',
    (await avisosDe(esperando, 'PRAZO')).length === 1,
    'espera externa não apaga o compromisso; se a política pausa, o prazo já veio empurrado')

  const pausada = await tarefa(emSp('2026-08-25T12:00:00'), {
    statusTarefa: 'AGUARDANDO_TERCEIRO', slaPausadoEm: HOJE, slaPausaAcumuladaMin: 4320,
  })
  await avisarPrazosEAtrasos({ agora: HOJE })
  ok('G) e prazo empurrado pela pausa NÃO gera aviso antecipado',
    (await avisosDe(pausada)).length === 0,
    'o prazo efetivo é 25/08 — avisar hoje seria a varredura inventando conta própria')

  const bloqueada = await tarefa(emSp('2026-08-15T12:00:00'), { statusTarefa: 'BLOQUEADA' })
  await avisarPrazosEAtrasos({ agora: HOJE })
  ok('§10) bloqueada segue a mesma régua', (await avisosDe(bloqueada, 'PRAZO')).length === 1)

  // ══════════════════════════════════════════════════════════════════════════
  secao('H/§12) TRANSFERÊNCIA: o aviso é de quem tem a tarefa AGORA')
  // ══════════════════════════════════════════════════════════════════════════
  const transferida = await tarefa(emSp('2026-08-15T12:00:00'))
  await atribuirTarefa({ tarefaId: transferida, responsavelId: gabriel.id, autorId: gestor.id, motivo: 'redistribuição' })
  await avisarPrazosEAtrasos({ agora: HOJE })
  const avisoTransf = (await avisosDe(transferida, 'PRAZO'))[0]
  ok('H) o aviso vai para o responsável ATUAL',
    avisoTransf?.destinatarioId === gabriel.id, `destinatário ${avisoTransf?.destinatarioId}`)
  ok('§12) e não para o dono histórico', avisoTransf?.destinatarioId !== dani.id,
    'avisar quem já não tem a tarefa é avisar quem não pode fazer nada')

  // ══════════════════════════════════════════════════════════════════════════
  secao('I/§6) MUDAR O PRAZO CRIA MARCO NOVO — e não ressuscita o antigo')
  // ══════════════════════════════════════════════════════════════════════════
  const remarcada = await tarefa(emSp('2026-08-15T12:00:00'))
  await avisarPrazosEAtrasos({ agora: HOJE })
  ok('I) avisou pelo prazo original', (await avisosDe(remarcada, 'PRAZO')).length === 1)

  await alterarPrazo({
    tarefaId: remarcada, autorId: gestor.id,
    novoPrazo: emSp('2026-08-20T12:00:00'), motivo: 'cartório pediu mais prazo',
  })
  // O dia seguinte ao prazo ANTIGO: se a identidade do marco fosse só a tarefa,
  // ou o dia da varredura, aqui nasceria um "atraso" de um prazo que já não existe.
  await avisarPrazosEAtrasos({ agora: emSp('2026-08-16T10:00:00') })
  ok('§6) o prazo antigo não gera atraso depois do override',
    (await avisosDe(remarcada, 'ATRASO')).length === 0,
    'seria contraditório: a tarefa não está atrasada, ela foi remarcada')

  await avisarPrazosEAtrasos({ agora: emSp('2026-08-19T10:00:00') })
  const avisosRemarcada = await avisosDe(remarcada, 'PRAZO')
  ok('I) o prazo NOVO gera o seu próprio marco', avisosRemarcada.length === 2, `${avisosRemarcada.length} avisos`)
  ok('§5) e as duas chaves são distintas, pelo prazo de referência',
    avisosRemarcada[0].chaveIdempotencia !== avisosRemarcada[1].chaveIdempotencia
    && avisosRemarcada[1].chaveIdempotencia.endsWith('2026-08-20'),
    avisosRemarcada[1].chaveIdempotencia)

  // ══════════════════════════════════════════════════════════════════════════
  secao('J/§16) CONCORRÊNCIA: duas varreduras, uma notificação')
  // ══════════════════════════════════════════════════════════════════════════
  const disputada = await tarefa(emSp('2026-08-15T12:00:00'))
  await Promise.all([
    avisarPrazosEAtrasos({ agora: HOJE }),
    avisarPrazosEAtrasos({ agora: HOJE }),
    avisarPrazosEAtrasos({ agora: HOJE }),
  ])
  ok('J) três varreduras simultâneas geram UM aviso',
    (await avisosDe(disputada, 'PRAZO')).length === 1,
    'a garantia é do índice único, não da leitura anterior')

  // ══════════════════════════════════════════════════════════════════════════
  secao('K/§11) SEM RESPONSÁVEL: nenhum destinatário é inventado')
  // ══════════════════════════════════════════════════════════════════════════
  const orfa = await tarefa(emSp('2026-08-15T12:00:00'), { responsavelId: null, dataAtribuicao: null })
  const rOrfa = await avisarPrazosEAtrasos({ agora: HOJE })
  ok('K) tarefa sem responsável não gera aviso', (await avisosDe(orfa)).length === 0)
  ok('K) e a varredura reporta o caso em vez de escondê-lo',
    rOrfa.semDestinatario >= 1, `${rOrfa.semDestinatario} sem destinatário`)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§20) O ENSAIO CONTA SEM ENVIAR')
  // ══════════════════════════════════════════════════════════════════════════
  const novaParaEnsaio = await tarefa(emSp('2026-08-15T12:00:00'))
  const antes = await prisma.notificacaoOperacional.count()
  const ensaio = await avisarPrazosEAtrasos({ agora: HOJE, ensaio: true })
  const depois = await prisma.notificacaoOperacional.count()
  ok('§20) o ensaio não escreve nada', antes === depois, `${antes} → ${depois}`)
  ok('§20) mas diz o que enviaria', ensaio.previa.length >= 1 && ensaio.prazo >= 1,
    `${ensaio.previa.length} aviso(s) previsto(s)`)
  ok('§20) com tarefa, tipo e destinatário',
    ensaio.previa.every((p) => p.tarefaId > 0 && p.destinatarioId > 0 && !!p.tipo))
  ok('§20) e conta como já avisado o que já foi',
    ensaio.deduplicados >= 1, `${ensaio.deduplicados} dedup`)
  void novaParaEnsaio

  // ══════════════════════════════════════════════════════════════════════════
  secao('§1/§21) A VARREDURA NÃO ESCREVE NADA ALÉM DE NOTIFICAÇÃO')
  // ══════════════════════════════════════════════════════════════════════════
  const fonte = semComentarios(ler('lib/operacional/tarefa-comandos.ts'))
  const corpo = fonte.slice(
    fonte.indexOf('export async function avisarPrazosEAtrasos'),
    fonte.indexOf('export interface ItemDaRedistribuicao'),
  )
  ok('§1) ela não atualiza tarefa', !/tarefa\.update|tarefa\.updateMany/.test(corpo))
  ok('§1) não mexe em passo nem workflow',
    !/phaseWorkflowStepInstance|transicionarPasso|workflowInstance\./.test(corpo))
  ok('§1) e não chama comando de tarefa',
    !/iniciarTarefa\(|atribuirTarefa\(|concluir|bloquear/.test(corpo))
  ok('§15) o dia vem da régua canônica',
    /diaOperacional\(prazo\)/.test(semComentarios(ler('lib/operacional/tarefa-comandos.ts'))))
  ok('§2) só existem os dois tipos permitidos',
    !/PROGRESSO|STEP_MUDOU|LEMBRETE/.test(corpo))

  const rota = semComentarios(ler('src/app/api/cron/avisos-prazo/route.ts'))
  ok('§14) existe um chamador real', /avisarPrazosEAtrasos\(/.test(rota))
  ok('§14) e ele só chama a varredura',
    !/\bprisma\s*\.\s*\w+\s*\.\s*(create|update|delete)/.test(rota))
  ok('§14) protegido como os outros crons',
    /x-vercel-cron/.test(rota) && /CRON_SECRET/.test(rota))
  const cron = JSON.parse(ler('vercel.json')) as { crons: Array<{ path: string; schedule: string }> }
  const agendado = cron.crons.find((c) => c.path === '/api/cron/avisos-prazo')
  ok('§14) agendado de hora em hora', agendado?.schedule === '0 * * * *', agendado?.schedule ?? 'ausente')

  // A identidade do marco, conferida diretamente.
  ok('§5) a chave do marco é tarefa + tipo + prazo',
    marcoDoPrazo('ATRASO', 3358, emSp('2026-08-15T12:00:00')) === 'notif::atraso::t3358::2026-08-15',
    marcoDoPrazo('ATRASO', 3358, emSp('2026-08-15T12:00:00')))
  ok('§5) e ela não carrega o dia da varredura',
    !marcoDoPrazo('ATRASO', 3358, emSp('2026-08-15T12:00:00')).includes(diaOperacional(new Date()))
    || diaOperacional(new Date()) === '2026-08-15')

  await limpar()
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhou === 0
    ? 'Dois marcos, um aviso cada — e o sino continua significando alguma coisa.'
    : 'A varredura de prazos voltou a fazer barulho.')
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

void main()
