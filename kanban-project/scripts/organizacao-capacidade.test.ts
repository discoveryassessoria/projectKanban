// scripts/organizacao-capacidade.test.ts
// ============================================================================
// A CAMADA OPERACIONAL DO FUNCIONÁRIO — e a ontologia que ela precisa respeitar.
//
//   npx tsx scripts/organizacao-capacidade.test.ts
//
// Esta suíte existe por causa de um erro real de modelagem: a aptidão nasceu
// apontando para a FASE DO WORKFLOW MACRO, e o primeiro cadastro real produziu
// "apto para Finalizado". Fase é onde o PROCESSO está; aptidão é o que a PESSOA
// sabe fazer. Cada asserção abaixo separa um par que o sistema tentou colapsar:
//
//   FASE ≠ APTIDÃO       duas unidades na MESMA fase, aptidão só numa
//   STEP ≠ APTIDÃO       cinco passos, UMA aptidão
//   EQUIPE ≠ APTIDÃO     membro da equipe sem competência não passa
//   PERMISSÃO ≠ APTIDÃO  apto sem autorização não passa
//   DISPONIBILIDADE, CAPACIDADE   cada uma reprova sozinha
//
// E a regra de implantação: unidade sem política não bloqueia; unidade com
// política restringe só aquela unidade.
//
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { prisma } from '../lib/prisma'
import { Prisma } from '@prisma/client'
import { exigirBancoDeTeste } from './_banco-de-teste'
import { simularTarefa, simularLote } from '../lib/operacional/elegibilidade'
import {
  definirAptidoes, definirCapacidade, abrirIndisponibilidade, encerrarIndisponibilidade,
  lerOrganizacao, unidadesOperacionais, unidadeValida, unidadesComAptidaoDeclarada,
  unidadesDasTarefas,
} from '../lib/operacional/organizacao'
import { criarTarefaManual, aguardarTerceiro } from '../lib/operacional/tarefa-ciclo'
import { atribuirTarefa, iniciarTarefa } from '../lib/operacional/tarefa-comandos'

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = 'ORG'
const PERM_EXECUTOR = { 'tarefas.ver': true, 'tarefas.iniciar_concluir': true }
const PERM_SEM_EXECUCAO = { 'tarefas.ver': true, 'tarefas.iniciar_concluir': false }
type Sim = Awaited<ReturnType<typeof simularTarefa>>
const criterio = (s: Sim, id: number, chave: string) =>
  s.avaliacoes.find((a) => a.usuarioId === id)?.criterios.find((c) => c.chave === chave)
const avaliacao = (s: Sim, id: number) => s.avaliacoes.find((a) => a.usuarioId === id)

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
  await prisma.aptidaoOperacional.deleteMany({ where: { perfilOperacional: { code: { startsWith: `${MARCA}_` } } } })
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { code: { startsWith: `${MARCA}_` } } })
  await prisma.perfilOperacionalDocumento.deleteMany({ where: { code: { startsWith: `${MARCA}_` } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: `${MARCA}_` } } })
  await prisma.familiaDocumental.deleteMany({ where: { code: { startsWith: `${MARCA}_` } } })
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
        // era NULO exige `Prisma.DbNull`.
        data: { permissoesCustom: u.permissoesCustom === null ? Prisma.DbNull : u.permissoesCustom },
      })
    }
  }
}

async function main() {
  exigirBancoDeTeste('monta o palco da camada operacional')
  console.log('A CAMADA OPERACIONAL — APTIDÃO É UNIDADE DE TRABALHO, NÃO FASE\n')
  await limpar()
  const EMAILS = ['gestor@org.test', 'apta@org.test', 'apta2@org.test', 'soequipe@org.test', 'semperm@org.test', 'cheia@org.test']
  const restaurar = await isolar(EMAILS)

  try {
    // ════════════════════════════════════════════════════════════════════════
    secao('§1/§6) A dimensão é o PERFIL OPERACIONAL — sem catálogo duplicado')
    // ════════════════════════════════════════════════════════════════════════
    ok('§6) não existe catálogo de "competência" paralelo',
      !Object.keys(prisma).some((k) => /^competencia|^habilidade|^skill/i.test(k)),
      'a unidade é PerfilOperacionalDocumento')
    ok('§1) a organização REUTILIZA GrupoUsuario para equipe',
      !Object.keys(prisma).some((k) => /^equipe|^time$|^setor/i.test(k)))
    const campos = Object.keys(prisma.aptidaoOperacional.fields)
    ok('§3) a aptidão NÃO guarda mais fase', !campos.some((c) => /fase/i.test(c)), campos.join(', '))
    ok('§4) e guarda a unidade operacional', campos.includes('perfilOperacionalId'))

    // ── palco: DUAS unidades de trabalho, ambas alcançadas na mesma fase ─────
    const familia = await prisma.familiaDocumental.create({
      data: { code: `${MARCA}_FAM`, name: 'Certidão de Registro Civil (ORG)' },
      select: { id: true, name: true },
    })
    const unidadeA = await prisma.perfilOperacionalDocumento.create({
      data: { code: `${MARCA}_EMISSAO`, name: 'Emissão de Certidão (ORG)', familiaDocumentalId: familia.id },
      select: { id: true, name: true },
    })
    const unidadeB = await prisma.perfilOperacionalDocumento.create({
      data: { code: `${MARCA}_TRANSCRICAO`, name: 'Transcrição Consular (ORG)', familiaDocumentalId: familia.id },
      select: { id: true, name: true },
    })
    const itemA = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_ITEM_A`, name: 'Certidão de Nascimento (ORG)', natureza: 'DOCUMENTO' }, select: { id: true } })
    const itemB = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_ITEM_B`, name: 'Transcrição (ORG)', natureza: 'DOCUMENTO' }, select: { id: true } })
    await prisma.tipoDocumentoCadastro.create({ data: { code: `${MARCA}_TIPO_A`, name: 'Certidão de Nascimento (ORG)', itemCatalogoId: itemA.id, perfilOperacionalId: unidadeA.id } })
    await prisma.tipoDocumentoCadastro.create({ data: { code: `${MARCA}_TIPO_B`, name: 'Transcrição (ORG)', itemCatalogoId: itemB.id, perfilOperacionalId: unidadeB.id } })

    const oferecidas = await unidadesOperacionais()
    ok('§4) as unidades vêm do Cadastro Mestre',
      oferecidas.some((u) => u.perfilOperacionalId === unidadeA.id), `${oferecidas.length} unidade(s)`)
    ok('§19) com a família como contexto secundário',
      oferecidas.find((u) => u.perfilOperacionalId === unidadeA.id)?.familia === familia.name)
    ok('§4) e a escrita recusa unidade inexistente',
      (await unidadeValida(999_999_999)) === false && (await unidadeValida(unidadeA.id)) === true)

    // ── §24/§11: nenhuma POSIÇÃO do processo vira competência ────────────────
    const nomes = oferecidas.map((u) => u.nome.toLowerCase())
    for (const posicao of ['finalizado', 'aguardando protocolo', 'protocolado', 'emissão documental']) {
      ok(`§24) "${posicao}" NÃO aparece como unidade de trabalho`, !nomes.includes(posicao))
    }

    const gestor = await prisma.usuario.create({
      data: { nome: 'Gestor Org', email: 'gestor@org.test', senha: 'x', tipo: 'admin', permissoesCustom: PERM_SEM_EXECUCAO },
      select: { id: true },
    })
    const criarUsuario = (nome: string, email: string, perm = PERM_EXECUTOR) =>
      prisma.usuario.create({ data: { nome, email, senha: 'x', tipo: 'assistente', permissoesCustom: perm }, select: { id: true } })
    const [apta, apta2, soEquipe, semPerm, cheia] = await Promise.all([
      criarUsuario('Apta Um', 'apta@org.test'),
      criarUsuario('Apta Dois', 'apta2@org.test'),
      criarUsuario('So Equipe', 'soequipe@org.test'),
      criarUsuario('Sem Permissao', 'semperm@org.test', PERM_SEM_EXECUCAO),
      criarUsuario('Capacidade Cheia', 'cheia@org.test'),
    ])

    const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
    const proc = await prisma.processo.create({
      data: { nome: `${MARCA} Família`, arvoreId: arv.id, workflowRuntime: 'v2' }, select: { id: true },
    })
    const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: 'Teste', sobrenome: 'Org' }, select: { id: true } })

    let seq = 0
    /** A tarefa nasce COM necessidade — é dela que a unidade se deriva. */
    const criar = async (titulo: string, itemCatalogoId: number | null, extra: { fase?: string; equipe?: string | null } = {}) => {
      let necessidadeId: number | null = null
      if (itemCatalogoId != null) {
        necessidadeId = (await prisma.necessidadeDocumental.create({
          data: { processoId: proc.id, itemCatalogoId, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-n-${seq++}` },
          select: { id: true },
        })).id
      }
      const r = await criarTarefaManual({
        titulo: `${MARCA} ${titulo}`, processoId: proc.id, autorId: gestor.id,
        motivo: 'palco da camada operacional', confirmarDuplicidade: true,
        faseMacroKey: extra.fase ?? 'emissao_documental',
        necessidadeId, pessoaId: pes.id, equipeKey: extra.equipe ?? null,
      })
      if (!r.ok) throw new Error(`criar ${titulo}: ${'mensagem' in r ? r.mensagem : '?'}`)
      return r.tarefaId
    }

    const tarefaA = await criar('trabalho da unidade A', itemA.id)
    const tarefaB = await criar('trabalho da unidade B', itemB.id)
    const semUnidade = await criar('trabalho avulso', null)

    // ════════════════════════════════════════════════════════════════════════
    secao('§14) A Tarefa RESOLVE sua unidade pela cadeia canônica')
    // ════════════════════════════════════════════════════════════════════════
    ok('§14) a Tarefa não ganhou coluna de competência',
      !Object.keys(prisma.tarefa.fields).some((f) => /competencia|perfilOperacional|aptidao/i.test(f)))
    const resolvidas = await unidadesDasTarefas([tarefaA, tarefaB, semUnidade])
    ok('§14) tarefa A resolve a unidade A', resolvidas.get(tarefaA) === unidadeA.id)
    ok('§14) tarefa B resolve a unidade B', resolvidas.get(tarefaB) === unidadeB.id)
    ok('§14) e trabalho sem causa documental não tem unidade', resolvidas.get(semUnidade) === null)

    const s0 = await simularTarefa(tarefaA)
    ok('§23) a recomendação declara a unidade da tarefa',
      s0.unidadeOperacional?.id === unidadeA.id, s0.unidadeOperacional?.nome ?? '—')
    ok('§23) com a família junto', s0.unidadeOperacional?.familia === familia.name)
    ok('§32) e a explicação fala da unidade, não da fase',
      s0.explicacao.some((l) => l.includes(unidadeA.name)) && !s0.explicacao.some((l) => /\bfase\b/i.test(l)),
      s0.explicacao[0] ?? '—')

    // ════════════════════════════════════════════════════════════════════════
    secao('§31/§16) Sem política cadastrada, a aptidão não bloqueia')
    // ════════════════════════════════════════════════════════════════════════
    ok('§31) unidade sem ninguém apto = critério não aplicável',
      criterio(s0, apta.id, 'APTIDAO')?.veredito === 'nao_aplicavel',
      criterio(s0, apta.id, 'APTIDAO')?.detalhe ?? '—')
    ok('§31) e a tarefa recebe recomendação normalmente', s0.recomendado != null, s0.recomendado?.nome ?? '—')
    ok('§12) os cinco critérios aparecem sempre', (avaliacao(s0, apta.id)?.criterios.length ?? 0) === 5)

    // ════════════════════════════════════════════════════════════════════════
    secao('§25) FASE ≠ APTIDÃO — duas unidades, a MESMA fase macro')
    // ════════════════════════════════════════════════════════════════════════
    ok('§25) as duas tarefas estão na mesma fase macro',
      (await prisma.tarefa.findMany({ where: { id: { in: [tarefaA, tarefaB] } }, select: { faseMacroKey: true } }))
        .every((t) => t.faseMacroKey === 'emissao_documental'))

    await definirAptidoes(apta.id, [unidadeA.id])
    ok('§31) declarar aptidão liga a regra DAQUELA unidade',
      (await unidadesComAptidaoDeclarada()).has(unidadeA.id))
    ok('§31) e a outra unidade continua livre',
      !(await unidadesComAptidaoDeclarada()).has(unidadeB.id))

    const sA = await simularTarefa(tarefaA)
    const sB = await simularTarefa(tarefaB)
    ok('§25) quem é apto em A passa em A', criterio(sA, apta.id, 'APTIDAO')?.veredito === 'ok')
    ok('§25) quem NÃO é apto em A é inelegível em A', avaliacao(sA, apta2.id)?.elegivel === false)
    ok('§25) e a recomendação de A é de quem é apto', sA.recomendado?.usuarioId === apta.id, sA.recomendado?.nome ?? '—')
    ok('§25) em B, a aptidão ainda não restringe ninguém',
      criterio(sB, apta2.id, 'APTIDAO')?.veredito === 'nao_aplicavel' && sB.recomendado != null,
      criterio(sB, apta2.id, 'APTIDAO')?.detalhe ?? '—')
    ok('§25) PROVA: mesma fase, elegibilidades diferentes',
      avaliacao(sA, apta2.id)?.elegivel === false && avaliacao(sB, apta2.id)?.elegivel === true)

    // ════════════════════════════════════════════════════════════════════════
    secao('§26) STEP ≠ APTIDÃO — uma aptidão cobre a unidade inteira')
    // ════════════════════════════════════════════════════════════════════════
    const quantas = await prisma.aptidaoOperacional.count({ where: { usuarioId: apta.id } })
    ok('§26) UMA aptidão declarada', quantas === 1, `${quantas}`)
    ok('§26) e ela basta para a tarefa inteira, com seus N passos',
      avaliacao(sA, apta.id)?.elegivel === true)
    ok('§26) nenhuma aptidão por passo foi criada',
      !Object.keys(prisma.aptidaoOperacional.fields).some((f) => /step|passo/i.test(f)))

    // ════════════════════════════════════════════════════════════════════════
    secao('§27) EQUIPE ≠ APTIDÃO')
    // ════════════════════════════════════════════════════════════════════════
    await prisma.grupoUsuario.create({
      data: {
        code: 'org_documental', nome: 'Emissão Documental (ORG)', ativo: true,
        membros: { create: [{ usuarioId: soEquipe.id }, { usuarioId: apta.id }] },
      },
    })
    const comEquipe = await criar('unidade A com equipe', itemA.id, { equipe: 'org_documental' })
    const se = await simularTarefa(comEquipe)
    ok('§27) quem é da equipe MAS não é apto continua inelegível',
      avaliacao(se, soEquipe.id)?.elegivel === false &&
      avaliacao(se, soEquipe.id)?.motivos.some((m) => m.codigo === 'SEM_APTIDAO') === true,
      avaliacao(se, soEquipe.id)?.motivos.map((m) => m.codigo).join(', ') || '—')
    ok('§27) passar na equipe não cria competência',
      criterio(se, soEquipe.id, 'EQUIPE')?.veredito === 'ok' &&
      criterio(se, soEquipe.id, 'APTIDAO')?.veredito === 'reprovado')
    ok('§27) quem é dos dois passa', avaliacao(se, apta.id)?.elegivel === true)

    // ════════════════════════════════════════════════════════════════════════
    secao('§28) APTIDÃO ≠ PERMISSÃO')
    // ════════════════════════════════════════════════════════════════════════
    await definirAptidoes(semPerm.id, [unidadeA.id])
    const sPerm = await simularTarefa(tarefaA)
    ok('§28) apto SEM autorização é inelegível',
      avaliacao(sPerm, semPerm.id)?.elegivel === false &&
      avaliacao(sPerm, semPerm.id)?.motivos[0]?.codigo === 'SEM_PERMISSAO_EXECUTAR')
    ok('§13) e a aptidão não concedeu autorização nenhuma',
      criterio(sPerm, semPerm.id, 'PERMISSAO')?.veredito === 'reprovado' &&
      criterio(sPerm, semPerm.id, 'APTIDAO')?.veredito === 'ok')

    // ════════════════════════════════════════════════════════════════════════
    secao('§29) DISPONIBILIDADE reprova sozinha')
    // ════════════════════════════════════════════════════════════════════════
    const ind = await abrirIndisponibilidade({
      usuarioId: apta.id, tipo: 'FERIAS', inicio: new Date(Date.now() - 86400000),
      fim: new Date(Date.now() + 7 * 86400000), motivo: 'férias programadas', autorId: gestor.id,
    })
    const sInd = await simularTarefa(tarefaA)
    ok('§29) autorizado + apto, MAS indisponível → inelegível',
      avaliacao(sInd, apta.id)?.elegivel === false &&
      criterio(sInd, apta.id, 'APTIDAO')?.veredito === 'ok' &&
      criterio(sInd, apta.id, 'DISPONIBILIDADE')?.veredito === 'reprovado')
    if (ind.ok) await encerrarIndisponibilidade(ind.id)
    ok('§29) e encerrar devolve a elegibilidade',
      avaliacao(await simularTarefa(tarefaA), apta.id)?.elegivel === true)

    // ════════════════════════════════════════════════════════════════════════
    secao('§30) CAPACIDADE reprova sozinha — e conta executáveis')
    // ════════════════════════════════════════════════════════════════════════
    await definirAptidoes(cheia.id, [unidadeA.id])
    await definirCapacidade({ usuarioId: cheia.id, limiteExecutaveis: 2, autorId: gestor.id })
    for (let i = 0; i < 2; i++) {
      const t = await criar(`carga ${i}`, itemA.id)
      await atribuirTarefa({ tarefaId: t, responsavelId: cheia.id, autorId: gestor.id })
    }
    const sCap = await simularTarefa(tarefaA)
    ok('§30) teto atingido → inelegível',
      avaliacao(sCap, cheia.id)?.elegivel === false &&
      avaliacao(sCap, cheia.id)?.motivos.some((m) => m.codigo === 'CAPACIDADE_ESGOTADA') === true,
      criterio(sCap, cheia.id, 'CAPACIDADE')?.detalhe ?? '—')
    // Espera externa NÃO ocupa lugar — a regra que já existia continua de pé.
    const esperando = await criar('espera', itemA.id)
    await atribuirTarefa({ tarefaId: esperando, responsavelId: cheia.id, autorId: gestor.id })
    await iniciarTarefa({ tarefaId: esperando, autorId: cheia.id })
    await aguardarTerceiro({ tarefaId: esperando, autorId: cheia.id, motivo: 'cartório' })
    const sEspera = await simularTarefa(tarefaA)
    ok('§30) e aguardando terceiro continua fora do teto',
      /2 de 2/.test(criterio(sEspera, cheia.id, 'CAPACIDADE')?.detalhe ?? ''),
      criterio(sEspera, cheia.id, 'CAPACIDADE')?.detalhe ?? '—')
    await definirCapacidade({ usuarioId: cheia.id, limiteExecutaveis: null, autorId: gestor.id })

    // ════════════════════════════════════════════════════════════════════════
    secao('§10/§16) Abstenção quando a política existe e ninguém passa')
    // ════════════════════════════════════════════════════════════════════════
    for (const u of [apta.id, apta2.id, soEquipe.id, semPerm.id, cheia.id]) await definirAptidoes(u, [])
    ok('§16) sem ninguém apto, a regra da unidade DESLIGA de novo',
      criterio(await simularTarefa(comEquipe), apta.id, 'APTIDAO')?.veredito === 'nao_aplicavel')
    // Agora o ÚNICO apto é quem não tem permissão: a política existe, e ninguém
    // passa. É a situação em que se abster é a resposta certa.
    await definirAptidoes(semPerm.id, [unidadeA.id])
    const sAbst = await simularTarefa(comEquipe)
    ok('§10) política de pé e ninguém elegível → abstenção', sAbst.recomendado === null,
      sAbst.abstencao?.codigo ?? 'recomendou')
    ok('§10) com a frase do enunciado', /Nenhum funcionário disponível e apto/i.test(sAbst.abstencao?.texto ?? ''))
    ok('§10) e citando a UNIDADE, não a fase',
      (sAbst.abstencao?.texto ?? '').includes(unidadeA.name),
      sAbst.abstencao?.texto?.slice(0, 110) ?? '—')

    // ════════════════════════════════════════════════════════════════════════
    secao('§33) O lote preserva carga virtual, determinismo e zero escrita')
    // ════════════════════════════════════════════════════════════════════════
    await definirAptidoes(semPerm.id, [])
    const retrato = async () => JSON.stringify(await prisma.tarefa.findMany({
      select: { id: true, responsavelId: true, statusTarefa: true, lockVersion: true }, orderBy: { id: 'asc' },
    }))
    const antes = await retrato()
    const l1 = await simularLote({ taskIds: [tarefaA, tarefaB, semUnidade] })
    const l2 = await simularLote({ taskIds: [tarefaA, tarefaB, semUnidade] })
    ok('§33) o lote responde por todas', l1.recomendacoes.length === 3)
    ok('§33) e é determinístico',
      JSON.stringify(l1.recomendacoes.map((r) => [r.taskId, r.recomendado?.usuarioId]))
      === JSON.stringify(l2.recomendacoes.map((r) => [r.taskId, r.recomendado?.usuarioId])))
    ok('§33) a carga virtual continua espalhando',
      new Set(l1.recomendacoes.map((r) => r.recomendado?.usuarioId).filter(Boolean)).size > 1,
      JSON.stringify(l1.resumo.porUsuario))
    await simularTarefa(tarefaA)
    await lerOrganizacao()
    ok('§33) e nada foi escrito', (await retrato()) === antes)

    // ════════════════════════════════════════════════════════════════════════
    secao('§36) O GUARD DA ONTOLOGIA — não voltar a alimentar aptidão com fases')
    // ════════════════════════════════════════════════════════════════════════
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const RAIZ = join(__dirname, '..')
    const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const camada = semComentarios(readFileSync(join(RAIZ, 'lib/operacional/organizacao.ts'), 'utf8'))
    const motor = semComentarios(readFileSync(join(RAIZ, 'lib/operacional/elegibilidade.ts'), 'utf8'))
    const tela = semComentarios(readFileSync(join(RAIZ, 'src/components/gerenciamentoComponents/CapacidadeOperacionalTab.tsx'), 'utf8'))
    const rota = semComentarios(readFileSync(join(RAIZ, 'src/app/api/operacao/capacidade/route.ts'), 'utf8'))

    ok('§36) a camada de aptidão não importa o catálogo de FASES',
      !/fases-catalog|\bFASES\b/.test(camada), 'aptidão vem do Cadastro Mestre')
    ok('§36) a rota de cadastro não oferece fases como aptidão',
      !/fasesDisponiveis|faseKey|phaseKey/.test(rota))
    ok('§36) a tela não consome fases para aptidão', !/fases|faseKey/i.test(tela))
    ok('§36) a aptidão é comparada por UNIDADE, não por fase',
      /aptidoes\s*\?\?\s*\[\]\)\.includes\(unidade\)/.test(motor))
    // Escopado ao MODELO: `faseKey` existe legitimamente em outros lugares do
    // schema (posição do processo é um conceito real) — o que não pode é estar
    // aqui.
    const schema = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8')
    const modeloAptidao = schema.slice(
      schema.indexOf('model AptidaoOperacional'),
      schema.indexOf('}', schema.indexOf('model AptidaoOperacional')),
    )
    ok('§36) o modelo da aptidão não tem coluna de fase',
      !/fase/i.test(modeloAptidao) && /perfilOperacionalId/.test(modeloAptidao))
    ok('§2) a camada não escreve permissão nem mexe no usuário',
      !/permissoesCustom/.test(camada) &&
      !/\b(prisma|tx)\s*\.\s*usuario\s*\.\s*(create|update|delete)/.test(camada))
    ok('§21) e não toca em Tarefa nem em passo',
      !/\b(prisma|tx)\s*\.\s*tarefa\s*\.\s*(create|update|delete)/.test(camada) &&
      !/phaseWorkflowStepInstance/.test(camada))
  } finally {
    await limpar()
    await restaurar()
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhou === 0
    ? 'Fase é onde o processo está; aptidão é o que a pessoa faz. Separados.'
    : 'A ontologia operacional divergiu do contrato.')
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

void main()
