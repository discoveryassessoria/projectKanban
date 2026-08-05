// PRÉVIA — o PDF final, sem virar versão oficial.
//
// Mesmo motor da geração: o que o operador vê aqui é byte a byte o que sairá ao
// confirmar. Nada é persistido — nem registro, nem arquivo no storage.
import { NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { gerarPrevia, ErroGeracao } from "@/src/services/modelos/gerar-documento"
import { lerPedido } from "../_pedido"

export async function POST(request: Request) {
  const erro = await verificarPermissao(request, "documentos_gerados.gerar")
  if (erro) return erro

  const pedido = await lerPedido(request)
  if ("error" in pedido) return NextResponse.json(pedido, { status: 400 })

  try {
    const previa = await gerarPrevia(pedido)
    return new NextResponse(new Uint8Array(previa.pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="previa.pdf"',
        // Prévia não é documento: não fica em cache de disco nem de proxy.
        "Cache-Control": "no-store, private",
        "X-Modelo-Versao": String(previa.versaoNumero),
        "X-Docx-Checksum": previa.docxChecksum,
        "X-Pdf-Checksum": previa.pdfChecksum,
      },
    })
  } catch (e) {
    if (e instanceof ErroGeracao) {
      return NextResponse.json({ error: e.message, codigo: e.codigo, detalhe: e.detalhe }, { status: 422 })
    }
    throw e
  }
}
