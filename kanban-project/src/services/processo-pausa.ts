// src/services/processo-pausa.ts
// ============================================================================
// PAUSAR / REATIVAR PROCESSO — Torre nova, Etapa A (M2, 01/10/2026).
//
// O QUE A PAUSA É: uma decisão do gestor de tirar um processo do radar da Torre (ex.: cliente sumiu,
// aguardando decisão judicial longa). APPEND-ONLY: pausar ABRE uma linha em `ProcessoPausa`, reativar a FECHA
// (`retomadoEm`) — o histórico de pausas nunca se perde. No máximo UMA pausa vigente por processo (índice
// parcial único no banco; esta porta também confere).
//
// O QUE A PAUSA FAZ — e só isto:
//   • o processo pausado SAI da Torre: lista de tarefas, KPIs, Terceiros, Equipe, Radar, Processos, "Precisa
//     de você" e a foto diária. O filtro é UM só (`idsDeProcessosPausados` + `semProcessosPausados`), aplicado
//     nas leituras que alimentam a Torre — nunca na projeção compartilhada com a Operação;
//   • continua acessível no detalhe do Processo (Foco) e lá aparece como "Pausado";
//   • a OPERAÇÃO (Minha fila, Central, sino, Home — ex.: Daniela) NÃO muda: as tarefas continuam com quem as tem;
//   • NÃO mexe em fase, tarefa, passo nem prazo (o prazo nunca pausa por isso — CLAUDE.md 35.6; `slaPausadoEm` é
//     outro mecanismo e não é tocado). Reativar devolve o processo à Torre exatamente como estava.
// Toda mudança grava histórico em `LogAuditoria` (quem, o quê, quando, justificativa) NA MESMA transação.
// "Desfazer" da pausa = `reativarProcesso`.
// ============================================================================
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type Leitor = PrismaClient | Prisma.TransactionClient

export const JUSTIFICATIVA_MINIMA = 5
export const JUSTIFICATIVA_MAXIMA = 300

export interface PausaDoProcesso {
  id: number
  processoId: number
  pausadoEm: string
  pausadoPor: { id: number; nome: string } | null
  motivo: string
  retomadoEm: string | null
  retomadoPor: { id: number; nome: string } | null
}

export type CodigoDeRecusa = 'JUSTIFICATIVA_CURTA' | 'PROCESSO_INEXISTENTE' | 'PROCESSO_CONCLUIDO' | 'JA_PAUSADO' | 'NAO_PAUSADO'
export type ResultadoPausa =
  | { ok: true; pausa: PausaDoProcesso }
  | { ok: false; codigo: CodigoDeRecusa; erro: string }

const SELECT_PAUSA = {
  id: true, processoId: true, pausadoEm: true, motivo: true, retomadoEm: true,
  pausadoPor: { select: { id: true, nome: true } }, retomadoPor: { select: { id: true, nome: true } },
} as const

type LinhaPausa = Prisma.ProcessoPausaGetPayload<{ select: typeof SELECT_PAUSA }>
const serializar = (p: LinhaPausa): PausaDoProcesso => ({
  id: p.id, processoId: p.processoId, pausadoEm: p.pausadoEm.toISOString(), pausadoPor: p.pausadoPor, motivo: p.motivo,
  retomadoEm: p.retomadoEm?.toISOString() ?? null, retomadoPor: p.retomadoPor,
})

/** A justificativa limpa (espaços aparados), ou `null` se tiver menos de 5 letras/caracteres úteis. */
export function justificativaValida(texto: unknown): string | null {
  const t = typeof texto === 'string' ? texto.trim().replace(/\s+/g, ' ') : ''
  return t.length >= JUSTIFICATIVA_MINIMA ? t.slice(0, JUSTIFICATIVA_MAXIMA) : null
}

// ─── O FILTRO CANÔNICO "PROCESSO PAUSADO FICA FORA DA TORRE" ─────────────────────────────────────────────────────────

/** Os ids dos processos com pausa VIGENTE — UMA consulta, constante no volume. */
export async function idsDeProcessosPausados(db: Leitor = prisma): Promise<Set<number>> {
  const vigentes = await db.processoPausa.findMany({ where: { retomadoEm: null }, select: { processoId: true } })
  return new Set(vigentes.map((v) => v.processoId))
}

/** Tira as linhas de processos pausados. Linha sem processo (tarefa avulsa) nunca é pausada. PURA: o conjunto vem de fora. */
export function semProcessosPausados<T extends { processoId: number | null }>(linhas: T[], pausados: ReadonlySet<number>): T[] {
  return pausados.size === 0 ? linhas : linhas.filter((l) => l.processoId == null || !pausados.has(l.processoId))
}

/** A MESMA condição como filtro de banco, para as leituras que consultam `Processo` direto (Radar, Processos, foto diária). */
export const ONDE_PROCESSO_NAO_PAUSADO: Prisma.ProcessoWhereInput = { pausas: { none: { retomadoEm: null } } }

// ─── LEITURA ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A pausa vigente de UM processo (ou `null`). Alimenta o selo "Pausado" no detalhe do Processo. */
export async function pausaVigenteDoProcesso(processoId: number, db: Leitor = prisma): Promise<PausaDoProcesso | null> {
  const p = await db.processoPausa.findFirst({ where: { processoId, retomadoEm: null }, select: SELECT_PAUSA })
  return p ? serializar(p) : null
}

/** Todas as pausas do processo (vigente e passadas), da mais recente para a mais antiga. */
export async function historicoDePausas(processoId: number, db: Leitor = prisma): Promise<PausaDoProcesso[]> {
  const ps = await db.processoPausa.findMany({ where: { processoId }, orderBy: [{ pausadoEm: 'desc' }, { id: 'desc' }], select: SELECT_PAUSA })
  return ps.map(serializar)
}

// ─── ESCRITA ────────────────────────────────────────────────────────────────────────────────────────────────────────

const ehViolacaoDeUnicidade = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'

/** PAUSA o processo. Justificativa de ao menos 5 letras; processo concluído não se pausa; já pausado = recusa (sem duplicar). */
export async function pausarProcesso(args: { processoId: number; usuarioId: number; justificativa: unknown }): Promise<ResultadoPausa> {
  const motivo = justificativaValida(args.justificativa)
  if (!motivo) return { ok: false, codigo: 'JUSTIFICATIVA_CURTA', erro: `escreva a justificativa (pelo menos ${JUSTIFICATIVA_MINIMA} letras) — ela vai para o histórico` }
  try {
    return await prisma.$transaction(async (tx) => {
      const proc = await tx.processo.findUnique({ where: { id: args.processoId }, select: { id: true, nome: true, codigo: true, dataConclusao: true } })
      if (!proc) return { ok: false as const, codigo: 'PROCESSO_INEXISTENTE' as const, erro: 'processo não encontrado' }
      if (proc.dataConclusao != null) return { ok: false as const, codigo: 'PROCESSO_CONCLUIDO' as const, erro: 'processo concluído não se pausa' }
      if (await tx.processoPausa.count({ where: { processoId: proc.id, retomadoEm: null } })) {
        return { ok: false as const, codigo: 'JA_PAUSADO' as const, erro: 'o processo já está pausado' }
      }
      const criada = await tx.processoPausa.create({ data: { processoId: proc.id, pausadoPorId: args.usuarioId, motivo }, select: SELECT_PAUSA })
      await tx.logAuditoria.create({
        data: {
          acao: 'PROCESSO_PAUSADO', entidade: 'Processo', entidadeId: proc.id, usuarioId: args.usuarioId,
          descricao: `Processo ${proc.codigo ?? `#${proc.id}`} (${proc.nome}) pausado: ${motivo}. Sai da Torre até ser reativado; a Operação não muda.`,
          detalhes: { pausaId: criada.id, motivo, pausadoEm: criada.pausadoEm.toISOString() },
        },
      })
      return { ok: true as const, pausa: serializar(criada) }
    })
  } catch (e) {
    // Duas pausas ao mesmo tempo: o índice parcial único do banco barra a segunda — é "já pausado", não erro.
    if (ehViolacaoDeUnicidade(e)) return { ok: false, codigo: 'JA_PAUSADO', erro: 'o processo já está pausado' }
    throw e
  }
}

/**
 * REATIVA o processo (fecha a pausa vigente) — também é o "Desfazer" da pausa. A justificativa é opcional aqui (é o
 * desfazer de um clique), mas, se vier, tem de ter 5 letras; vai para o histórico junto com quem reativou e quando.
 */
export async function reativarProcesso(args: { processoId: number; usuarioId: number; justificativa?: unknown; desfazer?: boolean }): Promise<ResultadoPausa> {
  const informou = args.justificativa != null && String(args.justificativa).trim() !== ''
  const motivo = informou ? justificativaValida(args.justificativa) : null
  if (informou && !motivo) return { ok: false, codigo: 'JUSTIFICATIVA_CURTA', erro: `a justificativa precisa ter pelo menos ${JUSTIFICATIVA_MINIMA} letras` }
  return prisma.$transaction(async (tx) => {
    const proc = await tx.processo.findUnique({ where: { id: args.processoId }, select: { id: true, nome: true, codigo: true } })
    if (!proc) return { ok: false as const, codigo: 'PROCESSO_INEXISTENTE' as const, erro: 'processo não encontrado' }
    const vigente = await tx.processoPausa.findFirst({ where: { processoId: proc.id, retomadoEm: null }, select: { id: true } })
    if (!vigente) return { ok: false as const, codigo: 'NAO_PAUSADO' as const, erro: 'o processo não está pausado' }
    // CAS: só fecha se ainda estiver aberta (reativação concorrente não duplica o fechamento).
    const agora = new Date()
    const fechou = await tx.processoPausa.updateMany({ where: { id: vigente.id, retomadoEm: null }, data: { retomadoEm: agora, retomadoPorId: args.usuarioId } })
    if (fechou.count === 0) return { ok: false as const, codigo: 'NAO_PAUSADO' as const, erro: 'o processo não está pausado' }
    const fechada = await tx.processoPausa.findUniqueOrThrow({ where: { id: vigente.id }, select: SELECT_PAUSA })
    await tx.logAuditoria.create({
      data: {
        acao: 'PROCESSO_REATIVADO', entidade: 'Processo', entidadeId: proc.id, usuarioId: args.usuarioId,
        descricao: `Processo ${proc.codigo ?? `#${proc.id}`} (${proc.nome}) reativado${args.desfazer ? ' (desfazer da pausa)' : ''}${motivo ? `: ${motivo}` : ''}. Volta à Torre.`,
        detalhes: { pausaId: fechada.id, desfazer: args.desfazer === true, justificativa: motivo, pausadoEm: fechada.pausadoEm.toISOString(), retomadoEm: agora.toISOString() },
      },
    })
    return { ok: true as const, pausa: serializar(fechada) }
  })
}
