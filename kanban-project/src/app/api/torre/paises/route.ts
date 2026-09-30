// GET /api/torre/paises — o filtro de nacionalidade da Torre (Bloco J2): "Todas" + os países CADASTRADOS na oferta
// (Tipo de Processo ativo apontando para o país — a mesma lista do módulo de Relatórios). Nada fixo no código.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const { erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const paises = await prisma.catalogoPais.findMany({
    where: { ativo: true, tiposDeProcesso: { some: { ativo: true, arquivado: false } } },
    orderBy: { countryLabel: 'asc' }, select: { countryKey: true, countryLabel: true, flag: true },
  })
  return NextResponse.json({ paises: paises.map((p) => ({ chave: p.countryKey, rotulo: p.countryLabel, bandeira: p.flag })) })
}
