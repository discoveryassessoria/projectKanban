// src/services/comentario-tarefa.ts
// ============================================================================
// COMENTÁRIOS COM @MENÇÃO — Torre de Controle, Bloco E4 (29/09/2026).
//
// Escopo é UMA das duas âncoras, nunca as duas: por TAREFA (a unidade de
// trabalho) ou por FAMÍLIA (o caso inteiro — `Familia`, "Cibils" etc., a
// mesma que o protótipo agrupa por `fam`). O banco não tem CHECK para isso —
// a única escritora é esta porta, mesmo padrão de `NotificacaoOperacional`.
//
// A MENÇÃO ENTREGA PELO SINO (Torre nova, frente H, 01/10/2026): na MESMA transação do comentário, o mencionado
// (≠ autor) recebe um aviso MENCAO no sino agrupado (`avisarMencao` → `somarAoAviso`, um aviso aberto por (pessoa,
// família), idempotente por comentário) e a menção entra no resumo diário (`rodarResumoDiario`). `ComentarioMencao.lidaEm`
// é o "lido": abrir o aviso do sino, "marcar todas" ou abrir a página do processo (#comentarios) o preenchem.
// Comentário de FAMÍLIA exige familiaId: processo sem família não tem âncora (422) — nunca se cria família aqui.
//
// TODA AÇÃO GRAVA LogAuditoria (Regra 6 do mandato) — criar um comentário é
// uma ação que muda estado (nasce uma menção, nasce uma notificação).
// ============================================================================
import { prisma } from '@/lib/prisma'
import { avisarMencao } from '@/lib/operacional/avisos-fatos'
import { rotuloDaFamilia, SELECT_ROTULO_FAMILIA } from '@/lib/operacional/notificacao-canonica'

export interface ComentarioCriado {
  id: number
  texto: string
  autorId: number
  autorNome: string
  criadoEm: string
  mencionados: Array<{ usuarioId: number; nome: string }>
}

const LIMITE_TEXTO = 4000

/** Extrai os `@usuarioId` do texto — a tela resolve nome→id antes de enviar
 * (mesmo padrão de qualquer editor de menção: o texto exibido tem o nome,
 * o payload envia o id resolvido). Formato: `@[Nome](usuarioId)`. */
export function idsMencionados(texto: string): number[] {
  const ids = new Set<number>()
  for (const m of texto.matchAll(/@\[[^\]]+\]\((\d+)\)/g)) {
    const id = Number(m[1])
    if (Number.isInteger(id) && id > 0) ids.add(id)
  }
  return [...ids]
}

/** CRIA um comentário — por tarefa OU por família, nunca as duas, nunca nenhuma. */
export async function criarComentario(args: {
  tarefaId?: number | null
  familiaId?: number | null
  /** Só para o link/rótulo do aviso: o processo da família que está aberto na tela (confere que pertence à família). */
  processoId?: number | null
  autorId: number
  texto: string
}): Promise<{ ok: true; comentario: ComentarioCriado } | { ok: false; erro: string }> {
  const tarefaId = args.tarefaId ?? null
  const familiaId = args.familiaId ?? null
  if ((tarefaId == null) === (familiaId == null)) {
    return { ok: false, erro: 'o comentário precisa de EXATAMENTE uma âncora: tarefaId OU familiaId' }
  }
  const texto = args.texto?.trim()
  if (!texto) return { ok: false, erro: 'o comentário não pode ser vazio' }
  if (texto.length > LIMITE_TEXTO) return { ok: false, erro: `o comentário passa de ${LIMITE_TEXTO} caracteres` }

  if (tarefaId != null) {
    const existe = await prisma.tarefa.findUnique({ where: { id: tarefaId }, select: { id: true } })
    if (!existe) return { ok: false, erro: 'tarefa não encontrada' }
  } else {
    const existe = await prisma.familia.findUnique({ where: { id: familiaId! }, select: { id: true } })
    if (!existe) return { ok: false, erro: 'família não encontrada' }
  }

  const idsCitados = idsMencionados(texto).filter((id) => id !== args.autorId)
  const usuariosValidos = idsCitados.length
    ? await prisma.usuario.findMany({ where: { id: { in: idsCitados } }, select: { id: true, nome: true, tipo: true } })
    : []

  // O PROCESSO do aviso: tarefa → o dela; família → o informado (se for da família) ou o mais recente da família.
  let processoDoAviso: { id: number; nome: string; familia: { nome: string } | null } | null = null
  if (usuariosValidos.length) {
    if (tarefaId != null) {
      const t = await prisma.tarefa.findUnique({ where: { id: tarefaId }, select: { processo: { select: { id: true, ...SELECT_ROTULO_FAMILIA.select } } } })
      processoDoAviso = t?.processo ?? null
    } else {
      const sel = { id: true, ...SELECT_ROTULO_FAMILIA.select }
      processoDoAviso = (args.processoId != null
        ? await prisma.processo.findFirst({ where: { id: args.processoId, familiaId: familiaId! }, select: sel })
        : null) ?? await prisma.processo.findFirst({ where: { familiaId: familiaId! }, orderBy: { id: 'desc' }, select: sel })
    }
  }
  const nomeDaFamilia = processoDoAviso
    ? rotuloDaFamilia(processoDoAviso)
    : familiaId != null ? (await prisma.familia.findUnique({ where: { id: familiaId }, select: { nome: true } }))?.nome ?? null : null

  const autor = await prisma.usuario.findUnique({ where: { id: args.autorId }, select: { nome: true } })
  if (!autor) return { ok: false, erro: 'autor não encontrado' }

  const criado = await prisma.$transaction(async (tx) => {
    const comentario = await tx.comentarioTarefa.create({
      data: {
        tarefaId, familiaId, autorId: args.autorId, texto,
        mencoes: { create: usuariosValidos.map((u) => ({ usuarioId: u.id })) },
      },
      select: { id: true, texto: true, criadoEm: true },
    })
    await tx.logAuditoria.create({
      data: {
        acao: 'COMENTARIO_CRIADO',
        entidade: tarefaId != null ? 'Tarefa' : 'Familia',
        entidadeId: tarefaId ?? familiaId,
        usuarioId: args.autorId,
        descricao: `${autor.nome} comentou em ${tarefaId != null ? `tarefa #${tarefaId}` : `família #${familiaId}`}` +
          (usuariosValidos.length ? ` — menções: ${usuariosValidos.map((u) => u.nome).join(', ')}` : ''),
        detalhes: { comentarioId: comentario.id, tarefaId, familiaId, processoId: processoDoAviso?.id ?? null, mencionados: usuariosValidos.map((u) => u.id) },
      },
    })
    // O AVISO NO SINO de cada mencionado — mesma transação: ou o comentário e as menções nascem juntos, ou nada.
    for (const u of usuariosValidos) {
      await avisarMencao(tx, {
        destinatarioId: u.id, destinatarioEhAdmin: u.tipo === 'admin', comentarioId: comentario.id,
        autorId: args.autorId, autorNome: autor.nome, texto, processoId: processoDoAviso?.id ?? null, familiaNome: nomeDaFamilia,
      })
    }
    return comentario
  })

  return {
    ok: true,
    comentario: {
      id: criado.id, texto: criado.texto, autorId: args.autorId, autorNome: autor.nome,
      criadoEm: criado.criadoEm.toISOString(),
      mencionados: usuariosValidos.map((u) => ({ usuarioId: u.id, nome: u.nome })),
    },
  }
}

export interface ComentarioListado {
  id: number
  texto: string
  autorId: number
  autorNome: string
  criadoEm: string
  mencionados: Array<{ usuarioId: number; nome: string; lidaEm: string | null }>
}

/** LISTA os comentários de UMA âncora, mais recente primeiro. */
export async function listarComentarios(
  args: { tarefaId?: number | null; familiaId?: number | null },
): Promise<ComentarioListado[]> {
  const where = args.tarefaId != null ? { tarefaId: args.tarefaId } : { familiaId: args.familiaId }
  const linhas = await prisma.comentarioTarefa.findMany({
    where,
    orderBy: { criadoEm: 'desc' },
    select: {
      id: true, texto: true, criadoEm: true, autorId: true,
      autor: { select: { nome: true } },
      mencoes: { select: { usuarioId: true, lidaEm: true, usuario: { select: { nome: true } } } },
    },
  })
  return linhas.map((l) => ({
    id: l.id, texto: l.texto, autorId: l.autorId, autorNome: l.autor.nome, criadoEm: l.criadoEm.toISOString(),
    mencionados: l.mencoes.map((m) => ({ usuarioId: m.usuarioId, nome: m.usuario.nome, lidaEm: m.lidaEm?.toISOString() ?? null })),
  }))
}

/** AS MENÇÕES NÃO LIDAS de um usuário — é a "notificação" da menção (Bloco E4). */
export async function mencoesNaoLidas(usuarioId: number): Promise<Array<{
  id: number; comentarioId: number; texto: string; autorNome: string; criadoEm: string
  tarefaId: number | null; familiaId: number | null
}>> {
  const linhas = await prisma.comentarioMencao.findMany({
    where: { usuarioId, lidaEm: null },
    orderBy: { id: 'desc' },
    take: 100,
    select: {
      id: true,
      comentario: {
        select: { id: true, texto: true, criadoEm: true, tarefaId: true, familiaId: true, autor: { select: { nome: true } } },
      },
    },
  })
  return linhas.map((l) => ({
    id: l.id, comentarioId: l.comentario.id, texto: l.comentario.texto, autorNome: l.comentario.autor.nome,
    criadoEm: l.comentario.criadoEm.toISOString(), tarefaId: l.comentario.tarefaId, familiaId: l.comentario.familiaId,
  }))
}

/** MARCA como lida — só o próprio destinatário, nunca em nome de outro. */
export async function marcarMencaoComoLida(mencaoId: number, usuarioId: number): Promise<{ ok: boolean }> {
  const r = await prisma.comentarioMencao.updateMany({
    where: { id: mencaoId, usuarioId, lidaEm: null },
    data: { lidaEm: new Date() },
  })
  return { ok: r.count > 0 }
}
