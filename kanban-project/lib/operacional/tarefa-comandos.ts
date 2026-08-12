// lib/operacional/tarefa-comandos.ts
// ============================================================================
// AS PORTAS CANÔNICAS DA TAREFA — atribuir, transferir, iniciar.
//
// Toda mudança de responsabilidade passa por aqui. Uma rota que faça
// `tarefa.update({ responsavelId })` por conta própria pula a auditoria e a
// notificação, e o efeito é o de sempre: a pessoa nunca fica sabendo que
// recebeu a tarefa, e seis meses depois ninguém sabe quem a passou para ela.
//
// ─── NENHUM COMANDO CRIA TAREFA ─────────────────────────────────────────────
// Atribuir, transferir e iniciar mudam a MESMA tarefa. Transferir a tarefa da
// Daniela para o João não cria a tarefa do João: é o mesmo trabalho, o mesmo
// workflow, as mesmas etapas já feitas. Duplicar aqui seria perder o histórico
// justamente no momento em que ele mais importa.
//
// ─── CONCORRÊNCIA ───────────────────────────────────────────────────────────
// Dois gestores atribuindo ao mesmo tempo não podem produzir estado
// intermediário. O `lockVersion` (CAS otimista, já no modelo) resolve: quem
// chega com a versão velha perde e é avisado, em vez de sobrescrever em
// silêncio o que o outro acabou de decidir.
// ============================================================================
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { STATUS_TERMINAIS } from './tarefa-canonica'
import { transicionarPassoTx } from '@/src/services/task-step-sync'

export type ResultadoComando =
  /** `jaEstavaIniciada` distingue "fiz agora" de "já estava feito" sem virar erro. */
  | { ok: true; tarefaId: number; notificacaoId: number | null; jaEstavaIniciada?: boolean }
  | { ok: false; codigo: 'NAO_ENCONTRADA' | 'TERMINAL' | 'CONFLITO' | 'SEM_RESPONSAVEL' | 'MESMO_RESPONSAVEL'; mensagem: string }

/** O link canônico da tarefa — um só, para todas as visões e avisos. */
// O link do aviso leva à OPERAÇÃO — `/activities` foi aposentada junto com a
// árvore de subtarefas, e um aviso que abre 404 é pior do que aviso nenhum.
export const linkDaTarefa = (tarefaId: number) => `/operacao?taskId=${tarefaId}`

/**
 * O AVISO DE UM MARCO DA TAREFA.
 *
 * `chaveIdempotencia` inclui o que torna o marco único: para atribuição, o
 * responsável e o instante do ato; para prazo e atraso, o DIA. Sem o dia, o
 * aviso de prazo renasceria a cada varredura e o sino viraria ruído; com ele,
 * é um por tarefa por dia.
 */
async function notificar(
  tx: Prisma.TransactionClient,
  ev: {
    tipo: 'ATRIBUICAO' | 'TRANSFERENCIA' | 'PRAZO' | 'ATRASO' | 'BLOQUEIO'
    destinatarioId: number
    tarefaId: number
    titulo: string
    mensagem?: string | null
    autorId?: number | null
    chave: string
  },
  // Devolve `criada` além do id: sem essa distinção, uma varredura que só
  // reencontra o aviso de ontem relata que avisou hoje — e o número do
  // relatório passa a crescer sem que ninguém tenha sido avisado de nada.
): Promise<{ id: number; criada: boolean }> {
  const ja = await tx.notificacaoOperacional.findUnique({
    where: { chaveIdempotencia: ev.chave },
    select: { id: true },
  })
  if (ja) return { id: ja.id, criada: false }

  const criada = await tx.notificacaoOperacional.create({
    data: {
      tipo: ev.tipo,
      destinatarioId: ev.destinatarioId,
      tarefaId: ev.tarefaId,
      titulo: ev.titulo.slice(0, 200),
      mensagem: ev.mensagem ?? null,
      link: linkDaTarefa(ev.tarefaId),
      autorId: ev.autorId ?? null,
      chaveIdempotencia: ev.chave,
    },
    select: { id: true },
  })
  return { id: criada.id, criada: true }
}

const auditar = (
  tx: Prisma.TransactionClient,
  acao: string,
  tarefaId: number,
  autorId: number | null,
  descricao: string,
  detalhes: Prisma.InputJsonValue,
) =>
  tx.logAuditoria.create({
    data: { acao, entidade: 'Tarefa', entidadeId: tarefaId, usuarioId: autorId ?? undefined, descricao, detalhes },
  })

/**
 * ATRIBUIR / TRANSFERIR — o mesmo ato, com nomes diferentes conforme a tarefa
 * já tivesse dono.
 *
 * São o mesmo comando de propósito: separá-los em dois serviços produziria duas
 * implementações da mesma regra, e uma delas ficaria para trás. O que muda é o
 * rótulo do evento e a exigência de motivo.
 */
export async function atribuirTarefa(args: {
  tarefaId: number
  responsavelId: number
  autorId: number | null
  motivo?: string | null
  /** CAS otimista: a versão que quem chama leu. Ausente = sem checagem. */
  lockVersion?: number
}): Promise<ResultadoComando> {
  const agora = new Date()
  return prisma.$transaction(async (tx) => {
    const t = await tx.tarefa.findUnique({
      where: { id: args.tarefaId },
      select: {
        id: true, titulo: true, responsavelId: true, equipeKey: true, statusTarefa: true,
        lockVersion: true, dataPrazo: true, processoId: true,
      },
    })
    if (!t) return { ok: false as const, codigo: 'NAO_ENCONTRADA' as const, mensagem: `Tarefa ${args.tarefaId} não existe.` }
    if (STATUS_TERMINAIS.includes(t.statusTarefa)) {
      return { ok: false as const, codigo: 'TERMINAL' as const, mensagem: `Tarefa já encerrada (${t.statusTarefa}).` }
    }
    if (args.lockVersion != null && args.lockVersion !== t.lockVersion) {
      return {
        ok: false as const, codigo: 'CONFLITO' as const,
        mensagem: 'A tarefa mudou desde que você a leu — recarregue antes de atribuir.',
      }
    }
    if (t.responsavelId === args.responsavelId) {
      return { ok: false as const, codigo: 'MESMO_RESPONSAVEL' as const, mensagem: 'A tarefa já é dessa pessoa.' }
    }

    const transferencia = t.responsavelId != null
    const anterior = t.responsavelId

    // O CAS: `lockVersion` entra no WHERE. Se outro gestor gravou entre a
    // leitura e este update, o `updateMany` acerta zero linhas e ninguém
    // sobrescreve a decisão do outro.
    const escrito = await tx.tarefa.updateMany({
      where: { id: t.id, lockVersion: t.lockVersion },
      data: {
        responsavelId: args.responsavelId,
        dataAtribuicao: agora,
        atribuidoPorId: args.autorId ?? null,
        lockVersion: { increment: 1 },
      },
    })
    if (escrito.count === 0) {
      return {
        ok: false as const, codigo: 'CONFLITO' as const,
        mensagem: 'Outra atribuição aconteceu ao mesmo tempo — recarregue e tente de novo.',
      }
    }

    await auditar(
      tx,
      transferencia ? 'TAREFA_TRANSFERIDA' : 'TAREFA_ATRIBUIDA',
      t.id,
      args.autorId,
      transferencia
        ? `Tarefa "${t.titulo}" transferida do usuário ${anterior} para ${args.responsavelId}.` +
          (args.motivo ? ` Motivo: ${args.motivo}` : '')
        : `Tarefa "${t.titulo}" atribuída ao usuário ${args.responsavelId} (estava na fila${t.equipeKey ? ` da ${t.equipeKey}` : ''}).`,
      { tarefaId: t.id, de: anterior, para: args.responsavelId, equipeKey: t.equipeKey, motivo: args.motivo ?? null },
    )

    // A chave carrega o par (tarefa, responsável): reatribuir para a MESMA
    // pessoa depois de ela ter passado para outra avisa de novo, que é o certo;
    // um retry da mesma chamada, não.
    const aviso = await notificar(tx, {
      tipo: transferencia ? 'TRANSFERENCIA' : 'ATRIBUICAO',
      destinatarioId: args.responsavelId,
      tarefaId: t.id,
      autorId: args.autorId,
      titulo: transferencia ? 'Tarefa transferida para você' : 'Nova tarefa atribuída',
      mensagem: t.dataPrazo
        ? `${t.titulo} — concluir até ${t.dataPrazo.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}.`
        : t.titulo,
      chave: `notif::atribuicao::t${t.id}::u${args.responsavelId}::v${t.lockVersion}`,
    })

    return { ok: true as const, tarefaId: t.id, notificacaoId: aviso.id }
  })
}

/** Transferir é atribuir uma tarefa que já tem dono — mesma porta, com motivo. */
export const transferirTarefa = (args: {
  tarefaId: number; responsavelId: number; autorId: number | null; motivo?: string | null; lockVersion?: number
}) => atribuirTarefa(args)

/**
 * INICIAR — o responsável assume o trabalho.
 *
 * Não cria workflow: ele já existe desde que a tarefa nasceu. Iniciar só marca
 * quando o relógio do trabalho começou a correr para quem executa.
 */
export async function iniciarTarefa(args: {
  tarefaId: number
  autorId: number
  /** ADMIN/gestor pode iniciar tarefa de outro; o executor, só a sua. */
  permiteDeTerceiro?: boolean
}): Promise<ResultadoComando> {
  const agora = new Date()
  return prisma.$transaction(async (tx) => {
    const t = await tx.tarefa.findUnique({
      where: { id: args.tarefaId },
      select: {
        id: true, titulo: true, responsavelId: true, statusTarefa: true, dataInicio: true,
        workflowInstanceId: true, workflowStepInstanceId: true,
      },
    })
    if (!t) return { ok: false as const, codigo: 'NAO_ENCONTRADA' as const, mensagem: `Tarefa ${args.tarefaId} não existe.` }
    if (STATUS_TERMINAIS.includes(t.statusTarefa)) {
      return { ok: false as const, codigo: 'TERMINAL' as const, mensagem: `Tarefa já encerrada (${t.statusTarefa}).` }
    }
    // Tarefa na fila não se inicia: iniciar sem dono deixaria o trabalho em
    // andamento e sem ninguém responsável por ele.
    if (t.responsavelId == null) {
      return { ok: false as const, codigo: 'SEM_RESPONSAVEL' as const, mensagem: 'Atribua a tarefa antes de iniciá-la.' }
    }
    if (t.responsavelId !== args.autorId && !args.permiteDeTerceiro) {
      return { ok: false as const, codigo: 'CONFLITO' as const, mensagem: 'Só o responsável pode iniciar a tarefa.' }
    }

    // ─── INICIAR É IDEMPOTENTE ────────────────────────────────────────────────
    //
    // Quem já começou não começa de novo. Sem esta guarda, cada nova chamada —
    // um segundo clique, um retry, uma tela remontando — gravava outro
    // "Tarefa iniciada" no histórico. Em produção isso rendeu QUATRO inícios
    // para o mesmo trabalho, três deles em 65 segundos, e o histórico deixou de
    // narrar o que aconteceu para narrar quantas vezes alguém clicou.
    //
    // `dataInicio` já era preservada; o que faltava era não registrar o fato
    // duas vezes. A resposta é de SUCESSO: o estado desejado é o estado atual,
    // e quem chamou não precisa tratar isso como erro.
    if (t.statusTarefa === 'EM_ANDAMENTO' && t.dataInicio != null) {
      return { ok: true as const, tarefaId: t.id, notificacaoId: null, jaEstavaIniciada: true }
    }

    // A GUARDA ACIMA NÃO BASTA SOZINHA — ela lê, e entre o ler e o escrever cabe
    // outra chamada. Foi o que o teste flagrou: um clique na tela e um POST
    // simultâneo passaram os dois pela leitura e gravaram DOIS inícios.
    //
    // Quem decide é o banco: a escrita só acontece se a tarefa ainda NÃO estiver
    // em andamento. Perdeu a corrida, `count` volta 0 — e aí não há transição,
    // logo não há evento. A guarda de cima continua valendo para o caso comum
    // (evita a escrita inútil); esta fecha o caso concorrente.
    const transicao = await tx.tarefa.updateMany({
      where: { id: t.id, statusTarefa: { not: 'EM_ANDAMENTO' } },
      data: {
        statusTarefa: 'EM_ANDAMENTO',
        dataInicio: t.dataInicio ?? agora,
        lockVersion: { increment: 1 },
      },
    })
    if (transicao.count === 0) {
      return { ok: true as const, tarefaId: t.id, notificacaoId: null, jaEstavaIniciada: true }
    }
    // A ETAPA CORRENTE COMEÇA JUNTO — pela porta de quem é dono dela.
    //
    // Iniciar a tarefa e deixar o passo em DISPONIVEL não é contradição, mas é
    // uma meia-verdade: o histórico do workflow não registrava que o trabalho
    // começou, e "iniciar" pela rota antiga emitia PASSO_INICIADO enquanto
    // iniciar por aqui não emitia nada. O mesmo gesto com dois efeitos.
    let etapaIniciada: number | null = null
    if (t.workflowStepInstanceId != null) {
      const step = await tx.phaseWorkflowStepInstance.findUnique({
        where: { id: t.workflowStepInstanceId },
        select: { id: true, ciclo: true, processoId: true },
      })
      if (step) {
        const r = await transicionarPassoTx(tx, step.id, 'EM_ANDAMENTO', {
          correlationId: randomUUID(),
          operacao: 'tarefa-iniciar',
          ciclo: step.ciclo,
          processoId: step.processoId,
          workflowInstanceId: t.workflowInstanceId,
        })
        if (r.changed) etapaIniciada = step.id
      }
    }

    await auditar(tx, 'TAREFA_INICIADA', t.id, args.autorId, `Tarefa "${t.titulo}" iniciada.`, {
      tarefaId: t.id, workflowInstanceId: t.workflowInstanceId, etapaIniciada,
    })
    return { ok: true as const, tarefaId: t.id, notificacaoId: null }
  })
}

/**
 * OS AVISOS DO RELÓGIO — prazo próximo e atraso, da TAREFA.
 *
 * Varredura idempotente por DIA: rodar de hora em hora não multiplica o aviso.
 * Nenhum deles cria tarefa, muda workflow ou toca em etapa — atraso é uma
 * leitura do relógio contra `dataPrazo`, não um evento de negócio novo.
 */
export async function avisarPrazosEAtrasos(opts: { diasDeAntecedencia?: number; agora?: Date } = {}) {
  const agora = opts.agora ?? new Date()
  const antecedencia = opts.diasDeAntecedencia ?? 3
  const limite = new Date(agora)
  limite.setDate(limite.getDate() + antecedencia)
  const dia = agora.toISOString().slice(0, 10)

  const candidatas = await prisma.tarefa.findMany({
    where: {
      statusTarefa: { notIn: STATUS_TERMINAIS },
      responsavelId: { not: null },
      dataPrazo: { not: null, lte: limite },
    },
    select: { id: true, titulo: true, responsavelId: true, dataPrazo: true },
  })

  let prazo = 0, atraso = 0
  for (const t of candidatas) {
    const atrasada = t.dataPrazo! < agora
    const r = await prisma.$transaction((tx) =>
      notificar(tx, {
        tipo: atrasada ? 'ATRASO' : 'PRAZO',
        destinatarioId: t.responsavelId!,
        tarefaId: t.id,
        titulo: atrasada ? 'Tarefa em atraso' : 'Prazo se aproximando',
        mensagem: `${t.titulo} — prazo ${t.dataPrazo!.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}.`,
        // O DIA na chave: um aviso por tarefa por dia, não um por varredura.
        chave: `notif::${atrasada ? 'atraso' : 'prazo'}::t${t.id}::${dia}`,
      }),
    )
    if (r.criada) atrasada ? atraso++ : prazo++
  }
  return { avaliadas: candidatas.length, prazo, atraso }
}

// ═══════════════════════════════════════════════════════════════════════════
// REDISTRIBUIÇÃO EM LOTE
// ═══════════════════════════════════════════════════════════════════════════

export interface ItemDaRedistribuicao {
  tarefaId: number
  ok: boolean
  codigo?: string
  mensagem?: string
}

/**
 * REDISTRIBUI UM CONJUNTO DE TAREFAS — férias, afastamento, desligamento.
 *
 * ─── POR QUE NÃO É UMA TRANSAÇÃO ÚNICA ──────────────────────────────────────
 * A tentação é embrulhar tudo num `$transaction` e "garantir atomicidade". Mas
 * atomicidade aqui é a decisão ERRADA: se a tarefa 40 de 50 estiver encerrada
 * ou tiver acabado de ser transferida por outra pessoa, o tudo-ou-nada
 * derrubaria as 39 redistribuições legítimas por causa de uma que nunca
 * poderia dar certo. Quem sai de férias amanhã ficaria com as 50 tarefas.
 *
 * Cada tarefa é o seu próprio ato transacional e auditado — o que a operação
 * NÃO pode fazer é mentir sobre o que aconteceu. Por isso o retorno é
 * item a item: a UI mostra exatamente quais passaram e quais não, com o motivo
 * de cada uma.
 *
 * `novoResponsavelId: null` devolve o lote inteiro à fila da equipe.
 */
export async function redistribuirTarefas(args: {
  tarefaIds: number[]
  novoResponsavelId: number | null
  autorId: number
  motivo?: string | null
}): Promise<{ total: number; sucesso: number; falha: number; itens: ItemDaRedistribuicao[] }> {
  const itens: ItemDaRedistribuicao[] = []

  for (const tarefaId of [...new Set(args.tarefaIds)]) {
    if (args.novoResponsavelId == null) {
      const { devolverAFila } = await import('./tarefa-ciclo')
      const r = await devolverAFila({ tarefaId, autorId: args.autorId, motivo: args.motivo ?? 'redistribuição em lote' })
      itens.push(r.ok ? { tarefaId, ok: true } : { tarefaId, ok: false, codigo: r.codigo, mensagem: r.mensagem })
      continue
    }
    const r = await atribuirTarefa({
      tarefaId, responsavelId: args.novoResponsavelId, autorId: args.autorId,
      motivo: args.motivo ?? 'redistribuição em lote',
    })
    itens.push(r.ok ? { tarefaId, ok: true } : { tarefaId, ok: false, codigo: r.codigo, mensagem: r.mensagem })
  }

  const sucesso = itens.filter((i) => i.ok).length
  await prisma.logAuditoria.create({
    data: {
      acao: 'TAREFAS_REDISTRIBUIDAS',
      entidade: 'Tarefa',
      entidadeId: 0,
      usuarioId: args.autorId,
      descricao:
        `Redistribuição em lote: ${sucesso} de ${itens.length} tarefa(s) ` +
        `${args.novoResponsavelId == null ? 'devolvidas à fila da equipe' : `passadas ao usuário ${args.novoResponsavelId}`}.` +
        (args.motivo ? ` Motivo: ${args.motivo}` : ''),
      detalhes: JSON.parse(JSON.stringify({ novoResponsavelId: args.novoResponsavelId, motivo: args.motivo ?? null, itens })),
    },
  })

  return { total: itens.length, sucesso, falha: itens.length - sucesso, itens }
}
