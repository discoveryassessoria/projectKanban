// src/app/api/processos/[processoId]/fase-documental-kpis/[stepKey]/route.ts
// ============================================================================
// LEITURA — a "pasta" de uma fase DOCUMENTO-escopada (Tradução Juramentada,
// Apostilamento) como UMA LINHA DO TEMPO SÓ (Preparar → Enviar → Receber →
// Conferir e validar), compartilhada por todos os documentos que o operador
// incluiu — nunca quatro etapas repetidas por documento (mandato 24/09/2026,
// correção do que foi entregue antes: "essa tela ficou igual à de Solicitar
// certidão, que trata documento por documento — eu quero uma pasta única").
//
// Cálculo real em `fase-documental-pasta.ts` — este arquivo só monta os KPIs
// em cima dele. "Na pasta" = a subtarefa "preparar_documentos" já concluída
// — nunca uma tabela própria; o motor continua sendo o canônico.
// ============================================================================
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { montarPastaDocumental, ORDEM_SUBTAREFAS, type SubtarefaKey } from "@/src/lib/process-stage/fase-documental-pasta"

const STEP_KEYS_PERMITIDOS = new Set(["traducao_juramentada", "apostilamento"])

export async function GET(
  request: Request,
  { params }: { params: Promise<{ processoId: string; stepKey: string }> },
) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { processoId, stepKey } = await params
  const id = parseInt(processoId)
  if (isNaN(id) || !STEP_KEYS_PERMITIDOS.has(stepKey)) {
    return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 })
  }

  const processo = await prisma.processo.findUnique({ where: { id }, select: { id: true, arvoreId: true } })
  if (!processo || !processo.arvoreId) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

  const { pessoas, estado } = await montarPastaDocumental(id, processo.arvoreId, stepKey as "traducao_juramentada" | "apostilamento")

  const todasLinhas = pessoas.flatMap((p) => p.documentos)
  const naPastaLinhas = todasLinhas.filter((d) => d.naPasta)
  const progresso = (d: (typeof todasLinhas)[number]) => d.etapaAtualKey ? ORDEM_SUBTAREFAS.indexOf(d.etapaAtualKey as SubtarefaKey) : ORDEM_SUBTAREFAS.length
  const passouDe = (indiceMinimo: number) => naPastaLinhas.filter((d) => progresso(d) > indiceMinimo).length

  return NextResponse.json({
    totais: {
      documentosNecessarios: todasLinhas.length,
      aptos: todasLinhas.filter((d) => d.apto).length,
      faltando: todasLinhas.filter((d) => d.situacao === "falta").length,
      naoAptos: todasLinhas.filter((d) => d.situacao === "nao_apto").length,
      naPasta: naPastaLinhas.length,
      enviados: passouDe(ORDEM_SUBTAREFAS.indexOf("enviar_documentos")),
      recebidos: passouDe(ORDEM_SUBTAREFAS.indexOf("receber_documentos")),
      validados: passouDe(ORDEM_SUBTAREFAS.indexOf("conferir_validar_documentos")),
    },
    pasta: {
      etapaAtualKey: estado.etapaAtualKey,
      podeAvancar: estado.podeAvancar,
      concluida: estado.concluida,
      dessincronizada: estado.dessincronizada,
    },
    pessoas,
  })
}
