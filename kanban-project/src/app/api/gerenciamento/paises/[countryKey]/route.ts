// ESTE ARQUIVO VAI EM: src/app/api/gerenciamento/paises/[countryKey]/route.ts
//
// PUT    - edita o país (nome, bandeira, nacionalidade, prefixo, moeda, ativo).
//          Propaga countryLabel/nationalityLabel pros tipos existentes.
// DELETE - exclui o país (só se NÃO tiver tipos nem processos; senão 409 →
//          a UI sugere inativar). Apaga as modalidades junto.

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function PUT(request: Request, { params }: { params: Promise<{ countryKey: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { countryKey } = await params
    const atual = await prisma.catalogoPais.findUnique({ where: { countryKey } })
    if (!atual) return NextResponse.json({ error: 'País não encontrado.' }, { status: 404 })

    const b = await request.json().catch(() => ({}))

    const pais = await prisma.catalogoPais.update({
      where: { countryKey },
      data: {
        countryLabel: b.countryLabel !== undefined ? String(b.countryLabel).trim() : atual.countryLabel,
        nationalityLabel: b.nationalityLabel !== undefined ? String(b.nationalityLabel).trim() : atual.nationalityLabel,
        flag: b.flag !== undefined ? (b.flag ? String(b.flag).trim() : null) : atual.flag,
        codePrefix: b.codePrefix !== undefined ? (b.codePrefix ? String(b.codePrefix).trim() : null) : atual.codePrefix,
        defaultCurrency: b.defaultCurrency !== undefined ? String(b.defaultCurrency).trim() : atual.defaultCurrency,
        ativo: b.ativo !== undefined ? Boolean(b.ativo) : atual.ativo,
      },
    })

    // Propaga os labels pros tipos existentes (eles guardam cópia)
    if (b.countryLabel !== undefined || b.nationalityLabel !== undefined) {
      await prisma.tipoProcessoNacionalidade.updateMany({
        where: { countryKey },
        data: {
          ...(b.countryLabel !== undefined ? { countryLabel: pais.countryLabel } : {}),
          ...(b.nationalityLabel !== undefined ? { nationalityLabel: pais.nationalityLabel } : {}),
        },
      })
    }

    return NextResponse.json({ pais })
  } catch (error) {
    console.error('Erro ao editar país:', error)
    return NextResponse.json({ error: 'Erro ao editar país' }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ countryKey: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { countryKey } = await params
    const atual = await prisma.catalogoPais.findUnique({ where: { countryKey } })
    if (!atual) return NextResponse.json({ error: 'País não encontrado.' }, { status: 404 })

    // Bloqueia se estiver em uso
    const [tipos, processos] = await Promise.all([
      prisma.tipoProcessoNacionalidade.count({ where: { countryKey } }),
      prisma.processo.count({ where: { pais: countryKey } }),
    ])
    if (tipos > 0 || processos > 0) {
      return NextResponse.json(
        { error: `Este país tem ${tipos} tipo(s) de processo e ${processos} processo(s). Inative-o em vez de excluir.` },
        { status: 409 }
      )
    }

    await prisma.$transaction(async (tx) => {
      await tx.modalidadePais.deleteMany({ where: { countryKey } })
      await tx.catalogoPais.delete({ where: { countryKey } })
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir país:', error)
    return NextResponse.json({ error: 'Erro ao excluir país' }, { status: 500 })
  }
}