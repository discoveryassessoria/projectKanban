// src/app/api/gerenciamento/modelos-tarefa-transversal/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

// ARQUITETURA NOVA — Modelos de Tarefa Transversal alimentavam a criação de
// TAREFAS NATIVAS da operação (via Regras Transversais), papel agora EXCLUSIVO
// do Workflow Interno. A CRIAÇÃO está DESATIVADA; dados existentes permanecem (GET).
const MSG_TRANSVERSAL_DESATIVADO =
  "Modelos de Tarefa Transversal foram descontinuados: a criação de tarefas obrigatórias é exclusiva do Workflow Interno da Fase Macro. Registros existentes permanecem apenas para histórico."

// GET — lista os modelos de tarefa transversal (preservado para histórico)
export async function GET() {
  try {
    const modelos = await prisma.modeloTarefaTransversal.findMany({
      orderBy: [{ arquivado: "asc" }, { name: "asc" }],
    })
    return NextResponse.json({ modelos })
  } catch (error) {
    console.error("Erro ao listar modelos de tarefa transversal:", error)
    return NextResponse.json({ error: "Erro ao listar modelos" }, { status: 500 })
  }
}

// POST — DESATIVADO (não cria mais modelo transversal). 410 Gone.
export async function POST(request: Request) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  return NextResponse.json({ error: MSG_TRANSVERSAL_DESATIVADO, code: "TRANSVERSAL_DESATIVADO" }, { status: 410 })
}