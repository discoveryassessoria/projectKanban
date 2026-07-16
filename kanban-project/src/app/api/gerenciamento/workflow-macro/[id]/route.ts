import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// [id] = tipoProcessoId (o workflow é 1:1 com o tipo de processo)

// GET - Workflow Macro (com fases) de um tipo de processo
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const { id } = await params
    const tipoProcessoId = Number(id)
    const macroWorkflow = await prisma.macroWorkflow.findUnique({
      where: { tipoProcessoId },
      include: { fases: { orderBy: { ordem: 'asc' } } },
    })
    return NextResponse.json({ macroWorkflow: macroWorkflow || null })
  } catch (error) {
    console.error('Erro ao buscar workflow macro:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// PUT - Sincroniza as fases do workflow (lista completa = verdade). Reordena, adiciona, remove.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const { id } = await params
    const tipoProcessoId = Number(id)

    const mw = await prisma.macroWorkflow.findUnique({ where: { tipoProcessoId }, include: { fases: true } })
    if (!mw) return NextResponse.json({ error: 'Workflow não encontrado para este processo.' }, { status: 404 })

    const b = await request.json()
    const incoming: any[] = Array.isArray(b.fases) ? b.fases : []
    const incomingKeys = incoming.map((f) => String(f.phaseKey))

    await prisma.$transaction(async (tx) => {
      if (b.name !== undefined) {
        await tx.macroWorkflow.update({ where: { id: mw.id }, data: { name: String(b.name).trim() } })
      }
      // remove as que sumiram
      await tx.faseMacro.deleteMany({ where: { macroWorkflowId: mw.id, phaseKey: { notIn: incomingKeys.length ? incomingKeys : ['__none__'] } } })
      // upsert cada uma na ordem recebida (entryRule derivado da posição)
      for (let i = 0; i < incoming.length; i++) {
        const f = incoming[i]
        // CONSOLIDAÇÃO DO AVANÇO DE FASE — o Workflow Macro define APENAS a
        // sequência (ordem/entryRule estrutural). exitRule foi descontinuada como
        // condição de conclusão (isso é do Workflow Interno + BlockingEngine):
        // não gravamos novos valores. A coluna permanece só p/ leitura de legado
        // (o update não a toca; a criação nasce sem exitRule).
        const dados = {
          label: String(f.label || f.phaseKey),
          ordem: i + 1,
          required: f.required !== false,
          conditional: !!f.conditional,
          entryRule: i === 0 ? 'process_created' : 'previous_phase_completed',
          slaDays: Number.isFinite(Number(f.slaDays)) ? Math.trunc(Number(f.slaDays)) : 30,
          showInKanban: f.showInKanban !== false,
        }
        await tx.faseMacro.upsert({
          where: { macroWorkflowId_phaseKey: { macroWorkflowId: mw.id, phaseKey: String(f.phaseKey) } },
          update: dados,
          create: { macroWorkflowId: mw.id, phaseKey: String(f.phaseKey), exitRule: null, ...dados },
        })
      }
    })

    const atualizado = await prisma.macroWorkflow.findUnique({ where: { id: mw.id }, include: { fases: { orderBy: { ordem: 'asc' } } } })
    return NextResponse.json({ macroWorkflow: atualizado })
  } catch (error) {
    console.error('Erro ao salvar fases do workflow macro:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - Apaga o workflow inteiro (cascade nas fases)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const { id } = await params
    const tipoProcessoId = Number(id)
    await prisma.macroWorkflow.delete({ where: { tipoProcessoId } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir workflow macro:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}