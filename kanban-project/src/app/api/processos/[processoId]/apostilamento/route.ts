// ============================================================
// src/app/api/processos/[processoId]/apostilamento/route.ts
// ------------------------------------------------------------
// GET → carrega a pasta de apostilamento + o universo de pessoas/documentos
// candidatos (ver `pasta-documental-universo.ts`, mesma lógica da rota de
// Tradução). Cria a pasta VAZIA se o processo está na fase APOSTILAMENTO e
// ainda não existe — "montar_pasta_apostilamento" é onde o operador
// SELECIONA o que entra (POST .../pasta/documentos).
// ============================================================

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"
import {
  buildInitialWorkflow,
  calcProgress,
  AP_DOC_LABEL,
  type ApWorkflowStep,
} from "@/src/lib/process-stage/apostilamento-engine"
import { montarUniversoDaPastaDocumental } from "@/src/lib/process-stage/pasta-documental-universo"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { id: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } }, arvoreId: true, faseAtualKey: true },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    let pasta = await prisma.pastaApostilamento.findUnique({
      where: { processoId: id },
      include: { documentos: { orderBy: { id: "asc" } } },
    })

    if (!pasta) {
      if (phaseKeyToFaseCode(processo.faseAtualKey) !== "APOSTILAMENTO") {
        return NextResponse.json({ pasta: null })
      }
      try {
        pasta = await prisma.pastaApostilamento.create({
          data: {
            processoId: id,
            status: "em_andamento",
            currentStep: "montar_pasta_apostilamento",
            workflow: buildInitialWorkflow() as unknown as Prisma.InputJsonValue,
          },
          include: { documentos: { orderBy: { id: "asc" } } },
        })
      } catch {
        pasta = await prisma.pastaApostilamento.findUnique({
          where: { processoId: id },
          include: { documentos: { orderBy: { id: "asc" } } },
        })
        if (!pasta) throw new Error("Falha ao criar a pasta de apostilamento.")
      }
    }

    const tarefaDaFase = await prisma.tarefa.findFirst({
      where: { processoId: id, faseMacroKey: "apostilamento", statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CANCELADA"] } },
      select: { responsavel: { select: { id: true, nome: true } } },
      orderBy: { id: "desc" },
    })

    const universo = await montarUniversoDaPastaDocumental({ id: processo.id, arvoreId: processo.arvoreId }, "apostilamento")
    const naPastaPorDocumentoId = new Map(pasta.documentos.map((d) => [d.documentoId, d]))

    const pessoas = universo.pessoas.map((p) => ({
      pessoaId: p.pessoaId,
      nome: p.nome,
      documentos: p.documentos.map((d) => {
        const naPasta = naPastaPorDocumentoId.get(d.documentoId) ?? null
        return {
          documentoId: d.documentoId,
          tipoLabel: d.tipoLabel,
          categoria: d.categoria,
          apto: d.apto,
          origemLabel: d.origemLabel,
          motivoNaoApto: d.motivoNaoApto,
          naPasta: naPasta != null,
          statusNaPasta: naPasta?.status ?? null,
          statusNaPastaLabel: naPasta ? (AP_DOC_LABEL[naPasta.status] ?? naPasta.status) : null,
          conferenceResult: naPasta?.conferenceResult ?? null,
        }
      }),
    }))

    const totaisPasta = {
      naPasta: pasta.documentos.length,
      enviados: pasta.documentos.filter((d) => d.status === "enviado" || d.status === "apostila_recebida" || d.status === "conferido" || d.status === "validado").length,
      recebidos: pasta.documentos.filter((d) => d.status === "apostila_recebida" || d.status === "conferido" || d.status === "validado").length,
      conferidos: pasta.documentos.filter((d) => d.status === "conferido" || d.status === "validado").length,
      validados: pasta.documentos.filter((d) => d.status === "validado").length,
    }

    const workflow = (pasta.workflow as unknown as ApWorkflowStep[]) ?? []
    return NextResponse.json({
      pasta,
      progress: calcProgress(workflow),
      paisDestino: processo.paisCanonico ? { label: processo.paisCanonico.countryLabel, flag: processo.paisCanonico.flag } : null,
      responsavel: tarefaDaFase?.responsavel ?? null,
      pessoas,
      totais: {
        documentosNecessarios: universo.totalDocumentos,
        aptos: universo.totalAptos,
        bloqueados: universo.totalDocumentos - universo.totalAptos,
        ...totaisPasta,
      },
    })
  } catch (error) {
    console.error("[GET .../apostilamento]", error)
    return NextResponse.json({ error: "Erro ao carregar a pasta de apostilamento" }, { status: 500 })
  }
}
