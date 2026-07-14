// LOTE A — NÚCLEO PURO do backfill (sem Prisma, sem conexão, sem main()).
// Importável por testes via tsx SEM abrir conexão. Usa a ÚNICA ponte legada
// compartilhada (src/lib/document-category-map) — não duplica o mapa.

import { codeFromLegacy } from '../src/lib/document-category-map'

export interface TipoRow { id: number; name?: string | null; category: string | null; categoriaDocumentalId: number | null }
export interface CatRow { id: number; code: string }

export interface Relatorio {
  total: number
  jaVinculados: number
  aVincular: number
  semCategoria: number
  desconhecidos: Record<string, number>
  totalDesconhecidos: number
  conflitos: Array<{ id: number; category: string; code: string }>
}

export interface Plano {
  updates: Array<{ id: number; categoriaDocumentalId: number }>
  relatorio: Relatorio
  abortar: boolean // true se há valores impossíveis de mapear (desconhecidos/conflitos)
}

/**
 * Planeja o backfill de forma PURA e determinística.
 * - Idempotente: pula quem já tem categoriaDocumentalId.
 * - Mapeia category (legado) -> code via ponte compartilhada -> id da categoria.
 * - NÃO inventa: valor desconhecido ou code sem seed => reportado e abortar=true.
 */
export function planejarBackfill(tipos: TipoRow[], categorias: CatRow[]): Plano {
  const codeToId = new Map(categorias.map((c) => [c.code, c.id]))
  let aVincular = 0, jaVinculados = 0, semCategoria = 0
  const desconhecidos: Record<string, number> = {}
  const conflitos: Array<{ id: number; category: string; code: string }> = []
  const updates: Array<{ id: number; categoriaDocumentalId: number }> = []

  for (const t of tipos) {
    if (t.categoriaDocumentalId != null) { jaVinculados++; continue }
    if (!t.category) { semCategoria++; continue }
    const code = codeFromLegacy(t.category)
    if (!code) { desconhecidos[t.category] = (desconhecidos[t.category] ?? 0) + 1; continue }
    const id = codeToId.get(code)
    if (id == null) { conflitos.push({ id: t.id, category: t.category, code }); continue }
    updates.push({ id: t.id, categoriaDocumentalId: id }); aVincular++
  }

  const totalDesconhecidos = Object.values(desconhecidos).reduce((a, b) => a + b, 0)
  return {
    updates,
    relatorio: { total: tipos.length, jaVinculados, aVincular, semCategoria, desconhecidos, totalDesconhecidos, conflitos },
    abortar: totalDesconhecidos > 0 || conflitos.length > 0,
  }
}
