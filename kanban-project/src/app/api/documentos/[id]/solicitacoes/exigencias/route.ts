// src/app/api/documentos/[id]/solicitacoes/exigencias/route.ts
//
// O QUE ESTA ETAPA EXIGE ANEXAR — servido para o editor.
//
// Antes, a tela decidia sozinha: um `switch` por canal com o rótulo do anexo em
// texto ("Requerimento PDF enviado", "Print do protocolo CRC"). O arquivo subia
// sem classificação, e nenhuma aba conseguia dizer que aquilo era o documento
// mestre "Requerimento inteiro teor". Agora a tela PERGUNTA, e a resposta traz o
// ID do Cadastro Mestre — que é o que vai para o registro.
//
// Somente leitura. Escopo verificado na linha: o passo tem de ser do documento.

import { NextResponse } from "next/server"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { carregarExigenciasDaEtapa } from "@/src/services/solicitacao-documento"
import { canalDoTexto } from "@/src/lib/process-stage/canais-solicitacao"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const documentoId = parseInt(id)
    if (isNaN(documentoId)) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })

    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: "PERMISSION_REQUIRED" }, { status: 401 })

    const url = new URL(request.url)
    const stepInstanceId = parseInt(url.searchParams.get("stepInstanceId") ?? "")
    if (isNaN(stepInstanceId)) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })

    const exigencias = await carregarExigenciasDaEtapa(
      documentoId,
      stepInstanceId,
      canalDoTexto(url.searchParams.get("canal")),
    )
    if (!exigencias) return NextResponse.json({ error: "STEP_NOT_FOUND" }, { status: 404 })

    return NextResponse.json({ exigencias })
  } catch (error) {
    console.error("[GET /api/documentos/[id]/solicitacoes/exigencias]", error)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
