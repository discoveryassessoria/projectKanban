// ============================================================
// src/app/api/processos/[processoId]/retificacao/pacotes/[pkgId]/etapas/[stepId]/route.ts
// POST → conclui uma etapa de um pacote. Quando TODOS os pacotes do
// processo ficam "validado", a fase conclui e o card avança para
// EMISSAO_DOCUMENTAL_RETIFICADA.
// ============================================================

import { NextResponse } from "next/server"
import { recusarSeCanonicoAssumiu, FASE_RETIFICACAO } from "@/src/services/motor-da-fase"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { applyStep, allValidated, type RetPkg } from "@/src/lib/process-stage/retificacao-engine"
import { concluirFaseBespokeEAvancar } from "@/src/lib/motor/auto-avanco"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string; pkgId: string; stepId: string }> }
) {
  try {
    const { processoId, pkgId, stepId } = await params
    const id = parseInt(processoId)
    const pid = parseInt(pkgId)
    if (isNaN(id) || isNaN(pid)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    // UM MOTOR SÓ. Quando o Workflow Interno da fase assume, esta rota — que é a
    // anterior a ele — para de aceitar comando: dois motores dando ordens ao mesmo
    // processo mostram estados diferentes, e o que "vale" vira o da tela que alguém
    // abriu por último.
    const recusa = await recusarSeCanonicoAssumiu(FASE_RETIFICACAO)
    if (recusa) return NextResponse.json({ error: recusa.erro, mensagem: recusa.mensagem }, { status: 409 })

    const body = await request.json().catch(() => ({}))

    const processo = await prisma.processo.findUnique({ where: { id }, select: { id: true, pais: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } } } })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    const row = await prisma.retificacaoPacote.findFirst({ where: { id: pid, processoId: id } })
    if (!row) return NextResponse.json({ error: "Pacote não encontrado." }, { status: 404 })

    const pkg: RetPkg = {
      // `tipo` passou a aceitar NULL no cadastro: o pedido pode ser aberto antes de
      // alguém decidir o caminho. A máquina legada não sabe disso e sempre assumiu um
      // dos dois — o default preserva o que ela esperava, sem afirmar nada sobre o
      // pacote que ainda não decidiu.
      tipo: row.tipo ?? "judicial",
      status: row.status,
      currentStep: row.currentStep,
      motivo: row.motivo,
      prioridade: row.prioridade,
      proxAcao: row.proxAcao,
      processoNum: row.processoNum,
      tribunal: row.tribunal,
      vara: row.vara,
      comarca: row.comarca,
      advogado: row.advogado,
      oab: row.oab,
      statusProc: row.statusProc,
      cartorio: row.cartorio,
      canal: row.canal,
      protocolo: row.protocolo,
      dataProtocolo: row.dataProtocolo,
      atendente: row.atendente,
      prazo: row.prazo,
      statusAdm: row.statusAdm,
      workflow: (row.workflow as unknown as RetPkg["workflow"]) ?? [],
      movements: (row.movements as unknown as RetPkg["movements"]) ?? [],
      attachments: (row.attachments as unknown as RetPkg["attachments"]) ?? [],
      validacao: (row.validacao as Record<string, unknown>) ?? null,
    }

    const result = applyStep(pkg, stepId, body)
    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Não foi possível concluir a etapa." }, { status: 422 })
    }

    // reabrir / nova análise: nada a gravar
    if (result.recordedOnly || !result.patch) {
      return NextResponse.json({ ok: true, recordedOnly: true })
    }

    // descobre se, com este pacote validado, TODOS ficam validados
    let phaseComplete = false
    if (result.validated) {
      const outros = await prisma.retificacaoPacote.findMany({
        where: { processoId: id, id: { not: pid } },
        select: { status: true },
      })
      phaseComplete = allValidated([...outros, { status: "validado" }])
    }

    await prisma.$transaction(
      async (tx) => {
        await tx.retificacaoPacote.update({
          where: { id: pid },
          data: result.patch as Prisma.RetificacaoPacoteUpdateInput,
        })
      },
      { timeout: 30000, maxWait: 10000 }
    )

    // AUTO-AVANÇO: retificação concluída → conclui o Workflow Interno (libera o gate) e avança.
    if (phaseComplete) await concluirFaseBespokeEAvancar(id, "retificacao_registros")

    return NextResponse.json({
      ok: true,
      validated: !!result.validated,
      phaseComplete,
      advanced: phaseComplete,
    })
  } catch (error) {
    console.error("[POST .../retificacao/pacotes/etapas]", error)
    return NextResponse.json({ error: "Erro ao concluir etapa do pacote" }, { status: 500 })
  }
}