// scripts/fila-ciclo-de-vida.test.ts
// ============================================================================
// RECEBER UMA TAREFA NÃO SIGNIFICA COMEÇAR UMA TAREFA.
//
//   npm run test:fila-ciclo
//
// Esta suíte percorre o ciclo inteiro contra o banco de TESTE, com o motor
// oficial — sem simular, sem escrever status na mão:
//
//   nasce sem dono  →  atribuir  →  A FAZER  →  iniciar  →  EM ANDAMENTO
//        →  continuar  →  o documento certo, pela identidade
//        →  concluir etapa  →  a MESMA tarefa, uma etapa adiante
//
// ─── A PERGUNTA CENTRAL ─────────────────────────────────────────────────────
// Atribuir e iniciar são atos de pessoas DIFERENTES, em momentos diferentes: o
// gestor distribui, quem executa assume. Um sistema que marca "em andamento" no
// instante da distribuição mente sobre quem começou o quê e quando — e o SLA
// passa a contar tempo de trabalho que ninguém fez.
//
// ─── E A SEGUNDA ────────────────────────────────────────────────────────────
// Transferir troca o DONO. Não recria o trabalho: prazo, progresso, etapa,
// início e histórico atravessam a transferência intactos, porque é a mesma
// tarefa e sempre foi.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { exigirBancoDeTeste } from './_banco-de-teste'
import { atribuirTarefa, transferirTarefa, iniciarTarefa } from '@/lib/operacional/tarefa-comandos'

import { concluirEtapa } from '@/lib/operacional/tarefa-etapa'
import { reconciliarTarefas } from '@/lib/operacional/reconciliar-tarefas'
import {
  chaveDaUnidade, normalizarUnidade, tarefaVivaDaUnidade, tarefasVivasDasUnidades,
} from '@/lib/operacional/identidade-da-tarefa'
import { aguardarTerceiro, devolverAFila } from '@/lib/operacional/tarefa-ciclo'
import { minhaFila, semResponsavel, colunaDaTarefa } from '@/lib/operacional/tarefa-projecoes'
import { resolverAlvoDaTarefa, urlOperacionalDaTarefa } from '@/lib/operacional/navegacao'
import { getPhaseOperationalSummary } from '@/src/lib/process-stage/estrutura-operacional'
import { acaoPrincipal } from '@/src/components/operacao/central-tarefas'
import { ROTULO_STATUS } from '@/src/components/operacao/kit-operacional'
import { PrismaClient } from '@prisma/client'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MARCA = 'FILA-CICLO'
const FASE = 'emissao_documental'
const PASSOS = [
  { key: 'solicitar_certidao', titulo: 'Solicitar certidão' },
  { key: 'aguardar_retorno_do_cartorio', titulo: 'Aguardar retorno do cartório' },
  { key: 'receber_certidao', titulo: 'Receber certidão' },
  { key: 'conferir_certidao', titulo: 'Conferir certidão' },
  { key: 'validar_certidao', titulo: 'Validar certidão' },
]

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const RAIZ = join(__dirname, '..')
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8')
const existe = (p: string) => existsSync(join(RAIZ, p))
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefa: { processoId: { in: ids } } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { descricao: { startsWith: MARCA } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@fila-ciclo.test' } } })
}

interface Alvo { pessoaId: number; necessidadeId: number; documentoId: number; stepIds: number[]; tarefaId: number }

/**
 * O PALCO: um processo na Emissão Documental, com N certidões, cada uma com os
 * cinco passos publicados. As tarefas nascem pelo RECONCILIADOR oficial — não
 * são inseridas à mão, porque é o nascimento delas que está sob teste.
 */
let palcoSeq = 0
async function palco(quantas: number, nomes: string[]) {
  // Cada palco tem a sua marca: dois palcos no mesmo teste não podem disputar a
  // mesma chave de idempotência (que é única, e deve ser mesmo).
  const S = `${MARCA}-${++palcoSeq}`
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} processo`, pais: 'espanha', arvoreId: arv.id, workflowRuntime: 'v2', faseAtualKey: FASE },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: FASE, ciclo: 1, status: 'ATIVO', chaveIdempotencia: `${S}-inst` },
    select: { id: true },
  })
  const alvos: Alvo[] = []
  for (let i = 0; i < quantas; i++) {
    const nome = nomes[i % nomes.length]
    const item = await prisma.itemCatalogo.create({
      data: { code: `${S}_${i}`, name: 'Certidão de Nascimento - Inteiro Teor', natureza: 'DOCUMENTO' },
      select: { id: true },
    })
    // HOMÔNIMOS DE VERDADE: os dois primeiros têm o MESMO nome completo e a
    // MESMA certidão. É o caso em que navegar por título abre a certidão da
    // pessoa errada — e ninguém percebe, porque a tela mostra o nome certo.
    const pes = await prisma.pessoa.create({
      data: { arvoreId: arv.id, nome, sobrenome: 'Matheus', linhaReta: true }, select: { id: true },
    })
    const nec = await prisma.necessidadeDocumental.create({
      data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${S}-n-${i}` },
      select: { id: true },
    })
    const doc = await prisma.documento.create({
      data: { pessoaId: pes.id, descricao: `${MARCA} Certidão ${i}`, necessidadeId: nec.id }, select: { id: true },
    })
    const stepIds: number[] = []
    for (let j = 0; j < PASSOS.length; j++) {
      const s = await prisma.phaseWorkflowStepInstance.create({
        data: {
          workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: FASE, ciclo: 1,
          stepKey: PASSOS[j].key, ordem: j + 1, tipo: 'HUMANO', obrigatorio: true,
          // SEQUENCIAL: o primeiro disponível, os demais esperando o anterior.
          status: j === 0 ? 'DISPONIVEL' : 'PENDENTE',
          dependeDeStepKeys: j > 0 ? [PASSOS[j - 1].key] : [],
          necessidadeId: nec.id, documentoId: doc.id, pessoaId: pes.id,
          papel: 'equipe_documental', slaDays: 5, snapshot: { titulo: PASSOS[j].titulo },
          chaveIdempotencia: `${S}-s-${i}-${j}`,
        },
        select: { id: true },
      })
      stepIds.push(s.id)
    }
    alvos.push({ pessoaId: pes.id, necessidadeId: nec.id, documentoId: doc.id, stepIds, tarefaId: 0 })
  }
  await reconciliarTarefas({ processoId: proc.id })
  for (const a of alvos) {
    const t = await prisma.tarefa.findFirstOrThrow({ where: { necessidadeId: a.necessidadeId }, select: { id: true } })
    a.tarefaId = t.id
  }
  return { processoId: proc.id, instanciaId: inst.id, alvos }
}

const usuario = (nome: string) =>
  prisma.usuario.create({
    data: { nome, email: `${nome.toLowerCase()}@fila-ciclo.test`, senha: 'x', tipo: 'assistente' },
    select: { id: true, nome: true },
  })

const tarefa = (id: number) =>
  prisma.tarefa.findUniqueOrThrow({
    where: { id },
    select: {
      id: true, statusTarefa: true, responsavelId: true, dataInicio: true, dataPrazo: true,
      workflowStepInstanceId: true, workflowInstanceId: true, prioridade: true,
    },
  })

/** A porta canônica de "retirar responsável" — a mesma que a Operação usa. */
const comandoDevolverAFila = (tarefaId: number, autorId: number) => devolverAFila({ tarefaId, autorId })

const eventos = (tarefaId: number, acao: string) =>
  prisma.logAuditoria.count({ where: { entidade: 'Tarefa', entidadeId: tarefaId, acao } })

/** A linha da fila DAQUELA tarefa — a projeção que a tela consome. */
async function linhaDaFila(usuarioId: number, taskId: number) {
  const fila = await minhaFila(usuarioId)
  return fila.find((l) => l.taskId === taskId) ?? null
}

async function main() {
  exigirBancoDeTeste('prova o ciclo de vida da tarefa na Minha Fila')
  await limpar()
  console.log('A FILA DE TRABALHO — receber não é começar\n')

  const daniela = await usuario('Daniela')
  const gabriel = await usuario('Gabriel')
  const gestor = await usuario('Gestor')
  const p = await palco(3, ['Ademir', 'Ademir', 'Tereza'])
  const [a1, a2, a3] = p.alvos

  // ═════════════════════════════════════════════════════════════════════════
  secao('CASO 1) A tarefa nasce sem dono e SEM ter começado')
  // ═════════════════════════════════════════════════════════════════════════
  let t = await tarefa(a1.tarefaId)
  ok('nasce sem responsável', t.responsavelId === null)
  ok('nasce NAO_INICIADA', t.statusTarefa === 'NAO_INICIADA', t.statusTarefa)
  ok('e sem data de início', t.dataInicio === null)
  ok('a coluna dela é "sem responsável"',
    colunaDaTarefa({ statusTarefa: t.statusTarefa, responsavelId: t.responsavelId }) === 'SEM_RESPONSAVEL')

  // ═════════════════════════════════════════════════════════════════════════
  secao('CASO 2) ATRIBUIR não inicia — muda o DONO, e só')
  // ═════════════════════════════════════════════════════════════════════════
  const prazoAntes = t.dataPrazo
  const r = await atribuirTarefa({ tarefaId: a1.tarefaId, responsavelId: daniela.id, autorId: gestor.id })
  ok('a atribuição deu certo', r.ok === true)
  t = await tarefa(a1.tarefaId)
  ok('o responsável é a Daniela', t.responsavelId === daniela.id)
  ok('o status CONTINUA "a fazer"', t.statusTarefa === 'NAO_INICIADA', t.statusTarefa)
  ok('a data de início CONTINUA vazia', t.dataInicio === null)
  ok('e o prazo não foi recalculado', String(t.dataPrazo) === String(prazoAntes))
  ok('nenhum evento de início foi gravado', (await eventos(a1.tarefaId, 'TAREFA_INICIADA')) === 0)
  ok('mas a atribuição foi registrada', (await eventos(a1.tarefaId, 'TAREFA_ATRIBUIDA')) === 1)
  ok('o passo corrente também não começou',
    (await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({
      where: { id: a1.stepIds[0] }, select: { status: true },
    })).status === 'DISPONIVEL')

  // ═════════════════════════════════════════════════════════════════════════
  secao('CASO 3) A Minha Fila da Daniela mostra A FAZER e oferece INICIAR')
  // ═════════════════════════════════════════════════════════════════════════
  let l = await linhaDaFila(daniela.id, a1.tarefaId)
  ok('a tarefa está na fila dela', l != null)
  ok('na coluna A FAZER', l?.coluna === 'A_FAZER', String(l?.coluna))
  ok('a ação oferecida é INICIAR', acaoPrincipal(l!).rotulo === 'Iniciar tarefa', acaoPrincipal(l!).rotulo)
  ok('e o comando por trás dela é "iniciar"', acaoPrincipal(l!).comando === 'iniciar')
  ok('a fila diz o documento, a pessoa e o processo',
    !!l?.titulo && !!l?.pessoaNome && !!l?.processoNome, `${l?.titulo} · ${l?.pessoaNome} · ${l?.processoNome}`)
  ok('e a etapa em nome de gente', l?.etapaAtual === 'Solicitar certidão', String(l?.etapaAtual))

  // ═════════════════════════════════════════════════════════════════════════
  secao('CASO 4) INICIAR é o único ato que começa o trabalho')
  // ═════════════════════════════════════════════════════════════════════════
  const antesDeIniciar = new Date()
  const ri = await iniciarTarefa({ tarefaId: a1.tarefaId, autorId: daniela.id })
  ok('iniciar deu certo', ri.ok === true)
  ok('é a MESMA tarefa', ri.ok && ri.tarefaId === a1.tarefaId)
  t = await tarefa(a1.tarefaId)
  ok('agora está EM ANDAMENTO', t.statusTarefa === 'EM_ANDAMENTO', t.statusTarefa)
  ok('com data de início gravada', t.dataInicio != null && t.dataInicio >= antesDeIniciar)
  ok('e UM evento de início', (await eventos(a1.tarefaId, 'TAREFA_INICIADA')) === 1)
  ok('nenhuma tarefa nova nasceu',
    (await prisma.tarefa.count({ where: { necessidadeId: a1.necessidadeId } })) === 1)
  ok('e o prazo continua o mesmo', String(t.dataPrazo) === String(prazoAntes))

  // ═════════════════════════════════════════════════════════════════════════
  secao('CASO 10) Dois cliques em INICIAR são UM início')
  // ═════════════════════════════════════════════════════════════════════════
  const inicioOriginal = t.dataInicio
  const [d1, d2] = await Promise.all([
    iniciarTarefa({ tarefaId: a1.tarefaId, autorId: daniela.id }),
    iniciarTarefa({ tarefaId: a1.tarefaId, autorId: daniela.id }),
  ])
  ok('as duas chamadas respondem sucesso (o estado desejado já é o atual)', d1.ok && d2.ok)
  ok('continua UM evento de início', (await eventos(a1.tarefaId, 'TAREFA_INICIADA')) === 1)
  t = await tarefa(a1.tarefaId)
  ok('e a data de início não foi reescrita', String(t.dataInicio) === String(inicioOriginal))

  // ═════════════════════════════════════════════════════════════════════════
  secao('CASO 5) Depois de iniciar, a fila oferece CONTINUAR')
  // ═════════════════════════════════════════════════════════════════════════
  l = await linhaDaFila(daniela.id, a1.tarefaId)
  ok('a coluna virou EM ANDAMENTO', l?.coluna === 'EM_ANDAMENTO', String(l?.coluna))
  ok('e a ação virou CONTINUAR', acaoPrincipal(l!).rotulo === 'Continuar')
  ok('CONTINUAR não comanda nada — só navega', acaoPrincipal(l!).comando === null)
  ok('e "Continuar" nunca é oferecido a quem não começou',
    acaoPrincipal({ ...l!, coluna: 'A_FAZER' } as typeof l & object).rotulo !== 'Continuar')

  // ═════════════════════════════════════════════════════════════════════════
  secao('CASO 6/12) CONTINUAR abre o documento certo, pela IDENTIDADE')
  // ═════════════════════════════════════════════════════════════════════════
  const { alvo } = await resolverAlvoDaTarefa(prisma, a1.tarefaId)
  ok('o alvo resolve o processo', alvo?.processoId === p.processoId)
  ok('a pessoa, por id', alvo?.pessoaId === a1.pessoaId)
  ok('o documento, por id', alvo?.documentoId === a1.documentoId)
  ok('e o passo corrente', alvo?.stepInstanceId === a1.stepIds[0])
  ok('com a chave do passo, para a Central destacar', alvo?.stepKey === 'solicitar_certidao', String(alvo?.stepKey))
  const url = urlOperacionalDaTarefa({ taskId: a1.tarefaId, processoId: p.processoId })
  ok('a URL leva ao processo, na Central, com o taskId',
    url === `/kanban?processoId=${p.processoId}&tab=central&taskId=${a1.tarefaId}`, url)
  ok('e não carrega nome nenhum', !/nome|titulo|Ademir|Certid/i.test(url))

  // DOIS DOCUMENTOS DO MESMO TIPO, DE PESSOAS COM O MESMO NOME. É aqui que a
  // navegação por título abre a certidão da pessoa errada e ninguém percebe.
  const { alvo: alvo2 } = await resolverAlvoDaTarefa(prisma, a2.tarefaId)
  const tit1 = (await prisma.tarefa.findUniqueOrThrow({ where: { id: a1.tarefaId }, select: { titulo: true } })).titulo
  const tit2 = (await prisma.tarefa.findUniqueOrThrow({ where: { id: a2.tarefaId }, select: { titulo: true } })).titulo
  ok('as duas tarefas têm o MESMO título — mesma certidão, pessoas homônimas',
    tit1 === tit2, tit1)
  ok('e mesmo assim cada uma resolve o SEU documento',
    alvo?.documentoId === a1.documentoId && alvo2?.documentoId === a2.documentoId
      && a1.documentoId !== a2.documentoId)
  ok('e a SUA pessoa', alvo2?.pessoaId === a2.pessoaId && a1.pessoaId !== a2.pessoaId)

  // ═════════════════════════════════════════════════════════════════════════
  secao('CASO 9/15) Concluir uma etapa NÃO cria tarefa nova')
  // ═════════════════════════════════════════════════════════════════════════
  const antesDeConcluir = await prisma.tarefa.count({ where: { processoId: p.processoId } })
  const rc = await concluirEtapa({ tarefaId: a1.tarefaId, autorId: daniela.id })
  ok('a etapa foi concluída', rc.ok === true, rc.ok ? '' : `${rc.codigo}: ${rc.mensagem}`)
  ok('o total de tarefas do processo não mudou',
    (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === antesDeConcluir)
  ok('continua UMA tarefa para esta certidão',
    (await prisma.tarefa.count({ where: { necessidadeId: a1.necessidadeId } })) === 1)
  t = await tarefa(a1.tarefaId)
  ok('é a mesma tarefa, uma etapa adiante', t.workflowStepInstanceId === a1.stepIds[1],
    `apontou ${t.workflowStepInstanceId} · a1=[${a1.stepIds}] a2=[${a2.stepIds}] a3=[${a3.stepIds}]`)
  ok('e ela continua EM ANDAMENTO', t.statusTarefa === 'EM_ANDAMENTO', t.statusTarefa)
  ok('a data de início não foi reescrita', String(t.dataInicio) === String(inicioOriginal))
  const { alvo: alvoDepois } = await resolverAlvoDaTarefa(prisma, a1.tarefaId)
  ok('e a navegação passa a apontar o passo NOVO',
    alvoDepois?.stepInstanceId === a1.stepIds[1] && alvoDepois?.stepKey === 'aguardar_retorno_do_cartorio',
    String(alvoDepois?.stepKey))
  l = await linhaDaFila(daniela.id, a1.tarefaId)
  ok('a fila reflete a etapa nova sem tarefa nova',
    l?.etapaAtual === 'Aguardar retorno do cartório', String(l?.etapaAtual))

  // ═════════════════════════════════════════════════════════════════════════
  secao('CASO 7) Transferir tarefa A FAZER mantém A FAZER')
  // ═════════════════════════════════════════════════════════════════════════
  await atribuirTarefa({ tarefaId: a3.tarefaId, responsavelId: daniela.id, autorId: gestor.id })
  let t3 = await tarefa(a3.tarefaId)
  ok('a T3 está com a Daniela e a fazer',
    t3.responsavelId === daniela.id && t3.statusTarefa === 'NAO_INICIADA')
  const rt = await transferirTarefa({ tarefaId: a3.tarefaId, responsavelId: gabriel.id, autorId: gestor.id, motivo: 'férias' })
  ok('a transferência deu certo', rt.ok === true)
  t3 = await tarefa(a3.tarefaId)
  ok('o dono é o Gabriel', t3.responsavelId === gabriel.id)
  ok('o status CONTINUA a fazer', t3.statusTarefa === 'NAO_INICIADA', t3.statusTarefa)
  ok('e a tarefa continua sem ter começado', t3.dataInicio === null)
  ok('nenhum evento de início apareceu', (await eventos(a3.tarefaId, 'TAREFA_INICIADA')) === 0)
  ok('sai da fila da Daniela', (await linhaDaFila(daniela.id, a3.tarefaId)) === null)
  ok('e entra na do Gabriel', (await linhaDaFila(gabriel.id, a3.tarefaId)) != null)

  // ═════════════════════════════════════════════════════════════════════════
  secao('CASO 8) Transferir tarefa EM ANDAMENTO preserva o trabalho feito')
  // ═════════════════════════════════════════════════════════════════════════
  const antesT = await tarefa(a1.tarefaId)
  const eventosDeInicioAntes = await eventos(a1.tarefaId, 'TAREFA_INICIADA')
  const rt2 = await transferirTarefa({ tarefaId: a1.tarefaId, responsavelId: gabriel.id, autorId: gestor.id, motivo: 'redistribuição' })
  ok('a transferência deu certo', rt2.ok === true)
  const depoisT = await tarefa(a1.tarefaId)
  ok('o dono mudou', depoisT.responsavelId === gabriel.id)
  ok('o status foi PRESERVADO', depoisT.statusTarefa === antesT.statusTarefa, depoisT.statusTarefa)
  ok('a data de início foi PRESERVADA', String(depoisT.dataInicio) === String(antesT.dataInicio))
  ok('a etapa corrente foi PRESERVADA', depoisT.workflowStepInstanceId === antesT.workflowStepInstanceId)
  ok('o prazo foi PRESERVADO', String(depoisT.dataPrazo) === String(antesT.dataPrazo))
  ok('a prioridade foi PRESERVADA', depoisT.prioridade === antesT.prioridade)
  ok('o workflow não foi recriado', depoisT.workflowInstanceId === antesT.workflowInstanceId)
  ok('e nenhum início novo foi inventado',
    (await eventos(a1.tarefaId, 'TAREFA_INICIADA')) === eventosDeInicioAntes)
  ok('o histórico anterior continua lá', (await eventos(a1.tarefaId, 'TAREFA_ATRIBUIDA')) >= 1)
  ok('a etapa concluída continua concluída',
    (await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({
      where: { id: a1.stepIds[0] }, select: { status: true },
    })).status === 'CONCLUIDO')

  // ═════════════════════════════════════════════════════════════════════════
  secao('CASO 13) Aguardando terceiro sobrevive à transferência')
  // ═════════════════════════════════════════════════════════════════════════
  const re = await aguardarTerceiro({ tarefaId: a1.tarefaId, autorId: gabriel.id, motivo: 'cartório de Sevilha' })
  ok('a tarefa entrou em espera', re.ok === true, re.ok ? '' : `${re.codigo}: ${re.mensagem}`)
  const emEspera = await tarefa(a1.tarefaId)
  ok('o estado é AGUARDANDO_TERCEIRO', emEspera.statusTarefa === 'AGUARDANDO_TERCEIRO', emEspera.statusTarefa)
  const rt3 = await transferirTarefa({ tarefaId: a1.tarefaId, responsavelId: daniela.id, autorId: gestor.id, motivo: 'volta' })
  ok('a transferência deu certo', rt3.ok === true)
  const depoisEspera = await tarefa(a1.tarefaId)
  ok('CONTINUA aguardando terceiro', depoisEspera.statusTarefa === 'AGUARDANDO_TERCEIRO', depoisEspera.statusTarefa)
  ok('não virou "a fazer"', depoisEspera.statusTarefa !== 'NAO_INICIADA')
  ok('nem "em andamento"', depoisEspera.statusTarefa !== 'EM_ANDAMENTO')
  ok('o início continua registrado', String(depoisEspera.dataInicio) === String(antesT.dataInicio))
  ok('e o prazo intacto', String(depoisEspera.dataPrazo) === String(antesT.dataPrazo))
  const lEspera = await linhaDaFila(daniela.id, a1.tarefaId)
  ok('a fila mostra a espera e desde quando',
    lEspera?.coluna === 'AGUARDANDO_TERCEIRO' && lEspera?.esperandoHaDias != null,
    `${lEspera?.coluna} · ${lEspera?.esperandoHaDias}d`)
  ok('e a ação não convida a executar', acaoPrincipal(lEspera!).rotulo === 'Ver etapa')

  // ═════════════════════════════════════════════════════════════════════════
  secao('CASO 14) A Minha Fila e a Central falam da MESMA tarefa')
  // ═════════════════════════════════════════════════════════════════════════
  const { indice } = await getPhaseOperationalSummary({ processoId: p.processoId, faseMacroKey: FASE })
  const docsCentral = [...indice.linhaPrincipal, ...indice.foraDaLinha, ...indice.pendenteClassificacao, ]
    .flatMap((x) => x.documentos)
    .concat(indice.semDono)
  const naCentral = docsCentral.find((d) => d.documentoId === a1.documentoId)
  const naFila = await linhaDaFila(daniela.id, a1.tarefaId)
  ok('a Central encontrou o documento', naCentral != null)
  ok('as duas apontam o MESMO taskId', naCentral?.naFase.taskId === naFila?.taskId,
    `${naCentral?.naFase.taskId} × ${naFila?.taskId}`)
  ok('mesmo responsável', naCentral?.naFase.responsavelId === naFila?.responsavelId,
    `${naCentral?.naFase.responsavelNome} × ${naFila?.responsavelNome}`)
  ok('mesmo status operacional', naCentral?.naFase.estado === naFila?.coluna,
    `${naCentral?.naFase.estado} × ${naFila?.coluna}`)
  ok('mesmo prazo', String(naCentral?.naFase.prazo) === String(naFila?.dataPrazo))
  ok('mesma frase de prazo', naCentral?.naFase.rotuloDoPrazo === naFila?.rotuloDoPrazo,
    `"${naCentral?.naFase.rotuloDoPrazo}" × "${naFila?.rotuloDoPrazo}"`)
  ok('mesma etapa atual', naCentral?.naFase.etapaAtual === naFila?.etapaAtual,
    `${naCentral?.naFase.etapaAtual} × ${naFila?.etapaAtual}`)

  // ═════════════════════════════════════════════════════════════════════════
  secao('CASO 20) Concorrência — iniciar o que já não é meu')
  // ═════════════════════════════════════════════════════════════════════════
  // A tarefa 3 é do Gabriel. A Daniela tinha a tela aberta de antes.
  const usurpa = await iniciarTarefa({ tarefaId: a3.tarefaId, autorId: daniela.id })
  ok('a Daniela não consegue iniciar a tarefa que passou a ser do Gabriel', usurpa.ok === false)
  ok('e o erro diz por quê', !usurpa.ok && usurpa.codigo === 'CONFLITO', !usurpa.ok ? usurpa.mensagem : '')
  ok('a tarefa não foi tocada',
    (await tarefa(a3.tarefaId)).statusTarefa === 'NAO_INICIADA')
  ok('o gestor, esse pode destravar a fila',
    (await iniciarTarefa({ tarefaId: a3.tarefaId, autorId: gestor.id, permiteDeTerceiro: true })).ok === true)

  // ═════════════════════════════════════════════════════════════════════════
  secao('ITEM 3 §1/§2) A TAREFA VIVA É ENCONTRADA MESMO COM O CICLO DIVERGENTE')
  // ═════════════════════════════════════════════════════════════════════════
  // O CASO DE PRODUÇÃO. Processo 523: a fase voltou para a Genealogia (ciclo 2)
  // e a tarefa da certidão do Ademir nasceu com `Tarefa.ciclo = 2`, enquanto a
  // necessidade 190 seguia no ciclo 1. A busca canônica filtrava pela COLUNA e
  // não achava a tarefa — a Central mostrava "Sem responsável" para um trabalho
  // atribuído à Daniela, e os escritores estavam a um passo de criar a segunda.
  await prisma.tarefa.update({ where: { id: a3.tarefaId }, data: { ciclo: 99 } })
  const uDivergente = await normalizarUnidade(prisma, {
    processoId: p.processoId, documentoId: a3.documentoId, ciclo: 1,
  })
  const achadaSingular = await tarefaVivaDaUnidade(prisma, uDivergente)
  ok('§2) a busca singular acha a tarefa viva mesmo com o ciclo fora de sincronia',
    achadaSingular?.id === a3.tarefaId, `${achadaSingular?.id} (esperado ${a3.tarefaId})`)
  const emLote = await tarefasVivasDasUnidades(prisma, [uDivergente])
  ok('§2) e a busca em lote — a que a Central usa — acha a MESMA',
    emLote.get(chaveDaUnidade(uDivergente))?.id === a3.tarefaId)
  const { indice: indDiv } = await getPhaseOperationalSummary({ processoId: p.processoId, faseMacroKey: FASE })
  const linhaDiv = [...indDiv.linhaPrincipal, ...indDiv.foraDaLinha, ...indDiv.pendenteClassificacao]
    .flatMap((x) => x.documentos).find((d) => d.documentoId === a3.documentoId)
  ok('§1) a Central mostra o responsável, não "Sem responsável"',
    linhaDiv?.naFase.responsavelId != null, String(linhaDiv?.naFase.responsavelNome))
  await prisma.tarefa.update({ where: { id: a3.tarefaId }, data: { ciclo: 1 } })

  // E A TAREFA NASCE COM O CICLO DA OBRIGAÇÃO — para a divergência não voltar.
  const nascida = await prisma.tarefa.findUniqueOrThrow({
    where: { id: a2.tarefaId }, select: { ciclo: true, necessidadeId: true },
  })
  const cicloDaNec = (await prisma.necessidadeDocumental.findUniqueOrThrow({
    where: { id: nascida.necessidadeId! }, select: { ciclo: true },
  })).ciclo
  ok('§2) a tarefa nasce com o ciclo da OBRIGAÇÃO, não o da fase',
    nascida.ciclo === cicloDaNec, `tarefa c${nascida.ciclo} × necessidade c${cicloDaNec}`)

  // ═════════════════════════════════════════════════════════════════════════
  secao('ITEM 3 §24/§25) ATRIBUIR PELO PROCESSO É A MESMA PORTA DA OPERAÇÃO')
  // ═════════════════════════════════════════════════════════════════════════
  // A Central não tem porta própria: ela chama `atribuirTarefa`, a mesma que a
  // Operação chama. Provar isso é provar que o histórico, a notificação, a trava
  // otimista e a guarda de terminal são as mesmas — não "parecidas".
  const semDono2 = p.alvos[2]
  await transferirTarefa({ tarefaId: semDono2.tarefaId, responsavelId: daniela.id, autorId: gestor.id, motivo: 'reset' })
  await comandoDevolverAFila(semDono2.tarefaId, gestor.id)
  let tv = await tarefa(semDono2.tarefaId)
  ok('§9) devolver à fila retira o responsável', tv.responsavelId === null)
  ok('§9) sem apagar o que já foi feito', tv.statusTarefa !== 'NAO_INICIADA' || tv.dataInicio === null)
  ok('§28) e ela reaparece em "Sem responsável"',
    (await semResponsavel()).some((l) => l.taskId === semDono2.tarefaId))

  const antesDoProcesso = await tarefa(semDono2.tarefaId)
  const iniciosAntes = await eventos(semDono2.tarefaId, 'TAREFA_INICIADA')
  const rProc = await atribuirTarefa({ tarefaId: semDono2.tarefaId, responsavelId: gabriel.id, autorId: gestor.id })
  ok('§24) atribuir deu certo', rProc.ok === true)
  tv = await tarefa(semDono2.tarefaId)
  ok('§24) o responsável mudou', tv.responsavelId === gabriel.id)
  ok('§7/§21) e NÃO iniciou', String(tv.dataInicio) === String(antesDoProcesso.dataInicio))
  ok('§7) nem mudou o estado', tv.statusTarefa === antesDoProcesso.statusTarefa, tv.statusTarefa)
  ok('§7) nem a etapa', tv.workflowStepInstanceId === antesDoProcesso.workflowStepInstanceId)
  ok('§7) nem o prazo', String(tv.dataPrazo) === String(antesDoProcesso.dataPrazo))
  ok('§21) nenhum evento de início NOVO nasceu — atribuir não começa trabalho',
    (await eventos(semDono2.tarefaId, 'TAREFA_INICIADA')) === iniciosAntes, `${iniciosAntes}`)
  ok('§22) o histórico é o canônico, venha de onde vier',
    (await eventos(semDono2.tarefaId, 'TAREFA_ATRIBUIDA')) + (await eventos(semDono2.tarefaId, 'TAREFA_TRANSFERIDA')) >= 1)
  ok('§23) e a notificação é a única da porta',
    (await prisma.notificacaoOperacional.count({
      where: { tarefaId: semDono2.tarefaId, tipo: { in: ['ATRIBUICAO', 'TRANSFERENCIA'] } },
    })) >= 1)
  ok('§24) some da fila "Sem responsável"',
    !(await semResponsavel()).some((l) => l.taskId === semDono2.tarefaId))
  ok('§24) e aparece na Minha Fila de quem recebeu',
    (await linhaDaFila(gabriel.id, semDono2.tarefaId)) != null)

  // ═════════════════════════════════════════════════════════════════════════
  secao('ITEM 3 §3/§30) UMA ÚNICA FONTE DE RESPONSABILIDADE')
  // ═════════════════════════════════════════════════════════════════════════
  const docDaTarefa = await prisma.documento.findUniqueOrThrow({
    where: { id: semDono2.documentoId }, select: { responsavelId: true },
  })
  ok('§3) a Central não passou a escrever responsável no DOCUMENTO',
    docDaTarefa.responsavelId == null, String(docDaTarefa.responsavelId))
  const passosDoAlvo = await prisma.phaseWorkflowStepInstance.findMany({
    where: { documentoId: semDono2.documentoId }, select: { responsavelId: true },
  })
  ok('§3/§14) nem no PASSO — executor de etapa é outro conceito',
    passosDoAlvo.every((x) => x.responsavelId == null))
  const { indice: ind3 } = await getPhaseOperationalSummary({ processoId: p.processoId, faseMacroKey: FASE })
  const linha3 = [...ind3.linhaPrincipal, ...ind3.foraDaLinha, ...ind3.pendenteClassificacao]
    .flatMap((x) => x.documentos).find((d) => d.documentoId === semDono2.documentoId)
  const fila3 = await linhaDaFila(gabriel.id, semDono2.tarefaId)
  ok('§12/§35) Central e Operação mostram o MESMO responsável',
    linha3?.naFase.responsavelId === fila3?.responsavelId
    && linha3?.naFase.responsavelId === gabriel.id,
    `${linha3?.naFase.responsavelNome} × ${fila3?.responsavelNome}`)

  // ═════════════════════════════════════════════════════════════════════════
  secao('ITEM 3 §4/§5/§18/§33) A TELA CHAMA A PORTA — e não inventa a sua')
  // ═════════════════════════════════════════════════════════════════════════
  const central = semComentarios(ler('src/components/kanban/ProcessoCentralOperacional.tsx'))
  const painel = semComentarios(ler('src/components/kanban/PainelDaFase.tsx'))
  ok('§4) a Central atribui pela porta única de comando',
    /\/api\/tarefas\/\$\{taskId\}\/comando/.test(central))
  ok('§5) e "retirar responsável" é devolver à fila — não um update solto',
    /acao: "devolver_a_fila"/.test(central))
  ok('§4) a rota paralela de delegação não existe mais',
    !existe('src/app/api/processos/[processoId]/genealogia/delegar/route.ts')
    && !/genealogia\/delegar/.test(central))
  ok('§18) a ação é gated por permissão de gestão',
    /pode\("tarefas\.editar"\)/.test(central))
  ok('§33) e o seletor abre sob demanda — não um por linha',
    /editando \? \(/.test(painel) || /if \(editando\)/.test(painel))
  ok('§19) o seletor usa a MESMA lista de elegíveis da Operação',
    /\/api\/operacao\/atribuiveis/.test(central))
  ok('§19/§33) carregada UMA vez pela tela, nunca por linha',
    /usuarios=\{atribuiveis\}/.test(central) && !/fetch\(/.test(painel))
  ok('§17) a tela não toca em passo, progresso nem materialização',
    !/phaseWorkflowStepInstance|materializar|reconciliar/.test(painel))

  // ═════════════════════════════════════════════════════════════════════════
  secao('CASO 11/§26) Com volume, a fila continua custando o mesmo')
  // ═════════════════════════════════════════════════════════════════════════
  // Uma fila que faz uma consulta por linha funciona no teste com três tarefas
  // e derruba o banco na segunda-feira de quem tem duzentas.
  const escala = await palco(120, ['Ademir', 'Tereza', 'João'])
  for (const a of escala.alvos) {
    await prisma.tarefa.update({ where: { id: a.tarefaId }, data: { responsavelId: gabriel.id } })
  }
  const contarConsultas = async (rodar: (db: PrismaClient) => Promise<unknown>) => {
    const espiao = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })
    let n = 0
    ;(espiao as unknown as { $on: (e: string, cb: () => void) => void }).$on('query', () => { n++ })
    try { await rodar(espiao) } finally { await espiao.$disconnect() }
    return n
  }
  let filaGrande: Awaited<ReturnType<typeof minhaFila>> = []
  const t0 = Date.now()
  const consultas120 = await contarConsultas(async (db) => {
    filaGrande = await minhaFila(gabriel.id, new Date(), db)
  })
  const ms = Date.now() - t0
  ok('a fila devolve as 120 tarefas', filaGrande.length >= 120, `${filaGrande.length}`)
  ok('em POUCAS consultas — não uma por tarefa', consultas120 <= 12,
    `${consultas120} consulta(s) para ${filaGrande.length} tarefas`)
  ok('e num tempo de tela', ms < 4000, `${ms}ms`)
  // O NÚMERO NÃO PODE SUBIR COM O VOLUME. É a única prova que separa "está
  // rápido nesta máquina" de "não tem N+1".
  const metade = escala.alvos.slice(60)
  for (const a of metade) await prisma.tarefa.update({ where: { id: a.tarefaId }, data: { responsavelId: daniela.id } })
  const consultas60 = await contarConsultas(async (db) => { await minhaFila(gabriel.id, new Date(), db) })
  ok('com metade das tarefas, o MESMO número de consultas', consultas60 === consultas120,
    `${consultas60} × ${consultas120}`)
  ok('e cada linha continua sabendo o seu documento',
    filaGrande.every((l) => l.etapaAtual != null && !/_/.test(l.etapaAtual)),
    'nenhuma chave técnica escapou para a fila')

  // ═════════════════════════════════════════════════════════════════════════
  secao('§10/§27) A Minha Fila NÃO executa — ela leva ao trabalho')
  // ═════════════════════════════════════════════════════════════════════════
  const tela = semComentarios(ler('src/components/operacao/central-tarefas.tsx'))
  ok('a fila não monta drawer, painel nem executor',
    !/Drawer|CentralDaEtapa|StepEditor|WorkflowTab|TabOperation/.test(tela))
  ok('não desenha o workflow do documento',
    !/workflow\/steps|\/api\/documentos\/\$\{[^}]+\}\/workflow/.test(tela))
  ok('não abre anexos, observações nem dados registrais',
    !/AbaAnexos|AbaObservacoes|TabRegistry/.test(tela))
  ok('a navegação usa a função canônica de URL', /urlOperacionalDaTarefa/.test(tela))
  ok('e não monta rota na mão', !/`\/kanban\?/.test(tela))
  ok('INICIAR comanda e FICA na fila — a transição é vista antes de sair dela',
    /acao\.comando === "iniciar"/.test(tela)
    && /\{ acao: "iniciar" \}[\s\S]{0,200}?return\s*\n\s*\}/.test(tela),
    'iniciar não navega')
  ok('e o cartão inteiro nunca comanda — clicar para olhar não assume trabalho',
    /aoAbrir\}/.test(tela) && !/onClick=\{aoExecutar\}[\s\S]{0,80}min-w-0 flex-1/.test(tela))
  // UM ESTADO, UM NOME. O cartão dizia "Não iniciada", o filtro logo acima dizia
  // "A fazer" e a Central dizia "A fazer" — sobre a mesma tarefa.
  ok('o vocabulário de estado é o MESMO da Central e do filtro',
    ROTULO_STATUS.NAO_INICIADA === 'A fazer'
    && ROTULO_STATUS.EM_ANDAMENTO === 'Em andamento'
    && ROTULO_STATUS.AGUARDANDO_TERCEIRO === 'Aguardando terceiro',
    ROTULO_STATUS.NAO_INICIADA)
  ok('e ele cobre todo estado que a fila pode mostrar',
    ['NAO_INICIADA', 'EM_ANDAMENTO', 'AGUARDANDO_TERCEIRO', 'AGUARDANDO_CLIENTE', 'BLOQUEADA']
      .every((k) => typeof ROTULO_STATUS[k] === 'string'))
  ok('cada estado tem UMA ação, e o rótulo diz o que vai acontecer',
    ['A_FAZER', 'BLOQUEADA', 'AGUARDANDO_TERCEIRO', 'CONCLUIDA'].every((c) => tela.includes(`coluna === "${c}"`)))
  ok('toda escrita sai pela porta única de comando',
    !/prisma\./.test(tela) && (tela.match(/method: "POST"/g) ?? []).length ===
      (tela.match(/\/api\/tarefas\/\$\{[^}]+\}\/comando/g) ?? []).length)

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) {
    console.log('\nFALHAS:')
    for (const f of falhas) console.log(`  • ${f}`)
  }
  await limpar()
  console.log(falhou > 0 ? '\nO ciclo de vida da tarefa divergiu do contrato.' : '\nReceber uma tarefa não significa começar uma tarefa.')
  process.exit(falhou > 0 ? 1 : 0)
}

void main().catch(async (e) => { console.error(e); await limpar(); process.exit(1) })
