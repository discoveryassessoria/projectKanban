// POST — TRANSCREVER o documento automaticamente (camada de texto do PDF ou OCR
// externo, nessa ordem).
//
// Complementa o PUT da transcrição, que recebe texto pronto de fora. Aqui o
// Discovery vai buscar: baixa o arquivo, escolhe o provedor e grava o resultado
// no próprio Documento.
//
// Idempotente: documento já transcrito não é retranscrito, a menos que se peça
// `forcar: true` (reprocessamento explícito).
import { type NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { situacaoDosProvedores, transcreverDocumento } from "@/src/services/registral/ocr"

export const maxDuration = 60

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Transcrever ESCREVE no documento: é permissão do domínio documental.
  const semPermissao = await verificarPermissao(request, "arvore.editar_documento")
  if (semPermissao) return semPermissao

  const { id } = await params
  const documentoId = Number.parseInt(id, 10)
  if (!Number.isFinite(documentoId) || documentoId <= 0) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const usuario = await extrairUsuarioComPermissoes(request)

  const resultado = await transcreverDocumento(documentoId, {
    forcar: body?.forcar === true,
    usuarioId: usuario?.userId ?? null,
  })

  // 200 mesmo quando não transcreveu: não é erro do cliente, é o estado do
  // documento (escaneado sem OCR configurado, por exemplo). O motivo vem no corpo,
  // junto com a situação dos provedores — que é o que explica o que falta.
  return NextResponse.json({ resultado, provedores: situacaoDosProvedores() })
}

export async function GET(request: NextRequest) {
  const semPermissao = await verificarPermissao(request, "arvore.ver")
  if (semPermissao) return semPermissao
  return NextResponse.json({ provedores: situacaoDosProvedores() })
}
