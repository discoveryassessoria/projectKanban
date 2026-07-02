// src/app/api/gerenciamento/regras-tarefa-transversal/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

// GET — lista as regras de tarefa transversal
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

// POST — cria uma regra
export async function POST(request: Request) {
  try {
    const erro = await verificarPermissao(request, "usuarios.gerenciar")
    if (erro) return erro

    const b = await request.json()
    if (!b?.name) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 })
    if (!b?.originPhase) return NextResponse.json({ error: "Fase de origem é obrigatória" }, { status: 400 })
    if (!b?.operationalPhase) return NextResponse.json({ error: "Operação usada é obrigatória" }, { status: 400 })

    const regra = await prisma.regraTarefaTransversal.create({
      data: {
        ruleKey: b.ruleKey ?? null,
        name: b.name,
        tipoProcessoId: b.tipoProcessoId ?? null,
        originPhase: b.originPhase,
        operationalPhase: b.operationalPhase,
        templateId: b.templateId ?? null,
        trigger: (b.trigger ?? undefined) as Prisma.InputJsonValue,
        creation: (b.creation ?? undefined) as Prisma.InputJsonValue,
        originLink: (b.originLink ?? undefined) as Prisma.InputJsonValue,
        duplicatePolicy: (b.duplicatePolicy ?? undefined) as Prisma.InputJsonValue,
        applyResult: (b.applyResult ?? undefined) as Prisma.InputJsonValue,
        autoCreate: b.autoCreate ?? false,
        suggested: b.suggested ?? true,
        mandatory: b.mandatory ?? true,
        isSystemTemplate: b.isSystemTemplate ?? false,
        arquivado: b.arquivado ?? false,
      },
    })
    return NextResponse.json({ regra }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar regra de tarefa transversal:", error)
    return NextResponse.json({ error: "Erro ao criar regra" }, { status: 500 })
  }
}