// scripts/palco-fila-operacional.ts
// ============================================================================
// O PALCO DO ITEM 2 — uma tarefa ATRIBUÍDA e NÃO INICIADA, para olhar a tela.
//
//   npx tsx scripts/palco-fila-operacional.ts            (monta e imprime os ids)
//   npx tsx scripts/palco-fila-operacional.ts --limpar
//
// O teste automatizado prova a regra; este palco deixa a tela DE PÉ para a
// validação visual: entrar como quem executa, ver "A fazer", clicar em
// "Iniciar", ver virar "Em andamento" e só então "Continuar".
//
// Quem cria as tarefas é o RECONCILIADOR oficial — inserir tarefa à mão daria
// um palco em que o nascimento delas não foi testado, que é justamente o que se
// quer observar.
//
// Banco de TESTE, sempre. Não existe caminho daqui para produção.
// ============================================================================
import { prisma } from '../lib/prisma'
import { exigirBancoDeTeste } from './_banco-de-teste'
import { reconciliarTarefas } from '../lib/operacional/reconciliar-tarefas'
import { atribuirTarefa } from '../lib/operacional/tarefa-comandos'

const MARCA = 'PALCO-FILA'
const FASE = 'emissao_documental'
const PASSOS = [
  { key: 'solicitar_certidao', titulo: 'Solicitar certidão' },
  { key: 'aguardar_retorno_do_cartorio', titulo: 'Aguardar retorno do cartório' },
  { key: 'receber_certidao', titulo: 'Receber certidão' },
  { key: 'conferir_certidao', titulo: 'Conferir certidão' },
  { key: 'validar_certidao', titulo: 'Validar certidão' },
]

/** Quem EXECUTA: vê, inicia e conclui a própria fila. Não distribui. */
const PERMISSOES_DO_EXECUTOR = {
  'tarefas.ver': true,
  'tarefas.iniciar_concluir': true,
  'processos.ver': true,
  'documentos.ver': true,
  'documentos.editar': true,
}

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
  await prisma.documento.deleteMany({ where: { descricao: { startsWith: MARCA } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@palco-fila.test' } } })
}

async function main() {
  if (process.argv.includes('--limpar')) { await limpar(); console.log('palco removido'); return }
  exigirBancoDeTeste('monta o palco visual da Minha Fila')
  await limpar()

  const daniela = await prisma.usuario.create({
    data: {
      nome: 'Daniela Brait', email: 'daniela@palco-fila.test', senha: 'x', tipo: 'assistente',
      permissoesCustom: PERMISSOES_DO_EXECUTOR,
    },
    select: { id: true },
  })
  const gestor = await prisma.usuario.create({
    data: { nome: 'Marco Rovatti', email: 'gestor@palco-fila.test', senha: 'x', tipo: 'admin' },
    select: { id: true },
  })
  const gabriel = await prisma.usuario.create({
    data: {
      nome: 'Gabriel Souza', email: 'gabriel@palco-fila.test', senha: 'x', tipo: 'assistente',
      permissoesCustom: PERMISSOES_DO_EXECUTOR,
    },
    select: { id: true },
  })

  // O QUADRO PRECISA TER COLUNA PARA ESTE PROCESSO — mesma razão do palco de 500.
  const tipo = await prisma.tipoProcessoNacionalidade.findFirst({
    where: { ativo: true, arquivado: false }, orderBy: { id: 'asc' },
    select: { id: true, countryKey: true },
  })
  if (!tipo) {
    console.error('❌ o banco de teste não tem TipoProcessoNacionalidade ativo.')
    process.exit(1)
  }

  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: {
      nome: `${MARCA} Abellan`, pais: tipo.countryKey, tipoProcessoMotorId: tipo.id,
      arvoreId: arv.id, workflowRuntime: 'v2', faseAtualKey: FASE,
    },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: FASE, ciclo: 1, status: 'ATIVO', chaveIdempotencia: `${MARCA}-inst` },
    select: { id: true },
  })

  // TRÊS certidões — duas de pessoas HOMÔNIMAS. É o cenário em que navegar por
  // título abre o documento de outra pessoa sem ninguém perceber.
  const pessoas = [
    { nome: 'Ademir', sobrenome: 'Matheus' },
    { nome: 'Ademir', sobrenome: 'Matheus' },
    { nome: 'Tereza', sobrenome: 'Matheus' },
  ]
  const alvos: Array<{ documentoId: number; pessoaId: number; necessidadeId: number }> = []
  for (const [i, p] of pessoas.entries()) {
    const item = await prisma.itemCatalogo.create({
      data: { code: `${MARCA}_${i}`, name: 'Certidão de Nascimento - Inteiro Teor', natureza: 'DOCUMENTO' },
      select: { id: true },
    })
    const pes = await prisma.pessoa.create({
      data: { arvoreId: arv.id, nome: p.nome, sobrenome: p.sobrenome, linhaReta: true }, select: { id: true },
    })
    const nec = await prisma.necessidadeDocumental.create({
      data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-n-${i}` },
      select: { id: true },
    })
    const doc = await prisma.documento.create({
      data: { pessoaId: pes.id, descricao: `${MARCA} Certidão ${i}`, necessidadeId: nec.id }, select: { id: true },
    })
    for (const [j, def] of PASSOS.entries()) {
      await prisma.phaseWorkflowStepInstance.create({
        data: {
          workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: FASE, ciclo: 1,
          stepKey: def.key, ordem: j + 1, tipo: 'HUMANO', obrigatorio: true, geraTarefa: true,
          status: j === 0 ? 'DISPONIVEL' : 'PENDENTE',
          dependeDeStepKeys: j > 0 ? [PASSOS[j - 1].key] : [],
          necessidadeId: nec.id, documentoId: doc.id, pessoaId: pes.id,
          papel: 'equipe_documental', slaDays: 5, snapshot: { titulo: def.titulo, label: def.titulo },
          chaveIdempotencia: `${MARCA}-s-${i}-${j}`,
        },
      })
    }
    alvos.push({ documentoId: doc.id, pessoaId: pes.id, necessidadeId: nec.id })
  }

  await reconciliarTarefas({ processoId: proc.id })

  // O GESTOR ATRIBUI — e PARA. Nenhuma tarefa é iniciada aqui: é exatamente a
  // transição que a validação visual precisa ver acontecer na tela.
  const tarefas = await prisma.tarefa.findMany({
    where: { processoId: proc.id }, select: { id: true, necessidadeId: true }, orderBy: { id: 'asc' },
  })
  const alvoDaDaniela = tarefas.find((t) => t.necessidadeId === alvos[0].necessidadeId)!
  await atribuirTarefa({ tarefaId: alvoDaDaniela.id, responsavelId: daniela.id, autorId: gestor.id })
  // A segunda certidão (da homônima) também é dela — é o par que prova que
  // "Continuar" abre a certidão certa das duas.
  const alvoHomonimo = tarefas.find((t) => t.necessidadeId === alvos[1].necessidadeId)!
  await atribuirTarefa({ tarefaId: alvoHomonimo.id, responsavelId: daniela.id, autorId: gestor.id })

  // A TERCEIRA certidão fica SEM DONO de propósito: é a linha em que o gestor,
  // olhando o processo, precisa conseguir atribuir sem sair dele.
  const semDono = tarefas.find((t) => t.necessidadeId === alvos[2].necessidadeId)!

  console.log(JSON.stringify({
    processoId: proc.id,
    gabrielId: gabriel.id,
    tarefaSemDonoId: semDono.id,
    documentoSemDonoId: alvos[2].documentoId,
    danielaId: daniela.id,
    danielaEmail: 'daniela@palco-fila.test',
    gestorId: gestor.id,
    tarefaId: alvoDaDaniela.id,
    documentoId: alvos[0].documentoId,
    pessoaId: alvos[0].pessoaId,
    tarefaHomonimaId: alvoHomonimo.id,
    documentoHomonimoId: alvos[1].documentoId,
  }))
}

void main().finally(() => prisma.$disconnect())
