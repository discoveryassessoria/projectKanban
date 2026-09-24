// src/app/api/processos/[processoId]/fase-documental-kpis/[stepKey]/avancar-lote/route.ts
// ============================================================================
// POST — conclui a subtarefa CORRENTE de vários documentos de uma vez, pela
// PORTA REAL de sempre (`atualizarPassoV2`, com `subtarefaEsperada` — a mesma
// proteção contra concluir a subtarefa errada que já vale para um documento
// só). Seguro em lote porque nenhuma das 4 subtarefas desta Biblioteca pede
// campo nenhum (só a ação "concluir") — confirmado por leitura real do
// cadastro; se algum dia uma delas passar a exigir dado, o PATCH genérico
// recusa (`VALIDATION_ERROR`) e este endpoint devolve o erro por documento,
// nunca finge sucesso.
// ============================================================================
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { garantirOperacaoDocumentoV2, atualizarPassoV2 } from "@/src/services/documento-operacao"
import { subtarefasDaEtapa } from "@/src/services/subtarefas-da-etapa"

const STEP_KEYS_PERMITIDOS = new Set(["traducao_juramentada", "apostilamento"])

export async function POST(
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

  const body = (await request.json().catch(() => ({}))) as { documentoIds?: number[] }
  const documentoIds = Array.isArray(body.documentoIds) ? body.documentoIds.filter((x) => Number.isInteger(x)) : []
  if (documentoIds.length === 0) {
    return NextResponse.json({ error: "DOCUMENTOS_OBRIGATORIOS", mensagem: "Selecione ao menos um documento." }, { status: 422 })
  }

  const ctx = { usuarioId: usuario.userId, permissoes: usuario.permissoes, isAdmin: usuario.tipo === "admin" }

  // Confirma que os documentos pertencem mesmo a este processo — nunca confia
  // no que o cliente mandou sem checar (IDOR).
  const docs = await prisma.documento.findMany({
    where: { id: { in: documentoIds }, pessoa: { arvore: { processos: { some: { id } } } } },
    select: { id: true },
  })
  const idsValidos = new Set(docs.map((d) => d.id))

  const resultados: Array<{ documentoId: number; ok: boolean; subtarefa?: string; motivo?: string }> = []

  for (const documentoId of documentoIds) {
    if (!idsValidos.has(documentoId)) {
      resultados.push({ documentoId, ok: false, motivo: "Documento não pertence a este processo." })
      continue
    }
    try {
      const wf = await garantirOperacaoDocumentoV2(documentoId, ctx)
      const stepInstanceId = wf.workflow?.currentStepId ?? null
      if (!stepInstanceId) {
        resultados.push({ documentoId, ok: false, motivo: "Sem etapa aberta nesta fase para este documento." })
        continue
      }
      const subs = await subtarefasDaEtapa({ stepInstanceId })
      const corrente = subs.find((s) => !s.concluida && s.disponivel)
      if (!corrente) {
        resultados.push({ documentoId, ok: false, motivo: "Nenhuma subtarefa disponível para concluir agora (bloqueada ou já concluída)." })
        continue
      }
      const r = await atualizarPassoV2(documentoId, stepInstanceId, { status: "concluida", subtarefaEsperada: corrente.key }, ctx)
      if (!r.ok) {
        resultados.push({ documentoId, ok: false, motivo: r.error })
        continue
      }
      resultados.push({ documentoId, ok: true, subtarefa: r.subtarefaConcluida ?? corrente.key })
    } catch (e) {
      resultados.push({ documentoId, ok: false, motivo: e instanceof Error ? e.message : "Erro inesperado." })
    }
  }

  return NextResponse.json({
    ok: true,
    concluidos: resultados.filter((r) => r.ok).length,
    falhas: resultados.filter((r) => !r.ok).length,
    resultados,
  })
}
