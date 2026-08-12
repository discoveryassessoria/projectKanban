// scripts/palco-gerencial.ts
// ============================================================================
// O PALCO DA VISÃO GERENCIAL — uma tarefa em CADA estado que o gestor precisa
// enxergar, e todas produzidas do jeito que o motor produz.
//
//   npx tsx scripts/palco-gerencial.ts
//
// §23 pede oito situações: sem responsável, a fazer, em andamento, aguardando
// terceiro, bloqueada, concluída, atrasada e vencendo hoje. As duas últimas não
// são estados — são condições de prazo que convivem com qualquer estado, e o
// palco as monta assim de propósito: a atrasada está EM ANDAMENTO e atrasada, e
// a que vence hoje está A FAZER e vencendo hoje. Se fossem colunas próprias, o
// teste passaria provando a coisa errada.
//
// Cada tarefa chega ao seu estado pelas PORTAS canônicas. Montar o palco com
// `prisma.tarefa.update({ statusTarefa })` provaria a tela sobre dados que o
// motor jamais geraria — e é exatamente o defeito que a tela deve denunciar.
//
// Deixa os dados de pé para o E2E. Só roda no banco de TESTE.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { exigirBancoDeTeste } from './_banco-de-teste'
import { reconciliarTarefas } from '@/lib/operacional/reconciliar-tarefas'
import { atribuirTarefa, iniciarTarefa } from '@/lib/operacional/tarefa-comandos'
import { aguardarTerceiro, bloquearTarefa } from '@/lib/operacional/tarefa-ciclo'

const MARCA = 'GERENCIAL'

/** dias relativos a hoje; `0` é hoje, negativo é passado. */
type Cena = {
  chave: string
  familia: string
  pessoa: [string, string]
  item: string
  fase: string
  dias: number | null
  prio: 'URGENTE' | 'ALTA' | 'MEDIA' | 'BAIXA'
  estado: 'sem_responsavel' | 'a_fazer' | 'em_andamento' | 'aguardando' | 'bloqueada' | 'concluida'
}

const CENAS: Cena[] = [
  { chave: 'sem-dono',    familia: 'Família Rovatti', pessoa: ['João', 'da Silva'],    item: 'Certidão de Nascimento', fase: 'emissao_documental', dias: 9,    prio: 'MEDIA',   estado: 'sem_responsavel' },
  { chave: 'a-fazer',     familia: 'Família Brait',   pessoa: ['Maria', 'Ferreira'],   item: 'Certidão de Casamento',  fase: 'emissao_documental', dias: 15,   prio: 'ALTA',    estado: 'a_fazer' },
  { chave: 'andamento',   familia: 'Família Gerbi',   pessoa: ['Antônio', 'Rovatti'],  item: 'Certidão de Óbito',      fase: 'emissao_documental', dias: 20,   prio: 'MEDIA',   estado: 'em_andamento' },
  { chave: 'aguardando',  familia: 'Família Souza',   pessoa: ['Carolina', 'Menezes'], item: 'Certidão de Nascimento', fase: 'emissao_documental', dias: 30,   prio: 'BAIXA',   estado: 'aguardando' },
  { chave: 'bloqueada',   familia: 'Família Almeida', pessoa: ['Eduardo', 'Almeida'],  item: 'Inteiro Teor',           fase: 'analise_preliminar', dias: 12,   prio: 'ALTA',    estado: 'bloqueada' },
  { chave: 'concluida',   familia: 'Família Pereira', pessoa: ['Beatriz', 'Pereira'],  item: 'Certidão de Casamento',  fase: 'emissao_documental', dias: 40,   prio: 'BAIXA',   estado: 'concluida' },
  // ATRASADA é condição, não estado: esta está EM ANDAMENTO **e** atrasada.
  { chave: 'atrasada',    familia: 'Família Lima',    pessoa: ['Rafael', 'Lima'],      item: 'Certidão de Nascimento', fase: 'emissao_documental', dias: -6,   prio: 'URGENTE', estado: 'em_andamento' },
  // VENCE HOJE também é condição: esta está A FAZER **e** vencendo hoje.
  { chave: 'vence-hoje',  familia: 'Família Castro',  pessoa: ['Helena', 'Castro'],    item: 'Certidão de Casamento',  fase: 'emissao_documental', dias: 0,    prio: 'ALTA',    estado: 'a_fazer' },
]

const ETAPAS: Array<[string, string]> = [
  ['solicitar_certidao', 'Solicitar certidão'],
  ['aguardar_retorno_do_cartorio', 'Aguardar retorno do cartório'],
  ['receber_certidao', 'Receber certidão'],
  ['conferir_certidao', 'Conferir certidão'],
  ['validar_certidao', 'Validar certidão'],
]

const PERMISSOES_EXECUTOR = {
  'arvore.ver': true, 'clientes.ver': true, 'eventos.ver': true,
  'processos.ver': true, 'processos.editar': true, 'processos.ver_paginas': true, 'processos.editar_paginas': true,
  'arvore.criar_documento': true, 'arvore.editar_documento': true,
  'tarefas.ver': true, 'tarefas.criar': true, 'tarefas.editar': false, 'tarefas.iniciar_concluir': true,
  'tarefas.bloquear': true,
  'workflow.iniciarPasso': true, 'workflow.concluirPasso': true, 'workflow.gerarTarefa': true,
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
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })

  // A CAMADA OPERACIONAL DOS USUÁRIOS DO PALCO também é palco.
  //
  // Os E2E de configuração declaram aptidão, marcam férias e definem teto. Sem
  // desfazer, cada execução empilha registros e a tela do teste seguinte já
  // nasce suja — e, pior, a recomendação passa a depender do que ficou de ontem.
  const doPalco = await prisma.usuario.findMany({
    where: { email: { in: ['gestor@gerencial.test', 'daniela@gerencial.test'] } },
    select: { id: true },
  })
  const idsDoPalco = doPalco.map((u) => u.id)
  if (idsDoPalco.length) {
    await prisma.aptidaoOperacional.deleteMany({ where: { usuarioId: { in: idsDoPalco } } })
    await prisma.indisponibilidadeOperacional.deleteMany({ where: { usuarioId: { in: idsDoPalco } } })
    await prisma.capacidadeOperacional.deleteMany({ where: { usuarioId: { in: idsDoPalco } } })
    await prisma.logAuditoria.deleteMany({ where: { entidade: 'CapacidadeOperacional', entidadeId: { in: idsDoPalco } } })
  }
  await prisma.grupoUsuario.deleteMany({ where: { nome: { startsWith: 'E2E ' } } })
}

async function main() {
  exigirBancoDeTeste('monta o palco da visão gerencial global')
  await limpar()

  const gestor = await prisma.usuario.upsert({
    where: { email: 'gestor@gerencial.test' },
    create: { nome: 'Marco Rovatti', email: 'gestor@gerencial.test', senha: 'x', tipo: 'admin' },
    update: {}, select: { id: true },
  })
  const dani = await prisma.usuario.upsert({
    where: { email: 'daniela@gerencial.test' },
    create: { nome: 'Daniela Brait', email: 'daniela@gerencial.test', senha: 'x', tipo: 'assistente', permissoesCustom: PERMISSOES_EXECUTOR },
    update: { permissoesCustom: PERMISSOES_EXECUTOR }, select: { id: true },
  })

  const criadas: Record<string, number> = {}

  for (const [i, c] of CENAS.entries()) {
    const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${i}`, name: c.item, natureza: 'DOCUMENTO' }, select: { id: true } })
    const arv = await prisma.arvore.create({ data: { nome: `${MARCA} ${i}` }, select: { id: true } })
    const proc = await prisma.processo.create({
      data: { nome: `${MARCA} ${c.familia}`, pais: 'espanha', arvoreId: arv.id, workflowRuntime: 'v2', faseAtualKey: c.fase },
      select: { id: true },
    })
    const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: c.pessoa[0], sobrenome: c.pessoa[1] }, select: { id: true } })
    const doc = await prisma.documento.create({ data: { pessoaId: pes.id, descricao: c.item, status: 'SOLICITAR' }, select: { id: true } })
    const nec = await prisma.necessidadeDocumental.create({
      data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-n-${i}` },
      select: { id: true },
    })
    const inst = await prisma.phaseWorkflowInstance.create({
      data: { processoId: proc.id, faseMacroKey: c.fase, ciclo: 1, status: 'ATIVO', chaveIdempotencia: `${MARCA}-i-${i}` },
      select: { id: true },
    })
    for (const [j, [chave, label]] of ETAPAS.entries()) {
      await prisma.phaseWorkflowStepInstance.create({
        data: {
          workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: c.fase, stepKey: chave,
          ordem: j + 1, tipo: 'HUMANO', obrigatorio: true, status: j === 0 ? 'DISPONIVEL' : 'PENDENTE',
          necessidadeId: nec.id, documentoId: doc.id, pessoaId: pes.id, papel: 'equipe_documental', slaDays: 5, ciclo: 1,
          snapshot: { label, titulo: `${c.item} — ${c.pessoa[0]} ${c.pessoa[1]}` } as never,
          chaveIdempotencia: `${MARCA}-s-${i}-${j}`,
        },
      })
    }
    await reconciliarTarefas({ processoId: proc.id })
    const t = await prisma.tarefa.findFirstOrThrow({ where: { processoId: proc.id }, select: { id: true } })
    // Prioridade e prazo são atributos da tarefa, não estado: definir aqui não
    // atalha máquina de estados nenhuma. Quem muda ESTADO abaixo são as portas.
    await prisma.tarefa.update({
      where: { id: t.id },
      data: { prioridade: c.prio, dataPrazo: c.dias == null ? null : new Date(Date.now() + c.dias * 86400000) },
    })
    criadas[c.chave] = t.id

    if (c.estado === 'sem_responsavel') continue
    const a = await atribuirTarefa({ tarefaId: t.id, responsavelId: dani.id, autorId: gestor.id })
    if (!a.ok) throw new Error(`atribuir ${c.chave}: ${'error' in a ? a.error : '?'}`)
    if (c.estado === 'a_fazer') continue

    const ini = await iniciarTarefa({ tarefaId: t.id, autorId: dani.id })
    if (!ini.ok) throw new Error(`iniciar ${c.chave}: ${'error' in ini ? ini.error : '?'}`)
    if (c.estado === 'em_andamento') continue

    if (c.estado === 'aguardando') {
      const r = await aguardarTerceiro({ tarefaId: t.id, autorId: dani.id, motivo: 'Cartório informou fila de 20 dias para a busca.' })
      if (!r.ok) throw new Error(`aguardar ${c.chave}: ${'error' in r ? r.error : '?'}`)
      continue
    }
    if (c.estado === 'bloqueada') {
      const r = await bloquearTarefa({ tarefaId: t.id, autorId: gestor.id, motivo: 'Falta a procuração assinada pelo requerente.' })
      if (!r.ok) throw new Error(`bloquear ${c.chave}: ${'error' in r ? r.error : '?'}`)
      continue
    }
    if (c.estado === 'concluida') {
      // CONCLUIR É PELO ÚLTIMO PASSO, e pelo MESMO caminho que a tela usa —
      // `atualizarPassoV2`, que é onde o clique do executor entra. Concluir os
      // passos por baixo (direto na máquina de passo) deixava a Tarefa em
      // andamento com cinco etapas concluídas: o palco produziria um estado que
      // o produto nunca gera, e o teste passaria provando ficção.
      const { atualizarPassoV2 } = await import('@/src/services/documento-operacao')
      const passos = await prisma.phaseWorkflowStepInstance.findMany({
        where: { workflowInstanceId: inst.id }, orderBy: { ordem: 'asc' }, select: { id: true },
      })
      for (const p of passos) {
        const r = await atualizarPassoV2(doc.id, p.id, { status: 'concluida' })
        if (!r.ok) throw new Error(`concluir passo ${p.id}: ${'error' in r ? r.error : '?'}`)
      }
      continue
    }
  }

  const g = await prisma.usuario.findUniqueOrThrow({
    where: { email: 'gestor@gerencial.test' }, select: { id: true, nome: true, email: true, tipo: true },
  })
  const d = await prisma.usuario.findUniqueOrThrow({
    where: { email: 'daniela@gerencial.test' }, select: { id: true, nome: true, email: true, tipo: true },
  })
  console.log(JSON.stringify({ gestor: g, dani: d, tarefas: criadas }))
  await prisma.$disconnect()
}

void main()
