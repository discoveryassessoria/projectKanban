// src/app/api/pessoas/[id]/reconcile/route.ts
//
// ⚠️ LEGADO_INATIVO — DESATIVADO na tarefa de desativação da lógica antiga da
// Genealogia. Este endpoint disparava manualmente a reconciliação de documentos
// auto-gerados (reconcileDocsForPessoa / DOCUMENT_RULES), que criava Documento
// inconsistente (origem="automatica", necessidadeId=null). A geração automática
// foi desligada; enquanto a arquitetura documental definitiva não é aprovada,
// GET e POST respondem 410 Gone e NÃO executam nenhum gerador.

import { NextResponse } from "next/server"

const RESPOSTA_DESATIVADO = {
  error: "Endpoint desativado (LEGADO_INATIVO)",
  motivo:
    "A geração/reconciliação automática de documentos da Genealogia foi desativada. " +
    "A arquitetura documental definitiva ainda não foi configurada.",
}

export async function GET() {
  return NextResponse.json(RESPOSTA_DESATIVADO, { status: 410 })
}

export async function POST() {
  return NextResponse.json(RESPOSTA_DESATIVADO, { status: 410 })
}
