// src/app/api/operacoes-antecipadas/catalogo/route.ts
// Catálogo de tipos operacionais elegíveis para Operação Antecipada. Dinâmico (sem lista fixa).
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { listCatalogo } from "@/src/lib/operacoes/catalogo"

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro
  return NextResponse.json({ catalogo: listCatalogo() })
}
