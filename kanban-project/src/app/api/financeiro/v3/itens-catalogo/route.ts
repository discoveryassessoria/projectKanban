// /api/financeiro/v3/itens-catalogo — itens do Catálogo Mestre (Gerenciamento)
// para o lançamento de Custo/Receita. Leitura enxuta, gated por 'financeiro.ver'
// (o cadastro/edição continua exclusivo do Gerenciamento). Fonte ÚNICA:
// ItemCatalogo. Nunca cria/edita — só lista itens ATIVOS.
//
// BUSCA SERVER-SIDE (?q=) — o seletor do lançamento é pesquisável e NÃO carrega a
// lista inteira: procura por nome, código, descrição e categoria. Cada item volta
// com os SINAIS que o operador precisa para escolher sem abrir o Gerenciamento:
// tem configuração financeira? tem preço na Tabela de Valores? qual moeda? tem
// fornecedor padrão? Sinal ausente é informação — é o que revela config incompleta.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const LIMITE_PADRAO = 40
const LIMITE_MAX = 100

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const sp = req.nextUrl.searchParams
  // ?paraReceita=1: itens ELEGÍVEIS a Receita = ATIVOS + com Configuração Financeira que
  // PERMITA receita (não só-custo). A elegibilidade vem da CONFIG (naturezaFin/possuiReceita),
  // NÃO do rótulo de natureza — uma Certidão/Documento cobrada do cliente é receita válida.
  const paraReceita = sp.get('paraReceita') === '1' || sp.get('natureza') === 'RECEITA'
  const q = (sp.get('q') ?? '').trim()
  const limite = Math.min(Number(sp.get('limite')) || LIMITE_PADRAO, LIMITE_MAX)

  const busca = q
    ? {
        OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          { code: { contains: q, mode: 'insensitive' as const } },
          { descricao: { contains: q, mode: 'insensitive' as const } },
          { categoria: { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : {}

  // Busca ampla o suficiente para permitir o filtro de elegibilidade a receita
  // sem devolver menos itens do que o pedido; o corte final é feito abaixo.
  const janela = paraReceita ? Math.min(limite * 5, 400) : limite + 1
  let itens = await prisma.itemCatalogo.findMany({
    where: { ativo: true, ...busca },
    orderBy: [{ categoria: 'asc' }, { name: 'asc' }],
    take: janela,
    select: { id: true, code: true, name: true, descricao: true, natureza: true, categoria: true, unidade: true },
  })

  // Configurações financeiras dos itens retornados — em UMA consulta.
  const ids = itens.map((i) => i.id)
  const configs = ids.length
    ? await prisma.produtoFinanceiro
        .findMany({
          where: { itemCatalogoId: { in: ids } },
          select: {
            itemCatalogoId: true, moedaPadrao: true, naturezaFin: true, possuiCusto: true, possuiReceita: true,
            fornecedorPadrao: { select: { nome: true } },
            categoria: { select: { nome: true } },
          },
        })
        .catch(() => [])
    : []
  const porItem = new Map(configs.map((c) => [c.itemCatalogoId, c]))

  if (paraReceita) {
    itens = itens.filter((i) => {
      const c = porItem.get(i.id)
      if (!c) return false
      return c.naturezaFin === 'SOMENTE_RECEITA' || c.naturezaFin === 'CUSTO_E_RECEITA' || c.possuiReceita
    })
  }

  // Preço cadastrado na Tabela de Valores (PRESENÇA, não valor — o valor vem do
  // item-config, que passa pelo resolvedor oficial e considera processo/quantidade).
  const idsFinais = itens.slice(0, limite + 1).map((i) => i.id)
  const comPreco = idsFinais.length
    ? await prisma.tabelaValor
        .findMany({
          where: { itemCatalogoId: { in: idsFinais }, arquivado: false, natureza: paraReceita ? 'VENDA' : 'CUSTO' },
          select: { itemCatalogoId: true },
          distinct: ['itemCatalogoId'],
        })
        .catch(() => [])
    : []
  const temPreco = new Set(comPreco.map((p) => p.itemCatalogoId).filter((v): v is number => v != null))

  const truncado = itens.length > limite
  const pagina = itens.slice(0, limite)

  return NextResponse.json({
    truncado,
    total: pagina.length,
    itens: pagina.map((i) => {
      const c = porItem.get(i.id)
      return {
        id: i.id,
        code: i.code,
        name: i.name,
        descricao: i.descricao,
        natureza: i.natureza,
        // Categoria oficial: a da Configuração Financeira quando existe; senão a do próprio item.
        categoria: c?.categoria?.nome ?? i.categoria ?? null,
        unidade: i.unidade,
        temConfig: !!c,
        temPreco: temPreco.has(i.id),
        moeda: c?.moedaPadrao ? String(c.moedaPadrao) : null,
        fornecedorPadraoNome: c?.fornecedorPadrao?.nome ?? null,
      }
    }),
  })
}
