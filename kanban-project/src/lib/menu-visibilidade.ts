// Visibilidade de um item do menu lateral (função pura, testável sem React).
//   permissao        — precisa da permissão
//   soAdmin          — só administrador vê
//   escondeParaAdmin — administrador NÃO vê (a Torre de Controle o substitui; a rota continua existindo
//                      e redireciona). Não-admin: o item segue a regra de sempre.
export interface ItemDeMenu { permissao?: string; soAdmin?: boolean; escondeParaAdmin?: boolean }

export function itemDeMenuVisivel(item: ItemDeMenu, ctx: { pode: (p: string) => boolean; isAdmin: boolean }): boolean {
  if (item.escondeParaAdmin && ctx.isAdmin) return false
  if (item.permissao && !ctx.pode(item.permissao)) return false
  if (item.soAdmin && !ctx.isAdmin) return false
  return true
}
