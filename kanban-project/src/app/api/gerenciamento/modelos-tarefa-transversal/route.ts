// src/app/api/gerenciamento/modelos-tarefa-transversal/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

// GET — lista os modelos de tarefa transversal
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

// POST — cria um modelo
export async function POST(request: Request) {
  try {
    const erro = await verificarPermissao(request, "usuarios.gerenciar")
    if (erro) return erro

    const b = await request.json()
    if (!b?.name) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 })
    if (!b?.templateKey) return NextResponse.json({ error: "templateKey é obrigatório" }, { status: 400 })
    if (!b?.defaultOperationalPhase) return NextResponse.json({ error: "Fase operacional é obrigatória" }, { status: 400 })

    const modelo = await prisma.modeloTarefaTransversal.create({
      data: {
        templateKey: b.templateKey,
        name: b.name,
        type: b.type || "custom",
        description: b.description ?? null,
        defaultOriginPhase: b.defaultOriginPhase ?? null,
        defaultOperationalPhase: b.defaultOperationalPhase,
        defaultMandatory: b.defaultMandatory ?? true,
        defaultResultAction: b.defaultResultAction || "apply_back_to_origin_phase",
        recommendedForOriginPhases: (b.recommendedForOriginPhases ?? undefined) as Prisma.InputJsonValue,
        operationalWorkflow: (b.operationalWorkflow ?? undefined) as Prisma.InputJsonValue,
        originLinkConfig: (b.originLinkConfig ?? undefined) as Prisma.InputJsonValue,
        defaultEffects: (b.defaultEffects ?? undefined) as Prisma.InputJsonValue,
        duplicatePolicy: (b.duplicatePolicy ?? undefined) as Prisma.InputJsonValue,
        defaultOriginLinkType: b.defaultOriginLinkType || "document",
        isSystemTemplate: b.isSystemTemplate ?? false,
        arquivado: b.arquivado ?? false,
      },
    })
    return NextResponse.json({ modelo }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar modelo de tarefa transversal:", error)
    return NextResponse.json({ error: "Erro ao criar modelo" }, { status: 500 })
  }
}