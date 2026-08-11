// lib/operacional/tarefa-ciclo.ts
// ============================================================================
// O CICLO DE VIDA DA TAREFA — criar à mão, reabrir, bloquear, devolver à fila,
// mudar prazo e prioridade.
//
// Todas as portas partilham três regras que o motor não abre exceção:
//
//   · NENHUMA delas cria uma segunda tarefa para o mesmo trabalho;
//   · NENHUMA apaga histórico;
//   · TODAS auditam quem fez, quando, de quê para quê e por quê.
//
// ─── MANUAL ≠ REABERTURA ────────────────────────────────────────────────────
// A distinção mais importante deste arquivo. "O mesmo trabalho precisa ser
// refeito" é REABRIR — a tarefa volta, com o mesmo id, o mesmo workflow e o
// histórico do que já foi feito. "Apareceu trabalho novo" é CRIAR — obrigação
// diferente, identidade própria, prazo próprio.
//
// Trocar um pelo outro corrompe as duas leituras: reabrir para trabalho novo
// esconde uma obrigação dentro de outra; criar nova para retrabalho faz o
// sistema afirmar que o serviço foi feito duas vezes quando foi refeito uma.
// ============================================================================
import { prisma } from '@/lib/prisma'
import type { Prisma, StatusTarefa } from '@prisma/client'
import { STATUS_TERMINAIS, calcularPrazo, etapaCorrente } from './tarefa-canonica'

export type Falha =
  | 'NAO_ENCONTRADA' | 'TERMINAL' | 'NAO_TERMINAL' | 'CONFLITO' | 'SEM_MOTIVO' | 'INVALIDO'

export type Resultado<T = { tarefaId: number }> =
  | ({ ok: true } & T)
  | { ok: false; codigo: Falha; mensagem: string }

const auditar = (
  tx: Prisma.TransactionClient,
  acao: string, tarefaId: number, autorId: number | null,
  descricao: string, detalhes: Prisma.InputJsonValue,
) =>
  tx.logAuditoria.create({
    data: { acao, entidade: 'Tarefa', entidadeId: tarefaId, usuarioId: autorId ?? undefined, descricao, detalhes },
  })

// ═══════════════════════════════════════════════════════════════════════════
// TAREFA MANUAL
// ═══════════════════════════════════════════════════════════════════════════

export interface NovaTarefaManual {
  processoId: number
  titulo: string
  autorId: number
  faseMacroKey?: string | null
  pessoaId?: number | null
  documentoId?: number | null
  necessidadeId?: number | null
  equipeKey?: string | null
  responsavelId?: number | null
  prioridade?: 'BAIXA' | 'MEDIA' | 'ALTA' | 'URGENTE'
  slaDays?: number | null
  dataPrazo?: Date | null
  motivo: string
  /** O usuário viu o aviso de possível duplicidade e confirmou mesmo assim. */
  confirmarDuplicidade?: boolean
}

export interface Semelhante { tarefaId: number; titulo: string; statusTarefa: StatusTarefa }

/**
 * TAREFAS ABERTAS QUE PODEM SER O MESMO TRABALHO.
 *
 * Compara por IDs canônicos — processo, pessoa, documento, necessidade —, nunca
 * por semelhança de texto: dois títulos parecidos podem ser trabalhos
 * diferentes, e dois títulos diferentes podem ser o mesmo trabalho.
 *
 * O resultado AVISA, não bloqueia. Duas tarefas parecidas às vezes são
 * legítimas (duas certidões da mesma pessoa em cartórios diferentes), e um
 * bloqueio aqui obrigaria o operador a mentir no título para conseguir
 * cadastrar o que ele sabe ser necessário.
 */
export async function tarefasSemelhantesAbertas(n: {
  processoId: number; pessoaId?: number | null; documentoId?: number | null; necessidadeId?: number | null
}): Promise<Semelhante[]> {
  // A COINCIDÊNCIA TEM DE SER DA OBRIGAÇÃO — necessidade ou documento. Pessoa
  // sozinha é sinal fraco demais: a mesma pessoa tem legitimamente a certidão
  // de nascimento, a de casamento e a de óbito abertas ao mesmo tempo. Avisar
  // em todas faria o operador confirmar por reflexo, e o aviso deixaria de
  // significar qualquer coisa justamente quando fosse verdadeiro.
  const alvos: Prisma.TarefaWhereInput[] = []
  if (n.necessidadeId != null) alvos.push({ necessidadeId: n.necessidadeId })
  if (n.documentoId != null) alvos.push({ documentoId: n.documentoId })
  if (alvos.length === 0) return []

  const achadas = await prisma.tarefa.findMany({
    where: { processoId: n.processoId, statusTarefa: { notIn: STATUS_TERMINAIS }, OR: alvos },
    select: { id: true, titulo: true, statusTarefa: true },
  })
  return achadas.map((t) => ({ tarefaId: t.id, titulo: t.titulo, statusTarefa: t.statusTarefa }))
}

/**
 * CRIA UMA TAREFA MANUAL — trabalho que o cadastro não previu.
 *
 * Ela nasce com `origem: MANUAL` e identidade própria, o que a protege do
 * reconciliador: nenhuma varredura vai "descobrir" que ela não tem obrigação
 * automática por trás e cancelá-la. Foi uma pessoa que decidiu que o trabalho
 * existe, e é uma pessoa que decide quando ele deixa de existir.
 */
export async function criarTarefaManual(
  nova: NovaTarefaManual,
): Promise<Resultado<{ tarefaId: number; semelhantes: Semelhante[] }>> {
  if (!nova.titulo?.trim()) return { ok: false, codigo: 'INVALIDO', mensagem: 'Informe o título da tarefa.' }
  if (!nova.motivo?.trim()) return { ok: false, codigo: 'SEM_MOTIVO', mensagem: 'Informe por que esta tarefa é necessária.' }

  const semelhantes = await tarefasSemelhantesAbertas(nova)
  if (semelhantes.length > 0 && !nova.confirmarDuplicidade) {
    return {
      ok: false, codigo: 'CONFLITO',
      mensagem:
        `Já existe trabalho aberto para este contexto (${semelhantes.map((s) => `#${s.tarefaId}`).join(', ')}). ` +
        `Se for o MESMO trabalho, reabra a tarefa existente; se for trabalho novo, confirme para criar.`,
    }
  }

  const agora = new Date()
  const prazo = nova.dataPrazo ?? calcularPrazo(nova.slaDays, agora)

  const criada = await prisma.$transaction(async (tx) => {
    const t = await tx.tarefa.create({
      data: {
        titulo: nova.titulo.trim().slice(0, 200),
        processoId: nova.processoId,
        pessoaId: nova.pessoaId ?? null,
        documentoId: nova.documentoId ?? null,
        necessidadeId: nova.necessidadeId ?? null,
        faseMacroKey: nova.faseMacroKey ?? null,
        equipeKey: nova.equipeKey ?? null,
        responsavelId: nova.responsavelId ?? null,
        dataAtribuicao: nova.responsavelId != null ? agora : null,
        atribuidoPorId: nova.responsavelId != null ? nova.autorId : null,
        dataPrazo: prazo,
        prioridade: nova.prioridade ?? 'MEDIA',
        statusTarefa: 'NAO_INICIADA',
        origem: 'MANUAL',
        justificativa: nova.motivo,
        // Sem workflow: trabalho que ninguém modelou ainda não tem etapas. A
        // tarefa existe assim mesmo — é melhor uma linha na fila sem roteiro do
        // que trabalho real invisível esperando alguém publicar um workflow.
      },
      select: { id: true },
    })
    await auditar(tx, 'TAREFA_CRIADA_MANUAL', t.id, nova.autorId,
      `Tarefa manual "${nova.titulo}" criada no processo ${nova.processoId}. Motivo: ${nova.motivo}`,
      JSON.parse(JSON.stringify({ ...nova, semelhantes, confirmouDuplicidade: !!nova.confirmarDuplicidade })))
    return t
  })

  return { ok: true, tarefaId: criada.id, semelhantes }
}

// ═══════════════════════════════════════════════════════════════════════════
// REABERTURA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * REABRE A MESMA TAREFA — retrabalho, não trabalho novo.
 *
 * Mantém o `taskId`, o workflow e tudo o que já foi feito. O que muda é o
 * estado e, opcionalmente, a etapa para onde o trabalho volta: refazer a
 * conferência não significa refazer o pedido ao cartório.
 *
 * Motivo é obrigatório. Uma tarefa que sai de concluída sem explicação
 * transforma o histórico em algo que ninguém consegue auditar depois.
 */
export async function reabrirTarefa(args: {
  tarefaId: number
  autorId: number
  motivo: string
  /** Etapa para onde o trabalho volta. Ausente = todas as obrigatórias voltam. */
  stepDestinoId?: number | null
}): Promise<Resultado> {
  if (!args.motivo?.trim()) {
    return { ok: false, codigo: 'SEM_MOTIVO', mensagem: 'Informe o motivo da reabertura.' }
  }
  return prisma.$transaction(async (tx) => {
    const t = await tx.tarefa.findUnique({
      where: { id: args.tarefaId },
      select: { id: true, titulo: true, statusTarefa: true, workflowInstanceId: true, dataConclusao: true },
    })
    if (!t) return { ok: false as const, codigo: 'NAO_ENCONTRADA' as const, mensagem: 'Tarefa não existe.' }
    if (!STATUS_TERMINAIS.includes(t.statusTarefa)) {
      return { ok: false as const, codigo: 'NAO_TERMINAL' as const, mensagem: 'A tarefa não está encerrada — não há o que reabrir.' }
    }

    // As etapas voltam a ficar disponíveis. Não são recriadas: são as MESMAS,
    // com o histórico de quando foram concluídas da primeira vez.
    let etapasReabertas = 0
    let etapaAtual: number | null = null
    if (t.workflowInstanceId) {
      const alvo = args.stepDestinoId
        ? { id: args.stepDestinoId }
        : { workflowInstanceId: t.workflowInstanceId, status: 'CONCLUIDO' as const, obrigatorio: true }
      const r = await tx.phaseWorkflowStepInstance.updateMany({ where: alvo, data: { status: 'DISPONIVEL', completedAt: null } })
      etapasReabertas = r.count

      // A ETAPA CORRENTE VOLTA JUNTO. Sem isto a tarefa reaberta ficava
      // apontando para etapa nenhuma: a fila mostrava o trabalho reaberto sem
      // dizer por onde retomá-lo, e o dossiê não sabia responder "em que pé
      // está".
      const steps = await tx.phaseWorkflowStepInstance.findMany({
        where: { workflowInstanceId: t.workflowInstanceId },
        select: { id: true, status: true, ordem: true },
        orderBy: { ordem: 'asc' },
      })
      etapaAtual = etapaCorrente(steps)?.id ?? null
    }

    await tx.tarefa.update({
      where: { id: t.id },
      data: {
        statusTarefa: 'EM_ANDAMENTO',
        concluida: false,
        dataConclusao: null,
        workflowStepInstanceId: etapaAtual,
        motivoCodigo: 'REABERTURA',
        justificativa: args.motivo,
        lockVersion: { increment: 1 },
      },
    })
    await auditar(tx, 'TAREFA_REABERTA', t.id, args.autorId,
      `Tarefa "${t.titulo}" reaberta (estava ${t.statusTarefa}). ${etapasReabertas} etapa(s) voltaram a ficar disponíveis. Motivo: ${args.motivo}`,
      { tarefaId: t.id, de: t.statusTarefa, para: 'EM_ANDAMENTO', concluidaEm: t.dataConclusao?.toISOString() ?? null, etapasReabertas, stepDestinoId: args.stepDestinoId ?? null })
    return { ok: true as const, tarefaId: t.id }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// BLOQUEIO E ESPERA — e o relógio do SLA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A POLÍTICA DE PAUSA vem do workflow publicado, nunca do código.
 *
 * Sem workflow (tarefa manual), o padrão é NÃO pausar: prazo que para sozinho
 * é prazo que ninguém cobra.
 */
export async function politicaDeSla(workflowInstanceId: number | null): Promise<{ pausaEspera: boolean; pausaBloqueio: boolean }> {
  if (workflowInstanceId == null) return { pausaEspera: false, pausaBloqueio: false }
  const inst = await prisma.phaseWorkflowInstance.findUnique({
    where: { id: workflowInstanceId },
    select: { workflowDefinitionId: true },
  })
  if (!inst?.workflowDefinitionId) return { pausaEspera: false, pausaBloqueio: false }
  const def = await prisma.phaseInternalWorkflow.findUnique({
    where: { id: inst.workflowDefinitionId },
    select: { pausarSlaEmEsperaExterna: true, pausarSlaEmBloqueio: true },
  })
  return { pausaEspera: !!def?.pausarSlaEmEsperaExterna, pausaBloqueio: !!def?.pausarSlaEmBloqueio }
}

/**
 * PAUSA / RETOMA o relógio do prazo.
 *
 * O prazo NÃO é reescrito enquanto a pausa dura — ele é empurrado quando ela
 * termina, pelo tempo exato que passou. Mexer no `dataPrazo` no início da pausa
 * significaria adivinhar quanto o cartório vai demorar.
 */
export async function pausarSla(tx: Prisma.TransactionClient, tarefaId: number, agora: Date) {
  await tx.tarefa.updateMany({ where: { id: tarefaId, slaPausadoEm: null }, data: { slaPausadoEm: agora } })
}

export async function retomarSla(tx: Prisma.TransactionClient, tarefaId: number, agora: Date) {
  const t = await tx.tarefa.findUnique({ where: { id: tarefaId }, select: { slaPausadoEm: true, dataPrazo: true, slaPausaAcumuladaMin: true } })
  if (!t?.slaPausadoEm) return 0
  const minutos = Math.max(0, Math.round((agora.getTime() - t.slaPausadoEm.getTime()) / 60000))
  const novoPrazo = t.dataPrazo ? new Date(t.dataPrazo.getTime() + minutos * 60000) : null
  await tx.tarefa.update({
    where: { id: tarefaId },
    data: { slaPausadoEm: null, slaPausaAcumuladaMin: t.slaPausaAcumuladaMin + minutos, ...(novoPrazo ? { dataPrazo: novoPrazo } : {}) },
  })
  return minutos
}

export async function bloquearTarefa(args: {
  tarefaId: number; autorId: number; motivo: string
}): Promise<Resultado> {
  if (!args.motivo?.trim()) return { ok: false, codigo: 'SEM_MOTIVO', mensagem: 'Informe o motivo do bloqueio.' }
  const agora = new Date()
  return prisma.$transaction(async (tx) => {
    const t = await tx.tarefa.findUnique({
      where: { id: args.tarefaId },
      select: { id: true, titulo: true, statusTarefa: true, workflowInstanceId: true },
    })
    if (!t) return { ok: false as const, codigo: 'NAO_ENCONTRADA' as const, mensagem: 'Tarefa não existe.' }
    if (STATUS_TERMINAIS.includes(t.statusTarefa)) {
      return { ok: false as const, codigo: 'TERMINAL' as const, mensagem: 'Tarefa encerrada não se bloqueia.' }
    }
    const politica = await politicaDeSla(t.workflowInstanceId)
    await tx.tarefa.update({
      where: { id: t.id },
      data: {
        statusTarefa: 'BLOQUEADA',
        // O estado anterior é guardado para o desbloqueio devolver a tarefa
        // onde ela estava, em vez de chutar EM_ANDAMENTO.
        blockedPreviousStatus: t.statusTarefa,
        motivoCodigo: 'BLOQUEIO',
        justificativa: args.motivo,
        lockVersion: { increment: 1 },
      },
    })
    if (politica.pausaBloqueio) await pausarSla(tx, t.id, agora)
    await auditar(tx, 'TAREFA_BLOQUEADA', t.id, args.autorId,
      `Tarefa "${t.titulo}" bloqueada (estava ${t.statusTarefa}). Motivo: ${args.motivo}` +
      (politica.pausaBloqueio ? ' O prazo ficou pausado conforme a política do workflow.' : ' O prazo continua correndo.'),
      { tarefaId: t.id, de: t.statusTarefa, motivo: args.motivo, slaPausado: politica.pausaBloqueio })
    return { ok: true as const, tarefaId: t.id }
  })
}

export async function desbloquearTarefa(args: { tarefaId: number; autorId: number; motivo?: string | null }): Promise<Resultado> {
  const agora = new Date()
  return prisma.$transaction(async (tx) => {
    const t = await tx.tarefa.findUnique({
      where: { id: args.tarefaId },
      select: { id: true, titulo: true, statusTarefa: true, blockedPreviousStatus: true },
    })
    if (!t) return { ok: false as const, codigo: 'NAO_ENCONTRADA' as const, mensagem: 'Tarefa não existe.' }
    if (t.statusTarefa !== 'BLOQUEADA') {
      return { ok: false as const, codigo: 'CONFLITO' as const, mensagem: 'A tarefa não está bloqueada.' }
    }
    const minutos = await retomarSla(tx, t.id, agora)
    const volta = (t.blockedPreviousStatus as StatusTarefa) ?? 'EM_ANDAMENTO'
    await tx.tarefa.update({
      where: { id: t.id },
      data: { statusTarefa: volta, blockedPreviousStatus: null, motivoCodigo: null, lockVersion: { increment: 1 } },
    })
    await auditar(tx, 'TAREFA_DESBLOQUEADA', t.id, args.autorId,
      `Tarefa "${t.titulo}" desbloqueada e devolvida a ${volta}.` +
      (minutos > 0 ? ` O prazo foi empurrado em ${minutos} minuto(s) de pausa.` : ''),
      { tarefaId: t.id, para: volta, minutosPausados: minutos, motivo: args.motivo ?? null })
    return { ok: true as const, tarefaId: t.id }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// FILA, PRAZO E PRIORIDADE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * DEVOLVE A TAREFA À FILA DA EQUIPE — sem dono, sem perder nada.
 *
 * Férias, afastamento, redistribuição. A tarefa continua a mesma, no mesmo
 * ponto do workflow, com o mesmo prazo; só volta a esperar distribuição.
 */
export async function devolverAFila(args: { tarefaId: number; autorId: number; motivo?: string | null }): Promise<Resultado> {
  return prisma.$transaction(async (tx) => {
    const t = await tx.tarefa.findUnique({
      where: { id: args.tarefaId },
      select: { id: true, titulo: true, responsavelId: true, equipeKey: true, statusTarefa: true },
    })
    if (!t) return { ok: false as const, codigo: 'NAO_ENCONTRADA' as const, mensagem: 'Tarefa não existe.' }
    if (STATUS_TERMINAIS.includes(t.statusTarefa)) {
      return { ok: false as const, codigo: 'TERMINAL' as const, mensagem: 'Tarefa encerrada não volta para a fila.' }
    }
    if (t.responsavelId == null) {
      return { ok: false as const, codigo: 'CONFLITO' as const, mensagem: 'A tarefa já está na fila.' }
    }
    await tx.tarefa.update({
      where: { id: t.id },
      data: { responsavelId: null, dataAtribuicao: null, atribuidoPorId: null, lockVersion: { increment: 1 } },
    })
    await auditar(tx, 'TAREFA_DEVOLVIDA_A_FILA', t.id, args.autorId,
      `Tarefa "${t.titulo}" devolvida à fila${t.equipeKey ? ` da ${t.equipeKey}` : ''} (era do usuário ${t.responsavelId}).` +
      (args.motivo ? ` Motivo: ${args.motivo}` : ''),
      { tarefaId: t.id, de: t.responsavelId, equipeKey: t.equipeKey, motivo: args.motivo ?? null })
    return { ok: true as const, tarefaId: t.id }
  })
}

export async function alterarPrazo(args: {
  tarefaId: number; autorId: number; novoPrazo: Date | null; motivo: string
}): Promise<Resultado> {
  if (!args.motivo?.trim()) return { ok: false, codigo: 'SEM_MOTIVO', mensagem: 'Informe o motivo da mudança de prazo.' }
  return prisma.$transaction(async (tx) => {
    const t = await tx.tarefa.findUnique({ where: { id: args.tarefaId }, select: { id: true, titulo: true, dataPrazo: true, statusTarefa: true } })
    if (!t) return { ok: false as const, codigo: 'NAO_ENCONTRADA' as const, mensagem: 'Tarefa não existe.' }
    if (STATUS_TERMINAIS.includes(t.statusTarefa)) {
      return { ok: false as const, codigo: 'TERMINAL' as const, mensagem: 'Tarefa encerrada não muda de prazo.' }
    }
    await tx.tarefa.update({ where: { id: t.id }, data: { dataPrazo: args.novoPrazo, lockVersion: { increment: 1 } } })
    await auditar(tx, 'TAREFA_PRAZO_ALTERADO', t.id, args.autorId,
      `Prazo de "${t.titulo}" alterado de ${t.dataPrazo?.toISOString().slice(0, 10) ?? 'sem prazo'} para ${args.novoPrazo?.toISOString().slice(0, 10) ?? 'sem prazo'}. Motivo: ${args.motivo}`,
      { tarefaId: t.id, de: t.dataPrazo?.toISOString() ?? null, para: args.novoPrazo?.toISOString() ?? null, motivo: args.motivo })
    return { ok: true as const, tarefaId: t.id }
  })
}

export async function alterarPrioridade(args: {
  tarefaId: number; autorId: number; prioridade: 'BAIXA' | 'MEDIA' | 'ALTA' | 'URGENTE'; motivo?: string | null
}): Promise<Resultado> {
  return prisma.$transaction(async (tx) => {
    const t = await tx.tarefa.findUnique({ where: { id: args.tarefaId }, select: { id: true, titulo: true, prioridade: true } })
    if (!t) return { ok: false as const, codigo: 'NAO_ENCONTRADA' as const, mensagem: 'Tarefa não existe.' }
    await tx.tarefa.update({ where: { id: t.id }, data: { prioridade: args.prioridade, lockVersion: { increment: 1 } } })
    await auditar(tx, 'TAREFA_PRIORIDADE_ALTERADA', t.id, args.autorId,
      `Prioridade de "${t.titulo}" alterada de ${t.prioridade} para ${args.prioridade}.` + (args.motivo ? ` Motivo: ${args.motivo}` : ''),
      { tarefaId: t.id, de: t.prioridade, para: args.prioridade, motivo: args.motivo ?? null })
    return { ok: true as const, tarefaId: t.id }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// DEPENDÊNCIAS
// ═══════════════════════════════════════════════════════════════════════════

/** Declara que uma tarefa espera outra. Idempotente pelo par. */
export async function declararDependencia(args: {
  tarefaId: number; dependeDeId: number; obrigatoria?: boolean; motivo?: string | null; autorId?: number | null
}): Promise<Resultado> {
  if (args.tarefaId === args.dependeDeId) {
    return { ok: false, codigo: 'INVALIDO', mensagem: 'Uma tarefa não pode depender de si mesma.' }
  }
  // Ciclo direto: A→B e B→A travariam as duas para sempre, e ninguém
  // conseguiria começar nenhuma das duas.
  const inverso = await prisma.tarefaDependencia.findUnique({
    where: { tarefaId_dependeDeId: { tarefaId: args.dependeDeId, dependeDeId: args.tarefaId } },
    select: { id: true },
  })
  if (inverso) return { ok: false, codigo: 'INVALIDO', mensagem: 'Isso criaria um ciclo: a outra tarefa já depende desta.' }

  await prisma.tarefaDependencia.upsert({
    where: { tarefaId_dependeDeId: { tarefaId: args.tarefaId, dependeDeId: args.dependeDeId } },
    create: { tarefaId: args.tarefaId, dependeDeId: args.dependeDeId, obrigatoria: args.obrigatoria ?? true, motivo: args.motivo ?? null },
    update: { obrigatoria: args.obrigatoria ?? true, motivo: args.motivo ?? null },
  })
  return { ok: true, tarefaId: args.tarefaId }
}

/**
 * A TAREFA PODE SER EXECUTADA AGORA?
 *
 * Dependência não vira etapa e não some da fila: a tarefa existe, é visível e
 * diz por que ainda não pode andar. Esconder até liberar faria o trabalho
 * aparecer do nada no dia em que a outra terminasse.
 */
export async function podeExecutar(tarefaId: number): Promise<{ pode: boolean; bloqueadaPor: number[] }> {
  const deps = await prisma.tarefaDependencia.findMany({
    where: { tarefaId, obrigatoria: true },
    select: { dependeDeId: true, dependeDe: { select: { statusTarefa: true } } },
  })
  const pendentes = deps
    .filter((d) => !['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI'].includes(d.dependeDe.statusTarefa))
    .map((d) => d.dependeDeId)
  return { pode: pendentes.length === 0, bloqueadaPor: pendentes }
}

// ═══════════════════════════════════════════════════════════════════════════
// ESPERA EXTERNA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A TAREFA PASSA A DEPENDER DE TERCEIRO — e continua sendo trabalho de alguém.
 *
 * Não é bloqueio: bloqueio é impedimento que ALGUÉM AQUI precisa resolver;
 * espera externa é o curso normal de um pedido que foi feito e ainda não
 * voltou. Misturar os dois faria a fila de impedimentos encher de cartório.
 *
 * A tarefa não some, não perde dono, não perde equipe. Ela muda de recorte.
 */
export async function aguardarTerceiro(args: {
  tarefaId: number; autorId: number; motivo: string
}): Promise<Resultado> {
  if (!args.motivo?.trim()) return { ok: false, codigo: 'SEM_MOTIVO', mensagem: 'Informe do que a tarefa está esperando.' }
  const agora = new Date()
  return prisma.$transaction(async (tx) => {
    const t = await tx.tarefa.findUnique({
      where: { id: args.tarefaId },
      select: { id: true, titulo: true, statusTarefa: true, workflowInstanceId: true },
    })
    if (!t) return { ok: false as const, codigo: 'NAO_ENCONTRADA' as const, mensagem: 'Tarefa não existe.' }
    if (STATUS_TERMINAIS.includes(t.statusTarefa)) {
      return { ok: false as const, codigo: 'TERMINAL' as const, mensagem: 'Tarefa encerrada não entra em espera.' }
    }
    if (t.statusTarefa === 'AGUARDANDO_TERCEIRO') {
      // Repetir não é erro nem evento novo: a tarefa já está esperando, e
      // registrar de novo criaria uma segunda pausa de SLA sobre a primeira.
      return { ok: true as const, tarefaId: t.id }
    }
    const politica = await politicaDeSla(t.workflowInstanceId)
    await tx.tarefa.update({
      where: { id: t.id },
      data: {
        statusTarefa: 'AGUARDANDO_TERCEIRO',
        blockedPreviousStatus: t.statusTarefa,
        motivoCodigo: 'ESPERA_EXTERNA',
        justificativa: args.motivo,
        lockVersion: { increment: 1 },
      },
    })
    if (politica.pausaEspera) await pausarSla(tx, t.id, agora)
    await auditar(tx, 'TAREFA_AGUARDANDO_TERCEIRO', t.id, args.autorId,
      `Tarefa "${t.titulo}" passou a aguardar terceiro (estava ${t.statusTarefa}). Motivo: ${args.motivo}` +
      (politica.pausaEspera ? ' O prazo ficou pausado conforme a política do workflow.' : ' O prazo continua correndo.'),
      { tarefaId: t.id, de: t.statusTarefa, motivo: args.motivo, slaPausado: politica.pausaEspera })
    return { ok: true as const, tarefaId: t.id }
  })
}

/** O terceiro respondeu — a MESMA tarefa volta ao ponto em que estava. */
export async function retomarDeEspera(args: { tarefaId: number; autorId: number; motivo?: string | null }): Promise<Resultado> {
  const agora = new Date()
  return prisma.$transaction(async (tx) => {
    const t = await tx.tarefa.findUnique({
      where: { id: args.tarefaId },
      select: { id: true, titulo: true, statusTarefa: true, blockedPreviousStatus: true },
    })
    if (!t) return { ok: false as const, codigo: 'NAO_ENCONTRADA' as const, mensagem: 'Tarefa não existe.' }
    if (t.statusTarefa !== 'AGUARDANDO_TERCEIRO') {
      return { ok: false as const, codigo: 'CONFLITO' as const, mensagem: 'A tarefa não está aguardando terceiro.' }
    }
    const minutos = await retomarSla(tx, t.id, agora)
    const volta = (t.blockedPreviousStatus as StatusTarefa) ?? 'EM_ANDAMENTO'
    await tx.tarefa.update({
      where: { id: t.id },
      data: { statusTarefa: volta, blockedPreviousStatus: null, motivoCodigo: null, lockVersion: { increment: 1 } },
    })
    await auditar(tx, 'TAREFA_RETOMADA_DE_ESPERA', t.id, args.autorId,
      `Tarefa "${t.titulo}" retomada da espera e devolvida a ${volta}.` +
      (minutos > 0 ? ` O prazo foi empurrado em ${minutos} minuto(s) de espera real.` : ''),
      { tarefaId: t.id, para: volta, minutosPausados: minutos, motivo: args.motivo ?? null })
    return { ok: true as const, tarefaId: t.id }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// ENCERRAMENTO ADMINISTRATIVO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CANCELAR — o trabalho não vai ser feito.
 *
 * ─── POR QUE NÃO EXISTE "INVALIDAR" SEPARADO ────────────────────────────────
 * O domínio já tem `CANCELADA` e `SUPERSEDIDA`, e elas cobrem os dois sentidos
 * reais: alguém decidiu que não se faz, e o motor substituiu por outra
 * instância. "Invalidar" seria um terceiro nome para o primeiro caso — mesmo
 * efeito, mesma consequência, mesma leitura em toda projeção.
 *
 * Um estado a mais que não muda nada obriga cada consulta futura a lembrar de
 * incluí-lo, e a primeira que esquecer some com a tarefa da tela. O que
 * distingue os motivos é `motivoCodigo`, que é texto de auditoria e não muda
 * regra nenhuma.
 */
export async function cancelarTarefa(args: {
  tarefaId: number; autorId: number; motivo: string; codigo?: string | null
}): Promise<Resultado> {
  if (!args.motivo?.trim()) return { ok: false, codigo: 'SEM_MOTIVO', mensagem: 'Informe o motivo do cancelamento.' }
  const agora = new Date()
  return prisma.$transaction(async (tx) => {
    const t = await tx.tarefa.findUnique({
      where: { id: args.tarefaId },
      select: { id: true, titulo: true, statusTarefa: true, dataInicio: true },
    })
    if (!t) return { ok: false as const, codigo: 'NAO_ENCONTRADA' as const, mensagem: 'Tarefa não existe.' }
    // Cancelar tarefa concluída apagaria um fato: o trabalho ACONTECEU. Para
    // desfazer o resultado existe reabertura, que preserva o histórico.
    if (STATUS_TERMINAIS.includes(t.statusTarefa)) {
      return {
        ok: false as const, codigo: 'TERMINAL' as const,
        mensagem: `Tarefa já encerrada (${t.statusTarefa}). Para retomá-la, reabra; cancelar não apaga o que foi feito.`,
      }
    }
    await tx.tarefa.update({
      where: { id: t.id },
      data: {
        statusTarefa: 'CANCELADA',
        concluida: false,
        dataConclusao: agora,
        motivoCodigo: (args.codigo ?? 'CANCELAMENTO').slice(0, 40),
        justificativa: args.motivo,
        lockVersion: { increment: 1 },
      },
    })
    await auditar(tx, 'TAREFA_CANCELADA', t.id, args.autorId,
      `Tarefa "${t.titulo}" cancelada (estava ${t.statusTarefa}${t.dataInicio ? ', com trabalho já iniciado' : ''}). Motivo: ${args.motivo}`,
      { tarefaId: t.id, de: t.statusTarefa, motivo: args.motivo, codigo: args.codigo ?? 'CANCELAMENTO', jaIniciada: t.dataInicio != null })
    return { ok: true as const, tarefaId: t.id }
  })
}

/** Remove uma dependência declarada. Remover o que não existe não é erro. */
export async function removerDependencia(args: { tarefaId: number; dependeDeId: number; autorId?: number | null }): Promise<Resultado> {
  const r = await prisma.tarefaDependencia.deleteMany({
    where: { tarefaId: args.tarefaId, dependeDeId: args.dependeDeId },
  })
  if (r.count > 0) {
    await prisma.logAuditoria.create({
      data: {
        acao: 'TAREFA_DEPENDENCIA_REMOVIDA', entidade: 'Tarefa', entidadeId: args.tarefaId,
        usuarioId: args.autorId ?? undefined,
        descricao: `Dependência da tarefa ${args.tarefaId} em relação à ${args.dependeDeId} removida.`,
        detalhes: { tarefaId: args.tarefaId, dependeDeId: args.dependeDeId },
      },
    })
  }
  return { ok: true, tarefaId: args.tarefaId }
}
