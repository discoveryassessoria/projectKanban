// src/app/api/documentos/[id]/andamento/route.ts
// ============================================================================
// ANDAMENTO — a linha do tempo real da operação/Tarefa deste documento.
//
//   GET /api/documentos/{id}/andamento
//
// Fonte: montarAndamentoDaOperacao (src/services/andamento-operacional.ts) —
// agrega LogAuditoria + WorkflowEvento + NecessidadeDocumentalEvento +
// DocumentoArquivo + DocumentoObservacao. SOMENTE LEITURA; nada aqui infere
// ou fabrica evento — o que não foi persistido não aparece.
// ============================================================================
import { NextResponse } from "next/server"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { montarAndamentoDaOperacao } from "@/src/services/andamento-operacional"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const documentoId = parseInt(id)
    if (isNaN(documentoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: "PERMISSION_REQUIRED" }, { status: 401 })

    const eventos = await montarAndamentoDaOperacao(documentoId)
    return NextResponse.json({ documentoId, eventos, total: eventos.length })
  } catch (error) {
    console.error("[GET /api/documentos/[id]/andamento]", error)
    return NextResponse.json({ error: "Erro ao buscar o andamento" }, { status: 500 })
  }
}
