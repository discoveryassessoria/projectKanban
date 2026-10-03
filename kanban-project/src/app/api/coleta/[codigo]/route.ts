// GET /api/coleta/[codigo] — PÚBLICA. Diz só se o link está aberto e o texto do consentimento.
// Inexistente, encerrado e processo fora de "Aguardando fechamento" respondem IGUAL (404).
// Nunca devolve nome de processo, de cliente nem dado já enviado.
import { NextResponse } from "next/server"
import { resolverLinkPublico } from "@/src/services/coleta/coleta-link"
import { CONSENTIMENTO_VERSAO, MAX_ARQUIVOS_POR_TIPO, MAX_BYTES_ARQUIVO_COLETA, TEXTO_CONSENTIMENTO } from "@/src/lib/coleta/campos"
import { dentroDoLimite, hashDoIp, ipDoRequest } from "@/src/services/coleta/limite"

export const dynamic = "force-dynamic"

export async function GET(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  if (!dentroDoLimite(`info:${hashDoIp(ipDoRequest(req))}`, 60, 60_000)) {
    return NextResponse.json({ error: "Muitas tentativas. Tente de novo em instantes." }, { status: 429 })
  }
  const { codigo } = await params
  const r = await resolverLinkPublico(codigo)
  if (!r) return NextResponse.json({ error: "Este link não está mais disponível." }, { status: 404 })
  return NextResponse.json({
    aberto: true,
    consentimento: { texto: TEXTO_CONSENTIMENTO, versao: CONSENTIMENTO_VERSAO },
    limites: { maxBytes: MAX_BYTES_ARQUIVO_COLETA, maxArquivosPorTipo: MAX_ARQUIVOS_POR_TIPO },
  })
}
