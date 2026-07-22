import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { validarTaxa, paraColunasTaxa } from './campos'
import {
  INCLUDE_APLICABILIDADE_TAXA, resolverAplicabilidadeTaxa, vinculosTaxaParaCriar,
} from '@/lib/financeiro/taxa-aplicabilidade'

// GET — taxas (com a aplicabilidade já resolvida) + cadastros de apoio dos
// seletores (formas / moedas / países / serviços). Uma query por cadastro: a
// tela recebe tudo junto com a listagem, sem refetch a cada abertura do menu.
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const [taxas, formasPagamento, moedas, paises, servicos] = await Promise.all([
      prisma.taxaPagamento.findMany({
        orderBy: [{ prioridade: 'desc' }, { name: 'asc' }],
        include: INCLUDE_APLICABILIDADE_TAXA,
      }),
      prisma.formaPagamentoCadastro.findMany({ where: { ativo: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.moedaCadastro.findMany({ where: { ativo: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, ativo: true } }),
      prisma.catalogoPais.findMany({ where: { ativo: true }, orderBy: { countryLabel: 'asc' }, select: { id: true, countryKey: true, countryLabel: true, flag: true, ativo: true } }),
      prisma.servicoProduto.findMany({ where: { ativo: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } }),
    ])

    return NextResponse.json({ taxas, formasPagamento, moedas, paises, servicos })
  } catch (error) {
    console.error('Erro ao listar taxas de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST — Criar taxa
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()
    const erros = validarTaxa(b)
    if (erros.length) return NextResponse.json({ error: erros[0].mensagem, erros }, { status: 400 })

    // Aplicabilidade: os ids selecionados são conferidos CONTRA O CADASTRO
    // (existe? está ativo?) antes de qualquer escrita. O frontend nunca é a
    // autoridade — id inválido/inativo é rejeitado aqui.
    const aplic = await resolverAplicabilidadeTaxa(b)
    if (aplic.erros.length) {
      return NextResponse.json({ error: aplic.erros[0].mensagem, erros: aplic.erros }, { status: 400 })
    }

    const taxa = await prisma.taxaPagamento.create({
      data: {
        ...paraColunasTaxa(b),
        // Projeção legada derivada dos vínculos (o motor de cálculo lê daqui).
        ...aplic.projecao,
        ...vinculosTaxaParaCriar(aplic.selecao),
      },
      include: INCLUDE_APLICABILIDADE_TAXA,
    })
    return NextResponse.json({ taxa })
  } catch (error) {
    console.error('Erro ao criar taxa de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
