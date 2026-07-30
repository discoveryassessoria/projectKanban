// /api/financeiro/v3/item-config — auto-preenchimento do lançamento manual.
//   GET ?itemCatalogoId=&natureza=RECEITA|CUSTO&processoId=&quantidade=
// Dado um item do Catálogo Mestre, resolve as configurações financeiras padrão
// (Configuração Financeira = ProdutoFinanceiro por itemCatalogoId): moeda,
// categoria, fornecedor padrão, forma de cobrança e o VALOR UNITÁRIO padrão via
// Tabela de Preços (resolverPrecoPorConfigDB). Somente leitura. Fonte ÚNICA: o
// Cadastro Mestre + Tabela de Preços — nunca inventa preço.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { resolverPrecoPorConfigDB } from '@/src/lib/motor/resolver-preco-financeiro.prisma'

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const sp = req.nextUrl.searchParams
  const itemCatalogoId = Number(sp.get('itemCatalogoId'))
  const natureza = sp.get('natureza') === 'CUSTO' ? 'CUSTO' : 'RECEITA'
  const processoId = sp.get('processoId') ? Number(sp.get('processoId')) : null
  const quantidade = sp.get('quantidade') ? Number(sp.get('quantidade')) : 1
  if (!itemCatalogoId) return NextResponse.json({ erro: 'itemCatalogoId é obrigatório.' }, { status: 400 })

  const item = await prisma.itemCatalogo.findUnique({ where: { id: itemCatalogoId }, select: { id: true, name: true, unidade: true, natureza: true, categoria: true } })
  if (!item) return NextResponse.json({ erro: 'Item inexistente.' }, { status: 404 })

  const cfg = await prisma.produtoFinanceiro.findUnique({
    where: { itemCatalogoId },
    include: {
      categoria: true, fornecedorPadrao: true, condicaoPagamento: true,
      planoContaReceita: true, planoContaCusto: true, planoConta: true,
    },
  }).catch(() => null)

  // Valor unitário padrão: SÓ via Tabela de Preços por Configuração Financeira.
  // NaturezaPreco canônica: VENDA (receita) | CUSTO (custo). SEM fallback para o
  // valor legado da configuração (valorPadrao) — preço tem fonte única.
  let valorUnitario: number | null = null
  let moeda: string = cfg?.moedaPadrao ? String(cfg.moedaPadrao) : 'BRL'
  let precoRazao = 'sem preço cadastrado'
  if (cfg) {
    const naturezaPreco = natureza === 'CUSTO' ? 'CUSTO' : 'VENDA'
    const r = await resolverPrecoPorConfigDB(cfg.id, {
      natureza: naturezaPreco as any,
      processoId: processoId ?? undefined,
      quantidade,
      fallbackValorPadrao: null,
      fallbackMoeda: cfg.moedaPadrao ?? null,
    }).catch(() => null)
    if (r && r.ok) { valorUnitario = r.valorUnitario; moeda = String(r.moeda); precoRazao = r.razao }
  }

  // CONTA CONTÁBIL POR NATUREZA — Receita ao gerar RECEITA, Custo ao gerar CUSTO.
  // `planoConta` (conta única) é o fallback histórico, preservado sem DROP.
  const contaDaNatureza = natureza === 'CUSTO' ? cfg?.planoContaCusto : cfg?.planoContaReceita
  const conta = contaDaNatureza ?? cfg?.planoConta ?? null

  // O QUE FALTA para o item operar nesta natureza — é isto que o seletor e o
  // formulário mostram ao operador, em vez de um silêncio que vira erro no salvar.
  const pendencias: string[] = []
  if (!cfg) pendencias.push('Item sem Configuração Financeira')
  else {
    if (valorUnitario == null || valorUnitario <= 0) pendencias.push('Sem valor na Tabela de Valores')
    if (!conta) pendencias.push(`Sem conta contábil de ${natureza === 'CUSTO' ? 'custo' : 'receita'}`)
    if (!cfg.categoriaId) pendencias.push('Sem classificação financeira')
    if (natureza === 'CUSTO' && cfg.naturezaFin === 'SOMENTE_RECEITA') pendencias.push('Configuração não admite custo')
    if (natureza === 'RECEITA' && cfg.naturezaFin === 'SOMENTE_CUSTO') pendencias.push('Configuração não admite receita')
  }

  return NextResponse.json({
    item: { id: item.id, name: item.name, unidade: item.unidade, natureza: item.natureza, categoria: item.categoria },
    temConfig: !!cfg,
    pendencias,
    defaults: {
      descricao: item.name,
      valorUnitario,
      moeda,
      unidade: item.unidade,
      categoriaId: cfg?.categoriaId ?? null,
      categoriaNome: cfg?.categoria?.nome ?? item.categoria ?? null,
      fornecedorPadraoId: cfg?.fornecedorPadraoId ?? null,
      fornecedorPadraoNome: cfg?.fornecedorPadrao?.nome ?? null,
      condicaoPagamentoId: cfg?.condicaoPagamentoId ?? null,
      formaCobranca: cfg?.condicaoPagamento?.name ?? null,
      // Comportamentos financeiros oficiais da configuração — só leitura na UI.
      naturezaFin: cfg?.naturezaFin ?? null,
      contaContabilId: conta?.id ?? null,
      contaContabilLabel: conta ? `${conta.codigo} — ${conta.nome}` : null,
      repasse: cfg?.repasse ?? false,
      reembolsavel: cfg?.reembolsavel ?? false,
      cobravelDoCliente: cfg?.cobravelDoCliente ?? false,
      precoRazao,
    },
  })
}
