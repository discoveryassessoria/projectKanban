// src/app/api/gerenciamento/regras-documentais/conflitos/route.ts
//
// Conflitos entre regras documentais (só leitura). Nunca resolve silenciosamente;
// apenas reporta para decisão humana.

import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { carregarRegras, ordemFaseGlobal } from "@/src/lib/documentos/regras-documentais/persistencia"
import { detectarConflitos } from "@/src/lib/documentos/regras-documentais/conflitos"

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const { searchParams } = new URL(request.url)
    const tp = searchParams.get("tipoProcessoId")
    let regras = await carregarRegras()
    if (tp) regras = regras.filter((r) => r.tipoProcessoId === Number(tp))
    const conflitos = detectarConflitos(regras, ordemFaseGlobal())
    return NextResponse.json({ conflitos })
  } catch (e) {
    console.error("GET regras-documentais/conflitos", e)
    return NextResponse.json({ error: "Erro ao calcular conflitos." }, { status: 500 })
  }
}
