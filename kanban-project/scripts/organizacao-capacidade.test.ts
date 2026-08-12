// scripts/organizacao-capacidade.test.ts
// ============================================================================
// A CAMADA OPERACIONAL DO FUNCIONÁRIO — e o que ela faz com a recomendação.
//
//   npx tsx scripts/organizacao-capacidade.test.ts
//
// A camada nova pode falhar de dois jeitos opostos, e os dois são graves:
//
//   FROUXO DEMAIS  a regra existe, ninguém a cumpre, e o sistema recomenda
//                  alguém assim mesmo — relaxando em silêncio.
//   RÍGIDO DEMAIS  a regra NÃO existe (tabela vazia, equipe não cadastrada) e
//                  o sistema trava tudo, como se todo mundo tivesse reprovado.
//
// Cada cenário aqui é uma das duas beiradas. E, no fim, a de sempre: nada
// disso escreve na Tarefa.
//
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { prisma } from '../lib/prisma'
import { Prisma } from '@prisma/client'
import { exigirBancoDeTeste } from './_banco-de-teste'
import { simularTarefa } from '../lib/operacional/elegibilidade'
import {
  definirAptidoes, definirCapacidade, abrirIndisponibilidade, encerrarIndisponibilidade,
  lerOrganizacao, fasesDisponiveis, faseValida, fasesComAptidaoDeclarada,
} from '../lib/operacional/organizacao'
import { criarTarefaManual } from '../lib/operacional/tarefa-ciclo'
import { atribuirTarefa } from '../lib/operacional/tarefa-comandos'

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = 'ORG'
const FASE = 'emissao_documental'
const PERM_EXECUTOR = { 'tarefas.ver': true, 'tarefas.iniciar_concluir': true }
const PERM_SEM_EXECUCAO = { 'tarefas.ver': true, 'tarefas.iniciar_concluir': false }
const criterio = (sim: Awaited<ReturnType<typeof simularTarefa>>, id: number, chave: string) =>
  sim.avaliacoes.find((a) => a.usuarioId === id)?.criterios.find((c) => c.chave === chave)
const avaliacao = (sim: Awaited<ReturnType<typeof simularTarefa>>, id: number) =>
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
  await prisma.grupoUsuario.deleteMany({ where: { code: { startsWith: 'org_' } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@org.test' } } })
}

/** Só o palco pode executar — senão os usuários de outros testes decidem a prova. */
async function isolar(emails: string[]) {
  const todos = await prisma.usuario.findMany({ select: { id: true, email: true, permissoesCustom: true } })
  const deFora = todos.filter((u) => !emails.includes(u.email))
  for (const u of deFora) {
    const atual = (u.permissoesCustom as Record<string, boolean> | null) ?? {}
    await prisma.usuario.update({ where: { id: u.id }, data: { permissoesCustom: { ...atual, 'tarefas.iniciar_concluir': false } } })
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
  exigirBancoDeTeste('monta o palco da camada operacional')
  console.log('A CAMADA OPERACIONAL DO FUNCIONÁRIO\n')
  await limpar()
  const EMAILS = ['gestor@org.test', 'apta@org.test', 'apta2@org.test', 'inapta@org.test', 'ferias@org.test', 'semperm@org.test', 'cheia@org.test']
  const restaurar = await isolar(EMAILS)

  try {
    // ════════════════════════════════════════════════════════════════════════
    secao('§1/§2) Reúso e separação de conceitos')
    // ════════════════════════════════════════════════════════════════════════
    ok('§1) a organização REUTILIZA GrupoUsuario — nenhuma "Equipe" nova foi criada',
      !Object.keys(prisma).some((k) => /^equipe|^time$|^setor/i.test(k)),
      'equipe = GrupoUsuario + GrupoUsuarioMembro')
    ok('§2) a camada nova tem três tabelas, uma por conceito',
      ['aptidaoOperacional', 'indisponibilidadeOperacional', 'capacidadeOperacional'].every((m) => m in prisma))
    ok('§4) a aptidão usa a FASE PUBLICADA, não string solta',
      faseValida(FASE) && !faseValida('fase_inventada'))
    ok('§4) e as fases oferecidas vêm do catálogo', fasesDisponiveis().some((f) => f.faseKey === FASE),
      `${fasesDisponiveis().length} fases`)

    // ── palco ───────────────────────────────────────────────────────────────
    const gestor = await prisma.usuario.create({
      data: { nome: 'Gestor Org', email: 'gestor@org.test', senha: 'x', tipo: 'admin', permissoesCustom: PERM_SEM_EXECUCAO },
      select: { id: true },
    })
    const criarUsuario = (nome: string, email: string, perm = PERM_EXECUTOR) =>
      prisma.usuario.create({ data: { nome, email, senha: 'x', tipo: 'assistente', permissoesCustom: perm }, select: { id: true } })
    const [apta, apta2, inapta, ferias, semPerm, cheia] = await Promise.all([
      criarUsuario('Apta Um', 'apta@org.test'),
      criarUsuario('Apta Dois', 'apta2@org.test'),
      criarUsuario('Inapta', 'inapta@org.test'),
      criarUsuario('De Férias', 'ferias@org.test'),
      criarUsuario('Sem Permissão', 'semperm@org.test', PERM_SEM_EXECUCAO),
      criarUsuario('Capacidade Cheia', 'cheia@org.test'),
    ])
    const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
    const proc = await prisma.processo.create({
      data: { nome: `${MARCA} Família`, pais: 'espanha', arvoreId: arv.id, workflowRuntime: 'v2' }, select: { id: true },
    })
    const criar = async (titulo: string, extra: { fase?: string | null; equipe?: string | null } = {}) => {
      const r = await criarTarefaManual({
        titulo: `${MARCA} ${titulo}`, processoId: proc.id, autorId: gestor.id,
        motivo: 'palco da camada operacional', confirmarDuplicidade: true,
        faseMacroKey: extra.fase === undefined ? FASE : extra.fase,
        equipeKey: extra.equipe ?? null,
      })
      if (!r.ok) throw new Error(`criar ${titulo}: ${'mensagem' in r ? r.mensagem : '?'}`)
      return r.tarefaId
    }

    // ════════════════════════════════════════════════════════════════════════
    secao('§E/§11) Sem regra configurada, NADA é bloqueado artificialmente')
    // ════════════════════════════════════════════════════════════════════════
    const semRegra = await criar('sem regra')
    const s0 = await simularTarefa(semRegra)
    ok('§E) com aptidão vazia, a fase não restringe ninguém',
      criterio(s0, apta.id, 'APTIDAO')?.veredito === 'nao_aplicavel',
      criterio(s0, apta.id, 'APTIDAO')?.detalhe ?? '—')
    ok('§E) e a tarefa recebe recomendação normalmente', s0.recomendado != null, s0.recomendado?.nome ?? '—')
    ok('§11) equipe não exigida = critério não aplicável',
      criterio(s0, apta.id, 'EQUIPE')?.veredito === 'nao_aplicavel')
    ok('§6) capacidade sem teto = critério não aplicável',
      criterio(s0, apta.id, 'CAPACIDADE')?.veredito === 'nao_aplicavel')
    ok('§12) e os CINCO critérios aparecem sempre', (avaliacao(s0, apta.id)?.criterios.length ?? 0) === 5)

    // ════════════════════════════════════════════════════════════════════════
    secao('§C) Aptidão passa a valer quando ALGUÉM é declarado apto')
    // ════════════════════════════════════════════════════════════════════════
    const r1 = await definirAptidoes(apta.id, [FASE])
    ok('§4) declarar aptidão funciona', r1.ok === true)
    ok('§4) e recusa fase fora do catálogo',
      (await definirAptidoes(apta.id, [FASE, 'fase_que_nao_existe'])).ok === false)
    ok('§4) a fase agora tem regra', (await fasesComAptidaoDeclarada()).has(FASE))

    const s1 = await simularTarefa(semRegra)
    ok('§C) quem é apto passa', criterio(s1, apta.id, 'APTIDAO')?.veredito === 'ok')
    ok('§C) quem NÃO é apto fica inelegível', avaliacao(s1, inapta.id)?.elegivel === false)
    ok('§C) com o motivo nomeado',
      avaliacao(s1, inapta.id)?.motivos.some((m) => m.codigo === 'SEM_APTIDAO') === true,
      avaliacao(s1, inapta.id)?.motivos[0]?.texto ?? '—')
    ok('§C) e a recomendação é de quem é apto', s1.recomendado?.usuarioId === apta.id, s1.recomendado?.nome ?? '—')
    ok('§4) a aptidão declarada aparece na avaliação',
      (avaliacao(s1, apta.id)?.aptidoes ?? []).some((a) => /Emiss/i.test(a)))

    // ════════════════════════════════════════════════════════════════════════
    secao('§B/§I) Disponibilidade — e a recomendação muda na hora')
    // ════════════════════════════════════════════════════════════════════════
    await definirAptidoes(apta2.id, [FASE])
    const antesDoAfastamento = await simularTarefa(semRegra)
    ok('§I) antes das férias, a pessoa é elegível', avaliacao(antesDoAfastamento, apta.id)?.elegivel === true)

    const ontem = new Date(Date.now() - 86400000)
    const daquiUmaSemana = new Date(Date.now() + 7 * 86400000)
    const ind = await abrirIndisponibilidade({
      usuarioId: apta.id, tipo: 'FERIAS', inicio: ontem, fim: daquiUmaSemana,
      motivo: 'férias programadas', autorId: gestor.id,
    })
    ok('§5) abrir indisponibilidade funciona', ind.ok === true)

    const durante = await simularTarefa(semRegra)
    ok('§B) com permissão e apta, MAS indisponível → inelegível',
      avaliacao(durante, apta.id)?.elegivel === false)
    ok('§B) com o motivo e o período', criterio(durante, apta.id, 'DISPONIBILIDADE')?.veredito === 'reprovado' &&
      /férias/i.test(criterio(durante, apta.id, 'DISPONIBILIDADE')?.detalhe ?? ''),
      criterio(durante, apta.id, 'DISPONIBILIDADE')?.detalhe ?? '—')
    ok('§I) e a recomendação MUDA imediatamente para a outra apta',
      durante.recomendado?.usuarioId === apta2.id, durante.recomendado?.nome ?? '—')

    if (ind.ok) {
      const enc = await encerrarIndisponibilidade(ind.id)
      ok('§5) encerrar funciona', enc.ok === true)
      const depois = await simularTarefa(semRegra)
      ok('§I) e ela volta a ser elegível na simulação seguinte',
        avaliacao(depois, apta.id)?.elegivel === true)
      const registro = await prisma.indisponibilidadeOperacional.findUnique({ where: { id: ind.id }, select: { fim: true } })
      ok('§5) o REGISTRO permanece, com a data de fim — histórico não se apaga',
        registro?.fim != null, registro?.fim?.toISOString() ?? '—')
    }

    // ════════════════════════════════════════════════════════════════════════
    secao('§D/§7) Capacidade — e ela conta EXECUTÁVEIS, não tarefas')
    // ════════════════════════════════════════════════════════════════════════
    await definirAptidoes(cheia.id, [FASE])
    const r2 = await definirCapacidade({ usuarioId: cheia.id, limiteExecutaveis: 2, autorId: gestor.id })
    ok('§6) definir capacidade funciona', r2.ok === true)
    ok('§6) e recusa número negativo',
      (await definirCapacidade({ usuarioId: cheia.id, limiteExecutaveis: -1, autorId: gestor.id })).ok === false)

    // Duas executáveis → no limite. Mais três aguardando terceiro → NÃO contam.
    for (let i = 0; i < 2; i++) {
      const t = await criar(`executavel ${i}`)
      await atribuirTarefa({ tarefaId: t, responsavelId: cheia.id, autorId: gestor.id })
    }
    const comLimite = await simularTarefa(semRegra)
    ok('§D) capacidade esgotada → inelegível',
      avaliacao(comLimite, cheia.id)?.elegivel === false &&
      avaliacao(comLimite, cheia.id)?.motivos.some((m) => m.codigo === 'CAPACIDADE_ESGOTADA') === true,
      criterio(comLimite, cheia.id, 'CAPACIDADE')?.detalhe ?? '—')

    const { iniciarTarefa } = await import('../lib/operacional/tarefa-comandos')
    const { aguardarTerceiro } = await import('../lib/operacional/tarefa-ciclo')
    for (let i = 0; i < 3; i++) {
      const t = await criar(`espera ${i}`)
      await atribuirTarefa({ tarefaId: t, responsavelId: cheia.id, autorId: gestor.id })
      await iniciarTarefa({ tarefaId: t, autorId: cheia.id })
      await aguardarTerceiro({ tarefaId: t, autorId: cheia.id, motivo: 'cartório' })
    }
    const comEspera = await simularTarefa(semRegra)
    const cargaCheia = avaliacao(comEspera, cheia.id)?.carga
    ok('§7) cinco tarefas ativas, três aguardando terceiro',
      cargaCheia?.ativas === 5 && cargaCheia?.aguardandoTerceiro === 3,
      `${cargaCheia?.ativas} ativas / ${cargaCheia?.aguardandoTerceiro} esperando`)
    ok('§7) e o teto continua contando só as DUAS executáveis',
      /2 de 2/.test(criterio(comEspera, cheia.id, 'CAPACIDADE')?.detalhe ?? ''),
      criterio(comEspera, cheia.id, 'CAPACIDADE')?.detalhe ?? '—')

    await definirCapacidade({ usuarioId: cheia.id, limiteExecutaveis: null, autorId: gestor.id })
    ok('§6) remover o teto volta ao modo relativo',
      criterio(await simularTarefa(semRegra), cheia.id, 'CAPACIDADE')?.veredito === 'nao_aplicavel')

    // ════════════════════════════════════════════════════════════════════════
    secao('§9/§3) Equipe restringe SÓ quando existe no cadastro')
    // ════════════════════════════════════════════════════════════════════════
    const semCadastro = await criar('equipe fantasma', { equipe: 'org_inexistente' })
    const sf = await simularTarefa(semCadastro)
    ok('§11) equipe não cadastrada NÃO bloqueia',
      criterio(sf, apta.id, 'EQUIPE')?.veredito === 'nao_aplicavel' && sf.recomendado != null,
      sf.recomendado?.nome ?? `abstenção ${sf.abstencao?.codigo}`)

    const equipe = await prisma.grupoUsuario.create({
      data: { code: 'org_documental', nome: 'Emissão Documental (ORG)', ativo: true,
        membros: { create: [{ usuarioId: apta2.id }] } },
      select: { id: true },
    })
    void equipe
    const comEquipe = await criar('equipe real', { equipe: 'org_documental' })
    const se = await simularTarefa(comEquipe)
    ok('§3) membro da equipe passa', criterio(se, apta2.id, 'EQUIPE')?.veredito === 'ok')
    ok('§9) quem está fora da equipe fica inelegível',
      avaliacao(se, apta.id)?.elegivel === false &&
      avaliacao(se, apta.id)?.motivos.some((m) => m.codigo === 'FORA_DA_EQUIPE_EXIGIDA') === true)
    ok('§3) e a recomendação sai de dentro da equipe', se.recomendado?.usuarioId === apta2.id, se.recomendado?.nome ?? '—')
    ok('§8) a avaliação mostra as equipes da pessoa',
      (avaliacao(se, apta2.id)?.equipes ?? []).some((e) => /ORG/.test(e)))

    // ════════════════════════════════════════════════════════════════════════
    secao('§10/§F) Abstenção sem relaxar a regra')
    // ════════════════════════════════════════════════════════════════════════
    // Todo mundo da equipe fica indisponível: a regra continua de pé.
    const bloqueio = await abrirIndisponibilidade({
      usuarioId: apta2.id, tipo: 'BLOQUEIO_OPERACIONAL', inicio: ontem, fim: null,
      motivo: 'realocada para outro projeto', autorId: gestor.id,
    })
    const semNinguem = await simularTarefa(comEquipe)
    ok('§F) ninguém elegível → abstenção', semNinguem.recomendado === null,
      semNinguem.abstencao?.codigo ?? 'recomendou')
    ok('§10) a mensagem é a do enunciado', /Nenhum funcionário disponível e apto/i.test(semNinguem.abstencao?.texto ?? ''),
      semNinguem.abstencao?.texto?.slice(0, 90) ?? '—')
    ok('§10) e ela DIZ o que derrubou cada um',
      /fora da equipe|indispon/i.test(semNinguem.abstencao?.texto ?? ''))
    ok('§10) a regra NÃO foi relaxada para devolver um nome', semNinguem.recomendado === null)
    if (bloqueio.ok) await encerrarIndisponibilidade(bloqueio.id)

    // ════════════════════════════════════════════════════════════════════════
    secao('§A/§G) A ordem: permissão primeiro, score por último')
    // ════════════════════════════════════════════════════════════════════════
    const sOrdem = await simularTarefa(semRegra)
    ok('§A) sem permissão continua inelegível, aconteça o que acontecer',
      avaliacao(sOrdem, semPerm.id)?.elegivel === false &&
      avaliacao(sOrdem, semPerm.id)?.motivos[0]?.codigo === 'SEM_PERMISSAO_EXECUTAR')
    ok('§9) e os critérios vêm na ordem canônica',
      JSON.stringify(avaliacao(sOrdem, apta.id)?.criterios.map((c) => c.chave))
      === JSON.stringify(['PERMISSAO', 'DISPONIBILIDADE', 'APTIDAO', 'EQUIPE', 'CAPACIDADE']))
    ok('§G) entre vários elegíveis, o score decide',
      sOrdem.recomendado != null &&
      sOrdem.avaliacoes.filter((a) => a.elegivel).every((a) => a.score >= (sOrdem.recomendado?.score ?? 0)))
    ok('§12) a explicação traz os cinco critérios com veredito',
      ['Permissão', 'Disponibilidade', 'Aptidão', 'Equipe/escopo', 'Capacidade']
        .every((c) => sOrdem.explicacao.some((l) => l.includes(c))),
      sOrdem.explicacao.slice(1, 6).join(' | ').slice(0, 100))

    // ════════════════════════════════════════════════════════════════════════
    secao('§J) Nada disso escreve na Tarefa')
    // ════════════════════════════════════════════════════════════════════════
    const retrato = async () => JSON.stringify(await prisma.tarefa.findMany({
      select: { id: true, responsavelId: true, statusTarefa: true, lockVersion: true }, orderBy: { id: 'asc' },
    }))
    const antes = await retrato()
    const notifAntes = await prisma.notificacaoOperacional.count()
    await simularTarefa(semRegra)
    await simularTarefa(comEquipe)
    await lerOrganizacao()
    ok('§J) nenhuma Tarefa mudou', (await retrato()) === antes)
    ok('§J) nenhuma notificação foi criada', (await prisma.notificacaoOperacional.count()) === notifAntes)

    const fonte = (await import('node:fs')).readFileSync(
      (await import('node:path')).join(__dirname, '..', 'lib/operacional/organizacao.ts'), 'utf8')
    const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    ok('§16) a camada não toca em Tarefa',
      !/\b(prisma|tx)\s*\.\s*tarefa\s*\./.test(codigo))
    ok('§16) nem em passo de workflow', !/phaseWorkflowStepInstance/.test(codigo))
    ok('§2) e não escreve permissão', !/permissoesCustom|perfilId/.test(codigo))
  } finally {
    await limpar()
    await restaurar()
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhou === 0
    ? 'A camada restringe quem já pode — e não bloqueia o que ninguém configurou.'
    : 'A camada operacional divergiu do contrato.')
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

void main()
