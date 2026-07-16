// src/app/api/gerenciamento/regras-tarefa-transversal/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

// ARQUITETURA NOVA — Regras de Tarefa Transversal criavam TAREFAS NATIVAS da
// operação, papel que passou a ser EXCLUSIVO do Workflow Interno de cada Fase
// Macro. A CRIAÇÃO está DESATIVADA. Os dados existentes permanecem (GET) e podem
// ser arquivados (PUT), mas nenhuma regra nova é criada.
const MSG_TRANSVERSAL_DESATIVADO =
  "Regras de Tarefa Transversal foram descontinuadas: a criação de tarefas obrigatórias é exclusiva do Workflow Interno da Fase Macro. Registros existentes permanecem apenas para histórico."

// GET — lista as regras de tarefa transversal (preservado para histórico)
export async function GET() {
  try {
    const regras = await prisma.regraTarefaTransversal.findMany({
      orderBy: [{ arquivado: "asc" }, { name: "asc" }],
    })
    return NextResponse.json({ regras })
  } catch (error) {
    console.error("Erro ao listar regras de tarefa transversal:", error)
    return NextResponse.json({ error: "Erro ao listar regras" }, { status: 500 })
  }
}

// POST — DESATIVADO (não cria mais regra transversal). 410 Gone.
export async function POST(request: Request) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  return NextResponse.json({ error: MSG_TRANSVERSAL_DESATIVADO, code: "TRANSVERSAL_DESATIVADO" }, { status: 410 })
}
