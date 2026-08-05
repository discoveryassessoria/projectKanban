// DOWNLOAD/VISUALIZAÇÃO do DOCX ou do PDF de uma versão gerada.
//
// ÚNICA porta para o binário. O cliente informa documento gerado, versão e
// formato — nunca a chave do storage. O servidor confere que a versão pertence
// ao documento pedido, confere a permissão e só então assina uma URL de curta
// duração. Sem sessão não há URL; com sessão, a URL vale minutos e expira.
import { NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { urlDoArquivo, ErroDocumentoGerado } from "@/src/services/modelos/documentos-gerados"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "documentos_gerados.baixar")
  if (erro) return erro

  const { id } = await params
  const documentoGeradoId = Number(id)
  if (!Number.isInteger(documentoGeradoId)) {
    return NextResponse.json({ error: "Documento inválido" }, { status: 400 })
  }

  const url = new URL(request.url)
  const formato = url.searchParams.get("formato") === "docx" ? "docx" : "pdf"
  const versaoParam = url.searchParams.get("versaoId")
  const versaoId = versaoParam ? Number(versaoParam) : null
  const download = url.searchParams.get("download") === "1"
  const redirecionar = url.searchParams.get("redirect") !== "0"

  try {
    const arquivo = await urlDoArquivo({ documentoGeradoId, versaoId, formato, download })
    // O padrão é redirecionar: o navegador segue para a URL assinada e o binário
    // nunca trafega pela aplicação. `redirect=0` devolve a URL para quem precisa
    // dela em JSON (abrir em nova aba, por exemplo).
    if (redirecionar) {
      return NextResponse.redirect(arquivo.url, {
        status: 307,
        headers: { "Cache-Control": "no-store, private" },
      })
    }
    return NextResponse.json(arquivo, { headers: { "Cache-Control": "no-store, private" } })
  } catch (e) {
    if (e instanceof ErroDocumentoGerado) {
      return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: 404 })
    }
    throw e
  }
}
