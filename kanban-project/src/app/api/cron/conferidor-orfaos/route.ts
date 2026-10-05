// src/app/api/cron/conferidor-orfaos/route.ts
// JOB SEMANAL (Vercel Cron, segunda 08:00 UTC) — conferidor de arquivos órfãos. SÓ RELATÓRIO: registra na auditoria e devolve o resumo;
// NUNCA apaga nada (apagar órfão exige a ordem explícita do dono). Mesma convenção dos outros crons: o middleware libera, o handler se
// auto-verifica (CRON_SECRET ou header oficial da Vercel).
import { NextRequest, NextResponse } from "next/server"
import { conferirOrfaos } from "@/src/services/conferidor-orfaos"

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
    const r = await conferirOrfaos()
    // Só o resumo (as chaves ficam na auditoria): a resposta do cron não vira vazamento de nomes de arquivo.
    return NextResponse.json({
      geradoEm: r.geradoEm, totais: r.totais, orfaos: r.orfaos.length, bytesOrfaos: r.bytesOrfaos,
      referenciasSemObjeto: r.referenciasSemObjeto.length, copiasLegadasNoPublico: r.copiasLegadasNoPublico.length,
      backupsIntencionais: r.backupsIntencionais, linksAtivosAntigosComPendentes: r.linksAtivosAntigosComPendentes?.length ?? 0, nota: r.nota,
    })
  } catch (e) {
    console.error("[cron conferidor-orfaos] falha:", e)
    return NextResponse.json({ error: "falha no conferidor de órfãos" }, { status: 500 })
  }
}
