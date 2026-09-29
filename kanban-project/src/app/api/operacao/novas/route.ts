// src/app/api/operacao/novas/route.ts
// ============================================================================
// AS TAREFAS "NOVAS" DA FAMÍLIA — para a Operação destacar o que chegou (redesenho do
// sino, 29/09/2026).
//
//   GET /api/operacao/novas?processo=<id>   →   { tarefaIds: number[] }
//
// "Novas" = as tarefas do ÚLTIMO aviso CHEGOU_TRABALHO daquela família para o usuário,
// lido ou não: um aviso nasce depois do clique anterior, então as tarefas dele são,
// exatamente, o que chegou desde a última vez que a pessoa olhou. Só LÊ a tabela de
// avisos do próprio usuário; quem decide o que a tela mostra continua sendo a fila real
// (a tela cruza estes ids com as linhas que já tem — id sem linha some sozinho).
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const processoId = Number(new URL(request.url).searchParams.get('processo'))
  if (!Number.isInteger(processoId) || processoId <= 0) return NextResponse.json({ error: 'processo inválido' }, { status: 400 })

  const ultimo = await prisma.notificacaoOperacional.findFirst({
    where: { destinatarioId: usuario.userId, tipo: 'CHEGOU_TRABALHO', agrupado: true, processoId },
    orderBy: { atualizadoEm: 'desc' },
    select: { tarefaIds: true },
  })
  return NextResponse.json({ tarefaIds: ultimo?.tarefaIds ?? [] })
}
