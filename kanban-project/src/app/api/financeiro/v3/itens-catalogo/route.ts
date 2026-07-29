// /api/financeiro/v3/itens-catalogo — itens ELEGÍVEIS a um lançamento novo
// (Novo Custo / Nova Receita). Leitura enxuta, gated por 'financeiro.ver' (o
// cadastro/edição continua exclusivo do Gerenciamento).
//
// FONTE ÚNICA: ItemCatalogo (Cadastro Mestre oficial) + Configuração Financeira
// (ProdutoFinanceiro por itemCatalogoId) + Tabela de Valores. Nenhuma tabela
// legada é consultada e nenhum item de estrutura eliminada é retornado — a regra
// é a MESMA aplicada na criação do lançamento (lib/financeiro/catalogo-oficial).
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

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro

  // Natureza do lançamento que vai nascer. `paraReceita=1` é a forma antiga —
  // preservada para não quebrar chamadas existentes.
  const sp = req.nextUrl.searchParams
  const natureza: LancamentoNatureza =
    (sp.get('paraReceita') === '1' || sp.get('natureza')?.toUpperCase() === 'RECEITA') ? 'RECEITA' : 'CUSTO'

  // Corte estrutural já no banco: ativo + classificação OFICIAL (as eliminadas
  // ficam de fora sem lista de nomes) + existência de Configuração Financeira.
  const itens = await prisma.itemCatalogo.findMany({
    where: {
      ativo: true,
      natureza: { in: NATUREZAS_PRISMA },
      produtos: { some: { ativo: true } },
    },
    orderBy: [{ natureza: 'asc' }, { name: 'asc' }],
    select: {
      id: true, code: true, name: true, natureza: true, categoria: true, unidade: true,
      produtos: {
        where: { ativo: true },
        select: { id: true, ativo: true, naturezaFin: true, possuiCusto: true, possuiReceita: true, valorCustoPadrao: true, valorReceitaPadrao: true },
      },
      precos: {
        where: { arquivado: false, legadoPendente: false },
        select: { natureza: true, arquivado: true, legadoPendente: true, vigenciaInicio: true, vigenciaFim: true },
      },
    },
  })

  const hoje = hojeISO(new Date())
  const elegiveis = itens.filter((i) => {
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
  }).map((i) => ({ id: i.id, code: i.code, name: i.name, natureza: i.natureza, categoria: i.categoria, unidade: i.unidade }))

  return NextResponse.json({ itens: elegiveis })
}
