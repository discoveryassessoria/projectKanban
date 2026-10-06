// scripts/aptidoes-traducao-apostilamento.test.ts
// ============================================================================
// DUAS UNIDADES DE TRABALHO NOVAS na Capacidade Operacional: "Envio para tradução juramentada" e "Envio para apostilamento".
//   node scripts/ci/gate-build.mjs --so aptidoes-traducao-apostilamento      (banco de teste descartável, com as migrations reais)
// Prova: a migration cria as duas (aditiva, idempotente, sem tocar em nada existente); elas são da MESMA natureza da "Emissão de Certidão"
// (perfil operacional); ligadas ao Workflow Interno da fase, a tarefa daquele PASSO resolve a unidade nova mesmo quando o documento é o
// mesmo de uma certidão; e a distribuição respeita a aptidão (apto em tradução não recebe apostilamento e vice-versa).
// ============================================================================
import { readFileSync } from 'node:fs'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { exigirBancoDeTeste } from './_banco-de-teste'
import { simularTarefa } from '../lib/operacional/elegibilidade'
import { definirAptidoes, unidadesOperacionais, unidadeValida, unidadesDasTarefas, unidadeDoPasso, type PerfisPorPasso } from '../lib/operacional/organizacao'
import { criarTarefaManual } from '../lib/operacional/tarefa-ciclo'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = '') => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ''}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ''}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = 'APT'
const PERM_EXECUTOR = { 'tarefas.ver': true, 'tarefas.iniciar_concluir': true }
const MIGRATION = 'prisma/migrations/20261006100000_aptidoes_traducao_apostilamento/migration.sql'
const CODES = ['ENVIO_TRADUCAO_JURAMENTADA', 'ENVIO_APOSTILAMENTO']

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: ts.map((t) => t.id) } } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: 'Tarefa', entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.aptidaoOperacional.deleteMany({ where: { usuario: { email: { endsWith: '@apt.test' } } } })
  await prisma.perfilOperacionalDocumento.updateMany({ where: { code: { in: CODES } }, data: { workflowId: null } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { wfUid: { startsWith: 'TESTE-APT-' } } })
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { code: { startsWith: `${MARCA}_` } } })
  await prisma.perfilOperacionalDocumento.deleteMany({ where: { code: { startsWith: `${MARCA}_` } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: `${MARCA}_` } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@apt.test' } } })
}

async function isolar(emails: string[]) {
  const todos = await prisma.usuario.findMany({ select: { id: true, email: true, permissoesCustom: true } })
  const deFora = todos.filter((u) => !emails.includes(u.email))
  for (const u of deFora) await prisma.usuario.update({ where: { id: u.id }, data: { permissoesCustom: { ...((u.permissoesCustom as Record<string, boolean> | null) ?? {}), 'tarefas.iniciar_concluir': false } } })
  return async () => { for (const u of deFora) await prisma.usuario.update({ where: { id: u.id }, data: { permissoesCustom: u.permissoesCustom === null ? Prisma.DbNull : u.permissoesCustom } }) }
}

async function main() {
  exigirBancoDeTeste('cria usuários, tarefas e workflows de teste')
  await limpar()
  const EMAILS = ['gestor@apt.test', 'trad@apt.test', 'apost@apt.test']
  const restaurar = await isolar(EMAILS)
  try {
    secao('1) A MIGRATION: só aditiva e idempotente')
    const sql = readFileSync(MIGRATION, 'utf8').replace(/--.*$/gm, '')
    ok('só INSERT (nenhum UPDATE, DELETE, ALTER, DROP, TRUNCATE)', /INSERT INTO "PerfilOperacionalDocumento"/.test(sql) && !/\b(UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i.test(sql))
    ok('cada INSERT só roda se o código ainda não existe (rodar de novo não duplica)', (sql.match(/WHERE NOT EXISTS/g) ?? []).length === 2)
    ok('nenhuma tabela além do perfil é escrita (aptidão, tipo documental, tarefa… intactos)', [...sql.matchAll(/INSERT INTO "([^"]+)"/g)].every((m) => m[1] === 'PerfilOperacionalDocumento'))

    secao('2) AS DUAS APTIDÕES existem, da mesma natureza da "Emissão de Certidão" (unidade de trabalho, não fase)')
    const perfis = await prisma.perfilOperacionalDocumento.findMany({ where: { code: { in: CODES } }, orderBy: { code: 'asc' } })
    const apost = perfis.find((p) => p.code === 'ENVIO_APOSTILAMENTO'), trad = perfis.find((p) => p.code === 'ENVIO_TRADUCAO_JURAMENTADA')
    ok('"Envio para tradução juramentada"', trad?.name === 'Envio para tradução juramentada' && trad.ativo && trad.sistema)
    ok('"Envio para apostilamento"', apost?.name === 'Envio para apostilamento' && apost.ativo && apost.sistema)
    ok('mesma natureza da Emissão de Certidão: perfil operacional com uma execução por DOCUMENTO', [trad, apost].every((p) => p?.escopoInstanciacao === 'DOCUMENTO' && p.exigeProcesso && p.exigePessoa && p.exigeDocumento))
    const oferecidas = await unidadesOperacionais()
    ok('aparecem na Capacidade Operacional (unidades do Cadastro Mestre) e a escrita as aceita', [trad!, apost!].every((p) => oferecidas.some((u) => u.perfilOperacionalId === p.id) && true) && (await unidadeValida(trad!.id)) && (await unidadeValida(apost!.id)))
    ok('nenhuma delas é uma FASE (o nome não é o de uma posição do processo)', ![trad!, apost!].some((p) => /^(tradução juramentada|apostilamento)$/i.test(p.name)))

    secao('3) LIGADAS AOS PASSOS (o workflowId do perfil → o Workflow Interno da fase)')
    ok('a migration resolve o workflow pela chave da fase (e deixa nulo onde o ambiente não o tem)', /"phaseKey" = 'traducao_juramentada'/.test(sql) && /"phaseKey" = 'apostilamento'/.test(sql) && /"origemBiblioteca" = false/.test(sql) && /"arquivado" = false/.test(sql))
    const wfT = await prisma.phaseInternalWorkflow.create({ data: { wfUid: 'TESTE-APT-trad', phaseKey: 'traducao_juramentada', name: 'WF tradução (teste)', passos: { create: [{ key: 'traducao_juramentada', label: 'Traduzir documento (juramentada)', ordem: 0 }] } }, select: { id: true } })
    const wfA = await prisma.phaseInternalWorkflow.create({ data: { wfUid: 'TESTE-APT-apost', phaseKey: 'apostilamento', name: 'WF apostilamento (teste)', passos: { create: [{ key: 'apostilamento', label: 'Apostilar documento', ordem: 0 }] } }, select: { id: true } })
    await prisma.perfilOperacionalDocumento.update({ where: { id: trad!.id }, data: { workflowId: wfT.id } })
    await prisma.perfilOperacionalDocumento.update({ where: { id: apost!.id }, data: { workflowId: wfA.id } })

    const mapa: PerfisPorPasso = new Map([['traducao_juramentada', [{ perfilOperacionalId: 7, passos: new Set(['traducao_juramentada']) }]], ['apostilamento', [{ perfilOperacionalId: 8, passos: new Set(['apostilamento']) }]]])
    ok('o passo certo da fase resolve a unidade', unidadeDoPasso(mapa, 'traducao_juramentada', 'traducao_juramentada') === 7 && unidadeDoPasso(mapa, 'apostilamento', 'apostilamento') === 8)
    ok('passo que não é do workflow (antigo/removido) não casa; fase sem perfil não resolve; sem passo vale a fase', unidadeDoPasso(mapa, 'apostilamento', 'outro') === null && unidadeDoPasso(mapa, 'genealogia', 'localizar_registro') === null && unidadeDoPasso(mapa, 'traducao_juramentada', null) === 7 && unidadeDoPasso(mapa, null, 'x') === null)

    secao('4) A TARefa resolve a unidade nova — mesmo sendo o MESMO documento de uma certidão')
    const gestor = await prisma.usuario.create({ data: { nome: 'Gestor Apt', email: 'gestor@apt.test', senha: 'x', tipo: 'admin', permissoesCustom: { 'tarefas.ver': true, 'tarefas.iniciar_concluir': false } }, select: { id: true } })
    const mk = (nome: string, email: string) => prisma.usuario.create({ data: { nome, email, senha: 'x', tipo: 'assistente', permissoesCustom: PERM_EXECUTOR }, select: { id: true } })
    const [uTrad, uApost] = await Promise.all([mk('Apt Tradução', 'trad@apt.test'), mk('Apt Apostila', 'apost@apt.test')])
    const emissao = await prisma.perfilOperacionalDocumento.create({ data: { code: `${MARCA}_EMISSAO`, name: 'Emissão de Certidão (APT)' }, select: { id: true } })
    const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_ITEM`, name: 'Certidão de Nascimento (APT)', natureza: 'DOCUMENTO' }, select: { id: true } })
    await prisma.tipoDocumentoCadastro.create({ data: { code: `${MARCA}_TIPO`, name: 'Certidão de Nascimento (APT)', itemCatalogoId: item.id, perfilOperacionalId: emissao.id } })
    const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
    const proc = await prisma.processo.create({ data: { nome: `${MARCA} Família`, arvoreId: arv.id, workflowRuntime: 'v2' }, select: { id: true } })
    const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: 'Teste', sobrenome: 'Apt' }, select: { id: true } })
    let seq = 0
    const criar = async (titulo: string, fase: string) => {
      const nec = await prisma.necessidadeDocumental.create({ data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-n-${seq++}` }, select: { id: true } })
      const r = await criarTarefaManual({ titulo: `${MARCA} ${titulo}`, processoId: proc.id, autorId: gestor.id, motivo: 'palco', confirmarDuplicidade: true, faseMacroKey: fase, necessidadeId: nec.id, pessoaId: pes.id })
      if (!r.ok) throw new Error(`criar ${titulo}`)
      return r.tarefaId
    }
    const tEmissao = await criar('certidão', 'emissao_documental')
    const tTrad = await criar('tradução da certidão', 'traducao_juramentada')
    const tApost = await criar('apostila da certidão', 'apostilamento')
    const un = await unidadesDasTarefas([tEmissao, tTrad, tApost])
    ok('o documento é o MESMO (a certidão), mas a tarefa de tradução resolve "Envio para tradução juramentada"', un.get(tTrad) === trad!.id, String(un.get(tTrad)))
    ok('e a de apostilamento resolve "Envio para apostilamento"', un.get(tApost) === apost!.id, String(un.get(tApost)))
    ok('a tarefa da certidão segue com a unidade que já tinha (Emissão) — nada existente mudou', un.get(tEmissao) === emissao.id, String(un.get(tEmissao)))

    secao('5) A DISTRIBUIÇÃO respeita a aptidão de cada unidade nova')
    await definirAptidoes(uTrad.id, [trad!.id])
    await definirAptidoes(uApost.id, [apost!.id])
    const sT = await simularTarefa(tTrad), sA = await simularTarefa(tApost)
    const ele = (s: Awaited<ReturnType<typeof simularTarefa>>, id: number) => s.avaliacoes.find((a) => a.usuarioId === id)?.elegivel
    ok('tradução: quem é apto em tradução é elegível; quem é apto só em apostilamento não é', ele(sT, uTrad.id) === true && ele(sT, uApost.id) === false)
    ok('apostilamento: o inverso', ele(sA, uApost.id) === true && ele(sA, uTrad.id) === false)
    ok('a recomendação automática escolhe o apto de cada unidade', sT.recomendado?.usuarioId === uTrad.id && sA.recomendado?.usuarioId === uApost.id, `${sT.recomendado?.nome} / ${sA.recomendado?.nome}`)
    ok('a explicação cita a unidade (e não a fase)', sT.explicacao.some((l) => l.includes('Envio para tradução juramentada')) && sA.explicacao.some((l) => l.includes('Envio para apostilamento')))

    secao('6) NADA EXISTENTE FOI ALTERADO')
    ok('a Emissão de Certidão do teste e a aptidão dela seguem como estavam', (await prisma.perfilOperacionalDocumento.findUnique({ where: { id: emissao.id } }))?.name === 'Emissão de Certidão (APT)' && (await prisma.aptidaoOperacional.count({ where: { perfilOperacionalId: emissao.id } })) === 0)
    ok('as aptidões criadas pelo teste são só as 2 declaradas aqui', (await prisma.aptidaoOperacional.count({ where: { usuario: { email: { endsWith: '@apt.test' } } } })) === 2)
  } finally {
    await limpar()
    await restaurar()
  }
  console.log(`\n${falhou === 0 ? '✅ PASSOU' : '❌ FALHOU'}: ${passou} ok, ${falhou} falhas`)
  await prisma.$disconnect()
  process.exit(falhou ? 1 : 0)
}
main().catch(async (e) => { console.error(e); try { await limpar() } catch {} ; await prisma.$disconnect(); process.exit(1) })
