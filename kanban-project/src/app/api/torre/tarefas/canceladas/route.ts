// src/app/api/torre/tarefas/canceladas/route.ts
// ============================================================================
// TORRE — AS CERTIDÕES CANCELADAS (Torre nova, aba Tarefas, 01/10/2026).
//
//   GET /api/torre/tarefas/canceladas[?pais=&processoId=]
//
// "Cancelar nunca esconde, só marca": a certidão CANCELADA continua visível na aba Tarefas — riscada, no fim do grupo da família, com o botão
// "Ver motivo". Ela NÃO é trabalho. A consulta é UMA SÓ (`listarCanceladasDaTorre`, src/services/torre-canceladas.ts): a mesma da página do processo.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { listarCanceladasDaTorre } from '@/src/services/torre-canceladas'
export type { EncerramentoDaTarefa } from '@/src/services/torre-canceladas'

export async function GET(request: NextRequest) {
  const { erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const sp = request.nextUrl.searchParams
  const processoId = Number(sp.get('processoId') ?? sp.get('processo'))
  const saida = await listarCanceladasDaTorre({ pais: sp.get('pais'), processoId: Number.isInteger(processoId) && processoId > 0 ? processoId : null })
  return NextResponse.json({ linhas: saida, total: saida.length })
}
