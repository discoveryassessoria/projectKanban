// src/lib/financeiro/parseLista.ts
//
// 🆕 Helper compartilhado pra normalizar a resposta dos endpoints
// /api/financeiro/* que podem retornar:
//   - array direto: [item, item, item]
//   - wrapper: { receitas: [...] } ou { custos: [...] } ou { data: [...] }
//
// Defensivo: sempre retorna array. Se vier erro/null, retorna [].

export function parseLista<T = unknown>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object') {
    const d = data as {
      receitas?: T[]
      custos?: T[]
      data?: T[]
      items?: T[]
    }
    return d.receitas || d.custos || d.data || d.items || []
  }
  return []
}