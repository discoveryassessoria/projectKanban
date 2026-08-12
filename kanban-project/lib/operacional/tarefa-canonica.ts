// lib/operacional/tarefa-canonica.ts
// ============================================================================
// A TAREFA É A UNIDADE OPERACIONAL DE TRABALHO.
//
//   UMA obrigação real  =  UMA Tarefa  =  UM workflow interno  =  N etapas
//
// ETAPA NÃO É TAREFA. "Preparar pedido", "Enviar ao cartório", "Aguardar
// cartório", "Receber", "Conferir" são passos do MESMO trabalho: solicitar a
// certidão de nascimento do Ademir. Um trabalho, uma tarefa, uma linha na fila
// de quem executa.
//
// ─── O QUE ISTO SUBSTITUI ───────────────────────────────────────────────────
// O desenho anterior era "passo humano → tarefa independente": cada etapa
// disponível gerava a sua própria Tarefa. Sete etapas seriam sete tarefas para
// a mesma certidão — sete prazos, sete responsáveis, sete notificações, e nada
// que dissesse que são o mesmo trabalho. Concluir a etapa 1 fechava "uma
// tarefa" sem que nada tivesse sido obtido.
//
// A trava contra a volta disso é estrutural, não convencional:
// `Tarefa.workflowInstanceId` é `@unique`. Uma instância de workflow pertence a
// no máximo uma tarefa; não há caminho em que passos virem tarefas.
//
// ─── QUEM DECIDE QUE UMA TAREFA NASCE ───────────────────────────────────────
// A OBRIGAÇÃO, nunca o materializador. Um `geraTarefa: false` escrito dentro de
// um materializador local é uma decisão de negócio escondida no código — foi
// exatamente ela que deixou a operação inteira do Ademir invisível para a fila,
// o prazo e as notificações, sem erro e sem aviso.
//
// ─── IDENTIDADE ─────────────────────────────────────────────────────────────
// `chaveIdempotencia` = processo + obrigação + pessoa + ciclo. Nunca o título:
// título muda, o trabalho é o mesmo. Materializar três vezes dá UMA tarefa.
// ============================================================================
import { prisma } from '@/lib/prisma'
import type { Prisma, StatusTarefa } from '@prisma/client'

/** O trabalho que a tarefa representa. Sem isto ela seria órfã. */
export interface OrigemDoTrabalho {
  processoId: number
  /** A necessidade documental que exige o trabalho. */
  necessidadeId?: number | null
  /** O documento operacional em que o trabalho se materializa. */
  documentoId?: number | null
  /** De quem é o documento. */
  pessoaId?: number | null
  /** O ciclo da fase — remateralizar a fase não reaproveita tarefa de ciclo anterior. */
  ciclo: number
}

export interface NovaTarefaOperacional extends OrigemDoTrabalho {
  titulo: string
  /** A instância de workflow que descreve COMO o trabalho é feito. */
  workflowInstanceId: number
  faseMacroKey?: string | null
  /** Fila. Quem responde pela capacidade. */
  equipeKey?: string | null
  /** Quem executa. Ausente = tarefa nasce na fila, esperando distribuição. */
  responsavelId?: number | null
  /** Dias corridos para concluir O TRABALHO — não a etapa. */
  slaDays?: number | null
  prioridade?: 'BAIXA' | 'MEDIA' | 'ALTA' | 'URGENTE'
  origem?: string | null
}

/**
 * A CHAVE DE IDENTIDADE DO TRABALHO.
 *
 * Deliberadamente sem título e sem etapa: o título é rótulo e muda; a etapa
 * corrente muda sete vezes durante a mesma tarefa. O que não muda é QUAL
 * obrigação, de QUEM, em QUAL processo, em QUAL ciclo.
 */
export function chaveDaTarefa(o: OrigemDoTrabalho): string {
  const obrigacao = o.necessidadeId != null ? `nec:${o.necessidadeId}` : `doc:${o.documentoId ?? 0}`
  return `tarefa::proc:${o.processoId}::${obrigacao}::pes:${o.pessoaId ?? 0}::ciclo:${o.ciclo}`
}

/**
 * O PRAZO É DA TAREFA — do trabalho inteiro, não de cada microetapa.
 *
 * "Obter a certidão" tem um prazo; "enviar o pedido" não é uma promessa que se
 * faça a ninguém. Sem SLA declarado o prazo fica nulo e a tarefa simplesmente
 * não entra na régua de atraso — melhor do que uma data inventada.
 */
export function calcularPrazo(slaDays: number | null | undefined, inicio: Date): Date | null {
  if (slaDays == null || !Number.isFinite(slaDays) || slaDays <= 0) return null
  const d = new Date(inicio)
  d.setDate(d.getDate() + slaDays)
  return d
}

export interface ResultadoMaterializacao {
  tarefaId: number
  criada: boolean
  motivo?: string
}

/**
 * MATERIALIZA A TAREFA DO TRABALHO — a única porta por onde uma tarefa
 * operacional nasce.
 *
 * Idempotente pela chave: chamar três vezes devolve a mesma tarefa e não cria
 * nada na segunda nem na terceira. Transacional: quem chama passa o `tx` da
 * mesma transação que criou a instância de workflow, para não existir instante
 * em que o workflow exista sem a sua tarefa.
 */
export async function materializarTarefaOperacional(
  tx: Prisma.TransactionClient,
  nova: NovaTarefaOperacional,
  agora: Date,
): Promise<ResultadoMaterializacao> {
  const chave = chaveDaTarefa(nova)

  const existente = await tx.tarefa.findUnique({ where: { chaveIdempotencia: chave }, select: { id: true } })
  if (existente) return { tarefaId: existente.id, criada: false, motivo: 'já existia' }

  // ESTA CONSULTA JÁ FOI "a instância só pode ter UMA tarefa".
  //
  // Era verdade quando cada instância correspondia a um trabalho. Não é: a
  // instância é da FASE e abriga uma tarefa por unidade de trabalho — quatro
  // certidões de uma Emissão Documental são quatro tarefas dentro dela. A
  // guarda por instância recusava a segunda tarefa dizendo que já existia uma,
  // e o segundo documento nunca chegava a ninguém.
  //
  // O que identifica a tarefa é a CHAVE (verificada acima), derivada da
  // obrigação. Duas materializações concorrentes da MESMA unidade colidem nela
  // — que é exatamente onde a colisão deve acontecer.

  const prazo = calcularPrazo(nova.slaDays, agora)

  const criada = await tx.tarefa.create({
    data: {
      titulo: nova.titulo.slice(0, 200),
      processoId: nova.processoId,
      pessoaId: nova.pessoaId ?? null,
      necessidadeId: nova.necessidadeId ?? null,
      documentoId: nova.documentoId ?? null,
      workflowInstanceId: nova.workflowInstanceId,
      faseMacroKey: nova.faseMacroKey ?? null,
      ciclo: nova.ciclo,
      equipeKey: nova.equipeKey ?? null,
      responsavelId: nova.responsavelId ?? null,
      // Nasce atribuída só quando já tem dono; senão fica na fila da equipe.
      dataAtribuicao: nova.responsavelId != null ? agora : null,
      dataPrazo: prazo,
      prioridade: nova.prioridade ?? 'MEDIA',
      statusTarefa: 'NAO_INICIADA',
      origem: nova.origem ?? 'MOTOR',
      chaveIdempotencia: chave,
    },
    select: { id: true },
  })

  await tx.logAuditoria.create({
    data: {
      acao: 'TAREFA_CRIADA',
      entidade: 'Tarefa',
      entidadeId: criada.id,
      descricao:
        `Tarefa operacional criada para o trabalho "${nova.titulo}" (processo ${nova.processoId}` +
        `${nova.pessoaId ? `, pessoa ${nova.pessoaId}` : ''}). Workflow ${nova.workflowInstanceId}.` +
        (prazo ? ` Prazo ${prazo.toISOString().slice(0, 10)} (SLA ${nova.slaDays}d).` : ' Sem SLA declarado — sem prazo.'),
      detalhes: { chave, ...nova, prazo: prazo?.toISOString() ?? null },
    },
  })

  return { tarefaId: criada.id, criada: true }
}

/**
 * O ESTADO DA TAREFA DERIVADO DAS ETAPAS.
 *
 * A tarefa não copia o estado do passo: ela responde "em que pé está o
 * trabalho". Enquanto o passo corrente é "Aguardar cartório", a tarefa está
 * AGUARDANDO_TERCEIRO — aberta, com dono, na fila de acompanhamento. Ela não
 * some, e ninguém precisa criar uma segunda tarefa para lembrar dela.
 *
 * CONCLUIR ETAPA INTERMEDIÁRIA NÃO CONCLUI A TAREFA. Só o fim do workflow
 * conclui — é a diferença entre "enviei o pedido" e "tenho a certidão".
 */
export function estadoDerivado(
  steps: Array<{ status: string; obrigatorio: boolean; ordem: number; stepKey: string }>,
  // FATO REGISTRADO GANHA DE ESTADO DERIVADO. Se uma pessoa clicou em "iniciar",
  // o trabalho começou — e nenhuma leitura das etapas pode desmentir isso.
  // Sem este parâmetro a sincronização devolvia a tarefa para NAO_INICIADA logo
  // depois de alguém tê-la iniciado, porque as etapas ainda não tinham andado.
  contexto: { iniciada?: boolean } = {},
): { status: StatusTarefa; motivo: string } {
  if (steps.length === 0) {
    return contexto.iniciada
      ? { status: 'EM_ANDAMENTO', motivo: 'sem etapas, mas iniciada por uma pessoa' }
      : { status: 'NAO_INICIADA', motivo: 'workflow sem etapas' }
  }

  const vivos = steps.filter((s) => !['CANCELADO', 'SUPERSEDIDO', 'DISPENSADO'].includes(s.status))
  const obrigatorios = vivos.filter((s) => s.obrigatorio)

  if (obrigatorios.length > 0 && obrigatorios.every((s) => s.status === 'CONCLUIDO')) {
    return { status: 'CONCLUIDO_RECEBIDO', motivo: 'todas as etapas obrigatórias concluídas' }
  }
  if (vivos.some((s) => s.status === 'BLOQUEADO')) {
    return { status: 'BLOQUEADA', motivo: 'há etapa bloqueada' }
  }
  if (vivos.some((s) => s.status === 'AGUARDANDO')) {
    return { status: 'AGUARDANDO_TERCEIRO', motivo: 'há etapa aguardando terceiro' }
  }
  if (vivos.some((s) => ['EM_ANDAMENTO', 'EXECUTADO', 'AGUARDANDO_APROVACAO'].includes(s.status))) {
    return { status: 'EM_ANDAMENTO', motivo: 'há etapa em execução' }
  }
  if (vivos.some((s) => s.status === 'CONCLUIDO')) {
    // Alguma etapa já andou: o trabalho começou, mesmo que a etapa corrente
    // esteja só disponível. Voltar para NAO_INICIADA apagaria esse fato.
    return { status: 'EM_ANDAMENTO', motivo: 'etapas já concluídas, trabalho em curso' }
  }
  if (contexto.iniciada) return { status: 'EM_ANDAMENTO', motivo: 'a tarefa foi iniciada por uma pessoa' }
  return { status: 'NAO_INICIADA', motivo: 'nenhuma etapa iniciada' }
}

/** A etapa que a tarefa mostra: a primeira viva na ordem do workflow. */
export function etapaCorrente<T extends { status: string; ordem: number; id: number }>(steps: T[]): T | null {
  const prioridade = ['EM_ANDAMENTO', 'AGUARDANDO_APROVACAO', 'EXECUTADO', 'AGUARDANDO', 'BLOQUEADO', 'DISPONIVEL', 'PENDENTE']
  for (const st of prioridade) {
    const achou = steps.filter((s) => s.status === st).sort((a, b) => a.ordem - b.ordem)[0]
    if (achou) return achou
  }
  return null
}

/** Estados em que a tarefa ainda é trabalho a fazer — o recorte das filas. */
export const STATUS_ATIVOS: StatusTarefa[] = [
  'NAO_INICIADA', 'EM_ANDAMENTO', 'AGUARDANDO_CLIENTE', 'AGUARDANDO_TERCEIRO', 'BLOQUEADA',
]

export const STATUS_TERMINAIS: StatusTarefa[] = [
  'CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI', 'CANCELADA', 'SUPERSEDIDA',
]

/**
 * SINCRONIZA a tarefa com o workflow dela: estado derivado + etapa corrente.
 *
 * Não conclui passo, não avança fase, não cria nada. Só faz a tarefa dizer a
 * verdade sobre o trabalho — e devolve se algo mudou, para quem chama decidir
 * se notifica.
 */
export async function sincronizarTarefaComWorkflow(
  tx: Prisma.TransactionClient,
  tarefaId: number,
  agora: Date,
): Promise<{ mudou: boolean; status: StatusTarefa; stepAtualId: number | null }> {
  const tarefa = await tx.tarefa.findUnique({
    where: { id: tarefaId },
    select: { id: true, workflowInstanceId: true, statusTarefa: true, workflowStepInstanceId: true, dataConclusao: true, dataInicio: true },
  })
  if (!tarefa?.workflowInstanceId) {
    return { mudou: false, status: tarefa?.statusTarefa ?? 'NAO_INICIADA', stepAtualId: null }
  }

  // ESTADO TERMINAL NÃO SE RECALCULA.
  //
  // Cancelar é decisão humana; concluir é fato. O estado derivado das etapas
  // não pode desfazer nenhum dos dois — sem esta guarda, cancelar uma tarefa e
  // rodar o reconciliador em seguida a devolvia para EM_ANDAMENTO, porque as
  // etapas continuavam disponíveis. A decisão de quem cancelou desaparecia sem
  // erro e sem aviso. Para retomar existe reabertura, que é explícita.
  if (STATUS_TERMINAIS.includes(tarefa.statusTarefa)) {
    return { mudou: false, status: tarefa.statusTarefa, stepAtualId: tarefa.workflowStepInstanceId }
  }

  const steps = await tx.phaseWorkflowStepInstance.findMany({
    where: { workflowInstanceId: tarefa.workflowInstanceId },
    select: { id: true, status: true, obrigatorio: true, ordem: true, stepKey: true },
    orderBy: { ordem: 'asc' },
  })

  const { status } = estadoDerivado(steps, { iniciada: tarefa.dataInicio != null })
  const corrente = etapaCorrente(steps)
  const mudou = status !== tarefa.statusTarefa || (corrente?.id ?? null) !== tarefa.workflowStepInstanceId
  if (!mudou) return { mudou: false, status, stepAtualId: corrente?.id ?? null }

  const concluiuAgora = STATUS_TERMINAIS.includes(status) && !STATUS_TERMINAIS.includes(tarefa.statusTarefa)
  await tx.tarefa.update({
    where: { id: tarefaId },
    data: {
      statusTarefa: status,
      workflowStepInstanceId: corrente?.id ?? null,
      concluida: status === 'CONCLUIDO_RECEBIDO' || status === 'CONCLUIDO_NAO_POSSUI',
      ...(concluiuAgora && tarefa.dataConclusao == null ? { dataConclusao: agora } : {}),
    },
  })
  return { mudou: true, status, stepAtualId: corrente?.id ?? null }
}
