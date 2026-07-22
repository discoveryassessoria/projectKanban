import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { validarTaxa, paraColunasTaxa } from '../campos'

// PUT — Atualizar taxa (merge campo-a-campo → mapeamento único).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.taxaPagamento.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Taxa não encontrada' }, { status: 404 })

    const b = await request.json()
    const merged = { ...atual, ...b }
    const erros = validarTaxa(merged)
    if (erros.length) return NextResponse.json({ error: erros[0].mensagem, erros }, { status: 400 })

    const taxa = await prisma.taxaPagamento.update({ where: { id }, data: paraColunasTaxa(merged) })
    return NextResponse.json({ taxa })
  } catch (error) {
    console.error('Erro ao atualizar taxa de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE — bloqueia se a taxa estiver vinculada a alguma Condição; prefira desativar.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)

    const emCondicao = await prisma.condicaoPagamentoTaxa.count({ where: { taxaId: id } })
    if (emCondicao > 0) {
      return NextResponse.json({ error: 'Taxa vinculada a condição(ões) — desative em vez de excluir.', codigo: 'EM_USO', uso: { condicoes: emCondicao } }, { status: 409 })
    }

    await registrarAuditoria(request, { acao: 'EXCLUIR', entidade: 'TaxaPagamento', entidadeId: id, descricao: `Taxa de pagamento excluída (#${id})` })
    await prisma.taxaPagamento.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir taxa de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
