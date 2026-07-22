// src/app/api/gerenciamento/condicoes-pagamento/route.ts
// GET  - Listar condições (+ carteiras, formas e taxas para os selects)
// POST - Criar condição de pagamento
//
// A Condição de Pagamento é o cadastro OFICIAL das regras de cobrança: entrada,
// parcelamento, cronograma, distribuição, encargos, câmbio e restrições. O
// FinanceRuleEngine consome daqui (lib/financeiro/condicao-pagamento.ts).
//
// O mapeamento body→colunas vive em ./campos.ts, compartilhado com o PUT.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { paraColunas, validar, inteiro } from './campos'
import { gerarCodigoPublico } from '@/lib/codigos/code-generator'
import { INCLUDE_APLICABILIDADE, resolverAplicabilidade, vinculosParaCriar } from '@/lib/financeiro/condicao-aplicabilidade'
import { INCLUDE_FORMAS, resolverFormas } from '@/lib/financeiro/condicao-formas'

// GET - Listar
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    // Uma query por cadastro: as listas dos multiselects vêm prontas com a
    // listagem (sem N+1 e sem round-trip extra da tela).
    const [condicoes, carteiras, formasPagamento, taxas, servicos, moedas, paises, modalidades] = await Promise.all([
      prisma.condicaoPagamento.findMany({
        orderBy: [{ name: 'asc' }, { versao: 'desc' }],
        include: {
          carteira: { select: { id: true, nome: true } },
          // Formas permitidas COM nome/código/ativo: a tela precisa dos nomes,
          // não só dos ids (a Forma padrão é `formaSugeridaId`, já no registro).
          ...INCLUDE_FORMAS,
          taxasVinculadas: { select: { taxaId: true } },
          ...INCLUDE_APLICABILIDADE,
          _count: { select: { configuracoes: true, receitas: true, custos: true } },
        },
      }),
      prisma.carteiraRecebimento.findMany({
        where: { ativo: true },
        select: { id: true, nome: true },
        orderBy: { nome: 'asc' },
      }),
      prisma.formaPagamentoCadastro.findMany({
        where: { ativo: true },
        select: { id: true, name: true, code: true, icone: true },
        orderBy: [{ ordem: 'asc' }, { name: 'asc' }],
      }),
      prisma.taxaPagamento.findMany({
        where: { ativo: true },
        select: { id: true, name: true, code: true, feeType: true, feePercent: true, fixedFee: true },
        orderBy: [{ prioridade: 'desc' }, { name: 'asc' }],
      }),
      prisma.servicoProduto.findMany({
        where: { ativo: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
      prisma.moedaCadastro.findMany({
        where: { ativo: true },
        select: { id: true, code: true, name: true, symbol: true },
        orderBy: { code: 'asc' },
      }),
      prisma.catalogoPais.findMany({
        where: { ativo: true },
        select: { id: true, countryKey: true, countryLabel: true, flag: true },
        orderBy: { countryLabel: 'asc' },
      }),
      prisma.modalidadePais.findMany({
        where: { ativo: true },
        select: { id: true, countryKey: true, modalityKey: true, modalityLabel: true },
        orderBy: [{ countryKey: 'asc' }, { ordem: 'asc' }, { modalityLabel: 'asc' }],
      }),
    ])

    return NextResponse.json({ condicoes, carteiras, formasPagamento, taxas, servicos, moedas, paises, modalidades })
  } catch (error) {
    console.error('Erro ao listar condições de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar (ou criar NOVA VERSÃO quando `substituiId` vier no body)
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()
    const erros = validar(b)
    if (erros.length) {
      return NextResponse.json({ error: erros[0].mensagem, erros }, { status: 400 })
    }

    // Aplicabilidade: os ids selecionados são conferidos CONTRA O CADASTRO
    // (existe? está ativo?) antes de qualquer escrita. O frontend nunca é a
    // autoridade — id inválido/inativo é rejeitado aqui.
    const aplic = await resolverAplicabilidade(b)
    if (aplic.erros.length) {
      return NextResponse.json({ error: aplic.erros[0].mensagem, erros: aplic.erros }, { status: 400 })
    }

    // Formas permitidas + Forma padrão: existência, atividade e a regra "a
    // padrão precisa estar entre as permitidas" são conferidas AQUI.
    const formas = await resolverFormas(b)
    if (formas.erros.length) {
      return NextResponse.json({ error: formas.erros[0].mensagem, erros: formas.erros }, { status: 400 })
    }

    const colunas = paraColunas(b)
    const substituiId = inteiro(b.substituiId)

    // Nova versão: herda o código da anterior e incrementa a versão; a anterior
    // é encerrada (vigenciaFim = agora) mas NUNCA é apagada nem alterada nos
    // campos estruturais — lançamentos históricos continuam apontando para ela.
    let versao = 1
    let codigo: string | null = null
    let anteriorTinhaCodigo = false
    if (substituiId) {
      const anterior = await prisma.condicaoPagamento.findUnique({ where: { id: substituiId } })
      if (!anterior) return NextResponse.json({ error: 'Condição anterior não encontrada' }, { status: 404 })
      codigo = anterior.codigo
      anteriorTinhaCodigo = !!anterior.codigo
      const maxVersao = await prisma.condicaoPagamento.aggregate({
        where: codigo ? { codigo } : { id: substituiId },
        _max: { versao: true },
      })
      versao = (maxVersao._max.versao ?? anterior.versao ?? 1) + 1
    }

    const ids = {
      formas: formas.selecao.permitidas,
      taxas: (Array.isArray(b.taxasVinculadas) ? b.taxasVinculadas : []).map((x: unknown) => inteiro(x)).filter((x: number | null): x is number => x != null),
    }

    const condicao = await prisma.$transaction(async (tx) => {
      // CÓDIGO AUTOMÁTICO: gerado pelo serviço central, único e imutável. Uma
      // nova VERSÃO herda o código da anterior (o código identifica a regra, não
      // a versão) — nunca se regenera código de registro existente.
      const codigoFinal = anteriorTinhaCodigo && codigo ? codigo : await gerarCodigoPublico(tx, 'PAYMENT_TERM')

      const criada = await tx.condicaoPagamento.create({
        data: {
          ...colunas,
          // Projeção legada derivada dos vínculos (o motor de cálculo lê daqui).
          ...aplic.projecao,
          codigo: codigoFinal,
          versao,
          substituiId: substituiId ?? null,
          vigenciaInicio: colunas.vigenciaInicio ?? new Date(),
          formasPermitidas: ids.formas.length ? { create: ids.formas.map((formaId: number) => ({ formaId })) } : undefined,
          taxasVinculadas: ids.taxas.length ? { create: ids.taxas.map((taxaId: number) => ({ taxaId })) } : undefined,
          ...vinculosParaCriar(aplic.selecao),
        },
        include: { ...INCLUDE_FORMAS, taxasVinculadas: true, ...INCLUDE_APLICABILIDADE },
      })
      if (substituiId) {
        await tx.condicaoPagamento.update({
          where: { id: substituiId },
          data: { vigenciaFim: new Date(), ativo: false },
        })
      }
      return criada
    })

    await registrarAuditoria(request, { acao: 'CRIAR', entidade: 'CondicaoPagamento', entidadeId: condicao.id, descricao: `Condição de pagamento criada: ${condicao.name} (v${condicao.versao})` })
    return NextResponse.json({ condicao }, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar condição de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
