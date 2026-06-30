import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// PUT - Atualizar tipo de processo
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.tipoProcessoNacionalidade.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Tipo de processo não encontrado' }, { status: 404 })

    const b = await request.json()

    // Se mudou país/modalidade, re-resolve os labels denormalizados
    let paisFields = {}
    if (b.countryKey !== undefined && b.modalityKey !== undefined) {
      const pais = await prisma.catalogoPais.findUnique({ where: { countryKey: String(b.countryKey) } })
      const modalidade = await prisma.modalidadePais.findUnique({
        where: { countryKey_modalityKey: { countryKey: String(b.countryKey), modalityKey: String(b.modalityKey) } },
      })
      if (!pais) return NextResponse.json({ error: 'País não encontrado no catálogo.' }, { status: 400 })
      if (!modalidade) return NextResponse.json({ error: 'Modalidade não encontrada para este país.' }, { status: 400 })
      paisFields = {
        countryKey: pais.countryKey, countryLabel: pais.countryLabel,
        nationalityKey: pais.nationalityKey, nationalityLabel: pais.nationalityLabel,
        modalityKey: modalidade.modalityKey, modalityLabel: modalidade.modalityLabel,
      }
    }

    const tipo = await prisma.tipoProcessoNacionalidade.update({
      where: { id },
      data: {
        code: b.code !== undefined ? String(b.code).trim().toUpperCase() : atual.code,
        name: b.name !== undefined ? String(b.name).trim() : atual.name,
        ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
        arquivado: b.arquivado !== undefined ? !!b.arquivado : atual.arquivado,
        ...paisFields,
      },
    })

    return NextResponse.json({ tipo })
  } catch (error: any) {
    if (error?.code === 'P2002') return NextResponse.json({ error: 'Já existe um tipo de processo com esse código.' }, { status: 409 })
    console.error('Erro ao atualizar tipo de processo:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - Excluir tipo de processo
// ⚠ Na Fase 1B o macro workflow será 1:1 com FK; aí trocar por arquivar/bloquear se em uso.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    await prisma.tipoProcessoNacionalidade.delete({ where: { id } })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir tipo de processo:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}