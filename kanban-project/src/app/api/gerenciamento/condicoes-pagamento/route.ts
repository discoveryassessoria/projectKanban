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

// GET - Listar
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const [condicoes, carteiras, formasPagamento, taxas] = await Promise.all([
      prisma.condicaoPagamento.findMany({
        orderBy: [{ name: 'asc' }, { versao: 'desc' }],
        include: {
          carteira: { select: { id: true, nome: true } },
          formasPermitidas: { select: { formaId: true } },
          taxasVinculadas: { select: { taxaId: true } },
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
        orderBy: { name: 'asc' },
      }),
    ])

    return NextResponse.json({ condicoes, carteiras, formasPagamento, taxas })
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

    const colunas = paraColunas(b)
    const substituiId = inteiro(b.substituiId)

    // Nova versão: herda o código da anterior e incrementa a versão; a anterior
    // é encerrada (vigenciaFim = agora) mas NUNCA é apagada nem alterada nos
    // campos estruturais — lançamentos históricos continuam apontando para ela.
    let versao = 1
    let codigo = colunas.codigo
    if (substituiId) {
      const anterior = await prisma.condicaoPagamento.findUnique({ where: { id: substituiId } })
      if (!anterior) return NextResponse.json({ error: 'Condição anterior não encontrada' }, { status: 404 })
      codigo = anterior.codigo ?? colunas.codigo
      const maxVersao = await prisma.condicaoPagamento.aggregate({
        where: codigo ? { codigo } : { id: substituiId },
        _max: { versao: true },
      })
      versao = (maxVersao._max.versao ?? anterior.versao ?? 1) + 1
    }

    const ids = {
      formas: (Array.isArray(b.formasPermitidas) ? b.formasPermitidas : []).map((x: unknown) => inteiro(x)).filter((x: number | null): x is number => x != null),
      taxas: (Array.isArray(b.taxasVinculadas) ? b.taxasVinculadas : []).map((x: unknown) => inteiro(x)).filter((x: number | null): x is number => x != null),
    }

    const condicao = await prisma.$transaction(async (tx) => {
      const criada = await tx.condicaoPagamento.create({
        data: {
          ...colunas,
          codigo,
          versao,
          substituiId: substituiId ?? null,
          vigenciaInicio: colunas.vigenciaInicio ?? new Date(),
          formasPermitidas: ids.formas.length ? { create: ids.formas.map((formaId: number) => ({ formaId })) } : undefined,
          taxasVinculadas: ids.taxas.length ? { create: ids.taxas.map((taxaId: number) => ({ taxaId })) } : undefined,
        },
        include: { formasPermitidas: true, taxasVinculadas: true },
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
