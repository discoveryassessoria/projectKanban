// src/app/api/gerenciamento/condicoes-pagamento/[id]/route.ts
// PUT    - Atualizar condição (bloqueia alteração ESTRUTURAL de condição já usada)
// DELETE - Excluir condição (bloqueado quando há uso real)
//
// VERSIONAMENTO: condição que já gerou lançamento ou está vinculada a uma
// Configuração Financeira não pode ter o cronograma alterado — isso mudaria a
// leitura do histórico. Nesse caso o PUT responde 409 e a UI cria uma NOVA
// VERSÃO via POST com `substituiId`.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { inteiro, mudouEstrutura, paraColunas, validar } from '../campos'

/** Uma condição está "em uso" quando já produziu lançamento ou está vinculada. */
async function usoReal(id: number) {
  const [receitas, custos, configs] = await Promise.all([
    prisma.receita.count({ where: { condicaoPagamentoId: id } }),
    prisma.custo.count({ where: { condicaoPagamentoId: id } }),
    prisma.produtoFinanceiro.count({ where: { condicaoPagamentoId: id } }),
  ])
  return { receitas, custos, configs, total: receitas + custos + configs }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idParam } = await params
    const id = Number(idParam)
    if (!id || Number.isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const atual = await prisma.condicaoPagamento.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Condição não encontrada' }, { status: 404 })

    const b = await request.json()
    const erros = validar({ ...atual, ...b } as Record<string, unknown>)
    if (erros.length) return NextResponse.json({ error: erros[0].mensagem, erros }, { status: 400 })

    const colunas = paraColunas({ ...atual, ...b } as Record<string, unknown>)
    const estruturais = mudouEstrutura(atual as unknown as Record<string, unknown>, colunas as unknown as Record<string, unknown>)

    if (estruturais.length > 0) {
      const uso = await usoReal(id)
      if (uso.total > 0) {
        return NextResponse.json(
          {
            error:
              'Esta condição já está em uso e não pode ter o cronograma alterado. ' +
              'Crie uma nova versão para preservar os lançamentos históricos.',
            codigo: 'EXIGE_NOVA_VERSAO',
            camposEstruturais: estruturais,
            uso,
          },
          { status: 409 },
        )
      }
    }

    const ids = {
      formas: Array.isArray(b.formasPermitidas)
        ? b.formasPermitidas.map((x: unknown) => inteiro(x)).filter((x: number | null): x is number => x != null)
        : null,
      taxas: Array.isArray(b.taxasVinculadas)
        ? b.taxasVinculadas.map((x: unknown) => inteiro(x)).filter((x: number | null): x is number => x != null)
        : null,
    }

    const condicao = await prisma.$transaction(async (tx) => {
      if (ids.formas) {
        await tx.condicaoPagamentoForma.deleteMany({ where: { condicaoId: id } })
        if (ids.formas.length) {
          await tx.condicaoPagamentoForma.createMany({ data: ids.formas.map((formaId: number) => ({ condicaoId: id, formaId })) })
        }
      }
      if (ids.taxas) {
        await tx.condicaoPagamentoTaxa.deleteMany({ where: { condicaoId: id } })
        if (ids.taxas.length) {
          await tx.condicaoPagamentoTaxa.createMany({ data: ids.taxas.map((taxaId: number) => ({ condicaoId: id, taxaId })) })
        }
      }
      return tx.condicaoPagamento.update({
        where: { id },
        // codigo/versao/substituiId não se editam: pertencem ao versionamento.
        data: { ...colunas, codigo: atual.codigo ?? colunas.codigo },
        include: { formasPermitidas: true, taxasVinculadas: true },
      })
    })

    return NextResponse.json({ condicao })
  } catch (error) {
    console.error('Erro ao atualizar condição de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idParam } = await params
    const id = Number(idParam)
    if (!id || Number.isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const atual = await prisma.condicaoPagamento.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Condição não encontrada' }, { status: 404 })

    // Guarda de uso real: histórico financeiro nunca é destruído por exclusão
    // de cadastro. Condição em uso se INATIVA, não se apaga.
    const uso = await usoReal(id)
    if (uso.total > 0) {
      return NextResponse.json(
        {
          error:
            `Esta condição está em uso (${uso.receitas} receita(s), ${uso.custos} custo(s), ` +
            `${uso.configs} configuração(ões)). Desative-a em vez de excluir.`,
          codigo: 'EM_USO',
          uso,
        },
        { status: 409 },
      )
    }

    await prisma.condicaoPagamento.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir condição de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
