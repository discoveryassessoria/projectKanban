// Documentos gerados — lista (por cliente/pessoa/processo) e geração oficial.
//
// A lista NUNCA é global: sem filtro de escopo, não há resposta. É o que impede
// alguém varrer procurações do escritório inteiro por uma rota de listagem.
import { NextResponse } from "next/server"
import { exigirPermissao, verificarPermissao } from "@/src/lib/verificar-permissao"
import {
  listarDocumentosGerados,
  ErroDocumentoGerado,
} from "@/src/services/modelos/documentos-gerados"
import { gerarDocumento, ErroGeracao } from "@/src/services/modelos/gerar-documento"
import { lerPedido } from "./_pedido"

export async function GET(request: Request) {
  const erro = await verificarPermissao(request, "documentos_gerados.ver")
  if (erro) return erro

  const url = new URL(request.url)
  const numero = (chave: string) => {
    const v = url.searchParams.get(chave)
    return v == null || v === "" ? undefined : Number(v)
  }

  try {
    const documentos = await listarDocumentosGerados({
      contratanteId: numero("contratanteId"),
      requerenteId: numero("requerenteId"),
      processoId: numero("processoId"),
      pessoaId: numero("pessoaId"),
    })
    return NextResponse.json({ documentos })
  } catch (e) {
    if (e instanceof ErroDocumentoGerado) {
      return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: 400 })
    }
    throw e
  }
}

export async function POST(request: Request) {
  const { usuario, erro } = await exigirPermissao(request, "documentos_gerados.gerar")
  if (erro) return erro

  const pedido = await lerPedido(request)
  if ("error" in pedido) return NextResponse.json(pedido, { status: 400 })

  try {
    const resultado = await gerarDocumento({ ...pedido, usuarioId: usuario.userId })
    return NextResponse.json(resultado, { status: resultado.criado ? 201 : 200 })
  } catch (e) {
    if (e instanceof ErroGeracao) {
      return NextResponse.json(
        { error: e.message, codigo: e.codigo, detalhe: e.detalhe },
        { status: 422 },
      )
    }
    throw e
  }
}
