// lib/operacional/torre-metas.ts
// ============================================================================
// METAS DE TEMPO POR FASE (e por país) — Torre nova, Etapa A (M1, 01/10/2026).
//
// SOMENTE EXIBIÇÃO. A meta é um BENCHMARK ("tempo médio real × meta" e a cor do funil da Visão
// geral), nunca um prazo: NÃO gera prazo de tarefa, NÃO alimenta `atrasada`, score, risco nem
// notificação, e NÃO é o SLA de fase (que foi ELIMINADO em 17/09/2026 e continua eliminado).
// O teste `torre-metas.test.ts` prova que nenhum módulo do motor de prazo/risco importa este arquivo.
//
// Resolução da meta de uma fase para um país (a primeira que existir e estiver ativa):
//   1. a meta daquele PAÍS para a fase;
//   2. a meta PADRÃO da fase (sem país);
//   3. nada → `null` (a tela mostra "—"; nunca uma meta inventada).
//
// `phaseKey` é chave solta (mesmo padrão de FaseMacro.phaseKey), validada contra o `CatalogoFase` ATIVO
// na porta — o Catálogo de Fases é módulo fechado e não ganhou relação nova.
// Toda escrita grava histórico em `LogAuditoria` NA MESMA transação (quem, o quê, quando).
// ============================================================================
import { prisma } from '@/lib/prisma'

export const META_MINIMA_DIAS = 1
export const META_MAXIMA_DIAS = 3650

export interface MetaDeTempo {
  id: number
  phaseKey: string
  faseLabel: string | null
  paisId: number | null
  paisLabel: string | null
  metaDias: number
  ativo: boolean
  atualizadoEm: string
  atualizadoPor: { id: number; nome: string } | null
}

export type ResultadoMeta<T = MetaDeTempo> = { ok: true; meta: T } | { ok: false; erro: string }

/** A regra PURA de resolução (sem banco): país → padrão → `null`. Só metas ATIVAS entram. */
export function resolverMeta(
  metas: Array<{ phaseKey: string; paisId: number | null; metaDias: number; ativo: boolean }>,
  phaseKey: string, paisId: number | null,
): number | null {
  const ativas = metas.filter((m) => m.ativo && m.phaseKey === phaseKey)
  const doPais = paisId != null ? ativas.find((m) => m.paisId === paisId) : undefined
  if (doPais) return doPais.metaDias
  return ativas.find((m) => m.paisId == null)?.metaDias ?? null
}

/** Meta numérica válida? (inteiro entre 1 e 3650 dias). */
export const metaValida = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= META_MINIMA_DIAS && n <= META_MAXIMA_DIAS

const serializar = (m: {
  id: number; phaseKey: string; paisId: number | null; metaDias: number; ativo: boolean; atualizadoEm: Date
  pais: { countryLabel: string } | null; atualizadoPor: { id: number; nome: string } | null
}, faseLabel: string | null): MetaDeTempo => ({
  id: m.id, phaseKey: m.phaseKey, faseLabel, paisId: m.paisId, paisLabel: m.pais?.countryLabel ?? null,
  metaDias: m.metaDias, ativo: m.ativo, atualizadoEm: m.atualizadoEm.toISOString(), atualizadoPor: m.atualizadoPor,
})

const SELECT_META = {
  id: true, phaseKey: true, paisId: true, metaDias: true, ativo: true, atualizadoEm: true,
  pais: { select: { countryLabel: true } }, atualizadoPor: { select: { id: true, nome: true } },
} as const

/** Todas as metas (ativas e inativas), com o nome da fase pelo CADASTRO — nunca literal no código. */
export async function listarMetas(): Promise<MetaDeTempo[]> {
  const [metas, fases] = await Promise.all([
    prisma.metaTempoFase.findMany({ select: SELECT_META, orderBy: [{ phaseKey: 'asc' }, { paisId: { sort: 'asc', nulls: 'first' } }] }),
    prisma.catalogoFase.findMany({ select: { phaseKey: true, label: true } }),
  ])
  const rotulo = new Map(fases.map((f) => [f.phaseKey, f.label]))
  return metas.map((m) => serializar(m, rotulo.get(m.phaseKey) ?? null))
}

/** As metas ATIVAS, no formato que `resolverMeta` consome — UMA leitura, para a Visão geral resolver todas as fases. */
export async function metasAtivas(): Promise<Array<{ phaseKey: string; paisId: number | null; metaDias: number; ativo: boolean }>> {
  return prisma.metaTempoFase.findMany({ where: { ativo: true }, select: { phaseKey: true, paisId: true, metaDias: true, ativo: true } })
}

/** A meta de UMA fase para um país (ou a padrão) — `null` = sem meta cadastrada. */
export async function metaDaFase(phaseKey: string, paisId: number | null = null): Promise<number | null> {
  return resolverMeta(await metasAtivas(), phaseKey, paisId)
}

/**
 * CRIA ou ATUALIZA a meta de (fase, país) — idempotente por par. `paisId: null` = meta padrão da fase.
 * Recusa fase fora do Catálogo ATIVO, país inexistente e meta fora de 1–3650 dias. Histórico no mesmo commit.
 */
export async function definirMeta(args: {
  phaseKey: string; paisId?: number | null; metaDias: number; ativo?: boolean; autorId: number
}): Promise<ResultadoMeta> {
  const phaseKey = String(args.phaseKey ?? '').trim()
  const paisId = args.paisId ?? null
  if (!metaValida(args.metaDias)) return { ok: false, erro: `a meta tem de ser um número inteiro de ${META_MINIMA_DIAS} a ${META_MAXIMA_DIAS} dias` }
  const fase = phaseKey ? await prisma.catalogoFase.findFirst({ where: { phaseKey, ativo: true }, select: { label: true } }) : null
  if (!fase) return { ok: false, erro: 'fase inexistente ou inativa no Catálogo de Fases' }
  if (paisId != null && !(await prisma.catalogoPais.count({ where: { id: paisId } }))) return { ok: false, erro: 'país inexistente' }

  const meta = await prisma.$transaction(async (tx) => {
    const atual = await tx.metaTempoFase.findFirst({ where: { phaseKey, paisId }, select: { id: true, metaDias: true, ativo: true } })
    const ativo = args.ativo ?? true
    const gravada = atual
      ? await tx.metaTempoFase.update({ where: { id: atual.id }, data: { metaDias: args.metaDias, ativo, atualizadoPorId: args.autorId }, select: SELECT_META })
      : await tx.metaTempoFase.create({ data: { phaseKey, paisId, metaDias: args.metaDias, ativo, atualizadoPorId: args.autorId }, select: SELECT_META })
    const ondeTxt = gravada.pais?.countryLabel ?? 'padrão (todos os países)'
    await tx.logAuditoria.create({
      data: {
        acao: atual ? 'META_TEMPO_FASE_ALTERADA' : 'META_TEMPO_FASE_CRIADA', entidade: 'MetaTempoFase', entidadeId: gravada.id,
        usuarioId: args.autorId,
        descricao: `Meta de tempo da fase "${fase.label}" (${ondeTxt}): ${atual ? `${atual.metaDias} → ` : ''}${args.metaDias} dia(s)${ativo ? '' : ' (inativa)'}. Só exibição — não gera prazo.`,
        detalhes: { phaseKey, paisId, antes: atual ? { metaDias: atual.metaDias, ativo: atual.ativo } : null, depois: { metaDias: args.metaDias, ativo } },
      },
    })
    return gravada
  })
  return { ok: true, meta: serializar(meta, fase.label) }
}

/** EXCLUI a meta. Configuração, não fato histórico: sai de vez — o que fica é a linha de auditoria. */
export async function excluirMeta(id: number, autorId: number): Promise<{ ok: true } | { ok: false; erro: string }> {
  const atual = await prisma.metaTempoFase.findUnique({ where: { id }, select: { id: true, phaseKey: true, paisId: true, metaDias: true, pais: { select: { countryLabel: true } } } })
  if (!atual) return { ok: false, erro: 'meta não encontrada' }
  const fase = await prisma.catalogoFase.findFirst({ where: { phaseKey: atual.phaseKey }, select: { label: true } })
  await prisma.$transaction(async (tx) => {
    await tx.metaTempoFase.delete({ where: { id } })
    await tx.logAuditoria.create({
      data: {
        acao: 'META_TEMPO_FASE_EXCLUIDA', entidade: 'MetaTempoFase', entidadeId: id, usuarioId: autorId,
        descricao: `Meta de tempo da fase "${fase?.label ?? atual.phaseKey}" (${atual.pais?.countryLabel ?? 'padrão'}) excluída (era ${atual.metaDias} dia(s)).`,
        detalhes: { phaseKey: atual.phaseKey, paisId: atual.paisId, metaDias: atual.metaDias },
      },
    })
  })
  return { ok: true }
}
