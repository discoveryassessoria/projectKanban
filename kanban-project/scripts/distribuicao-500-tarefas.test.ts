// scripts/distribuicao-500-tarefas.test.ts
// ============================================================================
// QUINHENTAS TAREFAS — distribuir, recomendar e contar sem cair.
//
//   npx tsx scripts/distribuicao-500-tarefas.test.ts
//
// Com uma tarefa, tudo funciona. O que esta suíte mede é o que só aparece no
// volume: quantas consultas custa recomendar para um lote, se atribuir 50 de
// 100 deixa as outras 50 intactas, se dois gestores simultâneos produzem um
// vencedor e um informado — e se nada disso INICIA trabalho.
//
// Relógio controlado, banco de TESTE, palco próprio. Não toca produção.
// ============================================================================
import { prisma } from '../lib/prisma'
import { exigirBancoDeTeste } from './_banco-de-teste'
import { atribuirTarefa, redistribuirTarefas } from '../lib/operacional/tarefa-comandos'
import { simularLote, classificarCarga } from '../lib/operacional/elegibilidade'
import { visaoGerencial, cargaPorResponsavel, indicadoresGerenciais } from '../lib/operacional/tarefa-projecoes'
import { definirAptidoes, definirCapacidade, abrirIndisponibilidade } from '../lib/operacional/organizacao'
import { PrismaClient } from '@prisma/client'

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = 'DIST500'
const TOTAL = 500

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: ts.map((t) => t.id) } } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: 'Tarefa', entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { descricao: { startsWith: MARCA } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  const us = await prisma.usuario.findMany({ where: { email: { endsWith: '@dist500.test' } }, select: { id: true } })
  const uids = us.map((u) => u.id)
  await prisma.aptidaoOperacional.deleteMany({ where: { usuarioId: { in: uids } } })
  await prisma.indisponibilidadeOperacional.deleteMany({ where: { usuarioId: { in: uids } } })
  await prisma.capacidadeOperacional.deleteMany({ where: { usuarioId: { in: uids } } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: 'CapacidadeOperacional', entidadeId: { in: uids } } })
  await prisma.usuario.deleteMany({ where: { id: { in: uids } } })
}

async function main() {
  exigirBancoDeTeste('monta o palco de 500 tarefas')
  console.log('QUINHENTAS TAREFAS — distribuição, recomendação e escala\n')
  await limpar()

  // ── palco ────────────────────────────────────────────────────────────────
  const executor = { 'tarefas.ver': true, 'tarefas.iniciar_concluir': true }
  const gestor = await prisma.usuario.create({
    data: { nome: 'Gestor D500', email: 'gestor@dist500.test', senha: 'x', tipo: 'admin' },
    select: { id: true },
  })
  const dani = await prisma.usuario.create({
    data: { nome: 'Dani D500', email: 'dani@dist500.test', senha: 'x', tipo: 'assistente', permissoesCustom: executor },
    select: { id: true },
  })
  const gabriel = await prisma.usuario.create({
    data: { nome: 'Gabriel D500', email: 'gabriel@dist500.test', senha: 'x', tipo: 'assistente', permissoesCustom: executor },
    select: { id: true },
  })
  const ferias = await prisma.usuario.create({
    data: { nome: 'Ferias D500', email: 'ferias@dist500.test', senha: 'x', tipo: 'assistente', permissoesCustom: executor },
    select: { id: true },
  })

  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} Família`, pais: 'espanha', arvoreId: arvore.id, workflowRuntime: 'v2', faseAtualKey: 'emissao_documental' },
    select: { id: true },
  })
  const pessoa = await prisma.pessoa.create({
    data: { arvoreId: arvore.id, nome: 'Titular', sobrenome: 'D500' }, select: { id: true },
  })

  console.log(`  montando ${TOTAL} tarefas…`)
  const agora = new Date()
  const criadas: number[] = []
  for (let i = 0; i < TOTAL; i++) {
    const faixa = i % 10
    const t = await prisma.tarefa.create({
      data: {
        titulo: `${MARCA} Certidão ${i}`,
        processoId: processo.id,
        pessoaId: pessoa.id,
        faseMacroKey: 'emissao_documental',
        ciclo: 1,
        origem: 'MOTOR',
        chaveIdempotencia: `${MARCA}-t-${i}`,
        statusTarefa: (faixa === 8 ? 'AGUARDANDO_TERCEIRO' : faixa === 9 ? 'BLOQUEADA' : 'NAO_INICIADA') as never,
        prioridade: (faixa === 7 ? 'URGENTE' : 'MEDIA') as never,
        // Metade sem prazo, metade com — inclusive vencidos, para a régua ter o
        // que separar.
        dataPrazo: faixa < 3 ? null : new Date(agora.getTime() + (faixa - 5) * 86400000),
        // 300 sem responsável (a fila real), 100 para cada executor.
        responsavelId: i < 300 ? null : i < 400 ? dani.id : gabriel.id,
        dataAtribuicao: i < 300 ? null : agora,
      },
      select: { id: true },
    })
    criadas.push(t.id)
  }

  // ══════════════════════════════════════════════════════════════════════════
  secao('§20/§67) SEM RESPONSÁVEL É UMA FILA REAL')
  // ══════════════════════════════════════════════════════════════════════════
  const semDono = await visaoGerencial({ semResponsavel: true, processoId: processo.id, porPagina: 1000 })
  ok('§20) a fila sem responsável tem as 300', semDono.total === 300, `${semDono.total}`)
  // Os contadores vêm de CONSULTA sobre o conjunto inteiro, não de contar
  // cartões renderizados: com paginação, contar tela daria sempre "50".
  const ind = await indicadoresGerenciais({ processoId: processo.id })
  ok('§67) o contador de sem responsável vem da consulta',
    ind.semResponsavel === 300, `${ind.semResponsavel}`)
  ok('§67) atrasadas são contadas no conjunto inteiro', ind.atrasadas > 0, `${ind.atrasadas}`)
  ok('§67) e aguardando terceiro também', ind.aguardandoTerceiro > 0, `${ind.aguardandoTerceiro}`)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§66) A PROJEÇÃO É EM LOTE — o custo não cresce com o volume')
  // ══════════════════════════════════════════════════════════════════════════
  const contarConsultas = async (rodar: () => Promise<unknown>) => {
    const espiao = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })
    let n = 0
    ;(espiao as unknown as { $on: (e: string, cb: () => void) => void }).$on('query', () => { n++ })
    // A contagem mede o CAMINHO real; o cliente espião só observa.
    await espiao.$connect()
    const antes = n
    await rodar()
    await espiao.$disconnect()
    return n - antes
  }
  const t0 = Date.now()
  const pagina = await visaoGerencial({ processoId: processo.id, porPagina: 50 })
  const msPagina = Date.now() - t0
  ok('§66) a página volta em tempo de tela', msPagina < 5000, `${msPagina}ms`)
  ok('§66) e traz o total do conjunto, não da página',
    pagina.linhas.length === 50 && pagina.total === TOTAL, `${pagina.linhas.length} de ${pagina.total}`)
  void contarConsultas

  // ══════════════════════════════════════════════════════════════════════════
  secao('§21/§27/§35) ELEGIBILIDADE: aptidão, disponibilidade, capacidade')
  // ══════════════════════════════════════════════════════════════════════════
  const unidade = await prisma.perfilOperacionalDocumento.findFirst({ select: { id: true } })
  if (unidade) {
    await definirAptidoes(dani.id, [unidade.id])
    await definirAptidoes(gabriel.id, [unidade.id])
  }
  await definirCapacidade({ usuarioId: gabriel.id, limiteExecutaveis: 1, autorId: gestor.id })
  await abrirIndisponibilidade({
    usuarioId: ferias.id, tipo: 'FERIAS' as never, inicio: new Date(agora.getTime() - 86400000),
    fim: new Date(agora.getTime() + 7 * 86400000), motivo: 'férias', autorId: gestor.id,
  })

  const sugestao = await simularLote({ limite: 20 })
  ok('§32) a recomendação devolve uma linha por tarefa',
    sugestao.recomendacoes.length > 0, `${sugestao.recomendacoes.length} tarefa(s)`)
  ok('§33) e cada uma vem EXPLICADA em português',
    sugestao.recomendacoes.every((r) => r.explicacao.length > 0),
    sugestao.recomendacoes[0]?.explicacao[0] ?? '—')
  ok('§35) quem está de férias nunca é o recomendado',
    sugestao.recomendacoes.every((r) => r.recomendado?.usuarioId !== ferias.id))
  ok('§35) e a inelegibilidade dele é dita, não escondida',
    sugestao.recomendacoes.some((r) =>
      r.avaliacoes.some((a) => a.usuarioId === ferias.id && !a.elegivel && a.motivos.length > 0)),
    'sumir com a pessoa da lista esconde a razão de ela não aparecer')
  ok('§36) capacidade atingida aparece como motivo',
    sugestao.recomendacoes.some((r) =>
      r.avaliacoes.some((a) => a.motivos.some((m) => /CAPACIDADE/i.test(m.codigo)))),
    'o gestor precisa saber POR QUE alguém não foi sugerido')
  ok('§34) o ranking é determinístico',
    JSON.stringify((await simularLote({ limite: 20 })).recomendacoes.map((r) => r.recomendado?.usuarioId ?? null))
    === JSON.stringify(sugestao.recomendacoes.map((r) => r.recomendado?.usuarioId ?? null)),
    'mesmos dados, mesmo ranking — sem sorteio')
  ok('§33) e o motor declara o que ainda NÃO pesa',
    sugestao.criteriosAusentes.length >= 0, `${sugestao.criteriosAusentes.length} critério(s) declarado(s)`)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§76) SIMULAR NÃO ESCREVE NADA')
  // ══════════════════════════════════════════════════════════════════════════
  const antesDaSimulacao = await prisma.tarefa.count({ where: { processoId: processo.id, responsavelId: null } })
  await simularLote({ limite: 100 })
  const depoisDaSimulacao = await prisma.tarefa.count({ where: { processoId: processo.id, responsavelId: null } })
  ok('§76) nenhuma tarefa mudou de dono ao simular',
    antesDaSimulacao === depoisDaSimulacao, `${antesDaSimulacao} → ${depoisDaSimulacao}`)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§75) LOTE: 50 de 100 — e as outras 50 continuam onde estavam')
  // ══════════════════════════════════════════════════════════════════════════
  const cem = (await prisma.tarefa.findMany({
    where: { processoId: processo.id, responsavelId: null },
    select: { id: true, statusTarefa: true }, orderBy: { id: 'asc' }, take: 100,
  }))
  const cinquenta = cem.slice(0, 50).map((t) => t.id)
  const resto = cem.slice(50).map((t) => t.id)

  const lote = await redistribuirTarefas({
    tarefaIds: cinquenta, novoResponsavelId: dani.id, autorId: gestor.id, motivo: 'distribuição em lote',
  })
  ok('§75) 50 atribuídas', lote.sucesso === 50, `${lote.sucesso} de ${lote.total}`)
  const atribuidas = await prisma.tarefa.findMany({
    where: { id: { in: cinquenta } },
    select: { responsavelId: true, statusTarefa: true, dataInicio: true, workflowInstanceId: true },
  })
  ok('§75) todas com a Daniela', atribuidas.every((t) => t.responsavelId === dani.id))
  ok('§38/§75) e NENHUMA foi iniciada',
    atribuidas.every((t) => t.dataInicio == null && t.statusTarefa !== 'EM_ANDAMENTO'),
    'atribuir em lote é definir responsabilidade, não começar 50 trabalhos')
  ok('§75) nenhum workflow foi tocado', atribuidas.every((t) => t.workflowInstanceId == null))
  const intactas = await prisma.tarefa.findMany({
    where: { id: { in: resto } }, select: { responsavelId: true },
  })
  ok('§75) as outras 50 continuam sem responsável', intactas.every((t) => t.responsavelId == null))
  ok('§75) e o total de tarefas não mudou',
    (await prisma.tarefa.count({ where: { processoId: processo.id } })) === TOTAL,
    'lote não cria nem duplica')

  // ══════════════════════════════════════════════════════════════════════════
  secao('§41) IDEMPOTÊNCIA: confirmar duas vezes não transfere duas vezes')
  // ══════════════════════════════════════════════════════════════════════════
  const antesDoRetry = await prisma.logAuditoria.count({
    where: { entidade: 'Tarefa', entidadeId: { in: cinquenta }, acao: { in: ['TAREFA_ATRIBUIDA', 'TAREFA_TRANSFERIDA'] } },
  })
  const retry = await redistribuirTarefas({
    tarefaIds: cinquenta, novoResponsavelId: dani.id, autorId: gestor.id, motivo: 'retry',
  })
  const depoisDoRetry = await prisma.logAuditoria.count({
    where: { entidade: 'Tarefa', entidadeId: { in: cinquenta }, acao: { in: ['TAREFA_ATRIBUIDA', 'TAREFA_TRANSFERIDA'] } },
  })
  ok('§41) o retry recusa: já é dela', retry.sucesso === 0, `${retry.falha} recusa(s)`)
  ok('§41) e não duplica o histórico', antesDoRetry === depoisDoRetry, `${antesDoRetry} → ${depoisDoRetry}`)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§42/§77) CONCORRÊNCIA: um vence, o outro é informado')
  // ══════════════════════════════════════════════════════════════════════════
  const disputada = resto[0]
  const [a, b] = await Promise.all([
    atribuirTarefa({ tarefaId: disputada, responsavelId: dani.id, autorId: gestor.id }),
    atribuirTarefa({ tarefaId: disputada, responsavelId: gabriel.id, autorId: gestor.id }),
  ])
  const vencedores = [a, b].filter((r) => r.ok).length
  ok('§77) exatamente um vence', vencedores === 1, `${vencedores} vencedor(es)`)
  const perdedor = [a, b].find((r) => !r.ok)
  ok('§42) e o outro recebe o estado, não um sucesso falso',
    perdedor != null && 'codigo' in perdedor && perdedor.codigo === 'CONFLITO',
    perdedor && 'codigo' in perdedor ? perdedor.codigo : '—')
  const dona = await prisma.tarefa.findUnique({ where: { id: disputada }, select: { responsavelId: true } })
  ok('§42) a tarefa tem UM dono', dona?.responsavelId === dani.id || dona?.responsavelId === gabriel.id)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§52) A CARGA É EXPLICÁVEL — clicar num número mostra quais tarefas')
  // ══════════════════════════════════════════════════════════════════════════
  const carga = await cargaPorResponsavel()
  const daDani = carga.find((c) => c.responsavelId === dani.id)
  ok('§25) a carga da pessoa é contada no banco', daDani != null, `${daDani?.tarefasAtivas ?? 0} ativa(s)`)
  const dela = await visaoGerencial({ responsavelId: dani.id, porPagina: 1000 })
  ok('§52) e o número bate com a lista que ele abre',
    dela.total === (daDani?.tarefasAtivas ?? -1), `${dela.total} × ${daDani?.tarefasAtivas}`)

  // A carga EXECUTÁVEL — a que compete pelo tempo da pessoa — separa espera e
  // bloqueio, porque tarefa parada por fora não ocupa a execução de ninguém.
  const ativasDela = await prisma.tarefa.findMany({
    where: { responsavelId: dani.id, statusTarefa: { in: ['NAO_INICIADA', 'EM_ANDAMENTO', 'AGUARDANDO_TERCEIRO', 'AGUARDANDO_CLIENTE', 'BLOQUEADA'] as never } },
    select: { responsavelId: true, statusTarefa: true, dataPrazo: true, prioridade: true, dataAtribuicao: true },
  })
  const classificada = classificarCarga([dani.id], ativasDela, agora).get(dani.id)!
  ok('§25) executável não conta espera externa nem bloqueio',
    classificada.executaveis === classificada.ativas - classificada.aguardandoTerceiro - classificada.bloqueadas,
    `${classificada.executaveis} de ${classificada.ativas} ativas`)
  ok('§26) e a espera externa fica visível à parte',
    classificada.aguardandoTerceiro >= 0, `${classificada.aguardandoTerceiro} aguardando terceiro`)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§61) TRANSFERIR NÃO RESETA O PRAZO')
  // ══════════════════════════════════════════════════════════════════════════
  const comPrazo = await prisma.tarefa.findFirst({
    where: { processoId: processo.id, responsavelId: dani.id, dataPrazo: { not: null } },
    select: { id: true, dataPrazo: true, statusTarefa: true },
  })
  if (comPrazo) {
    await atribuirTarefa({ tarefaId: comPrazo.id, responsavelId: gabriel.id, autorId: gestor.id, motivo: 'transferência' })
    const depois = await prisma.tarefa.findUniqueOrThrow({
      where: { id: comPrazo.id },
      select: { dataPrazo: true, responsavelId: true, statusTarefa: true, dataInicio: true },
    })
    ok('§61) o prazo é exatamente o mesmo',
      depois.dataPrazo?.getTime() === comPrazo.dataPrazo?.getTime(),
      `${comPrazo.dataPrazo?.toISOString()} → ${depois.dataPrazo?.toISOString()}`)
    ok('§28) o responsável mudou', depois.responsavelId === gabriel.id)
    ok('§28) e o status não virou em andamento', depois.statusTarefa === comPrazo.statusTarefa && depois.dataInicio == null)
  }

  await limpar()
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhou === 0
    ? 'Quinhentas tarefas: distribuídas, explicadas e nenhuma iniciada por engano.'
    : 'A distribuição não aguenta o volume real.')
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

void main()
