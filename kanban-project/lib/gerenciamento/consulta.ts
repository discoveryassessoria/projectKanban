// lib/gerenciamento/consulta.ts
// ============================================================================
// CAMADA COMPARTILHADA de consulta dos Cadastros Mestre (reutilização máxima).
//
// Paginação, busca, ordenação e filtro por ativo — via query params OPCIONAIS.
// RETROCOMPATÍVEL: sem params, `take` é undefined e a rota devolve todos os
// registros como antes. Nenhuma tela quebra; o envelope `meta` é aditivo.
//
// Módulo PURO: sem Prisma, sem React. As rotas montam o findMany com o que sai
// daqui e anexam `meta` ao JSON existente.
// ============================================================================

export interface Consulta {
  q: string | null
  ativo: boolean | null
  sort: string | null
  order: 'asc' | 'desc'
  page: number
  limit: number | null
  /** Prontos para o Prisma: `skip`/`take` só quando há paginação explícita. */
  skip: number | undefined
  take: number | undefined
}

/** Lê a query string de forma tolerante. Sem `page`/`limit` → sem paginação. */
export function parseConsulta(searchParams: URLSearchParams): Consulta {
  const q = (searchParams.get('q') || searchParams.get('busca') || '').trim() || null

  const ativoRaw = searchParams.get('ativo')
  const ativo = ativoRaw == null || ativoRaw === '' ? null : ativoRaw === 'true' || ativoRaw === '1'

  const sort = (searchParams.get('sort') || searchParams.get('orderBy') || '').trim() || null
  const order = (searchParams.get('order') || '').toLowerCase() === 'desc' ? 'desc' : 'asc'

  const pageRaw = Number(searchParams.get('page'))
  const limitRaw = Number(searchParams.get('limit') || searchParams.get('pageSize'))
  const temPaginacao = Number.isFinite(limitRaw) && limitRaw > 0
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.trunc(pageRaw) : 1
  const limit = temPaginacao ? Math.min(500, Math.trunc(limitRaw)) : null

  return {
    q,
    ativo,
    sort,
    order,
    page,
    limit,
    skip: limit ? (page - 1) * limit : undefined,
    take: limit ?? undefined,
  }
}

/**
 * Filtro `OR contains` (case-insensitive) sobre os campos de texto informados.
 * Devolve `{}` quando não há termo — combina direto no `where` do Prisma.
 */
export function filtroBusca(q: string | null, campos: string[]): Record<string, unknown> {
  if (!q || campos.length === 0) return {}
  return { OR: campos.map((c) => ({ [c]: { contains: q, mode: 'insensitive' } })) }
}

/** `orderBy` do Prisma a partir de sort/order, validando contra os permitidos. */
export function ordenacao(c: Consulta, permitidos: string[], padrao: Record<string, 'asc' | 'desc'>[]): Record<string, 'asc' | 'desc'>[] {
  if (c.sort && permitidos.includes(c.sort)) return [{ [c.sort]: c.order }]
  return padrao
}

/** Filtro por ativo, quando a entidade tem essa coluna e o param veio. */
export function filtroAtivo(c: Consulta, coluna = 'ativo'): Record<string, unknown> {
  return c.ativo == null ? {} : { [coluna]: c.ativo }
}

export interface MetaPaginacao {
  total: number
  page: number
  limit: number | null
  totalPages: number
  paginado: boolean
}

/** Envelope de metadados anexado ao JSON existente (não substitui a chave-array). */
export function meta(total: number, c: Consulta): MetaPaginacao {
  return {
    total,
    page: c.limit ? c.page : 1,
    limit: c.limit,
    totalPages: c.limit ? Math.max(1, Math.ceil(total / c.limit)) : 1,
    paginado: c.limit != null,
  }
}
