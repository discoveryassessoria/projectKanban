// src/app/api/cron/cambio/route.ts
// JOB DIÁRIO (Vercel Cron) — atualiza EUR/USD via Confidence. Protegido por CRON_SECRET
// (Authorization: Bearer) ou header oficial de cron da Vercel. Usa o MESMO serviço do
// botão "Atualizar agora" (nunca fluxo paralelo). Idempotente e com trava de concorrência.
import { NextRequest, NextResponse } from 'next/server'
import { atualizarCotacoesConfidence } from '@/src/lib/cambio/servico-cambio'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function autorizado(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  if (secret && auth === `Bearer ${secret}`) return true
  // Vercel Cron injeta este header em execuções agendadas.
  if (req.headers.get('x-vercel-cron')) return true
  return false
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
  try {
    const r = await atualizarCotacoesConfidence({ gatilho: 'cron' })
    return NextResponse.json(r)
  } catch (e) {
    console.error('[cron cambio] falha:', e)
    return NextResponse.json({ error: 'falha no job de câmbio' }, { status: 500 })
  }
}
