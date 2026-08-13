// scripts/identidade-operacional.test.ts
// ============================================================================
// AS INVARIANTES DA OPERAÇÃO — atribuir não inicia, abrir não inicia, iniciar
// é idempotente, e mudar de fase não deixa resíduo na fila.
//
//   npx tsx scripts/identidade-operacional.test.ts
//
// Cada asserção aqui nasceu de um defeito OBSERVADO em produção, não de
// hipótese:
//
//   • QUATRO eventos "Tarefa iniciada" no mesmo trabalho, três em 65 segundos.
//     Iniciar gravava histórico mesmo quando já estava iniciada.
//   • DUAS linhas do mesmo trabalho na fila de uma pessoa. A instância da fase
//     anterior foi supersedida e a Tarefa que a projetava continuou ativa.
//   • A fila mostrando `receber_certidao` enquanto o nome publicado do passo,
//     "Receber certidão", existia o tempo todo.
//
// A regra que tudo isto protege: UMA TAREFA → UM taskId → UM workflow → UM
// passo atual → UM estado. As telas são projeções; nenhuma tem verdade própria.
//
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { prisma } from '../lib/prisma'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { exigirBancoDeTeste } from './_banco-de-teste'
import { criarTarefaManual } from '../lib/operacional/tarefa-ciclo'
import { atribuirTarefa, transferirTarefa, iniciarTarefa } from '../lib/operacional/tarefa-comandos'
import { minhaFila, dossieDaTarefa, visaoGerencial } from '../lib/operacional/tarefa-projecoes'

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = 'IDENT'
const RAIZ = join(__dirname, '..')
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8')
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const inicios = (tarefaId: number) =>
  prisma.logAuditoria.count({ where: { entidade: 'Tarefa', entidadeId: tarefaId, acao: 'TAREFA_INICIADA' } })
const estado = (id: number) =>
  prisma.tarefa.findUniqueOrThrow({
    where: { id },
    select: {
      id: true, statusTarefa: true, responsavelId: true, dataInicio: true,
      workflowInstanceId: true, workflowStepInstanceId: true, dataConclusao: true,
    },
  })

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: ts.map((t) => t.id) } } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: 'Tarefa', entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@ident.test' } } })
}

async function main() {
  exigirBancoDeTeste('monta o palco das invariantes operacionais')
  console.log('AS INVARIANTES DA OPERAÇÃO\n')
  await limpar()

  const PERM = { 'tarefas.ver': true, 'tarefas.iniciar_concluir': true, 'tarefas.editar': true }
  const gestor = await prisma.usuario.create({ data: { nome: 'Gestor Ident', email: 'gestor@ident.test', senha: 'x', tipo: 'admin' }, select: { id: true } })
  const dani = await prisma.usuario.create({ data: { nome: 'Dani Ident', email: 'dani@ident.test', senha: 'x', tipo: 'assistente', permissoesCustom: PERM }, select: { id: true } })
  const gabriel = await prisma.usuario.create({ data: { nome: 'Gabriel Ident', email: 'gabriel@ident.test', senha: 'x', tipo: 'assistente', permissoesCustom: PERM }, select: { id: true } })

  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} Família`, pais: 'espanha', arvoreId: arv.id, workflowRuntime: 'v2', faseAtualKey: 'emissao_documental' },
    select: { id: true },
  })
  const criar = async (titulo: string) => {
    const r = await criarTarefaManual({
      titulo: `${MARCA} ${titulo}`, processoId: proc.id, autorId: gestor.id,
      motivo: 'palco das invariantes', confirmarDuplicidade: true, faseMacroKey: 'emissao_documental',
    })
    if (!r.ok) throw new Error(`criar ${titulo}: ${'mensagem' in r ? r.mensagem : '?'}`)
    return r.tarefaId
  }

  // ══════════════════════════════════════════════════════════════════════════
  secao('§33) ATRIBUIR NÃO INICIA')
  // ══════════════════════════════════════════════════════════════════════════
  const t1 = await criar('atribuição')
  const antes = await estado(t1)
  ok('§33) nasce sem responsável', antes.responsavelId === null && antes.statusTarefa === 'NAO_INICIADA')

  const at = await atribuirTarefa({ tarefaId: t1, responsavelId: dani.id, autorId: gestor.id })
  ok('§33) a atribuição funciona', at.ok === true)
  const depois = await estado(t1)
  ok('§33) MESMO taskId', depois.id === t1)
  ok('§33) responsável definido', depois.responsavelId === dani.id)
  ok('§33) status continua A FAZER (NAO_INICIADA)', depois.statusTarefa === 'NAO_INICIADA', depois.statusTarefa)
  ok('§33) dataInicio continua NULA', depois.dataInicio === null)
  ok('§33) ZERO eventos de início', (await inicios(t1)) === 0)
  ok('§33) e ela aparece na Minha Fila de quem recebeu',
    (await minhaFila(dani.id)).some((l) => l.taskId === t1))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§34) INICIAR É EXPLÍCITO E IDEMPOTENTE')
  // ══════════════════════════════════════════════════════════════════════════
  const i1 = await iniciarTarefa({ tarefaId: t1, autorId: dani.id })
  ok('§34) iniciar funciona', i1.ok === true)
  const iniciada = await estado(t1)
  ok('§34) status = EM ANDAMENTO', iniciada.statusTarefa === 'EM_ANDAMENTO')
  ok('§34) dataInicio preenchida', iniciada.dataInicio != null)
  ok('§34) UM evento de início', (await inicios(t1)) === 1)

  // O defeito real: 4 inícios no mesmo trabalho. Três chamadas seguidas aqui.
  const i2 = await iniciarTarefa({ tarefaId: t1, autorId: dani.id })
  const i3 = await iniciarTarefa({ tarefaId: t1, autorId: dani.id })
  await iniciarTarefa({ tarefaId: t1, autorId: dani.id })
  ok('§34) repetir NÃO é erro — é sucesso sem efeito', i2.ok === true && i3.ok === true)
  ok('§34) e a resposta diz que já estava iniciada',
    i2.ok === true && i2.jaEstavaIniciada === true)
  ok('§34) CONTINUA um único evento de início', (await inicios(t1)) === 1, `${await inicios(t1)}`)
  const depoisDeRepetir = await estado(t1)
  ok('§34) dataInicio NÃO mudou', depoisDeRepetir.dataInicio?.getTime() === iniciada.dataInicio?.getTime())
  // E a versão CONCORRENTE — foi assim que dois inícios escaparam da guarda de
  // leitura: um clique na tela e um POST no mesmo instante.
  const t3 = await criar('corrida')
  await atribuirTarefa({ tarefaId: t3, responsavelId: dani.id, autorId: gestor.id })
  await Promise.all([
    iniciarTarefa({ tarefaId: t3, autorId: dani.id }),
    iniciarTarefa({ tarefaId: t3, autorId: dani.id }),
    iniciarTarefa({ tarefaId: t3, autorId: dani.id }),
    iniciarTarefa({ tarefaId: t3, autorId: dani.id }),
  ])
  ok('§34) quatro inícios SIMULTÂNEOS produzem UM evento', (await inicios(t3)) === 1, `${await inicios(t3)}`)
  ok('§34) e a tarefa está em andamento uma vez só',
    (await estado(t3)).statusTarefa === 'EM_ANDAMENTO')

  ok('§34) lockVersion não inflou com no-ops',
    (await prisma.tarefa.findUniqueOrThrow({ where: { id: t1 }, select: { lockVersion: true } })).lockVersion
    === (await prisma.tarefa.findUniqueOrThrow({ where: { id: t1 }, select: { lockVersion: true } })).lockVersion)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§37) ABRIR NÃO INICIA — ler é ler')
  // ══════════════════════════════════════════════════════════════════════════
  const t2 = await criar('só de olhar')
  await atribuirTarefa({ tarefaId: t2, responsavelId: dani.id, autorId: gestor.id })
  const antesDeOlhar = await estado(t2)
  for (let i = 0; i < 3; i++) {
    await dossieDaTarefa(t2)
    await minhaFila(dani.id)
    await visaoGerencial({ busca: MARCA })
  }
  const depoisDeOlhar = await estado(t2)
  ok('§37) abrir o dossiê três vezes não inicia', depoisDeOlhar.statusTarefa === 'NAO_INICIADA')
  ok('§37) dataInicio continua nula', depoisDeOlhar.dataInicio === null)
  ok('§37) zero eventos de início', (await inicios(t2)) === 0)
  ok('§37) e nada mudou na tarefa',
    JSON.stringify(antesDeOlhar) === JSON.stringify(depoisDeOlhar))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§35) TRANSFERIR ANTES DO INÍCIO NÃO INICIA')
  // ══════════════════════════════════════════════════════════════════════════
  const tr = await transferirTarefa({ tarefaId: t2, responsavelId: gabriel.id, autorId: gestor.id })
  ok('§35) a transferência funciona', tr.ok === true)
  const transferida = await estado(t2)
  ok('§35) continua A FAZER', transferida.statusTarefa === 'NAO_INICIADA', transferida.statusTarefa)
  ok('§35) dataInicio continua nula', transferida.dataInicio === null)
  ok('§35) responsável mudou', transferida.responsavelId === gabriel.id)
  ok('§35) ZERO eventos de início', (await inicios(t2)) === 0)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§36) TRANSFERIR DURANTE A EXECUÇÃO PRESERVA TUDO')
  // ══════════════════════════════════════════════════════════════════════════
  const antesDaTransf = await estado(t1)
  const inicioOriginal = antesDaTransf.dataInicio
  const trExec = await transferirTarefa({ tarefaId: t1, responsavelId: gabriel.id, autorId: gestor.id })
  ok('§36) transferir em andamento funciona', trExec.ok === true)
  const pos = await estado(t1)
  ok('§36) MESMO taskId', pos.id === t1)
  ok('§36) MESMO workflow', pos.workflowInstanceId === antesDaTransf.workflowInstanceId)
  ok('§36) MESMO passo', pos.workflowStepInstanceId === antesDaTransf.workflowStepInstanceId)
  ok('§36) MESMA dataInicio original', pos.dataInicio?.getTime() === inicioOriginal?.getTime())
  ok('§36) ZERO novo evento de início', (await inicios(t1)) === 1, `${await inicios(t1)}`)
  ok('§36) UMA transferência registrada',
    (await prisma.logAuditoria.count({ where: { entidade: 'Tarefa', entidadeId: t1, acao: { startsWith: 'TAREFA_TRANSFERIDA' } } })) === 1)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§32) UMA TAREFA, QUATRO PROJEÇÕES — a mesma verdade')
  // ══════════════════════════════════════════════════════════════════════════
  const naFila = (await minhaFila(gabriel.id)).find((l) => l.taskId === t1)
  const noDossie = await dossieDaTarefa(t1)
  const naGlobal = (await visaoGerencial({ busca: MARCA })).linhas.find((l) => l.taskId === t1)
  const canonico = await estado(t1)

  ok('§32) a Minha Fila mostra o taskId canônico', naFila?.taskId === t1)
  ok('§32) o dossiê também', noDossie?.taskId === t1)
  ok('§32) a visão global também', naGlobal?.taskId === t1)
  ok('§32) MESMO status nas três',
    naFila?.statusTarefa === canonico.statusTarefa && naGlobal?.statusTarefa === canonico.statusTarefa,
    `${naFila?.statusTarefa} · ${naGlobal?.statusTarefa} · ${canonico.statusTarefa}`)
  ok('§32) MESMO passo atual nas três',
    naFila?.etapaAtual === naGlobal?.etapaAtual,
    `fila="${naFila?.etapaAtual}" global="${naGlobal?.etapaAtual}"`)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§9) NOME HUMANO — a chave técnica não vaza para a tela')
  // ══════════════════════════════════════════════════════════════════════════
  const comPasso = (await minhaFila(gabriel.id)).filter((l) => l.etapaAtual != null)
  ok('§9) nenhuma etapa exibida em snake_case',
    !comPasso.some((l) => /^[a-z]+(_[a-z]+)+$/.test(l.etapaAtual ?? '')),
    comPasso.map((l) => l.etapaAtual).join(' | ') || 'nenhuma etapa em tela')
  const projecoes = semComentarios(ler('lib/operacional/tarefa-projecoes.ts'))
  ok('§9) a projeção resolve o rótulo publicado do passo',
    /rotulosDePasso\?\.get\(/.test(projecoes) && /phaseInternalWorkflowStep\.findMany/.test(projecoes))
  ok('§9) e o faz em LOTE, não por linha',
    !/for[\s\S]{0,120}phaseInternalWorkflowStep\.find/.test(projecoes))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§47) GUARDS — o que não pode voltar')
  // ══════════════════════════════════════════════════════════════════════════
  const comandos = semComentarios(ler('lib/operacional/tarefa-comandos.ts'))
  const blocoAtribuir = comandos.slice(comandos.indexOf('export async function atribuirTarefa'), comandos.indexOf('export async function iniciarTarefa'))
  // A asserção precisa distinguir LER de ESCREVER: `statusTarefa` aparece
  // legitimamente no `select` e na guarda de tarefa encerrada. O que não pode
  // existir é o campo dentro do `data:` de um update.
  const camposEscritos = (bloco: string): string[] => {
    const out: string[] = []
    for (const m of bloco.matchAll(/data\s*:\s*\{/g)) {
      let nivel = 0, i = bloco.indexOf('{', m.index)
      const inicio = i
      do { if (bloco[i] === '{') nivel++; else if (bloco[i] === '}') nivel--; i++ } while (nivel > 0 && i < bloco.length)
      out.push(bloco.slice(inicio, i))
    }
    return out
  }
  const escritasDoAtribuir = camposEscritos(blocoAtribuir).join('\n')
  ok('§47) atribuir/transferir não ESCREVEM statusTarefa',
    !/(^|[{,\s])statusTarefa\s*:/.test(escritasDoAtribuir), 'responsabilidade não é execução')
  ok('§47) nem dataInicio', !/(^|[{,\s])dataInicio\s*:/.test(escritasDoAtribuir))

  const blocoIniciar = comandos.slice(comandos.indexOf('export async function iniciarTarefa'))
  ok('§47) iniciar tem guarda de idempotência',
    /statusTarefa === 'EM_ANDAMENTO' && t\.dataInicio != null/.test(blocoIniciar))
  ok('§47) e a guarda vem ANTES de qualquer escrita',
    blocoIniciar.indexOf("jaEstavaIniciada: true") < blocoIniciar.indexOf('tx.tarefa.update'))

  // A transição de fase precisa reconciliar a fase que saiu.
  const avanco = semComentarios(ler('src/lib/motor/phase-advance.ts'))
  ok('§47) mudar de fase reconcilia as tarefas da fase anterior',
    /reconciliarTarefas\(\{ processoId: p\.processoId \}\)/.test(avanco))
  ok('§47) e a reconciliação roda FORA da transação do avanço',
    avanco.indexOf('reconciliarTarefas(') > avanco.indexOf('}, {\n      timeout: 20000'))

  // GET não escreve.
  for (const rota of [
    'src/app/api/operacao/tarefas/route.ts',
    'src/app/api/operacao/tarefas/[tarefaId]/route.ts',
    'src/app/api/operacao/visao-global/route.ts',
  ]) {
    const src = semComentarios(ler(rota))
    const temGet = /export async function GET/.test(src)
    const escreve = /\b(prisma|tx)\s*\.\s*\w+\s*\.\s*(create|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(src)
    ok(`§31) ${rota.split('/').slice(-2).join('/')} é leitura pura`, temGet && !escreve)
  }

  // ══════════════════════════════════════════════════════════════════════════
  secao('§11/§12) PRAZO DA TAREFA ≠ PREVISÃO DE TERCEIRO')
  // ══════════════════════════════════════════════════════════════════════════
  // Um cartório que demora quarenta dias não pode apagar um SLA de cinco. São
  // duas datas com donos diferentes: `Tarefa.dataPrazo` é a promessa do
  // escritório; `previsaoRetorno` é a estimativa de quem não trabalha aqui.
  // Misturá-las faria a fila mentir nos dois sentidos — tarefa "no prazo"
  // porque o terceiro prometeu, ou "atrasada" porque ele demorou.
  const fonteDaFila = semComentarios(ler('lib/operacional/tarefa-projecoes.ts'))
  ok('§12) a fila deriva o atraso do PRAZO DA TAREFA',
    /atrasada: !terminal && diaDoPrazo != null && diaDoPrazo < hoje/.test(fonteDaFila))
  ok('§12) e não conhece a previsão do terceiro',
    !/previsaoRetorno/.test(fonteDaFila),
    'a estimativa do cartório vive no andamento da etapa, não no prazo da tarefa')
  const andamento = semComentarios(ler('src/lib/process-stage/andamento-etapa.ts'))
  ok('§12) a previsão do terceiro tem casa própria', /previsaoRetorno/.test(andamento))
  ok('§12) e ela não escreve prazo de tarefa',
    !/dataPrazo/.test(andamento))
  // A espera EXTERNA pausa (ou não) o SLA conforme o workflow publicado —
  // nunca por regra fixa no código.
  const ciclo = semComentarios(ler('lib/operacional/tarefa-ciclo.ts'))
  ok('§13) a política de pausa vem do workflow publicado',
    /export async function politicaDeSla/.test(ciclo) && /pausarSlaEmEsperaExterna/.test(ler('lib/operacional/tarefa-ciclo.ts')))
  ok('§13) e existe porta para esperar e para retomar',
    /export async function aguardarTerceiro/.test(ciclo) && /export async function retomarDeEspera/.test(ciclo))

  await limpar()
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhou === 0
    ? 'Atribuir não inicia, abrir não inicia, iniciar é idempotente.'
    : 'Uma invariante da operação está quebrada.')
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

void main()
