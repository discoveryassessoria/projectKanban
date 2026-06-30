import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Bootstrap: tipos de processo + catálogo de fases (+ flags dos países)
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const [tipos, catalogoFases, paises] = await Promise.all([
      prisma.tipoProcessoNacionalidade.findMany({
        where: { arquivado: false },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, name: true, countryKey: true, countryLabel: true, modalityLabel: true, ativo: true },
      }),
      prisma.catalogoFase.findMany({ where: { ativo: true }, orderBy: { ordemPadrao: 'asc' } }),
      prisma.catalogoPais.findMany({ select: { countryKey: true, flag: true } }),
    ])

    // marca quais tipos já têm workflow
    const comWf = await prisma.macroWorkflow.findMany({ select: { tipoProcessoId: true } })
    const setWf = new Set(comWf.map((m) => m.tipoProcessoId))
    const tiposOut = tipos.map((t) => ({ ...t, temWorkflow: setWf.has(t.id) }))

    return NextResponse.json({ tipos: tiposOut, catalogoFases, paises })
  } catch (error) {
    console.error('Erro no bootstrap do workflow macro:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar Workflow Macro para um tipo de processo (opcionalmente com as 10 fases padrão)
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()
    const tipoProcessoId = Number(b.tipoProcessoId)
    if (!tipoProcessoId) return NextResponse.json({ error: 'Informe o tipo de processo.' }, { status: 400 })

    const tipo = await prisma.tipoProcessoNacionalidade.findUnique({ where: { id: tipoProcessoId } })
    if (!tipo) return NextResponse.json({ error: 'Tipo de processo não encontrado.' }, { status: 404 })

    const existente = await prisma.macroWorkflow.findUnique({ where: { tipoProcessoId }, include: { fases: { orderBy: { ordem: 'asc' } } } })
    if (existente) return NextResponse.json({ macroWorkflow: existente })

    // monta as fases padrão a partir do catálogo, se pedido
    let fasesCreate: any = undefined
    if (b.seedDefaults) {
      const cat = await prisma.catalogoFase.findMany({ where: { ativo: true }, orderBy: { ordemPadrao: 'asc' } })
      fasesCreate = {
        create: cat.map((f, i) => ({
          phaseKey: f.phaseKey,
          label: f.label,
          ordem: i + 1,
          required: f.requiredPadrao,
          conditional: f.conditionalPadrao,
          entryRule: i === 0 ? 'process_created' : 'previous_phase_completed',
          slaDays: f.slaDiasPadrao,
          showInKanban: true,
        })),
      }
    }

    const macroWorkflow = await prisma.macroWorkflow.create({
      data: { tipoProcessoId, name: `Workflow Macro · ${tipo.name}`, ativo: true, ...(fasesCreate ? { fases: fasesCreate } : {}) },
      include: { fases: { orderBy: { ordem: 'asc' } } },
    })

    return NextResponse.json({ macroWorkflow })
  } catch (error) {
    console.error('Erro ao criar workflow macro:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}