// GET /api/gerenciamento/parametrizacao/simular?tipoProcessoId=&phaseKey=&processoId=
// Roda os MESMOS resolvedores do runtime, sem escrever nada.
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { simularParametrizacao } from "@/src/services/parametrizacao/simulacao-parametrizacao"

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, "usuarios.gerenciar"); if (erro) return erro
  const sp = req.nextUrl.searchParams
  const tipoProcessoId = Number(sp.get("tipoProcessoId"))
  if (!tipoProcessoId) return NextResponse.json({ error: "tipoProcessoId é obrigatório." }, { status: 400 })
  try {
    return NextResponse.json(await simularParametrizacao({
      tipoProcessoId, phaseKey: sp.get("phaseKey"), processoId: sp.get("processoId") ? Number(sp.get("processoId")) : null,
    }))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro na simulação." }, { status: 422 })
  }
}
