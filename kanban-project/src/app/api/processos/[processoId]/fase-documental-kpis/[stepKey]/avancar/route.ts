// src/app/api/processos/[processoId]/fase-documental-kpis/[stepKey]/avancar/route.ts
// ============================================================================
// POST — avança a PASTA INTEIRA uma etapa (Enviar/Receber/Conferir e
// validar), nunca um documento isolado. O servidor RECALCULA quem está na
// pasta e em qual etapa — nunca confia numa lista de IDs vinda do cliente.
// Se os documentos da pasta não estiverem todos na MESMA etapa pendente
// (alguém foi mexido fora daqui), recusa com `DESSINCRONIZADA` em vez de
// aplicar pela metade.
// ============================================================================
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { montarPastaDocumental } from "@/src/lib/process-stage/fase-documental-pasta"
import { atualizarPassoV2 } from "@/src/services/documento-operacao"

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

  const processo = await prisma.processo.findUnique({ where: { id }, select: { id: true, arvoreId: true } })
  if (!processo || !processo.arvoreId) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

  const { estado } = await montarPastaDocumental(id, processo.arvoreId, stepKey as "traducao_juramentada" | "apostilamento")

  if (estado.dessincronizada) {
    return NextResponse.json({ error: "DESSINCRONIZADA", mensagem: "Os documentos da pasta não estão todos na mesma etapa — abra cada um para ver o que aconteceu antes de avançar em grupo." }, { status: 409 })
  }
  if (estado.concluida || !estado.etapaAtualKey) {
    return NextResponse.json({ error: "NADA_PARA_AVANCAR", mensagem: "Não há etapa pendente para avançar em grupo agora." }, { status: 422 })
  }
  if (!estado.podeAvancar) {
    return NextResponse.json({ error: "ETAPA_BLOQUEADA", mensagem: "A etapa atual da pasta ainda não está disponível para conclusão." }, { status: 409 })
  }

  const ctx = { usuarioId: usuario.userId, permissoes: usuario.permissoes, isAdmin: usuario.tipo === "admin" }
  const alvo = estado.etapaAtualKey

  const resultados: Array<{ documentoId: number | null; ok: boolean; motivo?: string }> = []
  for (const d of estado.documentosParaAvancar) {
    if (!d.documentoId || !d.stepInstanceId) { resultados.push({ documentoId: d.documentoId, ok: false, motivo: "Sem etapa materializada." }); continue }
    try {
      const r = await atualizarPassoV2(d.documentoId, d.stepInstanceId, { status: "concluida", subtarefaEsperada: alvo }, ctx)
      resultados.push(r.ok ? { documentoId: d.documentoId, ok: true } : { documentoId: d.documentoId, ok: false, motivo: r.error })
    } catch (e) {
      resultados.push({ documentoId: d.documentoId, ok: false, motivo: e instanceof Error ? e.message : "Erro inesperado." })
    }
  }

  const falhas = resultados.filter((r) => !r.ok)
  return NextResponse.json({
    ok: falhas.length === 0,
    etapaAvancada: alvo,
    concluidos: resultados.filter((r) => r.ok).length,
    falhas: falhas.length,
    resultados,
  })
}
