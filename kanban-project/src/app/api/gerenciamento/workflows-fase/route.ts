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

// snapshot dos passos do modelo 2B → passos da instância, com CHAVES ÚNICAS
function snapshotSteps(passos: any[], workflowId?: number) {
  const seen = new Set<string>()
  return (passos || []).map((p: any, i: number) => {
    let base = slug(String(p?.name || '')); if (!base) base = 'passo_' + (i + 1)
    let key = base, n = 2
    while (seen.has(key)) { key = base + '_' + n; n++ }
    seen.add(key)
    const row: any = {
      key,
      label: String(p?.name || 'Etapa'),
      description: p?.description ?? null,
      ordem: p?.ordem ?? i + 1,
      createsTask: p?.generatesTask !== false,
      required: p?.required !== false,
      owner: p?.defaultResponsibleRole ?? null,
      priority: p?.defaultPriority || 'medium',
      slaDays: p?.defaultSlaDays ?? 0,
      completionRule: p?.completionCondition ?? null,
      checklist: (p?.checklist == null ? undefined : p.checklist) as Prisma.InputJsonValue | undefined,
    }
    if (workflowId) row.workflowId = workflowId
    return row
  })
}

// GET — dados da tela: processos+fases, workflows aplicados, biblioteca 2B
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const [tipos, workflows, modelos] = await Promise.all([
      prisma.tipoProcessoNacionalidade.findMany({
        where: { arquivado: false },
        include: { macroWorkflow: { include: { fases: { orderBy: { ordem: 'asc' } } } } },
        orderBy: { name: 'asc' },
      }),
      prisma.phaseInternalWorkflow.findMany({
        where: { arquivado: false },
        include: { passos: { orderBy: { ordem: 'asc' } } },
        orderBy: { criadoEm: 'asc' },
      }),
      prisma.modeloWorkflowInterno.findMany({
        where: { arquivado: false },
        include: { passos: { orderBy: { ordem: 'asc' } } },
        orderBy: { name: 'asc' },
      }),
    ])

    const tiposProcesso = tipos.map((t) => ({
      id: t.id,
      name: t.name,
      fases: (t.macroWorkflow?.fases || []).map((f) => ({
        phaseKey: f.phaseKey, label: f.label, order: f.ordem,
      })),
    }))

    return NextResponse.json({ tiposProcesso, workflows, modelosWorkflow: modelos })
  } catch (e) {
    console.error('GET workflows-fase', e)
    return NextResponse.json({ error: 'Erro ao carregar workflows das fases.' }, { status: 500 })
  }
}

// POST — aplicar modelo 2B (com conflito) OU criar workflow vazio ad-hoc
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const body = await request.json()

    // ---------- APLICAR MODELO 2B ----------
    if (body.aplicar) {
      const templateId = Number(body.templateId)
      const phaseKey = String(body.phaseKey || '')
      const tipoProcessoId = body.tipoProcessoId == null ? null : Number(body.tipoProcessoId)
      const mode = body.mode as string | undefined // undefined | 'replace'
      if (!templateId || !phaseKey) {
        return NextResponse.json({ error: 'templateId e phaseKey são obrigatórios.' }, { status: 400 })
      }

      const modelo = await prisma.modeloWorkflowInterno.findUnique({
        where: { id: templateId },
        include: { passos: { orderBy: { ordem: 'asc' } } },
      })
      if (!modelo) return NextResponse.json({ error: 'Modelo não encontrado.' }, { status: 404 })

      const wfUid = `${tipoProcessoId ?? 'all'}::${phaseKey}`
      const existente = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid } })

      // já existe e não escolheu o que fazer → devolve needsChoice
      if (existente && mode !== 'replace') {
        return NextResponse.json({ needsChoice: true, existingId: existente.id })
      }

      if (existente && mode === 'replace') {
        const stepData = snapshotSteps(modelo.passos, existente.id)
        await prisma.$transaction(async (tx) => {
          await tx.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: existente.id } })
          await tx.phaseInternalWorkflow.update({
            where: { id: existente.id }, data: { templateId: modelo.id, name: modelo.name },
          })
          if (stepData.length) await tx.phaseInternalWorkflowStep.createMany({ data: stepData })
        })
        await prisma.modeloWorkflowInterno.update({
          where: { id: modelo.id }, data: { usedByCount: { increment: 1 } },
        })
        const wf = await prisma.phaseInternalWorkflow.findUnique({
          where: { id: existente.id }, include: { passos: { orderBy: { ordem: 'asc' } } },
        })
        return NextResponse.json({ workflow: wf })
      }

      // não existe → cria primário (nested create; passos já vêm únicos)
      const criado = await prisma.phaseInternalWorkflow.create({
        data: {
          wfUid, templateId: modelo.id, tipoProcessoId, phaseKey,
          name: modelo.name, passos: { create: snapshotSteps(modelo.passos) },
        },
        include: { passos: { orderBy: { ordem: 'asc' } } },
      })
      await prisma.modeloWorkflowInterno.update({
        where: { id: modelo.id }, data: { usedByCount: { increment: 1 } },
      })
      return NextResponse.json({ workflow: criado }, { status: 201 })
    }

    // ---------- CRIAR WORKFLOW VAZIO (ad-hoc) ----------
    if (body.criar) {
      const phaseKey = String(body.phaseKey || '')
      const phaseLabel = String(body.phaseLabel || phaseKey)
      const tipoProcessoId = body.tipoProcessoId == null ? null : Number(body.tipoProcessoId)
      if (!phaseKey) return NextResponse.json({ error: 'phaseKey é obrigatório.' }, { status: 400 })

      const wfUid = `${tipoProcessoId ?? 'all'}::${phaseKey}`
      const dup = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid } })
      if (dup) return NextResponse.json({ error: 'Esta fase já possui um Workflow Interno.' }, { status: 409 })

      const criado = await prisma.phaseInternalWorkflow.create({
        data: { wfUid, tipoProcessoId, phaseKey, name: 'Workflow Interno · ' + phaseLabel },
        include: { passos: { orderBy: { ordem: 'asc' } } },
      })
      return NextResponse.json({ workflow: criado }, { status: 201 })
    }

    return NextResponse.json({ error: 'Ação não reconhecida.' }, { status: 400 })
  } catch (e) {
    console.error('POST workflows-fase', e)
    return NextResponse.json({ error: 'Erro ao processar a ação.' }, { status: 500 })
  }
}