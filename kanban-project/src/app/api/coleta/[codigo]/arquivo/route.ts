// POST /api/coleta/[codigo]/arquivo — PÚBLICA. Devolve uma URL assinada de ESCRITA (curta duração)
// para o navegador subir o arquivo direto no storage PRIVADO. Não grava nada no banco: o arquivo só
// passa a pertencer a um envio quando o formulário é enviado (`/enviar`), que reconfere a chave.
import { NextResponse } from "next/server"
import { resolverLinkPublico } from "@/src/services/coleta/coleta-link"
import { urlDeEnvioColeta } from "@/src/services/coleta/storage-coleta"
import { MAX_BYTES_ARQUIVO_COLETA, MIMES_ARQUIVO_COLETA, tipoArquivoValido } from "@/src/lib/coleta/campos"
import { dentroDoLimite, hashDoIp, ipDoRequest } from "@/src/services/coleta/limite"

export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  if (!dentroDoLimite(`arq:${hashDoIp(ipDoRequest(req))}`, 30, 60_000)) {
    return NextResponse.json({ error: "Muitas tentativas. Tente de novo em instantes." }, { status: 429 })
  }
  const { codigo } = await params
  const r = await resolverLinkPublico(codigo)
  if (!r) return NextResponse.json({ error: "Este link não está mais disponível." }, { status: 404 })

  let corpo: { tipo?: unknown; nome?: unknown; mime?: unknown; tamanho?: unknown }
  try { corpo = await req.json() } catch { return NextResponse.json({ error: "Pedido inválido." }, { status: 400 }) }

  const tamanho = Number(corpo.tamanho)
  const mime = String(corpo.mime ?? "")
  if (!tipoArquivoValido(corpo.tipo)) return NextResponse.json({ error: "Tipo de documento inválido." }, { status: 400 })
  if (!Number.isInteger(tamanho) || tamanho <= 0 || tamanho > MAX_BYTES_ARQUIVO_COLETA) {
    return NextResponse.json({ error: "Arquivo grande demais (máximo 10 MB)." }, { status: 400 })
  }
  if (!MIMES_ARQUIVO_COLETA.has(mime)) return NextResponse.json({ error: "Envie imagem (JPG, PNG, WEBP) ou PDF." }, { status: 400 })

  const { chave, url } = await urlDeEnvioColeta({ linkId: r.link.id, nome: String(corpo.nome ?? "arquivo"), mime, tamanho })
  return NextResponse.json({ chave, uploadUrl: url })
}
