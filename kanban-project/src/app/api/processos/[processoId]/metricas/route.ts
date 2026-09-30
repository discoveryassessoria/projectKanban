// src/app/api/processos/[processoId]/metricas/route.ts
// ============================================================================
// MÉTRICAS DE PROCESSO — Torre de Controle, Bloco E9 (29/09/2026).
//
//   GET /api/processos/123/metricas
//
// Progresso real (completude documental — a MESMA fonte da Central), dias na
// fase atual (data real de entrada, PhaseAdvanceLog) e próximo marco (texto
// derivado do estado real das tarefas). Rota de LEITURA pura.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { metricasDoProcesso } from '@/lib/operacional/metricas-processo'

export async function GET(request: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(request, 'processos.ver')
  if (erro) return erro

  const { processoId: raw } = await params
  const processoId = Number(raw)
  if (!Number.isInteger(processoId) || processoId <= 0) {
    return NextResponse.json({ error: 'processoId inválido' }, { status: 400 })
  }

  const metricas = await metricasDoProcesso(processoId)
  return NextResponse.json(metricas)
}
