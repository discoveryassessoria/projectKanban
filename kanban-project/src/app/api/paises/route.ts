// ESTE ARQUIVO VAI EM: src/app/api/paises/route.ts   (PASTA NOVA "paises" direto em /api)
//
// GET - lista os países ATIVOS do catálogo (countryKey, countryLabel, flag).
// Endpoint leve, sem exigir permissão de admin — é só o catálogo de países,
// usado por telas de usuário comum (ex.: filtros de Tarefas e Projetos).
// NÃO confundir com /api/gerenciamento/paises (esse é do admin).

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const paises = await prisma.catalogoPais.findMany({
      where: { ativo: true },
      orderBy: { countryLabel: 'asc' },
      select: { countryKey: true, countryLabel: true, flag: true },
    })
    return NextResponse.json({ paises })
  } catch (error) {
    console.error('Erro ao listar países:', error)
    return NextResponse.json({ error: 'Erro ao listar países' }, { status: 500 })
  }
}