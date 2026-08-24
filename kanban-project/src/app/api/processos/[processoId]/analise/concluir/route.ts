import { NextResponse } from "next/server"
import { recusarSeCanonicoAssumiu } from "@/src/services/motor-da-fase"
import { prisma } from "@/lib/prisma"
import type { FaseCode } from "@prisma/client"
import { dispararMotorNaFaseAtual } from "@/src/lib/motor/executor"
import { concluirFaseBespokeEAvancar } from "@/src/lib/motor/auto-avanco"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    // UM MOTOR SÓ. Quando o Workflow Interno desta fase tem cadastro operacional
    // publicado, esta rota — que é a anterior a ele — para de aceitar comando: seguir
    // adiante concluiria à força os passos que o motor está pedindo, e as duas telas
    // passariam a mostrar estados diferentes do mesmo processo.
    const recusa = await recusarSeCanonicoAssumiu("analise_documental")
    if (recusa) return NextResponse.json({ error: recusa.erro, mensagem: recusa.mensagem }, { status: 409 })

    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { id: true, pais: true },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    const analise = await prisma.analiseDocumental.findUnique({
      where: { processoId: id },
      include: { divergencias: { select: { status: true } } },
    })
    if (!analise) {
      return NextResponse.json({ error: "A análise ainda não foi rodada." }, { status: 422 })
    }

    // Todas as divergências precisam estar decididas
    const pendentes = analise.divergencias.filter(
      (d) => d.status === "pendente" || d.status === "apoio_solicitado"
    ).length
    if (pendentes > 0) {
      return NextResponse.json(
        { error: `Ainda há ${pendentes} divergência(s) sem decisão. Resolva antes de concluir.` },
        { status: 422 }
      )
    }

    // Alguma marcada "retificacao" → com retificação
    const comRetificacao = analise.divergencias.some((d) => d.status === "retificacao")
    const decisaoJuridica = comRetificacao ? "com_retificacao" : "sem_retificacao"
    const proximaFase: FaseCode = comRetificacao ? "RETIFICACAO_REGISTROS" : "TRADUCAO_JURAMENTADA"

    const now = new Date()
    await prisma.$transaction(async (tx) => {
      await tx.analiseDocumental.update({
        where: { id: analise.id },
        data: {
          status: "concluida", currentStep: "decisao_juridica",
          decisaoJuridica, requerRetificacao: comRetificacao, completedAt: now,
        },
      })
    }, { timeout: 30000, maxWait: 10000 })

    // MOTOR — dispara efeitos da fase (best-effort)
    await dispararMotorNaFaseAtual(id)

    // AUTO-AVANÇO: análise concluída → conclui o Workflow Interno da fase (libera o gate)
    // e avança. O roteamento respeita o desvio condicional: SEM retificação pula
    // Retificação/Emissão Retificada e vai direto p/ Tradução.
    await concluirFaseBespokeEAvancar(id, "analise_documental")

    return NextResponse.json({ ok: true, decisao: decisaoJuridica, proximaFase })
  } catch (error) {
    console.error("[POST .../analise/concluir]", error)
    return NextResponse.json({ error: "Erro ao concluir análise" }, { status: 500 })
  }
}