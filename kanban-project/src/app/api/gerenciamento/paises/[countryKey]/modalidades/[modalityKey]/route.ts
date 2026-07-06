// ESTE ARQUIVO VAI EM: src/app/api/gerenciamento/paises/[countryKey]/modalidades/[modalityKey]/route.ts
//
// PUT    - edita a modalidade (nome, sufixo, ordem, ativo).
//          Propaga modalityLabel pros tipos existentes (guardam cópia).
// DELETE - exclui a modalidade (só se NENHUM tipo usar; senão 409 →
//          a UI sugere inativar).

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function PUT(request: Request, { params }: { params: Promise<{ countryKey: string; modalityKey: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { countryKey, modalityKey } = await params
    const atual = await prisma.modalidadePais.findUnique({
      where: { countryKey_modalityKey: { countryKey, modalityKey } },
    })
    if (!atual) return NextResponse.json({ error: 'Modalidade não encontrada.' }, { status: 404 })

    const b = await request.json().catch(() => ({}))

    const modalidade = await prisma.modalidadePais.update({
      where: { countryKey_modalityKey: { countryKey, modalityKey } },
      data: {
        modalityLabel: b.modalityLabel !== undefined ? String(b.modalityLabel).trim() : atual.modalityLabel,
        codeSuffix: b.codeSuffix !== undefined ? (b.codeSuffix ? String(b.codeSuffix).trim() : null) : atual.codeSuffix,
        ordem: b.ordem !== undefined ? Number(b.ordem) : atual.ordem,
        ativo: b.ativo !== undefined ? Boolean(b.ativo) : atual.ativo,
      },
    })

    // Propaga o label pros tipos existentes (eles guardam cópia)
    if (b.modalityLabel !== undefined) {
      await prisma.tipoProcessoNacionalidade.updateMany({
        where: { countryKey, modalityKey },
        data: { modalityLabel: modalidade.modalityLabel },
      })
    }

    return NextResponse.json({ modalidade })
  } catch (error) {
    console.error('Erro ao editar modalidade:', error)
    return NextResponse.json({ error: 'Erro ao editar modalidade' }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ countryKey: string; modalityKey: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { countryKey, modalityKey } = await params
    const atual = await prisma.modalidadePais.findUnique({
      where: { countryKey_modalityKey: { countryKey, modalityKey } },
    })
    if (!atual) return NextResponse.json({ error: 'Modalidade não encontrada.' }, { status: 404 })

    const tipos = await prisma.tipoProcessoNacionalidade.count({ where: { countryKey, modalityKey } })
    if (tipos > 0) {
      return NextResponse.json(
        { error: `Esta modalidade é usada por ${tipos} tipo(s) de processo. Inative-a em vez de excluir.` },
        { status: 409 }
      )
    }

    await prisma.modalidadePais.delete({
      where: { countryKey_modalityKey: { countryKey, modalityKey } },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir modalidade:', error)
    return NextResponse.json({ error: 'Erro ao excluir modalidade' }, { status: 500 })
  }
}