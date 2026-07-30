// POST — REVERTER uma importação inteira.
//
// Desfaz documentos, pessoas, vínculos e alterações de campo que aquela
// importação produziu — e só eles. Pessoa que ganhou vida própria depois
// (documento novo, filho novo) não é removida; o relatório diz quais e por quê.
import { type NextRequest, NextResponse } from "next/server"
import { reverterImportacao } from "@/src/services/registral/importacao"
import { erro, exigir, idDe } from "@/src/services/registral/autorizacao"

export const maxDuration = 120
export const dynamic = "force-dynamic"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> },
) {
  // Reverter apaga dado do banco: exige a permissão de reversão do motor, não a
  // de importar.
  const auth = await exigir(request, "registral.reverter")
  if (!auth.ok) return auth.resposta

  const { processoId: raw } = await params
  const processoId = idDe(raw)
  if (processoId == null) return erro("processoId inválido")

  const body = await request.json().catch(() => null)
  const importacaoId = Number(body?.importacaoId)
  if (!Number.isInteger(importacaoId) || importacaoId <= 0) {
    return erro("Informe `importacaoId` — o identificador devolvido pela confirmação.")
  }

  try {
    const resultado = await reverterImportacao({ importacaoId, usuarioId: auth.ctx.usuarioId })
    return NextResponse.json(resultado)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[registral][importar][reverter]", msg)
    return erro(msg, 422)
  }
}
