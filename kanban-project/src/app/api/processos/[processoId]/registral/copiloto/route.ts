// POST — COPILOTO GENEALÓGICO. Responde usando SOMENTE dados e evidências do
// Discovery: conclusão + evidências + confiança + pendências + origem dos dados.
// Não há geração de texto livre nem chamada a modelo externo — por isso ele não
// pode inventar informação.
import { type NextRequest, NextResponse } from "next/server"
import { consultarCopiloto } from "@/src/services/registral/consultas"
import { erro, exigirAlguma, idDe } from "@/src/services/registral/autorizacao"

export async function POST(request: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const auth = await exigirAlguma(request, ["registral.ver_evidencias", "registral.revisar", "arvore.ver"])
  if (!auth.ok) return auth.resposta

  const { processoId: raw } = await params
  const processoId = idDe(raw)
  if (processoId == null) return erro("processoId inválido")

  const body = await request.json().catch(() => ({}))
  const pergunta = typeof body?.pergunta === "string" ? body.pergunta.trim() : ""
  if (!pergunta) return erro("Informe a pergunta.")

  const r = await consultarCopiloto(processoId, pergunta)
  if (!r) return erro("Processo sem árvore vinculada", 404)
  return NextResponse.json(r)
}
