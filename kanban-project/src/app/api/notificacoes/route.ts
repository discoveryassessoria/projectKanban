// src/app/api/notificacoes/route.ts
// Retorna notificações categorizadas para o sino do HeaderBar.
// Filtro pesado feito no Postgres — payload ~3-8 kB em vez de 281 kB.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'

export async function GET(request: NextRequest) {
  try {
    const usuario = await extrairUsuarioComPermissoes(request)

    if (!usuario) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    // Janelas de tempo
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const em3Dias = new Date(hoje)
    em3Dias.setDate(em3Dias.getDate() + 3)
    const umDiaAtras = new Date()
    umDiaAtras.setDate(umDiaAtras.getDate() - 1)

    const tarefas = await prisma.tarefa.findMany({
      where: {
        concluida: false,
        AND: [
            // Filtro de responsável (minhas tarefas OU sem responsável)
            {
            OR: [
                { responsavelId: usuario.userId },
                { responsavelId: null }
            ]
            },
            // Janela de tempo (vencidas/próximas OU recém-criadas)
            {
            OR: [
                { dataPrazo: { lte: em3Dias } },
                { createdAt: { gte: umDiaAtras } }
            ]
            },
            // Excluir estruturais (mesma lógica do endpoint legado)
            {
            OR: [
                { tarefaPaiId: { not: null } },
                { processoId: null }
            ]
            }
        ]
      },
      select: {
        id: true,
        titulo: true,
        dataPrazo: true,
        createdAt: true,
        processoId: true,
        pais: true,
        processo: { select: { id: true, nome: true, pais: true } }
      },
      orderBy: { dataPrazo: 'asc' }
    })

    const vencidas: any[] = []
    const hojeList: any[] = []
    const proximos3Dias: any[] = []
    const novas: any[] = []

    for (const t of tarefas) {
      const item = {
        id: t.id,
        titulo: t.titulo,
        dataPrazo: t.dataPrazo,
        processoId: t.processo?.id ?? t.processoId,
        processoNome: t.processo?.nome ?? 'Sem processo',
        pais: t.pais ?? t.processo?.pais ?? null
      }

      if (t.dataPrazo) {
        const prazo = new Date(t.dataPrazo)
        prazo.setHours(0, 0, 0, 0)
        if (prazo < hoje) vencidas.push(item)
        else if (prazo.getTime() === hoje.getTime()) hojeList.push(item)
        else if (prazo <= em3Dias) proximos3Dias.push(item)
      }

      if (t.createdAt >= umDiaAtras) novas.push(item)
    }

    return NextResponse.json({
      vencidas,
      hoje: hojeList,
      proximos3Dias,
      novas,
      total: vencidas.length + hojeList.length + proximos3Dias.length + novas.length
    })
  } catch (error) {
    console.error('Erro ao buscar notificações:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}