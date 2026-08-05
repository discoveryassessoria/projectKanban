// Checklist pré-geração — o mesmo que o motor consulta antes de gerar.
import { NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { validarAntesDeGerar, ErroGeracao } from "@/src/services/modelos/gerar-documento"
import { lerPedido } from "../_pedido"

export async function POST(request: Request) {
  const erro = await verificarPermissao(request, "documentos_gerados.ver")
  if (erro) return erro

  const pedido = await lerPedido(request)
  if ("error" in pedido) return NextResponse.json(pedido, { status: 400 })

  try {
    return NextResponse.json(await validarAntesDeGerar(pedido))
  } catch (e) {
    if (e instanceof ErroGeracao) {
      return NextResponse.json({ error: e.message, codigo: e.codigo, detalhe: e.detalhe }, { status: 422 })
    }
    throw e
  }
}
