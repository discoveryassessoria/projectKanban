// ============================================================
// src/app/api/processos/[processoId]/traducao/route.ts
// ------------------------------------------------------------
// GET → carrega a pasta de tradução do processo + o universo de pessoas/
// documentos candidatos (todos os da linha reta, aptos ou não — ver
// `pasta-documental-universo.ts`). Se o processo está na fase
// TRADUCAO_JURAMENTADA e ainda não existe pasta, cria vazia na hora
// (montar_pasta_traducao é a etapa onde o operador SELECIONA o que entra —
// ver POST .../pasta/documentos).
// ============================================================

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"
import {
  buildInitialWorkflow,
  calcProgress,
  TR_DOC_LABEL,
  type TrWorkflowStep,
} from "@/src/lib/process-stage/traducao-engine"
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

    let pasta = await prisma.pastaTraducao.findUnique({
      where: { processoId: id },
      include: { documentos: { orderBy: { id: "asc" } } },
    })

    if (!pasta) {
      if (phaseKeyToFaseCode(processo.faseAtualKey) !== "TRADUCAO_JURAMENTADA") {
        return NextResponse.json({ pasta: null })
      }
      try {
        pasta = await prisma.pastaTraducao.create({
          data: {
            processoId: id,
            status: "em_andamento",
            currentStep: "montar_pasta_traducao",
            sourceLanguage: "Português",
            targetLanguage: "Italiano",
            workflow: buildInitialWorkflow() as unknown as Prisma.InputJsonValue,
          },
          include: { documentos: { orderBy: { id: "asc" } } },
        })
      } catch {
        // corrida: outra requisição criou primeiro → recarrega
        pasta = await prisma.pastaTraducao.findUnique({
          where: { processoId: id },
          include: { documentos: { orderBy: { id: "asc" } } },
        })
        if (!pasta) throw new Error("Falha ao criar a pasta de tradução.")
      }
    }

    const tarefaDaFase = await prisma.tarefa.findFirst({
      where: { processoId: id, faseMacroKey: "traducao_juramentada", statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CANCELADA"] } },
      select: { responsavel: { select: { id: true, nome: true } } },
      orderBy: { id: "desc" },
    })

    const universo = await montarUniversoDaPastaDocumental({ id: processo.id, arvoreId: processo.arvoreId })
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
          statusNaPastaLabel: naPasta ? (TR_DOC_LABEL[naPasta.status] ?? naPasta.status) : null,
          conferenceResult: naPasta?.conferenceResult ?? null,
        }
      }),
    }))

    const totaisPasta = {
      naPasta: pasta.documentos.length,
      enviados: pasta.documentos.filter((d) => d.status === "enviado" || d.status === "traducao_recebida" || d.status === "conferido" || d.status === "validado").length,
      recebidos: pasta.documentos.filter((d) => d.status === "traducao_recebida" || d.status === "conferido" || d.status === "validado").length,
      conferidos: pasta.documentos.filter((d) => d.status === "conferido" || d.status === "validado").length,
      validados: pasta.documentos.filter((d) => d.status === "validado").length,
    }

    const workflow = (pasta.workflow as unknown as TrWorkflowStep[]) ?? []
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
    console.error("[GET .../traducao]", error)
    return NextResponse.json({ error: "Erro ao carregar a pasta de tradução" }, { status: 500 })
  }
}
