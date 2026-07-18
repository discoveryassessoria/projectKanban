// lib/financeiro/selecao-natureza.ts
// FONTE ÚNICA da conversão "checkboxes Custo/Venda → naturezas do preço".
// Usada por toda a API (e pela UI) — NÃO duplicar essa lógica em rotas/componentes.
// O novo contrato da Tabela de Preços é baseado em DOIS booleanos independentes;
// "natureza" (string) é apenas LEGADO aceito temporariamente para clientes antigos.

export type SelecaoNatureza = { custo?: boolean; venda?: boolean }

/**
 * custo=true, venda=false → ['CUSTO']
 * custo=false, venda=true → ['VENDA']
 * custo=true,  venda=true → ['CUSTO','VENDA']  (dois registros)
 * nenhum                  → []                 (o chamador retorna erro de validação)
 */
export function naturezasDeSelecao(sel: SelecaoNatureza): ('CUSTO' | 'VENDA')[] {
  const out: ('CUSTO' | 'VENDA')[] = []
  if (sel.custo) out.push('CUSTO')
  if (sel.venda) out.push('VENDA')
  return out
}

/** true quando a requisição usa o NOVO modelo (qualquer um dos checkboxes presente). */
export function usaNovoModeloSelecao(body: { precoCusto?: unknown; precoVenda?: unknown }): boolean {
  return body?.precoCusto !== undefined || body?.precoVenda !== undefined
}
