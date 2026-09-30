// src/app/api/operacao/tempo-medio-por-fase/route.ts
// ============================================================================
// TEMPO MÉDIO REAL POR FASE — Torre de Controle, Bloco E11 (29/09/2026).
//
//   GET /api/operacao/tempo-medio-por-fase                geral (todos os processos)
//   GET /api/operacao/tempo-medio-por-fase?processoId=123  só este processo
//
// A partir do log de transição (`PhaseAdvanceLog`) — nunca uma conta própria
// sobre `Tarefa.createdAt`. Ver a régua completa em
// `lib/operacional/metricas-processo.ts::tempoMedioRealPorFase`.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { tempoMedioRealPorFase } from '@/lib/operacional/metricas-processo'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'processos.ver')
  if (erro) return erro

  const bruto = request.nextUrl.searchParams.get('processoId')
  const processoId = bruto != null && bruto !== '' ? Number(bruto) : undefined
  if (processoId != null && (!Number.isInteger(processoId) || processoId <= 0)) {
    return NextResponse.json({ error: 'processoId inválido' }, { status: 400 })
  }

  const porFase = await tempoMedioRealPorFase(processoId)
  return NextResponse.json({ processoId: processoId ?? null, porFase })
}
