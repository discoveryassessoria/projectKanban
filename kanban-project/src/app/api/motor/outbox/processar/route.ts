// src/app/api/motor/outbox/processar/route.ts
// Acionamento administrativo do dispatcher da DomainOutbox (reprocessamento seguro).
// Idempotente: reexecutar não duplica efeitos.
import { NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { processarOutbox } from "@/src/services/outbox-dispatcher"

export async function POST(request: Request) {
  const erro = await verificarPermissao(request, "workflow.avancar")
  if (erro) return erro
  try {
    const body = await request.json().catch(() => ({}))
    const resumo = await processarOutbox({
      limite: typeof body.limite === "number" ? body.limite : undefined,
      tipos: Array.isArray(body.tipos) ? body.tipos : undefined,
      forcar: body.forcar === true,
    })
    return NextResponse.json(resumo, { status: 200 })
  } catch (error) {
    console.error("Erro ao processar outbox:", error)
    return NextResponse.json({ error: "Erro ao processar outbox" }, { status: 500 })
  }
}
