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
import { chaveDaUnidade, identidadeDaUnidade, tarefaVivaDaUnidade } from '@/lib/operacional/identidade-da-tarefa'
import { prazoOperacional } from '@/lib/operacional/tempo-operacional'

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
 * ESTE ARQUIVO JÁ TEVE A SUA PRÓPRIA. Era o mesmo conceito escrito em outro
 * formato (`tarefa::proc:…` contra `unidade|proc…`), e a consequência não foi
 * estética: o reconciliador procurava no formato dele, não encontrava a tarefa
 * que a mudança de fase tinha criado no formato dela, e criava a segunda. Foram
 * duas tarefas vivas para a certidão do Ademir.
 *
 * A identidade agora mora em UM lugar (`identidade-da-tarefa`), e este módulo a
 * consome como qualquer outro escritor.
 */
export const chaveDaTarefa = chaveDaUnidade

/**
 * A TAREFA SEGUE O TRABALHO PARA A FASE NOVA.
 *
 * Mudar de fase MOVE o trabalho; não o multiplica. Quando a fase seguinte
 * materializa um passo sobre uma obrigação que JÁ tem tarefa, o certo é
 * reapontar aquela tarefa — não abrir a segunda. Foi a segunda que deixou a
 * certidão do Ademir com dois cartões vivos na fila da mesma pessoa.
 *
 * O que se preserva é tudo o que dá identidade e história: o `taskId`, o
 * responsável, o que já foi iniciado, a auditoria, os anexos. O que muda é o
 * ponteiro para o roteiro que agora vale.
 *
 * Mora aqui, e não no materializador de passo, porque escrever a âncora
 * operacional da tarefa é ato do dono da tarefa — a mesma razão pela qual
 * `iniciar`, `concluir` e `cancelar` também têm porta própria.
 */
export async function reancorarTarefaNaUnidade(
  tx: Prisma.TransactionClient,
  args: {
    tarefaId: number
    workflowInstanceId: number
    workflowStepInstanceId: number
    faseMacroKey?: string | null
    chaveIdempotencia: string
    necessidadeId?: number | null
    documentoId?: number | null
    pessoaId?: number | null
    /** Para a auditoria contar de onde a tarefa veio. */
    deInstanciaId?: number | null
    chaveAnterior?: string | null
  },
) {
  const tarefa = await tx.tarefa.update({
    where: { id: args.tarefaId },
    data: {
      workflowInstanceId: args.workflowInstanceId,
      workflowStepInstanceId: args.workflowStepInstanceId,
      faseMacroKey: args.faseMacroKey ?? null,
      chaveIdempotencia: args.chaveIdempotencia,
      // O vínculo com a obrigação é COMPLETADO, nunca apagado: a normalização
      // pode ter descoberto a necessidade que faltava, mas nada aqui desfaz um
      // vínculo que já existia.
      necessidadeId: args.necessidadeId ?? undefined,
      documentoId: args.documentoId ?? undefined,
      pessoaId: args.pessoaId ?? undefined,
      lockVersion: { increment: 1 },
    },
  })
  await tx.logAuditoria.create({
    data: {
      acao: 'TAREFA_REANCORADA',
      entidade: 'Tarefa',
      entidadeId: tarefa.id,
      descricao:
        `Tarefa "${tarefa.titulo}" seguiu o trabalho para a fase ${args.faseMacroKey ?? '—'}: ` +
        `o mesmo documento não vira uma segunda tarefa quando a fase muda.`,
      detalhes: {
        tarefaId: tarefa.id,
        stepInstanceId: args.workflowStepInstanceId,
        deInstancia: args.deInstanciaId ?? null,
        paraInstancia: args.workflowInstanceId,
        chaveAnterior: args.chaveAnterior ?? null,
        chaveAtual: args.chaveIdempotencia,
      },
    },
  })
  return tarefa
}

/**
 * O PRAZO É DA TAREFA — do trabalho inteiro, não de cada microetapa.
 *
 * "Obter a certidão" tem um prazo; "enviar o pedido" não é uma promessa que se
 * faça a ninguém.
 *
 * A CONTA MORA EM `tempo-operacional`. Esta função contava dias CORRIDOS
 * enquanto o materializador de passos contava dias ÚTEIS — a mesma certidão
 * nascia com prazos diferentes conforme quem a criasse.
 */
export const calcularPrazo = prazoOperacional

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
  const { chave, unidade } = await identidadeDaUnidade(tx, nova)

  const existente = await tx.tarefa.findUnique({ where: { chaveIdempotencia: chave }, select: { id: true } })
  if (existente) return { tarefaId: existente.id, criada: false, motivo: 'já existia' }

  // E PELA OBRIGAÇÃO, não só pela chave: a tarefa que já existe pode ter sido
  // gravada num formato anterior, ou por um escritor que conhecia a unidade
  // pelo outro lado (documento em vez de necessidade). Procurar só pela chave
  // encontraria "não existe" — e o "não existe" é que criava a segunda tarefa.
  const daUnidade = await tarefaVivaDaUnidade(tx, unidade)
  if (daUnidade) {
    await tx.tarefa.update({
      where: { id: daUnidade.id },
      data: {
        chaveIdempotencia: chave,
        necessidadeId: unidade.necessidadeId ?? undefined,
        documentoId: unidade.documentoId ?? undefined,
        pessoaId: unidade.pessoaId ?? undefined,
      },
    })
    return { tarefaId: daUnidade.id, criada: false, motivo: 'a unidade já tinha tarefa' }
  }

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

/**
 * OS PASSOS DESTA UNIDADE DE TRABALHO — não os da fase inteira.
 *
 * A instância do workflow é da FASE, e a fase abriga UMA tarefa por unidade:
 * quatro certidões de uma Emissão Documental são quatro tarefas dentro da mesma
 * instância, com os mesmos cinco `stepKey` repetidos quatro vezes.
 *
 * Ler todos os passos da instância mistura o trabalho de pessoas diferentes, e
 * o efeito não é sutil:
 *
 *   • a "etapa atual" da certidão do Ademir vira o passo aberto da certidão da
 *     Tereza — e o "Continuar" da fila abre o documento errado;
 *   • o estado derivado da tarefa dele passa a depender do que falta na dela:
 *     a tarefa só conclui quando TODAS as certidões concluírem, e fica
 *     "bloqueada" porque a certidão de outra pessoa travou;
 *   • a checagem de dependência casa `solicitar_certidao` de outro documento,
 *     e recusa ou libera a etapa por causa de trabalho alheio.
 *
 * O filtro é a OBRIGAÇÃO — a mesma coisa que dá identidade à tarefa
 * (`identidade-da-tarefa`). Um passo administrativo de fase não tem obrigação;
 * ali a unidade é o próprio passo da tarefa, e sem nem isso são os passos que
 * também não têm alvo nenhum.
 */
export function escopoDaUnidade(u: {
  workflowInstanceId: number
  necessidadeId?: number | null
  documentoId?: number | null
  workflowStepInstanceId?: number | null
}): Prisma.PhaseWorkflowStepInstanceWhereInput {
  // A UNIDADE É A CONJUNÇÃO DAS ÂNCORAS, NÃO A DISJUNÇÃO.
  //
  // Aqui havia `OR: [{ necessidadeId }, { documentoId }]`, e o efeito era mais largo
  // do que o nome prometia: dois documentos que atendem à MESMA necessidade — que é
  // exatamente o que uma nova via produz — caíam na mesma unidade. Concluir uma etapa
  // de um alcançaria as etapas do outro; reabrir uma reabriria as duas.
  //
  // Numa Emissão com cinquenta certidões, a diferença deixa de ser sutil: a unidade
  // precisa ser UMA certidão, e nada além dela. Duas etapas pertencem à mesma unidade
  // quando concordam em TODAS as âncoras — a necessidade E o documento.
  //
  // Sem âncora nenhuma (cardinalidade PROCESSO), a unidade é a fase inteira, e o
  // filtro por nulos é o que a delimita: passos de processo não se misturam com
  // passos de documento.
  const conjuncao: Prisma.PhaseWorkflowStepInstanceWhereInput[] = []
  if (u.necessidadeId != null) conjuncao.push({ necessidadeId: u.necessidadeId })
  if (u.documentoId != null) conjuncao.push({ documentoId: u.documentoId })
  return {
    workflowInstanceId: u.workflowInstanceId,
    ...(conjuncao.length > 0
      ? { AND: conjuncao }
      : u.workflowStepInstanceId != null
        ? { id: u.workflowStepInstanceId }
        : { necessidadeId: null, documentoId: null }),
  }
}

/** A unidade a que um PASSO pertence — lida do próprio passo, nunca inferida. */
export function unidadeDoPasso(p: {
  workflowInstanceId: number | null
  necessidadeId?: number | null
  documentoId?: number | null
  id?: number
}): { workflowInstanceId: number; necessidadeId: number | null; documentoId: number | null; workflowStepInstanceId: number | null } | null {
  if (p.workflowInstanceId == null) return null
  return {
    workflowInstanceId: p.workflowInstanceId,
    necessidadeId: p.necessidadeId ?? null,
    documentoId: p.documentoId ?? null,
    workflowStepInstanceId: p.id ?? null,
  }
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
    select: {
      id: true, workflowInstanceId: true, statusTarefa: true, workflowStepInstanceId: true,
      dataConclusao: true, dataInicio: true, necessidadeId: true, documentoId: true,
    },
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

  // OS PASSOS DA UNIDADE — não os da instância inteira. A regra mora em
  // `escopoDaUnidade`, e é a MESMA que a conclusão de etapa e o motor usam.
  const steps = await tx.phaseWorkflowStepInstance.findMany({
    where: escopoDaUnidade({
      workflowInstanceId: tarefa.workflowInstanceId,
      necessidadeId: tarefa.necessidadeId,
      documentoId: tarefa.documentoId,
      workflowStepInstanceId: tarefa.workflowStepInstanceId,
    }),
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
