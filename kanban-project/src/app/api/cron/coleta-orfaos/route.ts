// src/app/api/cron/coleta-orfaos/route.ts
// JOB DIÁRIO (Vercel Cron) — arquivos da coleta enviados SEM o formulário completo (docs/proposta-anexos-cliente-e-privacidade.md, ponto (a)).
// Por padrão SÓ RELATA (auditoria); apaga apenas com COLETA_ORFAOS_APAGAR=1, que o dono liga depois de uma semana de relatórios.
// Mesma convenção dos outros crons: o middleware libera, o handler se auto-verifica (CRON_SECRET ou header oficial da Vercel).
import { NextRequest, NextResponse } from "next/server"
import { rodarVarreduraDaColeta } from "@/src/services/coleta/coleta-orfaos"

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
    const r = await rodarVarreduraDaColeta()
    // Só o resumo: as chaves ficam na auditoria (a resposta do cron não espalha nomes de arquivo).
    return NextResponse.json({ geradoEm: r.geradoEm, modo: r.modo, totais: r.totais, apagados: r.apagados.length, pulados: r.pulados.length, falhas: r.falhas.length })
  } catch (e) {
    console.error("[cron coleta-orfaos] falha:", e)
    return NextResponse.json({ error: "falha na varredura de arquivos da coleta" }, { status: 500 })
  }
}
