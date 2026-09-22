// ESTE ARQUIVO VAI EM: src/app/api/gerenciamento/paises/[countryKey]/modalidades/[modalityKey]/route.ts
//
// PUT    - ativa/inativa/reordena a modalidade. NÃO renomeia: modalityLabel e
//          codeSuffix são FIXOS pela chave canônica (administrativa/judicial)
//          — mandato "Reconstrução da hierarquia", 22/09/2026: "códigos
//          estáveis, não renomeáveis para outro conceito".
// DELETE - exclui a modalidade (só se NENHUM tipo a tiver habilitada; senão
//          409 → a UI sugere inativar).

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function PUT(request: Request, { params }: { params: Promise<{ countryKey: string; modalityKey: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { countryKey, modalityKey } = await params
    const pais = await prisma.catalogoPais.findUnique({ where: { countryKey }, select: { id: true } })
    if (!pais) return NextResponse.json({ error: 'País não encontrado.' }, { status: 404 })
    const atual = await prisma.modalidadePais.findUnique({
      where: { paisId_modalityKey: { paisId: pais.id, modalityKey } },
    })
    if (!atual) return NextResponse.json({ error: 'Modalidade não encontrada.' }, { status: 404 })

    const b = await request.json().catch(() => ({}))

    const modalidade = await prisma.modalidadePais.update({
      where: { paisId_modalityKey: { paisId: pais.id, modalityKey } },
      data: {
        ordem: b.ordem !== undefined ? Number(b.ordem) : atual.ordem,
        ativo: b.ativo !== undefined ? Boolean(b.ativo) : atual.ativo,
      },
    })

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
    const pais = await prisma.catalogoPais.findUnique({ where: { countryKey }, select: { id: true } })
    if (!pais) return NextResponse.json({ error: 'País não encontrado.' }, { status: 404 })
    const atual = await prisma.modalidadePais.findUnique({
      where: { paisId_modalityKey: { paisId: pais.id, modalityKey } },
    })
    if (!atual) return NextResponse.json({ error: 'Modalidade não encontrada.' }, { status: 404 })

    const tipos = await prisma.tipoProcessoModalidadeHabilitada.count({ where: { modalidadeId: atual.id, ativo: true } })
    if (tipos > 0) {
      return NextResponse.json(
        { error: `Esta modalidade é usada por ${tipos} tipo(s) de processo. Inative-a em vez de excluir.` },
        { status: 409 }
      )
    }

    const macros = await prisma.macroWorkflow.count({ where: { modalidadeId: atual.id } })
    if (macros > 0) {
      return NextResponse.json(
        { error: `Esta modalidade tem ${macros} Workflow(s) Macro publicado(s). Inative-a em vez de excluir.` },
        { status: 409 }
      )
    }

    await prisma.modalidadePais.delete({
      where: { paisId_modalityKey: { paisId: pais.id, modalityKey } },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir modalidade:', error)
    return NextResponse.json({ error: 'Erro ao excluir modalidade' }, { status: 500 })
  }
}
