// src/app/api/mensagens/nao-lidas/route.ts
// Conta mensagens não lidas pela equipe (enviadas por clientes)
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { extrairUsuarioKanban } from '@/lib/kanban-auth'

export async function GET(request: NextRequest) {
  try {
    const usuario = extrairUsuarioKanban(request)
    if (!usuario) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    // Contar mensagens enviadas por clientes que a equipe ainda não leu
    const totalNaoLidas = await prisma.mensagem.count({
      where: {
        clienteAuthId: { not: null }, // Enviada por cliente
        lidoPelaEquipe: false,        // Não lida pela equipe
        apagada: false,               // Não apagada
      },
    })

    return NextResponse.json({ totalNaoLidas })
  } catch (error) {
    console.error('Erro ao contar mensagens não lidas:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}