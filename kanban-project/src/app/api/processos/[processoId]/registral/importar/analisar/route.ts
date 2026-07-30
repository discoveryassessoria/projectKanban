// POST — ANALISAR certidões recém-enviadas, SEM gravar nada.
//
// Recebe os arquivos que o operador acabou de subir pelo storage (a URL já
// existe) e devolve a prévia: tipo, pessoa sugerida, campos, divergências e a
// árvore proposta. Nenhuma linha é criada — quem grava é o /confirmar.
import { type NextRequest, NextResponse } from "next/server"
import { analisarImportacao, type ArquivoImportado } from "@/src/services/registral/importacao"
import { situacaoDosProvedores } from "@/src/services/registral/ocr"
import { erro, exigirAlguma, idDe } from "@/src/services/registral/autorizacao"

/** Ler + transcrever N certidões leva tempo; o padrão de 300s cobre o lote. */
export const maxDuration = 300
export const dynamic = "force-dynamic"

/** Teto por chamada — protege a função e mantém a análise dentro do tempo. */
const MAX_ARQUIVOS = 30

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const auth = await exigirAlguma(request, [
    "registral.revisar",
    "arvore.criar_documento",
    "registral.ver_evidencias",
  ])
  if (!auth.ok) return auth.resposta

  const { processoId: raw } = await params
  const processoId = idDe(raw)
  if (processoId == null) return erro("processoId inválido")

  const body = await request.json().catch(() => null)
  const brutos = Array.isArray(body?.arquivos) ? (body.arquivos as unknown[]) : null
  if (!brutos || brutos.length === 0) return erro("Envie ao menos um arquivo.")
  if (brutos.length > MAX_ARQUIVOS) {
    return erro(`Máximo de ${MAX_ARQUIVOS} arquivos por análise. Envie em partes.`)
  }

  const arquivos: ArquivoImportado[] = []
  for (const b of brutos) {
    const a = b as Record<string, unknown>
    const url = typeof a?.url === "string" ? a.url : null
    const nome = typeof a?.nome === "string" ? a.nome : null
    if (!url || !nome) return erro("Cada arquivo precisa de `url` e `nome`.")
    arquivos.push({
      url,
      nome,
      mimeType: typeof a?.mimeType === "string" ? a.mimeType : null,
      tamanho: Number.isFinite(Number(a?.tamanho)) ? Number(a.tamanho) : null,
    })
  }

  try {
    const analise = await analisarImportacao({
      processoId,
      arquivos,
      usuarioId: auth.ctx.usuarioId,
    })
    return NextResponse.json({ ...analise, provedores: situacaoDosProvedores() })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[registral][importar][analisar]", msg)
    return erro(msg, 422)
  }
}
