// src/app/api/cron/cartorios/route.ts
// JOB DIÁRIO (Vercel Cron) — sincroniza a base nacional de Cartórios de Registro
// Civil. Protegido por CRON_SECRET (Authorization: Bearer) ou pelo header oficial
// de cron da Vercel. Usa o MESMO serviço do botão "Sincronizar agora" (nunca
// fluxo paralelo). Idempotente e com trava de concorrência.
import { NextRequest, NextResponse } from "next/server"
import { sincronizarCartorios } from "@/src/services/cartorios/cartorio-sync-service"

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
    const r = await sincronizarCartorios({ gatilho: "cron" })
    return NextResponse.json(r)
  } catch (e) {
    console.error("[cron cartorios] falha:", e)
    return NextResponse.json({ error: "falha no job de sincronização de cartórios" }, { status: 500 })
  }
}
