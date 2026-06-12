// src/app/api/processos/[processoId]/analise-v2/documentos/[docId]/route.ts
//
// POST — salva os dados estruturados de UM documento da Análise v2.
// Grava no próprio Documento: structuredData (dados por tipo nascimento/casamento/óbito),
// registral (livro/folha/termo/…) e dataStatus. NÃO toca na árvore nem roda análise.
//
// É a rota que o editor de dados (fatia 3 — renderBirth/Marriage/DeathDataForm) chama:
//  • "Salvar rascunho"          → dataStatus: "manual_filled"
//  • "Salvar e marcar revisado" → dataStatus: "reviewed"  (libera o gate ad2Readiness)
//
// Espelha o ad2SaveDoc do mockup (grava structuredData no doc real).

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const DATA_STATUS = new Set(["not_filled", "ai_extracted", "manual_filled", "reviewed"])

export async function POST(
  req: Request,
  { params }: { params: Promise<{ processoId: string; docId: string }> },
) {
  const { docId } = await params
  const id = Number(docId)
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "docId inválido." }, { status: 400 })
  }

  let body: { structuredData?: unknown; registral?: unknown; dataStatus?: string } = {}
  try { body = await req.json() } catch { body = {} }

  // monta só os campos enviados (patch parcial)
  const data: Record<string, unknown> = {}
  if (body.structuredData !== undefined) data.structuredData = body.structuredData as object
  if (body.registral !== undefined) data.registral = body.registral as object
  if (body.dataStatus && DATA_STATUS.has(body.dataStatus)) data.dataStatus = body.dataStatus

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada para salvar." }, { status: 400 })
  }

  const doc = await prisma.documento.update({ where: { id }, data })

  return NextResponse.json({
    ok: true,
    id: doc.id,
    dataStatus: doc.dataStatus,
  })
}