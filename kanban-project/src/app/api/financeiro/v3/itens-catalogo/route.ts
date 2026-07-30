// /api/financeiro/v3/itens-catalogo — itens ELEGÍVEIS a um lançamento novo
// (Novo Custo / Nova Receita). Leitura enxuta, gated por 'financeiro.ver' (o
// cadastro/edição continua exclusivo do Gerenciamento). Nunca cria/edita.
//
// FONTE ÚNICA da ELEGIBILIDADE: ItemCatalogo (Cadastro Mestre oficial) +
// Configuração Financeira (ProdutoFinanceiro por itemCatalogoId) + Tabela de
// Valores, julgados por `lib/financeiro/catalogo-oficial`. É a MESMA regra
// aplicada na criação do lançamento — nenhum item de estrutura eliminada
// (PRODUTO/HONORARIO) é retornado, e Receita exige preço VIGENTE.
//
// BUSCA SERVER-SIDE (?q=) — o seletor do lançamento é pesquisável e NÃO carrega a
// lista inteira: procura por nome, código, descrição e categoria. Cada item volta
// com os SINAIS que o operador precisa para escolher sem abrir o Gerenciamento:
// tem configuração financeira? tem preço na Tabela de Valores? qual moeda? tem
// fornecedor padrão? Sinal ausente é informação — é o que revela config incompleta.
//
// A resposta é a coleção final: o frontend NÃO filtra, não esconde e não corrige.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { NaturezaItem } from '@prisma/client'
import { NATUREZAS_ITEM_OFICIAIS, elegibilidadeParaLancamento, hojeISO } from '@/lib/financeiro/catalogo-oficial'
import type { LancamentoNatureza } from '@/lib/financeiro/natureza-financeira'

// A lista oficial é a do domínio; aqui só se traduz para o enum do Prisma.
const NATUREZAS_PRISMA = NATUREZAS_ITEM_OFICIAIS.map((n) => NaturezaItem[n])

const LIMITE_PADRAO = 40
const LIMITE_MAX = 100

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const sp = req.nextUrl.searchParams
  // Natureza do lançamento que vai nascer. `paraReceita=1` é a forma antiga —
  // preservada para não quebrar chamadas existentes.
  const natureza: LancamentoNatureza =
    (sp.get('paraReceita') === '1' || sp.get('natureza')?.toUpperCase() === 'RECEITA') ? 'RECEITA' : 'CUSTO'
  const paraReceita = natureza === 'RECEITA'
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

  // Corte estrutural já no banco: ativo + classificação OFICIAL (as eliminadas
  // ficam de fora sem lista de nomes) + existência de Configuração Financeira.
  // A janela é ampla o suficiente para o filtro de elegibilidade não devolver
  // menos itens do que o pedido; o corte final é feito abaixo.
  const janela = Math.min(Math.max(limite * 5, limite + 1), 400)
  const candidatos = await prisma.itemCatalogo.findMany({
    where: {
      ativo: true,
      natureza: { in: NATUREZAS_PRISMA },
      produtos: { some: { ativo: true } },
      ...busca,
    },
    orderBy: [{ categoria: 'asc' }, { name: 'asc' }],
    take: janela,
    select: {
      id: true, code: true, name: true, descricao: true, natureza: true, categoria: true, unidade: true,
      produtos: {
        where: { ativo: true },
        select: {
          id: true, ativo: true, naturezaFin: true, possuiCusto: true, possuiReceita: true,
          valorCustoPadrao: true, valorReceitaPadrao: true, moedaPadrao: true,
          fornecedorPadrao: { select: { nome: true } },
          categoria: { select: { nome: true } },
        },
      },
      // Vigência entra junto: é ela que decide a elegibilidade a Receita e também
      // alimenta o sinal `temPreco` — uma consulta, uma verdade.
      precos: {
        where: { arquivado: false, legadoPendente: false },
        select: { natureza: true, arquivado: true, legadoPendente: true, vigenciaInicio: true, vigenciaFim: true },
      },
    },
  })

  const hoje = hojeISO(new Date())
  const elegiveis = candidatos.filter((i) => {
    // M-UNIFICA: uma Configuração Financeira por item mestre.
    const cfg = i.produtos[0]
    return elegibilidadeParaLancamento({
      item: { ativo: true, natureza: i.natureza },
      config: cfg && {
        ativo: cfg.ativo,
        naturezaFin: cfg.naturezaFin,
        possuiCusto: cfg.possuiCusto,
        possuiReceita: cfg.possuiReceita,
        valorCustoPadrao: cfg.valorCustoPadrao != null ? Number(cfg.valorCustoPadrao) : null,
        valorReceitaPadrao: cfg.valorReceitaPadrao != null ? Number(cfg.valorReceitaPadrao) : null,
      },
      precos: i.precos,
      natureza,
      hoje,
    }).ok
  })

  const truncado = elegiveis.length > limite
  const pagina = elegiveis.slice(0, limite)
  // PRESENÇA de preço para a natureza do lançamento (não valor — o valor vem do
  // item-config, que passa pelo resolvedor oficial e considera processo/quantidade).
  // RECEITA legado ≡ VENDA (mesma canonicalização da Tabela de Valores).
  const naturezasPreco = paraReceita ? ['VENDA', 'RECEITA'] : ['CUSTO']

  return NextResponse.json({
    truncado,
    total: pagina.length,
    itens: pagina.map((i) => {
      const c = i.produtos[0]
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
        temPreco: i.precos.some((p) => naturezasPreco.includes(String(p.natureza))),
        moeda: c?.moedaPadrao ? String(c.moedaPadrao) : null,
        fornecedorPadraoNome: c?.fornecedorPadrao?.nome ?? null,
      }
    }),
  })
}
