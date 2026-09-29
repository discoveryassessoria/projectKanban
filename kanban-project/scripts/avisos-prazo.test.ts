// scripts/avisos-prazo.test.ts
// ============================================================================
// O RESUMO DO DIA E A VARREDURA HORÁRIA — um aviso por (pessoa, família), nunca por tarefa.
//
//   npx tsx scripts/avisos-prazo.test.ts
//
// Contrato (redesenho do sino, 29/09/2026): não existe mais "um aviso por marco de prazo".
// O PRECISA_AGIR é UM aviso não lido por (pessoa, família), recomposto a partir da Operação:
// "<Família> — X vencidas · Y vencem hoje · Z vencem amanhã · W cobranças a fazer" (partes
// zeradas omitidas). Às 07:00 (`0 10 * * *` UTC) o resumo diário grava a foto do dia; de hora
// em hora a varredura só atualiza o aviso aberto e abre aviso por FATO NOVO.
//
// Esta suíte fixa o relógio (nunca `sleep`) e prova o contrato: prazo distante não avisa;
// amanhã/hoje/vencida entram no resumo; rodar de novo não empilha nem renotifica; concluída
// e cancelada não entram; transferência redireciona; alterar o prazo recompõe o resumo;
// execuções concorrentes produzem UM aviso; o ensaio não grava.
//
// Banco de TESTE, palco próprio. Não toca produção e não envia nada de verdade.
// ============================================================================
import { prisma } from '../lib/prisma'
import { exigirBancoDeTeste } from './_banco-de-teste'
import { atribuirTarefa } from '../lib/operacional/tarefa-comandos'
import { alterarPrazo, concluirTarefaSemWorkflow } from '../lib/operacional/tarefa-ciclo'
import { rodarResumoDiario, rodarVarreduraHoraria, avaliarPrecisaAgir, precisaDeVoce } from '../lib/operacional/avisos-sino'
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
  const users = await prisma.usuario.findMany({ where: { email: { endsWith: '@aviso.test' } }, select: { id: true } })
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({
    where: { OR: [{ destinatarioId: { in: users.map((u) => u.id) } }, { processoId: { in: ids } }, { tarefaId: { in: ts.map((t) => t.id) } }] },
  })
  await prisma.logAuditoria.deleteMany({ where: { entidade: 'Tarefa', entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@aviso.test' } } })
}

async function main() {
  exigirBancoDeTeste('monta o palco dos avisos de prazo')
  console.log('O RESUMO DO DIA — um aviso por (pessoa, família), nunca por tarefa\n')
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

  /** Uma família (processo) por cenário: o aviso é por (pessoa, família), então o cenário é a família. */
  const familia = async (nome: string) => {
    const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} árvore ${nome}` }, select: { id: true } })
    const p = await prisma.processo.create({
      data: { nome: `${MARCA} ${nome}`, arvoreId: arvore.id, workflowRuntime: 'v2', faseAtualKey: 'emissao_documental' },
      select: { id: true },
    })
    return p.id
  }

  let seq = 0
  const tarefa = async (processoId: number, prazo: Date | null, over: Record<string, unknown> = {}) => {
    const t = await prisma.tarefa.create({
      data: {
        titulo: `${MARCA} Certidão ${seq}`,
        processoId,
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
  /** Os PRECISA_AGIR (agrupados) da família; `aberto` = ainda não lido. */
  const agir = (processoId: number, dest?: number) =>
    prisma.notificacaoOperacional.findMany({
      where: { tipo: 'PRECISA_AGIR', agrupado: true, processoId, lidaEm: null, ...(dest ? { destinatarioId: dest } : {}) },
      select: { id: true, destinatarioId: true, link: true, titulo: true, tarefaIds: true, contagem: true, tarefaId: true, atualizadoEm: true },
      orderBy: { id: 'asc' },
    })

  // ══════════════════════════════════════════════════════════════════════════
  secao('A/B) DOIS DIAS ANTES NÃO AVISA — UM DIA ANTES, SIM (no resumo das 07:00)')
  // ══════════════════════════════════════════════════════════════════════════
  // Um único horizonte de antecedência ("vence amanhã"). Uma escada 7d/5d/3d/1d ensina
  // as pessoas a ignorar o sino muito antes de o prazo importar.
  const famDois = await familia('FamDois')
  const daquiADois = await tarefa(famDois, emSp('2026-08-16T12:00:00'))
  const famAmanha = await familia('FamAmanha')
  const amanha = await tarefa(famAmanha, emSp('2026-08-15T12:00:00'))
  const famHoje = await familia('FamHoje')
  const hoje = await tarefa(famHoje, emSp('2026-08-14T18:00:00'))

  // A varredura HORÁRIA nunca abre o aviso do dia: quem cria a foto é o resumo das 07:00.
  await rodarVarreduraHoraria({ agora: HOJE })
  ok('B) a varredura horária, sozinha, não abre o aviso do dia', (await agir(famAmanha)).length === 0)

  const r1 = await rodarResumoDiario({ agora: HOJE })
  ok('A) prazo em dois dias não gera aviso', (await agir(famDois)).length === 0)
  const avAmanha = await agir(famAmanha)
  ok('B) prazo amanhã gera UM aviso', avAmanha.length === 1, `${r1.precisaAgir.criados} criados no resumo`)
  ok('B) texto: "<Família> — 1 vence amanhã"', avAmanha[0]?.titulo === `${MARCA} FamAmanha — 1 vence amanhã`, avAmanha[0]?.titulo ?? '—')
  ok('B) do destinatário certo e cobrindo a tarefa', avAmanha[0]?.destinatarioId === dani.id && avAmanha[0].tarefaIds.includes(amanha) && avAmanha[0].contagem === 1)
  ok('B) é um aviso de FAMÍLIA, não de tarefa (tarefaId nulo)', avAmanha[0]?.tarefaId == null)

  // ══════════════════════════════════════════════════════════════════════════
  secao('B2) PRAZO É HOJE — o marco que faltava entre "amanhã" e "atrasado"')
  // ══════════════════════════════════════════════════════════════════════════
  // Achado real (04/09/2026): uma tarefa com prazo no PRÓPRIO dia não gerava nenhum
  // aviso até o dia seguinte, quando já estava vencida.
  const avHoje = await agir(famHoje)
  ok('B2) prazo hoje gera UM aviso', avHoje.length === 1)
  ok('B2) texto: "<Família> — 1 vence hoje"', avHoje[0]?.titulo === `${MARCA} FamHoje — 1 vence hoje`, avHoje[0]?.titulo ?? '—')
  ok('B2) e não é confundido com o de amanhã (aviso próprio, família própria)', avHoje[0]?.id !== avAmanha[0]?.id)

  // Uma família com os três horizontes: as partes vêm em ordem e as zeradas são omitidas.
  const famMisto = await familia('FamMisto')
  await tarefa(famMisto, emSp('2026-08-13T12:00:00'))
  await tarefa(famMisto, emSp('2026-08-14T18:00:00'))
  await tarefa(famMisto, emSp('2026-08-15T12:00:00'))
  await rodarResumoDiario({ agora: HOJE })
  const avMisto = await agir(famMisto)
  ok('B2) partes na ordem, zeradas omitidas: "1 vencida · 1 vence hoje · 1 vence amanhã"',
    avMisto.length === 1 && avMisto[0].titulo === `${MARCA} FamMisto — 1 vencida · 1 vence hoje · 1 vence amanhã`, avMisto[0]?.titulo ?? '—')

  // ══════════════════════════════════════════════════════════════════════════
  secao('C) RODAR DE NOVO NÃO AVISA DE NOVO')
  // ══════════════════════════════════════════════════════════════════════════
  // De hora em hora seriam 24 avisos por dia sobre o mesmo prazo.
  const idAmanha = avAmanha[0].id, topoAntes = avAmanha[0].atualizadoEm
  for (let i = 0; i < 5; i++) await rodarResumoDiario({ agora: HOJE })
  for (let i = 0; i < 3; i++) await rodarVarreduraHoraria({ agora: HOJE })
  const depoisC = await agir(famAmanha)
  ok('C) cinco resumos e três varreduras depois, continua UM aviso, o mesmo', depoisC.length === 1 && depoisC[0].id === idAmanha)
  ok('C) e ele não voltou ao topo (não renotifica)', depoisC[0].atualizadoEm.getTime() === topoAntes.getTime())
  const r2 = await rodarResumoDiario({ agora: HOJE })
  ok('C) o resumo reporta o grupo como já avisado', r2.precisaAgir.semMudanca >= 1, `${r2.precisaAgir.semMudanca} sem mudança`)
  ok('C) sem contar como novo', r2.precisaAgir.criados === 0 && r2.precisaAgir.atualizados === 0)

  // ══════════════════════════════════════════════════════════════════════════
  secao('D/E) VENCEU: o MESMO aviso passa a dizer "vencida" — não nasce outro')
  // ══════════════════════════════════════════════════════════════════════════
  await rodarResumoDiario({ agora: emSp('2026-08-16T10:00:00') })
  const venceu = await agir(famAmanha)
  ok('D) o vencimento atualiza o aviso no lugar: "1 vencida"',
    venceu.length === 1 && venceu[0].id === idAmanha && venceu[0].titulo === `${MARCA} FamAmanha — 1 vencida`, venceu[0]?.titulo ?? '—')

  // O TESTE QUE JUSTIFICA O AVISO NÃO EMPILHAR UM POR MANHÃ.
  for (const dia of ['2026-08-17', '2026-08-18', '2026-08-19', '2026-09-01']) {
    await rodarResumoDiario({ agora: emSp(`${dia}T10:00:00`) })
  }
  const dias = await agir(famAmanha)
  ok('E) quatro dias depois, continua UM aviso "1 vencida"',
    dias.length === 1 && dias[0].id === idAmanha && dias[0].titulo === `${MARCA} FamAmanha — 1 vencida`,
    'um prazo vencido é um fato, não um fato por manhã')
  ok('E) e a família inteira tem um único PRECISA_AGIR (lido ou não)',
    (await prisma.notificacaoOperacional.count({ where: { tipo: 'PRECISA_AGIR', processoId: famAmanha } })) === 1)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§13) O AVISO LEVA AO TRABALHO — deep-link canônico')
  // ══════════════════════════════════════════════════════════════════════════
  ok('§13) o link é a aba de acompanhamento da família na Operação',
    dias[0]?.link === `/operacao?processo=${famAmanha}&aba=acompanhamento`, dias[0]?.link ?? '—')
  ok('§13) nunca /kanban', !(dias[0]?.link ?? '').includes('/kanban'))

  // ══════════════════════════════════════════════════════════════════════════
  secao('F/§8) CONCLUÍDA E TERMINAIS FICAM DE FORA')
  // ══════════════════════════════════════════════════════════════════════════
  const famConcluida = await familia('FamConcluida')
  const concluida = await tarefa(famConcluida, emSp('2026-08-15T12:00:00'))
  await concluirTarefaSemWorkflow({ tarefaId: concluida, autorId: dani.id, resultado: 'pronto' })
  await rodarResumoDiario({ agora: HOJE })
  ok('F) tarefa concluída não entra no resumo', (await agir(famConcluida)).length === 0)
  await rodarResumoDiario({ agora: emSp('2026-09-01T10:00:00') })
  ok('F) nem como vencida depois do prazo', (await agir(famConcluida)).length === 0,
    'concluir congela o relógio — o alerta não sobrevive ao fato')

  // Concluir a única tarefa vencida tira o aviso que já estava aberto.
  const famConcluindo = await familia('FamConcluindo')
  const vencidaQueSeConclui = await tarefa(famConcluindo, emSp('2026-08-13T12:00:00'))
  await rodarResumoDiario({ agora: HOJE })
  ok('F) antes de concluir: "1 vencida"', (await agir(famConcluindo))[0]?.titulo === `${MARCA} FamConcluindo — 1 vencida`)
  await concluirTarefaSemWorkflow({ tarefaId: vencidaQueSeConclui, autorId: dani.id, resultado: 'pronto' })
  ok('F) concluir a única vencida faz o aviso sumir na hora', (await agir(famConcluindo)).length === 0)

  const famCancelada = await familia('FamCancelada')
  await tarefa(famCancelada, emSp('2026-08-15T12:00:00'), { statusTarefa: 'CANCELADA' })
  await rodarResumoDiario({ agora: emSp('2026-09-01T10:00:00') })
  ok('§8) estado terminal fica fora do resumo', (await agir(famCancelada)).length === 0)

  // ══════════════════════════════════════════════════════════════════════════
  secao('G/§9/§10) ESPERA E BLOQUEIO: o resumo LÊ o prazo efetivo')
  // ══════════════════════════════════════════════════════════════════════════
  // Ele não decide se o SLA pausa — quem decide é o workflow publicado, e a retomada já
  // empurra `dataPrazo`. Aqui se prova que respeita o que encontrar, sem conta própria.
  const famEspera = await familia('FamEspera')
  await tarefa(famEspera, emSp('2026-08-15T12:00:00'), { statusTarefa: 'AGUARDANDO_TERCEIRO' })
  await rodarResumoDiario({ agora: HOJE })
  ok('G) aguardando terceiro com prazo amanhã ainda entra no resumo',
    (await agir(famEspera))[0]?.titulo?.includes('1 vence amanhã') === true,
    'espera externa não apaga o compromisso; se a política pausa, o prazo já veio empurrado')

  const famPausada = await familia('FamPausada')
  await tarefa(famPausada, emSp('2026-08-25T12:00:00'), {
    statusTarefa: 'AGUARDANDO_TERCEIRO', slaPausadoEm: HOJE, slaPausaAcumuladaMin: 4320,
  })
  await rodarResumoDiario({ agora: HOJE })
  ok('G) e prazo empurrado pela pausa NÃO gera aviso antecipado', (await agir(famPausada)).length === 0,
    'o prazo efetivo é 25/08 — avisar hoje seria o resumo inventando conta própria')

  const famBloqueada = await familia('FamBloqueada')
  await tarefa(famBloqueada, emSp('2026-08-15T12:00:00'), { statusTarefa: 'BLOQUEADA' })
  await rodarResumoDiario({ agora: HOJE })
  ok('§10) bloqueada segue a mesma régua', (await agir(famBloqueada))[0]?.titulo?.includes('1 vence amanhã') === true)

  // ══════════════════════════════════════════════════════════════════════════
  secao('H/§12) TRANSFERÊNCIA: o aviso é de quem tem a tarefa AGORA')
  // ══════════════════════════════════════════════════════════════════════════
  const famTransf = await familia('FamTransf')
  const transferida = await tarefa(famTransf, emSp('2026-08-15T12:00:00'))
  await atribuirTarefa({ tarefaId: transferida, responsavelId: gabriel.id, autorId: gestor.id, motivo: 'redistribuição' })
  await rodarResumoDiario({ agora: HOJE })
  const agirTransf = await agir(famTransf)
  ok('H) o aviso vai para o responsável ATUAL',
    agirTransf.length === 1 && agirTransf[0].destinatarioId === gabriel.id, `destinatário ${agirTransf[0]?.destinatarioId}`)
  ok('§12) e não para o dono histórico', (await agir(famTransf, dani.id)).length === 0,
    'avisar quem já não tem a tarefa é avisar quem não pode fazer nada')
  ok('§12) o dono histórico recebe o MUDOU_DE_MAO, não um aviso de prazo',
    (await prisma.notificacaoOperacional.count({ where: { destinatarioId: dani.id, processoId: famTransf, tipo: 'MUDOU_DE_MAO', agrupado: true } })) === 1)

  // ══════════════════════════════════════════════════════════════════════════
  secao('I/§6) MUDAR O PRAZO RECOMPÕE O RESUMO — e não ressuscita o antigo')
  // ══════════════════════════════════════════════════════════════════════════
  const famRemarcada = await familia('FamRemarcada')
  const remarcada = await tarefa(famRemarcada, emSp('2026-08-15T12:00:00'))
  await rodarResumoDiario({ agora: HOJE })
  ok('I) avisou pelo prazo original', (await agir(famRemarcada))[0]?.titulo === `${MARCA} FamRemarcada — 1 vence amanhã`)

  await alterarPrazo({
    tarefaId: remarcada, autorId: gestor.id,
    novoPrazo: emSp('2026-08-20T12:00:00'), motivo: 'cartório pediu mais prazo',
  })
  // O dia seguinte ao prazo ANTIGO: se o resumo guardasse o prazo antigo, aqui nasceria
  // uma "vencida" de um prazo que já não existe.
  await rodarResumoDiario({ agora: emSp('2026-08-16T10:00:00') })
  ok('§6) o prazo antigo não vira "vencida" depois da remarcação',
    (await agir(famRemarcada)).length === 0,
    'seria contraditório: a tarefa não está atrasada, ela foi remarcada')

  await rodarResumoDiario({ agora: emSp('2026-08-19T10:00:00') })
  const avRemarcada = await agir(famRemarcada)
  ok('I) o prazo NOVO entra no resumo quando chega a véspera', avRemarcada.length === 1 && avRemarcada[0].titulo === `${MARCA} FamRemarcada — 1 vence amanhã`, avRemarcada[0]?.titulo ?? '—')
  ok('§5) e nunca sobra aviso "vencida" do prazo antigo',
    (await prisma.notificacaoOperacional.count({ where: { tipo: 'PRECISA_AGIR', processoId: famRemarcada, titulo: { contains: 'vencida' } } })) === 0)

  // ══════════════════════════════════════════════════════════════════════════
  secao('J/§16) CONCORRÊNCIA: três resumos ao mesmo tempo, um aviso')
  // ══════════════════════════════════════════════════════════════════════════
  const famDisputada = await familia('FamDisputada')
  await tarefa(famDisputada, emSp('2026-08-15T12:00:00'))
  await Promise.all([
    rodarResumoDiario({ agora: HOJE }),
    rodarResumoDiario({ agora: HOJE }),
    rodarResumoDiario({ agora: HOJE }),
  ])
  ok('J) três resumos simultâneos geram UM aviso', (await agir(famDisputada)).length === 1,
    'a garantia é do índice único parcial, não da leitura anterior')

  // ══════════════════════════════════════════════════════════════════════════
  secao('K/§11) SEM RESPONSÁVEL: nenhum destinatário é inventado')
  // ══════════════════════════════════════════════════════════════════════════
  const famOrfa = await familia('FamOrfa')
  const orfa = await tarefa(famOrfa, emSp('2026-08-15T12:00:00'), { responsavelId: null, dataAtribuicao: null })
  await rodarResumoDiario({ agora: HOJE })
  ok('K) tarefa sem responsável não gera PRECISA_AGIR para ninguém',
    (await prisma.notificacaoOperacional.count({ where: { processoId: famOrfa, tipo: 'PRECISA_AGIR' } })) === 0)
  const depoisDeUmDia = new Date(Date.now() + 2 * 86_400_000)
  const lista = (await precisaDeVoce({ agora: depoisDeUmDia })).filter((i) => i.processoId === famOrfa)
  ok('K) e o caso não se esconde: vira SEM_RESPONSAVEL na lista do gestor',
    lista.length === 1 && lista[0].tipo === 'SEM_RESPONSAVEL' && lista[0].tarefaIds.includes(orfa), `${lista.length} item(ns)`)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§20) O ENSAIO CONTA SEM ENVIAR')
  // ══════════════════════════════════════════════════════════════════════════
  const famEnsaio = await familia('FamEnsaio')
  const novaParaEnsaio = await tarefa(famEnsaio, emSp('2026-08-15T12:00:00'))
  const antes = await prisma.notificacaoOperacional.count()
  const ensaio = await avaliarPrecisaAgir({ agora: HOJE, modo: 'FOTO', ensaio: true })
  const ensaioDiario = await rodarResumoDiario({ agora: HOJE, ensaio: true })
  const ensaioHorario = await rodarVarreduraHoraria({ agora: HOJE, ensaio: true })
  const depois = await prisma.notificacaoOperacional.count()
  ok('§20) o ensaio não escreve nada (nem no resumo, nem na varredura)', antes === depois, `${antes} → ${depois}`)
  ok('§20) sinaliza que foi ensaio', ensaio.ensaio === true && ensaioDiario.precisaAgir.ensaio === true && ensaioHorario.precisaAgir.ensaio === true)
  const previaEnsaio = ensaio.previa.find((p) => p.processoId === famEnsaio)
  ok('§20) mas diz o que criaria', previaEnsaio?.acao === 'CRIADO' && previaEnsaio.amanha === 1,
    `${ensaio.previa.length} grupo(s) previsto(s)`)
  ok('§20) com família, destinatário e as partes do resumo',
    ensaio.previa.every((p) => p.destinatarioId > 0 && typeof p.vencidas === 'number' && typeof p.hoje === 'number'
      && typeof p.amanha === 'number' && typeof p.cobrancas === 'number'))
  ok('§20) e trata como já avisado o que já foi (não "CRIADO")',
    ensaio.previa.filter((p) => p.processoId === famAmanha || p.processoId === famHoje).every((p) => p.acao !== 'CRIADO'))
  ok('§20) nenhum aviso da família do ensaio existe de verdade', (await agir(famEnsaio)).length === 0)
  void novaParaEnsaio

  // ══════════════════════════════════════════════════════════════════════════
  secao('§1/§21) O RESUMO NÃO ESCREVE NADA ALÉM DE NOTIFICAÇÃO')
  // ══════════════════════════════════════════════════════════════════════════
  const fonte = semComentarios(ler('lib/operacional/avisos-sino.ts'))
  ok('§1) ele não atualiza tarefa', !/tarefa\.update|tarefa\.updateMany/.test(fonte))
  ok('§1) não mexe em passo nem workflow',
    !/phaseWorkflowStepInstance|transicionarPasso|workflowInstance\./.test(fonte))
  ok('§1) e não chama comando de tarefa',
    !/iniciarTarefa\(|atribuirTarefa\(|concluirTarefa|bloquearTarefa|alterarPrazo\(/.test(fonte))
  ok('§15) o tempo vem da régua canônica (estadoTemporal + diaOperacional)',
    /estadoTemporal\(/.test(fonte) && /diaOperacional\(/.test(fonte) && /from '\.\/tempo-operacional'/.test(fonte))
  ok('§2) só existem os tipos permitidos (nenhum marco inventado)',
    !/PROGRESSO|STEP_MUDOU|LEMBRETE|'PRAZO'|'HOJE'|'ATRASO'/.test(fonte))
  const comandos = semComentarios(ler('lib/operacional/tarefa-comandos.ts'))
  ok('§14) o varredor por tarefa foi removido (nada de um aviso por marco)',
    !/avisarPrazosEAtrasos|marcoDoPrazo|avisarAcontecimentosOperacionais|avisarAtencaoConsolidada/.test(comandos))

  const rotaHoraria = semComentarios(ler('src/app/api/cron/avisos-prazo/route.ts'))
  ok('§14) a rota horária tem chamador real: rodarVarreduraHoraria', /rodarVarreduraHoraria\(/.test(rotaHoraria))
  ok('§14) e só chama a varredura', !/\bprisma\s*\.\s*\w+\s*\.\s*(create|update|delete)/.test(rotaHoraria))
  ok('§14) protegida como os outros crons', /x-vercel-cron/.test(rotaHoraria) && /CRON_SECRET/.test(rotaHoraria))
  const rotaDiaria = semComentarios(ler('src/app/api/cron/resumo-diario/route.ts'))
  ok('§14) a rota do resumo diário chama rodarResumoDiario', /rodarResumoDiario\(/.test(rotaDiaria))
  ok('§14) e só chama o resumo', !/\bprisma\s*\.\s*\w+\s*\.\s*(create|update|delete)/.test(rotaDiaria))
  ok('§14) protegida como os outros crons', /x-vercel-cron/.test(rotaDiaria) && /CRON_SECRET/.test(rotaDiaria))
  ok('§14) as duas rotas aceitam ensaio (?ensaio=1)', /ensaio/.test(rotaHoraria) && /ensaio/.test(rotaDiaria))
  const cron = JSON.parse(ler('vercel.json')) as { crons: Array<{ path: string; schedule: string }> }
  const horario = cron.crons.find((c) => c.path === '/api/cron/avisos-prazo')
  ok('§14) varredura agendada de hora em hora', horario?.schedule === '0 * * * *', horario?.schedule ?? 'ausente')
  const diario = cron.crons.find((c) => c.path === '/api/cron/resumo-diario')
  ok('§14) resumo diário agendado às 07:00 de São Paulo (10:00 UTC, sem horário de verão)',
    diario?.schedule === '0 10 * * *', diario?.schedule ?? 'ausente')

  await limpar()
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhou === 0
    ? 'Um resumo por pessoa e família — e o sino continua significando alguma coisa.'
    : 'O resumo do dia voltou a fazer barulho.')
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

void main()
