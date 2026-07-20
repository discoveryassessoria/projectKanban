import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET — dados da tela: processos+fases + workflows internos aplicados (sem biblioteca de modelos)
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const [tipos, workflows] = await Promise.all([
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
    ])

    const tiposProcesso = tipos.map((t) => ({
      id: t.id,
      name: t.name,
      fases: (t.macroWorkflow?.fases || []).map((f) => ({
        phaseKey: f.phaseKey, label: f.label, order: f.ordem,
      })),
    }))

    return NextResponse.json({ tiposProcesso, workflows })
  } catch (e) {
    console.error('GET workflows-fase', e)
    return NextResponse.json({ error: 'Erro ao carregar workflows das fases.' }, { status: 500 })
  }
}

// POST — criar Workflow Interno vazio (ad-hoc). A aplicação de MODELO (biblioteca) foi removida.
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const body = await request.json()


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