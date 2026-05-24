// src/app/api/pessoas/[id]/reconcile/route.ts
//
// Endpoint manual de reconciliação de documentos auto-gerados de UMA pessoa.
//   GET    → dry-run (mostra o que SERIA criado, sem persistir)
//   POST   → reconcilia de verdade (cria docs faltantes)
//
// Útil pra testar a engine antes de plugar no fluxo CRUD oficial.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  reconcileDocsForPessoa,
  dryRunReconcile,
} from "@/src/lib/document-generator"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const pessoaId = parseInt(id)
    if (isNaN(pessoaId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }
    const result = await dryRunReconcile(pessoaId, prisma)
    return NextResponse.json(result)
  } catch (error) {
    console.error("[GET /api/pessoas/[id]/reconcile]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro" },
      { status: 500 }
    )
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const pessoaId = parseInt(id)
    if (isNaN(pessoaId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }
    const result = await prisma.$transaction(async (tx) => {
      return reconcileDocsForPessoa(pessoaId, tx)
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error("[POST /api/pessoas/[id]/reconcile]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro" },
      { status: 500 }
    )
  }
}