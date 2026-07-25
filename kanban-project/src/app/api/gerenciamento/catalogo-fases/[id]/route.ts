// src/app/api/gerenciamento/catalogo-fases/[id]/route.ts
//
// Edição e exclusão de uma fase do catálogo (fonte única de fases).
// GUARDAS (não destrutivo):
//  - `phaseKey` é IMUTÁVEL depois de criada: é a chave que os fluxos (FaseMacro),
//    workflows internos, automações e o runtime usam. Renomear quebraria vínculos.
//  - excluir só é permitido se NENHUM fluxo usar a fase (senão devolve 409 e a UI
//    sugere inativar, que tira do seletor sem apagar nada).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.catalogoFase.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Fase não encontrada.' }, { status: 404 })

    const b = await request.json().catch(() => ({}))
    const fase = await prisma.catalogoFase.update({
      where: { id },
      // phaseKey NÃO entra no update — chave estável (vínculo com fluxos/runtime).
      data: {
        label: b?.label !== undefined ? String(b.label).trim() || atual.label : atual.label,
        ordemPadrao: b?.ordemPadrao !== undefined && Number.isFinite(Number(b.ordemPadrao)) ? Number(b.ordemPadrao) : atual.ordemPadrao,
        requiredPadrao: b?.requiredPadrao !== undefined ? !!b.requiredPadrao : atual.requiredPadrao,
        conditionalPadrao: b?.conditionalPadrao !== undefined ? !!b.conditionalPadrao : atual.conditionalPadrao,
        slaDiasPadrao: b?.slaDiasPadrao !== undefined && Number.isFinite(Number(b.slaDiasPadrao)) ? Number(b.slaDiasPadrao) : atual.slaDiasPadrao,
        ativo: b?.ativo !== undefined ? !!b.ativo : atual.ativo,
      },
    })
    const usos = await prisma.faseMacro.count({ where: { phaseKey: fase.phaseKey } })
    return NextResponse.json({ fase: { ...fase, usos } })
  } catch (e) {
    console.error('PUT catalogo-fases/[id]', e)
    return NextResponse.json({ error: 'Erro ao salvar a fase.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.catalogoFase.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Fase não encontrada.' }, { status: 404 })

    const usos = await prisma.faseMacro.count({ where: { phaseKey: atual.phaseKey } })
    if (usos > 0) {
      return NextResponse.json(
        { error: `Esta fase é usada em ${usos} fluxo(s). Inative-a em vez de excluir.` },
        { status: 409 },
      )
    }
    await prisma.catalogoFase.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE catalogo-fases/[id]', e)
    return NextResponse.json({ error: 'Erro ao excluir a fase.' }, { status: 500 })
  }
}
