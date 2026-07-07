// src/app/api/admin/mensagens/nao-lidas/route.ts
// Conta mensagens não lidas pela equipe (enviadas por clientes)
//
// ✅ Anti-P2024: essa rota era chamada MUITAS vezes (sininho fazendo polling).
// Agora tem uma MEMÓRIA CURTA (cache de 15s): dentro da janela, responde sem
// tocar no banco. Muitas chamadas seguidas viram UMA consulta só. E se o banco
// travar (pool cheio), devolve o último valor conhecido em vez de erro 500.
//
// A contagem é GLOBAL (não filtra por usuário) → um cache serve pra todo mundo.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { extrairUsuarioKanban } from '@/lib/kanban-auth'

// cache em memória (vive enquanto a instância do servidor estiver de pé)
let cache: { valor: number; expiraEm: number } | null = null
const TTL_MS = 15_000 // 15 segundos

export async function GET(request: NextRequest) {
  try {
    const usuario = await extrairUsuarioKanban(request)
    if (!usuario) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const agora = Date.now()

    // Ainda dentro da janela → responde do cache, SEM ir ao banco
    if (cache && cache.expiraEm > agora) {
      return NextResponse.json({ totalNaoLidas: cache.valor, cached: true })
    }

    try {
      // Contar mensagens enviadas por clientes que a equipe ainda não leu
      const totalNaoLidas = await prisma.mensagem.count({
        where: {
          clienteAuthId: { not: null }, // Enviada por cliente
          lidoPelaEquipe: false,        // Não lida pela equipe
          apagada: false,               // Não apagada
        },
      })

      cache = { valor: totalNaoLidas, expiraEm: agora + TTL_MS }
      return NextResponse.json({ totalNaoLidas })
    } catch (dbError) {
      // Banco travou (ex.: P2024, pool cheio). Em vez de 500, devolve o último
      // número que a gente sabia — o sininho não quebra por causa disso.
      if (cache) {
        return NextResponse.json({ totalNaoLidas: cache.valor, stale: true })
      }
      throw dbError
    }
  } catch (error) {
    console.error('Erro ao contar mensagens não lidas:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}