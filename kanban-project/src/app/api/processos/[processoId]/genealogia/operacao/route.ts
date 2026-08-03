// src/app/api/processos/[processoId]/genealogia/operacao/route.ts
//
// Abre a BUSCA de um registro/certidão: devolve o documentoId do alvo, criando o
// registro operacional na primeira abertura. Toda a regra vive no serviço
// (garantirDocumentoDaNecessidade); aqui só há autorização e transporte.

import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import {
  garantirDocumentoDaNecessidade,
  OperacaoNecessidadeErro,
} from "@/src/services/genealogia/operacao-necessidade"

export async function POST(request: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(request, "processos.editar")
  if (erro) return erro
  try {
    const { processoId } = await params
    const procId = Number(processoId)
    const body = await request.json().catch(() => ({}))
    const necessidadeId = Number(body?.necessidadeId)
    if (!procId || !necessidadeId) {
      return NextResponse.json({ error: "processoId e necessidadeId são obrigatórios." }, { status: 400 })
    }

    const documentoId = await garantirDocumentoDaNecessidade(procId, necessidadeId)
    return NextResponse.json({ documentoId })
  } catch (e) {
    if (e instanceof OperacaoNecessidadeErro) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    console.error("POST genealogia/operacao", e)
    return NextResponse.json({ error: "Erro ao abrir a operação." }, { status: 500 })
  }
}
