// src/lib/motor/pricing-resolver.ts
// ============================================================================
// LOTE A · B3 — PRICING RESOLVER HIERÁRQUICO
// ----------------------------------------------------------------------------
// Resolve o preço de um item consultando a TabelaValor pela ORDEM DE PRECEDÊNCIA
// que o Marco definiu. Pega o PRIMEIRO nível que tiver preço (mais específico
// ganha). Custo e receita são resolvidos SEPARADOS (natureza independente).
//
// Precedência (do mais específico ao mais geral):
//   1. preço do PROCESSO específico            (processoId)
//   2. preço do TIPO DE PROCESSO / nacionalidade (processoTipoId)
//   3. preço do PAÍS / REGIÃO                   (regiao)
//   4. preço do FORNECEDOR                      (fornecedorId)
//   5. tabela PADRÃO GLOBAL                      (tudo null)
//
// Se NADA casar na TabelaValor, retorna null → o motor cai no fallback
// (ProdutoFinanceiro.valorPadrao de hoje). Assim nada quebra enquanto a
// TabelaValor está vazia.
// ============================================================================

import { prisma } from '@/lib/prisma'
import { Moeda, NaturezaPreco } from '@prisma/client'

export interface PrecoResolvido {
  valor: number
  moeda: Moeda
  nivel: string          // qual nível da precedência respondeu (p/ auditoria/log)
  tabelaValorId: number
}

export interface ContextoPreco {
  itemCatalogoId: number
  natureza: NaturezaPreco            // CUSTO | RECEITA (independentes)
  processoId?: number | null
  processoTipoId?: string | null     // tipo de processo / nacionalidade
  regiao?: string | null             // país/região
  fornecedorId?: number | null
  data?: Date                        // p/ respeitar vigência (default: hoje)
}

// vigência é VarChar(10) tipo 'YYYY-MM-DD' — comparação lexicográfica funciona
function dentroDaVigencia(row: { vigenciaInicio: string | null; vigenciaFim: string | null }, hoje: string): boolean {
  if (row.vigenciaInicio && hoje < row.vigenciaInicio) return false
  if (row.vigenciaFim && hoje > row.vigenciaFim) return false
  return true
}

/**
 * Resolve UM preço (custo OU receita) pela precedência. null = nada configurado.
 */
export async function resolverPreco(ctx: ContextoPreco): Promise<PrecoResolvido | null> {
  const hoje = (ctx.data ?? new Date()).toISOString().slice(0, 10)

  // Candidatos: todas as linhas ATIVAS desse item + natureza. Filtra vigência
  // em memória e escolhe pela precedência (evita 5 queries).
  const linhas = await prisma.tabelaValor.findMany({
    where: {
      itemCatalogoId: ctx.itemCatalogoId,
      natureza: ctx.natureza,
      arquivado: false,
    },
  })
  const validas = linhas.filter((r) => dentroDaVigencia(r, hoje))
  if (validas.length === 0) return null

  // Cada nível: acha a 1ª linha que casa exatamente aquele critério.
  // (as demais dimensões podem ser null = "não restringe")
  const niveis: { nome: string; ok: (r: typeof validas[number]) => boolean }[] = [
    { nome: 'processo',    ok: (r) => ctx.processoId != null && (r as any).processoId === ctx.processoId },
    { nome: 'nacionalidade', ok: (r) => ctx.processoTipoId != null && r.processoTipoId === ctx.processoTipoId },
    { nome: 'regiao',      ok: (r) => ctx.regiao != null && r.regiao === ctx.regiao },
    { nome: 'fornecedor',  ok: (r) => ctx.fornecedorId != null && r.fornecedorId === ctx.fornecedorId },
    { nome: 'global',      ok: (r) => (r as any).processoId == null && r.processoTipoId == null && r.regiao == null && r.fornecedorId == null },
  ]

  for (const nivel of niveis) {
    const achou = validas.find(nivel.ok)
    if (achou) {
      return { valor: Number(achou.valor), moeda: achou.moeda, nivel: nivel.nome, tabelaValorId: achou.id }
    }
  }
  return null
}

/**
 * Conveniência: resolve custo E receita de um item de uma vez (SEPARADOS).
 * Cada um pode vir null independentemente.
 */
export async function resolverCustoEReceita(
  base: Omit<ContextoPreco, 'natureza'>,
): Promise<{ custo: PrecoResolvido | null; receita: PrecoResolvido | null }> {
  const [custo, receita] = await Promise.all([
    resolverPreco({ ...base, natureza: NaturezaPreco.CUSTO }),
    resolverPreco({ ...base, natureza: NaturezaPreco.RECEITA }),
  ])
  return { custo, receita }
}