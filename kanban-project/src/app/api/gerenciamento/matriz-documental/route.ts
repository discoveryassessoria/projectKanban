import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET — matriz + processos (com suas fases) + tipos de documento
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const [tipos, docTypes, matriz] = await Promise.all([
      prisma.tipoProcessoNacionalidade.findMany({
        where: { ativo: true, arquivado: false },
        select: { id: true, name: true, macroWorkflow: { select: { fases: { select: { phaseKey: true, label: true, ordem: true }, orderBy: { ordem: 'asc' } } } } },
        orderBy: { name: 'asc' },
      }),
      prisma.tipoDocumentoCadastro.findMany({ where: { ativo: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.matrizDocumental.findMany({ orderBy: { criadoEm: 'asc' } }),
    ])
    const tiposProcesso = tipos.map(t => ({ id: t.id, name: t.name, fases: t.macroWorkflow?.fases ?? [] }))
    return NextResponse.json({ tiposProcesso, docTypes, matriz })
  } catch (e) {
    console.error('GET matriz-documental', e)
    return NextResponse.json({ error: 'Erro ao carregar a matriz documental.' }, { status: 500 })
  }
}

// POST — cria uma regra documental
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const b = await request.json()
    const tipoProcessoId = Number(b.tipoProcessoId)
    if (!tipoProcessoId) return NextResponse.json({ error: 'Escolha o processo.' }, { status: 400 })
    if (!b.documentTypeCode) return NextResponse.json({ error: 'Escolha o tipo de documento.' }, { status: 400 })
    const regra = await prisma.matrizDocumental.create({
      data: {
        tipoProcessoId,
        phaseKey: b.phaseKey ? String(b.phaseKey) : null,
        documentTypeCode: String(b.documentTypeCode),
        target: b.target || 'direct_line_person',
        generationRule: b.generationRule || 'all_direct_line',
        required: b.required !== false,
        conditional: !!b.conditional,
        condition: b.condition ? String(b.condition) : null,
        createsTask: b.createsTask !== false,
        createsCost: !!b.createsCost,
        createsRevenue: !!b.createsRevenue,
        blocksPhaseCompletion: !!b.blocksPhaseCompletion,
      },
    })
    return NextResponse.json({ regra }, { status: 201 })
  } catch (e) {
    console.error('POST matriz-documental', e)
    return NextResponse.json({ error: 'Erro ao criar a regra documental.' }, { status: 500 })
  }
}