import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { validarForma, paraColunasForma } from '../campos'

// PUT — Atualizar forma de pagamento (merge campo-a-campo → mapeamento único).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.formaPagamentoCadastro.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Forma de pagamento não encontrada' }, { status: 404 })

    const b = await request.json()
    // merge: só sobrescreve o que veio no body; o resto preserva o registro atual
    const merged = { ...atual, ...b }
    const erros = validarForma(merged)
    if (erros.length) return NextResponse.json({ error: erros[0].mensagem, erros }, { status: 400 })

    const forma = await prisma.formaPagamentoCadastro.update({ where: { id }, data: paraColunasForma(merged) })
    return NextResponse.json({ forma })
  } catch (error) {
    console.error('Erro ao atualizar forma de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE — bloqueia se houver Cobrança/Condição em uso; prefira desativar.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)

    const [emCondicao, emCobranca] = await Promise.all([
      prisma.condicaoPagamentoForma.count({ where: { formaId: id } }),
      prisma.cobranca.count({ where: { formaPagamentoId: id } }),
    ])
    if (emCondicao + emCobranca > 0) {
      return NextResponse.json({
        error: 'Forma em uso — desative em vez de excluir.',
        codigo: 'EM_USO', uso: { condicoes: emCondicao, cobrancas: emCobranca },
      }, { status: 409 })
    }

    await registrarAuditoria(request, { acao: 'EXCLUIR', entidade: 'FormaPagamentoCadastro', entidadeId: id, descricao: `Forma de pagamento excluída (#${id})` })
    await prisma.formaPagamentoCadastro.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir forma de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
