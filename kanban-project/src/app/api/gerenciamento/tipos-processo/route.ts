import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Tipos de Processo + países + modalidades (p/ os seletores em cascata)
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const [tipos, paises, modalidades] = await Promise.all([
      prisma.tipoProcessoNacionalidade.findMany({ where: { arquivado: false }, orderBy: { name: 'asc' } }),
      prisma.catalogoPais.findMany({ where: { ativo: true }, orderBy: { countryLabel: 'asc' } }),
      prisma.modalidadePais.findMany({ where: { ativo: true }, orderBy: [{ countryKey: 'asc' }, { ordem: 'asc' }] }),
    ])

    return NextResponse.json({ tipos, paises, modalidades })
  } catch (error) {
    console.error('Erro ao listar tipos de processo:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar tipo de processo (labels resolvidos pelo servidor a partir das chaves)
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()
    if (!b.code || !String(b.code).trim()) return NextResponse.json({ error: 'Informe o código.' }, { status: 400 })
    if (!b.name || !String(b.name).trim()) return NextResponse.json({ error: 'Informe o nome.' }, { status: 400 })
    if (!b.countryKey || !b.modalityKey) return NextResponse.json({ error: 'Escolha país e modalidade.' }, { status: 400 })

    const pais = await prisma.catalogoPais.findUnique({ where: { countryKey: String(b.countryKey) } })
    const modalidade = await prisma.modalidadePais.findUnique({
      where: { countryKey_modalityKey: { countryKey: String(b.countryKey), modalityKey: String(b.modalityKey) } },
    })
    if (!pais) return NextResponse.json({ error: 'País não encontrado no catálogo.' }, { status: 400 })
    if (!modalidade) return NextResponse.json({ error: 'Modalidade não encontrada para este país.' }, { status: 400 })

    const tipo = await prisma.tipoProcessoNacionalidade.create({
      data: {
        code: String(b.code).trim().toUpperCase(),
        name: String(b.name).trim(),
        countryKey: pais.countryKey,
        countryLabel: pais.countryLabel,
        nationalityKey: pais.nationalityKey,
        nationalityLabel: pais.nationalityLabel,
        modalityKey: modalidade.modalityKey,
        modalityLabel: modalidade.modalityLabel,
        processFamily: 'cidadania',
        serviceNature: 'main_process',
        ativo: b.ativo !== false,
      },
    })

    return NextResponse.json({ tipo })
  } catch (error: any) {
    if (error?.code === 'P2002') return NextResponse.json({ error: 'Já existe um tipo de processo com esse código.' }, { status: 409 })
    console.error('Erro ao criar tipo de processo:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}