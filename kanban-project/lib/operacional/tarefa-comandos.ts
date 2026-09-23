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
import { urlOperacionalDaTarefa, urlMinhaOperacaoDoProcesso } from './navegacao'
import { estadoTemporal, diaOperacional, janelaDoDiaOperacional, FUSO_OPERACIONAL } from './tempo-operacional'
import type { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { STATUS_TERMINAIS } from './tarefa-canonica'
import { transicionarPassoTx } from '@/src/services/task-step-sync'
import { notificarAcontecimento, marcarAtribuicaoComoLidaAoProgredir } from './notificacao-canonica'
import { estadosTemporaisDasOperacoes } from './proximo-acontecimento'
import { motivosAtivos, ROTULO_MOTIVO, type MotivoAtencao } from './atencao-operacional'
import { visaoGerencial } from './tarefa-projecoes'
import { reconciliarObrigacaoDeAtribuicao } from './obrigacao-atribuicao'

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
      { tarefaId: t.id, de: anterior, para: args.responsavelId, equipeKey: t.equipeKey, motivo: args.motivo ?? null },
    )

    // OBRIGAÇÃO ADMINISTRATIVA — esta atribuição pode ter zerado o "sem
    // responsável" do processo (a última das N), ou pode ter sido a própria
    // obrigação sendo reatribuída — nos dois casos, reconciliar contra o
    // estado real agora. Ver lib/operacional/obrigacao-atribuicao.ts.
    if (t.processoId != null) await reconciliarObrigacaoDeAtribuicao(tx, t.processoId)

    // LOTE: a notificação individual é suprimida — quem orquestra o lote
    // (`redistribuirTarefas`) consolida em UM aviso, depois que o laço todo
    // terminar. O fato (auditoria acima, `dataAtribuicao`) já está gravado
    // por inteiro; só o AVISO muda de forma.
    if (args.loteId) {
      return { ok: true as const, tarefaId: t.id, notificacaoId: null }
    }

    // A chave carrega o par (tarefa, responsável): reatribuir para a MESMA
    // pessoa depois de ela ter passado para outra avisa de novo, que é o certo;
    // um retry da mesma chamada, não.
    const aviso = await notificarAcontecimento(tx, {
      tipo: transferencia ? 'TRANSFERENCIA' : 'ATRIBUICAO',
      destinatarioId: args.responsavelId,
      tarefaId: t.id,
      autorId: args.autorId,
      titulo: transferencia ? 'Tarefa transferida para você' : 'Nova tarefa atribuída',
      mensagem: t.dataPrazo
        ? `${t.titulo} — concluir até ${t.dataPrazo.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}.`
        : t.titulo,
      link: linkDaTarefa(t.id, t.processoId),
      chaveIdempotencia: `notif::atribuicao::t${t.id}::u${args.responsavelId}::v${t.lockVersion}`,
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

/**
 * O MARCO DO RELÓGIO — a identidade de um aviso de prazo.
 *
 * `tarefa + tipo + PRAZO DE REFERÊNCIA`. O prazo entra na chave porque é ele
 * que define o marco: se o gestor move o prazo de 15/08 para 20/08, o aviso do
 * dia 20 é um marco NOVO, e o do dia 15 não deve nascer depois do override.
 *
 * A chave NÃO carrega o dia da varredura. Carregava — e por isso o aviso de
 * atraso renascia todo dia, transformando uma informação em ruído diário até
 * alguém desligar o sino. Um prazo vencido é UM fato, não um fato por manhã.
 */
export function marcoDoPrazo(tipo: 'PRAZO' | 'HOJE' | 'ATRASO', tarefaId: number, prazo: Date): string {
  return `notif::${tipo.toLowerCase()}::t${tarefaId}::${diaOperacional(prazo)}`
}

export interface RelatorioDaVarredura {
  inicio: string
  fim: string
  avaliadas: number
  prazo: number
  hoje: number
  atraso: number
  /** Marcos que já existiam — a prova de que rodar de novo não avisa de novo. */
  deduplicados: number
  /** Tarefas sem responsável: não se inventa destinatário. */
  semDestinatario: number
  erros: number
  ensaio: boolean
  /** No ensaio, o que SERIA enviado — para conferir antes de ligar. */
  previa: Array<{ tarefaId: number; tipo: 'PRAZO' | 'HOJE' | 'ATRASO'; destinatarioId: number; titulo: string; prazo: string }>
}

/**
 * OS AVISOS DO RELÓGIO — prazo próximo e atraso, da TAREFA.
 *
 * ─── O QUE ELA FAZ, E SÓ ────────────────────────────────────────────────────
 * Lê o estado temporal canônico e cria notificação quando um MARCO novo
 * acontece. Não altera prazo, status, workflow, etapa, responsável nem SLA:
 * atraso é uma leitura do relógio contra `dataPrazo`, não um evento de negócio.
 *
 * ─── TRÊS MARCOS, UM DE CADA ─────────────────────────────────────────────────
 * PRAZO PRÓXIMO no dia anterior ao vencimento, VENCE HOJE no dia do vencimento,
 * e ATRASO quando ele passa. Faltava o do meio: sem ele, uma tarefa com prazo
 * hoje não gerava nenhum aviso até o dia seguinte, quando já estava atrasada.
 * Um único aviso por marco, para sempre — não um por dia, não um por
 * varredura. Uma escada de avisos (7d/5d/3d/1d) treina as pessoas a ignorar o
 * sino.
 *
 * ─── QUEM RECEBE ────────────────────────────────────────────────────────────
 * O responsável ATUAL, lido no momento da varredura. Se a tarefa mudou de mão
 * ontem, o aviso é de quem a tem hoje — mandar para o dono histórico avisaria
 * exatamente quem não pode fazer nada a respeito.
 *
 * Tarefa sem responsável não gera aviso individual: não há a quem avisar, e
 * inventar um destinatário seria pior do que o silêncio. Ela aparece na fila
 * "Sem responsável", que é onde essa pendência se resolve.
 */
export async function avisarPrazosEAtrasos(
  opts: { agora?: Date; ensaio?: boolean; excluirTarefaIds?: number[] } = {},
): Promise<RelatorioDaVarredura> {
  const agora = opts.agora ?? new Date()
  const ensaio = opts.ensaio === true
  const inicio = new Date()

  // A JANELA: do vencido até o fim do dia de amanhã. Nada além disso é marco.
  const fimDeAmanha = new Date(janelaDoDiaOperacional(agora).fim.getTime() + 86400000)

  const candidatas = await prisma.tarefa.findMany({
    where: {
      statusTarefa: { notIn: STATUS_TERMINAIS },
      dataPrazo: { not: null, lte: fimDeAmanha },
      // EXCLUSÃO OPCIONAL (mandato "consolidação do sino", 19/09/2026) —
      // vazio/omitido não muda nada (todo chamador existente continua
      // exatamente como estava). Só o cron novo passa a lista de tarefas
      // que `avisarAtencaoConsolidada` já notificou nesta mesma varredura
      // (2+ relógios vencendo juntos): sem isto, a MESMA tarefa receberia o
      // aviso consolidado E o aviso isolado de ATRASO no mesmo instante.
      ...(opts.excluirTarefaIds?.length ? { id: { notIn: opts.excluirTarefaIds } } : {}),
    },
    select: {
      id: true, titulo: true, responsavelId: true, dataPrazo: true,
      dataConclusao: true, statusTarefa: true, processoId: true,
    },
  })

  const r: RelatorioDaVarredura = {
    inicio: inicio.toISOString(), fim: inicio.toISOString(),
    avaliadas: candidatas.length, prazo: 0, hoje: 0, atraso: 0,
    deduplicados: 0, semDestinatario: 0, erros: 0, ensaio, previa: [],
  }

  for (const t of candidatas) {
    // O ESTADO TEMPORAL VEM DO MOTOR CANÔNICO. A varredura não decide se o SLA
    // pausou, nem conta dias por conta própria: `dataPrazo` já é o prazo
    // EFETIVO — `retomarSla` empurra a data quando a política manda pausar.
    const tempo = estadoTemporal({
      dataPrazo: t.dataPrazo,
      dataConclusao: t.dataConclusao,
      statusTarefa: t.statusTarefa,
      agora,
    })
    const tipo: 'PRAZO' | 'HOJE' | 'ATRASO' | null =
      tempo.atrasado ? 'ATRASO' : tempo.venceHoje ? 'HOJE' : tempo.venceAmanha ? 'PRAZO' : null
    if (tipo == null) continue

    if (t.responsavelId == null) { r.semDestinatario++; continue }

    const contar = (n: 'PRAZO' | 'HOJE' | 'ATRASO') =>
      n === 'ATRASO' ? r.atraso++ : n === 'HOJE' ? r.hoje++ : r.prazo++

    if (ensaio) {
      // No ensaio a idempotência também é conferida: o número que o gestor lê
      // antes de ligar precisa ser o que REALMENTE seria enviado.
      const chave = marcoDoPrazo(tipo, t.id, t.dataPrazo!)
      const ja = await prisma.notificacaoOperacional.findUnique({
        where: { chaveIdempotencia: chave }, select: { id: true },
      })
      if (ja) { r.deduplicados++; continue }
      r.previa.push({
        tarefaId: t.id, tipo, destinatarioId: t.responsavelId,
        titulo: t.titulo, prazo: diaOperacional(t.dataPrazo!),
      })
      contar(tipo)
      continue
    }

    try {
      const data = t.dataPrazo!.toLocaleDateString('pt-BR', { timeZone: FUSO_OPERACIONAL })
      const criada = await prisma.$transaction((tx) =>
        notificarAcontecimento(tx, {
          tipo,
          destinatarioId: t.responsavelId!,
          tarefaId: t.id,
          titulo: tipo === 'ATRASO' ? 'Prazo vencido' : tipo === 'HOJE' ? 'Vence hoje' : 'Prazo próximo',
          mensagem: tipo === 'ATRASO'
            ? `${t.titulo} — o prazo de conclusão era ${data}.`
            : tipo === 'HOJE'
              ? `${t.titulo} — o prazo de conclusão é hoje, ${data}.`
              : `${t.titulo} — conclusão esperada até ${data}.`,
          link: linkDaTarefa(t.id, t.processoId),
          chaveIdempotencia: marcoDoPrazo(tipo, t.id, t.dataPrazo!),
        }),
      )
      if (criada.criada) contar(tipo)
      else r.deduplicados++
    } catch (e) {
      // UMA TAREFA QUE FALHA NÃO DERRUBA A VARREDURA. O marco dela continua
      // sem aviso, e a próxima execução o recupera — é para isso que a
      // identidade do marco não depende do dia da varredura.
      r.erros++
      console.error(`[avisos] falha ao avisar tarefa ${t.id}:`, e)
    }
  }

  r.fim = new Date().toISOString()
  return r
}

// ═══════════════════════════════════════════════════════════════════════════
// ATENÇÃO OPERACIONAL — retorno de terceiro, acompanhamento vencido, EM_RISCO
// ═══════════════════════════════════════════════════════════════════════════

export type TipoDeAtencao = 'RETORNO_TERCEIRO' | 'ACOMPANHAMENTO_VENCIDO' | 'EM_RISCO'

export interface RelatorioDeAtencao {
  inicio: string
  fim: string
  avaliadas: number
  retorno: number
  acompanhamento: number
  risco: number
  deduplicados: number
  semDestinatario: number
  erros: number
  ensaio: boolean
  previa: Array<{ tarefaId: number; tipo: TipoDeAtencao; destinatarioId: number; titulo: string }>
}

/**
 * A VARREDURA DE ATENÇÃO — retorno de terceiro, acompanhamento vencido e
 * ENTRADA em EM_RISCO, lidos do núcleo canônico da Etapa 3
 * (`estadosTemporaisDasOperacoes`). Etapa 4, itens 7/8/9/19.
 *
 * ─── A FILA NÃO DEPENDE DISTO ───────────────────────────────────────────────
 * `proximo-acontecimento.ts` já é a garantia primária (item 8): esta função
 * NUNCA escreve prazo, status, workflow, responsável ou histórico — só decide
 * se um FATO já visível na leitura canônica merece notificação. Falhar aqui
 * (erro de rede, notificação não persistida) não tira a operação da fila nem
 * do estado de risco: a próxima leitura da tela mostra a mesma coisa,
 * notificado ou não. Isso é o que o CASO 18 exige.
 *
 * ─── TRÊS CHAVES, TRÊS DESENHOS DE IDEMPOTÊNCIA DIFERENTES ──────────────────
 * RETORNO_TERCEIRO   → chave = tarefa + `retornoFatoChave` (a identidade do
 *                       FATO: a solicitação ou o contato específico). Um retry
 *                       do MESMO retorno cai na mesma chave; um retorno NOVO
 *                       (nova solicitação, novo contato) tem uma chave nova,
 *                       legitimamente — não é duplicação, é um fato novo.
 * ACOMPANHAMENTO_VENCIDO → chave = tarefa + a DATA agendada específica. A
 *                       mesma data nunca renotifica (item 8: "não notificar
 *                       repetidamente a cada leitura/job"); reagendar para uma
 *                       data nova é o fluxo normal reabrindo o marco.
 * EM_RISCO            → chave = tarefa + `motivosRisco` ORDENADO, SEM
 *                       componente de dia. Permanecer em risco pelo MESMO
 *                       motivo nunca renotifica (item 9: "permanecer não
 *                       renotifica continuamente"); o motivo mudar de verdade
 *                       é que produz uma chave nova — a própria chave
 *                       carrega a transição, sem precisar guardar "estava em
 *                       risco antes?" em lugar nenhum.
 *
 * ─── QUEM RECEBE ─────────────────────────────────────────────────────────────
 * O responsável ATUAL da tarefa — a mesma regra de `avisarPrazosEAtrasos`.
 * Tarefa sem responsável (`SEM_RESPONSAVEL_PARA_PROXIMA_ACAO`) não tem a quem
 * notificar: a fila continua sendo a garantia, e a fila não exige destinatário.
 * Escalonamento para admin em EM_RISCO estrutural/crítico (item 9, "pode
 * notificar admin") fica de fora desta rodada — classificar
 * "estrutural/crítico" a partir de `motivosRisco` hoje seria a heurística
 * frágil que o item 5 proíbe por analogia; registrado como dívida (item T).
 */
export async function avisarAcontecimentosOperacionais(
  opts: { agora?: Date; ensaio?: boolean; excluirTarefaIds?: number[] } = {},
): Promise<RelatorioDeAtencao> {
  const agora = opts.agora ?? new Date()
  const ensaio = opts.ensaio === true
  const inicio = new Date()

  const abertas = await prisma.tarefa.findMany({
    where: {
      statusTarefa: { notIn: STATUS_TERMINAIS },
      // Mesma exclusão opcional de `avisarPrazosEAtrasos` — ver o comentário
      // lá. Vazio/omitido não muda nada para nenhum chamador existente.
      ...(opts.excluirTarefaIds?.length ? { id: { notIn: opts.excluirTarefaIds } } : {}),
    },
    select: { id: true, titulo: true, processoId: true },
  })
  const tituloPorTarefa = new Map(abertas.map((t) => [t.id, t.titulo]))
  const processoPorTarefa = new Map(abertas.map((t) => [t.id, t.processoId]))
  const estados = await estadosTemporaisDasOperacoes(prisma, abertas.map((t) => t.id), agora)

  const r: RelatorioDeAtencao = {
    inicio: inicio.toISOString(), fim: inicio.toISOString(),
    avaliadas: abertas.length, retorno: 0, acompanhamento: 0, risco: 0,
    deduplicados: 0, semDestinatario: 0, erros: 0, ensaio, previa: [],
  }

  const contar = (n: TipoDeAtencao) =>
    n === 'RETORNO_TERCEIRO' ? r.retorno++ : n === 'ACOMPANHAMENTO_VENCIDO' ? r.acompanhamento++ : r.risco++

  for (const [tarefaId, estado] of estados) {
    const titulo = tituloPorTarefa.get(tarefaId) ?? `Tarefa ${tarefaId}`
    const processoId = processoPorTarefa.get(tarefaId) ?? null
    const destinatarioId = estado.proximoAcontecimento.responsavelId

    if (destinatarioId == null) {
      // Havia um fato notificável, mas ninguém para receber — a fila continua
      // sendo a garantia (item 8); aqui só contamos o caso em vez de escondê-lo.
      // `emRisco` não entra mais: deixou de ser fato notificável (ver acima).
      if (estado.retornoRecebido || estado.acompanhamentoVencido) r.semDestinatario++
      continue
    }

    const acontecimentos: Array<{
      tipo: TipoDeAtencao
      chave: string
      titulo: string
      mensagem: string
    }> = []

    // A chave carrega SEMPRE o destinatário — a mesma identidade de fato, para
    // DUAS pessoas diferentes, são duas notificações, não uma. Sem isto, uma
    // transferência (item 17/CASO 15) faria o novo responsável nunca ser
    // avisado de um risco/retorno/acompanhamento que o antigo já tinha visto:
    // a chave já "existiria" para aquele fato, mesmo para outro destinatário.

    // ── RETORNO DE TERCEIRO — item 7: ação necessária imediata ───────────────
    if (estado.retornoRecebido && estado.retornoFatoChave) {
      acontecimentos.push({
        tipo: 'RETORNO_TERCEIRO',
        chave: `notif::retorno_terceiro::t${tarefaId}::${estado.retornoFatoChave}::u${destinatarioId}`,
        titulo: 'Retorno recebido — ação necessária',
        mensagem: `${titulo} — o terceiro respondeu; a operação precisa de ação interna.`,
      })
    }

    // ── ACOMPANHAMENTO VENCIDO — item 8: 1 por data agendada ──────────────────
    if (estado.acompanhamentoVencido && estado.proximoAcompanhamentoData) {
      acontecimentos.push({
        tipo: 'ACOMPANHAMENTO_VENCIDO',
        chave: `notif::acompanhamento_vencido::t${tarefaId}::${diaOperacional(new Date(estado.proximoAcompanhamentoData))}::u${destinatarioId}`,
        titulo: 'Acompanhamento vencido',
        mensagem: `${titulo} — a data de acompanhamento já passou.`,
      })
    }

    // EM_RISCO NÃO NOTIFICA MAIS (correção 15/09/2026, decisão do
    // Administrador) — "em risco" é diagnóstico de CONFIGURAÇÃO (o motor não
    // conseguiu determinar previsão/acompanhamento), não uma urgência da
    // operadora. Continuar mandando "Operação em risco" pro sino dela seria a
    // mesma leitura errada que já saiu do card/chip/coluna SITUAÇÃO — só que
    // proativa. Quem trata isso agora é a Saúde do Sistema (EMI-022, que lê
    // o mesmo `motivosRisco`/`emRisco`; a leitura continua existindo, só não
    // vira mais um FATO notificável aqui). `TipoDeAtencao`/`RelatorioDeAtencao.risco`
    // ficam no tipo por compatibilidade de forma — sempre zero na prática.

    for (const a of acontecimentos) {
      if (ensaio) {
        const ja = await prisma.notificacaoOperacional.findUnique({
          where: { chaveIdempotencia: a.chave }, select: { id: true },
        })
        if (ja) { r.deduplicados++; continue }
        r.previa.push({ tarefaId, tipo: a.tipo, destinatarioId, titulo: a.titulo })
        contar(a.tipo)
        continue
      }

      try {
        const criada = await prisma.$transaction((tx) =>
          notificarAcontecimento(tx, {
            tipo: a.tipo,
            destinatarioId,
            tarefaId,
            titulo: a.titulo,
            mensagem: a.mensagem,
            link: linkDaTarefa(tarefaId, processoId),
            chaveIdempotencia: a.chave,
          }),
        )
        if (criada.criada) contar(a.tipo)
        else r.deduplicados++
      } catch (e) {
        r.erros++
        console.error(`[atencao] falha ao notificar tarefa ${tarefaId} (${a.tipo}):`, e)
      }
    }
  }

  r.fim = new Date().toISOString()
  return r
}

// ═══════════════════════════════════════════════════════════════════════════
// ATENÇÃO CONSOLIDADA — a mesma verdade da Minha Operação, uma notificação
// por colisão (mandato "consolidação do sino", 19/09/2026)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * O TIPO PRINCIPAL de uma notificação consolidada — a mesma precedência que
 * `classificarAtencaoOperacional` já usa para decidir a fila principal da
 * Minha Operação (atraso interno → terceiro atrasado → acompanhamento). Não
 * é uma segunda regra: é a mesma lida a partir do conjunto de `motivos`.
 */
export type TipoAtencaoConsolidada = 'ATRASO' | 'ACOMPANHAMENTO_VENCIDO' | 'TERCEIRO_ATRASADO'

export function tipoPrincipalDeAtencao(motivos: MotivoAtencao[]): TipoAtencaoConsolidada | null {
  if (motivos.includes('PRAZO_TAREFA_VENCIDO')) return 'ATRASO'
  if (motivos.includes('ACOMPANHAMENTO_DEVIDO')) return 'ACOMPANHAMENTO_VENCIDO'
  if (motivos.includes('TERCEIRO_ATRASADO')) return 'TERCEIRO_ATRASADO'
  return null
}

/**
 * A CHAVE DO ACONTECIMENTO CONSOLIDADO — tarefa + destinatário + o CONJUNTO
 * de motivos ativos, ordenado. Mesmo desenho de `EM_RISCO` (o único marco
 * que já precisava de "chave por conjunto de motivos" antes desta rodada):
 * sem componente de dia, então permanecer com o MESMO conjunto de motivos
 * nunca renotifica — é o mesmo fato, ainda válido. O conjunto MUDAR (um
 * motivo a mais, ou a menos) é um fato novo, com chave nova. O sino continua
 * notificando acontecimentos, nunca virando espelho permanente dos relógios.
 */
export function chaveDeAtencaoConsolidada(tarefaId: number, motivos: MotivoAtencao[], destinatarioId: number): string {
  return `notif::atencao::t${tarefaId}::${[...motivos].sort().join('+')}::u${destinatarioId}`
}

export interface RelatorioDeAtencaoConsolidada {
  inicio: string
  fim: string
  avaliadas: number
  consolidadas: number
  deduplicadas: number
  semDestinatario: number
  erros: number
  ensaio: boolean
  /** Os taskIds que esta varredura já notificou — os OUTROS dois crons devem
   *  excluí-los (`excluirTarefaIds`) para a MESMA tarefa nunca receber um
   *  segundo aviso isolado (ATRASO/ACOMPANHAMENTO_VENCIDO) no mesmo instante. */
  tarefasConsolidadas: number[]
  previa: Array<{ tarefaId: number; tipo: TipoAtencaoConsolidada; motivos: MotivoAtencao[]; destinatarioId: number }>
}

/**
 * A VARREDURA CONSOLIDADA — lê a MESMA projeção da Minha Operação
 * (`visaoGerencial`, os mesmos `LinhaGerencial` que alimentam a fila real) e
 * usa a MESMA função pura de motivos (`motivosAtivos`, `atencao-operacional.
 * ts`) — nunca uma segunda leitura do relógio com semântica própria.
 *
 * ─── QUANDO ESTA VARREDURA ASSUME A TAREFA ──────────────────────────────────
 * Só quando NINGUÉM mais seria o dono natural do aviso:
 *   • 2+ motivos ativos ao mesmo tempo (a colisão que este mandato pede para
 *     nunca virar 2-3 notificações);
 *   • `TERCEIRO_ATRASADO` sozinho — dimensão nova (regra temporal da espera),
 *     `avisarPrazosEAtrasos`/`avisarAcontecimentosOperacionais` nunca a
 *     notificavam;
 *   • `ACOMPANHAMENTO_DEVIDO` sozinho, quando vem SÓ do relógio novo da
 *     subtarefa (`acompanhamentoPasso`) — `avisarAcontecimentosOperacionais`
 *     só sabe ler o relógio antigo da Tarefa (`estado.acompanhamentoVencido`);
 *     sem esta cláusula, a dimensão nova desta sessão nunca notificaria
 *     ninguém quando agisse sozinha.
 * Um único motivo com dono já existente (prazo isolado, acompanhamento
 * isolado do relógio antigo) continua sendo aviso DO DONO DE SEMPRE — os
 * formatos de chave testados há meses não mudam.
 */
export async function avisarAtencaoConsolidada(
  opts: { agora?: Date; ensaio?: boolean } = {},
): Promise<RelatorioDeAtencaoConsolidada> {
  const agora = opts.agora ?? new Date()
  const ensaio = opts.ensaio === true
  const inicio = new Date()

  const r: RelatorioDeAtencaoConsolidada = {
    inicio: inicio.toISOString(), fim: inicio.toISOString(),
    avaliadas: 0, consolidadas: 0, deduplicadas: 0, semDestinatario: 0, erros: 0,
    ensaio, tarefasConsolidadas: [], previa: [],
  }

  const porPagina = 500
  let pagina = 1
  for (;;) {
    const { linhas, total } = await visaoGerencial({ pagina, porPagina }, agora)
    r.avaliadas += linhas.length

    for (const l of linhas) {
      const motivos = motivosAtivos(l)
      const acompanhamentoSoViaSubtarefa =
        motivos.includes('ACOMPANHAMENTO_DEVIDO') && !l.acompanhamentoVencido &&
        (l.acompanhamentoPasso?.atrasado === true || l.acompanhamentoPasso?.venceHoje === true)
      const precisaConsolidar =
        motivos.length >= 2 || motivos.includes('TERCEIRO_ATRASADO') || acompanhamentoSoViaSubtarefa
      if (!precisaConsolidar) continue

      const tipo = tipoPrincipalDeAtencao(motivos)
      if (tipo == null) continue
      if (l.responsavelId == null) { r.semDestinatario++; continue }

      const chave = chaveDeAtencaoConsolidada(l.taskId, motivos, l.responsavelId)

      if (ensaio) {
        const ja = await prisma.notificacaoOperacional.findUnique({ where: { chaveIdempotencia: chave }, select: { id: true } })
        r.tarefasConsolidadas.push(l.taskId)
        if (ja) { r.deduplicadas++; continue }
        r.previa.push({ tarefaId: l.taskId, tipo, motivos, destinatarioId: l.responsavelId })
        r.consolidadas++
        continue
      }

      try {
        const criada = await prisma.$transaction((tx) => notificarAcontecimento(tx, {
          tipo,
          destinatarioId: l.responsavelId!,
          tarefaId: l.taskId,
          titulo: motivos.length > 1 ? 'Atenção necessária — múltiplos motivos' : ROTULO_MOTIVO[motivos[0]],
          mensagem: `${l.titulo} — ${motivos.map((m) => ROTULO_MOTIVO[m]).join('; ')}.`,
          link: linkDaTarefa(l.taskId, l.processoId),
          motivos,
          chaveIdempotencia: chave,
        }))
        r.tarefasConsolidadas.push(l.taskId)
        if (criada.criada) r.consolidadas++
        else r.deduplicadas++
      } catch (e) {
        r.erros++
        console.error(`[atencao-consolidada] falha ao notificar tarefa ${l.taskId}:`, e)
      }
    }

    if (pagina * porPagina >= total) break
    pagina++
  }

  r.fim = new Date().toISOString()
  return r
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
  // Só um FLAG interno para `atribuirTarefa` suprimir o aviso individual — não
  // é a chave de idempotência da notificação consolidada (essa é determinada
  // pelo CONTEÚDO do lote, abaixo, para sobreviver a um retry do mesmo POST).
  const loteId = randomUUID()

  for (const tarefaId of [...new Set(args.tarefaIds)]) {
    if (args.novoResponsavelId == null) {
      const { devolverAFila } = await import('./tarefa-ciclo')
      const r = await devolverAFila({ tarefaId, autorId: args.autorId, motivo: args.motivo ?? 'redistribuição em lote' })
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

  // NOTIFICAÇÃO CONSOLIDADA — UMA para o lote inteiro, nunca uma por tarefa.
  //
  // A chave vem do CONTEÚDO do lote (tarefas que de fato mudaram + destinatário
  // + dia operacional), não de `loteId` (que é gerado de novo a cada chamada e
  // por isso não sobreviveria a um retry do mesmo POST). Duas tentativas do
  // MESMO lote, no mesmo dia, produzem a MESMA chave — a segunda não duplica.
  if (sucesso > 0 && args.novoResponsavelId != null) {
    const idsComSucesso = itens.filter((i) => i.ok).map((i) => i.tarefaId).sort((a, b) => a - b)

    // CONTEXTO DO LOTE — item 5/9 do mandato (17/09/2026): "a unidade de
    // consolidação deve usar o contexto canônico apropriado (destinatário +
    // processo/família + evento)". Quando TODO o lote pertence ao MESMO
    // processo (o caso comum — Central/Distribuição agem sobre UMA família
    // por vez), a notificação carrega esse processo como âncora e o nome
    // dele no título: quem recebe sabe imediatamente ONDE, sem abrir nada.
    // Lote misto (processos diferentes) cai no título genérico de sempre —
    // nunca hardcoded a um nome específico.
    const tarefasDoLote = await prisma.tarefa.findMany({
      where: { id: { in: idsComSucesso } },
      select: { processoId: true, processo: { select: { nome: true } } },
    })
    const processoIdsUnicos = new Set(tarefasDoLote.map((t) => t.processoId).filter((id): id is number => id != null))
    const processoUnico = processoIdsUnicos.size === 1 ? [...processoIdsUnicos][0] : null
    const nomeProcessoUnico = processoUnico != null
      ? tarefasDoLote.find((t) => t.processoId === processoUnico)?.processo?.nome ?? null
      : null

    await notificarAcontecimento(prisma, {
      tipo: 'ATRIBUICAO_LOTE',
      destinatarioId: args.novoResponsavelId,
      processoId: processoUnico,
      autorId: args.autorId,
      titulo: nomeProcessoUnico
        ? `${nomeProcessoUnico} — ${sucesso} tarefa${sucesso === 1 ? '' : 's'} atribuída${sucesso === 1 ? '' : 's'} a você`
        : `${sucesso} nova${sucesso === 1 ? '' : 's'} operaç${sucesso === 1 ? 'ão' : 'ões'} atribuída${sucesso === 1 ? '' : 's'}`,
      mensagem: args.motivo ? `Redistribuição em lote. Motivo: ${args.motivo}` : 'Redistribuição em lote.',
      link: processoUnico != null ? urlMinhaOperacaoDoProcesso(processoUnico) : `/operacao?responsavel=${args.novoResponsavelId}`,
      chaveIdempotencia: `notif::atribuicao_lote::u${args.novoResponsavelId}::${diaOperacional(new Date())}::${idsComSucesso.join('-')}`,
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
        `${args.novoResponsavelId == null ? 'devolvidas à fila da equipe' : `passadas ao usuário ${args.novoResponsavelId}`}.` +
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
