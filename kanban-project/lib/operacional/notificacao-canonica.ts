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

import { Prisma, type PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import {
  textoDoAviso, idsDoResumo, resumoTemConteudo, FAMILIA_AVULSA,
  type TipoAviso, type ResumoDoAviso,
} from "./aviso-texto"

export type { TipoAviso, ResumoDoAviso } from "./aviso-texto"

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
 * @deprecated LEGADO (redesenho do sino, 29/09/2026) — escreve o modelo ANTIGO (um
 * aviso por tarefa, `agrupado = false`), que o sino não lê mais. Nenhum código de
 * produção chama esta função: `guard-sino-agrupado.test.ts` reprova quem chamar. O
 * caminho vivo é `somarAoAviso` / `gravarFotoDoAviso` (mais abaixo).
 *
 * A ÚNICA FUNÇÃO QUE CRIA `NotificacaoOperacional` NO MODELO ANTIGO.
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
    select: { id: true, destinatarioId: true, lidaEm: true, tipo: true, processoId: true },
  })
  if (!n) return { ok: false, codigo: "NAO_ENCONTRADA" }
  // RBAC: só o próprio destinatário marca a sua notificação como lida — nunca
  // um endpoint aberto a qualquer usuário autenticado.
  if (n.destinatarioId !== args.usuarioId) return { ok: false, codigo: "NAO_E_O_DESTINATARIO" }
  if (n.lidaEm == null) {
    await db.notificacaoOperacional.update({ where: { id: n.id }, data: { lidaEm: new Date() } })
  }
  // MENÇÃO (Torre nova, H): abrir/ler o aviso do sino marca as menções daquela família como lidas.
  if (n.tipo === "MENCAO") await marcarMencoesDoProcessoComoLidas(db, { usuarioId: args.usuarioId, processoId: n.processoId })
  return { ok: true }
}

/**
 * A PESSOA AGIU NA TAREFA — ela sai do aviso "chegou trabalho".
 *
 * "Você recebeu esta tarefa" deixa de valer no instante em que a própria pessoa AGE
 * (iniciar, concluir, cancelar): continuar contando essa tarefa no aviso é ruído — ela
 * já sabe. No modelo agrupado o aviso é UM por família, então agir numa tarefa a
 * RETIRA do aviso (contagem e texto recompostos; aviso vazio deixa de existir), em vez
 * de marcar o aviso inteiro como lido. Só CHEGOU_TRABALHO: PRECISA_AGIR e
 * MUDOU_DE_MAO não se resolvem por agir numa tarefa.
 */
export async function marcarAtribuicaoComoLidaAoProgredir(
  db: Leitor,
  args: { tarefaId: number; destinatarioId: number },
): Promise<{ quantidade: number }> {
  const avisos = await db.notificacaoOperacional.findMany({
    where: {
      destinatarioId: args.destinatarioId, tipo: "CHEGOU_TRABALHO", agrupado: true,
      lidaEm: null, tarefaIds: { has: args.tarefaId },
    },
    select: { id: true, tarefaIds: true, processoId: true, processo: SELECT_ROTULO_FAMILIA },
  })
  for (const a of avisos) {
    const restantes = a.tarefaIds.filter((id) => id !== args.tarefaId)
    if (restantes.length === 0) {
      await db.notificacaoOperacional.delete({ where: { id: a.id } })
    } else {
      await db.notificacaoOperacional.update({
        where: { id: a.id },
        data: {
          tarefaIds: restantes, contagem: restantes.length,
          titulo: textoDoAviso("CHEGOU_TRABALHO", rotuloDaFamilia(a.processo), { contagem: restantes.length }).slice(0, 200),
        },
      })
    }
  }
  // Concluir/cancelar também tira a tarefa do PRECISA_AGIR (e de qualquer aviso que a
  // liste) na hora — o mesmo estado atual que a regra 5 usa. Iniciar não muda nada aqui.
  await sincronizarAvisosDeTarefas(db, [args.tarefaId])
  return { quantidade: avisos.length }
}

// ============================================================================
// O SINO AGRUPADO — redesenho de 29/09/2026
//
// PRINCÍPIO: o sino mostra o que é NOVO desde a última vez que a pessoa olhou. A
// lista de pendências é a Operação. Nunca um aviso por certidão.
//
// UM aviso NÃO LIDO por (destinatário, família, tipo) — `processoId` aqui é a FAMÍLIA.
// O fato novo soma no aviso aberto (e ele volta ao topo); depois do clique, o próximo
// fato abre um aviso novo. A trava é dupla: aplicação (advisory lock + "acha ou cria")
// e banco (índice único parcial `NotificacaoOperacional_um_aberto_por_familia_tipo`,
// migration 20260929230000).
//
// Toda escrita do modelo novo passa por AQUI. Ler/marcar como lida continua sendo a
// única coisa que o clique faz — nenhuma dessas funções toca Tarefa, workflow, prazo,
// fase ou histórico.
// ============================================================================

export const TIPOS_AVISO_OPERADOR = ["CHEGOU_TRABALHO", "PRECISA_AGIR", "MUDOU_DE_MAO", "MENCAO"] as const
export const TIPOS_AVISO_GESTOR = ["ESCALADA", "SEM_RESPONSAVEL", "INTEGRIDADE", "FASE_CONCLUIDA"] as const
export const TIPOS_AVISO: readonly TipoAviso[] = [...TIPOS_AVISO_OPERADOR, ...TIPOS_AVISO_GESTOR]

// ─── MENÇÃO (@) — Torre nova, frente H ───────────────────────────────────────
// A menção entrega pelo MESMO sino agrupado (tipo MENCAO, um aviso aberto por (pessoa, família)); a leitura fecha o ciclo:
// abrir o aviso (`marcarNotificacaoComoLida`), "marcar todas" ou abrir a página do processo (#comentarios →
// PATCH /api/comentarios/mencoes { processoId }) marcam `ComentarioMencao.lidaEm` — o resumo diário só ressurge o que ainda não foi lido.

/** Marca como lidas as menções do usuário que pertencem ao processo (comentário da família do processo ou de tarefa dele). `processoId` nulo = menções sem processo resolvível. */
export async function marcarMencoesDoProcessoComoLidas(
  db: Leitor, args: { usuarioId: number; processoId: number | null }, agora = new Date(),
): Promise<{ quantidade: number }> {
  const doProcesso: Prisma.ComentarioTarefaWhereInput = args.processoId != null
    ? { OR: [{ tarefa: { processoId: args.processoId } }, { familia: { processos: { some: { id: args.processoId } } } }] }
    : { OR: [{ tarefa: { processoId: null } }, { familia: { processos: { none: {} } } }] }
  const r = await db.comentarioMencao.updateMany({
    where: { usuarioId: args.usuarioId, lidaEm: null, comentario: doProcesso },
    data: { lidaEm: agora },
  })
  // O aviso MENCAO daquela família deixa o sino junto (lido pela página ≡ lido pelo sino).
  await db.notificacaoOperacional.updateMany({
    where: { destinatarioId: args.usuarioId, tipo: "MENCAO", agrupado: true, lidaEm: null, processoId: args.processoId },
    data: { lidaEm: agora },
  })
  return { quantidade: r.count }
}

/** Aviso não clicado expira em 7 dias. */
export const VALIDADE_NAO_LIDO_DIAS = 7
/** Lido fica em "Ver anteriores" por 30 dias e depois é apagado. */
export const RETENCAO_LIDO_DIAS = 30
const DIA_MS = 86_400_000

/**
 * Serializa quem escreve o MESMO (destinatário, família, tipo): sem isto, duas
 * varreduras/atribuições simultâneas leem "não existe" ao mesmo tempo e uma delas bate
 * no índice único — o que ABORTA a transação inteira em Postgres. O lock é de
 * transação (`xact`): solta sozinho no commit/rollback.
 */
async function comTrava<T>(
  db: Leitor, destinatarioId: number, processoId: number | null, tipo: string,
  fn: (tx: Leitor) => Promise<T>,
): Promise<T> {
  const executar = async (tx: Leitor) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${destinatarioId}::int, hashtext(${`${processoId ?? 0}|${tipo}`}))`
    return fn(tx)
  }
  const cliente = db as PrismaClient
  if (typeof cliente.$transaction === "function") return cliente.$transaction((tx) => executar(tx))
  return executar(db)
}

/**
 * O RÓTULO DA FAMÍLIA no aviso: o cadastro de Família do processo quando existe, senão
 * o nome do processo. O aviso é ANCORADO no processo (é o id que a Operação entende em
 * `?processo=`); só o texto usa o nome da família.
 */
export const SELECT_ROTULO_FAMILIA = { select: { nome: true, familia: { select: { nome: true } } } } as const
export const rotuloDaFamilia = (p: { nome: string; familia?: { nome: string } | null } | null | undefined): string | null =>
  p ? (p.familia?.nome?.trim() || p.nome) : null

const ordenar = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b)

function normalizarResumo(r: ResumoDoAviso | null | undefined): ResumoDoAviso | null {
  if (!r) return null
  const out: ResumoDoAviso = {}
  if (r.vencidas) out.vencidas = ordenar(r.vencidas)
  if (r.hoje) out.hoje = ordenar(r.hoje)
  if (r.amanha) out.amanha = ordenar(r.amanha)
  if (r.cobrancas) out.cobrancas = ordenar(r.cobrancas)
  if (r.modo) out.modo = r.modo
  if (r.base) out.base = { vencidas: ordenar(r.base.vencidas), cobrancas: ordenar(r.base.cobrancas) }
  if (r.itens) out.itens = [...new Set(r.itens)].sort()
  if (r.ultima) out.ultima = r.ultima
  return out
}

const chaveDeLinha = (dest: number, proc: number | null, tipo: string) =>
  `aviso::u${dest}::p${proc ?? 0}::${tipo}::${randomUUID()}`

export interface FatoSomavel {
  tipo: "CHEGOU_TRABALHO" | "MUDOU_DE_MAO" | "FASE_CONCLUIDA" | "MENCAO"
  destinatarioId: number
  /** A FAMÍLIA. Nulo = tarefa avulsa (sem processo). */
  processoId: number | null
  familiaNome: string | null
  /** Tarefas que ESTE fato acrescenta ao aviso. */
  tarefaIds?: number[]
  /** Fatos que não são tarefa (fase concluída): chave estável de cada um — o replay não soma duas vezes. */
  itens?: string[]
  autorId?: number | null
  link: string
  /** MENCAO: quem mencionou por último + trecho (vira o texto do aviso). */
  ultima?: { autor: string; trecho: string }
}

export interface ResultadoAviso {
  id: number
  /** `true` = abriu um aviso novo; `false` = somou (ou nada mudou) num aberto. */
  criado: boolean
  contagem: number
}

/**
 * SOMAR OU CRIAR — o fato novo entra no aviso NÃO LIDO daquela (pessoa, família, tipo);
 * se não há aviso aberto (nunca houve, ou ela já clicou), abre um novo só com o que
 * acabou de acontecer ("1 tarefa"). Somar sobe o aviso ao topo (`atualizadoEm`).
 * Idempotente: reenviar o mesmo fato (mesmos ids/itens) não muda nada.
 */
export async function somarAoAviso(db: Leitor, f: FatoSomavel): Promise<ResultadoAviso> {
  const novosIds = ordenar(f.tarefaIds ?? [])
  const novosItens = [...new Set(f.itens ?? [])]
  return comTrava(db, f.destinatarioId, f.processoId, f.tipo, async (tx) => {
    const aberto = await tx.notificacaoOperacional.findFirst({
      where: { destinatarioId: f.destinatarioId, processoId: f.processoId, tipo: f.tipo, agrupado: true, lidaEm: null },
      select: { id: true, tarefaIds: true, resumo: true, contagem: true },
    })

    if (aberto) {
      const ids = ordenar([...aberto.tarefaIds, ...novosIds])
      const resumoAtual = (aberto.resumo ?? {}) as ResumoDoAviso
      const itens = [...new Set([...(resumoAtual.itens ?? []), ...novosItens])]
      const contagem = ids.length + itens.length
      if (contagem === aberto.contagem && ids.length === aberto.tarefaIds.length) {
        return { id: aberto.id, criado: false, contagem }
      }
      const resumoNovo: ResumoDoAviso | null = itens.length ? { ...resumoAtual, itens, ...(f.ultima ? { ultima: f.ultima } : {}) } : null
      await tx.notificacaoOperacional.update({
        where: { id: aberto.id },
        data: {
          tarefaIds: ids, contagem,
          resumo: (resumoNovo ?? (aberto.resumo ?? undefined)) as Prisma.InputJsonValue | undefined,
          titulo: textoDoAviso(f.tipo, f.familiaNome, { contagem, resumo: resumoNovo }).slice(0, 200),
          link: f.link, autorId: f.autorId ?? null, atualizadoEm: new Date(),
        },
      })
      return { id: aberto.id, criado: false, contagem }
    }

    const contagem = novosIds.length + novosItens.length
    const criada = await tx.notificacaoOperacional.create({
      data: {
        tipo: f.tipo, destinatarioId: f.destinatarioId, processoId: f.processoId, tarefaId: null,
        agrupado: true, tarefaIds: novosIds, contagem,
        resumo: (novosItens.length ? { itens: novosItens, ...(f.ultima ? { ultima: f.ultima } : {}) } : undefined) as Prisma.InputJsonValue | undefined,
        titulo: textoDoAviso(f.tipo, f.familiaNome, { contagem, resumo: f.ultima ? { ultima: f.ultima } : null }).slice(0, 200),
        link: f.link, autorId: f.autorId ?? null,
        chaveIdempotencia: chaveDeLinha(f.destinatarioId, f.processoId, f.tipo),
      },
      select: { id: true },
    })
    return { id: criada.id, criado: true, contagem }
  })
}

export interface FotoDeAviso {
  tipo: "PRECISA_AGIR" | "ESCALADA" | "SEM_RESPONSAVEL" | "INTEGRIDADE"
  destinatarioId: number
  processoId: number | null
  familiaNome: string | null
  /** PRECISA_AGIR: a foto por categoria. Os demais: não usam. */
  resumo?: ResumoDoAviso
  tarefaIds?: number[]
  itens?: string[]
  link: string
}

export type AcaoDaFoto = "CRIADO" | "ATUALIZADO" | "SEM_MUDANCA" | "REMOVIDO" | "NADA"

/**
 * GRAVAR A FOTO — para os avisos que são um ESTADO recomposto por varredura
 * (PRECISA_AGIR, ESCALADA, SEM_RESPONSAVEL, INTEGRIDADE), não uma soma de eventos.
 * Foto vazia ⇒ o aviso aberto deixa de existir. Foto igual à que já está aberta ⇒
 * nada muda (nem sobe ao topo: varredura de hora em hora não pode "renotificar").
 * Se a pessoa já clicou, a foto nova abre um aviso novo — quem decide SE deve abrir é
 * o chamador (`avisos-sino.ts`), que conhece a regra de "fato novo".
 */
export async function gravarFotoDoAviso(db: Leitor, f: FotoDeAviso): Promise<{ acao: AcaoDaFoto; id: number | null }> {
  const resumo = normalizarResumo(f.resumo)
  const tarefaIds = f.tipo === "PRECISA_AGIR" ? idsDoResumo(resumo) : ordenar(f.tarefaIds ?? [])
  const itens = f.itens ? [...new Set(f.itens)].sort() : []
  const contagem = tarefaIds.length + itens.length
  const temConteudo = f.tipo === "PRECISA_AGIR" ? resumoTemConteudo(resumo) : contagem > 0

  return comTrava(db, f.destinatarioId, f.processoId, f.tipo, async (tx) => {
    const aberto = await tx.notificacaoOperacional.findFirst({
      where: { destinatarioId: f.destinatarioId, processoId: f.processoId, tipo: f.tipo, agrupado: true, lidaEm: null },
      select: { id: true, tarefaIds: true, resumo: true, contagem: true, link: true },
    })

    if (!temConteudo) {
      if (!aberto) return { acao: "NADA" as const, id: null }
      await tx.notificacaoOperacional.delete({ where: { id: aberto.id } })
      return { acao: "REMOVIDO" as const, id: aberto.id }
    }

    const resumoGravado = f.tipo === "PRECISA_AGIR"
      ? resumo
      : itens.length ? { itens } as ResumoDoAviso : null
    const titulo = textoDoAviso(f.tipo, f.familiaNome, { contagem: f.tipo === "PRECISA_AGIR" ? tarefaIds.length : contagem, resumo }).slice(0, 200)

    if (aberto) {
      const igual =
        JSON.stringify(normalizarResumo(aberto.resumo as ResumoDoAviso | null)) === JSON.stringify(resumoGravado) &&
        JSON.stringify(ordenar(aberto.tarefaIds)) === JSON.stringify(tarefaIds) &&
        aberto.link === f.link
      if (igual) return { acao: "SEM_MUDANCA" as const, id: aberto.id }
      await tx.notificacaoOperacional.update({
        where: { id: aberto.id },
        data: {
          tarefaIds, contagem, titulo, link: f.link, atualizadoEm: new Date(),
          resumo: resumoGravado ? (resumoGravado as Prisma.InputJsonValue) : Prisma.DbNull,
        },
      })
      return { acao: "ATUALIZADO" as const, id: aberto.id }
    }

    const criada = await tx.notificacaoOperacional.create({
      data: {
        tipo: f.tipo, destinatarioId: f.destinatarioId, processoId: f.processoId, tarefaId: null,
        agrupado: true, tarefaIds, contagem, titulo, link: f.link,
        resumo: (resumoGravado ?? undefined) as Prisma.InputJsonValue | undefined,
        chaveIdempotencia: chaveDeLinha(f.destinatarioId, f.processoId, f.tipo),
      },
      select: { id: true },
    })
    return { acao: "CRIADO" as const, id: criada.id }
  })
}


/** Remove um aviso que já não diz nada (a foto do dia ficou vazia). Só a porta apaga. */
export async function removerAviso(db: Leitor, id: number): Promise<void> {
  await db.notificacaoOperacional.deleteMany({ where: { id } })
}

/**
 * MARCAR TODAS COMO LIDAS — o botão do sino. Só os avisos agrupados ainda válidos
 * (não expirados) do PRÓPRIO usuário.
 */
export async function marcarTodasComoLidas(db: Leitor, usuarioId: number, agora = new Date()): Promise<{ quantidade: number }> {
  const mencoes = await db.notificacaoOperacional.findMany({
    where: { destinatarioId: usuarioId, agrupado: true, lidaEm: null, tipo: "MENCAO" }, select: { processoId: true },
  })
  for (const m of mencoes) await marcarMencoesDoProcessoComoLidas(db, { usuarioId, processoId: m.processoId }, agora)
  const r = await db.notificacaoOperacional.updateMany({
    where: {
      destinatarioId: usuarioId, agrupado: true, lidaEm: null,
      atualizadoEm: { gte: new Date(agora.getTime() - VALIDADE_NAO_LIDO_DIAS * DIA_MS) },
    },
    data: { lidaEm: agora },
  })
  return { quantidade: r.count }
}

type StatusTerminal = "CONCLUIDO_RECEBIDO" | "CONCLUIDO_NAO_POSSUI" | "CANCELADA" | "SUPERSEDIDA"
const TERMINAIS: readonly string[] = ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"] satisfies StatusTerminal[]

/** A tarefa ainda tem motivo para constar neste aviso? Derivado do estado ATUAL da tarefa. */
function tarefaValeNoAviso(
  tipo: string, destinatarioId: number,
  t: { responsavelId: number | null; statusTarefa: string } | undefined,
): boolean {
  if (!t) return false // apagada
  if (TERMINAIS.includes(t.statusTarefa)) return false // concluída, cancelada, supersedida
  switch (tipo) {
    case "CHEGOU_TRABALHO":
    case "PRECISA_AGIR":
      return t.responsavelId === destinatarioId // reatribuída ou removida ⇒ não é mais dela
    case "SEM_RESPONSAVEL":
      return t.responsavelId == null
    default:
      return true
  }
}

const TIPOS_COM_TAREFA_VIVA = ["CHEGOU_TRABALHO", "PRECISA_AGIR", "SEM_RESPONSAVEL", "ESCALADA"]

/**
 * REGRA 5 — NENHUM AVISO DE TAREFA É MOSTRADO A QUEM NÃO É O RESPONSÁVEL ATUAL.
 *
 * Cobre os 5 casos com UMA regra derivada do estado atual da tarefa (não da causa):
 * reatribuída, removida (sem responsável), concluída, cancelada, supersedida. Retira a
 * tarefa dos avisos que a listam; aviso que fica sem nada deixa de existir. MUDOU_DE_MAO
 * nunca é tocado: é o registro de que a tarefa SAIU, e continua verdadeiro.
 *
 * Chamada nas portas que mudam dono/estado E, como rede de segurança, na leitura do
 * sino (`avisosDoSino`) — assim um caminho de escrita esquecido nunca vira aviso
 * errado na tela de ninguém.
 */
export async function sincronizarAvisosDeTarefas(db: Leitor, tarefaIds?: number[]): Promise<{ retiradas: number; avisosRemovidos: number; avisosAtualizados: number }> {
  const filtroIds = tarefaIds?.length ? { tarefaIds: { hasSome: tarefaIds } } : {}
  const avisos = await db.notificacaoOperacional.findMany({
    where: { agrupado: true, tipo: { in: TIPOS_COM_TAREFA_VIVA }, ...filtroIds },
    select: { id: true, tipo: true, destinatarioId: true, tarefaIds: true, resumo: true, processo: SELECT_ROTULO_FAMILIA },
  })
  if (avisos.length === 0) return { retiradas: 0, avisosRemovidos: 0, avisosAtualizados: 0 }

  const todosIds = [...new Set(avisos.flatMap((a) => a.tarefaIds))]
  const tarefas = await db.tarefa.findMany({
    where: { id: { in: todosIds } },
    select: { id: true, responsavelId: true, statusTarefa: true },
  })
  const porId = new Map(tarefas.map((t) => [t.id, t]))

  let retiradas = 0, avisosRemovidos = 0, avisosAtualizados = 0
  for (const a of avisos) {
    const fora = new Set(a.tarefaIds.filter((id) => !tarefaValeNoAviso(a.tipo, a.destinatarioId, porId.get(id))))
    if (fora.size === 0) continue
    retiradas += fora.size

    if (a.tipo === "PRECISA_AGIR") {
      const r = (a.resumo ?? {}) as ResumoDoAviso
      const sem = (ids?: number[]) => (ids ?? []).filter((id) => !fora.has(id))
      const novo: ResumoDoAviso = {
        ...r, vencidas: sem(r.vencidas), hoje: sem(r.hoje), amanha: sem(r.amanha), cobrancas: sem(r.cobrancas),
      }
      if (!resumoTemConteudo(novo)) { await db.notificacaoOperacional.delete({ where: { id: a.id } }); avisosRemovidos++; continue }
      const ids = idsDoResumo(novo)
      await db.notificacaoOperacional.update({
        where: { id: a.id },
        data: {
          resumo: novo as Prisma.InputJsonValue, tarefaIds: ids, contagem: ids.length,
          titulo: textoDoAviso("PRECISA_AGIR", rotuloDaFamilia(a.processo), { contagem: ids.length, resumo: novo }).slice(0, 200),
        },
      })
      avisosAtualizados++
      continue
    }

    const restantes = a.tarefaIds.filter((id) => !fora.has(id))
    if (restantes.length === 0) { await db.notificacaoOperacional.delete({ where: { id: a.id } }); avisosRemovidos++; continue }
    await db.notificacaoOperacional.update({
      where: { id: a.id },
      data: {
        tarefaIds: restantes, contagem: restantes.length,
        titulo: textoDoAviso(a.tipo as TipoAviso, rotuloDaFamilia(a.processo), { contagem: restantes.length }).slice(0, 200),
      },
    })
    avisosAtualizados++
  }
  return { retiradas, avisosRemovidos, avisosAtualizados }
}

/**
 * EXPURGO — não clicado expira em 7 dias; lido some depois de 30. Roda no cron horário.
 * (Um PRECISA_AGIR expirado que continua verdadeiro é recomposto pelo resumo das 07:00.)
 */
export async function expurgarAvisos(db: Leitor, agora = new Date()): Promise<{ expirados: number; apagadosLidos: number }> {
  const expirados = await db.notificacaoOperacional.deleteMany({
    where: { agrupado: true, lidaEm: null, atualizadoEm: { lt: new Date(agora.getTime() - VALIDADE_NAO_LIDO_DIAS * DIA_MS) } },
  })
  const apagadosLidos = await db.notificacaoOperacional.deleteMany({
    where: { agrupado: true, lidaEm: { lt: new Date(agora.getTime() - RETENCAO_LIDO_DIAS * DIA_MS) } },
  })
  return { expirados: expirados.count, apagadosLidos: apagadosLidos.count }
}

export interface AvisoDoSino {
  id: number
  tipo: TipoAviso
  titulo: string
  link: string | null
  familiaId: number | null
  contagem: number
  atualizadoEm: string
  lidaEm: string | null
}

const SELECT_AVISO = { id: true, tipo: true, titulo: true, link: true, processoId: true, contagem: true, atualizadoEm: true, lidaEm: true } as const
const paraAviso = (n: {
  id: number; tipo: string; titulo: string; link: string | null; processoId: number | null; contagem: number; atualizadoEm: Date; lidaEm: Date | null
}): AvisoDoSino => ({
  id: n.id, tipo: n.tipo as TipoAviso, titulo: n.titulo, link: n.link, familiaId: n.processoId,
  contagem: n.contagem, atualizadoEm: n.atualizadoEm.toISOString(), lidaEm: n.lidaEm?.toISOString() ?? null,
})

/**
 * O QUE O SINO MOSTRA — SÓ a tabela de avisos (nenhum balde recalculado a partir de
 * Tarefa). O contador é o número de avisos NÃO LIDOS e ainda válidos. `anteriores`
 * (lidos, até 30 dias) só é lido quando pedido.
 */
export async function avisosDoSino(
  db: Leitor, usuarioId: number,
  opts: { agora?: Date; comAnteriores?: boolean } = {},
): Promise<{ naoLidos: AvisoDoSino[]; anteriores: AvisoDoSino[]; total: number }> {
  const agora = opts.agora ?? new Date()
  // REDE DE SEGURANÇA da regra 5: antes de mostrar, tira do que ela vai ver qualquer
  // tarefa que já não é dela. Barato (um `hasSome` nos avisos DELA) e faz "some na hora"
  // valer mesmo que um caminho de escrita tenha esquecido de sincronizar.
  await sincronizarAvisosDoDestinatario(db, usuarioId)

  const naoLidos = await db.notificacaoOperacional.findMany({
    where: {
      destinatarioId: usuarioId, agrupado: true, lidaEm: null,
      atualizadoEm: { gte: new Date(agora.getTime() - VALIDADE_NAO_LIDO_DIAS * DIA_MS) },
    },
    select: SELECT_AVISO, orderBy: { atualizadoEm: "desc" }, take: 50,
  })
  const anteriores = opts.comAnteriores
    ? await db.notificacaoOperacional.findMany({
        where: {
          destinatarioId: usuarioId, agrupado: true,
          lidaEm: { gte: new Date(agora.getTime() - RETENCAO_LIDO_DIAS * DIA_MS) },
        },
        select: SELECT_AVISO, orderBy: { lidaEm: "desc" }, take: 50,
      })
    : []
  return { naoLidos: naoLidos.map(paraAviso), anteriores: anteriores.map(paraAviso), total: naoLidos.length }
}

async function sincronizarAvisosDoDestinatario(db: Leitor, usuarioId: number): Promise<void> {
  const meus = await db.notificacaoOperacional.findMany({
    where: { destinatarioId: usuarioId, agrupado: true, tipo: { in: TIPOS_COM_TAREFA_VIVA } },
    select: { tarefaIds: true },
  })
  const ids = [...new Set(meus.flatMap((a) => a.tarefaIds))]
  if (ids.length === 0) return
  await sincronizarAvisosDeTarefas(db, ids)
}

export { FAMILIA_AVULSA }
