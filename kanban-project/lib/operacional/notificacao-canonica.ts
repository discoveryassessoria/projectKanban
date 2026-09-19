// lib/operacional/notificacao-canonica.ts
// ============================================================================
// A PORTA CANÔNICA DE NOTIFICAÇÃO — Etapa 4 (12/09/2026).
//
// ─── REGRA-MÃE ───────────────────────────────────────────────────────────────
// Notificação é CONSEQUÊNCIA de um acontecimento canônico. NUNCA é source of
// truth da operação. Ler, arquivar ou marcar como lida uma notificação NUNCA
// altera Tarefa, workflow, prazo, SLA, ownership, acompanhamento, atenção,
// fase ou histórico — esta porta não tem NENHUMA escrita que toque essas
// entidades, de propósito.
//
// ─── UMA PORTA SÓ ────────────────────────────────────────────────────────────
// Toda notificação do sistema passa por `notificarAcontecimento`. Nenhuma
// rota, endpoint ou tela decide sozinha "isto merece um aviso" — decide aqui,
// ou não decide (a chamada simplesmente não acontece). `atribuirTarefa`
// (`tarefa-comandos.ts`) e `avisarPrazosEAtrasos` já usavam um `notificar()`
// próprio, criado antes desta consolidação; ele foi generalizado e move para
// cá — não existem mais dois lugares que sabem construir uma notificação.
//
// ─── DUAS ÂNCORAS, NUNCA A MESMA COLUNA PARA AS DUAS ────────────────────────
// `NotificacaoOperacional.tarefaId` (grão TAREFA — atribuição, retorno,
// acompanhamento, risco) e `.processoId` (grão PROCESSO — fase concluída).
// Uma notificação de LOTE (N tarefas, 1 aviso) não usa nenhuma das duas: as
// duas ficam null, porque a notificação não é sobre UMA tarefa nem sobre UM
// processo — é sobre um ATO que afetou várias. Callers nunca preenchem as
// duas ao mesmo tempo (documentado, não enforçado por CHECK — a única
// escritora é esta porta).
//
// ─── IDEMPOTÊNCIA ────────────────────────────────────────────────────────────
// `chaveIdempotencia` é montada pelo CHAMADOR, nunca aqui — porque só o
// chamador sabe qual é o FATO que não pode se repetir (o mesmo evento, a
// mesma versão, o mesmo dia operacional, o mesmo motivo de risco). Esta porta
// só garante que a MESMA chave nunca produz uma segunda linha: lê antes de
// criar (caminho comum, barato) e trata a colisão do `@unique` como sucesso
// (caminho de corrida, correto).
//
// ─── PROIBIDO NOTIFICAR ETAPA ───────────────────────────────────────────────
// "Passo 3 concluído" é detalhe interno da mesma tarefa — nunca vira
// notificação (comentário já no schema; reafirmado aqui em código).
// ============================================================================

import type { Prisma, PrismaClient } from "@prisma/client"

type Leitor = PrismaClient | Prisma.TransactionClient

/**
 * O CATÁLOGO FECHADO DE TIPOS — cada um corresponde a UMA linha da matriz
 * evento→notificação da Etapa 4. Um tipo novo é uma decisão de política, não
 * uma string livre inventada num endpoint.
 */
export const TIPOS_NOTIFICACAO = [
  "ATRIBUICAO",
  "TRANSFERENCIA",
  "ATRIBUICAO_LOTE",
  "PRAZO",
  "HOJE",
  "ATRASO",
  "RETORNO_TERCEIRO",
  "ACOMPANHAMENTO_VENCIDO",
  // REGRA TEMPORAL DA ESPERA VENCIDA (mandato "consolidação do sino",
  // 19/09/2026) — irmão de ACOMPANHAMENTO_VENCIDO, nunca a mesma fonte: um é
  // "quando volta à atenção", o outro é "limite da espera do terceiro". Ver
  // `MotivoAtencao.TERCEIRO_ATRASADO` (atencao-operacional.ts).
  "TERCEIRO_ATRASADO",
  "EM_RISCO",
  "FASE_CONCLUIDA",
  // OBRIGAÇÃO ADMINISTRATIVA (17/09/2026) — "N tarefas sem responsável" é UMA
  // necessidade de distribuir, nunca N notificações. Ver
  // lib/operacional/obrigacao-atribuicao.ts.
  "DISTRIBUICAO_NECESSARIA",
] as const
export type TipoNotificacao = (typeof TIPOS_NOTIFICACAO)[number]

export interface AcontecimentoNotificavel {
  tipo: TipoNotificacao
  destinatarioId: number
  /** Âncora de grão TAREFA. Nunca junto com `processoId`. */
  tarefaId?: number | null
  /** Âncora de grão PROCESSO (fase concluída/avançada). Nunca junto com `tarefaId`. */
  processoId?: number | null
  /** Quem provocou — nulo quando o marco é do motor/relógio, não de uma pessoa. */
  autorId?: number | null
  titulo: string
  mensagem?: string | null
  link?: string | null
  /**
   * OS MOTIVOS CONSOLIDADOS (mandato "consolidação do sino", 19/09/2026) —
   * `MotivoAtencao[]` quando este acontecimento vem da mesma leitura
   * operacional da Minha Operação (`motivosAtivos`). `tipo` continua sendo o
   * rótulo principal; isto é o payload completo, para a MESMA Tarefa nunca
   * gerar duas notificações quando dois relógios vencem juntos. `null`/
   * omitido para os tipos que não passam por essa leitura (ATRIBUICAO,
   * TRANSFERENCIA, RETORNO_TERCEIRO, FASE_CONCLUIDA...).
   */
  motivos?: string[] | null
  /**
   * A CHAVE COMPLETA — montada pelo chamador, que é quem conhece o FATO que
   * não pode se repetir. Esta porta não deriva nada dela; só garante unicidade.
   */
  chaveIdempotencia: string
}

export interface ResultadoNotificacao {
  id: number
  /** `false` quando a chave já existia — a MESMA notificação, não uma nova. */
  criada: boolean
}

/**
 * A ÚNICA FUNÇÃO QUE CRIA `NotificacaoOperacional`.
 *
 * Idempotente por `chaveIdempotencia`: reenviar o mesmo acontecimento (retry,
 * job repetido, reconciliação) devolve a notificação que já existe, nunca
 * cria uma segunda. A leitura prévia é o caminho barato; o catch de `P2002` é
 * o que resolve a corrida entre duas execuções concorrentes que leram "não
 * existe" ao mesmo tempo.
 */
export async function notificarAcontecimento(
  db: Leitor,
  e: AcontecimentoNotificavel,
): Promise<ResultadoNotificacao> {
  if (e.tarefaId != null && e.processoId != null) {
    throw new Error(
      `notificarAcontecimento: âncora ambígua — tarefaId=${e.tarefaId} e processoId=${e.processoId} juntos. ` +
        `Uma notificação é de UM grão só.`,
    )
  }

  const existente = await db.notificacaoOperacional.findUnique({
    where: { chaveIdempotencia: e.chaveIdempotencia },
    select: { id: true },
  })
  if (existente) return { id: existente.id, criada: false }

  try {
    const criada = await db.notificacaoOperacional.create({
      data: {
        tipo: e.tipo,
        destinatarioId: e.destinatarioId,
        tarefaId: e.tarefaId ?? null,
        processoId: e.processoId ?? null,
        titulo: e.titulo.slice(0, 200),
        mensagem: e.mensagem ?? null,
        link: e.link ?? null,
        autorId: e.autorId ?? null,
        motivos: e.motivos ?? undefined,
        chaveIdempotencia: e.chaveIdempotencia,
      },
      select: { id: true },
    })
    return { id: criada.id, criada: true }
  } catch (err) {
    if ((err as { code?: string })?.code !== "P2002") throw err
    const jaExiste = await db.notificacaoOperacional.findUnique({
      where: { chaveIdempotencia: e.chaveIdempotencia },
      select: { id: true },
    })
    return { id: jaExiste?.id ?? 0, criada: false }
  }
}

/**
 * MARCAR COMO LIDA — a ÚNICA escrita que "ler uma notificação" pode fazer.
 * Nunca toca em nenhuma outra entidade. Idempotente por natureza: marcar de
 * novo uma já lida não muda o `lidaEm` original.
 */
export async function marcarNotificacaoComoLida(
  db: Leitor,
  args: { notificacaoId: number; usuarioId: number },
): Promise<{ ok: true } | { ok: false; codigo: "NAO_ENCONTRADA" | "NAO_E_O_DESTINATARIO" }> {
  const n = await db.notificacaoOperacional.findUnique({
    where: { id: args.notificacaoId },
    select: { id: true, destinatarioId: true, lidaEm: true },
  })
  if (!n) return { ok: false, codigo: "NAO_ENCONTRADA" }
  // RBAC: só o próprio destinatário marca a sua notificação como lida — nunca
  // um endpoint aberto a qualquer usuário autenticado.
  if (n.destinatarioId !== args.usuarioId) return { ok: false, codigo: "NAO_E_O_DESTINATARIO" }
  if (n.lidaEm == null) {
    await db.notificacaoOperacional.update({ where: { id: n.id }, data: { lidaEm: new Date() } })
  }
  return { ok: true }
}

/**
 * MARCAR COMO LIDA A NOTIFICAÇÃO DE ATRIBUIÇÃO/TRANSFERÊNCIA — quando o
 * RESPONSÁVEL da tarefa gera progresso de verdade.
 *
 * "Você recebeu esta tarefa" deixa de precisar de sino no instante em que a
 * própria pessoa AGE sobre ela — continuar mostrando é ruído: ela já sabe.
 * "Agir" não é só iniciar: CONCLUIR (com ou sem passar por EM_ANDAMENTO
 * antes — uma tarefa transversal pode concluir direto) e CANCELAR também são
 * progresso real, e todos chamam esta MESMA porta (`iniciarTarefa` em
 * tarefa-comandos.ts, `concluirTarefaSemWorkflow`/`cancelarTarefaNucleo` em
 * tarefa-ciclo.ts, e `concluirPasso` em task-step-sync.ts para o caminho mais
 * comum — workflow concluindo sem que ninguém tenha clicado "Iniciar" à
 * parte). Só ATRIBUICAO/TRANSFERENCIA fecham aqui — são as ÚNICAS cujo
 * propósito ("avise que isto chegou para você") se cumpre com qualquer
 * dessas ações; PRAZO/ATRASO/RETORNO_TERCEIRO/EM_RISCO/FASE_CONCLUIDA
 * continuam abertas, porque agir na tarefa não resolve o fato que elas avisam.
 */
export async function marcarAtribuicaoComoLidaAoProgredir(
  db: Leitor,
  args: { tarefaId: number; destinatarioId: number },
): Promise<{ quantidade: number }> {
  const r = await db.notificacaoOperacional.updateMany({
    where: {
      tarefaId: args.tarefaId,
      destinatarioId: args.destinatarioId,
      tipo: { in: ["ATRIBUICAO", "TRANSFERENCIA"] },
      lidaEm: null,
    },
    data: { lidaEm: new Date() },
  })
  return { quantidade: r.count }
}
