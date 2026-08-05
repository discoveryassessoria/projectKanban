// Um documento gerado — detalhe, histórico de versões e atos.
import { NextResponse } from "next/server"
import { exigirPermissao, verificarPermissao } from "@/src/lib/verificar-permissao"
import {
  invalidarVersao,
  obterDocumentoGerado,
  vincularAoDocumentoOperacional,
  vincularAoProcesso,
  ErroDocumentoGerado,
} from "@/src/services/modelos/documentos-gerados"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "documentos_gerados.ver")
  if (erro) return erro

  const { id } = await params
  const documento = await obterDocumentoGerado(Number(id))
  if (!documento) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 })
  return NextResponse.json({ documento })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const documentoGeradoId = Number(id)

  let corpo: Record<string, unknown>
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }

  const acao = String(corpo.acao ?? "")
  const permissao =
    acao === "invalidar" ? "documentos_gerados.invalidar" : "documentos_gerados.vincular"

  const { usuario, erro } = await exigirPermissao(request, permissao as never)
  if (erro) return erro

  try {
    if (acao === "vincular-processo") {
      const processoId = Number(corpo.processoId)
      if (!Number.isInteger(processoId)) {
        return NextResponse.json({ error: "processoId é obrigatório" }, { status: 400 })
      }
      return NextResponse.json({
        documento: await vincularAoProcesso({
          documentoGeradoId,
          processoId,
          usuarioId: usuario.userId,
        }),
      })
    }

    if (acao === "vincular-documento") {
      const documentoId = Number(corpo.documentoId)
      if (!Number.isInteger(documentoId)) {
        return NextResponse.json({ error: "documentoId é obrigatório" }, { status: 400 })
      }
      return NextResponse.json(
        await vincularAoDocumentoOperacional({
          documentoGeradoId,
          documentoId,
          stepInstanceId: corpo.stepInstanceId == null ? null : Number(corpo.stepInstanceId),
          usuarioId: usuario.userId,
        }),
      )
    }

    if (acao === "invalidar") {
      const versaoId = Number(corpo.versaoId)
      const motivo = String(corpo.motivo ?? "").trim()
      if (!Number.isInteger(versaoId)) {
        return NextResponse.json({ error: "versaoId é obrigatório" }, { status: 400 })
      }
      if (!motivo) {
        return NextResponse.json({ error: "Informe o motivo da invalidação." }, { status: 400 })
      }
      return NextResponse.json({
        versao: await invalidarVersao({ documentoGeradoId, versaoId, motivo, usuarioId: usuario.userId }),
      })
    }

    return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 })
  } catch (e) {
    if (e instanceof ErroDocumentoGerado) {
      return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: 400 })
    }
    throw e
  }
}
