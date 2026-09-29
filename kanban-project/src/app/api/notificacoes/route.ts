// src/app/api/notificacoes/route.ts
// ============================================================================
// O SINO — lê SÓ a tabela de avisos (redesenho 29/09/2026).
//
// Antes, este endpoint somava duas fontes: os avisos da tabela E baldes recalculados a
// cada leitura direto de `Tarefa` (vencidas / hoje / próximos 3 dias / novas). Era a
// causa de "devido" e "vencido" duplicados para a mesma tarefa, de avisos sobre tarefas
// que já não eram da pessoa e de contadores que não fechavam. Agora não há recálculo
// aqui: o contador é o número de avisos NÃO LIDOS e ainda válidos (não expirados), e a
// lista de pendências é a Operação.
//
//   GET /api/notificacoes                 { avisos, anteriores: [], total }
//   GET /api/notificacoes?anteriores=1    idem, com os lidos dos últimos 30 dias
//
// RBAC embutido na própria query: cada usuário só vê o que É destinatário dele.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { avisosDoSino } from '@/lib/operacional/notificacao-canonica'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const comAnteriores = new URL(request.url).searchParams.get('anteriores') === '1'
    const r = await avisosDoSino(prisma, usuario.userId, { comAnteriores })
    return NextResponse.json({ avisos: r.naoLidos, anteriores: r.anteriores, total: r.total })
  } catch (error) {
    console.error('Erro ao buscar notificações:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
