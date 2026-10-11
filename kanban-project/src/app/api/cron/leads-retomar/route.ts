// src/app/api/cron/leads-retomar/route.ts
// ============================================================================
// JOB A CADA 10 MINUTOS (Vercel Cron) — rede de segurança do agente de leads (docs/leads-mandato.md §7).
//
// O atendimento normal acontece na própria chamada do webhook do WhatsApp. Se aquela função morrer no
// meio (ou a IA demorar além do limite), o lead ficaria sem resposta e ninguém saberia. Este job
// responde as conversas que estão com o agente e têm mensagem sem resposta há mais de um minuto.
//
// Mesma convenção dos outros crons: o middleware libera, o handler se auto-verifica (CRON_SECRET ou
// header oficial da Vercel). Idempotente. Sem as chaves do WhatsApp não há o que retomar: termina bem
// e deixa o rastro do mesmo jeito (o job rodou).
// ============================================================================
import { NextRequest, NextResponse } from "next/server"
import { registrarExecucaoDeCron } from "@/lib/operacional/cron-rastro"
import { dependenciasReais, retomarConversasParadas } from "@/src/services/leads/atendimento"

export const dynamic = "force-dynamic"
export const maxDuration = 120

function autorizado(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get("authorization") || ""
  if (secret && auth === `Bearer ${secret}`) return true
  if (req.headers.get("x-vercel-cron")) return true
  return false
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "não autorizado" }, { status: 401 })
  try {
    const deps = dependenciasReais()
    const r = deps ? await retomarConversasParadas(deps) : { encontradas: 0, retomadas: 0 }
    await registrarExecucaoDeCron("leads-retomar")
    return NextResponse.json({ configurado: Boolean(deps), ...r })
  } catch (e) {
    console.error("[cron/leads-retomar] falhou:", e)
    return NextResponse.json({ error: "falha ao retomar conversas de leads" }, { status: 500 })
  }
}
