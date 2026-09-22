// ESTE ARQUIVO VAI EM: src/app/api/gerenciamento/paises/[countryKey]/modalidades/route.ts
//
// GET  - lista TODAS as modalidades do país (ativas e inativas) + quantos
//        tipos usam cada uma (pra saber se pode excluir)
// POST - habilita uma das DUAS modalidades canônicas neste país
//
// MODALIDADE É ENUMERAÇÃO CANÔNICA, NÃO CADASTRO DE TEXTO LIVRE (mandato
// "Reconstrução da hierarquia País/Tipo/Modalidade/Workflow Macro",
// 22/09/2026): "EXCLUSIVAMENTE duas: ADMINISTRATIVA e JUDICIAL. Não permitir
// terceira modalidade por texto livre." O rótulo/sufixo NUNCA vêm do corpo da
// requisição — são fixos aqui, e é isso que impede um "Recurso" ou
// "Exigência" de nascer como se fosse modalidade.

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const CANONICAS: Record<string, { modalityLabel: string; codeSuffix: string; ordem: number }> = {
  judicial: { modalityLabel: 'Judicial', codeSuffix: 'JUD', ordem: 0 },
  administrativa: { modalityLabel: 'Administrativa', codeSuffix: 'ADM', ordem: 1 },
}

export async function GET(request: Request, { params }: { params: Promise<{ countryKey: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { countryKey } = await params
    const pais = await prisma.catalogoPais.findUnique({ where: { countryKey } })
    if (!pais) return NextResponse.json({ error: 'País não encontrado.' }, { status: 404 })

    const [mods, habilitacoes] = await Promise.all([
      prisma.modalidadePais.findMany({ where: { paisId: pais.id }, orderBy: { ordem: 'asc' } }),
      // Quem usa a modalidade é a HABILITAÇÃO N:N (Tipo × Modalidade), não uma
      // cópia de FK único — um Tipo pode usar as duas.
      prisma.tipoProcessoModalidadeHabilitada.findMany({
        where: { ativo: true, tipoProcesso: { paisId: pais.id } },
        select: { modalidadeId: true },
      }),
    ])

    const contagem = new Map<number, number>()
    for (const h of habilitacoes) contagem.set(h.modalidadeId, (contagem.get(h.modalidadeId) || 0) + 1)

    const out = mods.map((m) => ({ ...m, tiposCount: contagem.get(m.id) || 0 }))
    return NextResponse.json({ modalidades: out, canonicas: Object.keys(CANONICAS) })
  } catch (error) {
    console.error('Erro ao listar modalidades:', error)
    return NextResponse.json({ error: 'Erro ao listar modalidades' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ countryKey: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { countryKey } = await params
    const pais = await prisma.catalogoPais.findUnique({ where: { countryKey } })
    if (!pais) return NextResponse.json({ error: 'País não encontrado.' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const modalityKey = String(body?.modalityKey || '').trim().toLowerCase()
    const canonica = CANONICAS[modalityKey]
    if (!canonica) {
      return NextResponse.json(
        { error: 'Modalidade inválida — só existem duas: Administrativa e Judicial.', code: 'MODALIDADE_NAO_CANONICA', canonicas: Object.keys(CANONICAS) },
        { status: 400 },
      )
    }

    const existe = await prisma.modalidadePais.findUnique({
      where: { paisId_modalityKey: { paisId: pais.id, modalityKey } },
    })
    if (existe) return NextResponse.json({ error: `Este país já tem a modalidade "${canonica.modalityLabel}".` }, { status: 409 })

    const modalidade = await prisma.modalidadePais.create({
      data: {
        paisId: pais.id,
        modalityKey,
        modalityLabel: canonica.modalityLabel,
        codeSuffix: canonica.codeSuffix,
        ordem: canonica.ordem,
        ativo: true,
      },
    })

    return NextResponse.json({ modalidade }, { status: 201 })
  } catch (e: any) {
    console.error('Erro ao criar modalidade:', e)
    return NextResponse.json({ error: e?.message || 'Erro ao criar modalidade.' }, { status: 500 })
  }
}
