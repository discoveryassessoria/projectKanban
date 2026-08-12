import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { validarTaxa, paraColunasTaxa } from './campos'
import {
  INCLUDE_APLICABILIDADE_TAXA, resolverAplicabilidadeTaxa, vinculosTaxaParaCriar,
} from '@/lib/financeiro/taxa-aplicabilidade'
import { INCLUDE_PARCELAMENTO, linhasDoBody, linhasParaCriar, validarTabela } from '@/lib/financeiro/taxa-parcelamento'
import { resumoTaxa, formaPrincipalId } from '@/lib/financeiro/taxa-identidade'
import { resolverIdentidade, acharDuplicata, proximoCodigoTaxa } from './identidade-server'

// GET — taxas AGRUPADAS por tabela lógica (uma linha por Taxa, com a grade já
// resumida) + cadastros de apoio dos seletores (formas / adquirentes /
// bandeiras / moedas / países / serviços). Uma query por cadastro: a tela recebe
// tudo junto com a listagem, sem refetch a cada abertura do menu.
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const [taxas, formasPagamento, adquirentes, bandeiras, moedas, paises, servicos, usoBruto] = await Promise.all([
      prisma.taxaPagamento.findMany({
        orderBy: [{ prioridade: 'desc' }, { name: 'asc' }],
        include: { ...INCLUDE_APLICABILIDADE_TAXA, ...INCLUDE_PARCELAMENTO },
      }),
      prisma.formaPagamentoCadastro.findMany({ where: { ativo: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, type: true } }),
      prisma.adquirente.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, slug: true, formasSuportadas: true } }),
      prisma.bandeira.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, slug: true } }),
      prisma.moedaCadastro.findMany({ where: { ativo: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, ativo: true } }),
      prisma.catalogoPais.findMany({ where: { ativo: true }, orderBy: { countryLabel: 'asc' }, select: { id: true, countryKey: true, countryLabel: true, flag: true, ativo: true } }),
      prisma.servicoProduto.findMany({ where: { ativo: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } }),
      // "em uso": quantas cobranças congelaram cada taxa (histórico protegido).
      prisma.cobranca.groupBy({ by: ['taxaPagamentoId'], where: { taxaPagamentoId: { not: null } }, _count: { _all: true } }),
    ])

    const nomeForma = new Map(formasPagamento.map((f) => [f.id, f.name]))
    const tipoForma = new Map(formasPagamento.map((f) => [f.id, f.type]))
    const nomeAdq = new Map(adquirentes.map((a) => [a.id, a.nome]))
    const nomeBand = new Map(bandeiras.map((b) => [b.id, b.nome]))
    const usoPorTaxa = new Map(usoBruto.map((u) => [u.taxaPagamentoId as number, u._count._all]))

    // Enriquecimento: nomes dos vínculos + resumo da grade (min/máx, nº linhas) +
    // uso. A grade CONTINUA viajando junto (parcelamento) para a edição em lote.
    const taxasView = taxas.map((t) => {
      const formaId = formaPrincipalId(t)
      return {
        ...t,
        formaPrincipalId: formaId,
        formaNome: formaId != null ? (nomeForma.get(formaId) ?? null) : null,
        formaTipo: formaId != null ? (tipoForma.get(formaId) ?? null) : null,
        adquirenteNome: t.adquirenteId != null ? (nomeAdq.get(t.adquirenteId) ?? null) : null,
        bandeiraNome: t.bandeiraId != null ? (nomeBand.get(t.bandeiraId) ?? null) : null,
        resumo: resumoTaxa({ feeType: t.feeType, feePercent: t.feePercent != null ? Number(t.feePercent) : null, fixedFee: t.fixedFee != null ? Number(t.fixedFee) : null, parcelamento: (t.parcelamento ?? []).map((l) => ({ parcelasDe: l.parcelasDe, parcelasAte: l.parcelasAte, feePercent: l.feePercent != null ? Number(l.feePercent) : null, fixedFee: l.fixedFee != null ? Number(l.fixedFee) : null })) }),
        emUso: usoPorTaxa.get(t.id) ?? 0,
      }
    })

    return NextResponse.json({ taxas: taxasView, formasPagamento, adquirentes, bandeiras, moedas, paises, servicos })
  } catch (error) {
    console.error('Erro ao listar taxas de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST — Criar taxa. Nome e código são AUTOMÁTICOS (o cliente não é autoridade);
// unicidade lógica é validada no backend; a grade é gravada na mesma transação.
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()

    // Nome/vínculos derivados dos cadastros reais (autoridade do servidor).
    const ident = await resolverIdentidade(b)
    if (!ident.name) return NextResponse.json({ error: 'Selecione a forma de pagamento.' }, { status: 400 })
    b.name = ident.name

    const erros = validarTaxa(b)
    if (erros.length) return NextResponse.json({ error: erros[0].mensagem, erros }, { status: 400 })

    // Aplicabilidade: ids conferidos CONTRA O CADASTRO antes de qualquer escrita.
    const aplic = await resolverAplicabilidadeTaxa(b)
    if (aplic.erros.length) return NextResponse.json({ error: aplic.erros[0].mensagem, erros: aplic.erros }, { status: 400 })

    // Tabela de parcelamento (a taxa representa a tabela comercial inteira).
    const linhas = linhasDoBody(b)
    const errosTabela = validarTabela(linhas)
    if (errosTabela.length) return NextResponse.json({ error: errosTabela[0].mensagem, erros: errosTabela }, { status: 400 })

    // Unicidade lógica: sem duas tabelas ativas iguais (forma×adq×bandeira×final×vigência).
    const colunas = paraColunasTaxa(b)
    const dup = await acharDuplicata(ident, undefined)
    if (dup) return NextResponse.json({ error: `Já existe uma tabela ativa igual: "${dup.name}". Altere a vigência para criar uma nova versão.`, codigo: 'DUPLICADO', conflito: dup }, { status: 409 })

    const taxa = await prisma.$transaction(async (tx) => {
      const code = await proximoCodigoTaxa(tx)
      return tx.taxaPagamento.create({
        data: {
          ...colunas,
          code, // código automático (TXP) — nunca vem do cliente
          parcelamento: linhasParaCriar(linhas),
          ...aplic.projecao,
          ...vinculosTaxaParaCriar(aplic.selecao),
        },
        include: { ...INCLUDE_APLICABILIDADE_TAXA, ...INCLUDE_PARCELAMENTO },
      })
    })
    return NextResponse.json({ taxa })
  } catch (error) {
    console.error('Erro ao criar taxa de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
