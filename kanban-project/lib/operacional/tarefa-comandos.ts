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
import { urlOperacionalDaTarefa } from './navegacao'
import type { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { STATUS_TERMINAIS } from './tarefa-canonica'
import { transicionarPassoTx } from '@/src/services/task-step-sync'
import { marcarAtribuicaoComoLidaAoProgredir } from './notificacao-canonica'
import { aoMudarDeDono, avisarChegouTrabalho } from './avisos-fatos'

export type ResultadoComando =
  /** `jaEstavaIniciada` distingue "fiz agora" de "já estava feito" sem virar erro. */
  | { ok: true; tarefaId: number; notificacaoId: number | null; jaEstavaIniciada?: boolean }
  | {
      ok: false
      codigo: 'NAO_ENCONTRADA' | 'TERMINAL' | 'CONFLITO' | 'SEM_RESPONSAVEL' | 'MESMO_RESPONSAVEL' | 'RESPONSAVEL_INDISPONIVEL'
      mensagem: string
    }

/**
 * O LINK CANÔNICO DA TAREFA — um só, para todas as visões e avisos.
 *
 * Delegado ao helper de navegação: aviso de atribuição, card do Kanban, linha
 * da visão global e cartão da Minha Fila abrem exatamente o mesmo lugar. Um
 * aviso que leva à home da operação obriga quem recebeu a procurar de novo o
 * trabalho que o aviso já sabia qual era.
 */
export const linkDaTarefa = (tarefaId: number, processoId: number | null = null) =>
  urlOperacionalDaTarefa({ taskId: tarefaId, processoId })

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
  /**
   * PRESENTE = esta atribuição é UM item de um lote (`redistribuirTarefas`).
   *
   * O FATO individual continua registrado por inteiro — mesma auditoria,
   * mesmo `dataAtribuicao`, mesma tarefa. O que muda é só a NOTIFICAÇÃO: ela
   * fica a cargo de quem orquestra o lote, que a consolida em UM aviso para
   * o destinatário em vez de N. Sem isto, "atribuir 20 operações" gerava 20
   * notificações idênticas em sequência — o mesmo defeito de fundo que uma
   * "escada de avisos" treina as pessoas a ignorar (ver `marcoDoPrazo`).
   */
  loteId?: string | null
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

    // O DESTINO NÃO PODE ESTAR INDISPONÍVEL — handoff (atribuição/transferência)
    // para quem está com `IndisponibilidadeOperacional` vigente (o cadastro que já
    // representa "esta pessoa não deve receber trabalho novo agora", inclusive
    // `BLOQUEIO_OPERACIONAL` = pessoa inativa/desabilitada operacionalmente) nunca
    // pode passar em silêncio. Achado real do mandato adversarial, cenário P: nada
    // aqui verificava isto antes — a transferência para um usuário inativo era
    // aceita como se fosse válida. Bloqueia com um código explícito em vez de
    // silenciosamente transferir para um destino inválido.
    const indisponibilidade = await tx.indisponibilidadeOperacional.findFirst({
      where: {
        usuarioId: args.responsavelId,
        inicio: { lte: agora },
        OR: [{ fim: null }, { fim: { gt: agora } }],
      },
      orderBy: { inicio: 'desc' },
      select: { tipo: true, motivo: true },
    })
    if (indisponibilidade) {
      return {
        ok: false as const, codigo: 'RESPONSAVEL_INDISPONIVEL' as const,
        mensagem: `Esta pessoa está indisponível agora (${indisponibilidade.tipo}${indisponibilidade.motivo ? `: ${indisponibilidade.motivo}` : ''}) — não é possível atribuir ou transferir trabalho para ela.`,
      }
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
      { tarefaId: t.id, de: anterior, para: args.responsavelId, equipeKey: t.equipeKey, motivo: args.motivo ?? null, ...(args.loteId ? { loteId: args.loteId } : {}) },
    )


    // O SINO (redesenho 29/09/2026) — na MESMA transação: os avisos da pessoa
    // anterior sobre esta tarefa somem, nasce o MUDOU_DE_MAO para ela e o
    // CHEGOU_TRABALHO para quem recebeu — agrupados por família, somando no aviso
    // aberto. LOTE: quem orquestra (`redistribuirTarefas`) soma o CHEGOU_TRABALHO
    // depois do laço; aqui só o que é individual de cada tarefa (posse + MUDOU_DE_MAO).
    const { chegouAvisoIds } = await aoMudarDeDono(tx, {
      tarefas: [{ id: t.id, processoId: t.processoId }],
      de: anterior, para: args.responsavelId, autorId: args.autorId,
      avisarChegou: !args.loteId,
    })

    return { ok: true as const, tarefaId: t.id, notificacaoId: chegouAvisoIds[0] ?? null }
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

    // O SINO NÃO PRECISA MAIS AVISAR "isto chegou para você" — quem começou já
    // sabe. Só a notificação de ATRIBUIÇÃO/TRANSFERÊNCIA fecha aqui; ver
    // `marcarAtribuicaoComoLidaAoProgredir`.
    await marcarAtribuicaoComoLidaAoProgredir(tx, { tarefaId: t.id, destinatarioId: t.responsavelId })

    await auditar(tx, 'TAREFA_INICIADA', t.id, args.autorId, `Tarefa "${t.titulo}" iniciada.`, {
      tarefaId: t.id, workflowInstanceId: t.workflowInstanceId, etapaIniciada,
    })
    return { ok: true as const, tarefaId: t.id, notificacaoId: null }
  })
}

// ─── OS AVISOS POR TAREFA SAÍRAM (redesenho do sino, 29/09/2026) ─────────────
// `avisarPrazosEAtrasos`, `avisarAcontecimentosOperacionais` e
// `avisarAtencaoConsolidada` criavam UM aviso por tarefa (e por certidão): 10 "Prazo
// próximo" da mesma família no mesmo minuto. Foram substituídos pelo resumo por
// (pessoa, família) — `avaliarPrecisaAgir`, em `avisos-sino.ts`, chamado pelos crons
// `/api/cron/resumo-diario` (07:00) e `/api/cron/avisos-prazo` (de hora em hora).

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
  /** Só vale para `novoResponsavelId: null`: devolver à fila uma tarefa EM ANDAMENTO exige confirmação explícita (`devolverAFila`). */
  confirmarTarefaEmAndamento?: boolean
}): Promise<{ total: number; sucesso: number; falha: number; itens: ItemDaRedistribuicao[] }> {
  const itens: ItemDaRedistribuicao[] = []
  // Só um FLAG interno para `atribuirTarefa` suprimir o aviso individual — não
  // é a chave de idempotência da notificação consolidada (essa é determinada
  // pelo CONTEÚDO do lote, abaixo, para sobreviver a um retry do mesmo POST).
  const loteId = randomUUID()

  for (const tarefaId of [...new Set(args.tarefaIds)]) {
    if (args.novoResponsavelId == null) {
      const { devolverAFila } = await import('./tarefa-ciclo')
      const r = await devolverAFila({ tarefaId, autorId: args.autorId, motivo: args.motivo ?? 'redistribuição em lote', confirmarTarefaEmAndamento: args.confirmarTarefaEmAndamento === true })
      itens.push(r.ok ? { tarefaId, ok: true } : { tarefaId, ok: false, codigo: r.codigo, mensagem: r.mensagem })
      continue
    }
    const r = await atribuirTarefa({
      tarefaId, responsavelId: args.novoResponsavelId, autorId: args.autorId,
      motivo: args.motivo ?? 'redistribuição em lote', loteId,
    })
    itens.push(r.ok ? { tarefaId, ok: true } : { tarefaId, ok: false, codigo: r.codigo, mensagem: r.mensagem })
  }

  const sucesso = itens.filter((i) => i.ok).length

  // O SINO — o lote inteiro SOMA no aviso "<Família> — N tarefas atribuídas a você"
  // (um por família do lote), nunca uma notificação por tarefa. Quem se auto-atribui
  // não é avisado do que fez.
  if (sucesso > 0 && args.novoResponsavelId != null && args.novoResponsavelId !== args.autorId) {
    const idsComSucesso = itens.filter((i) => i.ok).map((i) => i.tarefaId)
    const tarefasDoLote = await prisma.tarefa.findMany({
      where: { id: { in: idsComSucesso } }, select: { id: true, processoId: true },
    })
    await avisarChegouTrabalho(prisma, {
      destinatarioId: args.novoResponsavelId, tarefas: tarefasDoLote, autorId: args.autorId,
    })
  }

  await prisma.logAuditoria.create({
    data: {
      acao: 'TAREFAS_REDISTRIBUIDAS',
      entidade: 'Tarefa',
      entidadeId: 0,
      usuarioId: args.autorId,
      descricao:
        `Redistribuição em lote: ${sucesso} de ${itens.length} tarefa(s) ` +
        `${args.novoResponsavelId == null ? 'devolvidas à equipe (sem responsável)' : `passadas ao usuário ${args.novoResponsavelId}`}.` +
        (args.motivo ? ` Motivo: ${args.motivo}` : ''),
      detalhes: JSON.parse(JSON.stringify({ novoResponsavelId: args.novoResponsavelId, motivo: args.motivo ?? null, itens })),
    },
  })

  return { total: itens.length, sucesso, falha: itens.length - sucesso, itens }
}

/**
 * REPRIORIZA UM CONJUNTO DE TAREFAS — mesma forma de `redistribuirTarefas`,
 * mesmo motivo: item a item, auditado, sem transação única (uma tarefa
 * encerrada no meio do lote não pode reverter as demais).
 *
 * Existe para a Central Operacional poder agir sobre uma FAMÍLIA sem virar
 * "concluir tudo": reatribuir e repriorizar são as DUAS ações em lote que a
 * operação decidiu permitir — nenhuma delas fecha trabalho por atalho.
 */
export async function redistribuirPrioridade(args: {
  tarefaIds: number[]
  novaPrioridade: 'BAIXA' | 'MEDIA' | 'ALTA' | 'URGENTE'
  autorId: number
  motivo?: string | null
}): Promise<{ total: number; sucesso: number; falha: number; itens: ItemDaRedistribuicao[] }> {
  const { alterarPrioridade } = await import('./tarefa-ciclo')
  const itens: ItemDaRedistribuicao[] = []

  for (const tarefaId of [...new Set(args.tarefaIds)]) {
    const r = await alterarPrioridade({
      tarefaId, prioridade: args.novaPrioridade, autorId: args.autorId,
      motivo: args.motivo ?? 'repriorização em lote',
    })
    itens.push(r.ok ? { tarefaId, ok: true } : { tarefaId, ok: false, codigo: r.codigo, mensagem: r.mensagem })
  }

  const sucesso = itens.filter((i) => i.ok).length
  await prisma.logAuditoria.create({
    data: {
      acao: 'TAREFAS_REPRIORIZADAS',
      entidade: 'Tarefa',
      entidadeId: 0,
      usuarioId: args.autorId,
      descricao: `Repriorização em lote: ${sucesso} de ${itens.length} tarefa(s) para ${args.novaPrioridade}.` + (args.motivo ? ` Motivo: ${args.motivo}` : ''),
      detalhes: JSON.parse(JSON.stringify({ novaPrioridade: args.novaPrioridade, motivo: args.motivo ?? null, itens })),
    },
  })

  return { total: itens.length, sucesso, falha: itens.length - sucesso, itens }
}
