import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

function slug(s: string) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

// monta as linhas de passo já com workflowId e CHAVES ÚNICAS dentro do workflow
function buildSteps(raw: any[], workflowId: number) {
  const seen = new Set<string>()
  return (raw || []).map((s: any, i: number) => {
    let base = s?.key ? slug(String(s.key)) : slug(String(s?.label || ''))
    if (!base) base = 'passo_' + (i + 1)
    let key = base, n = 2
    while (seen.has(key)) { key = base + '_' + n; n++ }
    seen.add(key)
    return {
      workflowId,
      key,
      label: String(s?.label || 'Etapa'),
      description: s?.description ? String(s.description) : null,
      ordem: i + 1,
      createsTask: s?.createsTask !== false,
      required: s?.required !== false,
      owner: s?.owner ? String(s.owner) : null,
      priority: s?.priority || 'medium',
      slaDays: Number(s?.slaDays) || 0,
      completionRule: s?.completionRule ? String(s.completionRule) : null,
      checklist: (s?.checklist == null ? undefined : s.checklist) as Prisma.InputJsonValue | undefined,
    }
  })
}

// PUT — atualiza o workflow. Se vier "steps", SUBSTITUI todos os passos (atômico).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const body = await request.json()

    const atual = await prisma.phaseInternalWorkflow.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Workflow não encontrado.' }, { status: 404 })

    const dataBase: Prisma.PhaseInternalWorkflowUpdateInput = {}
    if (body.name !== undefined) dataBase.name = String(body.name)
    if (body.active !== undefined) dataBase.active = !!body.active
    if (body.arquivado !== undefined) dataBase.arquivado = !!body.arquivado

    if (Array.isArray(body.steps)) {
      const stepData = buildSteps(body.steps, id)
      // TRANSAÇÃO INTERATIVA — ordem garantida: apaga TUDO, depois cria de novo
      await prisma.$transaction(async (tx) => {
        await tx.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: id } })
        if (Object.keys(dataBase).length) {
          await tx.phaseInternalWorkflow.update({ where: { id }, data: dataBase })
        }
        if (stepData.length) {
          await tx.phaseInternalWorkflowStep.createMany({ data: stepData })
        }
      })
    } else if (Object.keys(dataBase).length) {
      await prisma.phaseInternalWorkflow.update({ where: { id }, data: dataBase })
    }

    const wf = await prisma.phaseInternalWorkflow.findUnique({
      where: { id }, include: { passos: { orderBy: { ordem: 'asc' } } },
    })
    return NextResponse.json({ workflow: wf })
  } catch (e) {
    console.error('PUT workflows-fase/[id]', e)
    return NextResponse.json({ error: 'Erro ao salvar o workflow.' }, { status: 500 })
  }
}

// DELETE — apaga o workflow (passos caem em cascade) e devolve usedByCount ao modelo
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { id: idStr } = await params
    const id = Number(idStr)

    const atual = await prisma.phaseInternalWorkflow.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Workflow não encontrado.' }, { status: 404 })

    await prisma.phaseInternalWorkflow.delete({ where: { id } })

    if (atual.templateId) {
      const modelo = await prisma.modeloWorkflowInterno.findUnique({ where: { id: atual.templateId } })
      if (modelo && modelo.usedByCount > 0) {
        await prisma.modeloWorkflowInterno.update({
          where: { id: atual.templateId }, data: { usedByCount: { decrement: 1 } },
        })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE workflows-fase/[id]', e)
    return NextResponse.json({ error: 'Erro ao excluir o workflow.' }, { status: 500 })
  }
}