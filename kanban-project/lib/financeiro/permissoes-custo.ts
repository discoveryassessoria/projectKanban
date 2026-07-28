// lib/financeiro/permissoes-custo.ts
// ============================================================================
// F6 — Segregação de permissões de CUSTO (Contas a Pagar V3). Enforcement SERVER-SIDE.
// Criar ≠ Editar ≠ Aprovar ≠ Reprovar ≠ Cancelar ≠ Pagar ≠ Estornar ≠ Conciliar ≠ Excluir
// ≠ Arquivar ≠ Ver. Rotas compartilhadas receita+custo usam o gate NATUREZA-AWARE (só custo).
// Retrocompat: durante a migração, financeiro.ver concede as operações de custo; vira ESTRITO
// (só a chave específica) quando FINANCEIRO_PERMISSOES_CUSTO_ESTRITAS=1.
// ============================================================================
import { NextResponse } from 'next/server'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { temPermissao, type PermissaoChave, type MapaPermissoes } from '@/src/lib/permissoes'
import { prisma } from '@/lib/prisma'
import { resolverId } from '@/lib/financeiro/leitura/receita-detalhe'

export type OperacaoCusto =
  | 'criar' | 'editar' | 'aprovar' | 'reprovar' | 'cancelar' | 'pagar'
  | 'estornar' | 'conciliar' | 'excluir' | 'arquivar'

export const CHAVE_CUSTO: Record<OperacaoCusto, PermissaoChave> = {
  criar: 'financeiro.custo_criar', editar: 'financeiro.custo_editar', aprovar: 'financeiro.custo_aprovar',
  reprovar: 'financeiro.custo_reprovar', cancelar: 'financeiro.custo_cancelar', pagar: 'financeiro.custo_pagar',
  estornar: 'financeiro.custo_estornar', conciliar: 'financeiro.custo_conciliar', excluir: 'financeiro.custo_excluir',
  arquivar: 'financeiro.custo_arquivar',
}
export const OPERACOES_CUSTO = Object.keys(CHAVE_CUSTO) as OperacaoCusto[]

export function segregacaoEstrita(): boolean { return process.env.FINANCEIRO_PERMISSOES_CUSTO_ESTRITAS === '1' }

/** Núcleo PURO (testável): decide se um mapa de permissões pode executar a operação. */
export function podeOperarCusto(permissoes: MapaPermissoes | null | undefined, operacao: OperacaoCusto, estrita: boolean): boolean {
  if (!permissoes) return false
  if (temPermissao(permissoes, CHAVE_CUSTO[operacao])) return true // chave específica
  if (!estrita && temPermissao(permissoes, 'financeiro.ver')) return true // retrocompat durante a migração
  return false
}

const negar = (op: OperacaoCusto) => NextResponse.json({ error: 'Sem permissão para esta ação', permissao: CHAVE_CUSTO[op] }, { status: 403 })

/** Gate de permissão de CUSTO (rota cost-only). 401/403/null. */
export async function verificarPermissaoCusto(req: Request, operacao: OperacaoCusto): Promise<NextResponse | null> {
  const usuario = await extrairUsuarioComPermissoes(req)
  if (!usuario) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  return podeOperarCusto(usuario.permissoes, operacao, segregacaoEstrita()) ? null : negar(operacao)
}

/** Gate NATUREZA-AWARE p/ rotas compartilhadas: só aplica a segregação de custo quando a
 *  obrigação é A_PAGAR. Para receita, retorna null (o gate existente da rota permanece). */
export async function verificarPermissaoCustoDaObrigacao(req: Request, operacao: OperacaoCusto, obrigacaoId: number): Promise<NextResponse | null> {
  const obr = await prisma.obrigacaoEconomica.findUnique({ where: { id: obrigacaoId }, select: { direcao: true } }).catch(() => null)
  if (obr?.direcao !== 'A_PAGAR') return null // não é custo → sem gate de custo (receita segue seu gate)
  return verificarPermissaoCusto(req, operacao)
}

/** Gate natureza-aware para rotas [ref] (resolve ref→obrigacaoId antes). Se o ref não
 *  resolver, retorna null (a rota trata o 404). */
export async function verificarPermissaoCustoPorRef(req: Request, operacao: OperacaoCusto, ref: string): Promise<NextResponse | null> {
  const id = await resolverId(ref).catch(() => null)
  if (!id) return null
  return verificarPermissaoCustoDaObrigacao(req, operacao, id)
}

/** Permissões efetivas de custo do usuário — a UI CONSOME (não decide segurança). */
export async function permissoesCustoDoUsuario(req: Request): Promise<Record<OperacaoCusto | 'ver', boolean>> {
  const usuario = await extrairUsuarioComPermissoes(req)
  const estrita = segregacaoEstrita()
  const out = { ver: !!usuario && temPermissao(usuario.permissoes, 'financeiro.ver') } as Record<OperacaoCusto | 'ver', boolean>
  for (const op of OPERACOES_CUSTO) out[op] = podeOperarCusto(usuario?.permissoes ?? null, op, estrita)
  return out
}
