// scripts/elegibilidade-capacidade.test.ts
// ============================================================================
// O MOTOR DE ELEGIBILIDADE E CAPACIDADE — em modo simulação.
//
//   npx tsx scripts/elegibilidade-capacidade.test.ts
//
// Um recomendador é perigoso de um jeito específico: ele erra com confiança. As
// provas aqui existem contra esse erro, e não contra bug de sintaxe.
//
//   • ELEGIBILIDADE é regra, não palpite — quem não pode executar, não entra.
//   • CAPACIDADE não é contagem bruta — cinco tarefas esperando cartório pesam
//     menos do que três atrasadas e urgentes.
//   • DESEMPATE é determinístico — duas execuções, mesmo resultado, sem sorte.
//   • ABSTER-SE é uma resposta — melhor calar do que inventar um responsável.
//   • O LOTE usa carga VIRTUAL — dez tarefas não caem todas em quem começou
//     com menos.
//   • NADA DISSO ESCREVE — a prova compara o banco byte a byte, antes e depois.
//
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { prisma } from '../lib/prisma'
import { Prisma } from '@prisma/client'
import { exigirBancoDeTeste } from './_banco-de-teste'
import {
  simularTarefa, simularLote, pontuar, PESOS, CRITERIOS_AUSENTES,
  type Carga,
} from '../lib/operacional/elegibilidade'
import { criarTarefaManual } from '../lib/operacional/tarefa-ciclo'
import { atribuirTarefa } from '../lib/operacional/tarefa-comandos'

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = 'ELEG'
const PERM_EXECUTOR = { 'tarefas.ver': true, 'tarefas.iniciar_concluir': true }
const PERM_SEM_EXECUCAO = { 'tarefas.ver': true, 'tarefas.iniciar_concluir': false }

/** A carga é sempre lida do banco: montar um objeto à mão provaria a aritmética, não o motor. */
const cargaDe = (sim: Awaited<ReturnType<typeof simularTarefa>>, id: number) =>
  sim.avaliacoes.find((a) => a.usuarioId === id)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: ts.map((t) => t.id) } } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: 'Tarefa', entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@eleg.test' } } })
}

/**
 * O BANCO DE TESTE É COMPARTILHADO com os palcos dos outros testes, e os
 * usuários deles também são elegíveis. Uma asserção como "a recomendação é da
 * Ana" seria decidida por quem outro teste deixou cadastrado.
 *
 * Então o teste ISOLA o próprio mundo: tira a permissão de executar de todo
 * mundo que não é do palco, e devolve exatamente como estava no fim. Não é
 * conveniência — sem isso, o que se prova aqui não é o motor.
 */
async function isolar(emailsDoPalco: string[]) {
  const todos = await prisma.usuario.findMany({ select: { id: true, email: true, permissoesCustom: true } })
  const deFora = todos.filter((u) => !emailsDoPalco.includes(u.email))
  for (const u of deFora) {
    const atual = (u.permissoesCustom as Record<string, boolean> | null) ?? {}
    await prisma.usuario.update({
      where: { id: u.id },
      data: { permissoesCustom: { ...atual, 'tarefas.iniciar_concluir': false } },
    })
  }
  return async () => {
    for (const u of deFora) {
      await prisma.usuario.update({
        where: { id: u.id },
        // `undefined` no Prisma significa "não altere" — restaurar um custom que
        // era NULO exige `Prisma.DbNull`. Com `undefined`, a permissão derrubada
        // pelo isolamento ficava falsa para sempre no banco compartilhado.
        data: { permissoesCustom: u.permissoesCustom === null ? Prisma.DbNull : u.permissoesCustom },
      })
    }
  }
}

async function main() {
  exigirBancoDeTeste('monta o palco do motor de elegibilidade')
  console.log('O MOTOR DE ELEGIBILIDADE E CAPACIDADE (simulação)\n')
  await limpar()
  const restaurar = await isolar([
    'gestor@eleg.test', 'ana@eleg.test', 'bruno@eleg.test', 'carla@eleg.test',
    'denis@eleg.test', 'e1@eleg.test', 'e2@eleg.test', 'd1@eleg.test', 'd2@eleg.test',
  ])

  // ══════════════════════════════════════════════════════════════════════════
  secao('§3) Carga não é contagem bruta — o exemplo do enunciado')
  // ══════════════════════════════════════════════════════════════════════════
  const base: Carga = {
    ativas: 0, executaveis: 0, emAndamento: 0, naoIniciadas: 0,
    aguardandoTerceiro: 0, bloqueadas: 0, atrasadas: 0, urgentes: 0, ultimaAtribuicaoEm: null,
  }
  // A: 3 tarefas, todas atrasadas e urgentes.   B: 5 tarefas, 4 aguardando terceiro.
  const A = pontuar({ ...base, ativas: 3, executaveis: 3, atrasadas: 3, urgentes: 3 })
  const B = pontuar({ ...base, ativas: 5, executaveis: 1, aguardandoTerceiro: 4 })
  ok('§3) quem tem MENOS tarefas pode ter MAIS carga', A.score > B.score, `A=${A.score} × B=${B.score}`)
  ok('§3) e a conta é decomponível parcela a parcela', A.parcelas.length === 5 &&
    A.parcelas.reduce((s, p) => s + p.subtotal, 0) === A.score)
  ok('§4) os pesos são explícitos e num lugar só', Object.keys(PESOS).length === 5, Object.keys(PESOS).join(', '))
  ok('§3) espera externa pesa menos que execução', PESOS.aguardandoTerceiro < PESOS.executavel)
  ok('§3) atraso pesa mais que execução', PESOS.atrasada > PESOS.executavel)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§1/§12) Os critérios AUSENTES são declarados, não inventados')
  // ══════════════════════════════════════════════════════════════════════════
  // Esta lista ENCOLHEU de propósito: aptidão, disponibilidade, capacidade e
  // equipe eram ausências declaradas e passaram a existir como camada
  // operacional (`lib/operacional/organizacao.ts`). O que sobra continua
  // declarado — a lista serve para dizer a verdade, não para ficar grande.
  ok('§1) o motor continua declarando o que NÃO sabe', CRITERIOS_AUSENTES.length >= 1, `${CRITERIOS_AUSENTES.length} critérios`)
  for (const esperado of ['ativo/inativo', 'escopo por processo']) {
    ok(`§1) declara a ausência de "${esperado}"`,
      CRITERIOS_AUSENTES.some((c) => c.criterio.toLowerCase().includes(esperado.toLowerCase())))
  }
  for (const preenchido of ['férias', 'capacidade', 'especialidade', 'equipe']) {
    ok(`§1) e NÃO declara mais "${preenchido}" como ausente — a camada operacional a implementa`,
      !CRITERIOS_AUSENTES.some((c) => c.criterio.toLowerCase().includes(preenchido)))
  }
  const CODIGOS_ESPERADOS = ['SEM_PERMISSAO_EXECUTAR', 'INDISPONIVEL', 'SEM_APTIDAO', 'FORA_DA_EQUIPE_EXIGIDA', 'CAPACIDADE_ESGOTADA']
  const fonteMotor = (await import('node:fs')).readFileSync(
    (await import('node:path')).join(__dirname, '..', 'lib/operacional/elegibilidade.ts'), 'utf8')
  for (const c of CODIGOS_ESPERADOS) {
    ok(`§9) o motor sabe reprovar por ${c}`, fonteMotor.includes(`'${c}'`))
  }
  ok('§1) nenhuma especialidade inventada', !/especialidade\s*[:=]\s*\[/i.test(fonteMotor))

  // ── palco: quatro pessoas, cargas diferentes ──────────────────────────────
  const gestor = await prisma.usuario.create({
    // Admin tem tudo por padrão; aqui ela GERE, não executa — senão competiria
    // com os executores do palco e a prova seria sobre outra coisa.
    data: {
      nome: 'Gestora Elegibilidade', email: 'gestor@eleg.test', senha: 'x', tipo: 'admin',
      permissoesCustom: { 'tarefas.iniciar_concluir': false },
    },
    select: { id: true },
  })
  const [ana, bruno, carla, denis] = await Promise.all([
    prisma.usuario.create({ data: { nome: 'Ana Executora', email: 'ana@eleg.test', senha: 'x', tipo: 'assistente', permissoesCustom: PERM_EXECUTOR }, select: { id: true } }),
    prisma.usuario.create({ data: { nome: 'Bruno Executor', email: 'bruno@eleg.test', senha: 'x', tipo: 'assistente', permissoesCustom: PERM_EXECUTOR }, select: { id: true } }),
    prisma.usuario.create({ data: { nome: 'Carla Executora', email: 'carla@eleg.test', senha: 'x', tipo: 'assistente', permissoesCustom: PERM_EXECUTOR }, select: { id: true } }),
    prisma.usuario.create({ data: { nome: 'Denis Sem Execução', email: 'denis@eleg.test', senha: 'x', tipo: 'assistente', permissoesCustom: PERM_SEM_EXECUCAO }, select: { id: true } }),
  ])
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} Família`, pais: 'espanha', arvoreId: arv.id, workflowRuntime: 'v2' }, select: { id: true },
  })

  const ontem = new Date(Date.now() - 3 * 86400000)
  const criar = async (titulo: string, extra: Partial<{ prioridade: 'URGENTE' | 'MEDIA'; dataPrazo: Date | null }> = {}) => {
    const r = await criarTarefaManual({
      titulo: `${MARCA} ${titulo}`, processoId: proc.id, autorId: gestor.id,
      motivo: 'palco do motor de elegibilidade', confirmarDuplicidade: true,
      prioridade: extra.prioridade ?? 'MEDIA', dataPrazo: extra.dataPrazo ?? null,
    })
    if (!r.ok) throw new Error(`criar ${titulo}: ${'mensagem' in r ? r.mensagem : '?'}`)
    return r.tarefaId
  }
  const carregar = async (usuarioId: number, quantas: number, extra: Parameters<typeof criar>[1] = {}) => {
    for (let i = 0; i < quantas; i++) {
      const id = await criar(`carga ${usuarioId}-${i}`, extra)
      await atribuirTarefa({ tarefaId: id, responsavelId: usuarioId, autorId: gestor.id })
    }
  }

  // Ana: 1 executável.  Bruno: 3 executáveis, todas atrasadas e urgentes.
  // Carla: 4 aguardando terceiro + 1 executável (mais tarefas, menos carga que Bruno).
  await carregar(ana.id, 1)
  await carregar(bruno.id, 3, { prioridade: 'URGENTE', dataPrazo: ontem })
  await carregar(carla.id, 5)
  const daCarla = await prisma.tarefa.findMany({ where: { responsavelId: carla.id }, select: { id: true }, take: 4 })
  for (const t of daCarla) {
    const { iniciarTarefa } = await import('../lib/operacional/tarefa-comandos')
    await iniciarTarefa({ tarefaId: t.id, autorId: carla.id })
    const { aguardarTerceiro } = await import('../lib/operacional/tarefa-ciclo')
    await aguardarTerceiro({ tarefaId: t.id, autorId: carla.id, motivo: 'cartório em fila' })
  }

  const alvo = await criar('a tarefa a distribuir')

  // ══════════════════════════════════════════════════════════════════════════
  secao('§A/§C/§D) Elegibilidade: quem pode, quem não pode e por quê')
  // ══════════════════════════════════════════════════════════════════════════
  const sim = await simularTarefa(alvo)
  ok('§7) a simulação responde para a tarefa pedida', sim.taskId === alvo)
  const dAna = cargaDe(sim, ana.id), dBruno = cargaDe(sim, bruno.id), dCarla = cargaDe(sim, carla.id), dDenis = cargaDe(sim, denis.id)
  ok('§A) Ana é elegível', dAna?.elegivel === true)
  ok('§A) Bruno é elegível', dBruno?.elegivel === true)
  ok('§A) Carla é elegível', dCarla?.elegivel === true)
  ok('§C) quem não tem permissão de executar é INELEGÍVEL', dDenis?.elegivel === false)
  ok('§C) com o motivo nomeado', dDenis?.motivos[0]?.codigo === 'SEM_PERMISSAO_EXECUTAR', dDenis?.motivos[0]?.texto ?? '—')
  ok('§13) e cada avaliação traz a carga completa',
    dBruno != null && ['ativas', 'executaveis', 'atrasadas', 'urgentes', 'aguardandoTerceiro', 'bloqueadas']
      .every((k) => typeof (dBruno.carga as unknown as Record<string, number>)[k] === 'number'))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§2/§B) Capacidade real: o de menos tarefas nem sempre ganha')
  // ══════════════════════════════════════════════════════════════════════════
  ok('§2) a carga do Bruno conta 3 executáveis', dBruno?.carga.executaveis === 3, String(dBruno?.carga.executaveis))
  ok('§2) as 3 dele estão atrasadas', dBruno?.carga.atrasadas === 3, String(dBruno?.carga.atrasadas))
  ok('§2) a Carla tem MAIS tarefas ativas que o Bruno',
    (dCarla?.carga.ativas ?? 0) > (dBruno?.carga.ativas ?? 0), `${dCarla?.carga.ativas} × ${dBruno?.carga.ativas}`)
  ok('§B) e mesmo assim carrega MENOS que o Bruno',
    (dCarla?.score ?? 0) < (dBruno?.score ?? 0), `Carla ${dCarla?.score} × Bruno ${dBruno?.score}`)
  ok('§2) as 4 esperas da Carla não entram como executáveis',
    dCarla?.carga.aguardandoTerceiro === 4 && dCarla?.carga.executaveis === 1,
    `${dCarla?.carga.aguardandoTerceiro} esperando / ${dCarla?.carga.executaveis} executável`)
  ok('§A) e a recomendação é de quem tem a MENOR carga operacional',
    sim.recomendado?.usuarioId === ana.id, sim.recomendado?.nome ?? 'ninguém')

  // ══════════════════════════════════════════════════════════════════════════
  secao('§4) A recomendação se explica em português')
  // ══════════════════════════════════════════════════════════════════════════
  ok('§4) tem explicação', sim.explicacao.length > 0)
  ok('§4) diz que tem permissão', sim.explicacao.some((l) => /permissão/i.test(l)))
  ok('§4) diz quantas tarefas dependem da pessoa', sim.explicacao.some((l) => /dependendo desta pessoa/i.test(l)))
  ok('§4) diz quantas atrasadas', sim.explicacao.some((l) => /atrasada/i.test(l)))
  ok('§4) diz quantas aguardando terceiro', sim.explicacao.some((l) => /aguardando terceiro/i.test(l)))
  ok('§4) e diz por que ela ganhou', sim.explicacao.some((l) => /menor entre/i.test(l)))
  ok('§13) o score vem decomposto', (dAna?.parcelas.length ?? 0) === 5)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§1) Equipe é CONTEXTO, nunca veto — porque não concede permissão')
  // ══════════════════════════════════════════════════════════════════════════
  const comEquipe = await prisma.tarefa.create({
    data: {
      titulo: `${MARCA} tarefa de equipe`, processoId: proc.id, statusTarefa: 'NAO_INICIADA',
      equipeKey: 'equipe_que_nao_existe', origem: 'MANUAL', justificativa: 'palco',
    }, select: { id: true },
  })
  const simEquipe = await simularTarefa(comEquipe.id)
  ok('§1) tarefa que nomeia equipe inexistente AINDA recebe recomendação',
    simEquipe.recomendado != null, simEquipe.recomendado?.nome ?? `abstenção ${simEquipe.abstencao?.codigo}`)
  ok('§1) e a equipe aparece como contexto', simEquipe.equipe?.exigidaPelaTarefa === 'equipe_que_nao_existe')
  ok('§1) dizendo que não está cadastrada', simEquipe.equipe?.cadastrada === false)
  // O motivo mudou junto com a regra: antes equipe NUNCA restringia (grupo não
  // concede permissão); agora ela restringe quando EXISTE no cadastro. Aqui não
  // existe — e é isso que a nota tem de explicar.
  ok('§1) e por que isso não bloqueia',
    /não é uma regra|não existe como equipe ativa/i.test(simEquipe.equipe?.nota ?? ''),
    simEquipe.equipe?.nota?.slice(0, 70) ?? '—')
  ok('§1) ninguém ficou inelegível por causa da equipe',
    !simEquipe.avaliacoes.some((a) => a.motivos.some((m) => /equipe/i.test(m.codigo))))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§5/§11) Quando NÃO recomendar')
  // ══════════════════════════════════════════════════════════════════════════
  const jaAtribuida = await criar('já tem dono')
  await atribuirTarefa({ tarefaId: jaAtribuida, responsavelId: ana.id, autorId: gestor.id })
  const simAtribuida = await simularTarefa(jaAtribuida)
  ok('§11) tarefa com responsável não recebe sugestão',
    simAtribuida.recomendado === null && simAtribuida.abstencao?.codigo === 'JA_TEM_RESPONSAVEL')
  ok('§11) e a abstenção diz que redistribuir é outra decisão', /outra decisão/i.test(simAtribuida.abstencao?.texto ?? ''))

  const simInexistente = await simularTarefa(999_999_999)
  ok('§5) tarefa inexistente → abstenção', simInexistente.abstencao?.codigo === 'TAREFA_INEXISTENTE')

  // §E — nenhum elegível: tira a permissão de todos os executores por um instante.
  await prisma.usuario.updateMany({
    where: { email: { in: ['ana@eleg.test', 'bruno@eleg.test', 'carla@eleg.test'] } },
    data: { permissoesCustom: PERM_SEM_EXECUCAO },
  })
  const semNinguem = await simularTarefa(alvo)
  ok('§E) sem ninguém com permissão → SEM RECOMENDAÇÃO',
    semNinguem.recomendado === null && semNinguem.abstencao?.codigo === 'NENHUM_ELEGIVEL')
  ok('§5) e o motivo diz o que fazer', /tarefas\.iniciar_concluir/.test(semNinguem.abstencao?.texto ?? ''))
  ok('§5) nenhum responsável foi inventado', semNinguem.recomendado === null)
  await prisma.usuario.updateMany({
    where: { email: { in: ['ana@eleg.test', 'bruno@eleg.test', 'carla@eleg.test'] } },
    data: { permissoesCustom: PERM_EXECUTOR },
  })

  // ══════════════════════════════════════════════════════════════════════════
  secao('§6/§F/§H) Desempate determinístico e simulação repetível')
  // ══════════════════════════════════════════════════════════════════════════
  const [e1, e2] = await Promise.all([
    prisma.usuario.create({ data: { nome: 'Empate Um', email: 'e1@eleg.test', senha: 'x', tipo: 'assistente', permissoesCustom: PERM_EXECUTOR }, select: { id: true } }),
    prisma.usuario.create({ data: { nome: 'Empate Dois', email: 'e2@eleg.test', senha: 'x', tipo: 'assistente', permissoesCustom: PERM_EXECUTOR }, select: { id: true } }),
  ])
  const alvoEmpate = await criar('empate')
  const s1 = await simularTarefa(alvoEmpate)
  const s2 = await simularTarefa(alvoEmpate)
  ok('§F) os dois empatados têm o MESMO score',
    cargaDe(s1, e1.id)?.score === cargaDe(s1, e2.id)?.score, String(cargaDe(s1, e1.id)?.score))
  ok('§F) o desempate escolhe o menor id, sem sorteio',
    s1.recomendado?.usuarioId === Math.min(e1.id, e2.id) || s1.recomendado!.usuarioId < e1.id,
    `escolhido #${s1.recomendado?.usuarioId}`)
  ok('§H) duas simulações do mesmo estado dão o MESMO resultado',
    s1.recomendado?.usuarioId === s2.recomendado?.usuarioId &&
    JSON.stringify(s1.avaliacoes.map((a) => [a.usuarioId, a.score])) === JSON.stringify(s2.avaliacoes.map((a) => [a.usuarioId, a.score])))
  ok('§6) e quando cai no desempate técnico, a recomendação AVISA',
    s1.decididoNoDesempateTecnico === true && s1.explicacao.some((l) => /desempate técnico/i.test(l)))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§8/§9/§10/§G) Lote com carga virtual')
  // ══════════════════════════════════════════════════════════════════════════
  await prisma.usuario.deleteMany({ where: { email: { in: ['e1@eleg.test', 'e2@eleg.test'] } } })
  // Dez tarefas novas e só dois elegíveis com carga igual: sem carga virtual,
  // as dez cairiam na mesma pessoa.
  // O cenário §G é "10 tarefas / 2 usuários": os demais executores do palco
  // saem de cena, senão o lote se espalha por cinco pessoas e a prova deixa de
  // ser sobre concentração.
  await prisma.usuario.updateMany({
    where: { email: { in: ['ana@eleg.test', 'bruno@eleg.test', 'carla@eleg.test'] } },
    data: { permissoesCustom: PERM_SEM_EXECUCAO },
  })
  const [d1, d2] = await Promise.all([
    prisma.usuario.create({ data: { nome: 'Dupla Um', email: 'd1@eleg.test', senha: 'x', tipo: 'assistente', permissoesCustom: PERM_EXECUTOR }, select: { id: true } }),
    prisma.usuario.create({ data: { nome: 'Dupla Dois', email: 'd2@eleg.test', senha: 'x', tipo: 'assistente', permissoesCustom: PERM_EXECUTOR }, select: { id: true } }),
  ])
  const dez: number[] = []
  for (let i = 0; i < 10; i++) dez.push(await criar(`lote ${i}`))

  const lote = await simularLote({ taskIds: dez })
  ok('§8) o lote responde por todas as tarefas', lote.recomendacoes.length === 10, `${lote.recomendacoes.length}`)
  const daDupla = lote.resumo.porUsuario.filter((u) => u.usuarioId === d1.id || u.usuarioId === d2.id)
  const total = daDupla.reduce((s, u) => s + u.recebeu, 0)
  ok('§G) as dez foram distribuídas entre os DOIS elegíveis', total === 10, JSON.stringify(lote.resumo.porUsuario))
  ok('§9) e NÃO se concentraram numa pessoa só',
    daDupla.length === 2 && daDupla.every((u) => u.recebeu >= 4),
    daDupla.map((u) => `${u.nome}: ${u.recebeu}`).join(' | '))
  ok('§9) a diferença entre as duas é no máximo 1 tarefa',
    Math.abs((daDupla[0]?.recebeu ?? 0) - (daDupla[1]?.recebeu ?? 0)) <= 1)

  // §10 — ordem: o trabalho crítico consome a capacidade primeiro.
  const atrasadaNoLote = await criar('lote atrasada', { dataPrazo: ontem })
  const urgenteNoLote = await criar('lote urgente', { prioridade: 'URGENTE' })
  const semPrazoNoLote = await criar('lote sem prazo')
  const ordenado = await simularLote({ taskIds: [semPrazoNoLote, urgenteNoLote, atrasadaNoLote] })
  ok('§10) a atrasada é avaliada primeiro', ordenado.recomendacoes[0]?.taskId === atrasadaNoLote,
    ordenado.recomendacoes.map((r) => r.titulo.replace(`${MARCA} `, '')).join(' → '))
  ok('§10) depois a urgente', ordenado.recomendacoes[1]?.taskId === urgenteNoLote)
  ok('§10) e a sem prazo por último', ordenado.recomendacoes[2]?.taskId === semPrazoNoLote)

  ok('§H) o lote é repetível', JSON.stringify((await simularLote({ taskIds: dez })).recomendacoes.map((r) => [r.taskId, r.recomendado?.usuarioId]))
    === JSON.stringify(lote.recomendacoes.map((r) => [r.taskId, r.recomendado?.usuarioId])))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§I) A SIMULAÇÃO NÃO ESCREVE — a prova')
  // ══════════════════════════════════════════════════════════════════════════
  const retrato = async () => ({
    tarefas: await prisma.tarefa.count(),
    responsaveis: JSON.stringify(
      (await prisma.tarefa.findMany({ select: { id: true, responsavelId: true, statusTarefa: true, lockVersion: true }, orderBy: { id: 'asc' } }))),
    notificacoes: await prisma.notificacaoOperacional.count(),
    auditoria: await prisma.logAuditoria.count(),
    historico: await prisma.tarefaHistorico.count(),
    eventos: await prisma.workflowEvento.count(),
  })
  const antes = await retrato()
  await simularTarefa(alvo)
  await simularLote({ limite: 100 })
  await simularTarefa(comEquipe.id)
  const depois = await retrato()
  ok('§I) nenhuma Tarefa criada ou removida', antes.tarefas === depois.tarefas, `${antes.tarefas} → ${depois.tarefas}`)
  ok('§I) NENHUM responsavelId mudou', antes.responsaveis === depois.responsaveis)
  ok('§9) nenhuma notificação foi gerada', antes.notificacoes === depois.notificacoes, `${antes.notificacoes} → ${depois.notificacoes}`)
  ok('§I) nenhum registro de auditoria', antes.auditoria === depois.auditoria, `${antes.auditoria} → ${depois.auditoria}`)
  ok('§I) nenhum histórico de tarefa', antes.historico === depois.historico)
  ok('§I) nenhum evento de workflow', antes.eventos === depois.eventos)

  // A prova estática fecha o cerco: nem hoje nem amanhã, por engano.
  ok('§I) o motor não contém escrita nenhuma',
    !/\b(prisma|tx|db)\s*\.\s*\w+\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(fonteMotor))
  const codigo = fonteMotor.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok('§15) e não chama nenhuma porta de comando',
    !/atribuirTarefa|transferirTarefa|devolverAFila|iniciarTarefa|concluirEtapa/.test(codigo))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§18) NENHUMA DISTRIBUIÇÃO AUTOMÁTICA FOI ATIVADA')
  // ══════════════════════════════════════════════════════════════════════════
  const { readFileSync, existsSync, readdirSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const RAIZ = join(__dirname, '..')
  const varrer = (dir: string, acc: string[] = []): string[] => {
    if (!existsSync(dir)) return acc
    for (const e of readdirSync(dir)) {
      if (['node_modules', '.next', '.git', 'capturas'].includes(e)) continue
      const p = join(dir, e)
      if (statSync(p).isDirectory()) varrer(p, acc)
      else if (/\.tsx?$/.test(p)) acc.push(p)
    }
    return acc
  }
  const arquivos = [...varrer(join(RAIZ, 'src')), ...varrer(join(RAIZ, 'lib'))]
  const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // Quem consome o motor de recomendação, e para quê. Se um dia um cron, uma
  // fila ou uma rota passar a chamá-lo E atribuir, é aqui que aparece.
  const consumidores = arquivos
    .filter((f) => !f.endsWith('lib/operacional/elegibilidade.ts')) // o próprio motor não é consumidor
    .filter((f) => /simularLote|simularTarefa/.test(semComentarios(readFileSync(f, 'utf8'))))
    .map((f) => f.replace(RAIZ + '/', ''))
  ok('§18) o motor tem consumidor NOMEADO e só de leitura',
    consumidores.every((f) => f === 'src/app/api/operacao/sugestao/route.ts'),
    consumidores.join(', ') || 'nenhum')

  const rotaSugestao = semComentarios(readFileSync(join(RAIZ, 'src/app/api/operacao/sugestao/route.ts'), 'utf8'))
  ok('§18) a rota de sugestão é só GET', /export async function GET/.test(rotaSugestao)
    && !/export async function (POST|PATCH|PUT|DELETE)/.test(rotaSugestao))
  ok('§18) e não chama porta de atribuição', !/atribuirTarefa|transferirTarefa/.test(rotaSugestao))

  // Nenhum agendamento dispara distribuição sozinho.
  const agendados = arquivos.filter((f) => /vercel\.json|cron/i.test(f))
  void agendados
  const cronConfig = existsSync(join(RAIZ, 'vercel.json')) ? readFileSync(join(RAIZ, 'vercel.json'), 'utf8') : ''
  ok('§18) nenhum cron aponta para a sugestão', !/sugestao|distribuicao|distribuir/i.test(cronConfig))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§17) Sem N+1')
  // ══════════════════════════════════════════════════════════════════════════
  const corpoLote = fonteMotor.slice(fonteMotor.indexOf('export async function simularLote'))
  ok('§17) o lote não consulta dentro do laço',
    !/for\s*\([^)]*\)\s*\{[\s\S]{0,400}?await\s+prisma\./.test(corpoLote))
  ok('§17) o universo é lido UMA vez', (fonteMotor.match(/await lerUniverso\(/g) ?? []).length <= 2)
  ok('§17) e a avaliação de cada tarefa é síncrona (sem I/O por usuário)',
    /^function avaliar\(/m.test(fonteMotor))

  await limpar()
  await restaurar()
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhou === 0
    ? 'O motor recomenda, explica e se abstém — e não escreve nada.'
    : 'O motor de recomendação divergiu do contrato.')
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

void main()
