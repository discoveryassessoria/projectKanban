// ============================================================
// src/app/api/processos/[processoId]/retificacao/pacotes/route.ts
// POST → cria um novo pacote de retificação (tipo judicial|administrativa).
// ============================================================

import { NextResponse } from "next/server"
import { recusarSeCanonicoAssumiu, FASE_RETIFICACAO } from "@/src/services/motor-da-fase"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { buildInitialWorkflow } from "@/src/lib/process-stage/retificacao-engine"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    // 🔒 Sem checagem nenhuma antes — criava pacote de retificação pra
    // qualquer requisição.
    const erroPermissao = await verificarPermissao(request, "tarefas.iniciar_concluir")
    if (erroPermissao) return erroPermissao

    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    const body = await request.json().catch(() => ({}))
    const tipo = body.tipo === "administrativa" ? "administrativa" : "judicial"

    // UM MOTOR SÓ. Quando o Workflow Interno da fase assume, esta rota — que é a
    // anterior a ele — para de aceitar comando: dois motores dando ordens ao mesmo
    // processo mostram estados diferentes, e o que "vale" vira o da tela que alguém
    // abriu por último.
    const recusa = await recusarSeCanonicoAssumiu(FASE_RETIFICACAO)
    if (recusa) return NextResponse.json({ error: recusa.erro, mensagem: recusa.mensagem }, { status: 409 })

    const processo = await prisma.processo.findUnique({ where: { id }, select: { id: true } })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    const count = await prisma.retificacaoPacote.count({ where: { processoId: id } })
    const num = "PR-" + String(count + 1).padStart(3, "0")

    const pacote = await prisma.retificacaoPacote.create({
      data: {
        processoId: id,
        num,
        tipo,
        status: "em_preparacao",
        currentStep: "definir_estrategia",
        prioridade: "Média",
        proxAcao: "Definir estratégia",
        workflow: buildInitialWorkflow() as unknown as Prisma.InputJsonValue,
        movements: [] as unknown as Prisma.InputJsonValue,
        attachments: [] as unknown as Prisma.InputJsonValue,
      },
    })

    return NextResponse.json({ ok: true, pacote })
  } catch (error) {
    console.error("[POST .../retificacao/pacotes]", error)
    return NextResponse.json({ error: "Erro ao criar pacote de retificação" }, { status: 500 })
  }
}