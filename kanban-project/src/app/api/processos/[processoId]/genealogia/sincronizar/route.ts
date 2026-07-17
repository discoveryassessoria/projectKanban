// src/app/api/processos/[processoId]/genealogia/sincronizar/route.ts
//
// FATIA 2 — dispara a materialização das Regras Documentais na Genealogia de UM
// processo (idempotente, aditivo). NÃO avança fase, NÃO conclui, NÃO cria tarefa.

import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { materializarGenealogia } from "@/src/services/genealogia/materializar-genealogia"

export async function POST(request: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(request, "processos.editar")
  if (erro) return erro
  try {
    const { processoId } = await params
    const id = Number(processoId)
    if (!id) return NextResponse.json({ error: "processoId inválido" }, { status: 400 })
    const resultado = await materializarGenealogia(id)
    return NextResponse.json({ resultado })
  } catch (e) {
    console.error("POST genealogia/sincronizar", e)
    return NextResponse.json({ error: "Erro ao sincronizar a Genealogia." }, { status: 500 })
  }
}
