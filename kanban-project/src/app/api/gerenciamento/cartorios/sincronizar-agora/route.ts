// POST /api/gerenciamento/cartorios/sincronizar-agora — botão administrativo.
// MESMO serviço do cron (idempotente, com lock e logs) — nunca fluxo paralelo.
// Requer permissão de gestão (mesma régua do botão equivalente do câmbio).
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { sincronizarCartorios } from "@/src/services/cartorios/cartorio-sync-service"

export const maxDuration = 120

export async function POST(req: NextRequest) {
  const erro = await verificarPermissao(req, "usuarios.gerenciar")
  if (erro) return erro
  const r = await sincronizarCartorios({ gatilho: "manual_sincronizar_agora" })
  return NextResponse.json(r)
}
