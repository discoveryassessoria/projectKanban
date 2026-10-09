// src/app/api/cron/coleta-purga/route.ts
// JOB DIÁRIO (Vercel Cron) — retenção da coleta de dados: apaga dados e arquivos dos envios
// DESCARTADOS — e os PENDENTES de link encerrado por qualquer motivo — 30 dias após o encerramento do link (docs/coleta-de-dados-mandato.md §2.11;
// docs/proposta-anexos-cliente-e-privacidade.md, ponto (c)). Antes, carimba o link de processo que já saiu da fase pré-contrato.
// Mesma convenção dos outros crons: o middleware libera, o handler se auto-verifica
// (CRON_SECRET ou header oficial da Vercel). Idempotente.
import { NextRequest, NextResponse } from "next/server"
import { rodarRetencaoDaColeta } from "@/src/services/coleta/coleta-purga"
import { registrarExecucaoDeCron } from "@/lib/operacional/cron-rastro"

export const dynamic = "force-dynamic"
export const maxDuration = 60

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
    const r = await rodarRetencaoDaColeta()
    await registrarExecucaoDeCron("coleta-purga")
    return NextResponse.json(r)
  } catch (e) {
    console.error("[cron coleta-purga] falha:", e)
    return NextResponse.json({ error: "falha na purga da coleta" }, { status: 500 })
  }
}
