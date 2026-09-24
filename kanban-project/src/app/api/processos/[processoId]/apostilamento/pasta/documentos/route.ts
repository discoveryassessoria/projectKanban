// src/app/api/processos/[processoId]/apostilamento/pasta/documentos/route.ts
// ============================================================================
// POST → adiciona/remove documentos da pasta de apostilamento, ENQUANTO ela
// ainda está na etapa "montar_pasta_apostilamento" — espelha
// .../traducao/pasta/documentos/route.ts.
// ============================================================================
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { DEFAULT_DOC_STATUS } from "@/src/lib/process-stage/apostilamento-engine"
import { montarUniversoDaPastaDocumental } from "@/src/lib/process-stage/pasta-documental-universo"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const erro = await verificarPermissao(request, "tarefas.iniciar_concluir")
  if (erro) return erro

  const { processoId } = await params
  const id = parseInt(processoId)
  if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  const body = (await request.json().catch(() => ({}))) as { acao?: string; documentoIds?: number[] }
  const acao = body.acao
  const documentoIds = Array.isArray(body.documentoIds) ? body.documentoIds.filter((x) => Number.isInteger(x)) : []
  if (acao !== "adicionar" && acao !== "remover") {
    return NextResponse.json({ error: "ACAO_INVALIDA", mensagem: "Informe acao: adicionar ou remover." }, { status: 422 })
  }
  if (documentoIds.length === 0) {
    return NextResponse.json({ error: "DOCUMENTOS_OBRIGATORIOS", mensagem: "Selecione ao menos um documento." }, { status: 422 })
  }

  const processo = await prisma.processo.findUnique({ where: { id }, select: { id: true, arvoreId: true } })
  if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

  const pasta = await prisma.pastaApostilamento.findUnique({ where: { processoId: id } })
  if (!pasta) return NextResponse.json({ error: "PASTA_INEXISTENTE", mensagem: "A pasta de apostilamento ainda não foi aberta." }, { status: 422 })
  if (pasta.currentStep !== "montar_pasta_apostilamento") {
    return NextResponse.json({ error: "PASTA_JA_ENVIADA", mensagem: "A pasta já foi enviada ao cartório/autoridade — não é mais possível alterar os documentos incluídos." }, { status: 409 })
  }

  if (acao === "remover") {
    const r = await prisma.pastaApostilamentoDocumento.deleteMany({ where: { pastaApostilamentoId: pasta.id, documentoId: { in: documentoIds } } })
    return NextResponse.json({ ok: true, removidos: r.count })
  }

  const universo = await montarUniversoDaPastaDocumental({ id: processo.id, arvoreId: processo.arvoreId }, "apostilamento")
  const candidatosAptos = new Map(
    universo.pessoas.flatMap((p) => p.documentos.filter((d) => d.apto && documentoIds.includes(d.documentoId)).map((d) => [d.documentoId, { ...d, pessoaNome: p.nome }] as const)),
  )
  if (candidatosAptos.size === 0) {
    return NextResponse.json({ error: "NENHUM_APTO", mensagem: "Nenhum dos documentos selecionados está apto para entrar na pasta." }, { status: 422 })
  }

  const jaNaPasta = await prisma.pastaApostilamentoDocumento.findMany({
    where: { pastaApostilamentoId: pasta.id, documentoId: { in: [...candidatosAptos.keys()] } },
    select: { documentoId: true },
  })
  const jaNaPastaIds = new Set(jaNaPasta.map((d) => d.documentoId))
  const novos = [...candidatosAptos.values()].filter((d) => !jaNaPastaIds.has(d.documentoId))

  if (novos.length > 0) {
    await prisma.pastaApostilamentoDocumento.createMany({
      data: novos.map((d) => ({
        pastaApostilamentoId: pasta.id,
        documentoId: d.documentoId,
        pessoaNome: d.pessoaNome,
        documentoTitulo: d.tipoLabel,
        origem: d.origemLabel,
        status: DEFAULT_DOC_STATUS,
      })),
    })
  }

  return NextResponse.json({ ok: true, adicionados: novos.length, jaEstavam: candidatosAptos.size - novos.length })
}
